import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assessPersistenceReadiness,
  createLocalEngineSeed,
  InMemoryRebacPersistenceRepository,
  LocalJsonFileGraphRepository,
  type NativeGrant,
  type PersistenceBackendDescriptor,
  type ProvisioningJob,
  type ProvisioningPlan,
  type RelationshipTuple,
  type Resource,
  type Subject
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

  it("persists graph facts to a local JSON graph file and reloads them separately from jobs", () => {
    const graphPath = join(mkdtempSync(join(tmpdir(), "rebac-graph-")), "graph-state.json");
    const repository = new LocalJsonFileGraphRepository({ graphPath, now: () => now });
    const subject = createSubject();
    const resource = createResource();
    const relationship = createRelationship();
    const nativeGrant = createNativeGrant();

    repository.upsertSubject(subject);
    repository.upsertResource(resource);
    repository.upsertRelationship(relationship);
    repository.upsertNativeGrant(nativeGrant);
    const receipt = repository.flush(now);

    expect(receipt).toMatchObject({
      backend: "local_file",
      location: "graph-state.json",
      graphHash: expect.stringMatching(/^sha256:/),
      entityCounts: {
        subjects: 1,
        resources: 1,
        relationships: 1,
        nativeGrants: 1
      }
    });

    const stored = JSON.parse(readFileSync(graphPath, "utf8")) as {
      version: string;
      graph: Record<string, unknown>;
    };
    expect(stored.version).toBe("rebac-graph-state:v1");
    expect(stored.graph).not.toHaveProperty("provisioningJobs");
    expect(stored.graph).not.toHaveProperty("auditEvents");

    const reopened = new LocalJsonFileGraphRepository({ graphPath, now: () => now });
    expect(reopened.getSubject(subject.id)).toEqual(subject);
    expect(reopened.getResource(resource.id)).toEqual(resource);
    expect(reopened.listRelationships({ subjectId: subject.id, relation: "reader" })).toEqual([relationship]);
    expect(reopened.listNativeGrants({ sourceConnectorId: "mock", nativePermission: "read" })).toEqual([nativeGrant]);

    reopened.listSubjects()[0] = { ...subject, displayName: "Mutated Outside Repository" };
    expect(reopened.getSubject(subject.id)?.displayName).toBe("Bob Example");
  });

  it("marks deleted relationships in the persisted graph snapshot", () => {
    const graphPath = join(mkdtempSync(join(tmpdir(), "rebac-graph-")), "graph-state.json");
    const repository = new LocalJsonFileGraphRepository({ graphPath, now: () => now });
    const relationship = createRelationship();

    repository.upsertRelationship(relationship);
    expect(repository.deleteRelationship(relationship.id, "2026-05-21T18:00:00.000Z")).toMatchObject({
      id: relationship.id,
      status: "deleted",
      updatedAt: "2026-05-21T18:00:00.000Z"
    });

    const reopened = new LocalJsonFileGraphRepository({ graphPath, now: () => now });
    expect(reopened.getRelationship(relationship.id)).toMatchObject({
      id: relationship.id,
      status: "deleted"
    });
  });

  it("rejects tampered local graph snapshots before serving graph data", () => {
    const graphPath = join(mkdtempSync(join(tmpdir(), "rebac-graph-")), "graph-state.json");
    const repository = new LocalJsonFileGraphRepository({ graphPath, now: () => now });
    const subject = createSubject();

    repository.upsertSubject(subject);
    const stored = JSON.parse(readFileSync(graphPath, "utf8")) as {
      graph: { subjects: Subject[] };
    };
    stored.graph.subjects[0] = { ...subject, displayName: "Tampered Subject" };
    writeFileSync(graphPath, `${JSON.stringify(stored)}\n`, "utf8");

    expect(() => new LocalJsonFileGraphRepository({ graphPath, now: () => now })).toThrow(
      "ReBAC graph state hash does not match the stored graph payload."
    );
  });

  it("keeps local JSON graph persistence blocked from production readiness", () => {
    const repository = new LocalJsonFileGraphRepository({
      graphPath: join(mkdtempSync(join(tmpdir(), "rebac-graph-")), "graph-state.json"),
      now: () => now
    });

    expect(repository.describePersistence()).toMatchObject({
      component: "graph",
      backend: "local_file",
      durable: false,
      immutable: false,
      capabilities: ["graph_read", "graph_write", "relationship_query", "native_grant_readback", "backup_restore"]
    });
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

function createSubject(): Subject {
  return {
    id: "user:bob",
    type: "user",
    displayName: "Bob Example",
    sourceSystem: "mock",
    lifecycleState: "active",
    identifiers: { email: "bob@example.invalid" },
    version: "subject:v1",
    createdAt: now
  };
}

function createResource(): Resource {
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
    version: "resource:v1",
    createdAt: now
  };
}

function createRelationship(): RelationshipTuple {
  return {
    id: "relationship:bob-graph-plan-reader",
    subjectId: "user:bob",
    relation: "reader",
    objectId: "document:graph-plan",
    sourceSystem: "mock",
    assertedAt: now,
    assertedBy: "system:test",
    status: "active",
    version: "relationship:v1",
    createdAt: now
  };
}

function createNativeGrant(): NativeGrant {
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
