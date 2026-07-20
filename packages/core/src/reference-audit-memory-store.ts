import type { CanonicalId } from "./domain.js";
import type { ReferenceRepositoryBackupMetadata } from "./reference-repositories.js";
import type {
  ExternalAppendOnlyAuditStore,
  ReferenceAuditEventStoreRecord,
  ReferenceAuditStoreBackup,
  ReferenceEvidenceStoreRecord,
  ReferenceSiemDeliveryRecord,
  ReferenceSignedAuditWindow
} from "./reference-audit-models.js";
import { clone, cloneOptional } from "./reference-audit-utils.js";

export class InMemoryExternalAppendOnlyAuditStore implements ExternalAppendOnlyAuditStore {
  #auditRecords: ReferenceAuditEventStoreRecord[] = [];
  #evidenceRecords: ReferenceEvidenceStoreRecord[] = [];
  #signedWindows: ReferenceSignedAuditWindow[] = [];
  #siemDeliveries: ReferenceSiemDeliveryRecord[] = [];
  #backupMetadata: ReferenceRepositoryBackupMetadata[] = [];
  readonly #backups = new Map<CanonicalId, ReferenceAuditStoreBackup>();

  readAuditRecords(): ReferenceAuditEventStoreRecord[] {
    return clone(this.#auditRecords);
  }

  appendAuditRecord(record: ReferenceAuditEventStoreRecord): void {
    if (this.#auditRecords.some((entry) => entry.event.eventId === record.event.eventId)) {
      throw new Error(`Reference audit event ${record.event.eventId} has already been appended.`);
    }
    this.#auditRecords.push(clone(record));
  }

  readEvidenceRecords(): ReferenceEvidenceStoreRecord[] {
    return clone(this.#evidenceRecords);
  }

  appendEvidenceRecord(record: ReferenceEvidenceStoreRecord): void {
    if (this.#evidenceRecords.some((entry) => entry.exportId === record.exportId)) {
      throw new Error(`Reference evidence package ${record.exportId} has already been retained.`);
    }
    this.#evidenceRecords.push(clone(record));
  }

  readSignedWindows(): ReferenceSignedAuditWindow[] {
    return clone(this.#signedWindows);
  }

  appendSignedWindow(window: ReferenceSignedAuditWindow): void {
    if (this.#signedWindows.some((entry) => entry.windowId === window.windowId)) {
      throw new Error(`Reference audit window ${window.windowId} has already been signed.`);
    }
    this.#signedWindows.push(clone(window));
  }

  readSiemDeliveryLogEntries(): ReferenceSiemDeliveryRecord[] {
    return clone(this.#siemDeliveries);
  }

  appendSiemDeliveryLogEntry(delivery: ReferenceSiemDeliveryRecord): void {
    if (this.#siemDeliveries.some((entry) => entry.deliveryId === delivery.deliveryId)) {
      throw new Error(`Reference SIEM delivery ${delivery.deliveryId} has already been recorded.`);
    }
    this.#siemDeliveries.push(clone(delivery));
  }

  readBackupMetadata(): ReferenceRepositoryBackupMetadata[] {
    return clone(this.#backupMetadata);
  }

  writeBackupMetadata(metadata: ReferenceRepositoryBackupMetadata[]): void {
    this.#backupMetadata = clone(metadata);
  }

  readBackup(id: CanonicalId): ReferenceAuditStoreBackup | undefined {
    return cloneOptional(this.#backups.get(id));
  }

  writeBackup(id: CanonicalId, backup: ReferenceAuditStoreBackup): void {
    this.#backups.set(id, clone(backup));
  }

  restoreSnapshot(snapshot: {
    auditRecords: ReferenceAuditEventStoreRecord[];
    evidenceRecords: ReferenceEvidenceStoreRecord[];
    signedWindows: ReferenceSignedAuditWindow[];
    siemDeliveries: ReferenceSiemDeliveryRecord[];
    backupMetadata: ReferenceRepositoryBackupMetadata[];
  }): void {
    this.#auditRecords = clone(snapshot.auditRecords);
    this.#evidenceRecords = clone(snapshot.evidenceRecords);
    this.#signedWindows = clone(snapshot.signedWindows);
    this.#siemDeliveries = clone(snapshot.siemDeliveries);
    this.#backupMetadata = clone(snapshot.backupMetadata);
  }

  replaceAuditRecordsForTest(records: ReferenceAuditEventStoreRecord[]): void {
    this.#auditRecords = clone(records);
  }
}
