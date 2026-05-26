import { describe, expect, it } from "vitest";
import type {
  AccessReviewCampaign,
  DecisionResult,
  DiscoveryRun,
  DriftFinding,
  EnforcementReadinessReport,
  ExceptionRequest,
  GovernanceFinding,
  NativeGrant,
  ProvisioningJob,
  ProvisioningPlan,
  RebacGraphRepository,
  RebacJobRepository,
  ReconciliationRun,
  RelationshipTuple,
  Resource,
  Subject
} from "../../packages/core/src/index.js";

export const conformanceNow = "2026-05-26T04:00:00.000Z";
export const conformanceTenant = "tenant:alpha";

export interface RepositoryConformanceCase<TRepository> {
  name: string;
  createRepository: () => TRepository;
}

export function describeGraphRepositoryConformance(cases: RepositoryConformanceCase<RebacGraphRepository>[]): void {
  describe.each(cases)("$name graph repository conformance", ({ createRepository }) => {
    it("persists graph facts, native grants, filters, deletes, and defensive copies", () => {
      const repository = createRepository();
      const subject = createSubject();
      const resource = createResource();
      const relationship = createRelationship();
      const nativeGrant = createNativeGrant();
      const deletedAt = "2026-05-26T04:05:00.000Z";

      repository.upsertSubject(subject);
      repository.upsertResource(resource);
      repository.upsertRelationship(relationship);
      repository.upsertNativeGrant(nativeGrant);

      expect(repository.getSubject(subject.id)).toEqual(subject);
      expect(repository.getResource(resource.id)).toEqual(resource);
      expect(repository.getRelationship(relationship.id)).toEqual(relationship);
      expect(repository.listRelationships({ subjectId: subject.id, relation: relationship.relation })).toEqual([relationship]);
      expect(repository.listNativeGrants({ sourceConnectorId: "mock", nativePermission: "read" })).toEqual([nativeGrant]);
      expect(repository.exportGraph()).toEqual({
        subjects: [subject],
        resources: [resource],
        relationships: [relationship],
        nativeGrants: [nativeGrant]
      });
      expect(repository.exportGraph()).not.toHaveProperty("provisioningJobs");

      repository.listSubjects()[0] = { ...subject, displayName: "Mutated Outside Repository" };
      expect(repository.getSubject(subject.id)?.displayName).toBe(subject.displayName);

      expect(repository.deleteRelationship(relationship.id, deletedAt)).toMatchObject({
        id: relationship.id,
        status: "deleted",
        updatedAt: deletedAt
      });
      expect(repository.deleteRelationship("relationship:missing", deletedAt)).toBeUndefined();
    });
  });
}

export function describeConnectorStateRepositoryConformance(cases: RepositoryConformanceCase<RebacJobRepository>[]): void {
  describe.each(cases)("$name connector-state repository conformance", ({ createRepository }) => {
    it("persists connector state, job records, decisions, filters, idempotency lookups, and defensive copies", () => {
      const repository = createRepository();
      const discoveryRun = createDiscoveryRun();
      const readinessReport = createEnforcementReadinessReport();
      const plan = createProvisioningPlan();
      const job = createProvisioningJob();
      const driftFinding = createDriftFinding();
      const accessReviewCampaign = createAccessReviewCampaign();
      const governanceFinding = createGovernanceFinding();
      const exceptionRequest = createExceptionRequest();
      const reconciliationRun = createReconciliationRun(driftFinding);
      const decision = createDecision();

      repository.recordDiscoveryRun(discoveryRun);
      repository.recordEnforcementReadinessReport(readinessReport);
      repository.upsertProvisioningPlan(plan);
      repository.upsertProvisioningJob(job);
      repository.upsertDriftFinding(driftFinding);
      repository.upsertAccessReviewCampaign(accessReviewCampaign);
      repository.upsertGovernanceFinding(governanceFinding);
      repository.upsertExceptionRequest(exceptionRequest);
      repository.recordReconciliationRun(reconciliationRun);
      repository.recordDecision(decision);

      expect(repository.listDiscoveryRuns({ connectorId: "mock", status: "completed" })).toEqual([discoveryRun]);
      expect(repository.getEnforcementReadinessReport(readinessReport.id)).toEqual(readinessReport);
      expect(repository.getProvisioningPlanByIdempotencyKey(plan.idempotencyKey as string)).toEqual(plan);
      expect(repository.getProvisioningJobByIdempotencyKey(job.idempotencyKey as string)).toEqual(job);
      expect(repository.getDriftFinding(driftFinding.id)).toEqual(driftFinding);
      expect(repository.listDriftFindings({ severity: "high" })).toEqual([driftFinding]);
      expect(repository.getAccessReviewCampaign(accessReviewCampaign.id)).toEqual(accessReviewCampaign);
      expect(repository.getGovernanceFinding(governanceFinding.id)).toEqual(governanceFinding);
      expect(repository.listGovernanceFindings({ status: "open", severity: "high" })).toEqual([governanceFinding]);
      expect(repository.getExceptionRequest(exceptionRequest.id)).toEqual(exceptionRequest);
      expect(repository.listExceptionRequests({ status: "requested" })).toEqual([exceptionRequest]);
      expect(repository.listReconciliationRuns()).toEqual([reconciliationRun]);
      expect(repository.listDecisions()).toEqual([decision]);
      expect(repository.exportJobs()).toEqual({
        discoveryRuns: [discoveryRun],
        enforcementReadinessReports: [readinessReport],
        provisioningPlans: [plan],
        provisioningJobs: [job],
        driftFindings: [driftFinding],
        accessReviewCampaigns: [accessReviewCampaign],
        governanceFindings: [governanceFinding],
        exceptionRequests: [exceptionRequest],
        reconciliationRuns: [reconciliationRun],
        decisions: [decision]
      });
      expect(repository.exportJobs()).not.toHaveProperty("subjects");

      repository.listProvisioningPlans()[0] = { ...plan, status: "approved" };
      expect(repository.getProvisioningPlan(plan.id)?.status).toBe("planned");
    });

    it("rejects duplicate recorded connector-state run identifiers", () => {
      const repository = createRepository();
      const discoveryRun = createDiscoveryRun();
      const readinessReport = createEnforcementReadinessReport();
      const reconciliationRun = createReconciliationRun(createDriftFinding());

      repository.recordDiscoveryRun(discoveryRun);
      repository.recordEnforcementReadinessReport(readinessReport);
      repository.recordReconciliationRun(reconciliationRun);

      expect(() => repository.recordDiscoveryRun({ ...discoveryRun, status: "failed" })).toThrow(
        `Discovery run ${discoveryRun.id} has already been recorded.`
      );
      expect(() => repository.recordEnforcementReadinessReport({ ...readinessReport, status: "ready" })).toThrow(
        `Enforcement readiness report ${readinessReport.id} has already been recorded.`
      );
      expect(() => repository.recordReconciliationRun({ ...reconciliationRun, status: "failed" })).toThrow(
        `Reconciliation run ${reconciliationRun.id} has already been recorded.`
      );
    });
  });
}

export function createSubject(overrides: Partial<Subject> = {}): Subject {
  return {
    id: "user:bob",
    type: "user",
    displayName: "Bob Example",
    sourceSystem: "mock",
    lifecycleState: "active",
    identifiers: { email: "bob@example.invalid" },
    attributes: { tenantId: conformanceTenant },
    version: "subject:v1",
    createdAt: conformanceNow,
    ...overrides
  };
}

export function createResource(overrides: Partial<Resource> = {}): Resource {
  return {
    id: "document:graph-plan",
    type: "document",
    displayName: "Graph Plan",
    sourceSystem: "mock",
    ownerId: "user:bob",
    dataStewardId: "user:bob",
    technicalOwnerId: "user:bob",
    classification: "controlled",
    lifecycleState: "active",
    attributes: { tenantId: conformanceTenant },
    version: "resource:v1",
    createdAt: conformanceNow,
    ...overrides
  };
}

export function createRelationship(overrides: Partial<RelationshipTuple> = {}): RelationshipTuple {
  return {
    id: "relationship:bob-graph-plan-reader",
    subjectId: "user:bob",
    relation: "reader",
    objectId: "document:graph-plan",
    sourceSystem: "mock",
    assertedAt: conformanceNow,
    assertedBy: "system:test",
    status: "active",
    attributes: { tenantId: conformanceTenant },
    version: "relationship:v1",
    createdAt: conformanceNow,
    ...overrides
  };
}

export function createNativeGrant(overrides: Partial<NativeGrant> = {}): NativeGrant {
  return {
    id: "native-grant:bob-graph-plan-read",
    targetPlatform: "mock",
    targetObjectId: "document:graph-plan",
    subjectId: "user:bob",
    principalType: "user",
    nativePermission: "read",
    grantType: "direct",
    sourceConnectorId: "mock",
    status: "observed",
    observedAt: conformanceNow,
    version: "native-grant:v1",
    createdAt: conformanceNow,
    ...overrides
  };
}

export function createDiscoveryRun(overrides: Partial<DiscoveryRun> = {}): DiscoveryRun {
  return {
    id: "discovery-run:mock:one",
    connectorId: "mock",
    mode: "read_only",
    status: "completed",
    startedAt: conformanceNow,
    completedAt: "2026-05-26T04:01:00.000Z",
    counts: {
      subjects: 1,
      resources: 1,
      relationships: 1,
      nativeGrants: 1,
      warnings: 0
    },
    warnings: [],
    evidence: {
      readOnly: true,
      tenantBoundary: conformanceTenant,
      schemas: ["subject", "resource", "relationship", "native-grant"],
      connectorCapabilities: ["discovery", "read_current_access"],
      nativeAccessReadback: true
    } as unknown as DiscoveryRun["evidence"],
    auditEventIds: ["evt:discovery"],
    version: "discovery-run:v1",
    createdAt: conformanceNow,
    ...overrides
  };
}

export function createEnforcementReadinessReport(
  overrides: Partial<EnforcementReadinessReport> = {}
): EnforcementReadinessReport {
  return {
    id: "enforcement-readiness:mock",
    connectorId: "mock",
    provider: "mock",
    tenantBoundary: conformanceTenant,
    mode: "enforcement",
    status: "blocked",
    checkedAt: conformanceNow,
    control: {
      syntheticOnly: true,
      liveProviderWrites: false,
      incidentMode: false,
      breakGlass: false
    },
    checks: [
      {
        name: "live_provider_writes_blocked",
        status: "pass",
        message: "Synthetic connector remains isolated from live provider writes."
      }
    ],
    requiredApproverRole: "access-admin",
    changeTicketPattern: "^CHG-[0-9]+$",
    liveProviderWritesAllowed: false,
    auditEventIds: ["evt:readiness"],
    version: "enforcement-readiness:v1",
    createdAt: conformanceNow,
    ...overrides
  };
}

export function createDriftFinding(overrides: Partial<DriftFinding> = {}): DriftFinding {
  return {
    id: "drift:bob-graph-plan-read",
    resourceId: "document:graph-plan",
    subjectId: "user:bob",
    nativeGrantId: "native-grant:bob-graph-plan-read",
    nativeAccess: "read",
    intendedAccess: "none",
    severity: "high",
    lifecycleState: "open",
    ownerId: "role:security-operations",
    assigneeId: "role:security-engineer",
    detectedAt: conformanceNow,
    sourceConnectorId: "mock",
    recommendedAction: "revoke",
    status: "open",
    scheduledReconciliation: {
      cadence: "daily",
      scheduledAt: conformanceNow,
      nextRunAt: "2026-05-22T17:00:00.000Z",
      gracePeriodHours: 24,
      overdue: false
    },
    hookEvidence: [],
    remediation: {},
    autoRepairPolicy: {
      enabled: false,
      allowedActions: ["revoke"],
      maxSeverity: "high",
      requireApproval: true,
      requireConnectorReadiness: true,
      liveProviderWrites: false
    },
    version: "drift-finding:v1",
    createdAt: conformanceNow,
    ...overrides
  };
}

export function createAccessReviewCampaign(overrides: Partial<AccessReviewCampaign> = {}): AccessReviewCampaign {
  return {
    id: "access-review:campaign:local-governance",
    name: "Local access review and exception governance campaign",
    scope: "synthetic local subjects, resources, native grants, findings, exceptions, and remediation records",
    ownerRole: "Data Owner",
    reviewerRole: "Data Steward",
    status: "completed",
    startedAt: conformanceNow,
    dueAt: "2026-06-25T04:00:00.000Z",
    completedAt: "2026-05-26T04:03:00.000Z",
    subjectCount: 1,
    resourceCount: 1,
    findingIds: ["governance-finding:drift_bob-graph-plan-read"],
    exceptionRequestIds: ["exception:drift_bob-graph-plan-read"],
    remediationItemIds: ["poam:governance:drift_bob-graph-plan-read"],
    sourceEventIds: ["evt:reconciliation"],
    ownerApprovals: [
      {
        approverRole: "Data Owner",
        decision: "approved",
        decidedAt: "2026-05-26T04:03:00.000Z",
        evidenceRefs: ["evidence:access-review-campaign"]
      }
    ],
    version: "access-review-campaign:v1",
    createdAt: conformanceNow,
    ...overrides
  };
}

export function createGovernanceFinding(overrides: Partial<GovernanceFinding> = {}): GovernanceFinding {
  return {
    id: "governance-finding:drift_bob-graph-plan-read",
    campaignId: "access-review:campaign:local-governance",
    subjectId: "user:bob",
    resourceId: "document:graph-plan",
    action: "read",
    severity: "high",
    status: "open",
    source: "drift",
    sourceFindingId: "drift_bob-graph-plan-read",
    ownerRole: "Resource Owner",
    weakness: "Native read access differs from intended none access.",
    recommendedAction: "revoke",
    detectedAt: conformanceNow,
    dueAt: "2026-06-09T04:00:00.000Z",
    controlId: "CA-7",
    remediation: {
      status: "planned",
      ownerRole: "Resource Owner",
      plan: "Validate intended access, plan revocation, and verify reconciliation closure.",
      dueAt: "2026-06-09T04:00:00.000Z",
      evidenceRefs: ["drift:drift_bob-graph-plan-read"],
      poamItemId: "poam:governance:drift_bob-graph-plan-read"
    },
    exceptionRequestId: "exception:drift_bob-graph-plan-read",
    evidenceRefs: ["drift:drift_bob-graph-plan-read"],
    version: "governance-finding:v1",
    createdAt: conformanceNow,
    ...overrides
  };
}

export function createExceptionRequest(overrides: Partial<ExceptionRequest> = {}): ExceptionRequest {
  return {
    id: "exception:drift_bob-graph-plan-read",
    campaignId: "access-review:campaign:local-governance",
    findingId: "governance-finding:drift_bob-graph-plan-read",
    subjectId: "user:bob",
    resourceId: "document:graph-plan",
    action: "read",
    justification: "Drift finding drift:bob-graph-plan-read requires documented risk acceptance or remediation.",
    status: "requested",
    requesterRole: "Security Engineer",
    ownerRole: "Resource Owner",
    requestedAt: conformanceNow,
    expiresAt: "2026-06-25T04:00:00.000Z",
    reviewRequiredAt: "2026-06-09T04:00:00.000Z",
    ownerApprovals: [
      {
        approverRole: "Resource Owner",
        decision: "pending",
        evidenceRefs: ["evidence:exception-request"]
      }
    ],
    riskAcceptance: {
      status: "pending",
      rationale: "Residual access drift drift:bob-graph-plan-read is tracked for owner review, remediation, or time-bound acceptance.",
      residualRisk: "high",
      expiresAt: "2026-06-25T04:00:00.000Z",
      reviewRequiredAt: "2026-06-09T04:00:00.000Z",
      evidenceRefs: ["drift:drift_bob-graph-plan-read"]
    },
    remediation: createGovernanceFinding().remediation,
    source: "drift",
    sourceFindingId: "drift_bob-graph-plan-read",
    controlIds: ["CA-7", "RA-5"],
    evidenceRefs: ["drift:drift_bob-graph-plan-read"],
    version: "exception-request:v1",
    createdAt: conformanceNow,
    ...overrides
  };
}

export function createReconciliationRun(finding: DriftFinding, overrides: Partial<ReconciliationRun> = {}): ReconciliationRun {
  return {
    id: "reconciliation-run:mock:one",
    connectorId: "mock",
    mode: "dry_run",
    dryRun: true,
    trigger: "manual",
    schedule: {
      cadence: "manual",
      scheduledAt: conformanceNow,
      gracePeriodHours: 0,
      overdue: false
    },
    status: "completed",
    findings: [finding],
    counts: {
      findings: 1,
      highOrCritical: 1
    },
    auditEventIds: ["evt:reconciliation"],
    completedAt: "2026-05-26T04:02:00.000Z",
    version: "reconciliation-run:v1",
    createdAt: conformanceNow,
    ...overrides
  };
}

export function createDecision(overrides: Partial<DecisionResult> = {}): DecisionResult {
  return {
    decisionId: "decision:bob-graph-plan-read",
    decision: "allow",
    subjectId: "user:bob",
    action: "read",
    resourceId: "document:graph-plan",
    reasonCode: "ALLOW_RELATIONSHIP_PATH",
    policyVersion: "policy:v1",
    modelVersion: "model:v1",
    relationshipVersion: "relationship:v1",
    tupleVersion: "tuple:v1",
    contextVersion: "context:none",
    asOf: conformanceNow,
    relationshipPath: [
      {
        subjectId: "user:bob",
        relation: "reader",
        objectId: "document:graph-plan"
      }
    ],
    constraints: {},
    evaluatedAt: conformanceNow,
    ...overrides
  };
}

export function createProvisioningPlan(overrides: Partial<ProvisioningPlan> = {}): ProvisioningPlan {
  return {
    id: "plan:bob-graph-plan-read",
    idempotencyKey: "idem:plan:bob-graph-plan-read",
    connectorId: "mock",
    subjectId: "user:bob",
    resourceId: "document:graph-plan",
    action: "read",
    mode: "dry_run",
    status: "planned",
    actions: [],
    version: "provisioning-plan:v1",
    createdAt: conformanceNow,
    ...overrides
  };
}

export function createProvisioningJob(overrides: Partial<ProvisioningJob> = {}): ProvisioningJob {
  return {
    id: "job:bob-graph-plan-read",
    planId: "plan:bob-graph-plan-read",
    connectorId: "mock",
    mode: "dry_run",
    dryRun: true,
    status: "queued",
    approverId: "system:dry-run",
    idempotencyKey: "idem:job:bob-graph-plan-read",
    actionResults: [],
    verification: {
      status: "pending",
      method: "readback",
      expectedState: { subjectId: "user:bob", resourceId: "document:graph-plan", action: "read" }
    },
    auditEventIds: [],
    startedAt: conformanceNow,
    version: "provisioning-job:v1",
    createdAt: conformanceNow,
    ...overrides
  };
}
