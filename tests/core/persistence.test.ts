import { describe, expect, it } from "vitest";
import {
  assessPersistenceReadiness,
  createLocalEngineSeed,
  InMemoryRebacPersistenceRepository,
  type NativeGrant,
  type PersistenceBackendDescriptor,
  type ProvisioningJob,
  type ProvisioningPlan
} from "../../packages/core/src/index.js";

const now = "2026-05-21T17:00:00.000Z";

describe("persistent ReBAC repository contracts", () => {
  it("keeps graph facts, native grants, and jobs as separate persistence concepts", () => {
    const repository = new InMemoryRebacPersistenceRepository(createLocalEngineSeed());
    const nativeGrant = createNativeGrant();
    const plan = createProvisioningPlan();
    const job = createProvisioningJob();

    repository.upsertNativeGrant(nativeGrant);
    repository.upsertProvisioningPlan(plan);
    repository.upsertProvisioningJob(job);

    expect(repository.exportGraph()).toMatchObject({
      subjects: expect.any(Array),
      resources: expect.any(Array),
      relationships: expect.any(Array),
      nativeGrants: [nativeGrant]
    });
    expect(repository.exportJobs()).toMatchObject({
      provisioningPlans: [plan],
      provisioningJobs: [job]
    });
    expect(repository.listNativeGrants({ sourceConnectorId: "mock", nativePermission: "read" })).toEqual([nativeGrant]);
    expect(repository.listProvisioningPlans()).toEqual([plan]);
    expect(repository.getProvisioningJobByIdempotencyKey("idem:job:alice-case-plan-read")).toEqual(job);
    expect(repository.exportGraph()).not.toHaveProperty("provisioningJobs");
  });

  it("returns defensive copies from the in-memory conformance adapter", () => {
    const repository = new InMemoryRebacPersistenceRepository(createLocalEngineSeed());
    const subjects = repository.listSubjects();
    const plan = createProvisioningPlan();

    repository.upsertProvisioningPlan(plan);
    subjects[0] = { ...subjects[0], displayName: "Mutated Outside Store" };
    repository.listProvisioningPlans()[0] = { ...plan, status: "approved" };

    expect(repository.getSubject("user:alice")?.displayName).toBe("Alice Example");
    expect(repository.getProvisioningPlan(plan.id)?.status).toBe("planned");
  });

  it("describes the in-memory graph adapter without advertising job capabilities on the graph descriptor", () => {
    const repository = new InMemoryRebacPersistenceRepository(createLocalEngineSeed());

    expect(repository.describePersistence()).toMatchObject({
      component: "graph",
      backend: "memory",
      durable: false,
      immutable: false,
      capabilities: ["graph_read", "graph_write", "relationship_query", "native_grant_readback"]
    });
    expect(repository.describePersistence().capabilities).not.toContain("job_enqueue");
    expect(repository.describePersistence().capabilities).not.toContain("idempotency_lookup");
  });

  it("blocks proof-point persistence from production readiness", () => {
    const report = assessPersistenceReadiness(
      [
        {
          component: "graph",
          backend: "memory",
          durable: false,
          immutable: false,
          capabilities: ["graph_read", "graph_write", "relationship_query"],
          version: "persistence-backend:v1"
        },
        {
          component: "audit",
          backend: "local_file",
          durable: false,
          immutable: false,
          capabilities: ["audit_append", "audit_hash_chain"],
          retentionDays: 30,
          version: "persistence-backend:v1"
        },
        {
          component: "job",
          backend: "memory",
          durable: false,
          immutable: false,
          capabilities: ["job_enqueue", "idempotency_lookup"],
          version: "persistence-backend:v1"
        }
      ],
      now
    );

    expect(report.status).toBe("blocked");
    expect(failingCheckNames(report.checks)).toEqual([
      "graph_repository_durable",
      "graph_repository_capabilities",
      "audit_repository_durable",
      "audit_repository_capabilities",
      "audit_repository_immutable",
      "audit_repository_retention",
      "job_repository_durable",
      "job_repository_capabilities"
    ]);
  });

  it("marks external graph, append-only audit, and queue stores ready when required controls are present", () => {
    const descriptors: PersistenceBackendDescriptor[] = [
      {
        component: "graph",
        backend: "external_graph",
        durable: true,
        immutable: false,
        capabilities: ["graph_read", "graph_write", "relationship_query", "transactional_writes", "backup_restore"],
        location: "postgres://rebac-graph",
        version: "persistence-backend:v1"
      },
      {
        component: "audit",
        backend: "external_append_only_audit",
        durable: true,
        immutable: true,
        capabilities: ["audit_append", "audit_hash_chain", "audit_immutability", "audit_retention", "backup_restore"],
        retentionDays: 2555,
        location: "worm://audit-ledger",
        version: "persistence-backend:v1"
      },
      {
        component: "job",
        backend: "external_queue",
        durable: true,
        immutable: false,
        capabilities: ["job_enqueue", "idempotency_lookup", "transactional_writes", "backup_restore"],
        location: "queue://rebac-jobs",
        version: "persistence-backend:v1"
      }
    ];

    const report = assessPersistenceReadiness(descriptors, now);

    expect(report.status).toBe("ready");
    expect(report.checks.every((check) => check.status === "pass")).toBe(true);
    expect(report.requiredCapabilities.audit).toContain("audit_immutability");
  });

  it("blocks duplicate persistence descriptors for the same component", () => {
    const descriptors: PersistenceBackendDescriptor[] = [
      {
        component: "graph",
        backend: "external_graph",
        durable: true,
        immutable: false,
        capabilities: ["graph_read", "graph_write", "relationship_query", "transactional_writes", "backup_restore"],
        location: "postgres://rebac-graph-primary",
        version: "persistence-backend:v1"
      },
      {
        component: "graph",
        backend: "external_graph",
        durable: true,
        immutable: false,
        capabilities: ["graph_read", "graph_write", "relationship_query", "transactional_writes", "backup_restore"],
        location: "postgres://rebac-graph-shadow",
        version: "persistence-backend:v1"
      },
      {
        component: "audit",
        backend: "external_append_only_audit",
        durable: true,
        immutable: true,
        capabilities: ["audit_append", "audit_hash_chain", "audit_immutability", "audit_retention", "backup_restore"],
        retentionDays: 2555,
        location: "worm://audit-ledger",
        version: "persistence-backend:v1"
      },
      {
        component: "job",
        backend: "external_queue",
        durable: true,
        immutable: false,
        capabilities: ["job_enqueue", "idempotency_lookup", "transactional_writes", "backup_restore"],
        location: "queue://rebac-jobs",
        version: "persistence-backend:v1"
      }
    ];

    const report = assessPersistenceReadiness(descriptors, now);

    expect(report.status).toBe("blocked");
    expect(failingCheckNames(report.checks)).toEqual(["graph_repository_descriptor_unique"]);
    expect(report.checks.find((check) => check.name === "graph_repository_descriptor_unique")).toMatchObject({
      component: "graph",
      evidence: { count: 2, backends: ["external_graph", "external_graph"] }
    });
    expect(report.descriptors).toHaveLength(4);
  });
});

function failingCheckNames(checks: Array<{ name: string; status: string }>): string[] {
  return checks.filter((check) => check.status === "fail").map((check) => check.name);
}

function createNativeGrant(): NativeGrant {
  return {
    id: "native-grant:alice-case-plan-read",
    targetPlatform: "mock",
    targetObjectId: "document:case-plan",
    subjectId: "user:alice",
    principalType: "user",
    nativePermission: "read",
    grantType: "direct",
    sourceConnectorId: "mock",
    status: "observed",
    observedAt: now,
    version: "native-grant:v1",
    createdAt: now
  };
}

function createProvisioningPlan(): ProvisioningPlan {
  return {
    id: "plan:alice-case-plan-read",
    idempotencyKey: "idem:plan:alice-case-plan-read",
    connectorId: "mock",
    subjectId: "user:alice",
    resourceId: "document:case-plan",
    action: "read",
    mode: "dry_run",
    status: "planned",
    actions: [],
    version: "provisioning-plan:v1",
    createdAt: now
  };
}

function createProvisioningJob(): ProvisioningJob {
  return {
    id: "job:alice-case-plan-read",
    planId: "plan:alice-case-plan-read",
    connectorId: "mock",
    mode: "dry_run",
    dryRun: true,
    status: "queued",
    approverId: "system:dry-run",
    idempotencyKey: "idem:job:alice-case-plan-read",
    actionResults: [],
    verification: {
      status: "pending",
      method: "readback",
      expectedState: { subjectId: "user:alice", resourceId: "document:case-plan", action: "read" }
    },
    auditEventIds: [],
    startedAt: now,
    version: "provisioning-job:v1",
    createdAt: now
  };
}
