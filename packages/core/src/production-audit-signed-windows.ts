import { createHmac, timingSafeEqual } from "node:crypto";
import { auditEventHash, stableStringify } from "./audit.js";
import type { CanonicalId } from "./domain.js";
import type { ProductionAuditIntegrityValidator } from "./production-audit-integrity.js";
import type {
  ExternalAppendOnlyAuditStore,
  ProductionAuditRetentionPolicy,
  ProductionAuditWindowRequest,
  ProductionAuditWindowSigner,
  ProductionSignedAuditWindow
} from "./production-audit-models.js";
import {
  assertNoIntegrityFindings,
  clone,
  withRecordHash
} from "./production-audit-utils.js";

export interface ProductionSignedAuditWindowRegistryOptions {
  store: ExternalAppendOnlyAuditStore;
  tenantBoundary: string;
  retentionPolicy: ProductionAuditRetentionPolicy;
  windowSigner: ProductionAuditWindowSigner;
  integrity: ProductionAuditIntegrityValidator;
  now: () => string;
}

export class ProductionSignedAuditWindowRegistry {
  readonly #store: ExternalAppendOnlyAuditStore;
  readonly #tenantBoundary: string;
  readonly #retentionPolicy: ProductionAuditRetentionPolicy;
  readonly #windowSigner: ProductionAuditWindowSigner;
  readonly #integrity: ProductionAuditIntegrityValidator;
  readonly #now: () => string;

  constructor(options: ProductionSignedAuditWindowRegistryOptions) {
    this.#store = options.store;
    this.#tenantBoundary = options.tenantBoundary;
    this.#retentionPolicy = options.retentionPolicy;
    this.#windowSigner = options.windowSigner;
    this.#integrity = options.integrity;
    this.#now = options.now;
  }

  signAuditWindow(request: ProductionAuditWindowRequest): ProductionSignedAuditWindow {
    const records = this.#integrity.trustedAuditRecords();
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
    const findings = this.#integrity.signedWindowFindings(windows, this.#store.readAuditRecords());
    assertNoIntegrityFindings(findings, "Production signed audit window integrity check failed");
    return clone(windows);
  }
}

export function createHmacAuditWindowSigner(keyId: CanonicalId, keyMaterial: string): ProductionAuditWindowSigner {
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

export function assertSigningKeyMaterial(keyMaterial: string): void {
  if (keyMaterial.trim().length === 0) {
    throw new Error("Production audit signing key material is required.");
  }
  if (keyMaterial.length < 16) {
    throw new Error("Production audit signing key material must be at least 16 characters.");
  }
}
