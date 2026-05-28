import type { CanonicalId } from "./domain.js";
import type { ProductionRepositoryBackupMetadata } from "./production-repositories.js";
import type {
  ExternalAppendOnlyAuditStore,
  ProductionAuditEventStoreRecord,
  ProductionAuditStoreBackup,
  ProductionEvidenceStoreRecord,
  ProductionSiemDeliveryRecord,
  ProductionSignedAuditWindow
} from "./production-audit-models.js";
import { clone, cloneOptional } from "./production-audit-utils.js";

export class InMemoryExternalAppendOnlyAuditStore implements ExternalAppendOnlyAuditStore {
  #auditRecords: ProductionAuditEventStoreRecord[] = [];
  #evidenceRecords: ProductionEvidenceStoreRecord[] = [];
  #signedWindows: ProductionSignedAuditWindow[] = [];
  #siemDeliveries: ProductionSiemDeliveryRecord[] = [];
  #backupMetadata: ProductionRepositoryBackupMetadata[] = [];
  readonly #backups = new Map<CanonicalId, ProductionAuditStoreBackup>();

  readAuditRecords(): ProductionAuditEventStoreRecord[] {
    return clone(this.#auditRecords);
  }

  appendAuditRecord(record: ProductionAuditEventStoreRecord): void {
    if (this.#auditRecords.some((entry) => entry.event.eventId === record.event.eventId)) {
      throw new Error(`Production audit event ${record.event.eventId} has already been appended.`);
    }
    this.#auditRecords.push(clone(record));
  }

  readEvidenceRecords(): ProductionEvidenceStoreRecord[] {
    return clone(this.#evidenceRecords);
  }

  appendEvidenceRecord(record: ProductionEvidenceStoreRecord): void {
    if (this.#evidenceRecords.some((entry) => entry.exportId === record.exportId)) {
      throw new Error(`Production evidence package ${record.exportId} has already been retained.`);
    }
    this.#evidenceRecords.push(clone(record));
  }

  readSignedWindows(): ProductionSignedAuditWindow[] {
    return clone(this.#signedWindows);
  }

  appendSignedWindow(window: ProductionSignedAuditWindow): void {
    if (this.#signedWindows.some((entry) => entry.windowId === window.windowId)) {
      throw new Error(`Production audit window ${window.windowId} has already been signed.`);
    }
    this.#signedWindows.push(clone(window));
  }

  readSiemDeliveries(): ProductionSiemDeliveryRecord[] {
    return clone(this.#siemDeliveries);
  }

  appendSiemDelivery(delivery: ProductionSiemDeliveryRecord): void {
    if (this.#siemDeliveries.some((entry) => entry.deliveryId === delivery.deliveryId)) {
      throw new Error(`Production SIEM delivery ${delivery.deliveryId} has already been recorded.`);
    }
    this.#siemDeliveries.push(clone(delivery));
  }

  readBackupMetadata(): ProductionRepositoryBackupMetadata[] {
    return clone(this.#backupMetadata);
  }

  writeBackupMetadata(metadata: ProductionRepositoryBackupMetadata[]): void {
    this.#backupMetadata = clone(metadata);
  }

  readBackup(id: CanonicalId): ProductionAuditStoreBackup | undefined {
    return cloneOptional(this.#backups.get(id));
  }

  writeBackup(id: CanonicalId, backup: ProductionAuditStoreBackup): void {
    this.#backups.set(id, clone(backup));
  }

  restoreSnapshot(snapshot: {
    auditRecords: ProductionAuditEventStoreRecord[];
    evidenceRecords: ProductionEvidenceStoreRecord[];
    signedWindows: ProductionSignedAuditWindow[];
    siemDeliveries: ProductionSiemDeliveryRecord[];
    backupMetadata: ProductionRepositoryBackupMetadata[];
  }): void {
    this.#auditRecords = clone(snapshot.auditRecords);
    this.#evidenceRecords = clone(snapshot.evidenceRecords);
    this.#signedWindows = clone(snapshot.signedWindows);
    this.#siemDeliveries = clone(snapshot.siemDeliveries);
    this.#backupMetadata = clone(snapshot.backupMetadata);
  }

  replaceAuditRecordsForTest(records: ProductionAuditEventStoreRecord[]): void {
    this.#auditRecords = clone(records);
  }
}
