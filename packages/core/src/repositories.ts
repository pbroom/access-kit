import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { auditEventHash, stableStringify, verifyAuditChain } from "./audit.js";
import type {
  AuditEvent,
  AuditIntegrityReport,
  AuditStorageReceipt,
  EvidenceExport,
  EvidenceStorageReceipt
} from "./domain.js";

export interface AuditEventRepository {
  appendAuditEvent(event: AuditEvent, storedAt: string): AuditStorageReceipt;
  listAuditEvents(): AuditEvent[];
  verifyIntegrity(verifiedAt: string): AuditIntegrityReport;
}

export interface EvidencePackageRepository {
  writeEvidenceExport(evidence: EvidenceExport, storedAt: string): EvidenceStorageReceipt;
  readEvidenceExport(exportId: string): EvidenceExport | undefined;
}

export interface LocalFileEvidenceRepositoryOptions {
  rootDir: string;
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

function sanitizeFileSegment(value: string): string {
  return value.replaceAll(/[^a-z0-9_-]/gi, "_");
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}
