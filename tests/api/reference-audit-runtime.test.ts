import { describe, expect, it } from "vitest";
import {
  InMemoryExternalAppendOnlyAuditStore,
  ReferenceAuditEvidenceAdapter
} from "../../packages/core/src/index.js";
import {
  checkDecision,
  createRebacLocalApp,
  exportEvidence,
  verifyAuditIntegrity
} from "../../packages/api/src/index.js";

describe("production audit adapter runtime integration", () => {
  it("uses the production audit/evidence adapter through normal runtime persistence hooks", () => {
    const adapter = new ReferenceAuditEvidenceAdapter({
      store: new InMemoryExternalAppendOnlyAuditStore(),
      tenantBoundary: "tenant:access-kit-test",
      location: "worm://audit/runtime-test",
      signingKeyMaterial: "runtime-test-signing-key-material",
      now: sequenceNow(
        "2026-05-26T06:20:00.000Z",
        "2026-05-26T06:21:00.000Z",
        "2026-05-26T06:22:00.000Z",
        "2026-05-26T06:23:00.000Z",
        "2026-05-26T06:24:00.000Z",
        "2026-05-26T06:25:00.000Z"
      )
    });
    const app = createRebacLocalApp({
      now: sequenceNow(
        "2026-05-26T06:20:00.000Z",
        "2026-05-26T06:21:00.000Z",
        "2026-05-26T06:22:00.000Z",
        "2026-05-26T06:23:00.000Z",
        "2026-05-26T06:24:00.000Z",
        "2026-05-26T06:25:00.000Z"
      ),
      persistence: {
        auditRepository: adapter,
        evidenceRepository: adapter
      }
    });

    const decision = checkDecision(app, {
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan"
    });
    const integrity = verifyAuditIntegrity(app);
    const evidence = exportEvidence(app, ["AU-6"], "json");

    expect(decision.decision).toBe("allow");
    expect(integrity).toMatchObject({ status: "verified", eventCount: 1 });
    expect(evidence.storageReceipt).toMatchObject({
      backend: "external",
      immutable: true,
      packageHash: evidence.integrityManifest.packageHash
    });
    expect(adapter.listAuditEvents().map((event) => event.eventType)).toEqual([
      "decision.allowed",
      "audit.integrity_verified",
      "evidence.generated"
    ]);
    expect(adapter.verifyIntegrity("2026-05-26T06:26:00.000Z")).toMatchObject({
      status: "verified",
      eventCount: 3,
      findings: []
    });
  });

  it("surfaces production SIEM delivery failures through runtime integrity and evidence exports", () => {
    const adapter = new ReferenceAuditEvidenceAdapter({
      store: new InMemoryExternalAppendOnlyAuditStore(),
      tenantBoundary: "tenant:access-kit-test",
      location: "worm://audit/runtime-test",
      signingKeyMaterial: "runtime-test-signing-key-material",
      now: () => "2026-05-26T06:30:00.000Z"
    });
    const app = createRebacLocalApp({
      now: sequenceNow(
        "2026-05-26T06:30:00.000Z",
        "2026-05-26T06:31:00.000Z",
        "2026-05-26T06:32:00.000Z",
        "2026-05-26T06:33:00.000Z",
        "2026-05-26T06:34:00.000Z"
      ),
      persistence: {
        auditRepository: adapter,
        evidenceRepository: adapter
      }
    });

    checkDecision(app, {
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan"
    });
    const window = adapter.signAuditWindow({
      windowId: "audit-window:runtime-failed-delivery",
      periodStart: "2026-05-26T00:00:00.000Z",
      periodEnd: "2026-05-27T00:00:00.000Z",
      signedAt: "2026-05-26T06:30:30.000Z"
    });
    adapter.recordSiemDeliveryLogEntry({
      windowId: window.windowId,
      destination: "siem://access-kit/audit",
      status: "failed",
      attemptedAt: "2026-05-26T06:30:40.000Z",
      error: "forwarder unavailable"
    });

    const integrity = verifyAuditIntegrity(app);
    const evidence = exportEvidence(app, ["AU-6"], "json");

    expect(integrity).toMatchObject({
      status: "failed",
      findings: expect.arrayContaining([
        expect.objectContaining({ code: "SIEM_DELIVERY_FAILED", severity: "high" })
      ])
    });
    expect(evidence.auditIntegrity).toMatchObject({
      status: "failed",
      findings: expect.arrayContaining([
        expect.objectContaining({ code: "SIEM_DELIVERY_FAILED", severity: "high" })
      ])
    });
  });
});

function sequenceNow(...timestamps: string[]): () => string {
  let index = 0;
  return () => timestamps[Math.min(index++, timestamps.length - 1)] ?? timestamps.at(-1) ?? new Date().toISOString();
}
