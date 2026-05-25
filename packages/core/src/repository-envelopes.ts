import { createHash } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { stableStringify } from "./audit.js";
import type { RebacGraphSnapshot, RebacJobSnapshot } from "./persistence.js";
import type { RebacGraphStorageReceipt, RebacJobStorageReceipt, RebacStateStorageReceipt } from "./repositories.js";
import type { RebacSeedData } from "./store.js";

export function stableHash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function writeJsonFileAtomically(path: string, value: unknown): void {
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(tempPath, `${stableStringify(value)}\n`, "utf8");
  renameSync(tempPath, path);
}

export function assertStoredPayloadHash(
  payload: unknown,
  storedHash: string,
  errorMessage: string
): void {
  if (storedHash !== `sha256:${stableHash(payload)}`) {
    throw new Error(errorMessage);
  }
}

export function assertObjectArrayFields(
  value: unknown,
  label: string,
  fields: readonly string[]
): void {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }

  for (const field of fields) {
    const items = value[field];

    if (items === undefined) {
      // Missing arrays are legacy-compatible and normalize to empty collections; present fields must be arrays.
      continue;
    }

    if (!Array.isArray(items)) {
      throw new Error(`${label} field ${field} must be an array.`);
    }

    items.forEach((item, index) => {
      if (!isRecord(item)) {
        throw new Error(`${label} field ${field} item ${index} must be an object.`);
      }
    });
  }
}

export function normalizeJobSnapshot(jobs: Partial<RebacJobSnapshot>): RebacJobSnapshot {
  return {
    discoveryRuns: clone(jobs.discoveryRuns ?? []),
    enforcementReadinessReports: clone(jobs.enforcementReadinessReports ?? []),
    provisioningPlans: clone(jobs.provisioningPlans ?? []),
    provisioningJobs: clone(jobs.provisioningJobs ?? []),
    driftFindings: clone(jobs.driftFindings ?? []),
    reconciliationRuns: clone(jobs.reconciliationRuns ?? []),
    decisions: clone(jobs.decisions ?? [])
  };
}

export function normalizeGraphSnapshot(graph: Partial<RebacGraphSnapshot>): RebacGraphSnapshot {
  return {
    subjects: clone(graph.subjects ?? []),
    resources: clone(graph.resources ?? []),
    relationships: clone(graph.relationships ?? []),
    nativeGrants: clone(graph.nativeGrants ?? [])
  };
}

export function countJobEntities(jobs: RebacJobSnapshot): RebacJobStorageReceipt["entityCounts"] {
  return {
    discoveryRuns: jobs.discoveryRuns.length,
    enforcementReadinessReports: jobs.enforcementReadinessReports.length,
    provisioningPlans: jobs.provisioningPlans.length,
    provisioningJobs: jobs.provisioningJobs.length,
    driftFindings: jobs.driftFindings.length,
    reconciliationRuns: jobs.reconciliationRuns.length,
    decisions: jobs.decisions.length
  };
}

export function countGraphEntities(graph: RebacGraphSnapshot): RebacGraphStorageReceipt["entityCounts"] {
  return {
    subjects: graph.subjects.length,
    resources: graph.resources.length,
    relationships: graph.relationships.length,
    nativeGrants: graph.nativeGrants.length
  };
}

export function countStateEntities(state: RebacSeedData): RebacStateStorageReceipt["entityCounts"] {
  return {
    subjects: state.subjects?.length ?? 0,
    resources: state.resources?.length ?? 0,
    relationships: state.relationships?.length ?? 0,
    nativeGrants: state.nativeGrants?.length ?? 0,
    discoveryRuns: state.discoveryRuns?.length ?? 0,
    enforcementReadinessReports: state.enforcementReadinessReports?.length ?? 0,
    provisioningPlans: state.provisioningPlans?.length ?? 0,
    provisioningJobs: state.provisioningJobs?.length ?? 0,
    driftFindings: state.driftFindings?.length ?? 0,
    reconciliationRuns: state.reconciliationRuns?.length ?? 0,
    decisions: state.decisions?.length ?? 0,
    auditEvents: state.auditEvents?.length ?? 0,
    persistenceDegradations: state.persistenceDegradations?.length ?? 0
  };
}

export function migrateLegacyRuntimeState(value: unknown): RebacSeedData {
  if (!isRecord(value)) {
    throw new Error("ReBAC runtime state must use the rebac-runtime-state:v1 envelope or a legacy state object.");
  }

  const allowedKeys = new Set([
    "subjects",
    "resources",
    "relationships",
    "nativeGrants",
    "discoveryRuns",
    "enforcementReadinessReports",
    "provisioningPlans",
    "provisioningJobs",
    "driftFindings",
    "reconciliationRuns",
    "decisions",
    "auditEvents",
    "persistenceDegradations"
  ]);

  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Legacy ReBAC runtime state contains unsupported field: ${key}`);
    }

    const items = value[key];
    if (!Array.isArray(items)) {
      throw new Error(`Legacy ReBAC runtime state field ${key} must be an array.`);
    }

    items.forEach((item, index) => {
      if (!isRecord(item)) {
        throw new Error(`Legacy ReBAC runtime state field ${key} item ${index} must be an object.`);
      }
    });
  }

  return value as RebacSeedData;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
