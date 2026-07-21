import type { CanonicalId } from "./domain.js";
import type { ReferenceRepositoryBackupMetadata } from "./reference-repositories.js";
import type { ReferenceAuditIntegrityValidator } from "./reference-audit-integrity.js";
import type {
  ExternalAppendOnlyAuditStore,
  ReferenceAuditRestoreReceipt
} from "./reference-audit-models.js";
import {
  clone,
  createBackupMetadata,
  hashReference,
  withBackupHash
} from "./reference-audit-utils.js";

export interface ReferenceAuditBackupVaultOptions {
  store: ExternalAppendOnlyAuditStore;
  tenantBoundary: string;
  location: string;
  integrity: ReferenceAuditIntegrityValidator;
  now: () => string;
}

export class ReferenceAuditBackupVault {
  readonly #store: ExternalAppendOnlyAuditStore;
  readonly #tenantBoundary: string;
  readonly #location: string;
  readonly #integrity: ReferenceAuditIntegrityValidator;
  readonly #now: () => string;

  constructor(options: ReferenceAuditBackupVaultOptions) {
    this.#store = options.store;
    this.#tenantBoundary = options.tenantBoundary;
    this.#location = options.location;
    this.#integrity = options.integrity;
    this.#now = options.now;
  }

  createBackup(id: CanonicalId, createdAt: string = this.#now()): ReferenceRepositoryBackupMetadata {
    this.#integrity.validateStoreState();
    const currentMetadata = this.#store.readBackupMetadata();
    const metadata = createBackupMetadata({
      id,
      component: "audit",
      createdAt,
      location: `${this.#location}#backup:${id}`,
      snapshotHash: hashReference({
        auditRecords: this.#store.readAuditRecords(),
        evidenceRecords: this.#store.readEvidenceRecords(),
        signedWindows: this.#store.readSignedWindows(),
        siemDeliveries: this.#store.readSiemDeliveryLogEntries()
      }),
      tenantBoundary: this.#tenantBoundary,
      entityCounts: this.#entityCounts()
    });
    const backup = withBackupHash({
      version: "production-audit-store-backup:v1",
      id,
      tenantBoundary: this.#tenantBoundary,
      createdAt,
      auditRecords: this.#store.readAuditRecords(),
      evidenceRecords: this.#store.readEvidenceRecords(),
      signedWindows: this.#store.readSignedWindows(),
      siemDeliveries: this.#store.readSiemDeliveryLogEntries(),
      backupMetadata: [...currentMetadata, metadata],
      backupHash: ""
    });

    this.#store.writeBackup(id, backup);
    this.#store.writeBackupMetadata(backup.backupMetadata);
    return clone(metadata);
  }

  restoreBackup(id: CanonicalId, restoredAt: string = this.#now()): ReferenceAuditRestoreReceipt {
    const backup = this.#store.readBackup(id);

    if (!backup) {
      throw new Error(`Reference audit backup ${id} does not exist.`);
    }
    this.#integrity.validateBackup(backup);
    this.#store.restoreSnapshot({
      auditRecords: backup.auditRecords,
      evidenceRecords: backup.evidenceRecords,
      signedWindows: backup.signedWindows,
      siemDeliveries: backup.siemDeliveries,
      backupMetadata: backup.backupMetadata
    });

    return {
      restoredAt,
      backend: "external",
      location: this.#location,
      tenantBoundary: this.#tenantBoundary,
      eventCount: backup.auditRecords.length,
      evidencePackageCount: backup.evidenceRecords.length,
      signedWindowCount: backup.signedWindows.length,
      siemDeliveryCount: backup.siemDeliveries.length,
      backupId: id,
      version: "production-audit-restore-receipt:v1"
    };
  }

  listBackupMetadata(): ReferenceRepositoryBackupMetadata[] {
    return clone(this.#store.readBackupMetadata());
  }

  #entityCounts(): Record<string, number> {
    return {
      auditEvents: this.#store.readAuditRecords().length,
      evidencePackages: this.#store.readEvidenceRecords().length,
      signedAuditWindows: this.#store.readSignedWindows().length,
      siemDeliveries: this.#store.readSiemDeliveryLogEntries().length
    };
  }
}
