import type {
  DecisionRequest,
  DecisionValue,
  JsonRecord,
  LifecycleState,
  RelationshipTuple,
  Resource,
  ResourceType,
  Subject,
  SubjectType
} from "./domain.js";
import { createDefaultPolicyModel, type PolicyModel } from "./policy-model.js";
import type { RebacSeedData } from "./store.js";

export const DEMO_SEED_ID = "demo-seed:local-rebac-v1";
export const DEMO_SEED_VERSION = "demo-seed:v1";
export const DEMO_SEED_SOURCE_SYSTEM = "access-kit-demo-seed";
export const DEMO_SEED_TENANT_ID = "tenant:local-demo";
export const DEMO_SEED_TIMESTAMP = "2026-05-21T17:00:00.000Z";
export const DEMO_POLICY_VERSION = "policy:demo-local-v1";
export const DEMO_RELATIONSHIP_VERSION = "tuple-set:demo-v1";

export type DemoSeedAudience = "quickstart" | "evaluation";

export interface DemoDecisionRequest {
  name: string;
  audience: DemoSeedAudience;
  description: string;
  request: DecisionRequest;
  expectedDecision: DecisionValue;
  expectedReasonCode: string;
  evidenceLabels: string[];
}

export interface DemoEvidenceLabel {
  name: string;
  audience: DemoSeedAudience;
  purpose: string;
  controls: string[];
  evidenceTypes: string[];
  localProofPoint: true;
  synthetic: true;
  liveTenantData: false;
  disclaimer: string;
}

export interface DemoPolicyTest {
  name: string;
  request: DecisionRequest;
  expectedDecision: DecisionValue;
  expectedReasonCode: string;
}

export interface DemoPolicyFixture {
  name: string;
  model: PolicyModel;
  tests: DemoPolicyTest[];
}

export interface DemoSeedHarness {
  id: typeof DEMO_SEED_ID;
  version: typeof DEMO_SEED_VERSION;
  generatedAt: typeof DEMO_SEED_TIMESTAMP;
  sourceSystem: typeof DEMO_SEED_SOURCE_SYSTEM;
  tenantBoundary: typeof DEMO_SEED_TENANT_ID;
  localProofPoint: true;
  synthetic: true;
  liveTenantData: false;
  seed: RebacSeedData;
  policy: DemoPolicyFixture;
  decisionRequests: DemoDecisionRequest[];
  evidenceLabels: DemoEvidenceLabel[];
  quickstart: {
    decisionRequestNames: string[];
    evidenceLabelNames: string[];
  };
  evaluation: {
    decisionRequestNames: string[];
    evidenceLabelNames: string[];
  };
}

export function createDemoSeedHarness(): DemoSeedHarness {
  const decisionRequests = createDemoDecisionRequests();
  const evidenceLabels = createDemoEvidenceLabels();

  return {
    id: DEMO_SEED_ID,
    version: DEMO_SEED_VERSION,
    generatedAt: DEMO_SEED_TIMESTAMP,
    sourceSystem: DEMO_SEED_SOURCE_SYSTEM,
    tenantBoundary: DEMO_SEED_TENANT_ID,
    localProofPoint: true,
    synthetic: true,
    liveTenantData: false,
    seed: createDemoSeedData(),
    policy: createDemoPolicyFixture(decisionRequests),
    decisionRequests,
    evidenceLabels,
    quickstart: {
      decisionRequestNames: decisionRequests
        .filter((request) => request.audience === "quickstart")
        .map((request) => request.name),
      evidenceLabelNames: evidenceLabels
        .filter((label) => label.audience === "quickstart")
        .map((label) => label.name)
    },
    evaluation: {
      decisionRequestNames: decisionRequests
        .filter((request) => request.audience === "evaluation")
        .map((request) => request.name),
      evidenceLabelNames: evidenceLabels
        .filter((label) => label.audience === "evaluation")
        .map((label) => label.name)
    }
  };
}

export function createDemoSeedData(): RebacSeedData {
  return {
    subjects: [
      subject("user:alice", "user", "Alice Analyst", { employeeId: "DEMO-0001" }, "active", {
        role: "case_analyst",
        department: "case_review"
      }),
      subject("user:bob", "user", "Bob Suspended", { employeeId: "DEMO-0002" }, "suspended", {
        role: "case_analyst",
        department: "case_review"
      }),
      subject("user:case-owner", "user", "Case Workspace Owner", { employeeId: "DEMO-0003" }, "active", {
        role: "resource_owner"
      }),
      subject("user:data-steward", "user", "Data Steward", { employeeId: "DEMO-0004" }, "active", {
        role: "data_steward"
      }),
      subject("user:tech-owner", "user", "Technical Owner", { employeeId: "DEMO-0005" }, "active", {
        role: "technical_owner"
      }),
      subject("user:external-reviewer", "user", "External Reviewer", { externalId: "DEMO-EXT-0001" }, "active", {
        external: true,
        role: "external_reviewer"
      }),
      subject("group:case-team", "group", "Case Team", { groupId: "DEMO-G-CASE" }, "active", {
        role: "case_team"
      }),
      subject("group:security-reviewers", "group", "Security Reviewers", { groupId: "DEMO-G-SECURITY" }, "active", {
        role: "security_review"
      })
    ],
    resources: [
      resource("organization:local-demo", "organization", "Local Demo Organization", "user:case-owner", undefined, {
        evidenceBoundary: "local_proof_point"
      }),
      resource("workspace:case", "workspace", "Case Workspace", "user:case-owner", "organization:local-demo", {
        workflow: "case_review"
      }),
      resource("folder:case-files", "folder", "Case Files", "user:data-steward", "workspace:case", {
        workflow: "case_review"
      }),
      resource("document:case-plan", "document", "Case Plan", "user:data-steward", "folder:case-files", {
        quickstartPrimary: true
      }),
      resource("document:restricted-notes", "document", "Restricted Notes", "user:data-steward", "folder:case-files", {
        classificationDetail: "restricted_demo_notes"
      }, "confidential")
    ],
    relationships: [
      relationship("relationship:alice-case-team", "user:alice", "member_of", "group:case-team"),
      relationship("relationship:bob-case-team", "user:bob", "member_of", "group:case-team"),
      relationship("relationship:data-steward-security-reviewers", "user:data-steward", "member_of", "group:security-reviewers"),
      relationship("relationship:case-team-workspace", "group:case-team", "contributor_to", "workspace:case"),
      relationship("relationship:case-owner-workspace", "user:case-owner", "owner_of", "workspace:case"),
      relationship("relationship:security-reviewers-restricted-notes", "group:security-reviewers", "reader_of", "document:restricted-notes"),
      relationship("relationship:workspace-case-files", "workspace:case", "contains", "folder:case-files"),
      relationship("relationship:case-files-case-plan", "folder:case-files", "contains", "document:case-plan"),
      relationship("relationship:case-files-restricted-notes", "folder:case-files", "contains", "document:restricted-notes"),
      relationship("relationship:alice-restricted-notes-denied-read", "user:alice", "denied_read", "document:restricted-notes")
    ]
  };
}

export function createDemoDecisionRequests(): DemoDecisionRequest[] {
  return [
    decisionRequest({
      name: "quickstart-allow-case-plan",
      audience: "quickstart",
      description: "Alice can read the case plan through group membership, workspace contribution, and containment.",
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan",
      expectedDecision: "allow",
      expectedReasonCode: "ALLOW_VIA_RELATIONSHIP_PATH",
      evidenceLabels: ["quickstart-local-proof-point"]
    }),
    decisionRequest({
      name: "quickstart-deny-default",
      audience: "quickstart",
      description: "An external reviewer has no relationship path to the case plan and is denied by default.",
      subjectId: "user:external-reviewer",
      action: "read",
      resourceId: "document:case-plan",
      expectedDecision: "deny",
      expectedReasonCode: "DENY_DEFAULT_NO_RELATIONSHIP_PATH",
      evidenceLabels: ["quickstart-local-proof-point"]
    }),
    decisionRequest({
      name: "evaluation-write-case-plan",
      audience: "evaluation",
      description: "Alice can write the case plan because contributor access to the workspace carries through containment.",
      subjectId: "user:alice",
      action: "write",
      resourceId: "document:case-plan",
      expectedDecision: "allow",
      expectedReasonCode: "ALLOW_VIA_RELATIONSHIP_PATH",
      evidenceLabels: ["evaluation-policy-proof-points"]
    }),
    decisionRequest({
      name: "evaluation-explicit-deny-restricted-notes",
      audience: "evaluation",
      description: "An explicit deny on restricted notes overrides Alice's inherited contributor path.",
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:restricted-notes",
      expectedDecision: "deny",
      expectedReasonCode: "DENY_EXPLICIT_OVERRIDE",
      evidenceLabels: ["evaluation-policy-proof-points", "evaluation-ato-evidence"]
    }),
    decisionRequest({
      name: "evaluation-suspended-subject",
      audience: "evaluation",
      description: "A suspended subject is denied before relationship traversal even when a path exists.",
      subjectId: "user:bob",
      action: "read",
      resourceId: "document:case-plan",
      expectedDecision: "deny",
      expectedReasonCode: "DENY_SUBJECT_NOT_ACTIVE",
      evidenceLabels: ["evaluation-policy-proof-points"]
    }),
    decisionRequest({
      name: "evaluation-owner-admin-case-plan",
      audience: "evaluation",
      description: "The case owner can administer the case plan through ownership of the containing workspace.",
      subjectId: "user:case-owner",
      action: "admin",
      resourceId: "document:case-plan",
      expectedDecision: "allow",
      expectedReasonCode: "ALLOW_VIA_RELATIONSHIP_PATH",
      evidenceLabels: ["evaluation-ato-evidence"]
    })
  ];
}

export function createDemoEvidenceLabels(): DemoEvidenceLabel[] {
  return [
    evidenceLabel({
      name: "quickstart-local-proof-point",
      audience: "quickstart",
      purpose: "Five-minute local quickstart decisions and explanations.",
      controls: ["AC-3", "AU-2"],
      evidenceTypes: ["decision_logs", "relationship_tuples"]
    }),
    evidenceLabel({
      name: "evaluation-policy-proof-points",
      audience: "evaluation",
      purpose: "Thirty-minute evaluation policy checks and deny-by-default coverage.",
      controls: ["AC-3", "CM-3"],
      evidenceTypes: ["decision_logs", "policy_tests", "relationship_tuples"]
    }),
    evidenceLabel({
      name: "evaluation-ato-evidence",
      audience: "evaluation",
      purpose: "Local ATO evidence package labels for audit, access review, and assessor inspection.",
      controls: ["AC-2", "AC-3", "AC-6", "AU-2", "AU-6"],
      evidenceTypes: ["audit_events", "access_review", "control_mapping", "evidence_integrity"]
    }),
    evidenceLabel({
      name: "evaluation-drift-and-reconciliation",
      audience: "evaluation",
      purpose: "Dry-run reconciliation and drift evidence labels for local evaluation only.",
      controls: ["AC-6", "CA-7"],
      evidenceTypes: ["native_access_readback", "drift_findings", "reconciliation_runs"]
    })
  ];
}

export function createDemoPolicyFixture(decisionRequests: DemoDecisionRequest[] = createDemoDecisionRequests()): DemoPolicyFixture {
  const baseModel = createDefaultPolicyModel();

  return {
    name: "local demo ReBAC policy",
    model: {
      ...baseModel,
      id: "policy-model:demo-local-rebac-v1",
      version: DEMO_POLICY_VERSION,
      metadata: {
        ...baseModel.metadata,
        seedHarnessId: DEMO_SEED_ID,
        source: DEMO_SEED_SOURCE_SYSTEM,
        tenantBoundary: DEMO_SEED_TENANT_ID,
        synthetic: true,
        localProofPoint: true,
        liveTenantData: false
      }
    },
    tests: decisionRequests.map((request) => ({
      name: request.name,
      request: { ...request.request },
      expectedDecision: request.expectedDecision,
      expectedReasonCode: request.expectedReasonCode
    }))
  };
}

function decisionRequest(options: {
  name: string;
  audience: DemoSeedAudience;
  description: string;
  subjectId: string;
  action: string;
  resourceId: string;
  expectedDecision: DecisionValue;
  expectedReasonCode: string;
  evidenceLabels: string[];
}): DemoDecisionRequest {
  return {
    name: options.name,
    audience: options.audience,
    description: options.description,
    request: {
      subjectId: options.subjectId,
      action: options.action,
      resourceId: options.resourceId,
      context: {
        purpose: options.audience === "quickstart" ? "quickstart" : "evaluation",
        requestSource: DEMO_SEED_SOURCE_SYSTEM,
        tenantId: DEMO_SEED_TENANT_ID,
        synthetic: true,
        localProofPoint: true,
        evidenceLabels: options.evidenceLabels
      },
      policyVersion: DEMO_POLICY_VERSION,
      relationshipVersion: DEMO_RELATIONSHIP_VERSION
    },
    expectedDecision: options.expectedDecision,
    expectedReasonCode: options.expectedReasonCode,
    evidenceLabels: [...options.evidenceLabels]
  };
}

function evidenceLabel(options: {
  name: string;
  audience: DemoSeedAudience;
  purpose: string;
  controls: string[];
  evidenceTypes: string[];
}): DemoEvidenceLabel {
  return {
    name: options.name,
    audience: options.audience,
    purpose: options.purpose,
    controls: [...options.controls],
    evidenceTypes: [...options.evidenceTypes],
    localProofPoint: true,
    synthetic: true,
    liveTenantData: false,
    disclaimer: "Local synthetic proof-point data only; not production ATO approval and not live tenant evidence."
  };
}

function subject(
  id: string,
  type: SubjectType,
  displayName: string,
  identifiers: Record<string, string>,
  lifecycleState: LifecycleState,
  attributes: JsonRecord = {}
): Subject {
  return {
    id,
    type,
    displayName,
    sourceSystem: DEMO_SEED_SOURCE_SYSTEM,
    lifecycleState,
    identifiers,
    attributes: demoAttributes(attributes),
    version: "subject:demo-v1",
    createdAt: DEMO_SEED_TIMESTAMP,
    lastSeenAt: DEMO_SEED_TIMESTAMP
  };
}

function resource(
  id: string,
  type: ResourceType,
  displayName: string,
  ownerId: string,
  parentId?: string,
  attributes: JsonRecord = {},
  classification = "internal"
): Resource {
  return {
    id,
    type,
    displayName,
    sourceSystem: DEMO_SEED_SOURCE_SYSTEM,
    ownerId,
    dataStewardId: "user:data-steward",
    technicalOwnerId: "user:tech-owner",
    classification,
    lifecycleState: "active",
    parentId,
    attributes: demoAttributes(attributes),
    version: "resource:demo-v1",
    createdAt: DEMO_SEED_TIMESTAMP,
    lastSeenAt: DEMO_SEED_TIMESTAMP
  };
}

function relationship(id: string, subjectId: string, relation: string, objectId: string): RelationshipTuple {
  return {
    id,
    subjectId,
    relation,
    objectId,
    sourceSystem: DEMO_SEED_SOURCE_SYSTEM,
    assertedAt: DEMO_SEED_TIMESTAMP,
    assertedBy: "service:demo-seed",
    status: "active",
    attributes: demoAttributes(),
    version: "tuple:demo-v1",
    createdAt: DEMO_SEED_TIMESTAMP
  };
}

function demoAttributes(attributes: JsonRecord = {}): JsonRecord {
  return {
    tenantId: DEMO_SEED_TENANT_ID,
    seedHarnessId: DEMO_SEED_ID,
    synthetic: true,
    localProofPoint: true,
    liveTenantData: false,
    ...attributes
  };
}
