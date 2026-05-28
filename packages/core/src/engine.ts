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
import { InMemoryRebacStore } from "./store.js";

export interface DecisionEngineOptions {
  policyVersion?: string;
  modelVersion?: string;
  relationshipVersion?: string;
  tupleVersion?: string;
  contextVersion?: string;
  traversalBounds?: Partial<DecisionTraversalBounds>;
  actor?: string;
  now?: () => string;
  monotonicNow?: () => number;
  auditRecorder?: AuditRecorder;
  onAuditEvent?: (event: AuditEvent) => void;
}

interface DecisionContext {
  request: DecisionRequest;
  evaluatedAt: string;
  versionPins: DecisionRuntimeVersionPins;
  reasonCode: string;
  decision: DecisionValue;
  relationshipPath: RelationshipPathStep[];
  traversal: DecisionTraversalReport;
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

export class RebacDecisionEngine {
  readonly #auditRecorder: AuditRecorder;
  readonly #onAuditEvent?: (event: AuditEvent) => void;
  readonly #store: InMemoryRebacStore;
  readonly #options: NormalizedDecisionEngineOptions;

  constructor(store: InMemoryRebacStore, options: DecisionEngineOptions = {}) {
    this.#store = store;
    this.#auditRecorder = options.auditRecorder ?? new AuditRecorder(store.listAuditEvents());
    this.#onAuditEvent = options.onAuditEvent;
    this.#options = {
      policyVersion: options.policyVersion ?? "policy:local-v1",
      modelVersion: options.modelVersion ?? "model:local-v1",
      relationshipVersion: options.relationshipVersion ?? "tuple-set:local-v1",
      tupleVersion: options.tupleVersion ?? "tuple:v1",
      enforceTupleVersion: Boolean(options.tupleVersion),
      contextVersion: options.contextVersion,
      traversalBounds: mergeDecisionTraversalBounds(DEFAULT_DECISION_TRAVERSAL_BOUNDS, options.traversalBounds),
      actor: options.actor ?? "service:decision-engine",
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
    const runtimeRequest = explain ? request : { ...request, asOf: evaluatedAt };
    const versionPins = normalizeDecisionRuntimeVersionPins(runtimeRequest, this.#options, evaluatedAt);
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
        actor: this.#options.actor,
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
      subjects: this.#store.listSubjects().length,
      resources: this.#store.listResources().length,
      relationships: this.#store.listRelationships().length
    };
    const traversalGuard = new DecisionTraversalGuard(this.#options.traversalBounds, graphSize, request.subjectId);
    const asOfMs = Date.parse(versionPins.asOf);

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

    const activeRelationships = this.#store
      .listRelationships()
      .filter((relationship) =>
        isActiveRelationshipAt(
          relationship,
          versionPins.asOf,
          request.tupleVersion ?? (this.#options.enforceTupleVersion ? versionPins.tupleVersion : undefined)
        )
      );
    const relationshipsBySubject = indexRelationshipsBySubject(activeRelationships);
    const explicitDeny = findDenyPath(
      this.#store,
      relationshipsBySubject,
      traversalGuard,
      request.subjectId,
      request.resourceId,
      rootTenantId,
      versionPins.asOf
    );

    if (explicitDeny.length > 0) {
      return denied("DENY_EXPLICIT_OVERRIDE", explicitDeny);
    }

    if (traversalGuard.boundsExceeded) {
      return denied("DENY_TRAVERSAL_BOUND_EXCEEDED");
    }

    const relationshipPath = findAllowPath(
      this.#store,
      relationshipsBySubject,
      traversalGuard,
      request.subjectId,
      request.resourceId,
      request.action,
      rootTenantId,
      versionPins.asOf
    );

    if (traversalGuard.boundsExceeded) {
      return denied("DENY_TRAVERSAL_BOUND_EXCEEDED", relationshipPath);
    }

    if (relationshipPath.length === 0) {
      return denied("DENY_DEFAULT_NO_RELATIONSHIP_PATH");
    }

    return {
      request,
      evaluatedAt,
      versionPins,
      decision: "allow",
      reasonCode: "ALLOW_VIA_RELATIONSHIP_PATH",
      relationshipPath,
      traversal: traversalGuard.report()
    };

    function denied(
      reasonCode: string,
      relationshipPath: RelationshipPathStep[] = [],
      deniedVersionPins: DecisionRuntimeVersionPins = versionPins
    ): DecisionContext {
      return {
        request,
        evaluatedAt,
        versionPins: deniedVersionPins,
        decision: "deny",
        reasonCode,
        relationshipPath,
        traversal: traversalGuard.report()
      };
    }
  }
}

function toDecisionResult(
  context: DecisionContext,
  explain: boolean,
  performance: DecisionRuntimePerformanceReport
): DecisionResult {
  const relationshipPath = explain ? context.relationshipPath : [];
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
      performance
    },
    evaluatedAt: context.evaluatedAt
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
  relationshipsBySubject: Map<string, RelationshipTuple[]>,
  traversalGuard: DecisionTraversalGuard,
  subjectId: string,
  resourceId: string,
  action: string,
  rootTenantId: string | undefined,
  asOf: string
): RelationshipPathStep[] {
  const allowedRelations = actionAllowRelations.get(action.toLowerCase()) ?? new Set<string>();
  const queue: Array<{ currentId: string; depth: number; hasActionGrant: boolean; path: RelationshipPathStep[] }> = [
    { currentId: subjectId, depth: 0, hasActionGrant: false, path: [] }
  ];
  const bestGrantByNode = new Map<string, boolean>([[subjectId, false]]);

  while (queue.length > 0) {
    const next = queue.shift();

    if (!next) {
      break;
    }

    for (const relationship of relationshipsBySubject.get(next.currentId) ?? []) {
      if (!traversalGuard.recordRelationshipScan()) {
        return [];
      }

      if (!relationshipMatchesTenantBoundary(store, relationship, rootTenantId, asOf)) {
        continue;
      }

      const step = toPathStep(relationship);
      const path = [...next.path, step];
      const depth = next.depth + 1;
      if (!traversalGuard.recordDepth(depth)) {
        return [];
      }

      const relationGrantsAction = allowedRelations.has(relationship.relation);
      const traversable = canTraverseRelationship(relationship, relationGrantsAction, next.hasActionGrant);

      if (relationship.objectId === resourceId && relationGrantsAction) {
        return path;
      }

      if (
        relationship.relation === "contains" &&
        relationship.objectId === resourceId &&
        next.hasActionGrant
      ) {
        return path;
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
          return [];
        }
        bestGrantByNode.set(relationship.objectId, hasActionGrant);
        queue.push({
          currentId: relationship.objectId,
          depth,
          hasActionGrant,
          path
        });
      }
    }
  }

  return [];
}

function findDenyPath(
  store: InMemoryRebacStore,
  relationshipsBySubject: Map<string, RelationshipTuple[]>,
  traversalGuard: DecisionTraversalGuard,
  subjectId: string,
  resourceId: string,
  rootTenantId: string | undefined,
  asOf: string
): RelationshipPathStep[] {
  const queue: Array<{ currentId: string; depth: number; path: RelationshipPathStep[] }> = [
    { currentId: subjectId, depth: 0, path: [] }
  ];
  const visited = new Set<string>([subjectId]);

  while (queue.length > 0) {
    const next = queue.shift();

    if (!next) {
      break;
    }

    for (const relationship of relationshipsBySubject.get(next.currentId) ?? []) {
      if (!traversalGuard.recordRelationshipScan()) {
        return [];
      }

      if (!relationshipMatchesTenantBoundary(store, relationship, rootTenantId, asOf)) {
        continue;
      }

      const step = toPathStep(relationship);
      const path = [...next.path, step];
      const depth = next.depth + 1;
      if (!traversalGuard.recordDepth(depth)) {
        return [];
      }

      if (relationship.objectId === resourceId && denyRelations.has(relationship.relation)) {
        return path;
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
          return [];
        }
        visited.add(relationship.objectId);
        queue.push({ currentId: relationship.objectId, depth, path });
      }
    }
  }

  return [];
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

function indexRelationshipsBySubject(relationships: RelationshipTuple[]): Map<string, RelationshipTuple[]> {
  const index = new Map<string, RelationshipTuple[]>();

  for (const relationship of relationships) {
    const values = index.get(relationship.subjectId);

    if (values) {
      values.push(relationship);
    } else {
      index.set(relationship.subjectId, [relationship]);
    }
  }

  return index;
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
