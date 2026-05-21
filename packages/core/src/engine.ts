import { AuditRecorder, sha256 } from "./audit.js";
import type {
  DecisionRequest,
  DecisionResult,
  DecisionValue,
  RelationshipPathStep,
  RelationshipTuple
} from "./domain.js";
import { InMemoryRebacStore } from "./store.js";

export interface DecisionEngineOptions {
  policyVersion?: string;
  relationshipVersion?: string;
  actor?: string;
  now?: () => string;
  auditRecorder?: AuditRecorder;
}

interface DecisionContext {
  request: DecisionRequest;
  evaluatedAt: string;
  policyVersion: string;
  relationshipVersion: string;
  reasonCode: string;
  decision: DecisionValue;
  relationshipPath: RelationshipPathStep[];
}

const denyRelations = new Set(["denied", "denied_read", "quarantined_from"]);
const traversableRelations = new Set([
  "member_of",
  "contributor_to",
  "viewer_of",
  "reader_of",
  "owner_of",
  "admin_of",
  "contains"
]);

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
  readonly #store: InMemoryRebacStore;
  readonly #options: Required<Omit<DecisionEngineOptions, "auditRecorder">>;

  constructor(store: InMemoryRebacStore, options: DecisionEngineOptions = {}) {
    this.#store = store;
    this.#auditRecorder = options.auditRecorder ?? new AuditRecorder(store.listAuditEvents());
    this.#options = {
      policyVersion: options.policyVersion ?? "policy:local-v1",
      relationshipVersion: options.relationshipVersion ?? "tuple-set:local-v1",
      actor: options.actor ?? "service:decision-engine",
      now: options.now ?? (() => new Date().toISOString())
    };
  }

  check(request: DecisionRequest): DecisionResult {
    return this.#evaluate(request, false);
  }

  explain(request: DecisionRequest): DecisionResult {
    return this.#evaluate(request, true);
  }

  #evaluate(request: DecisionRequest, explain: boolean): DecisionResult {
    const evaluatedAt = this.#options.now();
    const policyVersion = request.policyVersion ?? this.#options.policyVersion;
    const relationshipVersion = request.relationshipVersion ?? this.#options.relationshipVersion;
    const context = this.#buildDecisionContext(request, evaluatedAt, policyVersion, relationshipVersion);
    const result = toDecisionResult(context, explain);
    this.#store.recordDecision(result);
    this.#store.recordAuditEvent(
      this.#auditRecorder.record(
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
            relationshipPath: result.relationshipPath
          }
        },
        evaluatedAt
      )
    );
    return result;
  }

  #buildDecisionContext(
    request: DecisionRequest,
    evaluatedAt: string,
    policyVersion: string,
    relationshipVersion: string
  ): DecisionContext {
    const subject = this.#store.getSubject(request.subjectId);

    if (!subject) {
      return denied("DENY_SUBJECT_NOT_FOUND");
    }

    if (subject.lifecycleState === "suspended" || subject.lifecycleState === "terminated" || subject.lifecycleState === "deleted") {
      return denied("DENY_SUBJECT_NOT_ACTIVE");
    }

    const resource = this.#store.getResource(request.resourceId);

    if (!resource) {
      return denied("DENY_RESOURCE_NOT_FOUND");
    }

    if (resource.lifecycleState !== "active") {
      return denied("DENY_RESOURCE_NOT_ACTIVE");
    }

    const activeRelationships = this.#store
      .listRelationships()
      .filter((relationship) => isActiveRelationship(relationship, evaluatedAt));
    const explicitDeny = findDenyPath(activeRelationships, request.subjectId, request.resourceId);

    if (explicitDeny.length > 0) {
      return denied("DENY_EXPLICIT_OVERRIDE", explicitDeny);
    }

    const relationshipPath = findAllowPath(activeRelationships, request.subjectId, request.resourceId, request.action);

    if (relationshipPath.length === 0) {
      return denied("DENY_DEFAULT_NO_RELATIONSHIP_PATH");
    }

    return {
      request,
      evaluatedAt,
      policyVersion,
      relationshipVersion,
      decision: "allow",
      reasonCode: "ALLOW_VIA_RELATIONSHIP_PATH",
      relationshipPath
    };

    function denied(reasonCode: string, relationshipPath: RelationshipPathStep[] = []): DecisionContext {
      return {
        request,
        evaluatedAt,
        policyVersion,
        relationshipVersion,
        decision: "deny",
        reasonCode,
        relationshipPath
      };
    }
  }
}

function toDecisionResult(context: DecisionContext, explain: boolean): DecisionResult {
  const relationshipPath = explain ? context.relationshipPath : [];
  const decisionHash = sha256({
    request: context.request,
    evaluatedAt: context.evaluatedAt,
    policyVersion: context.policyVersion,
    relationshipVersion: context.relationshipVersion,
    decision: context.decision,
    reasonCode: context.reasonCode
  }).slice(0, 24);

  return {
    decisionId: `decision:${decisionHash}`,
    decision: context.decision,
    subjectId: context.request.subjectId,
    action: context.request.action,
    resourceId: context.request.resourceId,
    reasonCode: context.reasonCode,
    policyVersion: context.policyVersion,
    relationshipVersion: context.relationshipVersion,
    relationshipPath,
    constraints: {
      deterministic: true,
      denyByDefault: true,
      llmDecisioning: false,
      explain
    },
    evaluatedAt: context.evaluatedAt
  };
}

function isActiveRelationship(relationship: RelationshipTuple, now: string): boolean {
  if (relationship.status !== "active") {
    return false;
  }

  return !relationship.expiresAt || Date.parse(relationship.expiresAt) > Date.parse(now);
}

function findAllowPath(
  relationships: RelationshipTuple[],
  subjectId: string,
  resourceId: string,
  action: string
): RelationshipPathStep[] {
  const allowedRelations = actionAllowRelations.get(action.toLowerCase()) ?? new Set<string>();
  const queue: Array<{ currentId: string; hasActionGrant: boolean; path: RelationshipPathStep[] }> = [
    { currentId: subjectId, hasActionGrant: false, path: [] }
  ];
  const visited = new Set<string>([subjectId]);

  while (queue.length > 0) {
    const next = queue.shift();

    if (!next) {
      break;
    }

    for (const relationship of relationships) {
      if (relationship.subjectId !== next.currentId || !traversableRelations.has(relationship.relation)) {
        continue;
      }

      const step = toPathStep(relationship);
      const path = [...next.path, step];
      const relationGrantsAction = allowedRelations.has(relationship.relation);

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

      if (!visited.has(relationship.objectId)) {
        visited.add(relationship.objectId);
        queue.push({
          currentId: relationship.objectId,
          hasActionGrant: next.hasActionGrant || relationGrantsAction,
          path
        });
      }
    }
  }

  return [];
}

function findDenyPath(
  relationships: RelationshipTuple[],
  subjectId: string,
  resourceId: string
): RelationshipPathStep[] {
  const queue: Array<{ currentId: string; path: RelationshipPathStep[] }> = [{ currentId: subjectId, path: [] }];
  const visited = new Set<string>([subjectId]);

  while (queue.length > 0) {
    const next = queue.shift();

    if (!next) {
      break;
    }

    for (const relationship of relationships) {
      if (relationship.subjectId !== next.currentId) {
        continue;
      }

      const step = toPathStep(relationship);
      const path = [...next.path, step];

      if (relationship.objectId === resourceId && denyRelations.has(relationship.relation)) {
        return path;
      }

      if (relationship.objectId === resourceId || !traversableRelations.has(relationship.relation)) {
        continue;
      }

      if (!visited.has(relationship.objectId)) {
        visited.add(relationship.objectId);
        queue.push({ currentId: relationship.objectId, path });
      }
    }
  }

  return [];
}

function toPathStep(relationship: RelationshipTuple): RelationshipPathStep {
  return {
    subjectId: relationship.subjectId,
    relation: relationship.relation,
    objectId: relationship.objectId
  };
}
