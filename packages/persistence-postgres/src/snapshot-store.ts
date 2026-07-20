import type { CanonicalId, ExternalSnapshotStore } from "@access-kit/core";
import { stablePostgresHash } from "./hash.js";
import { postgresPersistenceTableNames } from "./schema.js";
import type { PostgresQueryable } from "./types.js";

export interface PostgresSnapshotStoreOptions {
  db: PostgresQueryable;
  tenantBoundary: string;
  storeName: string;
}

interface StoredSnapshotRow<TRecord> {
  record: TRecord;
}

interface StoredSnapshotBackupRow<TRecord> {
  backup_id: string;
  record: TRecord;
}

export class PostgresExternalSnapshotStore<TRecord extends object> implements ExternalSnapshotStore<TRecord> {
  readonly #db: PostgresQueryable;
  readonly #tenantBoundary: string;
  readonly #storeName: string;
  #current: TRecord | undefined;
  readonly #backups = new Map<CanonicalId, TRecord>();
  #writeQueue: Promise<void> = Promise.resolve();

  private constructor(options: PostgresSnapshotStoreOptions) {
    this.#db = options.db;
    this.#tenantBoundary = options.tenantBoundary;
    this.#storeName = options.storeName;
  }

  static async create<TRecord extends object>(
    options: PostgresSnapshotStoreOptions
  ): Promise<PostgresExternalSnapshotStore<TRecord>> {
    const store = new PostgresExternalSnapshotStore<TRecord>(options);
    await store.#hydrate();
    return store;
  }

  readCurrent(): TRecord | undefined {
    return cloneOptional(this.#current);
  }

  writeCurrent(record: TRecord): void {
    const persistedRecord = clone(record);
    this.#current = persistedRecord;
    this.#enqueue(() => this.#persistCurrentUnconditional(persistedRecord));
  }

  compareExchangeCurrent(expected: TRecord | undefined, record: TRecord): boolean {
    const currentHash = this.#current === undefined ? undefined : stablePostgresHash(this.#current);
    const expectedHash = expected === undefined ? undefined : stablePostgresHash(expected);

    if (currentHash !== expectedHash) {
      return false;
    }

    const persistedRecord = clone(record);
    this.#current = persistedRecord;
    this.#enqueue(() => this.#persistCurrentConditional(expectedHash, persistedRecord));
    return true;
  }

  readBackup(id: CanonicalId): TRecord | undefined {
    return cloneOptional(this.#backups.get(id));
  }

  writeBackup(id: CanonicalId, record: TRecord): void {
    const persistedRecord = clone(record);
    this.#backups.set(id, persistedRecord);
    this.#enqueue(() => this.#persistBackup(id, persistedRecord));
  }

  /**
   * Awaits every write that has been queued so far, surfacing the first error
   * observed while persisting to Postgres. Callers that need to observe
   * durability synchronously with a mutation (tests, graceful shutdown)
   * should await this after issuing writes.
   */
  async waitForPendingWrites(): Promise<void> {
    await this.#writeQueue;
  }

  async #hydrate(): Promise<void> {
    const currentResult = await this.#db.query<StoredSnapshotRow<TRecord>>(
      `SELECT record FROM ${postgresPersistenceTableNames.snapshotCurrent}
       WHERE tenant_boundary = $1 AND store_name = $2`,
      [this.#tenantBoundary, this.#storeName]
    );
    this.#current = currentResult.rows[0]?.record;

    const backupResult = await this.#db.query<StoredSnapshotBackupRow<TRecord>>(
      `SELECT backup_id, record FROM ${postgresPersistenceTableNames.snapshotBackup}
       WHERE tenant_boundary = $1 AND store_name = $2`,
      [this.#tenantBoundary, this.#storeName]
    );

    for (const row of backupResult.rows) {
      this.#backups.set(row.backup_id, row.record);
    }
  }

  #enqueue(operation: () => Promise<void>): void {
    const queued = this.#writeQueue.then(operation);
    void queued.catch(() => undefined);
    this.#writeQueue = queued;
  }

  async #persistCurrentUnconditional(record: TRecord): Promise<void> {
    const hash = stablePostgresHash(record);
    await this.#db.query(
      `INSERT INTO ${postgresPersistenceTableNames.snapshotCurrent} (tenant_boundary, store_name, record, record_hash, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (tenant_boundary, store_name) DO UPDATE
         SET record = EXCLUDED.record, record_hash = EXCLUDED.record_hash, updated_at = EXCLUDED.updated_at`,
      [this.#tenantBoundary, this.#storeName, record, hash]
    );
  }

  async #persistCurrentConditional(expectedHash: string | undefined, record: TRecord): Promise<void> {
    const hash = stablePostgresHash(record);
    const result = expectedHash === undefined
      ? await this.#db.query(
          `INSERT INTO ${postgresPersistenceTableNames.snapshotCurrent} (tenant_boundary, store_name, record, record_hash, updated_at)
           VALUES ($1, $2, $3, $4, now())
           ON CONFLICT (tenant_boundary, store_name) DO NOTHING
           RETURNING store_name`,
          [this.#tenantBoundary, this.#storeName, record, hash]
        )
      : await this.#db.query(
          `UPDATE ${postgresPersistenceTableNames.snapshotCurrent}
           SET record = $3, record_hash = $4, updated_at = now()
           WHERE tenant_boundary = $1 AND store_name = $2 AND record_hash = $5
           RETURNING store_name`,
          [this.#tenantBoundary, this.#storeName, record, hash, expectedHash]
        );

    if (result.rowCount === 0) {
      throw new Error(
        `Postgres snapshot store "${this.#storeName}" rejected a write because the stored record no longer matched the expected version. ` +
          "Another writer has persisted a conflicting update."
      );
    }
  }

  async #persistBackup(id: CanonicalId, record: TRecord): Promise<void> {
    const hash = stablePostgresHash(record);
    await this.#db.query(
      `INSERT INTO ${postgresPersistenceTableNames.snapshotBackup} (tenant_boundary, store_name, backup_id, record, record_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (tenant_boundary, store_name, backup_id) DO UPDATE
         SET record = EXCLUDED.record, record_hash = EXCLUDED.record_hash`,
      [this.#tenantBoundary, this.#storeName, id, record, hash]
    );
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneOptional<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : clone(value);
}
