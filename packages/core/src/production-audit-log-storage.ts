import { auditEventHash } from "./audit.js";
import type {
  AuditEvent,
  AuditStorageReceipt
} from "./domain.js";
import type {
  ExternalAppendOnlyAuditStore,
  ProductionAuditEventStoreRecord,
  ProductionAuditRetentionPolicy
} from "./production-audit-models.js";
import type { ProductionAuditIntegrityValidator } from "./production-audit-integrity.js";
import {
  assertNoSecretMaterial,
  assertOptionalTenantBoundary,
  clone,
  withRecordHash
} from "./production-audit-utils.js";

export interface ProductionAuditLogStorageOptions {
  store: ExternalAppendOnlyAuditStore;
  tenantBoundary: string;
  location: string;
  retentionPolicy: ProductionAuditRetentionPolicy;
  integrity: ProductionAuditIntegrityValidator;
}

export class ProductionAuditLogStorage {
  readonly #store: ExternalAppendOnlyAuditStore;
  readonly #tenantBoundary: string;
  readonly #location: string;
  readonly #retentionPolicy: ProductionAuditRetentionPolicy;
  readonly #integrity: ProductionAuditIntegrityValidator;

  constructor(options: ProductionAuditLogStorageOptions) {
    this.#store = options.store;
    this.#tenantBoundary = options.tenantBoundary;
    this.#location = options.location;
    this.#retentionPolicy = options.retentionPolicy;
    this.#integrity = options.integrity;
  }

  appendAuditEvent(event: AuditEvent, storedAt: string): AuditStorageReceipt {
    assertNoSecretMaterial(event, `Audit event ${event.eventId}`);
    assertOptionalTenantBoundary(event.payload, this.#tenantBoundary, `Audit event ${event.eventId}`);
    const records = this.#integrity.trustedAuditRecords();

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
    return clone(this.#integrity.trustedAuditRecords().map((record) => record.event));
  }
}
