import type {
  EvidenceExport,
  EvidenceStorageReceipt
} from "./domain.js";
import type {
  ExternalAppendOnlyAuditStore,
  ReferenceAuditRetentionPolicy,
  ReferenceEvidenceStoreRecord
} from "./reference-audit-models.js";
import type { ReferenceAuditIntegrityValidator } from "./reference-audit-integrity.js";
import {
  assertNoSecretMaterial,
  clone,
  cloneOptional,
  withRecordHash
} from "./reference-audit-utils.js";

export interface ReferenceEvidencePackageRetentionOptions {
  store: ExternalAppendOnlyAuditStore;
  tenantBoundary: string;
  location: string;
  retentionPolicy: ReferenceAuditRetentionPolicy;
  integrity: ReferenceAuditIntegrityValidator;
}

export class ReferenceEvidencePackageRetention {
  readonly #store: ExternalAppendOnlyAuditStore;
  readonly #tenantBoundary: string;
  readonly #location: string;
  readonly #retentionPolicy: ReferenceAuditRetentionPolicy;
  readonly #integrity: ReferenceAuditIntegrityValidator;

  constructor(options: ReferenceEvidencePackageRetentionOptions) {
    this.#store = options.store;
    this.#tenantBoundary = options.tenantBoundary;
    this.#location = options.location;
    this.#retentionPolicy = options.retentionPolicy;
    this.#integrity = options.integrity;
  }

  writeEvidenceExport(evidence: EvidenceExport, storedAt: string): EvidenceStorageReceipt {
    assertNoSecretMaterial(evidence, `Evidence package ${evidence.exportId}`);
    const existing = this.#integrity.trustedEvidenceRecords();

    if (existing.some((record) => record.exportId === evidence.exportId)) {
      throw new Error(`Evidence package ${evidence.exportId} has already been retained.`);
    }

    const packageHash = evidence.integrityManifest.packageHash;
    const receipt: EvidenceStorageReceipt = {
      exportId: evidence.exportId,
      packageHash,
      storedAt,
      backend: "external",
      location: `${this.#location}#evidence:${evidence.exportId}`,
      immutable: true,
      version: "evidence-storage-receipt:v1"
    };
    const storedEvidence: EvidenceExport = {
      ...clone(evidence),
      storageReceipt: receipt
    };
    const record = withRecordHash<ReferenceEvidenceStoreRecord>({
      version: "production-evidence-package-record:v1",
      tenantBoundary: this.#tenantBoundary,
      exportId: evidence.exportId,
      storedAt,
      packageHash,
      retentionPolicy: this.#retentionPolicy,
      evidence: storedEvidence,
      receipt,
      recordHash: ""
    });
    this.#store.appendEvidenceRecord(record);
    return receipt;
  }

  readEvidenceExport(exportId: string): EvidenceExport | undefined {
    return cloneOptional(this.#integrity.trustedEvidenceRecords().find((record) => record.exportId === exportId)?.evidence);
  }
}
