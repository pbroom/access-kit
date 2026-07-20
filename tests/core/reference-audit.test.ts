import { describe, expect, it } from "vitest";
import {
  AuditRecorder,
  auditEventHash,
  finalizeEvidenceExport,
  InMemoryExternalAppendOnlyAuditStore,
  ReferenceAuditEvidenceAdapter,
  type AuditEvent,
  type EvidenceExport,
  type JsonRecord,
  type ReferenceAuditEventStoreRecord
} from "../../packages/core/src/index.js";

const now = "2026-05-26T06:10:00.000Z";
const tenantBoundary = "tenant:access-kit-test";

describe("production audit, SIEM, and WORM evidence adapter", () => {
  it("describes immutable external audit persistence for production readiness", () => {
    const repository = createRepository();

    expect(repository.describePersistence()).toMatchObject({
      component: "audit",
      backend: "external_append_only_audit",
      durable: true,
      immutable: true,
      capabilities: ["audit_append", "audit_hash_chain", "audit_immutability", "audit_retention", "backup_restore"],
      retentionDays: 2555,
      location: "worm://audit/access-kit-test",
      version: "persistence-backend:v1"
    });
  });

  it("requires explicit signing key material for audit windows", () => {
    expect(() => new ReferenceAuditEvidenceAdapter({
      store: new InMemoryExternalAppendOnlyAuditStore(),
      tenantBoundary,
      location: "worm://audit/access-kit-test",
      signingKeyMaterial: ""
    })).toThrow("Reference audit signing key material is required.");

    expect(() => new ReferenceAuditEvidenceAdapter({
      store: new InMemoryExternalAppendOnlyAuditStore(),
      tenantBoundary,
      location: "worm://audit/access-kit-test",
      signingKeyMaterial: "short"
    })).toThrow("Reference audit signing key material must be at least 32 characters.");
  });

  it("retains ordered audit events, signed windows, SIEM delivery metadata, evidence receipts, and backups", () => {
    const store = new InMemoryExternalAppendOnlyAuditStore();
    const repository = createRepository(store);
    const [firstEvent, secondEvent] = createAuditEvents();

    const firstReceipt = repository.appendAuditEvent(firstEvent, now);
    const secondReceipt = repository.appendAuditEvent(secondEvent, "2026-05-26T06:11:00.000Z");
    const window = repository.signAuditWindow({
      windowId: "audit-window:20260526",
      periodStart: "2026-05-26T00:00:00.000Z",
      periodEnd: "2026-05-27T00:00:00.000Z",
      signedAt: "2026-05-26T06:12:00.000Z"
    });
    const delivery = repository.recordSiemDeliveryLogEntry({
      windowId: window.windowId,
      destination: "siem://access-kit/audit",
      status: "delivered",
      attemptedAt: "2026-05-26T06:13:00.000Z"
    });
    const evidence = createEvidenceExport([firstEvent, secondEvent]);
    const evidenceReceipt = repository.writeEvidenceExport(evidence, "2026-05-26T06:14:00.000Z");
    const backup = repository.createBackup("backup:audit:one", "2026-05-26T06:15:00.000Z");
    const thirdEvent = createNextEvent([firstEvent, secondEvent], "audit.integrity_verified", "2026-05-26T06:16:00.000Z");

    repository.appendAuditEvent(thirdEvent, "2026-05-26T06:16:00.000Z");

    expect(firstReceipt).toMatchObject({
      eventId: firstEvent.eventId,
      sequence: 1,
      eventHash: auditEventHash(firstEvent),
      backend: "external",
      immutable: true
    });
    expect(secondReceipt).toMatchObject({
      eventId: secondEvent.eventId,
      sequence: 2,
      previousEventHash: auditEventHash(firstEvent)
    });
    expect(window).toMatchObject({
      eventCount: 2,
      sourceEventIds: [firstEvent.eventId, secondEvent.eventId],
      lastEventHash: auditEventHash(secondEvent),
      signatureAlgorithm: "hmac-sha256",
      signatureHash: expect.stringMatching(/^hmac-sha256:[a-f0-9]{64}$/)
    });
    expect(delivery).toMatchObject({
      status: "delivered",
      eventCount: 2,
      lastEventHash: auditEventHash(secondEvent)
    });
    expect(evidenceReceipt).toMatchObject({
      exportId: evidence.exportId,
      backend: "external",
      immutable: true,
      packageHash: evidence.integrityManifest.packageHash
    });
    expect(repository.listAuditEvents()).toEqual([firstEvent, secondEvent, thirdEvent]);

    const restoreReceipt = repository.restoreBackup(backup.id, "2026-05-26T06:17:00.000Z");
    const reopened = createRepository(store);

    expect(restoreReceipt).toMatchObject({
      backupId: backup.id,
      eventCount: 2,
      evidencePackageCount: 1,
      signedWindowCount: 1,
      siemDeliveryCount: 1
    });
    expect(reopened.listAuditEvents()).toEqual([firstEvent, secondEvent]);
    expect(reopened.readEvidenceExport(evidence.exportId)?.storageReceipt).toMatchObject({
      backend: "external",
      immutable: true,
      packageHash: evidence.integrityManifest.packageHash
    });
    expect(reopened.verifyIntegrity("2026-05-26T06:18:00.000Z")).toMatchObject({
      status: "verified",
      eventCount: 2,
      findings: []
    });
  });

  it("validates each backing store collection once when opening the repository", () => {
    const store = new CountingExternalAppendOnlyAuditStore();

    createRepository(store);

    expect(store.readCounts).toEqual({
      auditRecords: 1,
      evidenceRecords: 1,
      signedWindows: 1,
      siemDeliveries: 1
    });
  });

  it("rejects duplicate, out-of-order, and unredacted secret-bearing audit records before append", () => {
    const repository = createRepository();
    const [firstEvent] = createAuditEvents();
    const orphanEvent = new AuditRecorder().record(
      {
        eventType: "resource.discovered",
        actor: "service:api",
        resourceId: "document:case-plan",
        correlationId: "corr:orphan",
        payload: { resourceId: "document:case-plan" }
      },
      "2026-05-26T06:10:30.000Z"
    );
    const secretEvent = createNextEvent([firstEvent], "decision.denied", "2026-05-26T06:11:00.000Z", {
      apiToken: "tenant-secret"
    });
    const authorizationEvent = createNextEvent([firstEvent], "api.authentication_failed", "2026-05-26T06:12:00.000Z", {
      headers: {
        authorization: "Bearer live-token",
        "x-api-key": "tenant-secret"
      },
      tokenLogged: false
    });

    repository.appendAuditEvent(firstEvent, now);

    expect(() => repository.appendAuditEvent(firstEvent, "2026-05-26T06:10:01.000Z")).toThrow(
      `Audit event ${firstEvent.eventId} has already been appended.`
    );
    expect(() => repository.appendAuditEvent(orphanEvent, "2026-05-26T06:10:02.000Z")).toThrow(
      "Audit event previousEventHash does not match the current production audit tail."
    );
    expect(() => repository.appendAuditEvent(secretEvent, "2026-05-26T06:11:00.000Z")).toThrow(
      "contains secret material and must be redacted"
    );
    expect(() => repository.appendAuditEvent(authorizationEvent, "2026-05-26T06:12:00.000Z")).toThrow(
      "contains secret material and must be redacted"
    );

    for (const key of ["clientKey", "hmacKey", "signingKey", "encryptionKey", "sessionToken"]) {
      const event = createNextEvent([firstEvent], `audit.secret_key_rejected.${key}`, "2026-05-26T06:13:00.000Z", {
        [key]: "tenant-secret"
      });

      expect(() => repository.appendAuditEvent(event, "2026-05-26T06:13:00.000Z")).toThrow(
        "contains secret material and must be redacted"
      );
    }

    const providerTokenPrefix = ["gh", "p_"].join("");
    const jwtPrefix = ["ey", "J"].join("");
    for (const secretValue of [
      "oauth response accessToken: tenant-secret-value",
      "provider returned api-key=tenant-secret-value",
      `github token ${providerTokenPrefix}1234567890abcdef123456`,
      `jwt=${jwtPrefix}hbGciOiJIUzI1NiJ9.eyJzdWIiOiJhbGljZSJ9.dGVzdHNpZ25hdHVyZQ`
    ]) {
      const event = createNextEvent([firstEvent], `audit.secret_value_rejected.${secretValue.length}`, "2026-05-26T06:14:00.000Z", {
        diagnostic: secretValue
      });

      expect(() => repository.appendAuditEvent(event, "2026-05-26T06:14:00.000Z")).toThrow(
        "contains secret-looking material and must be redacted"
      );
    }
  });

  it("reports failed SIEM delivery as security-relevant until a replay delivery succeeds", () => {
    const store = new InMemoryExternalAppendOnlyAuditStore();
    const repository = createRepository(store);
    const [firstEvent, secondEvent] = createAuditEvents();

    repository.appendAuditEvent(firstEvent, now);
    repository.appendAuditEvent(secondEvent, "2026-05-26T06:11:00.000Z");
    const window = repository.signAuditWindow({
      windowId: "audit-window:failed-delivery",
      periodStart: "2026-05-26T00:00:00.000Z",
      periodEnd: "2026-05-27T00:00:00.000Z",
      signedAt: "2026-05-26T06:12:00.000Z"
    });
    const failed = repository.recordSiemDeliveryLogEntry({
      windowId: window.windowId,
      destination: "siem://access-kit/audit",
      status: "failed",
      attemptedAt: "2026-05-26T06:13:00.000Z",
      error: "forwarder unavailable"
    });

    expect(repository.verifyIntegrity("2026-05-26T06:14:00.000Z")).toMatchObject({
      status: "failed",
      findings: [expect.objectContaining({ code: "SIEM_DELIVERY_FAILED", severity: "high" })]
    });
    expect(createRepository(store).listSiemDeliveryLogEntries()).toEqual([
      expect.objectContaining({ deliveryId: failed.deliveryId, status: "failed" })
    ]);

    const replay = repository.replaySiemDeliveryLogEntry({
      deliveryId: failed.deliveryId,
      attemptedAt: "2026-05-26T06:15:00.000Z"
    });

    expect(replay).toMatchObject({
      status: "delivered",
      replayOfDeliveryId: failed.deliveryId,
      sourceEventIds: [firstEvent.eventId, secondEvent.eventId]
    });
    expect(repository.verifyIntegrity("2026-05-26T06:16:00.000Z")).toMatchObject({
      status: "verified",
      findings: []
    });
  });

  it("records failed SIEM replay attempts without clearing the original failure", () => {
    const repository = createRepository();
    const [firstEvent, secondEvent] = createAuditEvents();

    repository.appendAuditEvent(firstEvent, now);
    repository.appendAuditEvent(secondEvent, "2026-05-26T06:11:00.000Z");
    const window = repository.signAuditWindow({
      windowId: "audit-window:failed-replay",
      periodStart: "2026-05-26T00:00:00.000Z",
      periodEnd: "2026-05-27T00:00:00.000Z",
      signedAt: "2026-05-26T06:12:00.000Z"
    });
    const failed = repository.recordSiemDeliveryLogEntry({
      windowId: window.windowId,
      destination: "siem://access-kit/audit",
      status: "failed",
      attemptedAt: "2026-05-26T06:13:00.000Z",
      error: "forwarder unavailable"
    });

    const replay = repository.replaySiemDeliveryLogEntry({
      deliveryId: failed.deliveryId,
      attemptedAt: "2026-05-26T06:15:00.000Z",
      status: "failed",
      error: "secondary forwarder unavailable"
    });

    expect(replay).toMatchObject({
      status: "failed",
      error: "secondary forwarder unavailable",
      replayOfDeliveryId: failed.deliveryId
    });
    expect(repository.verifyIntegrity("2026-05-26T06:16:00.000Z")).toMatchObject({
      status: "failed",
      findings: expect.arrayContaining([
        expect.objectContaining({ code: "SIEM_DELIVERY_FAILED", eventId: failed.deliveryId }),
        expect.objectContaining({ code: "SIEM_DELIVERY_FAILED", eventId: replay.deliveryId })
      ])
    });
    expect(() => repository.replaySiemDeliveryLogEntry({ deliveryId: failed.deliveryId, status: "failed" })).toThrow(
      "Failed SIEM replay deliveries require an error message."
    );
  });

  it("detects tampered WORM audit envelopes and refuses to serve them as trusted events", () => {
    const store = new InMemoryExternalAppendOnlyAuditStore();
    const repository = createRepository(store);
    const [firstEvent] = createAuditEvents();

    repository.appendAuditEvent(firstEvent, now);
    const records = store.readAuditRecords();
    const tampered: ReferenceAuditEventStoreRecord = {
      ...records[0],
      event: {
        ...records[0].event,
        payload: { tampered: true }
      }
    };
    store.replaceAuditRecordsForTest([tampered]);

    expect(repository.verifyIntegrity("2026-05-26T06:11:00.000Z")).toMatchObject({
      status: "failed",
      findings: expect.arrayContaining([
        expect.objectContaining({ code: "AUDIT_RECORD_HASH_MISMATCH" }),
        expect.objectContaining({ code: "AUDIT_RECORD_ENVELOPE_HASH_MISMATCH" })
      ])
    });
    expect(() => repository.listAuditEvents()).toThrow("Stored production audit log integrity check failed");
  });

  it("detects duplicate event identifiers already present in the external audit store", () => {
    const store = new InMemoryExternalAppendOnlyAuditStore();
    const repository = createRepository(store);
    const [firstEvent, secondEvent] = createAuditEvents();

    repository.appendAuditEvent(firstEvent, now);
    repository.appendAuditEvent(secondEvent, "2026-05-26T06:11:00.000Z");
    const records = store.readAuditRecords();
    store.replaceAuditRecordsForTest([
      records[0],
      {
        ...records[1],
        event: {
          ...records[1].event,
          eventId: records[0].event.eventId
        }
      }
    ]);

    expect(repository.verifyIntegrity("2026-05-26T06:12:00.000Z")).toMatchObject({
      status: "failed",
      findings: expect.arrayContaining([
        expect.objectContaining({ code: "AUDIT_RECORD_DUPLICATE_EVENT_ID" })
      ])
    });
  });
});

function createRepository(store = new InMemoryExternalAppendOnlyAuditStore()): ReferenceAuditEvidenceAdapter {
  return new ReferenceAuditEvidenceAdapter({
    store,
    tenantBoundary,
    location: "worm://audit/access-kit-test",
    retentionDays: 2555,
    retentionPolicyId: "retention:audit:seven-years",
    signingKeyId: "signing-key:audit-window:test",
    signingKeyMaterial: "x".repeat(32),
    now: () => now
  });
}

function createAuditEvents(): [AuditEvent, AuditEvent] {
  const recorder = new AuditRecorder();
  const firstEvent = recorder.record(
    {
      eventType: "decision.allowed",
      actor: "service:api",
      subjectId: "user:alice",
      resourceId: "document:case-plan",
      correlationId: "corr:decision:one",
      payload: { subjectId: "user:alice", resourceId: "document:case-plan", decision: "allow" }
    },
    now
  );
  const secondEvent = recorder.record(
    {
      eventType: "audit.exported",
      actor: "service:api",
      correlationId: "corr:audit-export:one",
      payload: { exportId: "audit-export:one", target: "siem_forwarder" }
    },
    "2026-05-26T06:11:00.000Z"
  );

  return [firstEvent, secondEvent];
}

function createNextEvent(
  seedEvents: AuditEvent[],
  eventType: string,
  occurredAt: string,
  payload: JsonRecord = { result: "ok" }
): AuditEvent {
  return new AuditRecorder(seedEvents).record(
    {
      eventType,
      actor: "service:api",
      correlationId: `corr:${eventType}:${occurredAt}`,
      payload
    },
    occurredAt
  );
}

function createEvidenceExport(events: AuditEvent[]): EvidenceExport {
  return finalizeEvidenceExport({
    exportId: "evidence:production-audit",
    framework: "nist-800-53",
    controls: ["AU-6"],
    periodStart: "2026-05-26T00:00:00.000Z",
    periodEnd: "2026-05-27T00:00:00.000Z",
    generatedAt: "2026-05-26T06:14:00.000Z",
    evidenceTypes: ["audit_events", "audit_integrity", "siem_export"],
    sourceEventIds: events.map((event) => event.eventId),
    responsibleRole: "ISSO",
    format: "json",
    auditIntegrity: {
      status: "verified",
      eventCount: events.length,
      verifiedAt: "2026-05-26T06:14:00.000Z",
      firstEventId: events[0]?.eventId,
      lastEventId: events.at(-1)?.eventId,
      firstEventHash: events[0] ? auditEventHash(events[0]) : undefined,
      lastEventHash: events.at(-1) ? auditEventHash(events.at(-1) as AuditEvent) : undefined,
      findings: [],
      version: "audit-integrity:v1"
    },
    controlMappings: [
      {
        controlId: "AU-6",
        family: "AU",
        status: "implemented",
        implementationSummary: "Reference audit adapter retains immutable audit events and SIEM delivery metadata.",
        evidenceTypes: ["audit_events", "siem_export"],
        sourceEventIds: events.map((event) => event.eventId),
        gaps: []
      }
    ],
    artifacts: [
      {
        name: "production-audit-window",
        type: "audit_events",
        description: "Signed production audit window retained by the adapter.",
        eventCount: events.length,
        format: "json"
      }
    ],
    conmonMetrics: [],
    poamItems: [],
    siemExport: {
      format: "jsonl",
      eventCount: events.length,
      schemaVersion: "audit-event:v1",
      includesPayloadHashes: true,
      target: "siem_forwarder"
    },
    systemBoundary: {
      boundaryId: "boundary:production-audit-test",
      name: "Reference audit test boundary",
      description: "Synthetic production audit adapter boundary for conformance tests.",
      environment: "production",
      liveTenantData: false,
      components: [],
      externalSystems: ["siem://access-kit/audit"],
      assumptions: ["No live tenant data is used in this conformance test."],
      version: "system-boundary:v1"
    },
    dataFlows: [],
    controlStatements: [],
    accessReviews: [],
    exceptionRegister: [],
    operationalEvidence: []
  });
}

class CountingExternalAppendOnlyAuditStore extends InMemoryExternalAppendOnlyAuditStore {
  readCounts = {
    auditRecords: 0,
    evidenceRecords: 0,
    signedWindows: 0,
    siemDeliveries: 0
  };

  override readAuditRecords() {
    this.readCounts.auditRecords += 1;
    return super.readAuditRecords();
  }

  override readEvidenceRecords() {
    this.readCounts.evidenceRecords += 1;
    return super.readEvidenceRecords();
  }

  override readSignedWindows() {
    this.readCounts.signedWindows += 1;
    return super.readSignedWindows();
  }

  override readSiemDeliveryLogEntries() {
    this.readCounts.siemDeliveries += 1;
    return super.readSiemDeliveryLogEntries();
  }
}
