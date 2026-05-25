import type {
  DecisionResult,
  DecisionValue,
  DriftFinding,
  RelationshipTuple,
  Resource,
  ResourceType,
  Subject,
  SubjectType
} from "./domain.js";
import { RebacDecisionEngine } from "./engine.js";
import { InMemoryRebacStore } from "./store.js";

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

const subjectTypes = new Set<SubjectType>([
  "user",
  "group",
  "service_account",
  "service_principal",
  "managed_identity",
  "device",
  "workload"
]);

const resourceTypes = new Set<ResourceType>([
  "organization",
  "workspace",
  "application",
  "sharepoint_site",
  "team",
  "folder",
  "document",
  "power_app",
  "flow",
  "dataverse_environment",
  "aws_account",
  "aws_role",
  "dataset",
  "api"
]);

export function evaluateDecisionProofPoint(proof: DecisionProofPoint): DecisionResult {
  const store = createDecisionProofPointStore(proof);
  const engine = new RebacDecisionEngine(store, {
    actor: "service:policy-proof-point-evaluator",
    now: () => proof.now,
    policyVersion: "policy:test-v1",
    relationshipVersion: "tuple-set:test-v1"
  });

  return engine.explain({
    subjectId: proof.subjectId,
    action: proof.action,
    resourceId: proof.resourceId
  });
}

export function evaluateIdempotencyProofPoint(proof: IdempotencyProofPoint): number {
  const effectiveKeys = new Set<string>();

  for (const operation of proof.operations) {
    effectiveKeys.add(operation.idempotencyKey);
  }

  return effectiveKeys.size;
}

export function createDecisionProofPointStore(proof: DecisionProofPoint): InMemoryRebacStore {
  const subjects = new Map<string, Subject>();
  const resources = new Map<string, Resource>();

  upsertGraphNode(proof.subjectId, proof.subjectStatus ?? "active");
  upsertGraphNode(proof.resourceId, "active");

  for (const relationship of proof.relationships) {
    upsertGraphNode(relationship.subjectId, "active");
    upsertGraphNode(relationship.objectId, "active");
  }

  return new InMemoryRebacStore({
    subjects: [...subjects.values()],
    resources: [...resources.values()],
    relationships: proof.relationships
  });

  function upsertGraphNode(id: string, lifecycleState: Subject["lifecycleState"]): void {
    const [prefix] = id.split(":", 1);

    if (subjectTypes.has(prefix as SubjectType)) {
      if (subjects.has(id)) {
        return;
      }

      subjects.set(id, {
        id,
        type: prefix as SubjectType,
        displayName: id,
        sourceSystem: "policy-proof-point",
        lifecycleState,
        identifiers: { id },
        version: "subject:test-v1",
        createdAt: proof.now
      });
      return;
    }

    const resourceType = resourceTypes.has(prefix as ResourceType) ? (prefix as ResourceType) : "application";
    if (resources.has(id)) {
      return;
    }

    resources.set(id, {
      id,
      type: resourceType,
      displayName: id,
      sourceSystem: "policy-proof-point",
      ownerId: proof.subjectId,
      dataStewardId: proof.subjectId,
      technicalOwnerId: proof.subjectId,
      classification: "internal",
      lifecycleState,
      version: "resource:test-v1",
      createdAt: proof.now
    });
  }
}
