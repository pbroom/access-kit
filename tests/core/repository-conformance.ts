import { describe, expect, it } from "vitest";
import type {
  DecisionResult,
  DiscoveryRun,
  DriftFinding,
  EnforcementReadinessReport,
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
      const reconciliationRun = createReconciliationRun(driftFinding);
      const decision = createDecision();

      repository.recordDiscoveryRun(discoveryRun);
      repository.recordEnforcementReadinessReport(readinessReport);
      repository.upsertProvisioningPlan(plan);
      repository.upsertProvisioningJob(job);
      repository.upsertDriftFinding(driftFinding);
      repository.recordReconciliationRun(reconciliationRun);
      repository.recordDecision(decision);

      expect(repository.listDiscoveryRuns({ connectorId: "mock", status: "completed" })).toEqual([discoveryRun]);
      expect(repository.getEnforcementReadinessReport(readinessReport.id)).toEqual(readinessReport);
      expect(repository.getProvisioningPlanByIdempotencyKey(plan.idempotencyKey as string)).toEqual(plan);
      expect(repository.getProvisioningJobByIdempotencyKey(job.idempotencyKey as string)).toEqual(job);
      expect(repository.getDriftFinding(driftFinding.id)).toEqual(driftFinding);
      expect(repository.listDriftFindings({ severity: "high" })).toEqual([driftFinding]);
      expect(repository.listReconciliationRuns()).toEqual([reconciliationRun]);
      expect(repository.listDecisions()).toEqual([decision]);
      expect(repository.exportJobs()).toEqual({
        discoveryRuns: [discoveryRun],
        enforcementReadinessReports: [readinessReport],
        provisioningPlans: [plan],
        provisioningJobs: [job],
        driftFindings: [driftFinding],
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
    nativeAccess: "read",
    intendedAccess: "none",
    severity: "high",
    detectedAt: conformanceNow,
    sourceConnectorId: "mock",
    recommendedAction: "revoke",
    status: "open",
    version: "drift-finding:v1",
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
    relationshipVersion: "relationship:v1",
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
