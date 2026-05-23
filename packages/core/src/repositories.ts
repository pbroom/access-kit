import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { auditEventHash, stableStringify, verifyAuditChain } from "./audit.js";
import type {
  AuditEvent,
  AuditIntegrityReport,
  AuditStorageReceipt,
  EvidenceExport,
  EvidenceStorageReceipt
} from "./domain.js";
import type { RebacSeedData } from "./store.js";

export interface AuditEventRepository {
  appendAuditEvent(event: AuditEvent, storedAt: string): AuditStorageReceipt;
  listAuditEvents(): AuditEvent[];
  verifyIntegrity(verifiedAt: string): AuditIntegrityReport;
}

export interface EvidencePackageRepository {
  writeEvidenceExport(evidence: EvidenceExport, storedAt: string): EvidenceStorageReceipt;
  readEvidenceExport(exportId: string): EvidenceExport | undefined;
}

export interface RebacStateRepository {
  readState(): RebacSeedData | undefined;
  writeState(state: RebacSeedData, storedAt: string): RebacStateStorageReceipt;
}

export interface RebacStateStorageReceipt {
  storedAt: string;
  backend: "local_file" | "external";
  location: string;
  stateHash: string;
  entityCounts: {
    subjects: number;
    resources: number;
    relationships: number;
    nativeGrants: number;
    discoveryRuns: number;
    enforcementReadinessReports: number;
    provisioningPlans: number;
    provisioningJobs: number;
    driftFindings: number;
    reconciliationRuns: number;
    decisions: number;
    auditEvents: number;
  };
  version: string;
}

export interface LocalFileEvidenceRepositoryOptions {
  rootDir: string;
}

export interface LocalJsonFileStateRepositoryOptions {
  rootDir?: string;
  statePath?: string;
}

interface StoredRebacState {
  version: "rebac-runtime-state:v1";
  storedAt: string;
  stateHash: string;
  state: RebacSeedData;
  entityCounts: RebacStateStorageReceipt["entityCounts"];
}

export class LocalFileEvidenceRepository implements AuditEventRepository, EvidencePackageRepository {
  readonly #rootDir: string;
  readonly #auditPath: string;
  readonly #evidenceDir: string;

  constructor(options: LocalFileEvidenceRepositoryOptions) {
    this.#rootDir = options.rootDir;
    this.#auditPath = join(this.#rootDir, "audit-events.jsonl");
    this.#evidenceDir = join(this.#rootDir, "evidence-packages");
    mkdirSync(this.#evidenceDir, { recursive: true });
  }

  appendAuditEvent(event: AuditEvent, storedAt: string): AuditStorageReceipt {
    const sequence = this.listAuditEvents().length + 1;
    appendFileSync(this.#auditPath, `${stableStringify(event)}\n`, "utf8");

    return {
      eventId: event.eventId,
      sequence,
      eventHash: auditEventHash(event),
      previousEventHash: event.previousEventHash,
      storedAt,
      backend: "local_file",
      location: "audit-events.jsonl",
      immutable: false,
      version: "audit-storage-receipt:v1"
    };
  }

  listAuditEvents(): AuditEvent[] {
    if (!existsSync(this.#auditPath)) {
      return [];
    }

    const lines = readFileSync(this.#auditPath, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    return lines.map((line) => JSON.parse(line) as AuditEvent);
  }

  verifyIntegrity(verifiedAt: string): AuditIntegrityReport {
    return verifyAuditChain(this.listAuditEvents(), verifiedAt);
  }

  writeEvidenceExport(evidence: EvidenceExport, storedAt: string): EvidenceStorageReceipt {
    const filename = `${sanitizeFileSegment(evidence.exportId)}.json`;
    const location = join(this.#evidenceDir, filename);
    const packageHash = `sha256:${stableHash(evidence)}`;
    const receipt: EvidenceStorageReceipt = {
      exportId: evidence.exportId,
      packageHash,
      storedAt,
      backend: "local_file",
      location: `evidence-packages/${filename}`,
      immutable: false,
      version: "evidence-storage-receipt:v1"
    };
    const storedEvidence: EvidenceExport = {
      ...evidence,
      storageReceipt: receipt
    };
    mkdirSync(dirname(location), { recursive: true });
    writeFileSync(location, `${stableStringify(storedEvidence)}\n`, "utf8");
    return receipt;
  }

  readEvidenceExport(exportId: string): EvidenceExport | undefined {
    const location = join(this.#evidenceDir, `${sanitizeFileSegment(exportId)}.json`);

    if (!existsSync(location)) {
      return undefined;
    }

    return JSON.parse(readFileSync(location, "utf8")) as EvidenceExport;
  }
}

export class LocalJsonFileStateRepository implements RebacStateRepository {
  readonly #statePath: string;
  readonly #location: string;

  constructor(options: LocalJsonFileStateRepositoryOptions) {
    this.#statePath = options.statePath ?? join(requiredRootDir(options), "runtime-state.json");
    this.#location = basename(this.#statePath);
    mkdirSync(dirname(this.#statePath), { recursive: true });
  }

  readState(): RebacSeedData | undefined {
    if (!existsSync(this.#statePath)) {
      return undefined;
    }

    const parsed = JSON.parse(readFileSync(this.#statePath, "utf8")) as Partial<StoredRebacState> | RebacSeedData;

    if (isStoredRebacState(parsed)) {
      assertStoredStateIntegrity(parsed);
      return parsed.state;
    }

    return parsed as RebacSeedData;
  }

  writeState(state: RebacSeedData, storedAt: string): RebacStateStorageReceipt {
    const stateHash = `sha256:${stableHash(state)}`;
    const entityCounts = countStateEntities(state);
    const stored: StoredRebacState = {
      version: "rebac-runtime-state:v1",
      storedAt,
      stateHash,
      state,
      entityCounts
    };
    const tempPath = `${this.#statePath}.${process.pid}.${Date.now()}.tmp`;
    mkdirSync(dirname(this.#statePath), { recursive: true });
    writeFileSync(tempPath, `${stableStringify(stored)}\n`, "utf8");
    renameSync(tempPath, this.#statePath);

    return {
      storedAt,
      backend: "local_file",
      location: this.#location,
      stateHash,
      entityCounts,
      version: "rebac-state-storage-receipt:v1"
    };
  }
}

function sanitizeFileSegment(value: string): string {
  return value.replaceAll(/[^a-z0-9_-]/gi, "_");
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function requiredRootDir(options: LocalJsonFileStateRepositoryOptions): string {
  if (!options.rootDir) {
    throw new Error("LocalJsonFileStateRepository requires rootDir or statePath");
  }

  return options.rootDir;
}

function isStoredRebacState(value: Partial<StoredRebacState> | RebacSeedData): value is StoredRebacState {
  return (
    typeof (value as StoredRebacState).version === "string" &&
    (value as StoredRebacState).version === "rebac-runtime-state:v1" &&
    typeof (value as StoredRebacState).state === "object" &&
    (value as StoredRebacState).state !== null
  );
}

function assertStoredStateIntegrity(stored: StoredRebacState): void {
  const expectedStateHash = `sha256:${stableHash(stored.state)}`;

  if (stored.stateHash !== expectedStateHash) {
    throw new Error("ReBAC runtime state hash does not match the stored state payload.");
  }
}

function countStateEntities(state: RebacSeedData): RebacStateStorageReceipt["entityCounts"] {
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
    auditEvents: state.auditEvents?.length ?? 0
  };
}
