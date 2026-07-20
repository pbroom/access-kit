import { AuditRecorder, sha256 } from "./audit.js";
import type {
  AuditEvent,
  DecisionRequest,
  DecisionResult,
  DecisionValue,
  JsonRecord,
  RelationshipPathStep,
  RelationshipTuple,
  Resource,
  Subject
} from "./domain.js";
import {
  createDecisionCacheMetadata,
  createDecisionRuntimePerformanceReport,
  DEFAULT_DECISION_TRAVERSAL_BOUNDS,
  DecisionTraversalGuard,
  latencyTargetsForGraphSize,
  mergeDecisionTraversalBounds,
  normalizeDecisionRuntimeVersionPins,
  type DecisionRuntimePerformanceReport,
  type DecisionRuntimeVersionPins,
  type DecisionTraversalBounds,
  type DecisionTraversalReport
} from "./decision-runtime.js";
import type {
  PolicyModel,
  PolicyModelCaveatCondition,
  PolicyModelContextType
} from "./policy-model.js";
import { InMemoryRebacStore } from "./store.js";

export interface DecisionEngineOptions {
  policyVersion?: string;
  modelVersion?: string;
  relationshipVersion?: string;
  tupleVersion?: string;
  contextVersion?: string;
  traversalBounds?: Partial<DecisionTraversalBounds>;
  actor?: string;
  resolveAuditActor?: () => string | undefined;
  now?: () => string;
  monotonicNow?: () => number;
  policyModel?: PolicyModel;
  auditRecorder?: AuditRecorder;
  onAuditEvent?: (event: AuditEvent) => void;
}

interface DecisionContext {
  request: DecisionRequest;
  evaluatedAt: string;
  versionPins: DecisionRuntimeVersionPins;
  tenantId?: string;
  resourceClassification?: string;
  reasonCode: string;
  decision: DecisionValue;
  relationshipPath: RelationshipPathStep[];
  relationshipPathRelationships: RelationshipTuple[];
  traversal: DecisionTraversalReport;
  constraints?: JsonRecord;
}

interface NormalizedDecisionEngineOptions {
  policyVersion: string;
  modelVersion: string;
  relationshipVersion: string;
  tupleVersion: string;
  enforceTupleVersion: boolean;
  contextVersion?: string;
  traversalBounds: DecisionTraversalBounds;
  actor: string;
  resolveAuditActor?: () => string | undefined;
  now: () => string;
  monotonicNow: () => number;
}

const denyRelations = new Set(["denied", "denied_read", "quarantined_from"]);
const membershipRelations = new Set(["member_of"]);
const containmentRelations = new Set(["contains"]);

const actionAllowRelations = new Map<string, Set<string>>([
  ["read", new Set(["viewer_of", "reader_of", "contributor_to", "owner_of", "admin_of"])],
  ["view", new Set(["viewer_of", "reader_of", "contributor_to", "owner_of", "admin_of"])],
  ["write", new Set(["contributor_to", "owner_of", "admin_of"])],
  ["contribute", new Set(["contributor_to", "owner_of", "admin_of"])],
  ["admin", new Set(["owner_of", "admin_of"])],
  ["administer", new Set(["owner_of", "admin_of"])],
  ["manage", new Set(["owner_of", "admin_of"])]
]);

const MAX_ACTIVE_RELATIONSHIP_SCOPES = 32;
const emptyActiveRelationships: readonly RelationshipTuple[] = [];

interface ActiveRelationshipScope {
  revision: number;
  asOf: string;
  pinnedTupleVersion?: string;
  bySubject: Map<string, readonly RelationshipTuple[]>;
}

interface RelationshipTraversalPath {
  steps: RelationshipPathStep[];
  relationships: RelationshipTuple[];
}

interface AllowQueueEntry {
  currentId: string;
  depth: number;
  hasActionGrant: boolean;
  previous?: AllowQueueEntry;
  relationship?: RelationshipTuple;
}

interface DenyQueueEntry {
  currentId: string;
  depth: number;
  previous?: DenyQueueEntry;
  relationship?: RelationshipTuple;
}

export class RebacDecisionEngine {
  readonly #auditRecorder: AuditRecorder;
  readonly #onAuditEvent?: (event: AuditEvent) => void;
  readonly #policyModel?: PolicyModel;
  readonly #store: InMemoryRebacStore;
  readonly #options: NormalizedDecisionEngineOptions;
  readonly #activeRelationshipScopes = new Map<string, ActiveRelationshipScope>();

  constructor(store: InMemoryRebacStore, options: DecisionEngineOptions = {}) {
    this.#store = store;
    this.#auditRecorder = options.auditRecorder ?? new AuditRecorder(store.listAuditEvents());
    this.#onAuditEvent = options.onAuditEvent;
    this.#policyModel = options.policyModel;
    this.#options = {
      policyVersion: options.policyVersion ?? "policy:local-v1",
      modelVersion: options.modelVersion ?? "model:local-v1",
      relationshipVersion: options.relationshipVersion ?? "tuple-set:local-v1",
      tupleVersion: options.tupleVersion ?? "tuple:v1",
      enforceTupleVersion: Boolean(options.tupleVersion),
      contextVersion: options.contextVersion,
      traversalBounds: mergeDecisionTraversalBounds(DEFAULT_DECISION_TRAVERSAL_BOUNDS, options.traversalBounds),
      actor: options.actor ?? "service:decision-engine",
      resolveAuditActor: options.resolveAuditActor,
      now: options.now ?? (() => new Date().toISOString()),
      monotonicNow: options.monotonicNow ?? (() => performance.now())
    };
  }

  check(request: DecisionRequest): DecisionResult {
    return this.#evaluate(request, false);
  }

  explain(request: DecisionRequest): DecisionResult {
    return this.#evaluate(request, true);
  }

  #evaluate(request: DecisionRequest, explain: boolean): DecisionResult {
    const startedAt = this.#options.monotonicNow();
    const evaluatedAt = this.#options.now();
    const versionPins = normalizeDecisionRuntimeVersionPins(request, this.#options, evaluatedAt);
    const context = this.#buildDecisionContext(request, evaluatedAt, versionPins);
    const performance = createDecisionRuntimePerformanceReport(
      Math.max(0, this.#options.monotonicNow() - startedAt),
      latencyTargetsForGraphSize(context.traversal.graphSize)
    );
    const result = toDecisionResult(context, explain, performance);
    this.#store.recordDecision(result);
    const auditEvent = this.#auditRecorder.record(
      {
        eventType: result.decision === "allow" ? "decision.allowed" : "decision.denied",
        actor: this.#options.resolveAuditActor?.() ?? this.#options.actor,
        subjectId: result.subjectId,
        resourceId: result.resourceId,
        correlationId: `corr:${result.decisionId}`,
        policyVersion: result.policyVersion,
        relationshipVersion: result.relationshipVersion,
        payload: {
          decisionId: result.decisionId,
          decision: result.decision,
          reasonCode: result.reasonCode,
          explain,
          relationshipPath: result.relationshipPath,
          modelVersion: result.modelVersion,
          tupleVersion: result.tupleVersion,
          contextVersion: result.contextVersion,
          asOf: result.asOf,
          cache: result.constraints.cache,
          traversal: context.traversal,
          performance
        }
      },
      evaluatedAt
    );
    this.#store.recordAuditEvent(auditEvent);
    try {
      this.#onAuditEvent?.(auditEvent);
    } catch {
      // Persistence callbacks are best-effort; the computed decision remains authoritative.
    }
    return result;
  }

  #buildDecisionContext(
    request: DecisionRequest,
    evaluatedAt: string,
    versionPins: DecisionRuntimeVersionPins
  ): DecisionContext {
    const graphSize = {
      ...this.#store.graphSize()
    };
    const traversalGuard = new DecisionTraversalGuard(this.#options.traversalBounds, graphSize, request.subjectId);
    const asOfMs = Date.parse(versionPins.asOf);
    const cacheScope: { tenantId?: string; resourceClassification?: string } = {};

    if (!Number.isFinite(asOfMs)) {
      return denied("DENY_INVALID_AS_OF", [], { ...versionPins, asOf: evaluatedAt });
    }

    if (asOfMs > Date.parse(evaluatedAt)) {
      return denied("DENY_AS_OF_IN_FUTURE", [], { ...versionPins, asOf: evaluatedAt });
    }

    const subject = visibleSubjectAt(this.#store, request.subjectId, versionPins.asOf);

    if (!subject) {
      return denied("DENY_SUBJECT_NOT_FOUND");
    }
    cacheScope.tenantId = tenantIdFor(subject);

    const subjectLifecycleState = effectiveLifecycleStateAt(subject, versionPins.asOf);
    if (subjectLifecycleState === "unknown") {
      return denied("DENY_SUBJECT_LIFECYCLE_UNKNOWN_AS_OF");
    }

    if (subjectLifecycleState !== "active") {
      return denied("DENY_SUBJECT_NOT_ACTIVE");
    }

    const resource = visibleResourceAt(this.#store, request.resourceId, versionPins.asOf);

    if (!resource) {
      return denied("DENY_RESOURCE_NOT_FOUND");
    }
    cacheScope.tenantId ??= tenantIdFor(resource);
    cacheScope.resourceClassification = resource.classification;

    const resourceLifecycleState = effectiveLifecycleStateAt(resource, versionPins.asOf);
    if (resourceLifecycleState === "unknown") {
      return denied("DENY_RESOURCE_LIFECYCLE_UNKNOWN_AS_OF");
    }

    if (resourceLifecycleState !== "active") {
      return denied("DENY_RESOURCE_NOT_ACTIVE");
    }

    const rootTenantId = tenantIdFor(subject);

    if (tenantBoundaryDenies(subject, resource)) {
      return denied("DENY_TENANT_BOUNDARY");
    }

    const activeRelationshipScope = this.#activeRelationshipScope(
      versionPins.asOf,
      request.tupleVersion ?? (this.#options.enforceTupleVersion ? versionPins.tupleVersion : undefined)
    );
    const explicitDeny = findDenyPath(
      this.#store,
      activeRelationshipScope,
      traversalGuard,
      request.subjectId,
      request.resourceId,
      rootTenantId,
      versionPins.asOf
    );

    if (explicitDeny.steps.length > 0) {
      return denied("DENY_EXPLICIT_OVERRIDE", explicitDeny.steps, versionPins, undefined, explicitDeny.relationships);
    }

    if (traversalGuard.boundsExceeded) {
      return denied("DENY_TRAVERSAL_BOUND_EXCEEDED");
    }

    const relationshipPath = findAllowPath(
      this.#store,
      activeRelationshipScope,
      traversalGuard,
      request.subjectId,
      request.resourceId,
      request.action,
      rootTenantId,
      versionPins.asOf
    );

    if (traversalGuard.boundsExceeded) {
      return denied("DENY_TRAVERSAL_BOUND_EXCEEDED", relationshipPath.steps, versionPins, undefined, relationshipPath.relationships);
    }

    if (relationshipPath.steps.length === 0) {
      return denied("DENY_DEFAULT_NO_RELATIONSHIP_PATH");
    }

    const caveatResult = this.#policyModel
      ? evaluateConditionalRelationshipCaveats({
          store: this.#store,
          policyModel: this.#policyModel,
          request,
          evaluatedAt,
          relationshipPath: relationshipPath.steps,
          relationshipPathRelationships: relationshipPath.relationships
        })
      : undefined;

    if (caveatResult && !caveatResult.allow) {
      return denied(caveatResult.reasonCode, relationshipPath.steps, versionPins, caveatResult.constraints, relationshipPath.relationships);
    }

    return {
      request,
      evaluatedAt,
      versionPins,
      tenantId: cacheScope.tenantId,
      resourceClassification: cacheScope.resourceClassification,
      decision: "allow",
      reasonCode: "ALLOW_VIA_RELATIONSHIP_PATH",
      relationshipPath: relationshipPath.steps,
      relationshipPathRelationships: relationshipPath.relationships,
      traversal: traversalGuard.report(),
      constraints: caveatResult?.constraints
    };

    function denied(
      reasonCode: string,
      relationshipPath: RelationshipPathStep[] = [],
      deniedVersionPins: DecisionRuntimeVersionPins = versionPins,
      constraints?: JsonRecord,
      relationshipPathRelationships: RelationshipTuple[] = []
    ): DecisionContext {
      return {
        request,
        evaluatedAt,
        versionPins: deniedVersionPins,
        tenantId: cacheScope.tenantId,
        resourceClassification: cacheScope.resourceClassification,
        decision: "deny",
        reasonCode,
        relationshipPath,
        relationshipPathRelationships,
        traversal: traversalGuard.report(),
        constraints
      };
    }
  }

  #activeRelationshipScope(asOf: string, pinnedTupleVersion: string | undefined): ActiveRelationshipScope {
    const revision = this.#store.relationshipRevision();
    const key = `${revision}\u0000${asOf}\u0000${pinnedTupleVersion ?? ""}`;
    const cached = this.#activeRelationshipScopes.get(key);

    if (cached) {
      return cached;
    }

    const scope: ActiveRelationshipScope = {
      revision,
      asOf,
      pinnedTupleVersion,
      bySubject: new Map()
    };
    this.#activeRelationshipScopes.set(key, scope);
    if (this.#activeRelationshipScopes.size > MAX_ACTIVE_RELATIONSHIP_SCOPES) {
      const [oldestKey] = this.#activeRelationshipScopes.keys();
      this.#activeRelationshipScopes.delete(oldestKey);
    }
    return scope;
  }
}

function toDecisionResult(
  context: DecisionContext,
  explain: boolean,
  performance: DecisionRuntimePerformanceReport
): DecisionResult {
  const relationshipPath = explain ? context.relationshipPath : [];
  const cache = createDecisionCacheMetadata({
    request: context.request,
    versionPins: context.versionPins,
    tenantId: context.tenantId,
    resourceClassification: context.resourceClassification,
    evaluatedAt: context.evaluatedAt
  });
  const decisionHash = sha256({
    request: context.request,
    asOf: context.versionPins.asOf,
    versionPins: context.versionPins,
    decision: context.decision,
    reasonCode: context.reasonCode,
    explain
  }).slice(0, 24);

  return {
    decisionId: `decision:${decisionHash}`,
    decision: context.decision,
    subjectId: context.request.subjectId,
    action: context.request.action,
    resourceId: context.request.resourceId,
    reasonCode: context.reasonCode,
    policyVersion: context.versionPins.policyVersion,
    modelVersion: context.versionPins.modelVersion,
    relationshipVersion: context.versionPins.relationshipVersion,
    tupleVersion: context.versionPins.tupleVersion,
    contextVersion: context.versionPins.contextVersion,
    asOf: context.versionPins.asOf,
    relationshipPath,
    constraints: {
      deterministic: true,
      denyByDefault: true,
      llmDecisioning: false,
      explain,
      timeTravel: {
        asOf: context.versionPins.asOf,
        evaluatedAt: context.evaluatedAt,
        historical: Date.parse(context.versionPins.asOf) !== Date.parse(context.evaluatedAt)
      },
      traversal: context.traversal,
      performance,
      cache,
      ...context.constraints
    },
    evaluatedAt: context.evaluatedAt
  };
}

function evaluateConditionalRelationshipCaveats(input: {
  store: InMemoryRebacStore;
  policyModel: PolicyModel;
  request: DecisionRequest;
  evaluatedAt: string;
  relationshipPath: RelationshipPathStep[];
  relationshipPathRelationships: RelationshipTuple[];
}): { allow: true; constraints: JsonRecord } | { allow: false; reasonCode: string; constraints: JsonRecord } {
  const caveatsByName = new Map((input.policyModel.caveats ?? []).map((caveat) => [caveat.name, caveat]));
  const conditionalRelationships = (input.policyModel.conditionalRelationships ?? []).filter((conditional) =>
    !conditional.actions || conditional.actions.includes(input.request.action)
  );
  const explanations: JsonRecord[] = [];

  for (const [index, step] of input.relationshipPath.entries()) {
    const matchingConditionals = conditionalRelationships.filter((entry) => entry.relation === step.relation);
    if (matchingConditionals.length === 0) {
      continue;
    }
    if (matchingConditionals.length > 1) {
      explanations.push(caveatExplanation("duplicate-conditional-relationship", step.relation, "invalid", "DENY_POLICY_CAVEAT_INVALID", []));
      return {
        allow: false,
        reasonCode: "DENY_POLICY_CAVEAT_INVALID",
        constraints: caveatConstraints(input.policyModel, explanations)
      };
    }
    const [conditional] = matchingConditionals;

    const relationship = input.relationshipPathRelationships[index];

    for (const caveatName of conditional.caveats) {
      const caveat = caveatsByName.get(caveatName);

      if (!caveat || !relationship) {
        const reasonCode = caveat?.reasonCode ?? "DENY_POLICY_CAVEAT_INVALID";
        explanations.push(caveatExplanation(caveatName, step.relation, "invalid", reasonCode, []));
        return {
          allow: false,
          reasonCode,
          constraints: caveatConstraints(input.policyModel, explanations)
        };
      }

      const conditionResults = caveat.conditions.map((condition) =>
        evaluateCaveatCondition({
          store: input.store,
          request: input.request,
          relationship,
          evaluatedAt: input.evaluatedAt,
          condition
        })
      );
      const failed = conditionResults.find((result) => result.status !== "pass");
      const status = failed ? "fail" : "pass";
      explanations.push(caveatExplanation(caveat.name, step.relation, status, failed ? caveat.reasonCode : undefined, conditionResults));

      if (failed) {
        return {
          allow: false,
          reasonCode: caveat.reasonCode,
          constraints: caveatConstraints(input.policyModel, explanations)
        };
      }
    }
  }

  return {
    allow: true,
    constraints: caveatConstraints(input.policyModel, explanations)
  };
}

function evaluateCaveatCondition(input: {
  store: InMemoryRebacStore;
  request: DecisionRequest;
  relationship: RelationshipTuple;
  evaluatedAt: string;
  condition: PolicyModelCaveatCondition;
}): JsonRecord {
  const actual = resolveConditionValue(input);

  if (!actual.present) {
    return conditionExplanation(input.condition, "missing");
  }
  if (!valueMatchesContextType(actual.value, input.condition.type)) {
    return conditionExplanation(input.condition, "invalid");
  }

  return conditionExplanation(input.condition, compareCondition(actual.value, input.condition) ? "pass" : "fail");
}

function resolveConditionValue(input: {
  store: InMemoryRebacStore;
  request: DecisionRequest;
  relationship: RelationshipTuple;
  evaluatedAt: string;
  condition: PolicyModelCaveatCondition;
}): { present: true; value: unknown } | { present: false } {
  const { condition } = input;

  if (condition.source === "context") {
    return valueAt(input.request.context, condition.key);
  }
  if (condition.source === "environment") {
    return condition.key === "evaluatedAt" ? { present: true, value: input.evaluatedAt } : { present: false };
  }
  if (condition.source === "relationship") {
    return valueAt(directAndAttributeRecord(input.relationship), condition.key);
  }
  if (condition.source === "subject") {
    return valueAt(directAndAttributeRecord(input.store.getSubject(input.request.subjectId)), condition.key);
  }
  return valueAt(directAndAttributeRecord(input.store.getResource(input.request.resourceId)), condition.key);
}

function directAndAttributeRecord(value: Subject | Resource | RelationshipTuple | undefined): JsonRecord | undefined {
  if (!value) {
    return undefined;
  }

  return {
    ...value.attributes,
    status: "status" in value ? value.status : undefined,
    lifecycleState: "lifecycleState" in value ? value.lifecycleState : undefined,
    classification: "classification" in value ? value.classification : undefined,
    assertedAt: "assertedAt" in value ? value.assertedAt : undefined,
    expiresAt: "expiresAt" in value ? value.expiresAt : undefined
  };
}

function valueAt(record: JsonRecord | undefined, key: string): { present: true; value: unknown } | { present: false } {
  if (!record || record[key] === undefined || record[key] === null) {
    return { present: false };
  }
  return { present: true, value: record[key] };
}

function compareCondition(actual: unknown, condition: PolicyModelCaveatCondition): boolean {
  if (condition.operator === "equals") {
    return actual === condition.value;
  }
  if (condition.operator === "one_of") {
    return Array.isArray(condition.value) && condition.value.some((candidate) => candidate === actual);
  }
  if (condition.operator === "less_than_or_equal") {
    return typeof actual === "number" && typeof condition.value === "number" && actual <= condition.value;
  }
  if (condition.operator === "greater_than_or_equal") {
    return typeof actual === "number" && typeof condition.value === "number" && actual >= condition.value;
  }
  if (condition.operator === "before") {
    return typeof actual === "string" && typeof condition.value === "string" && Date.parse(actual) < Date.parse(condition.value);
  }
  if (condition.operator === "after") {
    return typeof actual === "string" && typeof condition.value === "string" && Date.parse(actual) > Date.parse(condition.value);
  }
  return false;
}

function valueMatchesContextType(value: unknown, type: PolicyModelContextType): boolean {
  if (type === "datetime") {
    return typeof value === "string" && !Number.isNaN(Date.parse(value));
  }
  return typeof value === type;
}

function caveatConstraints(policyModel: PolicyModel, explanations: JsonRecord[]): JsonRecord {
  if (explanations.length === 0) {
    return {};
  }

  return {
    policyCaveats: {
      deterministic: true,
      policyModelVersion: policyModel.version,
      results: explanations
    }
  };
}

function caveatExplanation(
  caveat: string,
  relation: string,
  status: string,
  reasonCode: string | undefined,
  conditions: JsonRecord[]
): JsonRecord {
  return {
    caveat,
    relation,
    status,
    reasonCode,
    conditions
  };
}

function conditionExplanation(condition: PolicyModelCaveatCondition, status: string): JsonRecord {
  return {
    source: condition.source,
    key: condition.key,
    operator: condition.operator,
    status
  };
}

function isActiveRelationshipAt(
  relationship: RelationshipTuple,
  asOf: string,
  pinnedTupleVersion: string | undefined
): boolean {
  if (pinnedTupleVersion && relationship.version !== pinnedTupleVersion) {
    return false;
  }

  if (!isVisibleAt(relationship, asOf)) {
    return false;
  }

  const asOfMs = Date.parse(asOf);
  const assertedAtMs = Date.parse(relationship.assertedAt);
  if (Number.isFinite(assertedAtMs) && assertedAtMs > asOfMs) {
    return false;
  }

  if (relationship.status === "deleted") {
    const deletedAfterAsOf = Boolean(relationship.updatedAt && Date.parse(relationship.updatedAt) > asOfMs);
    const expiresAfterAsOf = !relationship.expiresAt || Date.parse(relationship.expiresAt) > asOfMs;
    return deletedAfterAsOf && expiresAfterAsOf;
  }

  if (relationship.status === "expired") {
    return Boolean(relationship.expiresAt && Date.parse(relationship.expiresAt) > asOfMs);
  }

  return !relationship.expiresAt || Date.parse(relationship.expiresAt) > asOfMs;
}

function findAllowPath(
  store: InMemoryRebacStore,
  activeRelationshipScope: ActiveRelationshipScope,
  traversalGuard: DecisionTraversalGuard,
  subjectId: string,
  resourceId: string,
  action: string,
  rootTenantId: string | undefined,
  asOf: string
): RelationshipTraversalPath {
  const allowedRelations = actionAllowRelations.get(action.toLowerCase()) ?? new Set<string>();
  const queue: AllowQueueEntry[] = [
    { currentId: subjectId, depth: 0, hasActionGrant: false }
  ];
  const bestGrantByNode = new Map<string, boolean>([[subjectId, false]]);

  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    const next = queue[queueIndex];

    for (const relationship of activeRelationshipsForSubject(store, activeRelationshipScope, next.currentId)) {
      if (!traversalGuard.recordRelationshipScan()) {
        return emptyRelationshipTraversalPath();
      }

      if (!relationshipMatchesTenantBoundary(store, relationship, rootTenantId, asOf)) {
        continue;
      }

      const depth = next.depth + 1;
      if (!traversalGuard.recordDepth(depth)) {
        return emptyRelationshipTraversalPath();
      }

      const relationGrantsAction = allowedRelations.has(relationship.relation);
      const traversable = canTraverseRelationship(relationship, relationGrantsAction, next.hasActionGrant);

      if (relationship.objectId === resourceId && relationGrantsAction) {
        return buildAllowPath(next, relationship);
      }

      if (
        relationship.relation === "contains" &&
        relationship.objectId === resourceId &&
        next.hasActionGrant
      ) {
        return buildAllowPath(next, relationship);
      }

      if (relationship.objectId === resourceId) {
        continue;
      }

      if (!traversable || !isActiveGraphNodeAt(store, relationship.objectId, asOf)) {
        continue;
      }

      const hasActionGrant = next.hasActionGrant || relationGrantsAction;
      const previousBest = bestGrantByNode.get(relationship.objectId);

      if (previousBest !== true && previousBest !== hasActionGrant) {
        if (!traversalGuard.recordVisitedNode(relationship.objectId)) {
          return emptyRelationshipTraversalPath();
        }
        bestGrantByNode.set(relationship.objectId, hasActionGrant);
        queue.push({
          currentId: relationship.objectId,
          depth,
          hasActionGrant,
          previous: next,
          relationship
        });
      }
    }
  }

  return emptyRelationshipTraversalPath();
}

function findDenyPath(
  store: InMemoryRebacStore,
  activeRelationshipScope: ActiveRelationshipScope,
  traversalGuard: DecisionTraversalGuard,
  subjectId: string,
  resourceId: string,
  rootTenantId: string | undefined,
  asOf: string
): RelationshipTraversalPath {
  const queue: DenyQueueEntry[] = [
    { currentId: subjectId, depth: 0 }
  ];
  const visited = new Set<string>([subjectId]);

  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    const next = queue[queueIndex];

    for (const relationship of activeRelationshipsForSubject(store, activeRelationshipScope, next.currentId)) {
      if (!traversalGuard.recordRelationshipScan()) {
        return emptyRelationshipTraversalPath();
      }

      if (!relationshipMatchesTenantBoundary(store, relationship, rootTenantId, asOf)) {
        continue;
      }

      const depth = next.depth + 1;
      if (!traversalGuard.recordDepth(depth)) {
        return emptyRelationshipTraversalPath();
      }

      if (relationship.objectId === resourceId && denyRelations.has(relationship.relation)) {
        return buildDenyPath(next, relationship);
      }

      if (
        relationship.objectId === resourceId ||
        !canTraverseDenyRelationship(relationship) ||
        !isActiveGraphNodeAt(store, relationship.objectId, asOf)
      ) {
        continue;
      }

      if (!visited.has(relationship.objectId)) {
        if (!traversalGuard.recordVisitedNode(relationship.objectId)) {
          return emptyRelationshipTraversalPath();
        }
        visited.add(relationship.objectId);
        queue.push({ currentId: relationship.objectId, depth, previous: next, relationship });
      }
    }
  }

  return emptyRelationshipTraversalPath();
}

function activeRelationshipsForSubject(
  store: InMemoryRebacStore,
  scope: ActiveRelationshipScope,
  subjectId: string
): readonly RelationshipTuple[] {
  const cached = scope.bySubject.get(subjectId);

  if (cached) {
    return cached;
  }

  const active = store
    .listRelationshipsForSubject(subjectId)
    .filter((relationship) => isActiveRelationshipAt(relationship, scope.asOf, scope.pinnedTupleVersion));
  scope.bySubject.set(subjectId, active.length > 0 ? active : emptyActiveRelationships);
  return active;
}

function buildAllowPath(entry: AllowQueueEntry, finalRelationship: RelationshipTuple): RelationshipTraversalPath {
  const relationships: RelationshipTuple[] = [finalRelationship];
  for (let cursor: AllowQueueEntry | undefined = entry; cursor?.relationship; cursor = cursor.previous) {
    relationships.push(cursor.relationship);
  }
  relationships.reverse();
  return {
    steps: relationships.map(toPathStep),
    relationships
  };
}

function buildDenyPath(entry: DenyQueueEntry, finalRelationship: RelationshipTuple): RelationshipTraversalPath {
  const relationships: RelationshipTuple[] = [finalRelationship];
  for (let cursor: DenyQueueEntry | undefined = entry; cursor?.relationship; cursor = cursor.previous) {
    relationships.push(cursor.relationship);
  }
  relationships.reverse();
  return {
    steps: relationships.map(toPathStep),
    relationships
  };
}

function emptyRelationshipTraversalPath(): RelationshipTraversalPath {
  return { steps: [], relationships: [] };
}

function canTraverseRelationship(
  relationship: RelationshipTuple,
  relationGrantsAction: boolean,
  hasActionGrant: boolean
): boolean {
  if (membershipRelations.has(relationship.relation)) {
    return true;
  }

  if (containmentRelations.has(relationship.relation)) {
    return hasActionGrant;
  }

  return relationGrantsAction;
}

function canTraverseDenyRelationship(relationship: RelationshipTuple): boolean {
  return membershipRelations.has(relationship.relation);
}

function isActiveGraphNodeAt(store: InMemoryRebacStore, id: string, asOf: string): boolean {
  const subject = visibleSubjectAt(store, id, asOf);
  if (subject) {
    return effectiveLifecycleStateAt(subject, asOf) === "active";
  }

  const resource = visibleResourceAt(store, id, asOf);
  if (resource) {
    return effectiveLifecycleStateAt(resource, asOf) === "active";
  }

  return false;
}

function tenantBoundaryDenies(subject: Subject, resource: Resource): boolean {
  const subjectTenantId = tenantIdFor(subject);
  const resourceTenantId = tenantIdFor(resource);

  if (!subjectTenantId && !resourceTenantId) {
    return false;
  }

  return !subjectTenantId || !resourceTenantId || subjectTenantId !== resourceTenantId;
}

function relationshipMatchesTenantBoundary(
  store: InMemoryRebacStore,
  relationship: RelationshipTuple,
  rootTenantId: string | undefined,
  asOf: string
): boolean {
  if (!rootTenantId) {
    const relationshipIsUntenanted = !stringAttribute(relationship.attributes, "tenantId");
    const objectNodeIsUntenanted = !tenantIdFor(visibleSubjectAt(store, relationship.objectId, asOf) ?? visibleResourceAt(store, relationship.objectId, asOf));
    return relationshipIsUntenanted && objectNodeIsUntenanted;
  }

  const relationshipTenantId = stringAttribute(relationship.attributes, "tenantId");

  if (relationshipTenantId && relationshipTenantId !== rootTenantId) {
    return false;
  }

  const objectNode = visibleSubjectAt(store, relationship.objectId, asOf) ?? visibleResourceAt(store, relationship.objectId, asOf);

  return tenantIdFor(objectNode) === rootTenantId;
}

function visibleSubjectAt(store: InMemoryRebacStore, id: string, asOf: string): Subject | undefined {
  const subject = store.getSubject(id);
  return subject && isVisibleAt(subject, asOf) ? subject : undefined;
}

function visibleResourceAt(store: InMemoryRebacStore, id: string, asOf: string): Resource | undefined {
  const resource = store.getResource(id);
  return resource && isVisibleAt(resource, asOf) ? resource : undefined;
}

function isVisibleAt(entity: { createdAt: string; updatedAt?: string; status?: string }, asOf: string): boolean {
  const asOfMs = Date.parse(asOf);
  const createdAtMs = Date.parse(entity.createdAt);
  if (Number.isFinite(createdAtMs) && createdAtMs > asOfMs) {
    return false;
  }

  return !(entity.status === "deleted" && entity.updatedAt && Date.parse(entity.updatedAt) <= asOfMs);
}

type EffectiveLifecycleState = Subject["lifecycleState"] | Resource["lifecycleState"] | "unknown";

function effectiveLifecycleStateAt(node: Subject | Resource, asOf: string): EffectiveLifecycleState {
  if (node.updatedAt && Date.parse(node.updatedAt) > Date.parse(asOf)) {
    return "unknown";
  }

  return node.lifecycleState;
}

function tenantIdFor(node: Pick<Subject | Resource, "attributes"> | undefined): string | undefined {
  return stringAttribute(node?.attributes, "tenantId");
}

function stringAttribute(attributes: JsonRecord | undefined, key: string): string | undefined {
  const value = attributes?.[key];

  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function toPathStep(relationship: RelationshipTuple): RelationshipPathStep {
  return {
    subjectId: relationship.subjectId,
    relation: relationship.relation,
    objectId: relationship.objectId
  };
}
