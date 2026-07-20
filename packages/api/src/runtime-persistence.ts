import {
  LocalAppendOnlyAuditRepository,
  LocalFileEvidenceRepository,
  LocalJsonFileGraphRepository,
  LocalJsonFileJobRepository,
  LocalJsonFileStateRepository
} from "@access-kit/core";
import { createPostgresRuntimePersistence } from "@access-kit/persistence-postgres";
import { dirname, join } from "node:path";
import type { RebacRuntimePersistence } from "./local-app.js";

export interface LocalRuntimePersistenceOptions {
  statePath?: string;
  evidenceRoot?: string;
}

export interface RuntimePersistenceOptions extends LocalRuntimePersistenceOptions {
  databaseUrl?: string;
  databaseTenantBoundary?: string;
  databaseAuditSigningKey?: string;
}

export function createLocalRuntimePersistence(options: LocalRuntimePersistenceOptions): RebacRuntimePersistence {
  const evidenceRepository = options.evidenceRoot
    ? new LocalFileEvidenceRepository({ rootDir: options.evidenceRoot })
    : undefined;
  const auditRepository = options.evidenceRoot
    ? new LocalAppendOnlyAuditRepository({ rootDir: options.evidenceRoot })
    : undefined;
  const stateRepository = options.statePath
    ? new LocalJsonFileStateRepository({ statePath: options.statePath })
    : undefined;
  const stateRoot = options.statePath ? dirname(options.statePath) : undefined;
  const graphRepository = stateRoot
    ? new LocalJsonFileGraphRepository({ graphPath: join(stateRoot, "graph-state.json") })
    : undefined;
  const jobRepository = stateRoot
    ? new LocalJsonFileJobRepository({ jobsPath: join(stateRoot, "job-state.json") })
    : undefined;

  return {
    auditRepository,
    evidenceRepository,
    graphRepository,
    jobRepository,
    stateRepository
  };
}

export async function createRuntimePersistence(options: RuntimePersistenceOptions): Promise<RebacRuntimePersistence> {
  if (!options.databaseUrl) {
    return createLocalRuntimePersistence(options);
  }

  const bundle = await createPostgresRuntimePersistence({
    databaseUrl: options.databaseUrl,
    tenantBoundary: options.databaseTenantBoundary ?? "",
    auditSigningKeyMaterial: options.databaseAuditSigningKey ?? ""
  });

  return {
    graphRepository: bundle.graphRepository,
    jobRepository: bundle.jobRepository,
    auditRepository: bundle.auditRepository,
    evidenceRepository: bundle.evidenceRepository
  };
}
