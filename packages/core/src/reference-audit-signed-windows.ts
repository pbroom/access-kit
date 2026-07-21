import { createHmac, timingSafeEqual } from "node:crypto";
import { auditEventHash, stableStringify } from "./audit.js";
import type { CanonicalId } from "./domain.js";
import type { ReferenceAuditIntegrityValidator } from "./reference-audit-integrity.js";
import type {
  ExternalAppendOnlyAuditStore,
  ReferenceAuditRetentionPolicy,
  ReferenceAuditWindowRequest,
  ReferenceAuditWindowSigner,
  ReferenceSignedAuditWindow
} from "./reference-audit-models.js";
import {
  assertNoIntegrityFindings,
  clone,
  withRecordHash
} from "./reference-audit-utils.js";

export interface ReferenceSignedAuditWindowRegistryOptions {
  store: ExternalAppendOnlyAuditStore;
  tenantBoundary: string;
  retentionPolicy: ReferenceAuditRetentionPolicy;
  windowSigner: ReferenceAuditWindowSigner;
  integrity: ReferenceAuditIntegrityValidator;
  now: () => string;
}

export class ReferenceSignedAuditWindowRegistry {
  readonly #store: ExternalAppendOnlyAuditStore;
  readonly #tenantBoundary: string;
  readonly #retentionPolicy: ReferenceAuditRetentionPolicy;
  readonly #windowSigner: ReferenceAuditWindowSigner;
  readonly #integrity: ReferenceAuditIntegrityValidator;
  readonly #now: () => string;

  constructor(options: ReferenceSignedAuditWindowRegistryOptions) {
    this.#store = options.store;
    this.#tenantBoundary = options.tenantBoundary;
    this.#retentionPolicy = options.retentionPolicy;
    this.#windowSigner = options.windowSigner;
    this.#integrity = options.integrity;
    this.#now = options.now;
  }

  signAuditWindow(request: ReferenceAuditWindowRequest): ReferenceSignedAuditWindow {
    const records = this.#integrity.trustedAuditRecords();
    const signedAt = request.signedAt ?? this.#now();
    const events = records
      .map((record) => record.event)
      .filter((event) => event.occurredAt >= request.periodStart && event.occurredAt <= request.periodEnd);
    const signingKeyId = request.signingKeyId ?? this.#windowSigner.keyId;
    if (signingKeyId !== this.#windowSigner.keyId) {
      throw new Error(`Reference audit window signer ${signingKeyId} is not configured for this adapter.`);
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
    const window = withRecordHash<ReferenceSignedAuditWindow>({
      ...windowWithoutHashes,
      signatureHash: this.#windowSigner.sign(windowWithoutHashes),
      recordHash: ""
    });
    this.#store.appendSignedWindow(window);
    return clone(window);
  }

  listSignedAuditWindows(): ReferenceSignedAuditWindow[] {
    const windows = this.#store.readSignedWindows();
    const findings = this.#integrity.signedWindowFindings(windows, this.#store.readAuditRecords());
    assertNoIntegrityFindings(findings, "Reference signed audit window integrity check failed");
    return clone(windows);
  }
}

export function createHmacAuditWindowSigner(keyId: CanonicalId, keyMaterial: string): ReferenceAuditWindowSigner {
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
    throw new Error("Reference audit signing key material is required.");
  }
  if (keyMaterial.length < 32) {
    throw new Error("Reference audit signing key material must be at least 32 characters.");
  }
}
