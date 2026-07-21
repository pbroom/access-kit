import type {
  CanonicalId,
  ExternalAppendOnlyAuditStore,
  ProductionAuditEventStoreRecord,
  ProductionAuditStoreBackup,
  ProductionEvidenceStoreRecord,
  ProductionRepositoryBackupMetadata,
  ProductionSiemDeliveryRecord,
  ProductionSignedAuditWindow
} from "@access-kit/core";
import { appendOnlyRestoreBypassStatement, postgresPersistenceTableNames } from "./schema.js";
import type { PostgresQueryable } from "./types.js";

export interface PostgresAppendOnlyAuditStoreOptions {
  db: PostgresQueryable;
  tenantBoundary: string;
}

interface AuditRecordRow {
  record: ProductionAuditEventStoreRecord;
}

interface EvidenceRecordRow {
  record: ProductionEvidenceStoreRecord;
}

interface SignedWindowRow {
  record: ProductionSignedAuditWindow;
}

interface SiemDeliveryRow {
  record: ProductionSiemDeliveryRecord;
}

interface BackupMetadataRow {
  metadata: ProductionRepositoryBackupMetadata[];
}

interface BackupRow {
  record: ProductionAuditStoreBackup;
}

/**
 * Postgres-backed append-only audit store. `access_kit_audit_records`,
 * `access_kit_audit_evidence_records`, `access_kit_audit_signed_windows`, and
 * `access_kit_audit_siem_deliveries` are protected by database triggers that
 * reject UPDATE/DELETE outside of an explicit `restoreSnapshot` transaction,
 * so the append-only guarantee holds even against direct SQL access, not
 * only against this class's public methods.
 */
export class PostgresExternalAppendOnlyAuditStore implements ExternalAppendOnlyAuditStore {
  readonly #db: PostgresQueryable;
  readonly #tenantBoundary: string;
  #auditRecords: ProductionAuditEventStoreRecord[] = [];
  #evidenceRecords: ProductionEvidenceStoreRecord[] = [];
  #signedWindows: ProductionSignedAuditWindow[] = [];
  #siemDeliveries: ProductionSiemDeliveryRecord[] = [];
  #backupMetadata: ProductionRepositoryBackupMetadata[] = [];
  readonly #backups = new Map<CanonicalId, ProductionAuditStoreBackup>();
  #writeQueue: Promise<void> = Promise.resolve();

  private constructor(options: PostgresAppendOnlyAuditStoreOptions) {
    this.#db = options.db;
    this.#tenantBoundary = options.tenantBoundary;
  }

  static async create(options: PostgresAppendOnlyAuditStoreOptions): Promise<PostgresExternalAppendOnlyAuditStore> {
    const store = new PostgresExternalAppendOnlyAuditStore(options);
    await store.#hydrate();
    return store;
  }

  readAuditRecords(): ProductionAuditEventStoreRecord[] {
    assertSequenceContinuity(this.#auditRecords);
    return clone(this.#auditRecords);
  }

  appendAuditRecord(record: ProductionAuditEventStoreRecord): void {
    if (this.#auditRecords.some((entry) => entry.event.eventId === record.event.eventId)) {
      throw new Error(`Production audit event ${record.event.eventId} has already been appended.`);
    }

    const persistedRecord = clone(record);
    this.#auditRecords.push(persistedRecord);
    this.#enqueue(() =>
      this.#db.query(
        `INSERT INTO ${postgresPersistenceTableNames.auditRecords} (tenant_boundary, sequence, event_id, record, record_hash, stored_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          this.#tenantBoundary,
          persistedRecord.sequence,
          persistedRecord.event.eventId,
          persistedRecord,
          persistedRecord.recordHash,
          persistedRecord.storedAt
        ]
      )
    );
  }

  readEvidenceRecords(): ProductionEvidenceStoreRecord[] {
    return clone(this.#evidenceRecords);
  }

  appendEvidenceRecord(record: ProductionEvidenceStoreRecord): void {
    if (this.#evidenceRecords.some((entry) => entry.exportId === record.exportId)) {
      throw new Error(`Production evidence package ${record.exportId} has already been retained.`);
    }

    const persistedRecord = clone(record);
    this.#evidenceRecords.push(persistedRecord);
    this.#enqueue(() =>
      this.#db.query(
        `INSERT INTO ${postgresPersistenceTableNames.auditEvidenceRecords} (tenant_boundary, export_id, record, stored_at)
         VALUES ($1, $2, $3, $4)`,
        [this.#tenantBoundary, persistedRecord.exportId, persistedRecord, persistedRecord.storedAt]
      )
    );
  }

  readSignedWindows(): ProductionSignedAuditWindow[] {
    return clone(this.#signedWindows);
  }

  appendSignedWindow(window: ProductionSignedAuditWindow): void {
    if (this.#signedWindows.some((entry) => entry.windowId === window.windowId)) {
      throw new Error(`Production audit window ${window.windowId} has already been signed.`);
    }

    const persistedWindow = clone(window);
    this.#signedWindows.push(persistedWindow);
    this.#enqueue(() =>
      this.#db.query(
        `INSERT INTO ${postgresPersistenceTableNames.auditSignedWindows} (tenant_boundary, window_id, record, signed_at)
         VALUES ($1, $2, $3, $4)`,
        [this.#tenantBoundary, persistedWindow.windowId, persistedWindow, persistedWindow.signedAt]
      )
    );
  }

  readSiemDeliveries(): ProductionSiemDeliveryRecord[] {
    return clone(this.#siemDeliveries);
  }

  appendSiemDelivery(delivery: ProductionSiemDeliveryRecord): void {
    if (this.#siemDeliveries.some((entry) => entry.deliveryId === delivery.deliveryId)) {
      throw new Error(`Production SIEM delivery ${delivery.deliveryId} has already been recorded.`);
    }

    const persistedDelivery = clone(delivery);
    this.#siemDeliveries.push(persistedDelivery);
    this.#enqueue(() =>
      this.#db.query(
        `INSERT INTO ${postgresPersistenceTableNames.auditSiemDeliveries} (tenant_boundary, delivery_id, window_id, record, attempted_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          this.#tenantBoundary,
          persistedDelivery.deliveryId,
          persistedDelivery.windowId,
          persistedDelivery,
          persistedDelivery.attemptedAt
        ]
      )
    );
  }

  readBackupMetadata(): ProductionRepositoryBackupMetadata[] {
    return clone(this.#backupMetadata);
  }

  writeBackupMetadata(metadata: ProductionRepositoryBackupMetadata[]): void {
    const persistedMetadata = clone(metadata);
    this.#backupMetadata = persistedMetadata;
    this.#enqueue(() =>
      this.#db.query(
        `INSERT INTO ${postgresPersistenceTableNames.auditBackupMetadata} (tenant_boundary, metadata, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (tenant_boundary) DO UPDATE SET metadata = EXCLUDED.metadata, updated_at = EXCLUDED.updated_at`,
        [this.#tenantBoundary, JSON.stringify(persistedMetadata)]
      )
    );
  }

  readBackup(id: CanonicalId): ProductionAuditStoreBackup | undefined {
    return cloneOptional(this.#backups.get(id));
  }

  writeBackup(id: CanonicalId, backup: ProductionAuditStoreBackup): void {
    const persistedBackup = clone(backup);
    this.#backups.set(id, persistedBackup);
    this.#enqueue(() =>
      this.#db.query(
        `INSERT INTO ${postgresPersistenceTableNames.auditBackups} (tenant_boundary, backup_id, record, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_boundary, backup_id) DO UPDATE SET record = EXCLUDED.record`,
        [this.#tenantBoundary, id, persistedBackup, persistedBackup.createdAt]
      )
    );
  }

  restoreSnapshot(snapshot: {
    auditRecords: ProductionAuditEventStoreRecord[];
    evidenceRecords: ProductionEvidenceStoreRecord[];
    signedWindows: ProductionSignedAuditWindow[];
    siemDeliveries: ProductionSiemDeliveryRecord[];
    backupMetadata: ProductionRepositoryBackupMetadata[];
  }): void {
    const persistedSnapshot = clone(snapshot);
    this.#auditRecords = clone(persistedSnapshot.auditRecords);
    this.#evidenceRecords = clone(persistedSnapshot.evidenceRecords);
    this.#signedWindows = clone(persistedSnapshot.signedWindows);
    this.#siemDeliveries = clone(persistedSnapshot.siemDeliveries);
    this.#backupMetadata = clone(persistedSnapshot.backupMetadata);
    this.#enqueue(() => this.#persistRestoreSnapshot(persistedSnapshot));
  }

  /**
   * Awaits every write that has been queued so far, surfacing the first error
   * observed while persisting to Postgres.
   */
  async waitForPendingWrites(): Promise<void> {
    await this.#writeQueue;
  }

  async #hydrate(): Promise<void> {
    const auditResult = await this.#db.query<AuditRecordRow>(
      `SELECT record FROM ${postgresPersistenceTableNames.auditRecords} WHERE tenant_boundary = $1 ORDER BY sequence ASC`,
      [this.#tenantBoundary]
    );
    this.#auditRecords = auditResult.rows.map((row) => row.record);
    assertSequenceContinuity(this.#auditRecords);

    const evidenceResult = await this.#db.query<EvidenceRecordRow>(
      `SELECT record FROM ${postgresPersistenceTableNames.auditEvidenceRecords} WHERE tenant_boundary = $1 ORDER BY stored_at ASC`,
      [this.#tenantBoundary]
    );
    this.#evidenceRecords = evidenceResult.rows.map((row) => row.record);

    const windowResult = await this.#db.query<SignedWindowRow>(
      `SELECT record FROM ${postgresPersistenceTableNames.auditSignedWindows} WHERE tenant_boundary = $1 ORDER BY signed_at ASC`,
      [this.#tenantBoundary]
    );
    this.#signedWindows = windowResult.rows.map((row) => row.record);

    const siemResult = await this.#db.query<SiemDeliveryRow>(
      `SELECT record FROM ${postgresPersistenceTableNames.auditSiemDeliveries} WHERE tenant_boundary = $1 ORDER BY attempted_at ASC`,
      [this.#tenantBoundary]
    );
    this.#siemDeliveries = siemResult.rows.map((row) => row.record);

    const backupMetadataResult = await this.#db.query<BackupMetadataRow>(
      `SELECT metadata FROM ${postgresPersistenceTableNames.auditBackupMetadata} WHERE tenant_boundary = $1`,
      [this.#tenantBoundary]
    );
    this.#backupMetadata = backupMetadataResult.rows[0]?.metadata ?? [];

    const backupResult = await this.#db.query<BackupRow & { backup_id: string }>(
      `SELECT backup_id, record FROM ${postgresPersistenceTableNames.auditBackups} WHERE tenant_boundary = $1`,
      [this.#tenantBoundary]
    );
    for (const row of backupResult.rows) {
      this.#backups.set(row.backup_id, row.record);
    }
  }

  #enqueue(operation: () => Promise<unknown>): void {
    const queued = this.#writeQueue.then(() => operation()).then(() => undefined);
    void queued.catch(() => undefined);
    this.#writeQueue = queued;
  }

  async #persistRestoreSnapshot(snapshot: {
    auditRecords: ProductionAuditEventStoreRecord[];
    evidenceRecords: ProductionEvidenceStoreRecord[];
    signedWindows: ProductionSignedAuditWindow[];
    siemDeliveries: ProductionSiemDeliveryRecord[];
    backupMetadata: ProductionRepositoryBackupMetadata[];
  }): Promise<void> {
    await this.#db.withTransaction(async (tx) => {
      await tx.query(appendOnlyRestoreBypassStatement());
      await tx.query(`DELETE FROM ${postgresPersistenceTableNames.auditRecords} WHERE tenant_boundary = $1`, [this.#tenantBoundary]);
      await tx.query(`DELETE FROM ${postgresPersistenceTableNames.auditEvidenceRecords} WHERE tenant_boundary = $1`, [this.#tenantBoundary]);
      await tx.query(`DELETE FROM ${postgresPersistenceTableNames.auditSignedWindows} WHERE tenant_boundary = $1`, [this.#tenantBoundary]);
      await tx.query(`DELETE FROM ${postgresPersistenceTableNames.auditSiemDeliveries} WHERE tenant_boundary = $1`, [this.#tenantBoundary]);

      for (const record of snapshot.auditRecords) {
        await tx.query(
          `INSERT INTO ${postgresPersistenceTableNames.auditRecords} (tenant_boundary, sequence, event_id, record, record_hash, stored_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [this.#tenantBoundary, record.sequence, record.event.eventId, record, record.recordHash, record.storedAt]
        );
      }

      for (const record of snapshot.evidenceRecords) {
        await tx.query(
          `INSERT INTO ${postgresPersistenceTableNames.auditEvidenceRecords} (tenant_boundary, export_id, record, stored_at)
           VALUES ($1, $2, $3, $4)`,
          [this.#tenantBoundary, record.exportId, record, record.storedAt]
        );
      }

      for (const window of snapshot.signedWindows) {
        await tx.query(
          `INSERT INTO ${postgresPersistenceTableNames.auditSignedWindows} (tenant_boundary, window_id, record, signed_at)
           VALUES ($1, $2, $3, $4)`,
          [this.#tenantBoundary, window.windowId, window, window.signedAt]
        );
      }

      for (const delivery of snapshot.siemDeliveries) {
        await tx.query(
          `INSERT INTO ${postgresPersistenceTableNames.auditSiemDeliveries} (tenant_boundary, delivery_id, window_id, record, attempted_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [this.#tenantBoundary, delivery.deliveryId, delivery.windowId, delivery, delivery.attemptedAt]
        );
      }

      await tx.query(
        `INSERT INTO ${postgresPersistenceTableNames.auditBackupMetadata} (tenant_boundary, metadata, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (tenant_boundary) DO UPDATE SET metadata = EXCLUDED.metadata, updated_at = EXCLUDED.updated_at`,
        [this.#tenantBoundary, JSON.stringify(snapshot.backupMetadata)]
      );
    });
  }
}

function assertSequenceContinuity(records: readonly ProductionAuditEventStoreRecord[]): void {
  for (const [index, record] of records.entries()) {
    const expectedSequence = index + 1;

    if (record.sequence !== expectedSequence) {
      throw new Error(
        `Postgres audit store sequence continuity check failed: expected sequence ${expectedSequence} but found ${record.sequence} for event ${record.event.eventId}.`
      );
    }
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneOptional<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : clone(value);
}
