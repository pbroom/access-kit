import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  InMemoryExternalSnapshotStore,
  InMemoryRebacPersistenceRepository,
  LocalJsonFileGraphRepository,
  LocalJsonFileJobRepository,
  ProductionConnectorStateStoreAdapter,
  ProductionGraphStoreAdapter,
  ProductionJobQueueAdapter,
  type ProductionConnectorStateStoreRecord,
  type ProductionGraphStoreRecord,
  type ProductionJobQueueStoreRecord
} from "../../packages/core/src/index.js";
import {
  conformanceNow,
  conformanceTenant,
  createDiscoveryRun,
  createEnforcementReadinessReport,
  createProvisioningJob,
  createProvisioningPlan,
  createResource,
  createSubject,
  describeConnectorStateRepositoryConformance,
  describeGraphRepositoryConformance
} from "./repository-conformance.js";
import { stableHash } from "../../packages/core/src/repository-envelopes.js";

describeGraphRepositoryConformance([
  {
    name: "in-memory",
    createRepository: () => new InMemoryRebacPersistenceRepository()
  },
  {
    name: "local JSON",
    createRepository: () =>
      new LocalJsonFileGraphRepository({
        graphPath: join(mkdtempSync(join(tmpdir(), "rebac-graph-conformance-")), "graph-state.json"),
        now: () => conformanceNow
      })
  },
  {
    name: "production external",
    createRepository: () => createProductionGraphRepository()
  }
]);

describeConnectorStateRepositoryConformance([
  {
    name: "in-memory",
    createRepository: () => new InMemoryRebacPersistenceRepository()
  },
  {
    name: "local JSON",
    createRepository: () =>
      new LocalJsonFileJobRepository({
        jobsPath: join(mkdtempSync(join(tmpdir(), "rebac-jobs-conformance-")), "job-state.json"),
        now: () => conformanceNow
      })
  },
  {
    name: "production external",
    createRepository: () => createProductionConnectorStateRepository()
  },
  {
    name: "production external queue",
    createRepository: () => createProductionJobQueueRepository()
  }
]);

describe("production graph and connector-state adapters", () => {
  it("describes production graph persistence without changing the queue readiness boundary", () => {
    const graph = createProductionGraphRepository();
    const connectorState = createProductionConnectorStateRepository();

    expect(graph.describePersistence()).toMatchObject({
      component: "graph",
      backend: "external_graph",
      durable: true,
      immutable: false,
      capabilities: [
        "graph_read",
        "graph_write",
        "relationship_query",
        "native_grant_readback",
        "transactional_writes",
        "backup_restore"
      ]
    });
    expect(connectorState.describeConnectorStatePersistence()).toMatchObject({
      component: "connector_state",
      backend: "external_connector_state",
      durable: true,
      immutable: false,
      capabilities: expect.arrayContaining([
        "connector_state_read",
        "connector_state_write",
        "discovery_run_history",
        "drift_finding_history",
        "reconciliation_evidence",
        "readiness_report_history",
        "idempotency_lookup",
        "transactional_writes",
        "backup_restore"
      ])
    });
    expect(connectorState.describeConnectorStatePersistence().capabilities).not.toContain("job_enqueue");
  });

  it("creates backup metadata and restores graph snapshots from the external store", () => {
    const store = new InMemoryExternalSnapshotStore<ProductionGraphStoreRecord>();
    const repository = createProductionGraphRepository(store);
    const secondSubject = createSubject({
      id: "user:charlie",
      displayName: "Charlie Example",
      identifiers: { email: "charlie@example.invalid" }
    });

    repository.upsertSubject(createSubject());
    repository.upsertResource(createResource());
    const backup = repository.createBackup("backup:graph:one", "2026-05-26T04:10:00.000Z");
    repository.upsertSubject(secondSubject);

    expect(repository.getSubject(secondSubject.id)).toEqual(secondSubject);
    expect(repository.restoreBackup(backup.id, "2026-05-26T04:11:00.000Z")).toMatchObject({
      backend: "external",
      location: "external://graph/access-kit-test-graph",
      entityCounts: { subjects: 1, resources: 1, relationships: 0, nativeGrants: 0 }
    });
    expect(repository.getSubject(secondSubject.id)).toBeUndefined();
    expect(repository.listBackupMetadata()).toEqual([backup]);

    const reopened = createProductionGraphRepository(store);
    expect(reopened.getSubject("user:bob")).toEqual(createSubject());
    expect(reopened.getSubject(secondSubject.id)).toBeUndefined();
  });

  it("creates backup metadata and restores connector-state snapshots from the external store", () => {
    const store = new InMemoryExternalSnapshotStore<ProductionConnectorStateStoreRecord>();
    const repository = createProductionConnectorStateRepository(store);
    const secondPlan = createProvisioningPlan({
      id: "plan:charlie-graph-plan-read",
      idempotencyKey: "idem:plan:charlie-graph-plan-read",
      subjectId: "user:charlie"
    });

    repository.recordDiscoveryRun(createDiscoveryRun());
    repository.recordEnforcementReadinessReport(createEnforcementReadinessReport());
    const backup = repository.createBackup("backup:connector-state:one", "2026-05-26T04:10:00.000Z");
    repository.upsertProvisioningPlan(secondPlan);

    expect(repository.getProvisioningPlan(secondPlan.id)).toEqual(secondPlan);
    expect(repository.restoreBackup(backup.id, "2026-05-26T04:11:00.000Z")).toMatchObject({
      backend: "external",
      location: "external://connector-state/access-kit-test",
      entityCounts: {
        discoveryRuns: 1,
        enforcementReadinessReports: 1,
        provisioningPlans: 0,
        provisioningJobs: 0,
        driftFindings: 0,
        reconciliationRuns: 0,
        decisions: 0
      }
    });
    expect(repository.getProvisioningPlan(secondPlan.id)).toBeUndefined();
    expect(repository.listBackupMetadata()).toEqual([backup]);
  });

  it("rejects cross-tenant and secret-bearing graph records before persistence", () => {
    const repository = createProductionGraphRepository();

    expect(() =>
      repository.upsertSubject(
        createSubject({
          attributes: { tenantId: "tenant:beta" }
        })
      )
    ).toThrow("crosses the configured tenant boundary");

    expect(() =>
      repository.upsertResource(
        createResource({
          attributes: { tenantId: conformanceTenant, accessToken: "token:test" }
        })
      )
    ).toThrow("contains secret material");
  });

  it("rejects cross-tenant readiness reports and secret-bearing connector-state records", () => {
    const repository = createProductionConnectorStateRepository();

    expect(() =>
      repository.recordDiscoveryRun(
        createDiscoveryRun({
          evidence: {
            readOnly: true,
            tenantBoundary: "tenant:beta"
          } as unknown as ReturnType<typeof createDiscoveryRun>["evidence"]
        })
      )
    ).toThrow("must include matching evidence.tenantBoundary");

    expect(() =>
      repository.recordEnforcementReadinessReport(
        createEnforcementReadinessReport({
          tenantBoundary: "tenant:beta"
        })
      )
    ).toThrow("crosses the configured tenant boundary");

    expect(() =>
      repository.recordDiscoveryRun(
        createDiscoveryRun({
          evidence: {
            readOnly: true,
            tenantBoundary: conformanceTenant,
            accessToken: "token:test"
          } as unknown as ReturnType<typeof createDiscoveryRun>["evidence"]
        })
      )
    ).toThrow("contains secret material");

    expect(() =>
      repository.recordDiscoveryRun(
        createDiscoveryRun({
          evidence: {
            readOnly: true,
            tenantBoundary: conformanceTenant,
            signingKey: "local-test-signing-key",
            hmac_key: "local-test-hmac-key",
            encryptionKey: "local-test-encryption-key"
          } as unknown as ReturnType<typeof createDiscoveryRun>["evidence"]
        })
      )
    ).toThrow("contains secret material");
  });

  it("rejects cross-tenant discovery evidence when loading stored connector state", () => {
    const store = new InMemoryExternalSnapshotStore<ProductionConnectorStateStoreRecord>();
    const repository = createProductionConnectorStateRepository(store);

    repository.recordDiscoveryRun(
      createDiscoveryRun({
        evidence: {
          readOnly: true,
          tenantBoundary: conformanceTenant
        } as unknown as ReturnType<typeof createDiscoveryRun>["evidence"]
      })
    );
    const stored = store.readCurrent();
    if (!stored) {
      throw new Error("Expected connector-state store to contain a snapshot.");
    }
    const jobs = {
      ...stored.jobs,
      discoveryRuns: stored.jobs.discoveryRuns.map((run) => ({
        ...run,
        evidence: {
          ...run.evidence,
          tenantBoundary: "tenant:beta"
        }
      }))
    };
    store.writeCurrent({
      ...stored,
      jobs,
      jobsHash: `sha256:${stableHash(jobs)}`
    });

    expect(() => createProductionConnectorStateRepository(store)).toThrow(
      "must include matching evidence.tenantBoundary"
    );
  });

  it("keeps connector-state persistence separate from production queue readiness descriptors", () => {
    const repository = createProductionConnectorStateRepository();

    expect(repository.describeConnectorStatePersistence()).toMatchObject({
      component: "connector_state",
      backend: "external_connector_state"
    });
    expect(repository).not.toHaveProperty("describePersistence");
  });

  it("rejects tampered external graph snapshots before serving data", () => {
    const store = new InMemoryExternalSnapshotStore<ProductionGraphStoreRecord>();
    const repository = createProductionGraphRepository(store);

    repository.upsertSubject(createSubject());
    const stored = store.readCurrent();
    if (!stored) {
      throw new Error("Expected graph store to contain a snapshot.");
    }
    stored.graph.subjects[0] = {
      ...stored.graph.subjects[0],
      displayName: "Tampered Subject"
    };
    store.writeCurrent(stored);

    expect(() => createProductionGraphRepository(store)).toThrow(
      "Production graph store hash does not match the stored graph payload."
    );
  });

  it("rejects malformed external connector-state payloads before hashing or normalizing", () => {
    const store = new InMemoryExternalSnapshotStore<ProductionConnectorStateStoreRecord>();
    const repository = createProductionConnectorStateRepository(store);

    repository.recordDiscoveryRun(createDiscoveryRun());
    const stored = store.readCurrent();
    if (!stored) {
      throw new Error("Expected connector-state store to contain a snapshot.");
    }
    (stored.jobs as { discoveryRuns: unknown }).discoveryRuns = {};
    store.writeCurrent(stored);

    expect(() => createProductionConnectorStateRepository(store)).toThrow(
      "Production connector-state store payload field discoveryRuns must be an array."
    );
  });
});

describe("production job queue adapter", () => {
  it("describes the external queue backend and passes durable job-history boundaries", () => {
    const queue = createProductionJobQueueRepository();

    expect(queue.describePersistence()).toMatchObject({
      component: "job",
      backend: "external_queue",
      durable: true,
      immutable: false,
      capabilities: ["job_enqueue", "idempotency_lookup", "transactional_writes", "backup_restore"],
      location: "external://queue/access-kit-test-jobs"
    });
    expect(queue.exportQueue()).toEqual({
      queuedJobs: [],
      connectorHealth: [],
      idempotencyRecords: []
    });
  });

  it("enqueues idempotently, rejects conflicting payloads, and keeps defensive copies", () => {
    const queue = createProductionJobQueueRepository();
    const first = queue.enqueueJob({
      kind: "discovery",
      connectorId: "mock",
      idempotencyKey: "idem:queue:discovery",
      requestedAt: conformanceNow,
      payload: { connectorId: "mock", mode: "read_only" }
    });

    expect(queue.enqueueJob({
      kind: "discovery",
      connectorId: "mock",
      idempotencyKey: "idem:queue:discovery",
      requestedAt: conformanceNow,
      payload: { connectorId: "mock", mode: "read_only" }
    })).toEqual(first);
    expect(queue.exportQueue().idempotencyRecords).toHaveLength(1);
    expect(() =>
      queue.enqueueJob({
        kind: "discovery",
        connectorId: "mock",
        idempotencyKey: "idem:queue:discovery",
        requestedAt: conformanceNow,
        payload: { connectorId: "mock", mode: "write" }
      })
    ).toThrow("was reused for a different job request");

    queue.listQueuedJobs()[0] = { ...first, status: "completed" };
    expect(queue.getQueuedJob(first.id)?.status).toBe("queued");
  });

  it("prioritizes emergency revocations even when connector health is degraded", () => {
    const queue = createProductionJobQueueRepository();
    queue.enqueueJob({
      kind: "discovery",
      connectorId: "mock",
      idempotencyKey: "idem:queue:discovery",
      requestedAt: "2026-05-26T04:00:00.000Z",
      payload: { connectorId: "mock" }
    });
    const revocation = queue.enqueueRevocationJob({
      connectorId: "mock",
      nativeGrantId: "native-grant:bob-graph-plan-read",
      idempotencyKey: "idem:queue:revocation",
      requestedAt: "2026-05-26T04:01:00.000Z"
    });

    queue.setConnectorHealth({
      connectorId: "mock",
      status: "degraded",
      updatedAt: "2026-05-26T04:02:00.000Z",
      reason: "provider_rate_limit"
    });

    expect(queue.reserveNextJob({
      workerId: "worker:one",
      reservedAt: "2026-05-26T04:03:00.000Z"
    })).toMatchObject({
      id: revocation.id,
      kind: "revocation",
      priority: "emergency",
      status: "running"
    });
    expect(queue.reserveNextJob({
      workerId: "worker:one",
      reservedAt: "2026-05-26T04:04:00.000Z"
    })).toBeUndefined();
  });

  it("uses current store state so two workers cannot reserve the same queued job", () => {
    const store = new InMemoryExternalSnapshotStore<ProductionJobQueueStoreRecord>();
    const queue = createProductionJobQueueRepository(store);
    queue.enqueueJob({
      kind: "discovery",
      connectorId: "mock",
      idempotencyKey: "idem:queue:single-reservation",
      requestedAt: "2026-05-26T04:00:00.000Z",
      payload: { connectorId: "mock" }
    });
    const firstWorker = createProductionJobQueueRepository(store);
    const secondWorker = createProductionJobQueueRepository(store);

    expect(firstWorker.reserveNextJob({
      workerId: "worker:one",
      reservedAt: "2026-05-26T04:00:01.000Z"
    })).toMatchObject({
      status: "running",
      workerId: "worker:one"
    });
    expect(secondWorker.reserveNextJob({
      workerId: "worker:two",
      reservedAt: "2026-05-26T04:00:01.000Z"
    })).toBeUndefined();
  });

  it("recovers stale running jobs after the reservation lease expires", () => {
    const queue = createProductionJobQueueRepository();
    queue.enqueueJob({
      kind: "reconciliation",
      connectorId: "mock",
      idempotencyKey: "idem:queue:lease-recovery",
      requestedAt: "2026-05-26T04:00:00.000Z",
      payload: { connectorId: "mock" }
    });

    const firstRun = queue.reserveNextJob({
      workerId: "worker:one",
      reservedAt: "2026-05-26T04:00:01.000Z",
      leaseDurationMs: 1000
    });
    expect(firstRun).toMatchObject({
      status: "running",
      workerId: "worker:one",
      leaseExpiresAt: "2026-05-26T04:00:02.000Z"
    });
    expect(queue.reserveNextJob({
      workerId: "worker:two",
      reservedAt: "2026-05-26T04:00:01.500Z"
    })).toBeUndefined();

    expect(queue.reserveNextJob({
      workerId: "worker:two",
      reservedAt: "2026-05-26T04:00:02.000Z"
    })).toMatchObject({
      status: "running",
      workerId: "worker:two",
      attempts: 2
    });
  });

  it("retries with backoff, dead-letters visible failures, and supports replay", () => {
    const queue = createProductionJobQueueRepository();
    queue.enqueueJob({
      kind: "reconciliation",
      connectorId: "mock",
      idempotencyKey: "idem:queue:reconcile",
      requestedAt: "2026-05-26T04:00:00.000Z",
      maxAttempts: 2,
      backoff: { strategy: "exponential", initialDelayMs: 1000, maxDelayMs: 1000 },
      payload: { connectorId: "mock" }
    });

    const firstRun = queue.reserveNextJob({ workerId: "worker:one", reservedAt: "2026-05-26T04:00:01.000Z" });
    if (!firstRun) {
      throw new Error("Expected first queue reservation.");
    }
    expect(firstRun.attempts).toBe(1);

    const retry = queue.recordJobFailure(firstRun.id, {
      workerId: "worker:one",
      failedAt: "2026-05-26T04:00:02.000Z",
      error: "provider unavailable"
    });
    expect(retry).toMatchObject({
      status: "queued",
      attempts: 1,
      availableAt: "2026-05-26T04:00:03.000Z"
    });
    expect(queue.reserveNextJob({ workerId: "worker:one", reservedAt: "2026-05-26T04:00:02.500Z" })).toBeUndefined();

    const secondRun = queue.reserveNextJob({ workerId: "worker:two", reservedAt: "2026-05-26T04:00:03.000Z" });
    if (!secondRun) {
      throw new Error("Expected second queue reservation.");
    }
    const deadLetter = queue.recordJobFailure(secondRun.id, {
      workerId: "worker:two",
      failedAt: "2026-05-26T04:00:04.000Z",
      error: "provider still unavailable"
    });

    expect(deadLetter.status).toBe("dead_lettered");
    expect(queue.listDeadLetteredJobs()).toEqual([deadLetter]);
    expect(queue.replayDeadLetteredJob(deadLetter.id, {
      requestedAt: "2026-05-26T04:00:05.000Z"
    })).toMatchObject({
      kind: "reconciliation",
      status: "queued",
      replayedFromJobId: deadLetter.id
    });
  });

  it("requires approval, control, and readiness evidence before enqueueing enforcement jobs", () => {
    const queue = createProductionJobQueueRepository();
    const enforcementJob = createProvisioningJob({
      id: "job:bob-graph-plan-enforce",
      idempotencyKey: "idem:job:bob-graph-plan-enforce",
      mode: "enforcement",
      dryRun: false
    });

    expect(() => queue.enqueueProvisioningJob(enforcementJob)).toThrow(
      "Production queue enforcement jobs require approval, control, and readiness evidence before enqueue."
    );
    expect(queue.listProvisioningJobs()).toEqual([]);
    expect(queue.listProvisioningPlans()).toEqual([]);
    expect(queue.exportQueue().idempotencyRecords).toEqual([]);

    const approval = {
      decision: "approved" as const,
      approverId: "user:approver",
      changeTicket: "CHG-123",
      approvedAt: conformanceNow
    };
    const control = {
      syntheticOnly: true,
      liveProviderWrites: false,
      incidentMode: false,
      breakGlass: false
    };
    const plan = createProvisioningPlan({
      id: enforcementJob.planId,
      mode: "enforcement",
      status: "approved",
      approval,
      control,
      readinessReportId: "enforcement-readiness:mock"
    });

    expect(queue.enqueueProvisioningJob(
      { ...enforcementJob, approval, control },
      { plan, requestedAt: conformanceNow }
    )).toMatchObject({
      kind: "provisioning",
      status: "queued",
      readinessReportId: "enforcement-readiness:mock"
    });
  });

  it("rejects secret-bearing queue records and tampered persisted queue snapshots", () => {
    const store = new InMemoryExternalSnapshotStore<ProductionJobQueueStoreRecord>();
    const queue = createProductionJobQueueRepository(store);

    expect(() =>
      queue.enqueueJob({
        kind: "evidence",
        connectorId: "mock",
        idempotencyKey: "idem:queue:evidence",
        requestedAt: conformanceNow,
        payload: { accessToken: "token:test" }
      })
    ).toThrow("contains secret material");

    for (const key of ["apiKey", "api_key", "clientKey", "hmacKey", "signingKey", "encryptionKey"]) {
      expect(() =>
        queue.enqueueJob({
          kind: "evidence",
          connectorId: "mock",
          idempotencyKey: `idem:queue:evidence:${key}`,
          requestedAt: conformanceNow,
          payload: { [key]: "tenant-secret" }
        })
      ).toThrow("contains secret material");
    }

    const queued = queue.enqueueJob({
      kind: "evidence",
      connectorId: "mock",
      idempotencyKey: "idem:queue:evidence",
      requestedAt: conformanceNow,
      payload: { exportId: "evidence:one" }
    });
    const stored = store.readCurrent();
    if (!stored) {
      throw new Error("Expected queue store to contain a snapshot.");
    }
    stored.queue.queuedJobs[0] = {
      ...queued,
      status: "completed"
    };
    store.writeCurrent(stored);

    expect(() => createProductionJobQueueRepository(store)).toThrow(
      "Production job queue store hash does not match the stored queue payload."
    );
  });
});

function createProductionGraphRepository(
  store = new InMemoryExternalSnapshotStore<ProductionGraphStoreRecord>()
): ProductionGraphStoreAdapter {
  return new ProductionGraphStoreAdapter({
    store,
    tenantBoundary: conformanceTenant,
    location: "external://graph/access-kit-test-graph",
    now: () => conformanceNow
  });
}

function createProductionConnectorStateRepository(
  store = new InMemoryExternalSnapshotStore<ProductionConnectorStateStoreRecord>()
): ProductionConnectorStateStoreAdapter {
  return new ProductionConnectorStateStoreAdapter({
    store,
    tenantBoundary: conformanceTenant,
    location: "external://connector-state/access-kit-test",
    now: () => conformanceNow
  });
}

function createProductionJobQueueRepository(
  store = new InMemoryExternalSnapshotStore<ProductionJobQueueStoreRecord>()
): ProductionJobQueueAdapter {
  return new ProductionJobQueueAdapter({
    store,
    tenantBoundary: conformanceTenant,
    location: "external://queue/access-kit-test-jobs",
    now: () => conformanceNow
  });
}
