import type {
  ExternalAppendOnlyAuditStore,
  ReferenceSiemDeliveryRecord,
  ReferenceSiemDeliveryRequest,
  ReferenceSiemReplayRequest,
  ReferenceSignedAuditWindow
} from "./reference-audit-models.js";
import type { ReferenceAuditIntegrityValidator } from "./reference-audit-integrity.js";
import {
  assertNoIntegrityFindings,
  assertNoSecretMaterial,
  clone,
  withRecordHash
} from "./reference-audit-utils.js";
import { stableHash } from "./repository-envelopes.js";

export interface ReferenceSiemDeliveryLogOptions {
  store: ExternalAppendOnlyAuditStore;
  tenantBoundary: string;
  integrity: ReferenceAuditIntegrityValidator;
  listSignedAuditWindows: () => ReferenceSignedAuditWindow[];
  now: () => string;
}

export class ReferenceSiemDeliveryLog {
  readonly #store: ExternalAppendOnlyAuditStore;
  readonly #tenantBoundary: string;
  readonly #integrity: ReferenceAuditIntegrityValidator;
  readonly #listSignedAuditWindows: () => ReferenceSignedAuditWindow[];
  readonly #now: () => string;

  constructor(options: ReferenceSiemDeliveryLogOptions) {
    this.#store = options.store;
    this.#tenantBoundary = options.tenantBoundary;
    this.#integrity = options.integrity;
    this.#listSignedAuditWindows = options.listSignedAuditWindows;
    this.#now = options.now;
  }

  recordSiemDeliveryLogEntry(request: ReferenceSiemDeliveryRequest): ReferenceSiemDeliveryRecord {
    const windows = this.#listSignedAuditWindows();
    const window = windows.find((entry) => entry.windowId === request.windowId);

    if (!window) {
      throw new Error(`Reference audit window ${request.windowId} must be signed before SIEM delivery is recorded.`);
    }

    if (request.status === "failed" && !request.error) {
      throw new Error("Failed SIEM deliveries require an error message.");
    }

    assertNoSecretMaterial(request, `SIEM delivery ${request.windowId}`);
    const attemptedAt = request.attemptedAt ?? this.#now();
    const delivery = withRecordHash<ReferenceSiemDeliveryRecord>({
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
    this.#store.appendSiemDeliveryLogEntry(delivery);
    return clone(delivery);
  }

  replaySiemDeliveryLogEntry(request: ReferenceSiemReplayRequest): ReferenceSiemDeliveryRecord {
    const deliveries = this.#store.readSiemDeliveryLogEntries();
    const failedDelivery = deliveries.find((delivery) => delivery.deliveryId === request.deliveryId);

    if (!failedDelivery) {
      throw new Error(`Reference SIEM delivery ${request.deliveryId} does not exist.`);
    }
    if (failedDelivery.status !== "failed") {
      throw new Error(`Reference SIEM delivery ${request.deliveryId} is not failed and cannot be replayed.`);
    }

    const attemptedAt = request.attemptedAt ?? this.#now();
    const status = request.status ?? "delivered";
    if (status === "failed" && !request.error) {
      throw new Error("Failed SIEM replay deliveries require an error message.");
    }
    assertNoSecretMaterial(request, `SIEM delivery replay ${request.deliveryId}`);
    const delivery = withRecordHash<ReferenceSiemDeliveryRecord>({
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
    this.#store.appendSiemDeliveryLogEntry(delivery);
    return clone(delivery);
  }

  listSiemDeliveryLogEntries(): ReferenceSiemDeliveryRecord[] {
    const deliveries = this.#store.readSiemDeliveryLogEntries();
    const findings = this.#integrity.siemDeliveryFindings(deliveries, this.#store.readSignedWindows());
    assertNoIntegrityFindings(findings, "Reference SIEM delivery integrity check failed");
    return clone(deliveries);
  }
}
