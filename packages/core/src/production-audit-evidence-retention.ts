import type {
  EvidenceExport,
  EvidenceStorageReceipt
} from "./domain.js";
import type {
  ExternalAppendOnlyAuditStore,
  ProductionAuditRetentionPolicy,
  ProductionEvidenceStoreRecord
} from "./production-audit-models.js";
import type { ProductionAuditIntegrityValidator } from "./production-audit-integrity.js";
import {
  assertNoSecretMaterial,
  clone,
  cloneOptional,
  withRecordHash
} from "./production-audit-utils.js";

export interface ProductionEvidencePackageRetentionOptions {
  store: ExternalAppendOnlyAuditStore;
  tenantBoundary: string;
  location: string;
  retentionPolicy: ProductionAuditRetentionPolicy;
  integrity: ProductionAuditIntegrityValidator;
}

export class ProductionEvidencePackageRetention {
  readonly #store: ExternalAppendOnlyAuditStore;
  readonly #tenantBoundary: string;
  readonly #location: string;
  readonly #retentionPolicy: ProductionAuditRetentionPolicy;
  readonly #integrity: ProductionAuditIntegrityValidator;

  constructor(options: ProductionEvidencePackageRetentionOptions) {
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
    const record = withRecordHash<ProductionEvidenceStoreRecord>({
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
