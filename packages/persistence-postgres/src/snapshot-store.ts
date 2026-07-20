import type { CanonicalId, ExternalSnapshotStore } from "@access-kit/core";
import { stablePostgresHash } from "./hash.js";
import { postgresPersistenceTableNames } from "./schema.js";
import type { PostgresQueryable } from "./types.js";

export interface PostgresSnapshotStoreOptions {
  db: PostgresQueryable;
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
  readonly #storeName: string;
  #current: TRecord | undefined;
  readonly #backups = new Map<CanonicalId, TRecord>();
  #writeQueue: Promise<void> = Promise.resolve();
  readonly #pendingErrors: Error[] = [];

  private constructor(options: PostgresSnapshotStoreOptions) {
    this.#db = options.db;
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
    this.#current = clone(record);
    this.#enqueue(() => this.#persistCurrentUnconditional(record));
  }

  compareExchangeCurrent(expected: TRecord | undefined, record: TRecord): boolean {
    const currentHash = this.#current === undefined ? undefined : stablePostgresHash(this.#current);
    const expectedHash = expected === undefined ? undefined : stablePostgresHash(expected);

    if (currentHash !== expectedHash) {
      return false;
    }

    this.#current = clone(record);
    this.#enqueue(() => this.#persistCurrentConditional(expectedHash, record));
    return true;
  }

  readBackup(id: CanonicalId): TRecord | undefined {
    return cloneOptional(this.#backups.get(id));
  }

  writeBackup(id: CanonicalId, record: TRecord): void {
    this.#backups.set(id, clone(record));
    this.#enqueue(() => this.#persistBackup(id, record));
  }

  /**
   * Awaits every write that has been queued so far, surfacing the first error
   * observed while persisting to Postgres. Callers that need to observe
   * durability synchronously with a mutation (tests, graceful shutdown)
   * should await this after issuing writes.
   */
  async waitForPendingWrites(): Promise<void> {
    await this.#writeQueue;

    if (this.#pendingErrors.length > 0) {
      const [error] = this.#pendingErrors.splice(0, this.#pendingErrors.length);
      throw error;
    }
  }

  async #hydrate(): Promise<void> {
    const currentResult = await this.#db.query<StoredSnapshotRow<TRecord>>(
      `SELECT record FROM ${postgresPersistenceTableNames.snapshotCurrent} WHERE store_name = $1`,
      [this.#storeName]
    );
    this.#current = currentResult.rows[0]?.record;

    const backupResult = await this.#db.query<StoredSnapshotBackupRow<TRecord>>(
      `SELECT backup_id, record FROM ${postgresPersistenceTableNames.snapshotBackup} WHERE store_name = $1`,
      [this.#storeName]
    );

    for (const row of backupResult.rows) {
      this.#backups.set(row.backup_id, row.record);
    }
  }

  #enqueue(operation: () => Promise<void>): void {
    this.#writeQueue = this.#writeQueue.then(operation).catch((error: unknown) => {
      this.#pendingErrors.push(error instanceof Error ? error : new Error(String(error)));
    });
  }

  async #persistCurrentUnconditional(record: TRecord): Promise<void> {
    const hash = stablePostgresHash(record);
    await this.#db.query(
      `INSERT INTO ${postgresPersistenceTableNames.snapshotCurrent} (store_name, record, record_hash, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (store_name) DO UPDATE
         SET record = EXCLUDED.record, record_hash = EXCLUDED.record_hash, updated_at = EXCLUDED.updated_at`,
      [this.#storeName, record, hash]
    );
  }

  async #persistCurrentConditional(expectedHash: string | undefined, record: TRecord): Promise<void> {
    const hash = stablePostgresHash(record);
    const result = await this.#db.query(
      `INSERT INTO ${postgresPersistenceTableNames.snapshotCurrent} (store_name, record, record_hash, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (store_name) DO UPDATE
         SET record = EXCLUDED.record, record_hash = EXCLUDED.record_hash, updated_at = EXCLUDED.updated_at
         WHERE ${postgresPersistenceTableNames.snapshotCurrent}.record_hash = $4
       RETURNING store_name`,
      [this.#storeName, record, hash, expectedHash ?? null]
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
      `INSERT INTO ${postgresPersistenceTableNames.snapshotBackup} (store_name, backup_id, record, record_hash, created_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (store_name, backup_id) DO UPDATE
         SET record = EXCLUDED.record, record_hash = EXCLUDED.record_hash`,
      [this.#storeName, id, record, hash]
    );
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneOptional<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : clone(value);
}
