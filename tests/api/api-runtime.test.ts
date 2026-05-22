import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ConnectorAdapter, EnforcementReadinessReport } from "../../packages/core/src/index.js";
import {
  createRebacApiServer,
  createRebacLocalApp,
  type RebacApiServerOptions
} from "../../packages/api/src/index.js";

type JsonObject = Record<string, unknown>;
type EnforcementReadinessReportJson = JsonObject & EnforcementReadinessReport;

let server: Server | undefined;
let baseUrl: string;

const TEST_NOW = "2026-05-21T17:00:00.000Z";
const TEST_APPROVAL_EXPIRES_AT = "2026-05-22T17:00:00.000Z";

beforeEach(async () => {
  await startServer({ now: () => TEST_NOW });
});

afterEach(async () => {
  await stopServer();
});

describe("ReBAC API runtime", () => {
  it("serves health", async () => {
    const response = await fetch(`${baseUrl}/v1/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok", version: "0.1.0" });
  });

  it("checks and explains decisions through the local engine", async () => {
    const check = await post<{ decision: string; relationshipPath: unknown[] }>("/v1/decision/check", {
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan"
    });
    const explain = await post<{ decision: string; relationshipPath: unknown[] }>("/v1/decision/explain", {
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan"
    });

    expect(check.decision).toBe("allow");
    expect(check.relationshipPath).toEqual([]);
    expect(explain.decision).toBe("allow");
    expect(explain.relationshipPath).toHaveLength(3);
  });

  it("returns 400 for malformed JSON request bodies", async () => {
    const response = await fetch(`${baseUrl}/v1/decision/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not-json"
    });
    const body = (await response.json()) as { code: string };

    expect(response.status).toBe(400);
    expect(body.code).toBe("INVALID_JSON");
  });

  it("returns 413 for oversized request bodies", async () => {
    const response = await fetch(`${baseUrl}/v1/decision/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload: "x".repeat(1024 * 1024) })
    });
    const body = (await response.json()) as { code: string };

    expect(response.status).toBe(413);
    expect(body.code).toBe("REQUEST_BODY_TOO_LARGE");
  });

  it("validates batch-check requests before evaluating them", async () => {
    for (const body of [{}, { requests: null }]) {
      const response = await fetch(`${baseUrl}/v1/decision/batch-check`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = (await response.json()) as { code: string };

      expect(response.status).toBe(400);
      expect(payload.code).toBe("INVALID_BATCH_REQUESTS");
    }
  });

  it("derives decision provenance from server state", async () => {
    const decision = await post<{ policyVersion: string; relationshipVersion: string }>("/v1/decision/explain", {
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan",
      policyVersion: "policy:forged",
      relationshipVersion: "tuple-set:forged"
    });
    const audit = await get<{
      items: Array<{ eventType: string; policyVersion?: string; relationshipVersion?: string }>;
    }>("/v1/audit/events");
    const decisionEvent = audit.items.find((event) => event.eventType === "decision.allowed");

    expect(decision).toMatchObject({
      policyVersion: "policy:local-v1",
      relationshipVersion: "tuple-set:local-v1"
    });
    expect(decisionEvent).toMatchObject({
      policyVersion: "policy:local-v1",
      relationshipVersion: "tuple-set:local-v1"
    });
  });

  it("validates subject and resource creates before storing them", async () => {
    const subjectResponse = await fetch(`${baseUrl}/v1/subjects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "user:missing-fields" })
    });
    const resourceResponse = await fetch(`${baseUrl}/v1/resources`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "document:missing-fields" })
    });
    const subjectBody = (await subjectResponse.json()) as { code: string };
    const resourceBody = (await resourceResponse.json()) as { code: string };

    expect(subjectResponse.status).toBe(400);
    expect(subjectBody.code).toBe("INVALID_SUBJECT");
    expect(resourceResponse.status).toBe(400);
    expect(resourceBody.code).toBe("INVALID_RESOURCE");
  });

  it("uses the configured actor for decision audit events", async () => {
    await restartServer({
      now: () => "2026-05-21T17:00:00.000Z",
      actor: "user:control-plane-admin"
    });

    await post<{ decision: string }>("/v1/decision/check", {
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan"
    });
    const audit = await get<{ items: Array<{ eventType: string; actor: string }> }>("/v1/audit/events");
    const decisionEvent = audit.items.find((event) => event.eventType === "decision.allowed");

    expect(decisionEvent?.actor).toBe("user:control-plane-admin");
  });

  it("audits relationship writes and subsequent denied decisions", async () => {
    await fetch(`${baseUrl}/v1/relationships`, {
      method: "PUT",
      headers: { "content-type": "application/json", "idempotency-key": "idem-deny" },
      body: JSON.stringify({
        id: "relationship:alice-denied-document",
        subjectId: "user:alice",
        relation: "denied",
        objectId: "document:case-plan",
        sourceSystem: "mock",
        assertedAt: "2026-05-21T17:00:00.000Z",
        status: "active",
        version: "tuple:v1",
        createdAt: "2026-05-21T17:00:00.000Z"
      })
    });
    const decision = await post<{ decision: string; reasonCode: string }>("/v1/decision/explain", {
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan"
    });
    const audit = await get<{ items: Array<{ eventType: string }> }>("/v1/audit/events");

    expect(decision.decision).toBe("deny");
    expect(decision.reasonCode).toBe("DENY_EXPLICIT_OVERRIDE");
    expect(audit.items.map((event: { eventType: string }) => event.eventType)).toContain("relationship.created");
    expect(audit.items.map((event: { eventType: string }) => event.eventType)).toContain("decision.denied");
  });

  it("filters audit events by subject, resource, and lower time bound", async () => {
    await restartServer({
      now: sequenceNow("2026-05-21T17:00:00.000Z", "2026-05-21T17:05:00.000Z")
    });
    await fetch(`${baseUrl}/v1/relationships`, {
      method: "PUT",
      headers: { "content-type": "application/json", "idempotency-key": "idem-audit-filter" },
      body: JSON.stringify({
        id: "relationship:alice-filtered-document",
        subjectId: "user:alice",
        relation: "reader_of",
        objectId: "document:case-plan",
        sourceSystem: "mock",
        assertedAt: "2026-05-21T17:00:00.000Z",
        status: "active",
        version: "tuple:v1",
        createdAt: "2026-05-21T17:00:00.000Z"
      })
    });
    await post<{ decision: string }>("/v1/decision/check", {
      subjectId: "user:external",
      action: "read",
      resourceId: "document:case-plan"
    });

    const aliceEvents = await get<{ items: Array<{ subjectId?: string }> }>("/v1/audit/events?subjectId=user%3Aalice");
    const documentEvents = await get<{ items: Array<{ resourceId?: string }> }>("/v1/audit/events?resourceId=document%3Acase-plan");
    const recentEvents = await get<{ items: Array<{ eventType: string }> }>("/v1/audit/events?from=2026-05-21T17%3A04%3A00.000Z");

    expect(aliceEvents.items).toHaveLength(1);
    expect(aliceEvents.items.every((event) => event.subjectId === "user:alice")).toBe(true);
    expect(documentEvents.items).toHaveLength(2);
    expect(documentEvents.items.every((event) => event.resourceId === "document:case-plan")).toBe(true);
    expect(recentEvents.items.map((event) => event.eventType)).toEqual(["decision.denied"]);
  });

  it("exports evidence for the observed audit period", async () => {
    const times = [
      "2026-05-20T01:00:00.000Z",
      "2026-05-21T17:00:00.000Z",
      "2026-05-21T17:00:01.000Z"
    ];
    await restartServer({
      now: () => times.shift() ?? "2026-05-21T17:00:02.000Z"
    });
    await fetch(`${baseUrl}/v1/relationships`, {
      method: "PUT",
      headers: { "content-type": "application/json", "idempotency-key": "idem-evidence" },
      body: JSON.stringify({
        id: "relationship:alice-reader-document",
        subjectId: "user:alice",
        relation: "reader_of",
        objectId: "document:case-plan",
        sourceSystem: "mock",
        assertedAt: "2026-05-20T01:00:00.000Z",
        status: "active",
        version: "tuple:v1",
        createdAt: "2026-05-20T01:00:00.000Z"
      })
    });

    const evidence = await get<{
      periodStart: string;
      periodEnd: string;
      generatedAt: string;
    }>("/v1/evidence/export");

    expect(evidence.periodStart).toBe("2026-05-20T01:00:00.000Z");
    expect(evidence.periodStart).not.toBe("2026-05-01T00:00:00.000Z");
    expect(evidence.periodEnd).toBe("2026-05-21T17:00:00.000Z");
    expect(evidence.generatedAt).toBe("2026-05-21T17:00:00.000Z");
  });

  it("validates evidence export format", async () => {
    const response = await fetch(`${baseUrl}/v1/evidence/export?format=html`);
    const body = (await response.json()) as { code: string };

    expect(response.status).toBe(400);
    expect(body.code).toBe("INVALID_EVIDENCE_FORMAT");
  });

  it("runs read-only mock connector discovery and exposes native access readback", async () => {
    const sync = await post<{
      connectorId: string;
      mode: string;
      status: string;
      counts: { subjects: number; resources: number; relationships: number; nativeGrants: number; warnings: number };
      warnings: unknown[];
      cursor?: unknown;
      evidence?: { readOnly?: boolean; nativeAccessReadback?: boolean };
      auditEventIds: string[];
    }>("/v1/connectors/mock/sync", { mode: "read_only" });
    const nativeAccess = await get<{
      items: Array<{
        subjectId: string;
        principalType: string;
        nativePermission: string;
        grantType: string;
        sourceConnectorId: string;
      }>;
    }>(
      "/v1/resources/document%3Acase-plan/native-access?connectorId=mock"
    );
    const audit = await get<{ items: Array<{ eventType: string }> }>("/v1/audit/events");

    expect(sync.connectorId).toBe("mock");
    expect(sync.mode).toBe("read_only");
    expect(sync.status).toBe("completed_with_warnings");
    expect(sync.counts).toMatchObject({
      subjects: 3,
      resources: 2,
      relationships: 3,
      nativeGrants: 4,
      warnings: 1
    });
    expect(sync.warnings).toHaveLength(1);
    expect(sync.cursor).toMatchObject({ highWatermark: "cursor:mock:20260521t170000000z" });
    expect(sync.evidence).toMatchObject({ readOnly: true, nativeAccessReadback: true });
    expect(sync.auditEventIds).toHaveLength(1);
    expect(nativeAccess.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        subjectId: "user:alice",
        principalType: "user",
        nativePermission: "read",
        grantType: "direct",
        sourceConnectorId: "mock"
      })
    ]));
    expect(audit.items.map((event) => event.eventType)).toContain("connector.discovery_completed");
    expect(audit.items.map((event) => event.eventType)).toContain("connector.current_access_read");
  });

  it("lists synthetic read-only connectors and exposes permission checks", async () => {
    const connectors = await get<{
      items: Array<{ id: string; provider: string; tenantBoundary: string; requiredReadScopes: string[] }>;
    }>("/v1/connectors");
    const test = await post<{ valid: boolean; checks: Array<{ name: string; status: string; evidence?: unknown }> }>(
      "/v1/connectors/sharepoint-readonly/test",
      {}
    );

    expect(connectors.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "entra-readonly",
        provider: "entra-id",
        requiredReadScopes: expect.arrayContaining(["synthetic:directory.read"])
      }),
      expect.objectContaining({
        id: "sharepoint-readonly",
        provider: "sharepoint",
        tenantBoundary: "synthetic:sharepoint:tenant"
      }),
      expect.objectContaining({
        id: "aws-readonly",
        provider: "aws",
        requiredReadScopes: expect.arrayContaining(["synthetic:organizations.read"])
      })
    ]));
    expect(test.valid).toBe(true);
    expect(test.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "read_only_mode", status: "pass" }),
      expect.objectContaining({ name: "scope:synthetic:sites.read", status: "pass" })
    ]));
  });

  it("records synthetic provider discovery runs and filters observed native grants", async () => {
    const sync = await post<{
      id: string;
      status: string;
      counts: { subjects: number; resources: number; relationships: number; nativeGrants: number; warnings: number };
      warnings: Array<{ code: string; scope: string }>;
      cursor?: { highWatermark?: string };
    }>("/v1/connectors/sharepoint-readonly/sync", { mode: "read_only" });
    const runs = await get<{ items: Array<{ id: string; connectorId: string; status: string }> }>(
      "/v1/discovery/runs?connectorId=sharepoint-readonly&status=completed_with_warnings"
    );
    const inheritedGrants = await get<{
      items: Array<{ targetObjectId: string; subjectId: string; principalType: string; grantType: string; inheritedFromObjectId?: string }>;
    }>(
      "/v1/resources/document%3Acase-records-plan/native-access?connectorId=sharepoint-readonly&grantType=inherited&principalType=group"
    );

    expect(sync.status).toBe("completed_with_warnings");
    expect(sync.counts).toMatchObject({
      subjects: 2,
      resources: 3,
      relationships: 2,
      nativeGrants: 4,
      warnings: 1
    });
    expect(sync.warnings).toEqual([
      expect.objectContaining({ code: "SHAREPOINT_PERSONAL_SITE_SKIPPED", scope: "resources" })
    ]);
    expect(sync.cursor).toMatchObject({ highWatermark: "cursor:sharepoint:20260521t170000000z" });
    expect(runs.items).toEqual([expect.objectContaining({ id: sync.id, connectorId: "sharepoint-readonly" })]);
    expect(inheritedGrants.items).toEqual([
      expect.objectContaining({
        targetObjectId: "document:case-records-plan",
        subjectId: "group:sp-case-members",
        principalType: "group",
        grantType: "inherited",
        inheritedFromObjectId: "folder:case-records-evidence"
      })
    ]);
  });

  it("keeps repeated discovery runs distinct under fixed timestamps", async () => {
    const app = createRebacLocalApp({ now: () => "2026-05-21T17:00:00.000Z" });
    await restartServer({ app });

    const first = await post<{ id: string }>("/v1/connectors/mock/sync", { mode: "read_only" });
    const second = await post<{ id: string }>("/v1/connectors/mock/sync", { mode: "read_only" });
    const runs = app.store.listDiscoveryRuns({ connectorId: "mock" });

    expect(first.id).not.toBe(second.id);
    expect(runs.map((run) => run.id)).toEqual([first.id, second.id]);
  });

  it("rejects connector sync modes outside Phase 2 read-only discovery", async () => {
    const response = await fetch(`${baseUrl}/v1/connectors/mock/sync`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "enforcement" })
    });
    const body = (await response.json()) as { code: string };

    expect(response.status).toBe(400);
    expect(body.code).toBe("UNSUPPORTED_CONNECTOR_MODE");
  });

  it("requires connector sync callers to request read-only mode explicitly", async () => {
    const response = await fetch(`${baseUrl}/v1/connectors/mock/sync`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });
    const body = (await response.json()) as { code: string };

    expect(response.status).toBe(400);
    expect(body.code).toBe("MISSING_CONNECTOR_MODE");
  });

  it("runs dry-run reconciliation", async () => {
    const reconciliation = await post<{ status: string; findings: unknown[]; counts: { findings: number; highOrCritical: number }; auditEventIds: string[] }>(
      "/v1/reconciliation/run",
      {
        connectorId: "mock",
        dryRun: true
      }
    );

    expect(reconciliation.status).toBe("completed");
    expect(reconciliation.findings).toHaveLength(1);
    expect(reconciliation.counts).toEqual({ findings: 1, highOrCritical: 1 });
    expect(reconciliation.auditEventIds).toHaveLength(2);
  });

  it("filters reconciliation findings by severity", async () => {
    await post<{ findings: unknown[] }>("/v1/reconciliation/run", {
      connectorId: "mock",
      dryRun: true
    });

    const highFindings = await get<{ items: Array<{ severity: string }> }>("/v1/reconciliation/findings?severity=high");
    const mediumFindings = await get<{ items: Array<{ severity: string }> }>("/v1/reconciliation/findings?severity=medium");

    expect(highFindings.items).toHaveLength(1);
    expect(highFindings.items[0]?.severity).toBe("high");
    expect(mediumFindings.items).toEqual([]);
  });

  it("requires explicit dry-run reconciliation", async () => {
    for (const body of [{ connectorId: "mock" }, { connectorId: "mock", dryRun: false }]) {
      const response = await fetch(`${baseUrl}/v1/reconciliation/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = (await response.json()) as { code: string };

      expect(response.status).toBe(400);
      expect(payload.code).toBe("DRY_RUN_REQUIRED");
    }
  });

  it("validates connector sync mode", async () => {
    const response = await fetch(`${baseUrl}/v1/connectors/mock/sync`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "root" })
    });
    const body = (await response.json()) as { code: string };

    expect(response.status).toBe(400);
    expect(body.code).toBe("UNSUPPORTED_CONNECTOR_MODE");
  });

  it("uses the registered connector map for provisioning plans", async () => {
    const app = createRebacLocalApp({ now: () => "2026-05-21T17:00:00.000Z" });
    const connector = app.connectors.get("mock");
    expect(connector).toBeDefined();

    if (!connector) {
      return;
    }

    app.connectors.delete("mock");
    app.connectors.set("renamed-mock", connector);
    await restartServer({ app });

    const plan = await post<{ status: string; connectorId: string; actions: unknown[] }>("/v1/provisioning/plans", {
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan",
      connectorId: "renamed-mock",
      dryRun: true
    });

    expect(plan.status).toBe("planned");
    expect(plan.connectorId).toBe("renamed-mock");
    expect(plan.actions).toHaveLength(1);
  });

  it("creates dry-run provisioning jobs with verification and idempotent replay", async () => {
    const plan = await post<{
      id: string;
      connectorId: string;
      idempotencyKey: string;
      actions: Array<{
        status: string;
        verification: { status: string; method: string };
        compensation: { status: string; operation: string };
      }>;
    }>("/v1/provisioning/plans", {
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan",
      connectorId: "mock",
      dryRun: true
    });
    const first = await postWithIdempotency<{
      id: string;
      status: string;
      dryRun: boolean;
      connectorId: string;
      actionResults: Array<{ status: string; message: string; verification: { status: string }; compensation: { status: string } }>;
      verification: { status: string; readbackState: { providerWrite: boolean } };
      auditEventIds: string[];
    }>("/v1/provisioning/jobs", "idem-phase3-job", {
      planId: plan.id,
      approverId: "user:approver",
      dryRun: true
    });
    const replay = await postWithIdempotency<{ id: string }>("/v1/provisioning/jobs", "idem-phase3-job", {
      planId: plan.id,
      approverId: "user:approver",
      dryRun: true
    });
    const fetched = await get<{ id: string }>(`/v1/provisioning/jobs/${encodeURIComponent(first.id)}`);
    const audit = await get<{ items: Array<{ eventType: string }> }>("/v1/audit/events");

    expect(plan.connectorId).toBe("mock");
    expect(plan.idempotencyKey).toBe("idem-test");
    expect(plan.actions[0]).toMatchObject({
      status: "planned",
      verification: { status: "pending", method: "connector.current_access_readback" },
      compensation: { status: "planned", operation: "revoke" }
    });
    expect(first).toMatchObject({
      status: "completed",
      dryRun: true,
      connectorId: "mock",
      verification: {
        status: "verified",
        readbackState: { providerWrite: false }
      }
    });
    expect(first.actionResults).toEqual([
      expect.objectContaining({
        status: "skipped",
        message: "Dry-run only: provider write was not executed.",
        verification: expect.objectContaining({ status: "verified" }),
        compensation: expect.objectContaining({ status: "planned" })
      })
    ]);
    expect(first.auditEventIds.length).toBeGreaterThanOrEqual(3);
    expect(replay.id).toBe(first.id);
    expect(fetched.id).toBe(first.id);
    expect(audit.items.map((event) => event.eventType)).toEqual(expect.arrayContaining([
      "provisioning.planned",
      "provisioning.compensation_planned",
      "provisioning.skipped",
      "provisioning.verified",
      "provisioning.completed"
    ]));
  });

  it("replays provisioning plans by idempotency key and rejects conflicting reuse", async () => {
    const requestBody = {
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan",
      connectorId: "mock",
      dryRun: true
    };
    const first = await postWithIdempotency<{ id: string }>("/v1/provisioning/plans", "idem-phase3-plan-replay", requestBody);
    const replay = await postWithIdempotency<{ id: string }>("/v1/provisioning/plans", "idem-phase3-plan-replay", requestBody);
    const conflict = await fetch(`${baseUrl}/v1/provisioning/plans`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "idem-phase3-plan-replay" },
      body: JSON.stringify({
        ...requestBody,
        resourceId: "workspace:case"
      })
    });
    const body = (await conflict.json()) as { code: string };

    expect(replay.id).toBe(first.id);
    expect(conflict.status).toBe(409);
    expect(body.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("rejects idempotent provisioning job replay for a different plan", async () => {
    const firstPlan = await postWithIdempotency<{ id: string }>("/v1/provisioning/plans", "idem-phase3-plan-one", {
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan",
      connectorId: "mock",
      dryRun: true
    });
    const secondPlan = await postWithIdempotency<{ id: string }>("/v1/provisioning/plans", "idem-phase3-plan-two", {
      subjectId: "user:alice",
      action: "read",
      resourceId: "workspace:case",
      connectorId: "mock",
      dryRun: true
    });

    await postWithIdempotency<{ id: string }>("/v1/provisioning/jobs", "idem-phase3-shared-job", {
      planId: firstPlan.id,
      approverId: "user:approver",
      dryRun: true
    });
    const response = await fetch(`${baseUrl}/v1/provisioning/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "idem-phase3-shared-job" },
      body: JSON.stringify({
        planId: secondPlan.id,
        approverId: "user:approver",
        dryRun: true
      })
    });
    const body = (await response.json()) as { code: string };

    expect(response.status).toBe(409);
    expect(body.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("runs controlled mock enforcement with approval, verification, and audit evidence", async () => {
    const approval = controlledApproval();
    const control = controlledEnforcement();
    const readiness = await createReadyReadinessReport("mock", control);
    const plan = await post<{
      id: string;
      mode: string;
      status: string;
      approval: { changeTicket: string };
      control: { syntheticOnly: boolean; liveProviderWrites: boolean };
      readinessReportId: string;
      actions: Array<{ dryRun: boolean; status: string }>;
    }>("/v1/provisioning/plans", {
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan",
      connectorId: "mock",
      mode: "enforcement",
      dryRun: false,
      approval,
      control,
      readinessReportId: readiness.id
    });
    const job = await postWithIdempotency<{
      mode: string;
      status: string;
      dryRun: boolean;
      approval: { approverId: string; changeTicket: string };
      control: { syntheticOnly: boolean; liveProviderWrites: boolean };
      actionResults: Array<{ status: string; dryRun: boolean; verification: { status: string } }>;
      verification: { status: string; readbackState: { syntheticProviderWrite: boolean; liveProviderWrite: boolean } };
      auditEventIds: string[];
    }>("/v1/provisioning/jobs", "idem-phase4-controlled-job", {
      planId: plan.id,
      approverId: approval.approverId,
      mode: "enforcement",
      dryRun: false,
      approval,
      control
    });
    const audit = await get<{ items: Array<{ eventType: string; payload: Record<string, unknown> }> }>("/v1/audit/events");

    expect(plan).toMatchObject({
      mode: "enforcement",
      status: "approved",
      approval: { changeTicket: "chg:phase4-controlled-enforcement" },
      control: { syntheticOnly: true, liveProviderWrites: false },
      readinessReportId: readiness.id
    });
    expect(plan.actions).toEqual([expect.objectContaining({ dryRun: false, status: "planned" })]);
    expect(job).toMatchObject({
      mode: "enforcement",
      status: "completed",
      dryRun: false,
      approval: { approverId: "user:approver", changeTicket: "chg:phase4-controlled-enforcement" },
      control: { syntheticOnly: true, liveProviderWrites: false },
      verification: {
        status: "verified",
        readbackState: {
          syntheticProviderWrite: true,
          liveProviderWrite: false
        }
      }
    });
    expect(job.actionResults).toEqual([
      expect.objectContaining({
        status: "applied",
        dryRun: false,
        verification: expect.objectContaining({ status: "verified" })
      })
    ]);
    expect(job.auditEventIds.length).toBeGreaterThanOrEqual(3);
    expect(audit.items.map((event) => event.eventType)).toEqual(expect.arrayContaining([
      "provisioning.requested",
      "provisioning.planned",
      "provisioning.approved",
      "connector.enforcement_readiness_checked",
      "connector.permission_changed",
      "provisioning.verified",
      "provisioning.completed"
    ]));
    expect(audit.items.find((event) => event.eventType === "connector.permission_changed")?.payload).toMatchObject({
      syntheticProviderWrite: true,
      liveProviderWrite: false,
      providerWrite: false
    });
  });

  it("records connector enforcement readiness and exposes readiness history", async () => {
    const ready = await createReadyReadinessReport("mock", controlledEnforcement());
    const blocked = await post<{
      id: string;
      connectorId: string;
      status: string;
      checks: Array<{ name: string; status: string }>;
    }>("/v1/connectors/sharepoint-readonly/enforcement-readiness", {
      mode: "enforcement",
      control: controlledEnforcement()
    });
    const readyReports = await get<{ items: Array<{ id: string; status: string }> }>("/v1/connectors/mock/enforcement-readiness?status=ready");
    const audit = await get<{ items: Array<{ eventType: string }> }>("/v1/audit/events");

    expect(ready).toMatchObject({
      connectorId: "mock",
      status: "ready",
      liveProviderWritesAllowed: false,
      control: { syntheticOnly: true, liveProviderWrites: false }
    });
    expect(ready.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "mock_enforcement_boundary", status: "pass" }),
      expect.objectContaining({ name: "least_privilege_review", status: "pass" })
    ]));
    expect(blocked).toMatchObject({
      connectorId: "sharepoint-readonly",
      status: "blocked"
    });
    expect(blocked.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "mock_enforcement_boundary", status: "fail" }),
      expect.objectContaining({ name: "provisioning_capability", status: "fail" })
    ]));
    expect(readyReports.items).toEqual([expect.objectContaining({ id: ready.id, status: "ready" })]);
    expect(audit.items.map((event) => event.eventType)).toContain("connector.enforcement_readiness_checked");
  });

  it("rejects unsafe readiness change-ticket patterns", async () => {
    const response = await fetch(`${baseUrl}/v1/connectors/mock/enforcement-readiness`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "enforcement",
        control: controlledEnforcement(),
        changeTicketPattern: "^(a+)+$"
      })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "INVALID_CHANGE_TICKET_PATTERN" });
  });

  it("blocks readiness when compensation intent cannot be verified", async () => {
    const app = createRebacLocalApp({ now: () => "2026-05-21T17:00:00.000Z" });
    const connector = app.connectors.get("mock");

    expect(connector).toBeDefined();
    if (!connector) {
      return;
    }

    const connectorId = "mock-no-compensation";
    app.connectors.set(connectorId, connectorWithoutCompensation(connector, connectorId));
    await restartServer({ app });

    const report = await post<EnforcementReadinessReportJson>(`/v1/connectors/${connectorId}/enforcement-readiness`, {
      mode: "enforcement",
      control: controlledEnforcement()
    });

    expect(report.status).toBe("blocked");
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "rollback_compensation_required",
        status: "fail",
        evidence: expect.objectContaining({ actionCount: 1, compensatedActionCount: 0 })
      })
    ]));
  });

  it("blocks controlled enforcement without an approval", async () => {
    const response = await fetch(`${baseUrl}/v1/provisioning/plans`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "idem-test-aaaa" },
      body: JSON.stringify({
        subjectId: "user:alice",
        action: "read",
        resourceId: "document:case-plan",
        connectorId: "mock",
        mode: "enforcement",
        dryRun: false,
        control: controlledEnforcement()
      })
    });
    const body = (await response.json()) as { code: string };

    expect(response.status).toBe(400);
    expect(body.code).toBe("CONTROLLED_ENFORCEMENT_APPROVAL_REQUIRED");
  });

  it("rejects malformed controlled enforcement approval timestamps", async () => {
    const malformedApprovals = [
      { idempotencyKey: "idem-test-bbbb", approval: { ...controlledApproval(), approvedAt: "not-a-date" } },
      { idempotencyKey: "idem-test-cccc", approval: { ...controlledApproval(), expiresAt: "not-a-date" } }
    ];

    for (const { idempotencyKey, approval } of malformedApprovals) {
      const response = await fetch(`${baseUrl}/v1/provisioning/plans`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify({
          subjectId: "user:alice",
          action: "read",
          resourceId: "document:case-plan",
          connectorId: "mock",
          mode: "enforcement",
          dryRun: false,
          approval,
          control: controlledEnforcement()
        })
      });
      const body = (await response.json()) as { code: string };

      expect(response.status).toBe(400);
      expect(body.code).toBe("INVALID_PROVISIONING_APPROVAL");
    }
  });

  it("blocks controlled enforcement without a ready connector readiness report", async () => {
    const response = await fetch(`${baseUrl}/v1/provisioning/plans`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "idem-test-cccc" },
      body: JSON.stringify({
        subjectId: "user:alice",
        action: "read",
        resourceId: "document:case-plan",
        connectorId: "mock",
        mode: "enforcement",
        dryRun: false,
        approval: controlledApproval(),
        control: controlledEnforcement()
      })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "ENFORCEMENT_READINESS_REQUIRED" });
  });

  it("rejects controlled enforcement when readiness ticket policy does not match approval", async () => {
    const control = controlledEnforcement();
    const readiness = await createReadyReadinessReport("mock", control, "^chg:approved-only$");
    const response = await fetch(`${baseUrl}/v1/provisioning/plans`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "idem-test-dddd" },
      body: JSON.stringify({
        subjectId: "user:alice",
        action: "read",
        resourceId: "document:case-plan",
        connectorId: "mock",
        mode: "enforcement",
        dryRun: false,
        approval: controlledApproval(),
        control,
        readinessReportId: readiness.id
      })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "ENFORCEMENT_READINESS_CHANGE_TICKET_MISMATCH" });
  });

  it("reports blocked readiness before matching approval change tickets", async () => {
    const app = createRebacLocalApp({ now: () => "2026-05-21T17:00:00.000Z" });
    await restartServer({ app });

    const control = controlledEnforcement();
    const readiness = await createReadyReadinessReport("mock", control, "^chg:approved-only$");
    app.store.recordEnforcementReadinessReport({
      ...readiness,
      status: "blocked",
      checks: [
        ...readiness.checks,
        {
          name: "test_blocked_report",
          status: "fail",
          message: "Synthetic blocked report for readiness ordering coverage."
        }
      ]
    });

    const response = await fetch(`${baseUrl}/v1/provisioning/plans`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "idem-test-readiness-blocked-first" },
      body: JSON.stringify({
        subjectId: "user:alice",
        action: "read",
        resourceId: "document:case-plan",
        connectorId: "mock",
        mode: "enforcement",
        dryRun: false,
        approval: controlledApproval(),
        control,
        readinessReportId: readiness.id
      })
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "ENFORCEMENT_READINESS_BLOCKED" });
  });

  it("rejects enforcement jobs when approval evidence differs from the approved plan", async () => {
    const approval = controlledApproval();
    const control = controlledEnforcement();
    const readiness = await createReadyReadinessReport("mock", control);
    const plan = await post<{ id: string }>("/v1/provisioning/plans", {
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan",
      connectorId: "mock",
      mode: "enforcement",
      dryRun: false,
      approval,
      control,
      readinessReportId: readiness.id
    });
    const response = await fetch(`${baseUrl}/v1/provisioning/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "idem-test-bbbb" },
      body: JSON.stringify({
        planId: plan.id,
        approverId: approval.approverId,
        mode: "enforcement",
        dryRun: false,
        approval: { ...approval, changeTicket: "chg:different" },
        control
      })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "CONTROLLED_ENFORCEMENT_APPROVAL_MISMATCH" });
  });

  it("blocks controlled enforcement for read-only connectors and incident mode", async () => {
    const readOnlyResponse = await fetch(`${baseUrl}/v1/provisioning/plans`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "idem-phase4-readonly-connector" },
      body: JSON.stringify({
        subjectId: "user:alice",
        action: "read",
        resourceId: "document:case-plan",
        connectorId: "sharepoint-readonly",
        mode: "enforcement",
        dryRun: false,
        approval: controlledApproval(),
        control: controlledEnforcement()
      })
    });
    const incidentResponse = await fetch(`${baseUrl}/v1/provisioning/plans`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "idem-phase4-incident-mode" },
      body: JSON.stringify({
        subjectId: "user:alice",
        action: "read",
        resourceId: "document:case-plan",
        connectorId: "mock",
        mode: "enforcement",
        dryRun: false,
        approval: controlledApproval(),
        control: { ...controlledEnforcement(), incidentMode: true }
      })
    });

    expect(readOnlyResponse.status).toBe(403);
    await expect(readOnlyResponse.json()).resolves.toMatchObject({ code: "CONNECTOR_ENFORCEMENT_DISABLED" });
    expect(incidentResponse.status).toBe(409);
    await expect(incidentResponse.json()).resolves.toMatchObject({ code: "CONTROLLED_ENFORCEMENT_INCIDENT_MODE_BLOCKED" });
  });

  it("requires provisioning dry-run mode for plans and jobs", async () => {
    const planResponse = await fetch(`${baseUrl}/v1/provisioning/plans`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "idem-plan-dry-run-required" },
      body: JSON.stringify({
        subjectId: "user:alice",
        action: "read",
        resourceId: "document:case-plan",
        dryRun: false
      })
    });
    const jobResponse = await fetch(`${baseUrl}/v1/provisioning/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "idem-job-dry-run-required" },
      body: JSON.stringify({
        planId: "plan:missing",
        approverId: "user:approver"
      })
    });

    expect(planResponse.status).toBe(400);
    await expect(planResponse.json()).resolves.toMatchObject({ code: "DRY_RUN_REQUIRED" });
    expect(jobResponse.status).toBe(400);
    await expect(jobResponse.json()).resolves.toMatchObject({ code: "DRY_RUN_REQUIRED" });
  });

  it("validates provisioning connector IDs when provided", async () => {
    const response = await fetch(`${baseUrl}/v1/provisioning/plans`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "idem-invalid-connector" },
      body: JSON.stringify({
        subjectId: "user:alice",
        action: "read",
        resourceId: "document:case-plan",
        connectorId: "",
        dryRun: true
      })
    });
    const body = (await response.json()) as { code: string };

    expect(response.status).toBe(400);
    expect(body.code).toBe("INVALID_CONNECTOR_ID");
  });

  it("validates reconciliation run connector IDs", async () => {
    const response = await fetch(`${baseUrl}/v1/reconciliation/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });
    const body = (await response.json()) as { code: string };

    expect(response.status).toBe(400);
    expect(body.code).toBe("MISSING_CONNECTOR_ID");
  });
});

function controlledApproval(): JsonObject {
  return {
    decision: "approved",
    approverId: "user:approver",
    changeTicket: "chg:phase4-controlled-enforcement",
    approvedAt: "2026-05-21T17:00:00.000Z",
    expiresAt: TEST_APPROVAL_EXPIRES_AT,
    reason: "Synthetic Phase 4 controlled enforcement proof point."
  };
}

function controlledEnforcement(): JsonObject {
  return {
    syntheticOnly: true,
    liveProviderWrites: false,
    incidentMode: false,
    breakGlass: false
  };
}

async function createReadyReadinessReport(
  connectorId: string,
  control: JsonObject,
  changeTicketPattern = "^chg:[a-z0-9_:-]+$"
): Promise<EnforcementReadinessReportJson> {
  return post(`/v1/connectors/${encodeURIComponent(connectorId)}/enforcement-readiness`, {
    mode: "enforcement",
    control,
    requiredApproverRole: "access-approver",
    changeTicketPattern
  });
}

function connectorWithoutCompensation(connector: ConnectorAdapter, connectorId: string): ConnectorAdapter {
  return {
    id: connectorId,
    mode: connector.mode,
    capabilities: { ...connector.capabilities },
    provider: connector.provider ?? connector.id,
    tenantBoundary: connector.tenantBoundary ?? "synthetic:local",
    requiredReadScopes: connector.requiredReadScopes ?? [],
    discoverSubjects: () => connector.discoverSubjects(),
    discoverResources: () => connector.discoverResources(),
    discoverRelationships: () => connector.discoverRelationships(),
    readCurrentAccess: (resourceId) => connector.readCurrentAccess(resourceId),
    testReadOnlyAccess: connector.testReadOnlyAccess ? () => connector.testReadOnlyAccess?.() ?? Promise.resolve([]) : undefined,
    getDiscoveryMetadata: connector.getDiscoveryMetadata ? () => connector.getDiscoveryMetadata?.() ?? {
      provider: connector.provider ?? connector.id,
      tenantBoundary: connector.tenantBoundary ?? "synthetic:local",
      requiredReadScopes: connector.requiredReadScopes ?? [],
      synthetic: true,
      warnings: []
    } : undefined,
    planProvisioningChange: async (request) => {
      const plan = await connector.planProvisioningChange(request);

      return {
        ...plan,
        connectorId,
        actions: plan.actions.map((action) => {
          const { compensation, ...actionWithoutCompensation } = action;
          void compensation;
          return actionWithoutCompensation;
        })
      };
    },
    applyProvisioningChange: (plan) => connector.applyProvisioningChange(plan),
    verifyProvisioningChange: (plan) => connector.verifyProvisioningChange(plan),
    revokeAccess: (nativeGrantId) => connector.revokeAccess(nativeGrantId),
    detectDrift: () => connector.detectDrift(),
    emitEvidence: (events) => connector.emitEvidence(events)
  };
}

async function startServer(options: RebacApiServerOptions): Promise<void> {
  server = createRebacApiServer(options);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
}

async function stopServer(): Promise<void> {
  if (!server?.listening) {
    return;
  }

  server.close();
  await once(server, "close");
  server = undefined;
}

async function restartServer(options: RebacApiServerOptions): Promise<void> {
  await stopServer();
  await startServer(options);
}

function sequenceNow(...timestamps: string[]): () => string {
  let index = 0;
  return () => timestamps[index++] ?? timestamps.at(-1) ?? "2026-05-21T17:00:00.000Z";
}

async function post<T extends JsonObject>(path: string, body: unknown): Promise<T> {
  return postWithIdempotency(path, "idem-test", body);
}

async function postWithIdempotency<T extends JsonObject>(path: string, idempotencyKey: string, body: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
    body: JSON.stringify(body)
  });

  expect(response.ok).toBe(true);
  return response.json() as Promise<T>;
}

async function get<T extends JsonObject>(path: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`);

  expect(response.ok).toBe(true);
  return response.json() as Promise<T>;
}
