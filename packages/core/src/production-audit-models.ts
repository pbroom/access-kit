import type {
  AuditEvent,
  CanonicalId,
  EvidenceExport,
  EvidenceStorageReceipt
} from "./domain.js";
import type { ProductionRepositoryBackupMetadata } from "./production-repositories.js";

export interface ProductionAuditRetentionPolicy {
  policyId: CanonicalId;
  retentionDays: number;
  legalHold: boolean;
  version: "production-audit-retention-policy:v1";
}

export interface ProductionAuditEventStoreRecord {
  version: "production-audit-event-record:v1";
  tenantBoundary: string;
  sequence: number;
  storedAt: string;
  eventHash: string;
  previousEventHash?: string;
  retentionPolicy: ProductionAuditRetentionPolicy;
  event: AuditEvent;
  recordHash: string;
}

export interface ProductionEvidenceStoreRecord {
  version: "production-evidence-package-record:v1";
  tenantBoundary: string;
  exportId: CanonicalId;
  storedAt: string;
  packageHash: string;
  retentionPolicy: ProductionAuditRetentionPolicy;
  evidence: EvidenceExport;
  receipt: EvidenceStorageReceipt;
  recordHash: string;
}

export interface ProductionSignedAuditWindow {
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
  retentionPolicy: ProductionAuditRetentionPolicy;
  signatureAlgorithm: "hmac-sha256";
  signatureHash: string;
  recordHash: string;
}

export type ProductionSiemDeliveryStatus = "delivered" | "failed";

export interface ProductionSiemDeliveryRecord {
  version: "production-siem-delivery:v1";
  tenantBoundary: string;
  deliveryId: CanonicalId;
  windowId: CanonicalId;
  destination: string;
  status: ProductionSiemDeliveryStatus;
  attemptedAt: string;
  sourceEventIds: CanonicalId[];
  eventCount: number;
  lastEventHash?: string;
  deliveredAt?: string;
  error?: string;
  replayOfDeliveryId?: CanonicalId;
  recordHash: string;
}

export interface ProductionAuditStoreBackup {
  version: "production-audit-store-backup:v1";
  id: CanonicalId;
  tenantBoundary: string;
  createdAt: string;
  auditRecords: ProductionAuditEventStoreRecord[];
  evidenceRecords: ProductionEvidenceStoreRecord[];
  signedWindows: ProductionSignedAuditWindow[];
  siemDeliveries: ProductionSiemDeliveryRecord[];
  backupMetadata: ProductionRepositoryBackupMetadata[];
  backupHash: string;
}

export interface ProductionAuditRestoreReceipt {
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
  readAuditRecords(): ProductionAuditEventStoreRecord[];
  appendAuditRecord(record: ProductionAuditEventStoreRecord): void;
  readEvidenceRecords(): ProductionEvidenceStoreRecord[];
  appendEvidenceRecord(record: ProductionEvidenceStoreRecord): void;
  readSignedWindows(): ProductionSignedAuditWindow[];
  appendSignedWindow(window: ProductionSignedAuditWindow): void;
  readSiemDeliveries(): ProductionSiemDeliveryRecord[];
  appendSiemDelivery(delivery: ProductionSiemDeliveryRecord): void;
  readBackupMetadata(): ProductionRepositoryBackupMetadata[];
  writeBackupMetadata(metadata: ProductionRepositoryBackupMetadata[]): void;
  readBackup(id: CanonicalId): ProductionAuditStoreBackup | undefined;
  writeBackup(id: CanonicalId, backup: ProductionAuditStoreBackup): void;
  restoreSnapshot(snapshot: {
    auditRecords: ProductionAuditEventStoreRecord[];
    evidenceRecords: ProductionEvidenceStoreRecord[];
    signedWindows: ProductionSignedAuditWindow[];
    siemDeliveries: ProductionSiemDeliveryRecord[];
    backupMetadata: ProductionRepositoryBackupMetadata[];
  }): void;
}

export interface ProductionAuditEvidenceAdapterOptions {
  store: ExternalAppendOnlyAuditStore;
  tenantBoundary: string;
  location: string;
  retentionDays?: number;
  retentionPolicyId?: CanonicalId;
  signingKeyId?: CanonicalId;
  signingKeyMaterial: string;
  now?: () => string;
}

export interface ProductionAuditWindowRequest {
  windowId: CanonicalId;
  periodStart: string;
  periodEnd: string;
  signedAt?: string;
  signingKeyId?: CanonicalId;
}

export interface ProductionSiemDeliveryRequest {
  windowId: CanonicalId;
  destination: string;
  status: ProductionSiemDeliveryStatus;
  attemptedAt?: string;
  deliveredAt?: string;
  error?: string;
}

export interface ProductionSiemReplayRequest {
  deliveryId: CanonicalId;
  attemptedAt?: string;
  destination?: string;
  status?: ProductionSiemDeliveryStatus;
  deliveredAt?: string;
  error?: string;
}

export interface ProductionAuditWindowSigner {
  readonly keyId: CanonicalId;
  readonly algorithm: "hmac-sha256";
  sign(payload: unknown): string;
  verify(payload: unknown, signature: string): boolean;
}
