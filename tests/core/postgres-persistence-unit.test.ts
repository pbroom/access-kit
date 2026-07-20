import { describe, expect, it } from "vitest";
import type {
  ProductionAuditEventStoreRecord,
  ProductionAuditStoreBackup,
  ProductionGraphStoreRecord
} from "../../packages/core/src/index.js";
import {
  PostgresExternalAppendOnlyAuditStore,
  PostgresExternalSnapshotStore,
  appendOnlyRestoreBypassStatement,
  assertPostgresAuditSigningKeyMaterial,
  assertPostgresDatabaseUrl,
  assertPostgresPersistenceConfig,
  assertPostgresTenantBoundary,
  ensureAccessKitPersistenceSchema,
  postgresPersistenceTableNames,
  stablePostgresHash,
  stablePostgresStringify,
  type PostgresQueryResult,
  type PostgresQueryable
} from "../../packages/persistence-postgres/src/index.js";
import { conformanceNow, conformanceTenant } from "./repository-conformance.js";

interface RecordedQuery {
  text: string;
  params?: readonly unknown[];
}

class RecordingQueryable implements PostgresQueryable {
  readonly queries: RecordedQuery[] = [];
  rowsByPattern: Array<{ pattern: RegExp; rows: unknown[] }> = [];
  failOnPattern?: { pattern: RegExp; error: Error };

  async query<TRow = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<PostgresQueryResult<TRow>> {
    this.queries.push({ text, params });

    if (this.failOnPattern?.pattern.test(text)) {
      throw this.failOnPattern.error;
    }

    const match = this.rowsByPattern.find((entry) => entry.pattern.test(text));
    const rows = (match?.rows ?? []) as TRow[];
    return { rows, rowCount: rows.length };
  }

  withTransaction<TResult>(fn: (tx: PostgresQueryable) => Promise<TResult>): Promise<TResult> {
    return fn(this);
  }
}

describe("postgres persistence config parsing", () => {
  it("accepts postgres and postgresql connection URL schemes", () => {
    expect(() => assertPostgresDatabaseUrl("postgres://user:pass@localhost:5432/access_kit")).not.toThrow();
    expect(() => assertPostgresDatabaseUrl("postgresql://user:pass@localhost:5432/access_kit")).not.toThrow();
  });

  it("rejects malformed or non-postgres connection URLs", () => {
    expect(() => assertPostgresDatabaseUrl("not a url")).toThrow(
      "REBAC_DATABASE_URL must be a valid PostgreSQL connection URL."
    );
    expect(() => assertPostgresDatabaseUrl("mysql://user:pass@localhost:3306/access_kit")).toThrow(
      'REBAC_DATABASE_URL must use the "postgres://" or "postgresql://" scheme.'
    );
  });

  it("requires a non-empty tenant boundary and long-enough audit signing key", () => {
    expect(() => assertPostgresTenantBoundary("  ")).toThrow(
      "REBAC_DATABASE_TENANT_BOUNDARY is required when REBAC_DATABASE_URL is set."
    );
    expect(() => assertPostgresAuditSigningKeyMaterial("short")).toThrow(
      "REBAC_DATABASE_AUDIT_SIGNING_KEY must be at least 32 characters when REBAC_DATABASE_URL is set."
    );
    expect(() =>
      assertPostgresPersistenceConfig({
        databaseUrl: "postgres://user:pass@localhost:5432/access_kit",
        tenantBoundary: conformanceTenant,
        auditSigningKeyMaterial: "a".repeat(32)
      })
    ).not.toThrow();
  });
});

describe("postgres persistence schema bootstrap SQL shaping", () => {
  it("creates every table with tenant-scoped keys and append-only triggers", async () => {
    const db = new RecordingQueryable();

    await ensureAccessKitPersistenceSchema(db);

    const statements = db.queries.map((query) => query.text);
    for (const tableName of Object.values(postgresPersistenceTableNames)) {
      expect(statements.some((statement) => statement.includes(`CREATE TABLE IF NOT EXISTS ${tableName}`))).toBe(true);
    }
    expect(statements.some((statement) => statement.includes("CREATE OR REPLACE FUNCTION access_kit_forbid_audit_mutation"))).toBe(true);
    for (const tableName of [
      postgresPersistenceTableNames.auditRecords,
      postgresPersistenceTableNames.auditEvidenceRecords,
      postgresPersistenceTableNames.auditSignedWindows,
      postgresPersistenceTableNames.auditSiemDeliveries
    ]) {
      expect(
        statements.some((statement) => statement.includes(`CREATE OR REPLACE TRIGGER ${tableName}_append_only`))
      ).toBe(true);
    }
    expect(statements).toEqual(expect.arrayContaining([
      expect.stringContaining("PRIMARY KEY (tenant_boundary, store_name)"),
      expect.stringContaining("PRIMARY KEY (tenant_boundary, store_name, backup_id)"),
      expect.stringContaining("PRIMARY KEY (tenant_boundary, sequence)"),
      expect.stringContaining("UNIQUE (tenant_boundary, event_id)"),
      expect.stringContaining("PRIMARY KEY (tenant_boundary, backup_id)")
    ]));
    expect(appendOnlyRestoreBypassStatement()).toBe("SET LOCAL access_kit.allow_audit_restore = 'true'");
  });
});

describe("postgres snapshot store SQL shaping", () => {
  it("persists current snapshots through parameterized upserts and backups through insert-or-replace", async () => {
    const db = new RecordingQueryable();
    const store = await PostgresExternalSnapshotStore.create<ProductionGraphStoreRecord>({
      db,
      tenantBoundary: conformanceTenant,
      storeName: "graph"
    });
    const record = graphRecord();

    store.writeCurrent(record);
    store.writeBackup("backup:graph:one", record);
    await store.waitForPendingWrites();

    const writes = db.queries.filter((query) => query.text.includes("INSERT INTO"));
    expect(writes).toHaveLength(2);
    expect(writes[0]?.text).toContain(`INSERT INTO ${postgresPersistenceTableNames.snapshotCurrent}`);
    expect(writes[0]?.text).toContain("ON CONFLICT (tenant_boundary, store_name) DO UPDATE");
    expect(writes[0]?.params).toEqual([conformanceTenant, "graph", record, stablePostgresHash(record)]);
    expect(writes[1]?.text).toContain(`INSERT INTO ${postgresPersistenceTableNames.snapshotBackup}`);
    expect(writes[1]?.text).toContain("ON CONFLICT (tenant_boundary, store_name, backup_id) DO UPDATE");
    expect(writes[1]?.params).toEqual([
      conformanceTenant,
      "graph",
      "backup:graph:one",
      record,
      stablePostgresHash(record)
    ]);
  });

  it("issues conditional compare-exchange writes guarded by the stored record hash", async () => {
    const db = new RecordingQueryable();
    db.rowsByPattern = [{ pattern: /RETURNING store_name/, rows: [{ store_name: "graph" }] }];
    const store = await PostgresExternalSnapshotStore.create<ProductionGraphStoreRecord>({
      db,
      tenantBoundary: conformanceTenant,
      storeName: "graph"
    });
    const first = graphRecord();
    const second = { ...graphRecord(), storedAt: "2026-05-26T04:05:00.000Z" };

    expect(store.compareExchangeCurrent(undefined, first)).toBe(true);
    expect(store.compareExchangeCurrent(first, second)).toBe(true);
    expect(store.compareExchangeCurrent(first, second)).toBe(false);
    await store.waitForPendingWrites();

    const conditionalWrites = db.queries.filter((query) => query.text.includes("RETURNING store_name"));
    expect(conditionalWrites).toHaveLength(2);
    expect(conditionalWrites[0]?.text).toContain("ON CONFLICT (tenant_boundary, store_name) DO NOTHING");
    expect(conditionalWrites[0]?.params).toEqual([
      conformanceTenant,
      "graph",
      first,
      stablePostgresHash(first)
    ]);
    expect(conditionalWrites[1]?.text).toContain("WHERE tenant_boundary = $1 AND store_name = $2 AND record_hash = $5");
    expect(conditionalWrites[1]?.params).toEqual([
      conformanceTenant,
      "graph",
      second,
      stablePostgresHash(second),
      stablePostgresHash(first)
    ]);
  });

  it("rejects stale compare-exchange writes instead of inserting a missing row", async () => {
    const db = new RecordingQueryable();
    db.rowsByPattern = [{ pattern: /FROM access_kit_snapshot_current/, rows: [{ record: graphRecord() }] }];
    const store = await PostgresExternalSnapshotStore.create<ProductionGraphStoreRecord>({
      db,
      tenantBoundary: conformanceTenant,
      storeName: "graph"
    });
    const expected = store.readCurrent();
    const replacement = { ...graphRecord(), storedAt: "2026-05-26T04:05:00.000Z" };

    expect(store.compareExchangeCurrent(expected, replacement)).toBe(true);
    await expect(store.waitForPendingWrites()).rejects.toThrow("Another writer has persisted a conflicting update.");

    const write = db.queries.find((query) => query.text.startsWith("UPDATE access_kit_snapshot_current"));
    expect(write?.text).not.toContain("INSERT INTO");
    expect(write?.params?.[4]).toBe(stablePostgresHash(expected));
  });

  it("rejects a compare-exchange create when another writer wins the insert race", async () => {
    const db = new RecordingQueryable();
    const store = await PostgresExternalSnapshotStore.create<ProductionGraphStoreRecord>({
      db,
      tenantBoundary: conformanceTenant,
      storeName: "graph"
    });

    expect(store.compareExchangeCurrent(undefined, graphRecord())).toBe(true);
    await expect(store.waitForPendingWrites()).rejects.toThrow("Another writer has persisted a conflicting update.");

    const write = db.queries.find((query) => query.text.includes("RETURNING store_name"));
    expect(write?.text).toContain("ON CONFLICT (tenant_boundary, store_name) DO NOTHING");
  });

  it("returns defensive copies and surfaces queued write failures on waitForPendingWrites", async () => {
    const db = new RecordingQueryable();
    const store = await PostgresExternalSnapshotStore.create<ProductionGraphStoreRecord>({
      db,
      tenantBoundary: conformanceTenant,
      storeName: "graph"
    });
    const record = graphRecord();
    db.failOnPattern = { pattern: /INSERT INTO access_kit_snapshot_current/, error: new Error("connection reset") };

    store.writeCurrent(record);
    const readBack = store.readCurrent();
    expect(readBack).toEqual(record);
    expect(readBack).not.toBe(record);

    await expect(store.waitForPendingWrites()).rejects.toThrow("connection reset");
    db.failOnPattern = undefined;
    store.writeBackup("backup:after-failure", record);
    await expect(store.waitForPendingWrites()).rejects.toThrow("connection reset");
    expect(db.queries.some((query) => query.text.includes("INSERT INTO access_kit_snapshot_backup"))).toBe(false);
  });
});

describe("postgres append-only audit store semantics", () => {
  it("only issues INSERT statements for audit appends and rejects duplicate identifiers", async () => {
    const db = new RecordingQueryable();
    const store = await PostgresExternalAppendOnlyAuditStore.create({ db, tenantBoundary: conformanceTenant });
    const record = auditRecord(1, "evt:one");

    store.appendAuditRecord(record);
    expect(() => store.appendAuditRecord(record)).toThrow("has already been appended");
    await store.waitForPendingWrites();

    const writes = db.queries.filter((query) => !query.text.trimStart().startsWith("SELECT"));
    expect(writes).toHaveLength(1);
    expect(writes[0]?.text).toContain(`INSERT INTO ${postgresPersistenceTableNames.auditRecords}`);
    expect(writes[0]?.text).not.toMatch(/UPDATE|DELETE/);
    expect(writes[0]?.params).toEqual([
      conformanceTenant,
      1,
      "evt:one",
      record,
      record.recordHash,
      record.storedAt
    ]);
  });

  it("scopes audit backup upserts to the tenant boundary", async () => {
    const db = new RecordingQueryable();
    const store = await PostgresExternalAppendOnlyAuditStore.create({ db, tenantBoundary: conformanceTenant });
    const backup = auditBackup("backup:audit:one");

    store.writeBackup(backup.id, backup);
    await store.waitForPendingWrites();

    const write = db.queries.find((query) => query.text.includes("INSERT INTO access_kit_audit_backups"));
    expect(write?.text).toContain("ON CONFLICT (tenant_boundary, backup_id) DO UPDATE");
    expect(write?.params).toEqual([conformanceTenant, backup.id, backup, backup.createdAt]);
  });

  it("verifies sequence continuity when hydrating and when reading audit records", async () => {
    const db = new RecordingQueryable();
    db.rowsByPattern = [
      {
        pattern: /FROM access_kit_audit_records/,
        rows: [{ record: auditRecord(1, "evt:one") }, { record: auditRecord(3, "evt:three") }]
      }
    ];

    await expect(PostgresExternalAppendOnlyAuditStore.create({ db, tenantBoundary: conformanceTenant })).rejects.toThrow(
      "Postgres audit store sequence continuity check failed: expected sequence 2 but found 3 for event evt:three."
    );
  });

  it("stops issuing audit writes after the first queued persistence failure", async () => {
    const db = new RecordingQueryable();
    const store = await PostgresExternalAppendOnlyAuditStore.create({ db, tenantBoundary: conformanceTenant });
    db.failOnPattern = { pattern: /INSERT INTO access_kit_audit_records/, error: new Error("audit unavailable") };

    store.appendAuditRecord(auditRecord(1, "evt:one"));
    store.appendAuditRecord(auditRecord(2, "evt:two"));

    await expect(store.waitForPendingWrites()).rejects.toThrow("audit unavailable");
    expect(db.queries.filter((query) => query.text.includes("INSERT INTO access_kit_audit_records"))).toHaveLength(1);
  });

  it("restores snapshots inside a transaction that explicitly bypasses the append-only guard", async () => {
    const db = new RecordingQueryable();
    const store = await PostgresExternalAppendOnlyAuditStore.create({ db, tenantBoundary: conformanceTenant });

    store.restoreSnapshot({
      auditRecords: [auditRecord(1, "evt:one")],
      evidenceRecords: [],
      signedWindows: [],
      siemDeliveries: [],
      backupMetadata: []
    });
    await store.waitForPendingWrites();

    const statements = db.queries.map((query) => query.text);
    expect(statements).toContain(appendOnlyRestoreBypassStatement());
    const bypassIndex = statements.indexOf(appendOnlyRestoreBypassStatement());
    const deleteIndexes = statements.flatMap((statement, index) => (statement.startsWith("DELETE FROM") ? [index] : []));
    expect(deleteIndexes.length).toBeGreaterThan(0);
    expect(Math.min(...deleteIndexes)).toBeGreaterThan(bypassIndex);
  });
});

describe("postgres stable hashing", () => {
  it("hashes key order independently and deterministically", () => {
    expect(stablePostgresHash({ a: 1, b: [{ d: 2, c: 3 }] })).toBe(stablePostgresHash({ b: [{ c: 3, d: 2 }], a: 1 }));
    expect(stablePostgresStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });
});

function graphRecord(): ProductionGraphStoreRecord {
  return {
    version: "production-graph-store:v1",
    storedAt: conformanceNow,
    tenantBoundary: conformanceTenant,
    graphHash: "sha256:empty",
    graph: { subjects: [], resources: [], relationships: [], nativeGrants: [] },
    entityCounts: { subjects: 0, resources: 0, relationships: 0, nativeGrants: 0 },
    backupMetadata: []
  };
}

function auditRecord(sequence: number, eventId: string): ProductionAuditEventStoreRecord {
  return {
    version: "production-audit-event-record:v1",
    tenantBoundary: conformanceTenant,
    sequence,
    storedAt: conformanceNow,
    eventHash: `sha256:${eventId}`,
    retentionPolicy: {
      policyId: "retention:audit:default",
      retentionDays: 2555,
      legalHold: false,
      version: "production-audit-retention-policy:v1"
    },
    event: {
      eventId,
      eventType: "decision.allowed",
      occurredAt: conformanceNow,
      actor: "service:api",
      correlationId: `corr:${eventId}`,
      payload: {},
      payloadHash: `sha256:${eventId}`
    },
    recordHash: `sha256:record:${eventId}`
  };
}

function auditBackup(id: string): ProductionAuditStoreBackup {
  return {
    version: "production-audit-store-backup:v1",
    id,
    tenantBoundary: conformanceTenant,
    createdAt: conformanceNow,
    auditRecords: [],
    evidenceRecords: [],
    signedWindows: [],
    siemDeliveries: [],
    backupMetadata: [],
    backupHash: "sha256:backup"
  };
}
