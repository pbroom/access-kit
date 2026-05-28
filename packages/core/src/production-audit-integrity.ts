import { auditEventHash, stableStringify, verifyAuditChain } from "./audit.js";
import type {
  AuditIntegrityFinding,
  AuditIntegrityReport,
  CanonicalId
} from "./domain.js";
import type {
  ExternalAppendOnlyAuditStore,
  ProductionAuditEventStoreRecord,
  ProductionAuditStoreBackup,
  ProductionAuditWindowSigner,
  ProductionEvidenceStoreRecord,
  ProductionSiemDeliveryRecord,
  ProductionSignedAuditWindow
} from "./production-audit-models.js";
import {
  assertNoIntegrityFindings,
  finding,
  hashBackup,
  hashRecord,
  secretMaterialFindings
} from "./production-audit-utils.js";

export class ProductionAuditIntegrityValidator {
  readonly #store: ExternalAppendOnlyAuditStore;
  readonly #tenantBoundary: string;
  readonly #windowSigner: ProductionAuditWindowSigner;

  constructor(store: ExternalAppendOnlyAuditStore, tenantBoundary: string, windowSigner: ProductionAuditWindowSigner) {
    this.#store = store;
    this.#tenantBoundary = tenantBoundary;
    this.#windowSigner = windowSigner;
  }

  validateStoreState(): void {
    const auditRecords = this.#store.readAuditRecords();
    const evidenceRecords = this.#store.readEvidenceRecords();
    const signedWindows = this.#store.readSignedWindows();
    const siemDeliveries = this.#store.readSiemDeliveries();

    assertNoIntegrityFindings(this.auditRecordFindings(auditRecords), "Stored production audit log integrity check failed");
    assertNoIntegrityFindings(this.evidenceRecordFindings(evidenceRecords), "Stored production evidence integrity check failed");
    assertNoIntegrityFindings(this.signedWindowFindings(signedWindows, auditRecords), "Stored production signed audit window integrity check failed");
    assertNoIntegrityFindings(this.siemDeliveryFindings(siemDeliveries, signedWindows), "Stored production SIEM delivery integrity check failed");
  }

  trustedAuditRecords(): ProductionAuditEventStoreRecord[] {
    const records = this.#store.readAuditRecords();
    const findings = this.auditRecordFindings(records);
    assertNoIntegrityFindings(findings, "Stored production audit log integrity check failed");
    return records;
  }

  trustedEvidenceRecords(): ProductionEvidenceStoreRecord[] {
    const records = this.#store.readEvidenceRecords();
    const findings = this.evidenceRecordFindings(records);
    assertNoIntegrityFindings(findings, "Stored production evidence integrity check failed");
    return records;
  }

  verifyIntegrity(verifiedAt: string): AuditIntegrityReport {
    const records = this.#store.readAuditRecords();
    const windows = this.#store.readSignedWindows();
    const deliveries = this.#store.readSiemDeliveries();
    const events = records.map((record) => record.event);
    const report = verifyAuditChain(events, verifiedAt);
    const findings = [
      ...this.auditRecordFindings(records),
      ...this.signedWindowFindings(windows, records),
      ...this.siemDeliveryFindings(deliveries, windows, { includeOperationalFailures: true }),
      ...report.findings
    ];

    return {
      ...report,
      status: report.status === "verified" && findings.length === 0 ? "verified" : "failed",
      findings
    };
  }

  auditRecordFindings(records: ProductionAuditEventStoreRecord[] = this.#store.readAuditRecords()): AuditIntegrityFinding[] {
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
      if (record.tenantBoundary !== this.#tenantBoundary) {
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

  evidenceRecordFindings(records: ProductionEvidenceStoreRecord[] = this.#store.readEvidenceRecords()): AuditIntegrityFinding[] {
    return records.flatMap((record) => {
      const findings: AuditIntegrityFinding[] = [];

      if (record.version !== "production-evidence-package-record:v1") {
        findings.push(finding("EVIDENCE_RECORD_VERSION_MISMATCH", "Stored production evidence record has an unsupported version.", record.exportId));
      }
      if (record.tenantBoundary !== this.#tenantBoundary) {
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

  signedWindowFindings(
    windows: ProductionSignedAuditWindow[] = this.#store.readSignedWindows(),
    records: ProductionAuditEventStoreRecord[] = this.#store.readAuditRecords()
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

      if (window.tenantBoundary !== this.#tenantBoundary) {
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
      if (window.signatureAlgorithm !== this.#windowSigner.algorithm) {
        findings.push(finding("AUDIT_WINDOW_SIGNATURE_ALGORITHM_MISMATCH", "Signed audit window algorithm does not match the configured signer.", window.windowId, this.#windowSigner.algorithm, window.signatureAlgorithm));
      }
      if (window.signingKeyId !== this.#windowSigner.keyId) {
        findings.push(finding("AUDIT_WINDOW_SIGNING_KEY_MISMATCH", "Signed audit window key does not match the configured signer.", window.windowId, this.#windowSigner.keyId, window.signingKeyId));
      }
      if (!this.#windowSigner.verify(signaturePayload, window.signatureHash)) {
        findings.push(finding("AUDIT_WINDOW_SIGNATURE_MISMATCH", "Signed audit window signature hash does not match the retained window metadata.", window.windowId));
      }
      const expectedRecordHash = hashRecord(window);
      if (window.recordHash !== expectedRecordHash) {
        findings.push(finding("AUDIT_WINDOW_RECORD_HASH_MISMATCH", "Signed audit window envelope hash does not match the current record.", window.windowId, expectedRecordHash, window.recordHash));
      }
      return findings;
    });
  }

  siemDeliveryFindings(
    deliveries: ProductionSiemDeliveryRecord[] = this.#store.readSiemDeliveries(),
    windows: ProductionSignedAuditWindow[] = this.#store.readSignedWindows(),
    options: { includeOperationalFailures?: boolean } = {}
  ): AuditIntegrityFinding[] {
    return deliveries.flatMap((delivery) => {
      const findings: AuditIntegrityFinding[] = [];
      const window = windows.find((entry) => entry.windowId === delivery.windowId);
      const replayed = deliveries.some((entry) => entry.replayOfDeliveryId === delivery.deliveryId && entry.status === "delivered");

      if (delivery.tenantBoundary !== this.#tenantBoundary) {
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

  validateBackup(backup: ProductionAuditStoreBackup): void {
    if (backup.tenantBoundary !== this.#tenantBoundary) {
      throw new Error(`Production audit backup ${backup.id} tenant boundary does not match the adapter.`);
    }
    if (backup.backupHash !== hashBackup(backup)) {
      throw new Error(`Production audit backup ${backup.id} hash does not match the stored snapshot.`);
    }
    assertNoIntegrityFindings(this.auditRecordFindings(backup.auditRecords), "Production audit backup event integrity check failed");
    assertNoIntegrityFindings(this.evidenceRecordFindings(backup.evidenceRecords), "Production audit backup evidence integrity check failed");
    assertNoIntegrityFindings(
      this.signedWindowFindings(backup.signedWindows, backup.auditRecords),
      "Production audit backup signed-window integrity check failed"
    );
    assertNoIntegrityFindings(
      this.siemDeliveryFindings(backup.siemDeliveries, backup.signedWindows),
      "Production audit backup SIEM delivery integrity check failed"
    );
  }
}
