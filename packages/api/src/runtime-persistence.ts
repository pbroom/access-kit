import {
  LocalAppendOnlyAuditRepository,
  LocalFileEvidenceRepository,
  LocalJsonFileGraphRepository,
  LocalJsonFileJobRepository,
  LocalJsonFileStateRepository
} from "@access-kit/core";
import { dirname, join } from "node:path";
import type { RebacRuntimePersistence } from "./local-app.js";

export interface LocalRuntimePersistenceOptions {
  statePath?: string;
  evidenceRoot?: string;
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
