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
  readonly #pendingErrors: Error[] = [];

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

    this.#auditRecords.push(clone(record));
    this.#enqueue(() =>
      this.#db.query(
        `INSERT INTO ${postgresPersistenceTableNames.auditRecords} (tenant_boundary, sequence, event_id, record, record_hash, stored_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [this.#tenantBoundary, record.sequence, record.event.eventId, record, record.recordHash, record.storedAt]
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

    this.#evidenceRecords.push(clone(record));
    this.#enqueue(() =>
      this.#db.query(
        `INSERT INTO ${postgresPersistenceTableNames.auditEvidenceRecords} (tenant_boundary, export_id, record, stored_at)
         VALUES ($1, $2, $3, $4)`,
        [this.#tenantBoundary, record.exportId, record, record.storedAt]
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

    this.#signedWindows.push(clone(window));
    this.#enqueue(() =>
      this.#db.query(
        `INSERT INTO ${postgresPersistenceTableNames.auditSignedWindows} (tenant_boundary, window_id, record, signed_at)
         VALUES ($1, $2, $3, $4)`,
        [this.#tenantBoundary, window.windowId, window, window.signedAt]
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

    this.#siemDeliveries.push(clone(delivery));
    this.#enqueue(() =>
      this.#db.query(
        `INSERT INTO ${postgresPersistenceTableNames.auditSiemDeliveries} (tenant_boundary, delivery_id, window_id, record, attempted_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [this.#tenantBoundary, delivery.deliveryId, delivery.windowId, delivery, delivery.attemptedAt]
      )
    );
  }

  readBackupMetadata(): ProductionRepositoryBackupMetadata[] {
    return clone(this.#backupMetadata);
  }

  writeBackupMetadata(metadata: ProductionRepositoryBackupMetadata[]): void {
    this.#backupMetadata = clone(metadata);
    this.#enqueue(() =>
      this.#db.query(
        `INSERT INTO ${postgresPersistenceTableNames.auditBackupMetadata} (tenant_boundary, metadata, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (tenant_boundary) DO UPDATE SET metadata = EXCLUDED.metadata, updated_at = EXCLUDED.updated_at`,
        [this.#tenantBoundary, metadata]
      )
    );
  }

  readBackup(id: CanonicalId): ProductionAuditStoreBackup | undefined {
    return cloneOptional(this.#backups.get(id));
  }

  writeBackup(id: CanonicalId, backup: ProductionAuditStoreBackup): void {
    this.#backups.set(id, clone(backup));
    this.#enqueue(() =>
      this.#db.query(
        `INSERT INTO ${postgresPersistenceTableNames.auditBackups} (tenant_boundary, backup_id, record, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (backup_id) DO UPDATE SET record = EXCLUDED.record`,
        [this.#tenantBoundary, id, backup, backup.createdAt]
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
    this.#auditRecords = clone(snapshot.auditRecords);
    this.#evidenceRecords = clone(snapshot.evidenceRecords);
    this.#signedWindows = clone(snapshot.signedWindows);
    this.#siemDeliveries = clone(snapshot.siemDeliveries);
    this.#backupMetadata = clone(snapshot.backupMetadata);
    this.#enqueue(() => this.#persistRestoreSnapshot(snapshot));
  }

  /**
   * Awaits every write that has been queued so far, surfacing the first error
   * observed while persisting to Postgres.
   */
  async waitForPendingWrites(): Promise<void> {
    await this.#writeQueue;

    if (this.#pendingErrors.length > 0) {
      const [error] = this.#pendingErrors.splice(0, this.#pendingErrors.length);
      throw error;
    }
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
    this.#writeQueue = this.#writeQueue.then(() => operation()).then(
      () => undefined,
      (error: unknown) => {
        this.#pendingErrors.push(error instanceof Error ? error : new Error(String(error)));
      }
    );
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
        [this.#tenantBoundary, snapshot.backupMetadata]
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
