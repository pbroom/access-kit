import type { PostgresQueryable } from "./types.js";

export const postgresPersistenceTableNames = {
  snapshotCurrent: "access_kit_snapshot_current",
  snapshotBackup: "access_kit_snapshot_backup",
  auditRecords: "access_kit_audit_records",
  auditEvidenceRecords: "access_kit_audit_evidence_records",
  auditSignedWindows: "access_kit_audit_signed_windows",
  auditSiemDeliveries: "access_kit_audit_siem_deliveries",
  auditBackupMetadata: "access_kit_audit_backup_metadata",
  auditBackups: "access_kit_audit_backups"
} as const;

const appendOnlyGuardFunction = "access_kit_forbid_audit_mutation";
const appendOnlyGuardBypassSetting = "access_kit.allow_audit_restore";

const bootstrapStatements: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS ${postgresPersistenceTableNames.snapshotCurrent} (
    store_name text PRIMARY KEY,
    record jsonb NOT NULL,
    record_hash text NOT NULL,
    updated_at timestamptz NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ${postgresPersistenceTableNames.snapshotBackup} (
    store_name text NOT NULL,
    backup_id text NOT NULL,
    record jsonb NOT NULL,
    record_hash text NOT NULL,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (store_name, backup_id)
  )`,
  `CREATE INDEX IF NOT EXISTS ${postgresPersistenceTableNames.snapshotBackup}_store_name_idx
    ON ${postgresPersistenceTableNames.snapshotBackup} (store_name)`,
  `CREATE TABLE IF NOT EXISTS ${postgresPersistenceTableNames.auditRecords} (
    tenant_boundary text NOT NULL,
    sequence bigint PRIMARY KEY,
    event_id text NOT NULL UNIQUE,
    record jsonb NOT NULL,
    record_hash text NOT NULL,
    stored_at timestamptz NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS ${postgresPersistenceTableNames.auditRecords}_tenant_boundary_idx
    ON ${postgresPersistenceTableNames.auditRecords} (tenant_boundary)`,
  `CREATE TABLE IF NOT EXISTS ${postgresPersistenceTableNames.auditEvidenceRecords} (
    tenant_boundary text NOT NULL,
    export_id text PRIMARY KEY,
    record jsonb NOT NULL,
    stored_at timestamptz NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS ${postgresPersistenceTableNames.auditEvidenceRecords}_tenant_boundary_idx
    ON ${postgresPersistenceTableNames.auditEvidenceRecords} (tenant_boundary)`,
  `CREATE TABLE IF NOT EXISTS ${postgresPersistenceTableNames.auditSignedWindows} (
    tenant_boundary text NOT NULL,
    window_id text PRIMARY KEY,
    record jsonb NOT NULL,
    signed_at timestamptz NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS ${postgresPersistenceTableNames.auditSignedWindows}_tenant_boundary_idx
    ON ${postgresPersistenceTableNames.auditSignedWindows} (tenant_boundary)`,
  `CREATE TABLE IF NOT EXISTS ${postgresPersistenceTableNames.auditSiemDeliveries} (
    tenant_boundary text NOT NULL,
    delivery_id text PRIMARY KEY,
    window_id text NOT NULL,
    record jsonb NOT NULL,
    attempted_at timestamptz NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS ${postgresPersistenceTableNames.auditSiemDeliveries}_window_id_idx
    ON ${postgresPersistenceTableNames.auditSiemDeliveries} (window_id)`,
  `CREATE TABLE IF NOT EXISTS ${postgresPersistenceTableNames.auditBackupMetadata} (
    tenant_boundary text PRIMARY KEY,
    metadata jsonb NOT NULL,
    updated_at timestamptz NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ${postgresPersistenceTableNames.auditBackups} (
    tenant_boundary text NOT NULL,
    backup_id text PRIMARY KEY,
    record jsonb NOT NULL,
    created_at timestamptz NOT NULL
  )`,
  `CREATE OR REPLACE FUNCTION ${appendOnlyGuardFunction}() RETURNS trigger AS $$
  BEGIN
    IF current_setting('${appendOnlyGuardBypassSetting}', true) = 'true' THEN
      RETURN COALESCE(NEW, OLD);
    END IF;

    RAISE EXCEPTION 'access_kit audit tables are append-only; % is not permitted on %', TG_OP, TG_TABLE_NAME;
  END;
  $$ LANGUAGE plpgsql`,
  ...[
    postgresPersistenceTableNames.auditRecords,
    postgresPersistenceTableNames.auditEvidenceRecords,
    postgresPersistenceTableNames.auditSignedWindows,
    postgresPersistenceTableNames.auditSiemDeliveries
  ].map(
    (tableName) => `CREATE OR REPLACE TRIGGER ${tableName}_append_only
      BEFORE UPDATE OR DELETE ON ${tableName}
      FOR EACH ROW EXECUTE FUNCTION ${appendOnlyGuardFunction}()`
  )
];

export async function ensureAccessKitPersistenceSchema(db: PostgresQueryable): Promise<void> {
  for (const statement of bootstrapStatements) {
    await db.query(statement);
  }
}

export function appendOnlyRestoreBypassStatement(): string {
  return `SET LOCAL ${appendOnlyGuardBypassSetting} = 'true'`;
}
