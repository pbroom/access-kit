import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  AuditRecorder,
  ReferenceAuditEvidenceAdapter,
  ReferenceConnectorStateStoreAdapter,
  ReferenceGraphStoreAdapter,
  auditEventHash,
  type AuditEvent,
  type ReferenceConnectorStateStoreRecord,
  type ReferenceGraphStoreRecord
} from "../../packages/core/src/index.js";
import {
  PostgresExternalAppendOnlyAuditStore,
  PostgresExternalSnapshotStore,
  connectPostgres,
  createPostgresRuntimePersistence,
  ensureAccessKitPersistenceSchema,
  postgresPersistenceTableNames,
  type PostgresConnection,
  type PostgresQueryable
} from "../../packages/persistence-postgres/src/index.js";
import {
  conformanceNow,
  conformanceTenant,
  createDiscoveryRun,
  createEnforcementReadinessReport,
  createNativeGrant,
  createProvisioningJob,
  createProvisioningPlan,
  createRelationship,
  createResource,
  createSubject
} from "./repository-conformance.js";

const databaseUrl = process.env.REBAC_TEST_DATABASE_URL;
const signingKeyMaterial = "postgres-test-signing-key-material";

describe.skipIf(!databaseUrl)("PostgreSQL persistence backend (REBAC_TEST_DATABASE_URL)", () => {
  let connection: PostgresConnection;
  let db: PostgresQueryable;

  beforeAll(async () => {
    connection = connectPostgres(databaseUrl as string);
    db = connection.db;
    await ensureAccessKitPersistenceSchema(db);
  });

  beforeEach(async () => {
    await db.query(
      `TRUNCATE ${Object.values(postgresPersistenceTableNames).join(", ")}`
    );
  });

  afterAll(async () => {
    await connection.close();
  });

  it("persists graph facts, filters, deletes, defensive copies, and reloads across store instances", async () => {
    const store = await createGraphStore(db);
    const repository = createGraphRepository(store);
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

    repository.listSubjects()[0] = { ...subject, displayName: "Mutated Outside Repository" };
    expect(repository.getSubject(subject.id)?.displayName).toBe(subject.displayName);

    expect(repository.deleteRelationship(relationship.id, deletedAt)).toMatchObject({
      id: relationship.id,
      status: "deleted",
      updatedAt: deletedAt
    });
    await store.waitForPendingWrites();

    const reopened = createGraphRepository(await createGraphStore(db));
    expect(reopened.getSubject(subject.id)).toEqual(subject);
    expect(reopened.getResource(resource.id)).toEqual(resource);
    expect(reopened.getRelationship(relationship.id)).toMatchObject({ status: "deleted", updatedAt: deletedAt });
    expect(reopened.listNativeGrants()).toEqual([nativeGrant]);
  });

  it("isolates snapshot state and backup identifiers across tenant boundaries", async () => {
    const secondTenant = "tenant:postgres-secondary";
    const firstStore = await PostgresExternalSnapshotStore.create<ReferenceGraphStoreRecord>({
      db,
      tenantBoundary: conformanceTenant,
      storeName: "graph"
    });
    const secondStore = await PostgresExternalSnapshotStore.create<ReferenceGraphStoreRecord>({
      db,
      tenantBoundary: secondTenant,
      storeName: "graph"
    });
    const firstRecord = emptyGraphRecord(conformanceTenant, "sha256:first");
    const secondRecord = emptyGraphRecord(secondTenant, "sha256:second");

    firstStore.writeCurrent(firstRecord);
    firstStore.writeBackup("backup:shared", firstRecord);
    secondStore.writeCurrent(secondRecord);
    secondStore.writeBackup("backup:shared", secondRecord);
    await Promise.all([firstStore.waitForPendingWrites(), secondStore.waitForPendingWrites()]);

    const reopenedFirst = await PostgresExternalSnapshotStore.create<ReferenceGraphStoreRecord>({
      db,
      tenantBoundary: conformanceTenant,
      storeName: "graph"
    });
    const reopenedSecond = await PostgresExternalSnapshotStore.create<ReferenceGraphStoreRecord>({
      db,
      tenantBoundary: secondTenant,
      storeName: "graph"
    });
    expect(reopenedFirst.readCurrent()).toEqual(firstRecord);
    expect(reopenedFirst.readBackup("backup:shared")).toEqual(firstRecord);
    expect(reopenedSecond.readCurrent()).toEqual(secondRecord);
    expect(reopenedSecond.readBackup("backup:shared")).toEqual(secondRecord);
  });

  it("creates graph backups and restores them across store instances", async () => {
    const store = await createGraphStore(db);
    const repository = createGraphRepository(store);
    const secondSubject = createSubject({
      id: "user:charlie",
      displayName: "Charlie Example",
      identifiers: { email: "charlie@example.invalid" }
    });

    repository.upsertSubject(createSubject());
    repository.upsertResource(createResource());
    const backup = repository.createBackup("backup:graph:one", "2026-05-26T04:10:00.000Z");
    repository.upsertSubject(secondSubject);
    await store.waitForPendingWrites();

    const reopened = createGraphRepository(await createGraphStore(db));
    expect(reopened.getSubject(secondSubject.id)).toEqual(secondSubject);
    expect(reopened.restoreBackup(backup.id, "2026-05-26T04:11:00.000Z")).toMatchObject({
      backend: "external",
      entityCounts: { subjects: 1, resources: 1, relationships: 0, nativeGrants: 0 }
    });
    expect(reopened.getSubject(secondSubject.id)).toBeUndefined();
    expect(reopened.listBackupMetadata()).toEqual([backup]);
  });

  it("persists connector state, idempotency lookups, and duplicate-run rejection across store instances", async () => {
    const store = await createConnectorStateStore(db);
    const repository = createConnectorStateRepository(store);
    const discoveryRun = createDiscoveryRun();
    const readinessReport = createEnforcementReadinessReport();
    const plan = createProvisioningPlan();
    const job = createProvisioningJob();

    repository.recordDiscoveryRun(discoveryRun);
    repository.recordEnforcementReadinessReport(readinessReport);
    repository.upsertProvisioningPlan(plan);
    repository.upsertProvisioningJob(job);

    expect(repository.listDiscoveryRuns({ connectorId: "mock", status: "completed" })).toEqual([discoveryRun]);
    expect(repository.getEnforcementReadinessReport(readinessReport.id)).toEqual(readinessReport);
    expect(repository.getProvisioningPlanByIdempotencyKey(plan.idempotencyKey as string)).toEqual(plan);
    expect(repository.getProvisioningJobByIdempotencyKey(job.idempotencyKey as string)).toEqual(job);
    expect(() => repository.recordDiscoveryRun({ ...discoveryRun, status: "failed" })).toThrow(
      `Discovery run ${discoveryRun.id} has already been recorded.`
    );
    await store.waitForPendingWrites();

    const reopened = createConnectorStateRepository(await createConnectorStateStore(db));
    expect(reopened.listDiscoveryRuns()).toEqual([discoveryRun]);
    expect(reopened.getProvisioningPlanByIdempotencyKey(plan.idempotencyKey as string)).toEqual(plan);
    expect(() => reopened.recordEnforcementReadinessReport({ ...readinessReport, status: "ready" })).toThrow(
      `Enforcement readiness report ${readinessReport.id} has already been recorded.`
    );
  });

  it("surfaces compare-exchange write conflicts between two snapshot store instances", async () => {
    const firstStore = await createGraphStore(db);
    const secondStore = await createGraphStore(db);
    const firstRepository = createGraphRepository(firstStore);
    createGraphRepository(secondStore);

    firstRepository.upsertSubject(createSubject());
    await firstStore.waitForPendingWrites();

    const staleRecord = secondStore.readCurrent();
    expect(secondStore.compareExchangeCurrent(staleRecord, {
      version: "production-graph-store:v1",
      storedAt: conformanceNow,
      tenantBoundary: conformanceTenant,
      graphHash: "sha256:stale",
      graph: { subjects: [], resources: [], relationships: [], nativeGrants: [] },
      entityCounts: { subjects: 0, resources: 0, relationships: 0, nativeGrants: 0 },
      backupMetadata: []
    })).toBe(true);

    await expect(secondStore.waitForPendingWrites()).rejects.toThrow(
      "Another writer has persisted a conflicting update."
    );
  });

  it("appends audit events with hash-chain integrity and reloads with verified sequence continuity", async () => {
    const store = await createAuditStore(db);
    const repository = createAuditRepository(store);
    const [firstEvent, secondEvent] = createAuditEvents();

    expect(repository.appendAuditEvent(firstEvent, conformanceNow)).toMatchObject({
      sequence: 1,
      eventHash: auditEventHash(firstEvent),
      backend: "external",
      immutable: true
    });
    expect(repository.appendAuditEvent(secondEvent, "2026-05-26T04:01:00.000Z")).toMatchObject({
      sequence: 2,
      previousEventHash: auditEventHash(firstEvent)
    });
    const backup = repository.createBackup("backup:audit:one", "2026-05-26T04:02:00.000Z");
    const thirdEvent = createNextEvent([firstEvent, secondEvent], "audit.integrity_verified", "2026-05-26T04:03:00.000Z");
    repository.appendAuditEvent(thirdEvent, "2026-05-26T04:03:00.000Z");
    await store.waitForPendingWrites();

    const reopenedStore = await createAuditStore(db);
    const reopened = createAuditRepository(reopenedStore);
    expect(reopened.listAuditEvents()).toEqual([firstEvent, secondEvent, thirdEvent]);
    expect(reopened.verifyIntegrity("2026-05-26T04:04:00.000Z")).toMatchObject({
      status: "verified",
      eventCount: 3,
      findings: []
    });

    const restoreReceipt = reopened.restoreBackup(backup.id, "2026-05-26T04:05:00.000Z");
    expect(restoreReceipt).toMatchObject({ backupId: backup.id, eventCount: 2 });
    await reopenedStore.waitForPendingWrites();

    const restored = createAuditRepository(await createAuditStore(db));
    expect(restored.listAuditEvents()).toEqual([firstEvent, secondEvent]);
  });

  it("rejects direct UPDATE and DELETE against audit rows at the database level", async () => {
    const store = await createAuditStore(db);
    const repository = createAuditRepository(store);
    const [firstEvent] = createAuditEvents();

    repository.appendAuditEvent(firstEvent, conformanceNow);
    await store.waitForPendingWrites();

    await expect(
      db.query(`UPDATE ${postgresPersistenceTableNames.auditRecords} SET record_hash = 'tampered'`)
    ).rejects.toThrow(/append-only/);
    await expect(
      db.query(`DELETE FROM ${postgresPersistenceTableNames.auditRecords}`)
    ).rejects.toThrow(/append-only/);
  });

  it("fails sequence continuity verification when stored audit sequences have gaps", async () => {
    await db.query(
      `INSERT INTO ${postgresPersistenceTableNames.auditRecords} (tenant_boundary, sequence, event_id, record, record_hash, stored_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        conformanceTenant,
        5,
        "evt:gap",
        { version: "production-audit-event-record:v1", sequence: 5, event: { eventId: "evt:gap" } },
        "sha256:gap",
        conformanceNow
      ]
    );

    await expect(createAuditStore(db)).rejects.toThrow(
      "Postgres audit store sequence continuity check failed"
    );
  });

  it("claims durable external descriptors only through the connected runtime bundle", async () => {
    const bundle = await createPostgresRuntimePersistence({
      databaseUrl: databaseUrl as string,
      tenantBoundary: conformanceTenant,
      auditSigningKeyMaterial: signingKeyMaterial,
      now: () => conformanceNow
    });

    try {
      expect(bundle.graphRepository.describePersistence()).toMatchObject({
        component: "graph",
        backend: "external_graph",
        durable: true,
        location: "postgres://graph"
      });
      expect(bundle.jobRepository.describeConnectorStatePersistence()).toMatchObject({
        component: "connector_state",
        backend: "external_connector_state",
        durable: true,
        location: "postgres://connector-state"
      });
      expect(bundle.auditRepository.describePersistence()).toMatchObject({
        component: "audit",
        backend: "external_append_only_audit",
        durable: true,
        immutable: true,
        location: "postgres://audit"
      });

      bundle.graphRepository.upsertSubject(createSubject());
      await bundle.waitForPendingWrites();
    } finally {
      await bundle.close();
    }
  });
});

async function createGraphStore(db: PostgresQueryable): Promise<PostgresExternalSnapshotStore<ReferenceGraphStoreRecord>> {
  return PostgresExternalSnapshotStore.create<ReferenceGraphStoreRecord>({
    db,
    tenantBoundary: conformanceTenant,
    storeName: "graph"
  });
}

async function createConnectorStateStore(
  db: PostgresQueryable
): Promise<PostgresExternalSnapshotStore<ReferenceConnectorStateStoreRecord>> {
  return PostgresExternalSnapshotStore.create<ReferenceConnectorStateStoreRecord>({
    db,
    tenantBoundary: conformanceTenant,
    storeName: "connector_state"
  });
}

async function createAuditStore(db: PostgresQueryable): Promise<PostgresExternalAppendOnlyAuditStore> {
  return PostgresExternalAppendOnlyAuditStore.create({ db, tenantBoundary: conformanceTenant });
}

function createGraphRepository(
  store: PostgresExternalSnapshotStore<ReferenceGraphStoreRecord>
): ReferenceGraphStoreAdapter {
  return new ReferenceGraphStoreAdapter({
    store,
    tenantBoundary: conformanceTenant,
    location: "postgres://graph/access-kit-test",
    now: () => conformanceNow
  });
}

function createConnectorStateRepository(
  store: PostgresExternalSnapshotStore<ReferenceConnectorStateStoreRecord>
): ReferenceConnectorStateStoreAdapter {
  return new ReferenceConnectorStateStoreAdapter({
    store,
    tenantBoundary: conformanceTenant,
    location: "postgres://connector-state/access-kit-test",
    now: () => conformanceNow
  });
}

function createAuditRepository(store: PostgresExternalAppendOnlyAuditStore): ReferenceAuditEvidenceAdapter {
  return new ReferenceAuditEvidenceAdapter({
    store,
    tenantBoundary: conformanceTenant,
    location: "postgres://audit/access-kit-test",
    signingKeyMaterial,
    now: () => conformanceNow
  });
}

function createAuditEvents(): [AuditEvent, AuditEvent] {
  const recorder = new AuditRecorder();
  const firstEvent = recorder.record(
    {
      eventType: "decision.allowed",
      actor: "service:api",
      subjectId: "user:bob",
      resourceId: "document:graph-plan",
      correlationId: "corr:decision:postgres-one",
      payload: { subjectId: "user:bob", resourceId: "document:graph-plan", decision: "allow" }
    },
    conformanceNow
  );
  const secondEvent = recorder.record(
    {
      eventType: "audit.exported",
      actor: "service:api",
      correlationId: "corr:audit-export:postgres-one",
      payload: { exportId: "audit-export:postgres-one", target: "siem_forwarder" }
    },
    "2026-05-26T04:01:00.000Z"
  );

  return [firstEvent, secondEvent];
}

function emptyGraphRecord(tenantBoundary: string, graphHash: string): ReferenceGraphStoreRecord {
  return {
    version: "production-graph-store:v1",
    storedAt: conformanceNow,
    tenantBoundary,
    graphHash,
    graph: { subjects: [], resources: [], relationships: [], nativeGrants: [] },
    entityCounts: { subjects: 0, resources: 0, relationships: 0, nativeGrants: 0 },
    backupMetadata: []
  };
}

function createNextEvent(seedEvents: AuditEvent[], eventType: string, occurredAt: string): AuditEvent {
  return new AuditRecorder(seedEvents).record(
    {
      eventType,
      actor: "service:api",
      correlationId: `corr:${eventType}:${occurredAt}`,
      payload: { result: "ok" }
    },
    occurredAt
  );
}
