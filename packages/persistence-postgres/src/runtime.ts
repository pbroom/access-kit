import {
  ProductionAuditEvidenceAdapter,
  ProductionConnectorStateStoreAdapter,
  ProductionGraphStoreAdapter,
  type ProductionConnectorStateStoreRecord,
  type ProductionGraphStoreRecord
} from "@access-kit/core";
import { Pool } from "pg";
import { PostgresExternalAppendOnlyAuditStore } from "./audit-store.js";
import { assertPostgresPersistenceConfig } from "./config.js";
import { createPoolQueryable } from "./pool-queryable.js";
import { ensureAccessKitPersistenceSchema } from "./schema.js";
import { PostgresExternalSnapshotStore } from "./snapshot-store.js";

export interface PostgresRuntimePersistenceOptions {
  databaseUrl: string;
  tenantBoundary: string;
  auditSigningKeyMaterial: string;
  locationPrefix?: string;
  now?: () => string;
}

export interface PostgresRuntimePersistenceBundle {
  graphRepository: ProductionGraphStoreAdapter;
  jobRepository: ProductionConnectorStateStoreAdapter;
  auditRepository: ProductionAuditEvidenceAdapter;
  evidenceRepository: ProductionAuditEvidenceAdapter;
  waitForPendingWrites(): Promise<void>;
  close(): Promise<void>;
}

const graphStoreName = "graph";
const connectorStateStoreName = "connector_state";

/**
 * Wires the Postgres-backed injectable stores into the existing
 * ExternalSnapshotStore/ExternalAppendOnlyAuditStore adapter boundary from
 * `@access-kit/core`. Schema bootstrap (and therefore a real connection
 * check) runs before any repository is constructed, so a returned bundle
 * only ever represents a live, durable Postgres connection: there is no
 * path that returns `durable: true` descriptors without a verified
 * connection.
 */
export async function createPostgresRuntimePersistence(
  options: PostgresRuntimePersistenceOptions
): Promise<PostgresRuntimePersistenceBundle> {
  assertPostgresPersistenceConfig({
    databaseUrl: options.databaseUrl,
    tenantBoundary: options.tenantBoundary,
    auditSigningKeyMaterial: options.auditSigningKeyMaterial
  });

  const pool = new Pool({ connectionString: options.databaseUrl });

  try {
    const db = createPoolQueryable(pool);
    await ensureAccessKitPersistenceSchema(db);

    const locationPrefix = options.locationPrefix ?? "postgres";
    const [graphStore, connectorStateStore, auditStore] = await Promise.all([
      PostgresExternalSnapshotStore.create<ProductionGraphStoreRecord>({
        db,
        tenantBoundary: options.tenantBoundary,
        storeName: graphStoreName
      }),
      PostgresExternalSnapshotStore.create<ProductionConnectorStateStoreRecord>({
        db,
        tenantBoundary: options.tenantBoundary,
        storeName: connectorStateStoreName
      }),
      PostgresExternalAppendOnlyAuditStore.create({ db, tenantBoundary: options.tenantBoundary })
    ]);

    const graphRepository = new ProductionGraphStoreAdapter({
      store: graphStore,
      tenantBoundary: options.tenantBoundary,
      location: `${locationPrefix}://graph`,
      now: options.now
    });
    const jobRepository = new ProductionConnectorStateStoreAdapter({
      store: connectorStateStore,
      tenantBoundary: options.tenantBoundary,
      location: `${locationPrefix}://connector-state`,
      now: options.now
    });
    const auditRepository = new ProductionAuditEvidenceAdapter({
      store: auditStore,
      tenantBoundary: options.tenantBoundary,
      location: `${locationPrefix}://audit`,
      signingKeyMaterial: options.auditSigningKeyMaterial,
      now: options.now
    });

    return {
      graphRepository,
      jobRepository,
      auditRepository,
      evidenceRepository: auditRepository,
      async waitForPendingWrites() {
        await Promise.all([
          graphStore.waitForPendingWrites(),
          connectorStateStore.waitForPendingWrites(),
          auditStore.waitForPendingWrites()
        ]);
      },
      async close() {
        await pool.end();
      }
    };
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw error;
  }
}
