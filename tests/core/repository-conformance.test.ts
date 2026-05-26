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
  type ProductionConnectorStateStoreRecord,
  type ProductionGraphStoreRecord
} from "../../packages/core/src/index.js";
import {
  conformanceNow,
  conformanceTenant,
  createDiscoveryRun,
  createEnforcementReadinessReport,
  createProvisioningPlan,
  createResource,
  createSubject,
  describeConnectorStateRepositoryConformance,
  describeGraphRepositoryConformance
} from "./repository-conformance.js";

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
