import { Pool, type PoolClient } from "pg";
import type { PostgresQueryable, PostgresQueryResult } from "./types.js";

export interface PostgresConnection {
  db: PostgresQueryable;
  close(): Promise<void>;
}

export function connectPostgres(databaseUrl: string): PostgresConnection {
  const pool = new Pool({ connectionString: databaseUrl });

  return {
    db: createPoolQueryable(pool),
    close: () => pool.end()
  };
}

export function createPoolQueryable(pool: Pool): PostgresQueryable {
  return {
    async query<TRow>(text: string, params?: readonly unknown[]): Promise<PostgresQueryResult<TRow>> {
      const result = await pool.query(text, params as unknown[] | undefined);
      return { rows: result.rows as TRow[], rowCount: result.rowCount };
    },
    async withTransaction<TResult>(fn: (tx: PostgresQueryable) => Promise<TResult>): Promise<TResult> {
      const client = await pool.connect();

      try {
        await client.query("BEGIN");
        const result = await fn(createClientQueryable(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }
  };
}

function createClientQueryable(client: PoolClient): PostgresQueryable {
  const queryable: PostgresQueryable = {
    async query<TRow>(text: string, params?: readonly unknown[]): Promise<PostgresQueryResult<TRow>> {
      const result = await client.query(text, params as unknown[] | undefined);
      return { rows: result.rows as TRow[], rowCount: result.rowCount };
    },
    withTransaction<TResult>(fn: (tx: PostgresQueryable) => Promise<TResult>): Promise<TResult> {
      return fn(queryable);
    }
  };

  return queryable;
}
