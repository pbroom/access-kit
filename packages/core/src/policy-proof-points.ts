import type {
  DecisionResult,
  DecisionValue,
  DriftFinding,
  RelationshipPathStep,
  RelationshipTuple
} from "./domain.js";

export interface DecisionProofPoint {
  kind: "decision";
  name: string;
  subjectId: string;
  action: string;
  resourceId: string;
  relationships: RelationshipTuple[];
  subjectStatus?: "active" | "suspended" | "terminated";
  now: string;
  expect: DecisionValue;
  expectedReasonCode: string;
}

export interface IdempotencyProofPoint {
  kind: "idempotency";
  name: string;
  idempotencyKey: string;
  operations: Array<{ id: string; idempotencyKey: string; operation: string }>;
  expectEffectiveOperations: number;
}

export interface DriftProofPoint {
  kind: "drift";
  name: string;
  finding: DriftFinding;
  expect: "valid_drift_finding";
}

export type PolicyProofPoint =
  | DecisionProofPoint
  | IdempotencyProofPoint
  | DriftProofPoint;

const directAllowRelations = new Set([
  "viewer_of",
  "reader_of",
  "contributor_to",
  "owner_of",
  "admin_of"
]);

const denyRelations = new Set(["denied", "denied_read", "quarantined_from"]);

export function evaluateDecisionProofPoint(proof: DecisionProofPoint): DecisionResult {
  const activeRelationships = proof.relationships.filter((relationship) => {
    if (relationship.status !== "active") {
      return false;
    }

    return !relationship.expiresAt || Date.parse(relationship.expiresAt) > Date.parse(proof.now);
  });

  if (proof.subjectStatus === "suspended" || proof.subjectStatus === "terminated") {
    return decision(proof, "deny", "DENY_SUBJECT_NOT_ACTIVE", []);
  }

  const explicitDeny = activeRelationships.find(
    (relationship) =>
      relationship.subjectId === proof.subjectId &&
      relationship.objectId === proof.resourceId &&
      denyRelations.has(relationship.relation)
  );

  if (explicitDeny) {
    return decision(proof, "deny", "DENY_EXPLICIT_OVERRIDE", [toPathStep(explicitDeny)]);
  }

  const path = findAllowPath(activeRelationships, proof.subjectId, proof.resourceId);

  if (path.length > 0) {
    return decision(proof, "allow", "ALLOW_VIA_RELATIONSHIP_PATH", path);
  }

  return decision(proof, "deny", "DENY_DEFAULT_NO_RELATIONSHIP_PATH", []);
}

export function evaluateIdempotencyProofPoint(proof: IdempotencyProofPoint): number {
  const effectiveKeys = new Set<string>();

  for (const operation of proof.operations) {
    effectiveKeys.add(operation.idempotencyKey);
  }

  return effectiveKeys.size;
}

function decision(
  proof: DecisionProofPoint,
  value: DecisionValue,
  reasonCode: string,
  relationshipPath: RelationshipPathStep[]
): DecisionResult {
  return {
    decisionId: `decision:${proof.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`,
    decision: value,
    subjectId: proof.subjectId,
    action: proof.action,
    resourceId: proof.resourceId,
    reasonCode,
    policyVersion: "policy:test-v1",
    relationshipVersion: "tuple-set:test-v1",
    relationshipPath,
    constraints: {
      deterministic: true,
      llmDecisioning: false
    },
    evaluatedAt: proof.now
  };
}

function findAllowPath(
  relationships: RelationshipTuple[],
  subjectId: string,
  resourceId: string
): RelationshipPathStep[] {
  const queue: Array<{ currentId: string; path: RelationshipPathStep[] }> = [
    { currentId: subjectId, path: [] }
  ];
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

      if (relationship.objectId === resourceId && directAllowRelations.has(relationship.relation)) {
        return path;
      }

      if (relationship.relation === "contains" && relationship.objectId === resourceId) {
        return path;
      }

      if (
        relationship.relation === "member_of" ||
        relationship.relation === "contributor_to" ||
        relationship.relation === "viewer_of" ||
        relationship.relation === "owner_of"
      ) {
        if (!visited.has(relationship.objectId)) {
          visited.add(relationship.objectId);
          queue.push({ currentId: relationship.objectId, path });
        }
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
