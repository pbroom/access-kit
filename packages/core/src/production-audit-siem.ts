import type {
  ExternalAppendOnlyAuditStore,
  ProductionSiemDeliveryRecord,
  ProductionSiemDeliveryRequest,
  ProductionSiemReplayRequest,
  ProductionSignedAuditWindow
} from "./production-audit-models.js";
import type { ProductionAuditIntegrityValidator } from "./production-audit-integrity.js";
import {
  assertNoIntegrityFindings,
  assertNoSecretMaterial,
  clone,
  withRecordHash
} from "./production-audit-utils.js";
import { stableHash } from "./repository-envelopes.js";

export interface ProductionSiemDeliveryLogOptions {
  store: ExternalAppendOnlyAuditStore;
  tenantBoundary: string;
  integrity: ProductionAuditIntegrityValidator;
  listSignedAuditWindows: () => ProductionSignedAuditWindow[];
  now: () => string;
}

export class ProductionSiemDeliveryLog {
  readonly #store: ExternalAppendOnlyAuditStore;
  readonly #tenantBoundary: string;
  readonly #integrity: ProductionAuditIntegrityValidator;
  readonly #listSignedAuditWindows: () => ProductionSignedAuditWindow[];
  readonly #now: () => string;

  constructor(options: ProductionSiemDeliveryLogOptions) {
    this.#store = options.store;
    this.#tenantBoundary = options.tenantBoundary;
    this.#integrity = options.integrity;
    this.#listSignedAuditWindows = options.listSignedAuditWindows;
    this.#now = options.now;
  }

  recordSiemDelivery(request: ProductionSiemDeliveryRequest): ProductionSiemDeliveryRecord {
    const windows = this.#listSignedAuditWindows();
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
    const findings = this.#integrity.siemDeliveryFindings(deliveries, this.#store.readSignedWindows());
    assertNoIntegrityFindings(findings, "Production SIEM delivery integrity check failed");
    return clone(deliveries);
  }
}
