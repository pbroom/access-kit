import {
  LocalAppendOnlyAuditRepository,
  LocalFileEvidenceRepository,
  LocalJsonFileStateRepository
} from "@access-kit/core";
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

  return {
    auditRepository,
    evidenceRepository,
    stateRepository
  };
}
