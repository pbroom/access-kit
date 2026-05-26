import { createHmac, timingSafeEqual } from "node:crypto";
import { auditEventHash, stableStringify, verifyAuditChain } from "./audit.js";
import type {
  AuditEvent,
  AuditIntegrityFinding,
  AuditIntegrityReport,
  AuditStorageReceipt,
  CanonicalId,
  EvidenceExport,
  EvidenceStorageReceipt,
  JsonRecord
} from "./domain.js";
import type { DescribedAuditEventRepository, PersistenceBackendDescriptor } from "./persistence.js";
import type { AuditEventRepository, EvidencePackageRepository } from "./repositories.js";
import type { ProductionRepositoryBackupMetadata } from "./production-repositories.js";
import { stableHash } from "./repository-envelopes.js";

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

interface ProductionAuditWindowSigner {
  readonly keyId: CanonicalId;
  readonly algorithm: "hmac-sha256";
  sign(payload: unknown): string;
  verify(payload: unknown, signature: string): boolean;
}

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

export class ProductionAuditEvidenceAdapter implements DescribedAuditEventRepository, EvidencePackageRepository {
  readonly #store: ExternalAppendOnlyAuditStore;
  readonly #tenantBoundary: string;
  readonly #location: string;
  readonly #retentionPolicy: ProductionAuditRetentionPolicy;
  readonly #windowSigner: ProductionAuditWindowSigner;
  readonly #now: () => string;

  constructor(options: ProductionAuditEvidenceAdapterOptions) {
    assertTenantBoundary(options.tenantBoundary);
    assertNoSecretMaterial(options.location, "production audit location");
    this.#store = options.store;
    this.#tenantBoundary = options.tenantBoundary;
    this.#location = options.location;
    this.#retentionPolicy = {
      policyId: options.retentionPolicyId ?? "retention:audit:default",
      retentionDays: options.retentionDays ?? 2555,
      legalHold: false,
      version: "production-audit-retention-policy:v1"
    };
    const signingKeyId = options.signingKeyId ?? "signing-key:audit-window:default";
    assertSigningKeyMaterial(options.signingKeyMaterial);
    this.#windowSigner = createHmacAuditWindowSigner(signingKeyId, options.signingKeyMaterial);
    this.#now = options.now ?? (() => new Date().toISOString());
    validateAuditStoreState(this.#store, this.#tenantBoundary, this.#windowSigner);
  }

  describePersistence(): PersistenceBackendDescriptor {
    return {
      component: "audit",
      backend: "external_append_only_audit",
      durable: true,
      immutable: true,
      capabilities: ["audit_append", "audit_hash_chain", "audit_immutability", "audit_retention", "backup_restore"],
      retentionDays: this.#retentionPolicy.retentionDays,
      location: this.#location,
      version: "persistence-backend:v1"
    };
  }

  appendAuditEvent(event: AuditEvent, storedAt: string): AuditStorageReceipt {
    assertNoSecretMaterial(event, `Audit event ${event.eventId}`);
    assertOptionalTenantBoundary(event.payload, this.#tenantBoundary, `Audit event ${event.eventId}`);
    const records = this.#trustedAuditRecords();

    if (records.some((record) => record.event.eventId === event.eventId)) {
      throw new Error(`Audit event ${event.eventId} has already been appended.`);
    }

    const previousRecord = records.at(-1);
    const expectedPreviousEventHash = previousRecord?.eventHash;

    if (event.previousEventHash !== expectedPreviousEventHash) {
      throw new Error("Audit event previousEventHash does not match the current production audit tail.");
    }

    const eventHash = auditEventHash(event);
    const record = withRecordHash<ProductionAuditEventStoreRecord>({
      version: "production-audit-event-record:v1",
      tenantBoundary: this.#tenantBoundary,
      sequence: records.length + 1,
      storedAt,
      eventHash,
      previousEventHash: event.previousEventHash,
      retentionPolicy: this.#retentionPolicy,
      event: clone(event),
      recordHash: ""
    });
    this.#store.appendAuditRecord(record);

    return {
      eventId: event.eventId,
      sequence: record.sequence,
      eventHash,
      previousEventHash: event.previousEventHash,
      storedAt,
      backend: "external",
      location: `${this.#location}#event:${record.sequence}`,
      immutable: true,
      version: "audit-storage-receipt:v1"
    };
  }

  listAuditEvents(): AuditEvent[] {
    return clone(this.#trustedAuditRecords().map((record) => record.event));
  }

  verifyIntegrity(verifiedAt: string): AuditIntegrityReport {
    const records = this.#store.readAuditRecords();
    const auditFindings = auditRecordIntegrityFindings(records, this.#tenantBoundary);
    const windows = this.#store.readSignedWindows();
    const deliveries = this.#store.readSiemDeliveries();
    const events = records.map((record) => record.event);
    const report = verifyAuditChain(events, verifiedAt);
    const findings = [
      ...auditFindings,
      ...signedWindowIntegrityFindings(windows, records, this.#tenantBoundary, this.#windowSigner),
      ...siemDeliveryIntegrityFindings(deliveries, windows, this.#tenantBoundary, { includeOperationalFailures: true }),
      ...report.findings
    ];

    return {
      ...report,
      status: report.status === "verified" && findings.length === 0 ? "verified" : "failed",
      findings
    };
  }

  writeEvidenceExport(evidence: EvidenceExport, storedAt: string): EvidenceStorageReceipt {
    assertNoSecretMaterial(evidence, `Evidence package ${evidence.exportId}`);
    const existing = this.#trustedEvidenceRecords();

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
    return cloneOptional(this.#trustedEvidenceRecords().find((record) => record.exportId === exportId)?.evidence);
  }

  signAuditWindow(request: ProductionAuditWindowRequest): ProductionSignedAuditWindow {
    const records = this.#trustedAuditRecords();
    const signedAt = request.signedAt ?? this.#now();
    const events = records
      .map((record) => record.event)
      .filter((event) => event.occurredAt >= request.periodStart && event.occurredAt <= request.periodEnd);
    const signingKeyId = request.signingKeyId ?? this.#windowSigner.keyId;
    if (signingKeyId !== this.#windowSigner.keyId) {
      throw new Error(`Production audit window signer ${signingKeyId} is not configured for this adapter.`);
    }
    const firstEvent = events.at(0);
    const lastEvent = events.at(-1);
    const windowWithoutHashes = {
      version: "production-signed-audit-window:v1" as const,
      tenantBoundary: this.#tenantBoundary,
      windowId: request.windowId,
      periodStart: request.periodStart,
      periodEnd: request.periodEnd,
      signedAt,
      signingKeyId,
      eventCount: events.length,
      sourceEventIds: events.map((event) => event.eventId),
      firstEventHash: firstEvent ? auditEventHash(firstEvent) : undefined,
      lastEventHash: lastEvent ? auditEventHash(lastEvent) : undefined,
      retentionPolicy: this.#retentionPolicy,
      signatureAlgorithm: this.#windowSigner.algorithm
    };
    const window = withRecordHash<ProductionSignedAuditWindow>({
      ...windowWithoutHashes,
      signatureHash: this.#windowSigner.sign(windowWithoutHashes),
      recordHash: ""
    });
    this.#store.appendSignedWindow(window);
    return clone(window);
  }

  listSignedAuditWindows(): ProductionSignedAuditWindow[] {
    const windows = this.#store.readSignedWindows();
    const findings = signedWindowIntegrityFindings(windows, this.#store.readAuditRecords(), this.#tenantBoundary, this.#windowSigner);
    assertNoIntegrityFindings(findings, "Production signed audit window integrity check failed");
    return clone(windows);
  }

  recordSiemDelivery(request: ProductionSiemDeliveryRequest): ProductionSiemDeliveryRecord {
    const windows = this.listSignedAuditWindows();
    const window = windows.find((entry) => entry.windowId === request.windowId);

    if (!window) {
      throw new Error(`Production audit window ${request.windowId} must be signed before SIEM delivery is recorded.`);
    }

    if (request.status === "failed" && !request.error) {
      throw new Error("Failed SIEM deliveries require an error message.");
    }

    assertNoSecretMaterial(request, `SIEM delivery ${request.windowId}`);
    const attemptedAt = request.attemptedAt ?? this.#now();
    const delivery = withRecordHash<ProductionSiemDeliveryRecord>({
      version: "production-siem-delivery:v1",
      tenantBoundary: this.#tenantBoundary,
      deliveryId: `siem-delivery:${stableHash({ windowId: request.windowId, attemptedAt, destination: request.destination }).slice(0, 24)}`,
      windowId: request.windowId,
      destination: request.destination,
      status: request.status,
      attemptedAt,
      sourceEventIds: clone(window.sourceEventIds),
      eventCount: window.eventCount,
      lastEventHash: window.lastEventHash,
      deliveredAt: request.status === "delivered" ? request.deliveredAt ?? attemptedAt : request.deliveredAt,
      error: request.error,
      recordHash: ""
    });
    this.#store.appendSiemDelivery(delivery);
    return clone(delivery);
  }

  replaySiemDelivery(request: ProductionSiemReplayRequest): ProductionSiemDeliveryRecord {
    const deliveries = this.#store.readSiemDeliveries();
    const failedDelivery = deliveries.find((delivery) => delivery.deliveryId === request.deliveryId);

    if (!failedDelivery) {
      throw new Error(`Production SIEM delivery ${request.deliveryId} does not exist.`);
    }
    if (failedDelivery.status !== "failed") {
      throw new Error(`Production SIEM delivery ${request.deliveryId} is not failed and cannot be replayed.`);
    }

    const attemptedAt = request.attemptedAt ?? this.#now();
    const status = request.status ?? "delivered";
    if (status === "failed" && !request.error) {
      throw new Error("Failed SIEM replay deliveries require an error message.");
    }
    assertNoSecretMaterial(request, `SIEM delivery replay ${request.deliveryId}`);
    const delivery = withRecordHash<ProductionSiemDeliveryRecord>({
      version: "production-siem-delivery:v1",
      tenantBoundary: this.#tenantBoundary,
      deliveryId: `siem-delivery:${stableHash({ replayOfDeliveryId: request.deliveryId, attemptedAt }).slice(0, 24)}`,
      windowId: failedDelivery.windowId,
      destination: request.destination ?? failedDelivery.destination,
      status,
      attemptedAt,
      sourceEventIds: clone(failedDelivery.sourceEventIds),
      eventCount: failedDelivery.eventCount,
      lastEventHash: failedDelivery.lastEventHash,
      deliveredAt: status === "delivered" ? request.deliveredAt ?? attemptedAt : request.deliveredAt,
      error: request.error,
      replayOfDeliveryId: failedDelivery.deliveryId,
      recordHash: ""
    });
    this.#store.appendSiemDelivery(delivery);
    return clone(delivery);
  }

  listSiemDeliveries(): ProductionSiemDeliveryRecord[] {
    const deliveries = this.#store.readSiemDeliveries();
    const findings = siemDeliveryIntegrityFindings(deliveries, this.#store.readSignedWindows(), this.#tenantBoundary);
    assertNoIntegrityFindings(findings, "Production SIEM delivery integrity check failed");
    return clone(deliveries);
  }

  createBackup(id: CanonicalId, createdAt: string = this.#now()): ProductionRepositoryBackupMetadata {
    validateAuditStoreState(this.#store, this.#tenantBoundary, this.#windowSigner);
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
        siemDeliveries: this.#store.readSiemDeliveries()
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
      siemDeliveries: this.#store.readSiemDeliveries(),
      backupMetadata: [...currentMetadata, metadata],
      backupHash: ""
    });

    this.#store.writeBackup(id, backup);
    this.#store.writeBackupMetadata(backup.backupMetadata);
    return clone(metadata);
  }

  restoreBackup(id: CanonicalId, restoredAt: string = this.#now()): ProductionAuditRestoreReceipt {
    const backup = this.#store.readBackup(id);

    if (!backup) {
      throw new Error(`Production audit backup ${id} does not exist.`);
    }
    validateBackup(backup, this.#tenantBoundary, this.#windowSigner);
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

  listBackupMetadata(): ProductionRepositoryBackupMetadata[] {
    return clone(this.#store.readBackupMetadata());
  }

  #trustedAuditRecords(): ProductionAuditEventStoreRecord[] {
    const records = this.#store.readAuditRecords();
    const findings = auditRecordIntegrityFindings(records, this.#tenantBoundary);
    assertNoIntegrityFindings(findings, "Stored production audit log integrity check failed");
    return records;
  }

  #trustedEvidenceRecords(): ProductionEvidenceStoreRecord[] {
    const records = this.#store.readEvidenceRecords();
    const findings = evidenceRecordIntegrityFindings(records, this.#tenantBoundary);
    assertNoIntegrityFindings(findings, "Stored production evidence integrity check failed");
    return records;
  }

  #entityCounts(): Record<string, number> {
    return {
      auditEvents: this.#store.readAuditRecords().length,
      evidencePackages: this.#store.readEvidenceRecords().length,
      signedAuditWindows: this.#store.readSignedWindows().length,
      siemDeliveries: this.#store.readSiemDeliveries().length
    };
  }
}

function validateAuditStoreState(
  store: ExternalAppendOnlyAuditStore,
  tenantBoundary: string,
  windowSigner: ProductionAuditWindowSigner
): void {
  assertNoIntegrityFindings(auditRecordIntegrityFindings(store.readAuditRecords(), tenantBoundary), "Stored production audit log integrity check failed");
  assertNoIntegrityFindings(evidenceRecordIntegrityFindings(store.readEvidenceRecords(), tenantBoundary), "Stored production evidence integrity check failed");
  assertNoIntegrityFindings(
    signedWindowIntegrityFindings(store.readSignedWindows(), store.readAuditRecords(), tenantBoundary, windowSigner),
    "Stored production signed audit window integrity check failed"
  );
  assertNoIntegrityFindings(
    siemDeliveryIntegrityFindings(store.readSiemDeliveries(), store.readSignedWindows(), tenantBoundary),
    "Stored production SIEM delivery integrity check failed"
  );
}

function auditRecordIntegrityFindings(
  records: ProductionAuditEventStoreRecord[],
  tenantBoundary: string
): AuditIntegrityFinding[] {
  const seenEventIds = new Set<CanonicalId>();

  return records.flatMap((record, index) => {
    const findings: AuditIntegrityFinding[] = [];
    const expectedSequence = index + 1;
    const expectedEventHash = auditEventHash(record.event);

    if (record.version !== "production-audit-event-record:v1") {
      findings.push(finding("AUDIT_RECORD_VERSION_MISMATCH", "Stored production audit record has an unsupported version.", record.event.eventId));
    }
    if (seenEventIds.has(record.event.eventId)) {
      findings.push(finding("AUDIT_RECORD_DUPLICATE_EVENT_ID", "Stored production audit record duplicates a prior event identifier.", record.event.eventId));
    } else {
      seenEventIds.add(record.event.eventId);
    }
    if (record.tenantBoundary !== tenantBoundary) {
      findings.push(finding("AUDIT_TENANT_BOUNDARY_MISMATCH", "Stored production audit record tenant boundary does not match the adapter.", record.event.eventId));
    }
    if (record.sequence !== expectedSequence) {
      findings.push(finding("AUDIT_RECORD_SEQUENCE_MISMATCH", "Stored production audit record sequence does not match append-only order.", record.event.eventId, String(expectedSequence), String(record.sequence)));
    }
    if (record.eventHash !== expectedEventHash) {
      findings.push(finding("AUDIT_RECORD_HASH_MISMATCH", "Stored production audit record hash does not match the current event payload.", record.event.eventId, expectedEventHash, record.eventHash));
    }
    if (record.previousEventHash !== record.event.previousEventHash) {
      findings.push(finding("AUDIT_RECORD_PREVIOUS_HASH_MISMATCH", "Stored production audit record previous hash does not match the event previousEventHash.", record.event.eventId, record.event.previousEventHash ?? "<none>", record.previousEventHash ?? "<none>"));
    }
    const expectedRecordHash = hashRecord(record);
    if (record.recordHash !== expectedRecordHash) {
      findings.push(finding("AUDIT_RECORD_ENVELOPE_HASH_MISMATCH", "Stored production audit record envelope hash does not match the current record.", record.event.eventId, expectedRecordHash, record.recordHash));
    }
    findings.push(...secretMaterialFindings(record.event, `Audit event ${record.event.eventId}`));
    return findings;
  });
}

function evidenceRecordIntegrityFindings(
  records: ProductionEvidenceStoreRecord[],
  tenantBoundary: string
): AuditIntegrityFinding[] {
  return records.flatMap((record) => {
    const findings: AuditIntegrityFinding[] = [];

    if (record.version !== "production-evidence-package-record:v1") {
      findings.push(finding("EVIDENCE_RECORD_VERSION_MISMATCH", "Stored production evidence record has an unsupported version.", record.exportId));
    }
    if (record.tenantBoundary !== tenantBoundary) {
      findings.push(finding("EVIDENCE_TENANT_BOUNDARY_MISMATCH", "Stored production evidence record tenant boundary does not match the adapter.", record.exportId));
    }
    if (record.packageHash !== record.evidence.integrityManifest.packageHash) {
      findings.push(finding("EVIDENCE_PACKAGE_HASH_MISMATCH", "Stored production evidence package hash does not match the integrity manifest.", record.exportId, record.evidence.integrityManifest.packageHash, record.packageHash));
    }
    if (record.receipt.packageHash !== record.packageHash || record.evidence.storageReceipt?.packageHash !== record.packageHash) {
      findings.push(finding("EVIDENCE_RECEIPT_HASH_MISMATCH", "Stored production evidence receipt does not match the retained package hash.", record.exportId));
    }
    const expectedRecordHash = hashRecord(record);
    if (record.recordHash !== expectedRecordHash) {
      findings.push(finding("EVIDENCE_RECORD_ENVELOPE_HASH_MISMATCH", "Stored production evidence record envelope hash does not match the current record.", record.exportId, expectedRecordHash, record.recordHash));
    }
    findings.push(...secretMaterialFindings(record.evidence, `Evidence package ${record.exportId}`));
    return findings;
  });
}

function signedWindowIntegrityFindings(
  windows: ProductionSignedAuditWindow[],
  records: ProductionAuditEventStoreRecord[],
  tenantBoundary: string,
  windowSigner: ProductionAuditWindowSigner
): AuditIntegrityFinding[] {
  return windows.flatMap((window) => {
    const findings: AuditIntegrityFinding[] = [];
    const events = records
      .map((record) => record.event)
      .filter((event) => event.occurredAt >= window.periodStart && event.occurredAt <= window.periodEnd);
    const firstEvent = events.at(0);
    const lastEvent = events.at(-1);
    const signaturePayload = {
      version: window.version,
      tenantBoundary: window.tenantBoundary,
      windowId: window.windowId,
      periodStart: window.periodStart,
      periodEnd: window.periodEnd,
      signedAt: window.signedAt,
      signingKeyId: window.signingKeyId,
      eventCount: window.eventCount,
      sourceEventIds: window.sourceEventIds,
      firstEventHash: window.firstEventHash,
      lastEventHash: window.lastEventHash,
      retentionPolicy: window.retentionPolicy,
      signatureAlgorithm: window.signatureAlgorithm
    };

    if (window.tenantBoundary !== tenantBoundary) {
      findings.push(finding("AUDIT_WINDOW_TENANT_BOUNDARY_MISMATCH", "Signed audit window tenant boundary does not match the adapter.", window.windowId));
    }
    if (window.eventCount !== events.length) {
      findings.push(finding("AUDIT_WINDOW_EVENT_COUNT_MISMATCH", "Signed audit window event count no longer matches retained events.", window.windowId, String(events.length), String(window.eventCount)));
    }
    if (stableStringify(window.sourceEventIds) !== stableStringify(events.map((event) => event.eventId))) {
      findings.push(finding("AUDIT_WINDOW_SOURCE_EVENTS_MISMATCH", "Signed audit window source event identifiers no longer match retained events.", window.windowId));
    }
    if (window.firstEventHash !== (firstEvent ? auditEventHash(firstEvent) : undefined)) {
      findings.push(finding("AUDIT_WINDOW_FIRST_HASH_MISMATCH", "Signed audit window first event hash no longer matches retained events.", window.windowId));
    }
    if (window.lastEventHash !== (lastEvent ? auditEventHash(lastEvent) : undefined)) {
      findings.push(finding("AUDIT_WINDOW_LAST_HASH_MISMATCH", "Signed audit window last event hash no longer matches retained events.", window.windowId));
    }
    if (window.signatureAlgorithm !== windowSigner.algorithm) {
      findings.push(finding("AUDIT_WINDOW_SIGNATURE_ALGORITHM_MISMATCH", "Signed audit window algorithm does not match the configured signer.", window.windowId, windowSigner.algorithm, window.signatureAlgorithm));
    }
    if (window.signingKeyId !== windowSigner.keyId) {
      findings.push(finding("AUDIT_WINDOW_SIGNING_KEY_MISMATCH", "Signed audit window key does not match the configured signer.", window.windowId, windowSigner.keyId, window.signingKeyId));
    }
    if (!windowSigner.verify(signaturePayload, window.signatureHash)) {
      findings.push(finding("AUDIT_WINDOW_SIGNATURE_MISMATCH", "Signed audit window signature hash does not match the retained window metadata.", window.windowId));
    }
    const expectedRecordHash = hashRecord(window);
    if (window.recordHash !== expectedRecordHash) {
      findings.push(finding("AUDIT_WINDOW_RECORD_HASH_MISMATCH", "Signed audit window envelope hash does not match the current record.", window.windowId, expectedRecordHash, window.recordHash));
    }
    return findings;
  });
}

function siemDeliveryIntegrityFindings(
  deliveries: ProductionSiemDeliveryRecord[],
  windows: ProductionSignedAuditWindow[],
  tenantBoundary: string,
  options: { includeOperationalFailures?: boolean } = {}
): AuditIntegrityFinding[] {
  return deliveries.flatMap((delivery) => {
    const findings: AuditIntegrityFinding[] = [];
    const window = windows.find((entry) => entry.windowId === delivery.windowId);
    const replayed = deliveries.some((entry) => entry.replayOfDeliveryId === delivery.deliveryId && entry.status === "delivered");

    if (delivery.tenantBoundary !== tenantBoundary) {
      findings.push(finding("SIEM_DELIVERY_TENANT_BOUNDARY_MISMATCH", "SIEM delivery tenant boundary does not match the adapter.", delivery.deliveryId));
    }
    if (!window) {
      findings.push(finding("SIEM_DELIVERY_WINDOW_MISSING", "SIEM delivery references an unsigned audit window.", delivery.deliveryId));
    } else {
      if (stableStringify(delivery.sourceEventIds) !== stableStringify(window.sourceEventIds)) {
        findings.push(finding("SIEM_DELIVERY_SOURCE_EVENTS_MISMATCH", "SIEM delivery source event identifiers do not match the signed audit window.", delivery.deliveryId));
      }
      if (delivery.lastEventHash !== window.lastEventHash) {
        findings.push(finding("SIEM_DELIVERY_LAST_HASH_MISMATCH", "SIEM delivery last event hash does not match the signed audit window.", delivery.deliveryId));
      }
    }
    if ((options.includeOperationalFailures ?? false) && delivery.status === "failed" && !replayed) {
      findings.push({
        code: "SIEM_DELIVERY_FAILED",
        message: "SIEM delivery failure is security-relevant until a replay delivery succeeds.",
        severity: "high",
        eventId: delivery.deliveryId,
        actual: delivery.error ?? "delivery failed"
      });
    }
    const expectedRecordHash = hashRecord(delivery);
    if (delivery.recordHash !== expectedRecordHash) {
      findings.push(finding("SIEM_DELIVERY_RECORD_HASH_MISMATCH", "SIEM delivery envelope hash does not match the current record.", delivery.deliveryId, expectedRecordHash, delivery.recordHash));
    }
    findings.push(...secretMaterialFindings(delivery, `SIEM delivery ${delivery.deliveryId}`));
    return findings;
  });
}

function validateBackup(
  backup: ProductionAuditStoreBackup,
  tenantBoundary: string,
  windowSigner: ProductionAuditWindowSigner
): void {
  if (backup.tenantBoundary !== tenantBoundary) {
    throw new Error(`Production audit backup ${backup.id} tenant boundary does not match the adapter.`);
  }
  if (backup.backupHash !== hashBackup(backup)) {
    throw new Error(`Production audit backup ${backup.id} hash does not match the stored snapshot.`);
  }
  assertNoIntegrityFindings(auditRecordIntegrityFindings(backup.auditRecords, tenantBoundary), "Production audit backup event integrity check failed");
  assertNoIntegrityFindings(evidenceRecordIntegrityFindings(backup.evidenceRecords, tenantBoundary), "Production audit backup evidence integrity check failed");
  assertNoIntegrityFindings(
    signedWindowIntegrityFindings(backup.signedWindows, backup.auditRecords, tenantBoundary, windowSigner),
    "Production audit backup signed-window integrity check failed"
  );
  assertNoIntegrityFindings(
    siemDeliveryIntegrityFindings(backup.siemDeliveries, backup.signedWindows, tenantBoundary),
    "Production audit backup SIEM delivery integrity check failed"
  );
}

function createHmacAuditWindowSigner(keyId: CanonicalId, keyMaterial: string): ProductionAuditWindowSigner {
  return {
    keyId,
    algorithm: "hmac-sha256",
    sign: (payload) => `hmac-sha256:${createHmac("sha256", keyMaterial).update(stableStringify(payload)).digest("hex")}`,
    verify: (payload, signature) => {
      const expected = `hmac-sha256:${createHmac("sha256", keyMaterial).update(stableStringify(payload)).digest("hex")}`;
      const expectedBytes = Buffer.from(expected);
      const actualBytes = Buffer.from(signature);

      return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
    }
  };
}

function assertSigningKeyMaterial(keyMaterial: string): void {
  if (keyMaterial.trim().length === 0) {
    throw new Error("Production audit signing key material is required.");
  }
}

function withRecordHash<T extends { recordHash: string }>(record: T): T {
  return {
    ...record,
    recordHash: hashRecord(record)
  };
}

function hashRecord(record: { recordHash?: string }): string {
  const withoutHash = { ...record };
  delete withoutHash.recordHash;
  return hashReference(withoutHash);
}

function withBackupHash(backup: ProductionAuditStoreBackup): ProductionAuditStoreBackup {
  return {
    ...backup,
    backupHash: hashBackup(backup)
  };
}

function hashBackup(backup: ProductionAuditStoreBackup): string {
  return hashReference({
    version: backup.version,
    id: backup.id,
    tenantBoundary: backup.tenantBoundary,
    createdAt: backup.createdAt,
    auditRecords: backup.auditRecords,
    evidenceRecords: backup.evidenceRecords,
    signedWindows: backup.signedWindows,
    siemDeliveries: backup.siemDeliveries,
    backupMetadata: backup.backupMetadata
  });
}

function hashReference(value: unknown): string {
  return `sha256:${stableHash(value)}`;
}

function createBackupMetadata(metadata: Omit<ProductionRepositoryBackupMetadata, "version">): ProductionRepositoryBackupMetadata {
  return {
    ...metadata,
    version: "production-repository-backup:v1"
  };
}

function finding(
  code: string,
  message: string,
  eventId?: CanonicalId,
  expected?: string,
  actual?: string
): AuditIntegrityFinding {
  return {
    code,
    message,
    severity: "critical",
    eventId,
    expected,
    actual
  };
}

function assertNoIntegrityFindings(findings: AuditIntegrityFinding[], prefix: string): void {
  if (findings.length > 0) {
    throw new Error(`${prefix}: ${findings[0]?.message ?? "unknown finding"}`);
  }
}

function assertTenantBoundary(tenantBoundary: string): void {
  if (tenantBoundary.length === 0) {
    throw new Error("Production audit adapters require a tenant boundary.");
  }
}

function assertOptionalTenantBoundary(payload: JsonRecord, tenantBoundary: string, label: string): void {
  const payloadTenantBoundary = payload.tenantBoundary;

  if (payloadTenantBoundary !== undefined && payloadTenantBoundary !== tenantBoundary) {
    throw new Error(`${label} includes tenantBoundary ${String(payloadTenantBoundary)} outside ${tenantBoundary}.`);
  }
}

function assertNoSecretMaterial(value: unknown, path: string): void {
  const findings = secretMaterialFindings(value, path);

  if (findings.length > 0) {
    throw new Error(`${findings[0]?.message ?? "Secret material must be redacted before production audit persistence."}`);
  }
}

function secretMaterialFindings(value: unknown, path: string): AuditIntegrityFinding[] {
  if (typeof value === "string") {
    return isSensitiveString(value)
      ? [
          {
            code: "SECRET_MATERIAL_NOT_REDACTED",
            message: `${path} contains secret-looking material and must be redacted before production audit persistence.`,
            severity: "critical",
            actual: path
          }
        ]
      : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => secretMaterialFindings(entry, `${path}[${index}]`));
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => {
    const nextPath = `${path}.${key}`;
    const findings: AuditIntegrityFinding[] = [];

    if (isSensitiveKey(key)) {
      findings.push({
        code: "SECRET_MATERIAL_NOT_REDACTED",
        message: `${nextPath} contains secret material and must be redacted before production audit persistence.`,
        severity: "critical",
        actual: nextPath
      });
    }

    return [...findings, ...secretMaterialFindings(entry, nextPath)];
  });
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.replaceAll(/[-_\s]/g, "").toLowerCase();

  return /(secret|password|credential|privatekey)/i.test(normalized)
    || [
      "accesskey",
      "apikey",
      "apitoken",
      "authtoken",
      "authorization",
      "bearertoken",
      "cookie",
      "idtoken",
      "refreshtoken",
      "setcookie",
      "token",
      "tokenmaterial",
      "tokenvalue",
      "xapikey",
      "accesstoken"
    ].includes(normalized);
}

function isSensitiveString(value: string): boolean {
  return /\bBearer\s+[A-Za-z0-9._~+/=-]+/i.test(value)
    || /\b(access_token|refresh_token|id_token|api_key)=/i.test(value)
    || /\b(sk-[A-Za-z0-9_-]{12,}|xox[baprs]-[A-Za-z0-9-]{12,})\b/i.test(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneOptional<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : clone(value);
}

export type ProductionAuditRepository = AuditEventRepository & EvidencePackageRepository & DescribedAuditEventRepository;
