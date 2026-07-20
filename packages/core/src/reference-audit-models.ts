import type {
  AuditEvent,
  CanonicalId,
  EvidenceExport,
  EvidenceStorageReceipt
} from "./domain.js";
import type { ReferenceRepositoryBackupMetadata } from "./reference-repositories.js";

export interface ReferenceAuditRetentionPolicy {
  policyId: CanonicalId;
  retentionDays: number;
  legalHold: boolean;
  version: "production-audit-retention-policy:v1";
}

export interface ReferenceAuditEventStoreRecord {
  version: "production-audit-event-record:v1";
  tenantBoundary: string;
  sequence: number;
  storedAt: string;
  eventHash: string;
  previousEventHash?: string;
  retentionPolicy: ReferenceAuditRetentionPolicy;
  event: AuditEvent;
  recordHash: string;
}

export interface ReferenceEvidenceStoreRecord {
  version: "production-evidence-package-record:v1";
  tenantBoundary: string;
  exportId: CanonicalId;
  storedAt: string;
  packageHash: string;
  retentionPolicy: ReferenceAuditRetentionPolicy;
  evidence: EvidenceExport;
  receipt: EvidenceStorageReceipt;
  recordHash: string;
}

export interface ReferenceSignedAuditWindow {
  version: "production-signed-audit-window:v1";
  tenantBoundary: string;
  windowId: CanonicalId;
  periodStart: string;
  periodEnd: string;
  signedAt: string;
  signingKeyId: CanonicalId;
  eventCount: number;
  sourceEventIds: CanonicalId[];
  firstEventHash?: string;
  lastEventHash?: string;
  retentionPolicy: ReferenceAuditRetentionPolicy;
  signatureAlgorithm: "hmac-sha256";
  signatureHash: string;
  recordHash: string;
}

export type ReferenceSiemDeliveryStatus = "delivered" | "failed";

export interface ReferenceSiemDeliveryRecord {
  version: "production-siem-delivery:v1";
  tenantBoundary: string;
  deliveryId: CanonicalId;
  windowId: CanonicalId;
  destination: string;
  status: ReferenceSiemDeliveryStatus;
  attemptedAt: string;
  sourceEventIds: CanonicalId[];
  eventCount: number;
  lastEventHash?: string;
  deliveredAt?: string;
  error?: string;
  replayOfDeliveryId?: CanonicalId;
  recordHash: string;
}

export interface ReferenceAuditStoreBackup {
  version: "production-audit-store-backup:v1";
  id: CanonicalId;
  tenantBoundary: string;
  createdAt: string;
  auditRecords: ReferenceAuditEventStoreRecord[];
  evidenceRecords: ReferenceEvidenceStoreRecord[];
  signedWindows: ReferenceSignedAuditWindow[];
  siemDeliveries: ReferenceSiemDeliveryRecord[];
  backupMetadata: ReferenceRepositoryBackupMetadata[];
  backupHash: string;
}

export interface ReferenceAuditRestoreReceipt {
  restoredAt: string;
  backend: "external";
  location: string;
  tenantBoundary: string;
  eventCount: number;
  evidencePackageCount: number;
  signedWindowCount: number;
  siemDeliveryCount: number;
  backupId: CanonicalId;
  version: "production-audit-restore-receipt:v1";
}

export interface ExternalAppendOnlyAuditStore {
  readAuditRecords(): ReferenceAuditEventStoreRecord[];
  appendAuditRecord(record: ReferenceAuditEventStoreRecord): void;
  readEvidenceRecords(): ReferenceEvidenceStoreRecord[];
  appendEvidenceRecord(record: ReferenceEvidenceStoreRecord): void;
  readSignedWindows(): ReferenceSignedAuditWindow[];
  appendSignedWindow(window: ReferenceSignedAuditWindow): void;
  readSiemDeliveryLogEntries(): ReferenceSiemDeliveryRecord[];
  appendSiemDeliveryLogEntry(delivery: ReferenceSiemDeliveryRecord): void;
  readBackupMetadata(): ReferenceRepositoryBackupMetadata[];
  writeBackupMetadata(metadata: ReferenceRepositoryBackupMetadata[]): void;
  readBackup(id: CanonicalId): ReferenceAuditStoreBackup | undefined;
  writeBackup(id: CanonicalId, backup: ReferenceAuditStoreBackup): void;
  restoreSnapshot(snapshot: {
    auditRecords: ReferenceAuditEventStoreRecord[];
    evidenceRecords: ReferenceEvidenceStoreRecord[];
    signedWindows: ReferenceSignedAuditWindow[];
    siemDeliveries: ReferenceSiemDeliveryRecord[];
    backupMetadata: ReferenceRepositoryBackupMetadata[];
  }): void;
}

export interface ReferenceAuditEvidenceAdapterOptions {
  store: ExternalAppendOnlyAuditStore;
  tenantBoundary: string;
  location: string;
  retentionDays?: number;
  retentionPolicyId?: CanonicalId;
  signingKeyId?: CanonicalId;
  signingKeyMaterial: string;
  now?: () => string;
}

export interface ReferenceAuditWindowRequest {
  windowId: CanonicalId;
  periodStart: string;
  periodEnd: string;
  signedAt?: string;
  signingKeyId?: CanonicalId;
}

export interface ReferenceSiemDeliveryRequest {
  windowId: CanonicalId;
  destination: string;
  status: ReferenceSiemDeliveryStatus;
  attemptedAt?: string;
  deliveredAt?: string;
  error?: string;
}

export interface ReferenceSiemReplayRequest {
  deliveryId: CanonicalId;
  attemptedAt?: string;
  destination?: string;
  status?: ReferenceSiemDeliveryStatus;
  deliveredAt?: string;
  error?: string;
}

export interface ReferenceAuditWindowSigner {
  readonly keyId: CanonicalId;
  readonly algorithm: "hmac-sha256";
  sign(payload: unknown): string;
  verify(payload: unknown, signature: string): boolean;
}
