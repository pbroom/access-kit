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
import type { ProductionRepositoryBackupMetadata } from "./production-repositories.js";
import {
  ProductionAuditBackupVault
} from "./production-audit-backups.js";
import {
  ProductionEvidencePackageRetention
} from "./production-audit-evidence-retention.js";
import {
  ProductionAuditIntegrityValidator
} from "./production-audit-integrity.js";
import {
  ProductionAuditLogStorage
} from "./production-audit-log-storage.js";
import type {
  ProductionAuditEvidenceAdapterOptions,
  ProductionAuditRestoreReceipt,
  ProductionAuditRetentionPolicy,
  ProductionAuditWindowRequest,
  ProductionAuditWindowSigner,
  ProductionSiemDeliveryRecord,
  ProductionSiemDeliveryRequest,
  ProductionSiemReplayRequest,
  ProductionSignedAuditWindow
} from "./production-audit-models.js";
import {
  ProductionSiemDeliveryLog
} from "./production-audit-siem.js";
import {
  assertSigningKeyMaterial,
  createHmacAuditWindowSigner,
  ProductionSignedAuditWindowRegistry
} from "./production-audit-signed-windows.js";
import {
  assertNoSecretMaterial,
  assertTenantBoundary
} from "./production-audit-utils.js";

export * from "./production-audit-backups.js";
export * from "./production-audit-evidence-retention.js";
export * from "./production-audit-integrity.js";
export * from "./production-audit-log-storage.js";
export * from "./production-audit-memory-store.js";
export * from "./production-audit-models.js";
export * from "./production-audit-siem.js";
export * from "./production-audit-signed-windows.js";

export class ProductionAuditEvidenceAdapter implements DescribedAuditEventRepository, EvidencePackageRepository {
  readonly #location: string;
  readonly #retentionPolicy: ProductionAuditRetentionPolicy;
  readonly #auditLog: ProductionAuditLogStorage;
  readonly #evidenceRetention: ProductionEvidencePackageRetention;
  readonly #integrity: ProductionAuditIntegrityValidator;
  readonly #signedWindows: ProductionSignedAuditWindowRegistry;
  readonly #siemDeliveries: ProductionSiemDeliveryLog;
  readonly #backups: ProductionAuditBackupVault;

  constructor(options: ProductionAuditEvidenceAdapterOptions) {
    assertTenantBoundary(options.tenantBoundary);
    assertNoSecretMaterial(options.location, "production audit location");
    const now = options.now ?? (() => new Date().toISOString());
    const retentionPolicy: ProductionAuditRetentionPolicy = {
      policyId: options.retentionPolicyId ?? "retention:audit:default",
      retentionDays: options.retentionDays ?? 2555,
      legalHold: false,
      version: "production-audit-retention-policy:v1"
    };
    const signingKeyId = options.signingKeyId ?? "signing-key:audit-window:default";
    assertSigningKeyMaterial(options.signingKeyMaterial);
    const windowSigner: ProductionAuditWindowSigner = createHmacAuditWindowSigner(signingKeyId, options.signingKeyMaterial);

    this.#location = options.location;
    this.#retentionPolicy = retentionPolicy;
    this.#integrity = new ProductionAuditIntegrityValidator(options.store, options.tenantBoundary, windowSigner);
    this.#auditLog = new ProductionAuditLogStorage({
      store: options.store,
      tenantBoundary: options.tenantBoundary,
      location: options.location,
      retentionPolicy,
      integrity: this.#integrity
    });
    this.#evidenceRetention = new ProductionEvidencePackageRetention({
      store: options.store,
      tenantBoundary: options.tenantBoundary,
      location: options.location,
      retentionPolicy,
      integrity: this.#integrity
    });
    this.#signedWindows = new ProductionSignedAuditWindowRegistry({
      store: options.store,
      tenantBoundary: options.tenantBoundary,
      retentionPolicy,
      windowSigner,
      integrity: this.#integrity,
      now
    });
    this.#siemDeliveries = new ProductionSiemDeliveryLog({
      store: options.store,
      tenantBoundary: options.tenantBoundary,
      integrity: this.#integrity,
      listSignedAuditWindows: () => this.#signedWindows.listSignedAuditWindows(),
      now
    });
    this.#backups = new ProductionAuditBackupVault({
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

  signAuditWindow(request: ProductionAuditWindowRequest): ProductionSignedAuditWindow {
    return this.#signedWindows.signAuditWindow(request);
  }

  listSignedAuditWindows(): ProductionSignedAuditWindow[] {
    return this.#signedWindows.listSignedAuditWindows();
  }

  recordSiemDelivery(request: ProductionSiemDeliveryRequest): ProductionSiemDeliveryRecord {
    return this.#siemDeliveries.recordSiemDelivery(request);
  }

  replaySiemDelivery(request: ProductionSiemReplayRequest): ProductionSiemDeliveryRecord {
    return this.#siemDeliveries.replaySiemDelivery(request);
  }

  listSiemDeliveries(): ProductionSiemDeliveryRecord[] {
    return this.#siemDeliveries.listSiemDeliveries();
  }

  createBackup(id: CanonicalId, createdAt?: string): ProductionRepositoryBackupMetadata {
    return this.#backups.createBackup(id, createdAt);
  }

  restoreBackup(id: CanonicalId, restoredAt?: string): ProductionAuditRestoreReceipt {
    return this.#backups.restoreBackup(id, restoredAt);
  }

  listBackupMetadata(): ProductionRepositoryBackupMetadata[] {
    return this.#backups.listBackupMetadata();
  }
}

export type ProductionAuditRepository = AuditEventRepository & EvidencePackageRepository & DescribedAuditEventRepository;
