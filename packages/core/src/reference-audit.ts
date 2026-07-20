import type {
  AuditEvent,
  AuditIntegrityReport,
  AuditStorageReceipt,
  CanonicalId,
  EvidenceExport,
  EvidenceStorageReceipt
} from "./domain.js";
import type { DescribedAuditEventRepository, PersistenceBackendDescriptor } from "./persistence.js";
import type { AuditEventRepository, EvidencePackageRepository } from "./repositories.js";
import type { ReferenceRepositoryBackupMetadata } from "./reference-repositories.js";
import {
  ReferenceAuditBackupVault
} from "./reference-audit-backups.js";
import {
  ReferenceEvidencePackageRetention
} from "./reference-audit-evidence-retention.js";
import {
  ReferenceAuditIntegrityValidator
} from "./reference-audit-integrity.js";
import {
  ReferenceAuditLogStorage
} from "./reference-audit-log-storage.js";
import type {
  ReferenceAuditEvidenceAdapterOptions,
  ReferenceAuditRestoreReceipt,
  ReferenceAuditRetentionPolicy,
  ReferenceAuditWindowRequest,
  ReferenceAuditWindowSigner,
  ReferenceSiemDeliveryRecord,
  ReferenceSiemDeliveryRequest,
  ReferenceSiemReplayRequest,
  ReferenceSignedAuditWindow
} from "./reference-audit-models.js";
import {
  ReferenceSiemDeliveryLog
} from "./reference-audit-siem.js";
import {
  assertSigningKeyMaterial,
  createHmacAuditWindowSigner,
  ReferenceSignedAuditWindowRegistry
} from "./reference-audit-signed-windows.js";
import {
  assertNoSecretMaterial,
  assertTenantBoundary
} from "./reference-audit-utils.js";

export * from "./reference-audit-backups.js";
export * from "./reference-audit-evidence-retention.js";
export * from "./reference-audit-integrity.js";
export * from "./reference-audit-log-storage.js";
export * from "./reference-audit-memory-store.js";
export * from "./reference-audit-models.js";
export * from "./reference-audit-siem.js";
export { ReferenceSignedAuditWindowRegistry } from "./reference-audit-signed-windows.js";
export type { ReferenceSignedAuditWindowRegistryOptions } from "./reference-audit-signed-windows.js";

export class ReferenceAuditEvidenceAdapter implements DescribedAuditEventRepository, EvidencePackageRepository {
  readonly #location: string;
  readonly #retentionPolicy: ReferenceAuditRetentionPolicy;
  readonly #now: () => string;
  readonly #auditLog: ReferenceAuditLogStorage;
  readonly #evidenceRetention: ReferenceEvidencePackageRetention;
  readonly #integrity: ReferenceAuditIntegrityValidator;
  readonly #signedWindows: ReferenceSignedAuditWindowRegistry;
  readonly #siemDeliveries: ReferenceSiemDeliveryLog;
  readonly #backups: ReferenceAuditBackupVault;

  constructor(options: ReferenceAuditEvidenceAdapterOptions) {
    assertTenantBoundary(options.tenantBoundary);
    assertNoSecretMaterial(options.location, "production audit location");
    const now = options.now ?? (() => new Date().toISOString());
    const retentionPolicy: ReferenceAuditRetentionPolicy = {
      policyId: options.retentionPolicyId ?? "retention:audit:default",
      retentionDays: options.retentionDays ?? 2555,
      legalHold: false,
      version: "production-audit-retention-policy:v1"
    };
    const signingKeyId = options.signingKeyId ?? "signing-key:audit-window:default";
    assertSigningKeyMaterial(options.signingKeyMaterial);
    const windowSigner: ReferenceAuditWindowSigner = createHmacAuditWindowSigner(signingKeyId, options.signingKeyMaterial);

    this.#location = options.location;
    this.#retentionPolicy = retentionPolicy;
    this.#now = now;
    this.#integrity = new ReferenceAuditIntegrityValidator(options.store, options.tenantBoundary, windowSigner);
    this.#auditLog = new ReferenceAuditLogStorage({
      store: options.store,
      tenantBoundary: options.tenantBoundary,
      location: options.location,
      retentionPolicy,
      integrity: this.#integrity
    });
    this.#evidenceRetention = new ReferenceEvidencePackageRetention({
      store: options.store,
      tenantBoundary: options.tenantBoundary,
      location: options.location,
      retentionPolicy,
      integrity: this.#integrity
    });
    this.#signedWindows = new ReferenceSignedAuditWindowRegistry({
      store: options.store,
      tenantBoundary: options.tenantBoundary,
      retentionPolicy,
      windowSigner,
      integrity: this.#integrity,
      now
    });
    this.#siemDeliveries = new ReferenceSiemDeliveryLog({
      store: options.store,
      tenantBoundary: options.tenantBoundary,
      integrity: this.#integrity,
      listSignedAuditWindows: () => this.#signedWindows.listSignedAuditWindows(),
      now
    });
    this.#backups = new ReferenceAuditBackupVault({
      store: options.store,
      tenantBoundary: options.tenantBoundary,
      location: options.location,
      integrity: this.#integrity,
      now
    });
    this.#integrity.validateStoreState();
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
    return this.#auditLog.appendAuditEvent(event, storedAt);
  }

  listAuditEvents(): AuditEvent[] {
    return this.#auditLog.listAuditEvents();
  }

  verifyIntegrity(verifiedAt: string): AuditIntegrityReport {
    return this.#integrity.verifyIntegrity(verifiedAt);
  }

  writeEvidenceExport(evidence: EvidenceExport, storedAt: string): EvidenceStorageReceipt {
    return this.#evidenceRetention.writeEvidenceExport(evidence, storedAt);
  }

  readEvidenceExport(exportId: string): EvidenceExport | undefined {
    return this.#evidenceRetention.readEvidenceExport(exportId);
  }

  signAuditWindow(request: ReferenceAuditWindowRequest): ReferenceSignedAuditWindow {
    return this.#signedWindows.signAuditWindow(request);
  }

  listSignedAuditWindows(): ReferenceSignedAuditWindow[] {
    return this.#signedWindows.listSignedAuditWindows();
  }

  recordSiemDeliveryLogEntry(request: ReferenceSiemDeliveryRequest): ReferenceSiemDeliveryRecord {
    return this.#siemDeliveries.recordSiemDeliveryLogEntry(request);
  }

  replaySiemDeliveryLogEntry(request: ReferenceSiemReplayRequest): ReferenceSiemDeliveryRecord {
    return this.#siemDeliveries.replaySiemDeliveryLogEntry(request);
  }

  listSiemDeliveryLogEntries(): ReferenceSiemDeliveryRecord[] {
    return this.#siemDeliveries.listSiemDeliveryLogEntries();
  }

  createBackup(id: CanonicalId, createdAt: string = this.#now()): ReferenceRepositoryBackupMetadata {
    return this.#backups.createBackup(id, createdAt);
  }

  restoreBackup(id: CanonicalId, restoredAt: string = this.#now()): ReferenceAuditRestoreReceipt {
    return this.#backups.restoreBackup(id, restoredAt);
  }

  listBackupMetadata(): ReferenceRepositoryBackupMetadata[] {
    return this.#backups.listBackupMetadata();
  }
}

export type ReferenceAuditRepository = AuditEventRepository & EvidencePackageRepository & DescribedAuditEventRepository;
