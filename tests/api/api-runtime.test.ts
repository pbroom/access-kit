import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AuditRecorder,
  canonicalEvidenceContent,
  createDefaultPolicyModel,
  createLocalEngineSeed,
  LocalAppendOnlyAuditRepository,
  LocalFileEvidenceRepository,
  LocalJsonFileGraphRepository,
  LocalJsonFileJobRepository,
  LocalJsonFileStateRepository,
  sha256,
  stableStringify,
  verifyEvidenceExport,
  type AdminAuthorizationDescriptor,
  type AuditEvent,
  type AuditEventRepository,
  type AuditIntegrityReport,
  type ConnectorAdapter,
  type DecisionResult,
  type DriftFinding,
  type EnforcementControl,
  type EnforcementReadinessReport,
  type EvidencePackageRepository,
  type EvidenceExport,
  type ProvisioningApproval,
  type RebacSeedData,
  type RelationshipTuple,
  type RebacStateRepository
} from "../../packages/core/src/index.js";
import {
  checkDecision,
  checkEnforcementReadiness,
  createPolicy,
  createProvisioningJob,
  createProvisioningPlan,
  createRebacApiServer,
  createRebacLocalApp,
  createLocalRuntimePersistence,
  listPolicies,
  publishPolicy,
  readRebacApiRuntimeConfig,
  runReconciliation,
  syncConnector,
  validatePolicy,
  type RebacApiServerOptions
} from "../../packages/api/src/index.js";

type JsonObject = Record<string, unknown>;
type EnforcementReadinessReportJson = JsonObject & EnforcementReadinessReport;

let server: Server | undefined;
let baseUrl: string;
const tempDirs: string[] = [];

const TEST_NOW = "2026-05-21T17:00:00.000Z";
const TEST_APPROVAL_EXPIRES_AT = "2026-05-22T17:00:00.000Z";

beforeEach(async () => {
  await startServer({ now: () => TEST_NOW });
});

afterEach(async () => {
  await stopServer();
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("ReBAC API runtime", () => {
  it("serves health", async () => {
    const response = await fetch(`${baseUrl}/v1/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok", version: "0.1.0" });
  });

  it("implements documented policy route operations", async () => {
    await restartServer({
      now: sequenceNow(
        "2026-05-21T17:00:00.000Z",
        "2026-05-21T17:05:00.000Z",
        "2026-05-21T17:10:00.000Z",
        "2026-05-21T17:15:00.000Z",
        "2026-05-21T17:20:00.000Z",
        "2026-05-21T17:25:00.000Z"
      )
    });

    const listed = await get<{ items: JsonObject[] }>("/v1/policies");
    expect(listed.items).toEqual([]);

    const draft = await postWithIdempotency<JsonObject>("/v1/policies", "idem-policy-create", {
      name: "case access",
      model: createDefaultPolicyModel(),
      tests: [{ name: "default proof points" }]
    });
    expect(draft).toMatchObject({
      id: expect.stringMatching(/^policy:case-access:/),
      status: "draft",
      createdAt: TEST_NOW
    });

    const validation = await post<JsonObject>(`/v1/policies/${encodeURIComponent(String(draft.id))}/validate`, {
      mode: "validate"
    });
    expect(validation).toMatchObject({
      valid: true,
      checks: expect.arrayContaining([
        { name: "schema_version", status: "pass", message: expect.any(String) },
        { name: "tenant_boundary_fail_closed", status: "pass", message: expect.any(String) }
      ])
    });

    const published = await postWithIdempotency<JsonObject>(
      `/v1/policies/${encodeURIComponent(String(draft.id))}/publish`,
      "idem-policy-publish",
      {
        changeTicket: "CHG-1234",
        approverId: "user:policy-approver"
      }
    );
    expect(published).toMatchObject({
      id: draft.id,
      status: "published",
      publishedAt: "2026-05-21T17:05:00.000Z"
    });

    const duplicatePublish = await fetch(`${baseUrl}/v1/policies/${encodeURIComponent(String(draft.id))}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "idem-policy-publish-again" },
      body: JSON.stringify({
        changeTicket: "CHG-1234",
        approverId: "user:policy-approver"
      })
    });
    expect(duplicatePublish.status).toBe(409);
    await expect(duplicatePublish.json()).resolves.toMatchObject({ code: "POLICY_NOT_VALIDATED" });

    const rolledBack = await postWithIdempotency<JsonObject>(
      `/v1/policies/${encodeURIComponent(String(draft.id))}/rollback`,
      "idem-policy-rollback",
      {
        targetVersion: "policy:previous",
        changeTicket: "CHG-1235",
        approverId: "user:policy-approver"
      }
    );
    expect(rolledBack).toMatchObject({
      id: draft.id,
      version: "policy:previous",
      status: "rolled_back"
    });
    expect(rolledBack.publishedAt).toBe(published.publishedAt);

    await post<JsonObject>(`/v1/policies/${encodeURIComponent(String(draft.id))}/validate`, {
      mode: "validate"
    });
    const republished = await postWithIdempotency<JsonObject>(
      `/v1/policies/${encodeURIComponent(String(draft.id))}/publish`,
      "idem-policy-republish",
      {
        changeTicket: "CHG-1236",
        approverId: "user:policy-approver"
      }
    );
    expect(republished).toMatchObject({
      id: draft.id,
      status: "published",
      publishedAt: "2026-05-21T17:10:00.000Z"
    });

    const secondDraft = await postWithIdempotency<JsonObject>("/v1/policies", "idem-policy-create-second", {
      name: "case escalation",
      model: createDefaultPolicyModel(),
      tests: [{ name: "escalation proof points" }]
    });
    const unvalidatedPublish = await fetch(`${baseUrl}/v1/policies/${encodeURIComponent(String(secondDraft.id))}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "idem-policy-publish-unvalidated" },
      body: JSON.stringify({
        changeTicket: "CHG-2233",
        approverId: "user:policy-approver"
      })
    });
    expect(unvalidatedPublish.status).toBe(409);
    await expect(unvalidatedPublish.json()).resolves.toMatchObject({ code: "POLICY_NOT_VALIDATED" });

    await post<JsonObject>(`/v1/policies/${encodeURIComponent(String(secondDraft.id))}/validate`, {
      mode: "validate"
    });
    const secondPublished = await postWithIdempotency<JsonObject>(
      `/v1/policies/${encodeURIComponent(String(secondDraft.id))}/publish`,
      "idem-policy-publish",
      {
        changeTicket: "CHG-2234",
        approverId: "user:policy-approver"
      }
    );
    expect(secondPublished.id).toBe(secondDraft.id);

    const secondRolledBack = await postWithIdempotency<JsonObject>(
      `/v1/policies/${encodeURIComponent(String(secondDraft.id))}/rollback`,
      "idem-policy-rollback",
      {
        targetVersion: "policy:second-previous",
        changeTicket: "CHG-2235",
        approverId: "user:policy-approver"
      }
    );
    expect(secondRolledBack).toMatchObject({
      id: secondDraft.id,
      version: "policy:second-previous",
      status: "rolled_back"
    });

    const missingPolicy = await fetch(`${baseUrl}/v1/policies/${encodeURIComponent("policy:missing")}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "idem-policy-missing" },
      body: JSON.stringify({
        changeTicket: "CHG-3234",
        approverId: "user:policy-approver"
      })
    });
    expect(missingPolicy.status).toBe(404);
    await expect(missingPolicy.json()).resolves.toMatchObject({ code: "POLICY_NOT_FOUND" });

    const missingValidation = await fetch(`${baseUrl}/v1/policies/${encodeURIComponent("policy:missing")}/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "validate" })
    });
    expect(missingValidation.status).toBe(404);
    await expect(missingValidation.json()).resolves.toMatchObject({ code: "POLICY_NOT_FOUND" });
  });

  it("demotes validated policies when publish-time revalidation fails", () => {
    const app = createRebacLocalApp({ now: () => TEST_NOW });
    const model = createDefaultPolicyModel();
    const policy = createPolicy(app, {
      name: "mutable case access",
      model,
      tests: [{ name: "default proof points" }]
    }, "idem-policy-create-mutable");

    expect(validatePolicy(app, policy.id).valid).toBe(true);
    expect(listPolicies(app).items.find((item) => item.id === policy.id)).toMatchObject({ status: "validated" });

    model.actions.push({ name: "delete", grants: ["not_a_relation"] });

    let error: unknown;
    try {
      publishPolicy(app, policy.id, {
        changeTicket: "CHG-VALIDATION-FAIL",
        approverId: "user:policy-approver"
      }, "idem-policy-publish-invalid");
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({ code: "POLICY_VALIDATION_FAILED", statusCode: 422 });
    expect(listPolicies(app).items.find((item) => item.id === policy.id)).toMatchObject({ status: "draft" });
  });

  it("serves readiness without auth and reports runtime guardrails", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "access-kit-readiness-"));
    tempDirs.push(storageRoot);
    const stateRepository = new LocalJsonFileStateRepository({ rootDir: join(storageRoot, "state") });
    const graphRepository = new LocalJsonFileGraphRepository({ rootDir: join(storageRoot, "state") });
    const jobRepository = new LocalJsonFileJobRepository({ rootDir: join(storageRoot, "state") });
    const evidenceRepository = new LocalFileEvidenceRepository({ rootDir: join(storageRoot, "evidence") });
    await restartServer({
      now: () => TEST_NOW,
      apiKeys: ["readiness-token"],
      graphRepository,
      jobRepository,
      stateRepository,
      auditRepository: evidenceRepository,
      evidenceRepository,
      adminAuthorization: productionAdminAuthorizationDescriptor()
    });

    const response = await fetch(`${baseUrl}/v1/ready`);
    const body = (await response.json()) as {
      status: string;
      checkedAt: string;
      checks: Array<{ name: string; status: string; evidence?: JsonObject }>;
    };
    const checksByName = new Map(body.checks.map((check) => [check.name, check]));

    expect(response.status).toBe(200);
    expect(body.status).toBe("ready");
    expect(body.checkedAt).toBe(TEST_NOW);
    expect(checksByName.get("api_authentication")).toMatchObject({
      status: "pass",
      evidence: { configured: true }
    });
    expect(checksByName.get("api_authentication")?.evidence).not.toHaveProperty("tokenMaterialLogged");
    expect(checksByName.get("admin_authorization")).toMatchObject({
      status: "pass",
      evidence: {
        configured: true,
        authenticationMode: "idp_gateway",
        descriptorVersion: "admin-authorization:v1"
      }
    });
    expect(checksByName.get("admin_authorization")?.evidence).not.toHaveProperty("issuer");
    expect(checksByName.get("admin_authorization")?.evidence).not.toHaveProperty("trustedIdentityHeaders");
    expect(checksByName.get("graph_repository")).toMatchObject({ status: "pass", evidence: { configured: true } });
    expect(checksByName.get("job_repository")).toMatchObject({ status: "pass", evidence: { configured: true } });
    expect(checksByName.get("state_repository")).toMatchObject({ status: "pass", evidence: { configured: true } });
    expect(checksByName.get("audit_repository")).toMatchObject({ status: "pass", evidence: { configured: true } });
    expect(checksByName.get("evidence_repository")).toMatchObject({ status: "pass", evidence: { configured: true } });
    expect(checksByName.get("persistence_degradation")).toMatchObject({
      status: "pass",
      evidence: { degradedWrites: 0 }
    });
    expect(checksByName.get("connectors")).toMatchObject({ status: "pass", evidence: { configured: true } });
    expect(checksByName.get("connectors")?.evidence).not.toHaveProperty("connectorIds");
  });

  it("reports local bearer-token admin authorization as a pre-production readiness warning", async () => {
    await restartServer({
      now: () => TEST_NOW,
      apiKeys: ["readiness-token"]
    });

    const response = await fetch(`${baseUrl}/v1/ready`);
    const body = (await response.json()) as {
      status: string;
      checks: Array<{ name: string; status: string; evidence?: JsonObject }>;
    };
    const adminAuthorization = body.checks.find((check) => check.name === "admin_authorization");

    expect(response.status).toBe(200);
    expect(body.status).toBe("ready_with_warnings");
    expect(adminAuthorization).toMatchObject({
      status: "warn",
      evidence: {
        configured: false,
        authenticationMode: "local_bearer_token"
      }
    });
    expect(adminAuthorization?.evidence).not.toHaveProperty("tokenMaterial");
  });

  it("returns not ready when no connector adapters are registered", async () => {
    const app = createRebacLocalApp({ now: () => TEST_NOW });
    app.connectors.clear();
    await restartServer({ app, apiKeys: ["readiness-token"] });

    const response = await fetch(`${baseUrl}/v1/ready`);
    const body = (await response.json()) as {
      status: string;
      checks: Array<{ name: string; status: string; evidence?: JsonObject }>;
    };
    const checksByName = new Map(body.checks.map((check) => [check.name, check]));

    expect(response.status).toBe(503);
    expect(body.status).toBe("not_ready");
    expect(checksByName.get("connectors")).toMatchObject({
      status: "fail",
      evidence: { configured: false }
    });
    expect(checksByName.get("connectors")?.evidence).not.toHaveProperty("connectorIds");
  });

  it("can require bearer-token authentication while leaving health public", async () => {
    await restartServer({
      now: sequenceNow("2026-05-21T17:00:00.000Z", "2026-05-21T17:00:01.000Z", "2026-05-21T17:00:02.000Z"),
      apiKeys: ["token-one", "token-two"]
    });

    const health = await fetch(`${baseUrl}/v1/health`);
    const ready = await fetch(`${baseUrl}/v1/ready`);
    const missing = await fetch(`${baseUrl}/v1/subjects`);
    const wrong = await fetch(`${baseUrl}/v1/subjects`, {
      headers: { authorization: "Bearer wrong-token" }
    });
    const subjects = await fetch(`${baseUrl}/v1/subjects`, {
      headers: { authorization: "Bearer token-two" }
    });
    const audit = await fetch(`${baseUrl}/v1/audit/events`, {
      headers: { authorization: "Bearer token-one" }
    });
    const auditBody = (await audit.json()) as { items: Array<{ eventType: string; actor: string; payload: JsonObject }> };
    const authFailures = auditBody.items.filter((event) => event.eventType === "api.authentication_failed");

    expect(health.status).toBe(200);
    expect(ready.status).toBe(200);
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toBe('Bearer realm="rebac-control-plane"');
    await expect(missing.json()).resolves.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get("www-authenticate")).toBe('Bearer realm="rebac-control-plane", error="invalid_token"');
    await expect(subjects.json()).resolves.toMatchObject({ items: expect.any(Array) });
    expect(subjects.status).toBe(200);
    expect(authFailures).toHaveLength(2);
    expect(authFailures.map((event) => event.payload.reason)).toEqual([
      "missing_bearer_token",
      "invalid_bearer_token"
    ]);
    expect(authFailures.every((event) => event.payload.sampled === true)).toBe(true);
    expect(auditBody.items.filter((event) => event.actor === "anonymous")).toHaveLength(2);
    expect(auditBody.items.every((event) => !JSON.stringify(event.payload).includes("wrong-token"))).toBe(true);
  });

  it("rate-limits authentication-failure audit samples without forcing state snapshots", async () => {
    const { repository, snapshots } = createRecordingStateRepository();
    await restartServer({
      now: sequenceNow(
        "2026-05-21T17:00:00.000Z",
        "2026-05-21T17:00:30.000Z",
        "2026-05-21T17:01:01.000Z"
      ),
      apiKeys: ["token-one"],
      stateRepository: repository
    });

    const first = await fetch(`${baseUrl}/v1/subjects`, {
      headers: { authorization: "Bearer wrong-token" }
    });
    const second = await fetch(`${baseUrl}/v1/resources`, {
      headers: { authorization: "Bearer another-wrong-token" }
    });
    const nextWindow = await fetch(`${baseUrl}/v1/subjects`, {
      headers: { authorization: "Bearer still-wrong-token" }
    });
    const audit = await fetch(`${baseUrl}/v1/audit/events`, {
      headers: { authorization: "Bearer token-one" }
    });
    const auditBody = (await audit.json()) as {
      items: Array<{ eventType: string; occurredAt: string; correlationId: string; payload: JsonObject }>;
    };
    const authFailures = auditBody.items.filter((event) => event.eventType === "api.authentication_failed");

    expect(first.status).toBe(401);
    expect(second.status).toBe(401);
    expect(nextWindow.status).toBe(401);
    expect(snapshots).toHaveLength(0);
    expect(authFailures).toHaveLength(2);
    expect(authFailures.map((event) => event.occurredAt)).toEqual([
      "2026-05-21T17:00:00.000Z",
      "2026-05-21T17:01:01.000Z"
    ]);
    expect(new Set(authFailures.map((event) => event.correlationId)).size).toBe(2);
    expect(authFailures[0]?.payload).toMatchObject({
      reason: "invalid_bearer_token",
      sampled: true,
      sampleWindowMs: 60000,
      suppressedSinceLastSample: 0,
      tokenLogged: false
    });
    expect(authFailures[1]?.payload).toMatchObject({
      reason: "invalid_bearer_token",
      sampled: true,
      sampleWindowMs: 60000,
      suppressedSinceLastSample: 1,
      tokenLogged: false
    });
  });

  it("uses distinct authentication-failure correlation IDs across server restarts", async () => {
    await restartServer({
      now: () => TEST_NOW,
      apiKeys: ["token-one"]
    });

    await fetch(`${baseUrl}/v1/subjects`, {
      headers: { authorization: "Bearer wrong-token" }
    });
    const firstAudit = await fetch(`${baseUrl}/v1/audit/events`, {
      headers: { authorization: "Bearer token-one" }
    });
    const firstAuditBody = (await firstAudit.json()) as {
      items: Array<{ eventType: string; correlationId: string }>;
    };
    const firstCorrelationId = firstAuditBody.items.find((event) => event.eventType === "api.authentication_failed")
      ?.correlationId;

    await restartServer({
      now: () => TEST_NOW,
      apiKeys: ["token-one"]
    });

    await fetch(`${baseUrl}/v1/subjects`, {
      headers: { authorization: "Bearer wrong-token" }
    });
    const secondAudit = await fetch(`${baseUrl}/v1/audit/events`, {
      headers: { authorization: "Bearer token-one" }
    });
    const secondAuditBody = (await secondAudit.json()) as {
      items: Array<{ eventType: string; correlationId: string }>;
    };
    const secondCorrelationId = secondAuditBody.items.find((event) => event.eventType === "api.authentication_failed")
      ?.correlationId;

    expect(firstCorrelationId).toEqual(expect.stringContaining("corr:auth:invalid:"));
    expect(secondCorrelationId).toEqual(expect.stringContaining("corr:auth:invalid:"));
    expect(secondCorrelationId).not.toBe(firstCorrelationId);
  });

  it("rejects oversized API keys passed directly to the API server", () => {
    expect(() => createRebacApiServer({ apiKeys: ["x".repeat(4097)] })).toThrow(
      "API keys must be 4096 bytes or less."
    );
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
    for (const body of [
      {},
      { requests: null },
      { requests: [{ subjectId: "user:alice", action: "read", resourceId: "document:case-plan", unexpected: true }] }
    ]) {
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

  it("honors explicit decision provenance across decision routes", async () => {
    const check = await post<{
      policyVersion: string;
      modelVersion: string;
      relationshipVersion: string;
      tupleVersion: string;
      contextVersion: string;
      asOf: string;
    }>("/v1/decision/check", {
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan",
      policyVersion: "policy:pinned-check",
      modelVersion: "model:pinned-check",
      relationshipVersion: "tuple-set:pinned-check",
      tupleVersion: "tuple:v1",
      contextVersion: "context:pinned-check",
      asOf: "2026-05-21T17:00:00.000Z"
    });
    const explain = await post<{
      policyVersion: string;
      modelVersion: string;
      relationshipVersion: string;
      tupleVersion: string;
      contextVersion: string;
      asOf: string;
    }>("/v1/decision/explain", {
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan",
      policyVersion: "policy:pinned-explain",
      modelVersion: "model:pinned-explain",
      relationshipVersion: "tuple-set:pinned-explain",
      tupleVersion: "tuple:v1",
      contextVersion: "context:pinned-explain",
      asOf: "2026-05-21T17:00:00.000Z"
    });
    const batch = await post<{
      results: Array<{
        policyVersion: string;
        modelVersion: string;
        relationshipVersion: string;
        tupleVersion: string;
        contextVersion: string;
        asOf: string;
      }>;
    }>("/v1/decision/batch-check", {
      requests: [
        {
          subjectId: "user:alice",
          action: "read",
          resourceId: "document:case-plan",
          policyVersion: "policy:pinned-batch",
          modelVersion: "model:pinned-batch",
          relationshipVersion: "tuple-set:pinned-batch",
          tupleVersion: "tuple:v1",
          contextVersion: "context:pinned-batch",
          asOf: "2026-05-21T17:00:00.000Z"
        }
      ]
    });
    const audit = await get<{
      items: Array<{
        eventType: string;
        policyVersion?: string;
        relationshipVersion?: string;
        payload?: Record<string, unknown>;
      }>;
    }>("/v1/audit/events");

    expect(check).toMatchObject({
      policyVersion: "policy:pinned-check",
      modelVersion: "model:pinned-check",
      relationshipVersion: "tuple-set:pinned-check",
      tupleVersion: "tuple:v1",
      contextVersion: "context:pinned-check",
      asOf: "2026-05-21T17:00:00.000Z"
    });
    expect(explain).toMatchObject({
      policyVersion: "policy:pinned-explain",
      modelVersion: "model:pinned-explain",
      relationshipVersion: "tuple-set:pinned-explain",
      tupleVersion: "tuple:v1",
      contextVersion: "context:pinned-explain",
      asOf: "2026-05-21T17:00:00.000Z"
    });
    expect(batch.results[0]).toMatchObject({
      policyVersion: "policy:pinned-batch",
      modelVersion: "model:pinned-batch",
      relationshipVersion: "tuple-set:pinned-batch",
      tupleVersion: "tuple:v1",
      contextVersion: "context:pinned-batch",
      asOf: "2026-05-21T17:00:00.000Z"
    });
    expect(audit.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventType: "decision.allowed",
        policyVersion: "policy:pinned-check",
        relationshipVersion: "tuple-set:pinned-check",
        payload: expect.objectContaining({
          modelVersion: "model:pinned-check",
          tupleVersion: "tuple:v1",
          contextVersion: "context:pinned-check",
          asOf: "2026-05-21T17:00:00.000Z"
        })
      }),
      expect.objectContaining({
        eventType: "decision.allowed",
        policyVersion: "policy:pinned-explain",
        relationshipVersion: "tuple-set:pinned-explain",
        payload: expect.objectContaining({
          modelVersion: "model:pinned-explain",
          tupleVersion: "tuple:v1",
          contextVersion: "context:pinned-explain",
          asOf: "2026-05-21T17:00:00.000Z"
        })
      }),
      expect.objectContaining({
        eventType: "decision.allowed",
        policyVersion: "policy:pinned-batch",
        relationshipVersion: "tuple-set:pinned-batch",
        payload: expect.objectContaining({
          modelVersion: "model:pinned-batch",
          tupleVersion: "tuple:v1",
          contextVersion: "context:pinned-batch",
          asOf: "2026-05-21T17:00:00.000Z"
        })
      })
    ]));
  });

  it("uses current evaluation time for enforcement checks while preserving historical explain", async () => {
    const seed = createLocalEngineSeed();
    const historicalCreatedAt = "2026-05-21T00:00:00.000Z";
    const app = createRebacLocalApp({
      now: () => TEST_NOW,
      seed: {
        ...seed,
        subjects: seed.subjects?.map((subject) => ({ ...subject, createdAt: historicalCreatedAt })),
        resources: seed.resources?.map((resource) => ({ ...resource, createdAt: historicalCreatedAt })),
        relationships: [
          tuple(
            "relationship:alice-reader-document-expiring",
            "user:alice",
            "reader_of",
            "document:case-plan",
            {
              assertedAt: historicalCreatedAt,
              createdAt: historicalCreatedAt,
              expiresAt: "2026-05-21T12:00:00.000Z"
            }
          )
        ]
      }
    });
    await restartServer({ app });
    const request = {
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan",
      asOf: "2026-05-21T11:59:00.000Z"
    };

    const check = await post<JsonObject & Pick<DecisionResult, "asOf" | "reasonCode">>("/v1/decision/check", request);
    const explain = await post<JsonObject & Pick<DecisionResult, "asOf" | "reasonCode">>("/v1/decision/explain", request);

    expect(check.reasonCode).toBe("DENY_DEFAULT_NO_RELATIONSHIP_PATH");
    expect(check.asOf).toBe(TEST_NOW);
    expect(explain.reasonCode).toBe("ALLOW_VIA_RELATIONSHIP_PATH");
    expect(explain.asOf).toBe("2026-05-21T11:59:00.000Z");
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

  it("rejects schema-invalid decision and relationship payloads before runtime mutation", async () => {
    const decisionResponse = await fetch(`${baseUrl}/v1/decision/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subjectId: "user:alice",
        action: "read",
        resourceId: "document:case-plan",
        unexpected: true
      })
    });
    const relationshipResponse = await fetch(`${baseUrl}/v1/relationships`, {
      method: "PUT",
      headers: { "content-type": "application/json", "idempotency-key": "idem-invalid-relationship" },
      body: JSON.stringify({
        id: "relationship:bad-status",
        subjectId: "user:alice",
        relation: "reader_of",
        objectId: "document:case-plan",
        sourceSystem: "mock",
        assertedAt: "2026-05-21T17:00:00.000Z",
        status: "unknown",
        version: "tuple:v1",
        createdAt: "2026-05-21T17:00:00.000Z"
      })
    });
    const dateOnlyRelationshipResponse = await fetch(`${baseUrl}/v1/relationships`, {
      method: "PUT",
      headers: { "content-type": "application/json", "idempotency-key": "idem-invalid-relationship-date" },
      body: JSON.stringify({
        id: "relationship:bad-date",
        subjectId: "user:alice",
        relation: "reader_of",
        objectId: "document:case-plan",
        sourceSystem: "mock",
        assertedAt: "2026-05-21",
        status: "active",
        version: "tuple:v1",
        createdAt: "2026-05-21T17:00:00.000Z"
      })
    });
    const relationships = await get<{ items: Array<{ id: string }> }>("/v1/relationships");

    await expect(decisionResponse.json()).resolves.toMatchObject({ code: "INVALID_DECISION_REQUEST" });
    await expect(relationshipResponse.json()).resolves.toMatchObject({ code: "INVALID_RELATIONSHIP" });
    await expect(dateOnlyRelationshipResponse.json()).resolves.toMatchObject({ code: "INVALID_RELATIONSHIP" });
    expect(decisionResponse.status).toBe(400);
    expect(relationshipResponse.status).toBe(400);
    expect(dateOnlyRelationshipResponse.status).toBe(400);
    expect(relationships.items.map((relationship) => relationship.id)).not.toContain("relationship:bad-status");
    expect(relationships.items.map((relationship) => relationship.id)).not.toContain("relationship:bad-date");
  });

  it("rejects schema-invalid policy, provisioning, readiness, sync, and reconciliation payloads", async () => {
    const requests: Array<{ path: string; idempotencyKey?: string; body: unknown; expectedCode: string }> = [
      {
        path: "/v1/policies",
        idempotencyKey: "idem-invalid-policy-draft",
        body: { name: "bad", model: createDefaultPolicyModel(), tests: [], unexpected: true },
        expectedCode: "INVALID_POLICY_DRAFT"
      },
      {
        path: "/v1/policies/policy:model/publish",
        idempotencyKey: "idem-invalid-policy-publish",
        body: { changeTicket: "CHG-1", approverId: "user:approver", extra: true },
        expectedCode: "INVALID_POLICY_PUBLISH_REQUEST"
      },
      {
        path: "/v1/policies/policy:model/rollback",
        idempotencyKey: "idem-invalid-policy-rollback",
        body: { targetVersion: "policy:old", changeTicket: "CHG-2", approverId: "user:approver", extra: true },
        expectedCode: "INVALID_POLICY_ROLLBACK_REQUEST"
      },
      {
        path: "/v1/provisioning/plans",
        idempotencyKey: "idem-invalid-plan-schema",
        body: { subjectId: "user:alice", action: "read", resourceId: "document:case-plan", dryRun: true, extra: true },
        expectedCode: "INVALID_PROVISIONING_REQUEST"
      },
      {
        path: "/v1/provisioning/jobs",
        idempotencyKey: "idem-invalid-job-schema",
        body: { planId: "plan:one", approverId: "user:operator", unexpected: true },
        expectedCode: "INVALID_PROVISIONING_JOB_REQUEST"
      },
      {
        path: "/v1/connectors/mock/enforcement-readiness",
        body: { control: { syntheticOnly: true, liveProviderWrites: false, incidentMode: false, breakGlass: false }, extra: true },
        expectedCode: "INVALID_ENFORCEMENT_READINESS_REQUEST"
      },
      {
        path: "/v1/connectors/mock/sync",
        body: { mode: "enforcement" },
        expectedCode: "UNSUPPORTED_CONNECTOR_MODE"
      },
      {
        path: "/v1/reconciliation/run",
        body: { connectorId: "mock", dryRun: false },
        expectedCode: "INVALID_RECONCILIATION_REQUEST"
      }
    ];

    for (const request of requests) {
      const response = await fetch(`${baseUrl}${request.path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(request.idempotencyKey ? { "idempotency-key": request.idempotencyKey } : {})
        },
        body: JSON.stringify(request.body)
      });
      const body = (await response.json()) as { code: string };

      expect(response.status, request.path).toBe(400);
      expect(body.code, request.path).toBe(request.expectedCode);
    }

    await expect(get<{ items: JsonObject[] }>("/v1/policies")).resolves.toEqual({ items: [] });
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

    const evidence = await get<JsonObject>("/v1/evidence/export") as unknown as EvidenceExport;

    expect(evidence.periodStart).toBe("2026-05-20T01:00:00.000Z");
    expect(evidence.periodStart).not.toBe("2026-05-01T00:00:00.000Z");
    expect(evidence.periodEnd).toBe("2026-05-21T17:00:00.000Z");
    expect(evidence.generatedAt).toBe("2026-05-21T17:00:00.000Z");
    expect(evidence.auditIntegrity).toMatchObject({ status: "verified", eventCount: 1 });
    const { integrityManifest } = evidence;
    const sectionsByName = new Map(integrityManifest.sections.map((section) => [section.name, section]));
    expect(integrityManifest).toMatchObject({
      hashAlgorithm: "sha256",
      canonicalization: "stable-json",
      packageHash: `sha256:${sha256(canonicalEvidenceContent(evidence))}`,
      verifier: {
        documentationPath: "docs/evidence-integrity-verifier.md",
        verificationSteps: expect.arrayContaining([
          "Remove integrityManifest from the evidence package.",
          "Remove signedPackage and verifierChecks from the evidence package.",
          "Compute sha256 over the canonical package and compare it with integrityManifest.packageHash."
        ])
      }
    });
    expect(sectionsByName.get("controlMappings")).toMatchObject({
      hash: `sha256:${sha256(evidence.controlMappings)}`,
      itemCount: evidence.controlMappings.length
    });
    expect(sectionsByName.get("systemBoundary")?.hash).toBe(`sha256:${sha256(evidence.systemBoundary)}`);
    expect(sectionsByName.get("oscal")?.hash).toBe(`sha256:${sha256(evidence.oscal)}`);
    expect(sectionsByName.get("controlTraceViews")).toMatchObject({
      hash: `sha256:${sha256(evidence.controlTraceViews)}`,
      itemCount: evidence.controlTraceViews.length
    });
    expect(stableStringify(integrityManifest)).not.toMatch(/payload|token|secret/i);
    expect(evidence.controlMappings).toEqual(expect.arrayContaining([
      expect.objectContaining({ controlId: "AC-3", status: "implemented" })
    ]));
    expect(evidence.conmonMetrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "audit_events_in_period", value: 1 }),
      expect.objectContaining({ name: "audit_chain_verified", value: 1 })
    ]));
    expect(evidence.poamItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ controlId: "AC-2", status: "planned" })
    ]));
    expect(evidence.siemExport).toMatchObject({ format: "jsonl", eventCount: 1, includesPayloadHashes: true });
    expect(evidence.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "evidence-integrity-verifier",
        type: "security_evidence",
        format: "markdown"
      })
    ]));
    expect(evidence.systemBoundary).toMatchObject({ environment: "local_proof_point", liveTenantData: false });
    expect(evidence.systemBoundary.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "component:api-runtime", type: "control_plane" })
    ]));
    const connectorComponentIds = evidence.systemBoundary.components
      .filter((component) => component.type === "connector")
      .map((component) => component.id)
      .sort();
    const connectorFlowDestinations = evidence.dataFlows
      .filter((flow) => flow.id.startsWith("data-flow:api-connector:"))
      .map((flow) => flow.destination)
      .sort();
    expect(connectorComponentIds).toEqual([
      "component:connector:aws-readonly",
      "component:connector:entra-readonly",
      "component:connector:mock",
      "component:connector:sharepoint-readonly"
    ]);
    expect(connectorFlowDestinations).toEqual(connectorComponentIds);
    expect(evidence.dataFlows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "data-flow:api-engine", liveTenantData: false })
    ]));
    expect(evidence.controlStatements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        controlId: "AC-3",
        reviewerRole: "Security Control Assessor",
        sourceArtifactNames: expect.arrayContaining(["control-mapping"])
      })
    ]));
    expect(evidence.accessReviews).toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: "planned",
        subjectCount: expect.any(Number),
        resourceCount: expect.any(Number),
        ownerApprovals: [expect.objectContaining({ decision: "pending" })]
      })
    ]));
    expect(evidence.exceptionRegister).toEqual([]);
    expect(evidence.operationalEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "dependency_scan", status: "implemented" }),
      expect.objectContaining({ type: "backup_restore", status: "planned", gaps: expect.any(Array) })
    ]));
    expect(evidence.poamExport).toMatchObject({
      version: "oscal-poam-export:v1",
      sourceControlIds: evidence.controls
    });
    expect(evidence.poamExport.items.map((item) => item.id).sort()).toEqual(evidence.poamItems.map((item) => item.id).sort());
    expect(evidence.oscal).toMatchObject({
      version: "oscal-evidence-artifacts:v1",
      componentDefinition: {
        framework: "nist-800-53",
        version: "oscal-component-definition-fragment:v1"
      },
      systemSecurityPlan: {
        boundaryId: evidence.systemBoundary.boundaryId,
        deploymentScope: evidence.signedPackage.deploymentScope,
        version: "oscal-ssp-fragment:v1"
      },
      assessmentResults: {
        version: "oscal-assessment-results-fragment:v1"
      },
      planOfActionAndMilestones: {
        version: "oscal-poam-export:v1"
      }
    });
    expect(evidence.signedPackage).toMatchObject({
      packageHash: evidence.integrityManifest.packageHash,
      signatureAlgorithm: "sha256-local-proof-signature",
      deploymentScope: {
        boundaryId: evidence.systemBoundary.boundaryId,
        liveTenantData: false,
        controls: evidence.controls
      }
    });
    expect(evidence.verifierChecks.every((check) => check.status === "pass")).toBe(true);
    expect(evidence.controlTraceViews).toEqual(expect.arrayContaining([
      expect.objectContaining({
        controlId: "AC-3",
        sourceEventIds: expect.any(Array),
        reviewedStatement: expect.objectContaining({ reviewerRole: "Security Control Assessor" }),
        signatureRef: {
          packageId: evidence.signedPackage.packageId,
          keyId: evidence.signedPackage.keyId
        },
        deploymentScope: evidence.signedPackage.deploymentScope
      })
    ]));
    expect(verifyEvidenceExport(evidence)).toMatchObject({
      status: "verified",
      packageHash: evidence.integrityManifest.packageHash
    });
  });

  it("exports evidence for explicit framework, controls, and time window", async () => {
    await post("/v1/decision/check", {
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan"
    });

    const evidence = await get<{
      framework: string;
      controls: string[];
      periodStart: string;
      periodEnd: string;
      controlMappings: Array<{ controlId: string; status: string; sourceEventIds: string[]; gaps: string[] }>;
    }>("/v1/evidence/export?framework=fedramp-rev5&controls=AC-3,AU-6&from=2026-05-21T00:00:00.000Z&to=2026-05-22T00:00:00.000Z");

    expect(evidence.framework).toBe("fedramp-rev5");
    expect(evidence.controls).toEqual(["AC-3", "AU-6"]);
    expect(evidence.periodStart).toBe("2026-05-21T00:00:00.000Z");
    expect(evidence.periodEnd).toBe("2026-05-22T00:00:00.000Z");
    expect(evidence.controlMappings).toEqual(expect.arrayContaining([
      expect.objectContaining({ controlId: "AC-3", status: "implemented" }),
      expect.objectContaining({ controlId: "AU-6", status: "partially_implemented", sourceEventIds: [] })
    ]));
    expect(evidence.controlMappings.find((mapping) => mapping.controlId === "AU-6")?.gaps).toHaveLength(1);
  });

  it("validates evidence export format", async () => {
    const response = await fetch(`${baseUrl}/v1/evidence/export?format=html`);
    const body = (await response.json()) as { code: string };

    expect(response.status).toBe(400);
    expect(body.code).toBe("INVALID_EVIDENCE_FORMAT");
  });

  it("validates evidence export controls", async () => {
    const response = await fetch(`${baseUrl}/v1/evidence/export?controls=AC-3,not-a-control`);
    const body = (await response.json()) as { code: string };

    expect(response.status).toBe(400);
    expect(body.code).toBe("INVALID_EVIDENCE_CONTROLS");
  });

  it("uses stable POAM item ids across evidence control ordering", async () => {
    const first = await get<{ poamItems: Array<{ id: string; controlId: string }> }>("/v1/evidence/export?controls=AC-2,AC-6");

    await restartServer({ now: () => TEST_NOW });

    const second = await get<{ poamItems: Array<{ id: string; controlId: string }> }>("/v1/evidence/export?controls=AC-6,AC-2");

    expect(first.poamItems.find((item) => item.controlId === "AC-2")?.id).toBe("poam:ac-2");
    expect(second.poamItems.find((item) => item.controlId === "AC-2")?.id).toBe("poam:ac-2");
  });

  it("verifies signed evidence packages through the API", async () => {
    await post("/v1/decision/check", {
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan"
    });

    const evidence = await get<JsonObject>("/v1/evidence/export?controls=AC-3,AU-6") as unknown as EvidenceExport;
    const report = await post<{ status: string; packageHash: string; checks: Array<{ name: string; status: string }> }>(
      "/v1/evidence/verify",
      evidence
    );

    expect(report.status).toBe("verified");
    expect(report.packageHash).toBe(evidence.integrityManifest.packageHash);
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "package_hash", status: "pass" }),
      expect.objectContaining({ name: "signed_package_signature", status: "pass" }),
      expect.objectContaining({ name: "control_trace_views", status: "pass" })
    ]));
  });

  it("verifies audit integrity and emits verification evidence", async () => {
    await post("/v1/decision/check", {
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan"
    });

    const integrity = await get<{
      status: string;
      eventCount: number;
      auditEventId: string;
      findings: unknown[];
    }>("/v1/audit/integrity");
    const evidence = await get<{ controlMappings: Array<{ controlId: string; status: string; sourceEventIds: string[] }> }>(
      "/v1/evidence/export?controls=AU-6"
    );
    const audit = await get<{ items: Array<{ eventType: string }> }>("/v1/audit/events");

    expect(integrity).toMatchObject({
      status: "verified",
      eventCount: 1,
      findings: []
    });
    expect(integrity.auditEventId).toMatch(/^evt:/);
    expect(evidence.controlMappings).toEqual(expect.arrayContaining([
      expect.objectContaining({ controlId: "AU-6", status: "implemented", sourceEventIds: [integrity.auditEventId] })
    ]));
    expect(audit.items.map((event) => event.eventType)).toEqual(["decision.allowed", "audit.integrity_verified", "evidence.generated"]);
  });

  it("exports SIEM-ready audit JSONL records and emits export evidence", async () => {
    await post("/v1/decision/check", {
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan"
    });

    const auditExport = await get<{
      exportId: string;
      format: string;
      target: string;
      exportedEventCount: number;
      sourceEventIds: string[];
      records: string[];
      auditIntegrity: { status: string; eventCount: number };
    }>("/v1/audit/export?target=operator_download&from=2026-05-21T00:00:00.000Z&to=2026-05-22T00:00:00.000Z");
    const parsedRecord = JSON.parse(auditExport.records[0] ?? "{}") as { eventType?: string; payloadHash?: string };
    const audit = await get<{ items: Array<{ eventType: string }> }>("/v1/audit/events");

    expect(auditExport).toMatchObject({
      format: "jsonl",
      target: "operator_download",
      exportedEventCount: 1,
      auditIntegrity: { status: "verified", eventCount: 1 }
    });
    expect(auditExport.exportId).toMatch(/^audit-export:/);
    expect(auditExport.sourceEventIds).toHaveLength(1);
    expect(auditExport.records).toHaveLength(1);
    expect(parsedRecord).toMatchObject({
      eventType: "decision.allowed",
      payloadHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/)
    });
    expect(audit.items.map((event) => event.eventType)).toEqual(["decision.allowed", "audit.exported"]);
  });

  it("distinguishes bounded audit export counts from full-chain integrity counts", async () => {
    const times = [
      "2026-05-20T01:00:00.000Z",
      "2026-05-21T17:00:00.000Z",
      "2026-05-21T17:00:01.000Z",
      "2026-05-21T17:00:02.000Z"
    ];
    await restartServer({
      now: () => times.shift() ?? "2026-05-21T17:00:03.000Z"
    });
    await post("/v1/decision/check", {
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan"
    });
    await post("/v1/decision/check", {
      subjectId: "user:bob",
      action: "read",
      resourceId: "document:case-plan"
    });

    const auditExport = await get<{
      exportedEventCount: number;
      sourceEventIds: string[];
      records: string[];
      auditIntegrity: { status: string; eventCount: number };
    }>("/v1/audit/export?from=2026-05-21T00:00:00.000Z&to=2026-05-22T00:00:00.000Z");

    expect(auditExport.exportedEventCount).toBe(1);
    expect(auditExport.sourceEventIds).toHaveLength(1);
    expect(auditExport.records).toHaveLength(1);
    expect(auditExport.auditIntegrity).toMatchObject({ status: "verified", eventCount: 2 });
  });

  it("persists audit events through append-only storage and evidence packages through the file-backed repository", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "access-kit-evidence-"));
    tempDirs.push(storageRoot);
    const auditRepository = new LocalAppendOnlyAuditRepository({ rootDir: storageRoot });
    const evidenceRepository = new LocalFileEvidenceRepository({ rootDir: storageRoot });
    await restartServer({
      app: createRebacLocalApp({
        now: () => "2026-05-21T17:00:00.000Z",
        persistence: {
          auditRepository,
          evidenceRepository
        }
      })
    });

    await post("/v1/decision/check", {
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan"
    });
    const integrity = await get<{ status: string; eventCount: number }>("/v1/audit/integrity");
    const evidence = await get<{
      exportId: string;
      storageReceipt: {
        exportId: string;
        packageHash: string;
        backend: string;
        location: string;
        immutable: boolean;
      };
      integrityManifest: { packageHash: string };
    }>("/v1/evidence/export?controls=AC-3,AU-6");
    const storedEvidence = evidenceRepository.readEvidenceExport(evidence.exportId);

    expect(integrity).toMatchObject({ status: "verified", eventCount: 1 });
    expect(auditRepository.listAuditEvents().map((event) => event.eventType)).toEqual([
      "decision.allowed",
      "audit.integrity_verified",
      "evidence.generated"
    ]);
    expect(evidence.storageReceipt).toMatchObject({
      exportId: evidence.exportId,
      backend: "local_file",
      immutable: false
    });
    expect(evidence.storageReceipt.packageHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(evidence.storageReceipt.packageHash).toBe(evidence.integrityManifest.packageHash);
    expect(evidence.storageReceipt.location).toMatch(/^evidence-packages\/evidence_[a-z0-9]+\.json$/);
    expect(evidence.storageReceipt.location).not.toContain(storageRoot);
    expect(storedEvidence?.storageReceipt?.packageHash).toBe(evidence.storageReceipt.packageHash);
    expect(storedEvidence?.storageReceipt?.location).toBe(evidence.storageReceipt.location);
  });

  it("persists runtime state across API restarts with a local JSON state repository", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "access-kit-state-"));
    tempDirs.push(stateRoot);
    const repository = new LocalJsonFileStateRepository({ rootDir: stateRoot });
    await restartServer({
      now: sequenceNow(
        "2026-05-21T17:00:00.000Z",
        "2026-05-21T17:00:01.000Z",
        "2026-05-21T17:00:02.000Z",
        "2026-05-21T17:00:03.000Z"
      ),
      stateRepository: repository
    });

    await post("/v1/subjects", {
      id: "user:persistent-analyst",
      type: "user",
      displayName: "Persistent Analyst",
      sourceSystem: "synthetic",
      lifecycleState: "active",
      identifiers: { employeeId: "E-PERSIST" },
      version: "subject:v1",
      createdAt: "2026-05-21T17:00:00.000Z"
    });
    await fetch(`${baseUrl}/v1/relationships`, {
      method: "PUT",
      headers: { "content-type": "application/json", "idempotency-key": "idem-persist-relationship" },
      body: JSON.stringify({
        id: "relationship:persistent-analyst-document",
        subjectId: "user:persistent-analyst",
        relation: "reader_of",
        objectId: "document:case-plan",
        sourceSystem: "synthetic",
        assertedAt: "2026-05-21T17:00:01.000Z",
        status: "active",
        version: "tuple:v1",
        createdAt: "2026-05-21T17:00:01.000Z"
      })
    });
    await post<{ decision: string }>("/v1/decision/check", {
      subjectId: "user:persistent-analyst",
      action: "read",
      resourceId: "document:case-plan"
    });

    await restartServer({
      now: () => "2026-05-21T18:00:00.000Z",
      stateRepository: repository
    });
    const subject = await get<{ id: string }>("/v1/subjects/user%3Apersistent-analyst");
    const relationships = await get<{ items: Array<{ id: string }> }>(
      "/v1/relationships?subjectId=user%3Apersistent-analyst"
    );
    const decision = await post<{ decision: string }>("/v1/decision/check", {
      subjectId: "user:persistent-analyst",
      action: "read",
      resourceId: "document:case-plan"
    });
    const integrity = await get<{ status: string; eventCount: number }>("/v1/audit/integrity");
    const state = repository.readState();

    expect(subject.id).toBe("user:persistent-analyst");
    expect(relationships.items.map((relationship) => relationship.id)).toContain("relationship:persistent-analyst-document");
    expect(decision.decision).toBe("allow");
    expect(integrity).toMatchObject({ status: "verified", eventCount: 4 });
    expect(state?.subjects?.some((item) => item.id === "user:persistent-analyst")).toBe(true);
    expect(state?.auditEvents?.map((event) => event.eventType)).toContain("audit.integrity_verified");
  });

  it("recovers graph and runtime job records from repository persistence across API restarts", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "access-kit-runtime-repositories-"));
    tempDirs.push(storageRoot);
    const graphPath = join(storageRoot, "graph-state.json");
    const jobsPath = join(storageRoot, "job-state.json");
    const createPersistence = () => ({
      graphRepository: new LocalJsonFileGraphRepository({ graphPath, now: () => TEST_NOW }),
      jobRepository: new LocalJsonFileJobRepository({ jobsPath, now: () => TEST_NOW })
    });

    await restartServer({
      app: createRebacLocalApp({
        now: sequenceNow(
          "2026-05-21T17:00:00.000Z",
          "2026-05-21T17:00:01.000Z",
          "2026-05-21T17:00:02.000Z"
        ),
        persistence: createPersistence()
      })
    });
    await post("/v1/subjects", {
      id: "user:repository-analyst",
      type: "user",
      displayName: "Repository Analyst",
      sourceSystem: "synthetic",
      lifecycleState: "active",
      identifiers: { employeeId: "E-REPOSITORY" },
      version: "subject:v1",
      createdAt: "2026-05-21T17:00:00.000Z"
    });
    const relationshipResponse = await fetch(`${baseUrl}/v1/relationships`, {
      method: "PUT",
      headers: { "content-type": "application/json", "idempotency-key": "idem-repository-relationship" },
      body: JSON.stringify({
        id: "relationship:repository-analyst-document",
        subjectId: "user:repository-analyst",
        relation: "reader_of",
        objectId: "document:case-plan",
        sourceSystem: "synthetic",
        assertedAt: "2026-05-21T17:00:01.000Z",
        status: "active",
        version: "tuple:v1",
        createdAt: "2026-05-21T17:00:01.000Z"
      })
    });
    const firstDecision = await post<{ decisionId: string; decision: string }>("/v1/decision/check", {
      subjectId: "user:repository-analyst",
      action: "read",
      resourceId: "document:case-plan"
    });
    const persistedGraph = new LocalJsonFileGraphRepository({ graphPath }).exportGraph();
    const persistedJobs = new LocalJsonFileJobRepository({ jobsPath }).exportJobs();

    expect(relationshipResponse.status).toBe(200);
    expect(firstDecision.decision).toBe("allow");
    expect(persistedGraph.subjects.map((subject) => subject.id)).toContain("user:repository-analyst");
    expect(persistedGraph.relationships.map((relationship) => relationship.id)).toContain("relationship:repository-analyst-document");
    expect(persistedGraph).not.toHaveProperty("auditEvents");
    expect(persistedJobs.decisions.map((decision) => decision.decisionId)).toContain(firstDecision.decisionId);
    expect(persistedJobs).not.toHaveProperty("auditEvents");

    await restartServer({
      app: createRebacLocalApp({
        now: () => "2026-05-21T18:00:00.000Z",
        persistence: createPersistence()
      })
    });
    const recoveredSubject = await get<{ id: string }>("/v1/subjects/user%3Arepository-analyst");
    const recoveredRelationships = await get<{ items: Array<{ id: string }> }>(
      "/v1/relationships?subjectId=user%3Arepository-analyst"
    );
    const recoveredDecision = await post<{ decision: string }>("/v1/decision/check", {
      subjectId: "user:repository-analyst",
      action: "read",
      resourceId: "document:case-plan"
    });

    expect(recoveredSubject.id).toBe("user:repository-analyst");
    expect(recoveredRelationships.items.map((relationship) => relationship.id)).toContain("relationship:repository-analyst-document");
    expect(recoveredDecision.decision).toBe("allow");
  });

  it("uses the initial repository snapshots when seeding empty runtime repositories", () => {
    const storageRoot = mkdtempSync(join(tmpdir(), "access-kit-runtime-repository-seed-"));
    tempDirs.push(storageRoot);
    const graphRepository = new LocalJsonFileGraphRepository({ rootDir: join(storageRoot, "graph") });
    const jobRepository = new LocalJsonFileJobRepository({ rootDir: join(storageRoot, "jobs") });
    const exportGraph = graphRepository.exportGraph.bind(graphRepository);
    const exportJobs = jobRepository.exportJobs.bind(jobRepository);
    let graphExports = 0;
    let jobExports = 0;
    graphRepository.exportGraph = () => {
      graphExports += 1;
      return exportGraph();
    };
    jobRepository.exportJobs = () => {
      jobExports += 1;
      return exportJobs();
    };

    createRebacLocalApp({
      persistence: {
        graphRepository,
        jobRepository
      }
    });

    expect(graphExports).toBe(1);
    expect(jobExports).toBe(1);
  });

  it("keeps state snapshots authoritative over partial repository seed writes", () => {
    const storageRoot = mkdtempSync(join(tmpdir(), "access-kit-runtime-repository-partial-"));
    tempDirs.push(storageRoot);
    const stateRepository = new LocalJsonFileStateRepository({ rootDir: join(storageRoot, "state") });
    const graphRepository = new LocalJsonFileGraphRepository({ rootDir: join(storageRoot, "graph") });
    const jobRepository = new LocalJsonFileJobRepository({ rootDir: join(storageRoot, "jobs") });
    const stateSeed = {
      ...createRebacLocalApp().store.exportSeedData(),
      discoveryRuns: [createSeedDiscoveryRun()],
      decisions: [createSeedDecision()]
    };
    const firstSubject = stateSeed.subjects?.[0];

    stateRepository.writeState(stateSeed, TEST_NOW);
    if (firstSubject) {
      graphRepository.upsertSubject(firstSubject);
    }
    jobRepository.recordDiscoveryRun(stateSeed.discoveryRuns[0]);

    const app = createRebacLocalApp({
      persistence: {
        stateRepository,
        graphRepository,
        jobRepository
      }
    });

    expect(app.store.listResources().map((resource) => resource.id)).toEqual(
      expect.arrayContaining(stateSeed.resources?.map((resource) => resource.id) ?? [])
    );
    expect(app.store.listRelationships().map((relationship) => relationship.id)).toEqual(
      expect.arrayContaining(stateSeed.relationships?.map((relationship) => relationship.id) ?? [])
    );
    expect(app.store.listDecisions().map((decision) => decision.decisionId)).toContain("decision:seeded");
  });

  it("records startup repository seed degradations with ISO timestamps", () => {
    const storageRoot = mkdtempSync(join(tmpdir(), "access-kit-runtime-repository-startup-"));
    tempDirs.push(storageRoot);
    const app = createRebacLocalApp({
      now: sequenceNow("2026-05-21T17:00:00.000Z", "2026-05-21T17:00:01.000Z"),
      seed: {
        subjects: [
          {
            id: "user:seeded",
            type: "user",
            displayName: "Seeded User",
            sourceSystem: "synthetic",
            lifecycleState: "active",
            identifiers: { employeeId: "E-SEEDED" },
            version: "subject:v1",
            createdAt: TEST_NOW
          }
        ],
        decisions: [createSeedDecision()]
      },
      persistence: {
        graphRepository: new ThrowingSeedGraphRepository({ rootDir: join(storageRoot, "graph") }),
        jobRepository: new ThrowingSeedJobRepository({ rootDir: join(storageRoot, "jobs") })
      }
    });

    expect(app.persistenceDegradations).toEqual([
      expect.objectContaining({
        component: "graph",
        operation: "seedRuntimeRepository",
        occurredAt: "2026-05-21T17:00:00.000Z"
      }),
      expect.objectContaining({
        component: "job",
        operation: "seedRuntimeRepository",
        occurredAt: "2026-05-21T17:00:01.000Z"
      })
    ]);
  });

  it("recovers connector discovery and reconciliation records from repository persistence across API restarts", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "access-kit-connector-repositories-"));
    tempDirs.push(storageRoot);
    const graphPath = join(storageRoot, "graph-state.json");
    const jobsPath = join(storageRoot, "job-state.json");
    const createPersistence = () => ({
      graphRepository: new LocalJsonFileGraphRepository({ graphPath, now: () => TEST_NOW }),
      jobRepository: new LocalJsonFileJobRepository({ jobsPath, now: () => TEST_NOW })
    });

    await restartServer({
      app: createRebacLocalApp({
        now: sequenceNow(
          "2026-05-21T17:00:00.000Z",
          "2026-05-21T17:00:01.000Z",
          "2026-05-21T17:00:02.000Z",
          "2026-05-21T17:00:03.000Z",
          "2026-05-21T17:00:04.000Z"
        ),
        persistence: createPersistence()
      })
    });
    const sync = await post<{
      id: string;
      evidence: { readOnly: boolean; nativeAccessReadback: boolean };
    }>("/v1/connectors/mock/sync", { mode: "read_only" });
    const reconciliation = await post<{
      id: string;
      findings: Array<{ id: string; severity: string }>;
    }>("/v1/reconciliation/run", {
      connectorId: "mock",
      dryRun: true
    });
    const persistedGraph = new LocalJsonFileGraphRepository({ graphPath }).exportGraph();
    const persistedJobs = new LocalJsonFileJobRepository({ jobsPath }).exportJobs();

    expect(sync.evidence).toMatchObject({ readOnly: true, nativeAccessReadback: true });
    expect(persistedGraph.nativeGrants.map((grant) => grant.sourceConnectorId)).toContain("mock");
    expect(persistedJobs.discoveryRuns.map((run) => run.id)).toContain(sync.id);
    expect(persistedJobs.driftFindings.map((finding) => finding.id)).toContain(reconciliation.findings[0]?.id);
    expect(persistedJobs.reconciliationRuns.map((run) => run.id)).toContain(reconciliation.id);

    await restartServer({
      app: createRebacLocalApp({
        now: () => "2026-05-21T18:00:00.000Z",
        persistence: createPersistence()
      })
    });
    const recoveredRuns = await get<{
      items: Array<{ id: string; evidence: { readOnly: boolean; nativeAccessReadback: boolean } }>;
    }>("/v1/discovery/runs?connectorId=mock&status=completed_with_warnings");
    const recoveredNativeAccess = await get<{
      items: Array<{ sourceConnectorId: string; targetObjectId: string; subjectId: string }>;
    }>("/v1/resources/document%3Acase-plan/native-access?connectorId=mock");
    const recoveredFindings = await get<{ items: Array<{ id: string; severity: string }> }>(
      "/v1/reconciliation/findings?severity=high"
    );
    const recoveredEvidence = await get<{
      accessReviews: Array<{ findingCount: number; exceptionCount: number }>;
      exceptionRegister: Array<{ source: string; sourceFindingId: string }>;
    }>("/v1/evidence/export?controls=CA-7");
    const persistedGovernanceJobs = new LocalJsonFileJobRepository({ jobsPath }).exportJobs();

    expect(recoveredRuns.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: sync.id,
        evidence: expect.objectContaining({ readOnly: true, nativeAccessReadback: true })
      })
    ]));
    expect(recoveredNativeAccess.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceConnectorId: "mock",
        targetObjectId: "document:case-plan",
        subjectId: "user:alice"
      })
    ]));
    expect(recoveredFindings.items.map((finding) => finding.id)).toContain(reconciliation.findings[0]?.id);
    expect(recoveredEvidence.exceptionRegister).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "drift", sourceFindingId: expect.stringMatching(/^drift:/) })
    ]));
    expect(recoveredEvidence.accessReviews).toEqual(expect.arrayContaining([
      expect.objectContaining({ findingCount: 1, exceptionCount: 1 })
    ]));
    expect(persistedGovernanceJobs.accessReviewCampaigns.map((campaign) => campaign.id)).toContain(
      "access-review:campaign:local-governance"
    );
    expect(persistedGovernanceJobs.governanceFindings.map((finding) => finding.id)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^governance-finding:/)])
    );
    expect(persistedGovernanceJobs.exceptionRequests.map((request) => request.id)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^exception:/)])
    );
  });

  it("recovers append-only audit events when the audit file is ahead of the state snapshot", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "access-kit-dual-persistence-"));
    tempDirs.push(storageRoot);
    const auditRepository = new LocalAppendOnlyAuditRepository({ rootDir: storageRoot });
    const stateRepository = new LocalJsonFileStateRepository({ rootDir: storageRoot });
    await restartServer({
      app: createRebacLocalApp({
        now: () => "2026-05-21T17:00:00.000Z",
        persistence: {
          auditRepository,
          stateRepository
        }
      })
    });

    await post("/v1/decision/check", {
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan"
    });

    const crashRecorder = new AuditRecorder(auditRepository.listAuditEvents());
    const orphanedAuditFileEvent = crashRecorder.record(
      {
        eventType: "audit.exported",
        actor: "service:api",
        correlationId: "corr:audit-file-ahead",
        payload: { scenario: "audit-file-ahead" }
      },
      "2026-05-21T17:00:01.000Z"
    );
    auditRepository.appendAuditEvent(orphanedAuditFileEvent, orphanedAuditFileEvent.occurredAt);

    expect(auditRepository.listAuditEvents().map((event) => event.eventType)).toEqual([
      "decision.allowed",
      "audit.exported"
    ]);
    expect(stateRepository.readState()?.auditEvents?.map((event) => event.eventType)).toEqual(["decision.allowed"]);

    await restartServer({
      app: createRebacLocalApp({
        now: sequenceNow("2026-05-21T17:00:02.000Z", "2026-05-21T17:00:03.000Z"),
        persistence: {
          auditRepository,
          stateRepository
        }
      })
    });
    await post("/v1/decision/check", {
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan"
    });
    const integrity = await get<{ status: string; eventCount: number }>("/v1/audit/integrity");
    const auditEvents = await get<{ items: Array<{ eventType: string }> }>("/v1/audit/events");

    expect(integrity).toMatchObject({ status: "verified", eventCount: 3 });
    expect(auditEvents.items.map((event) => event.eventType)).toEqual([
      "decision.allowed",
      "audit.exported",
      "decision.allowed",
      "audit.integrity_verified"
    ]);
  });

  it("reports custom runtime state locations by filename", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "access-kit-state-"));
    tempDirs.push(stateRoot);
    const repository = new LocalJsonFileStateRepository({ statePath: join(stateRoot, "custom-runtime-state.json") });

    const receipt = repository.writeState({ subjects: [] }, TEST_NOW);

    expect(receipt.location).toBe("custom-runtime-state.json");
  });

  it("does not persist audit-only snapshots before primary runtime records", async () => {
    const { repository, snapshots } = createRecordingStateRepository();
    const control = controlledEnforcement() as unknown as EnforcementControl;
    const approval = controlledApproval() as unknown as ProvisioningApproval;
    const app = createRebacLocalApp({
      now: sequenceNow(
        "2026-05-21T17:00:00.000Z",
        "2026-05-21T17:00:01.000Z",
        "2026-05-21T17:00:02.000Z",
        "2026-05-21T17:00:03.000Z",
        "2026-05-21T17:00:04.000Z",
        "2026-05-21T17:00:05.000Z",
        "2026-05-21T17:00:06.000Z",
        "2026-05-21T17:00:07.000Z",
        "2026-05-21T17:00:08.000Z",
        "2026-05-21T17:00:09.000Z",
        "2026-05-21T17:00:10.000Z",
        "2026-05-21T17:00:11.000Z",
        "2026-05-21T17:00:12.000Z",
        "2026-05-21T17:00:13.000Z",
        "2026-05-21T17:00:14.000Z",
        "2026-05-21T17:00:15.000Z",
        "2026-05-21T17:00:16.000Z",
        "2026-05-21T17:00:17.000Z",
        "2026-05-21T17:00:18.000Z"
      ),
      stateRepository: repository
    });

    await syncConnector(app, "mock", "read_only");
    const readiness = await checkEnforcementReadiness(app, "mock", { mode: "enforcement", control });
    const dryRunPlan = await createProvisioningPlan(app, {
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan"
    }, "mock", { mode: "dry_run" }, "idem-snapshot-dry-run-plan");
    await createProvisioningJob(app, {
      planId: dryRunPlan.id,
      approverId: "user:approver",
      idempotencyKey: "idem-snapshot-dry-run-job",
      mode: "dry_run"
    });
    const enforcementPlan = await createProvisioningPlan(app, {
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan"
    }, "mock", { mode: "enforcement", approval, control, readinessReportId: readiness.id }, "idem-snapshot-enforcement-plan");
    await createProvisioningJob(app, {
      planId: enforcementPlan.id,
      approverId: approval.approverId,
      idempotencyKey: "idem-snapshot-enforcement-job",
      mode: "enforcement",
      approval,
      control
    });
    await runReconciliation(app, "mock");

    expectSnapshotsWithEventToIncludeCollection(snapshots, "connector.discovery_completed", "discoveryRuns");
    expectSnapshotsWithEventToIncludeCollection(snapshots, "connector.enforcement_readiness_checked", "enforcementReadinessReports");
    expectSnapshotsWithProvisioningPlanEvent(snapshots, "provisioning.planned");
    expectSnapshotsWithProvisioningPlanEvent(snapshots, "provisioning.compensation_planned");
    expectSnapshotsWithEventToIncludeCollection(snapshots, "provisioning.skipped", "provisioningJobs");
    expectSnapshotsWithEventToIncludeCollection(snapshots, "connector.permission_changed", "provisioningJobs");
    expectSnapshotsWithEventToIncludeCollection(snapshots, "provisioning.completed", "provisioningJobs");
    expectSnapshotsWithEventToIncludeCollection(snapshots, "reconciliation.completed", "reconciliationRuns");
  });

  it("reads API server runtime configuration from environment variables", () => {
    const config = readRebacApiRuntimeConfig({
      REBAC_API_HOST: "0.0.0.0",
      REBAC_API_PORT: "4080",
      REBAC_API_ACTOR: "service:runtime",
      REBAC_API_KEYS: "alpha, beta,alpha,,",
      REBAC_STATE_PATH: "/tmp/access-kit-state.json",
      REBAC_EVIDENCE_ROOT: "/tmp/access-kit-evidence"
    });

    expect(config).toMatchObject({
      host: "0.0.0.0",
      port: 4080,
      actor: "service:runtime",
      apiKeys: ["alpha", "beta"],
      statePath: "/tmp/access-kit-state.json",
      evidenceRoot: "/tmp/access-kit-evidence",
      adminAuthorization: {
        authentication: { mode: "local_bearer_token" }
      }
    });
  });

  it("reads production admin authorization runtime configuration from environment variables", () => {
    const config = readRebacApiRuntimeConfig({
      REBAC_API_HOST: "0.0.0.0",
      REBAC_API_KEYS: "alpha",
      REBAC_ADMIN_AUTH_MODE: "idp_gateway",
      REBAC_ADMIN_AUTH_PROVIDER: "enterprise-idp",
      REBAC_ADMIN_AUTH_ISSUER: "https://idp.example.test/tenant",
      REBAC_ADMIN_AUTH_SUBJECT_CLAIM: "sub",
      REBAC_ADMIN_AUTH_GROUPS_CLAIM: "groups",
      REBAC_ADMIN_MFA_REQUIRED: "true",
      REBAC_ADMIN_SESSION_TTL_MINUTES: "60",
      REBAC_ADMIN_REVOCATION_SLA_MINUTES: "15",
      REBAC_ADMIN_INGRESS_MODE: "identity_aware_gateway",
      REBAC_ADMIN_TRUSTED_IDENTITY_HEADERS: "x-access-kit-admin-subject,x-access-kit-admin-groups",
      REBAC_ADMIN_REBAC_POLICY_ID: "policy:admin-control-plane",
      REBAC_ADMIN_REBAC_SEPARATE_FROM_APP_AUTHZ: "true",
      REBAC_ADMIN_REBAC_ROLES: "access-kit.operator,access-kit.approver",
      REBAC_ADMIN_REBAC_BINDINGS: "group:access-kit-operators->access-kit.operator",
      REBAC_ADMIN_REBAC_REVOCATION_SLA_MINUTES: "15",
      REBAC_ADMIN_SECRETS_MANAGER: "external_secret_manager",
      REBAC_ADMIN_SECRET_REFS: "ref:access-kit/admin-gateway/client-secret",
      REBAC_ADMIN_SECRET_ROTATION_DAYS: "30",
      REBAC_ADMIN_NO_PLAINTEXT_ENV_SECRETS: "true",
      REBAC_ADMIN_BREAK_GLASS_APPROVAL_REQUIRED: "true",
      REBAC_ADMIN_BREAK_GLASS_APPROVER_ROLES: "Security engineer,ISSO",
      REBAC_ADMIN_TEMPORARY_ELEVATION_MAX_MINUTES: "60",
      REBAC_ADMIN_INCIDENT_NOTIFICATION_TARGETS: "siem:admin-actions,pagerduty:security",
      REBAC_ADMIN_POST_ACTION_REVIEW_REQUIRED: "true",
      REBAC_ADMIN_AUDIT_EVENT_TYPES: "admin.action,admin.post_action_review,api.authentication_failed",
      REBAC_ADMIN_EVIDENCE_EXPORT_REQUIRED: "true",
      REBAC_ADMIN_EVIDENCE_REFS: "evidence/admin-auth/idp.json,evidence/admin-auth/admin-rebac.json"
    });

    expect(config.adminAuthorization).toMatchObject({
      authentication: {
        mode: "idp_gateway",
        provider: "enterprise-idp",
        issuer: "https://idp.example.test/tenant",
        mfaRequired: true,
        sessionTtlMinutes: 60,
        revocationSlaMinutes: 15
      },
      ingress: {
        mode: "identity_aware_gateway",
        trustedIdentityHeaders: ["x-access-kit-admin-subject", "x-access-kit-admin-groups"]
      },
      adminRebac: {
        policyId: "policy:admin-control-plane",
        separateFromApplicationAuthorization: true
      },
      secrets: {
        manager: "external_secret_manager",
        secretRefs: ["ref:access-kit/admin-gateway/client-secret"],
        noPlaintextEnvironmentSecrets: true
      },
      emergency: {
        breakGlassApprovalRequired: true,
        postActionReviewRequired: true
      },
      audit: {
        evidenceExportRequired: true
      }
    });

    config.adminAuthorization.authentication.evidenceRefs.push("evidence/admin-auth/mutated.json");
    expect(config.adminAuthorization.ingress.evidenceRefs).toEqual([
      "evidence/admin-auth/idp.json",
      "evidence/admin-auth/admin-rebac.json"
    ]);
    expect(config.adminAuthorization.secrets.rotationDays).toBe(30);
  });

  it("builds service runtime persistence with append-only audit and file-backed evidence repositories", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "access-kit-runtime-persistence-"));
    tempDirs.push(storageRoot);
    const persistence = createLocalRuntimePersistence({
      statePath: join(storageRoot, "state", "runtime-state.json"),
      evidenceRoot: join(storageRoot, "evidence")
    });

    expect(persistence.auditRepository).toBeInstanceOf(LocalAppendOnlyAuditRepository);
    expect(persistence.evidenceRepository).toBeInstanceOf(LocalFileEvidenceRepository);
    expect(persistence.graphRepository).toBeInstanceOf(LocalJsonFileGraphRepository);
    expect(persistence.jobRepository).toBeInstanceOf(LocalJsonFileJobRepository);
    expect(persistence.stateRepository).toBeInstanceOf(LocalJsonFileStateRepository);

    await restartServer({
      app: createRebacLocalApp({
        now: () => TEST_NOW,
        persistence
      })
    });
    await post("/v1/decision/check", {
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan"
    });
    const readiness = await post<EnforcementReadinessReportJson>("/v1/connectors/mock/enforcement-readiness", {
      mode: "enforcement",
      control: controlledEnforcement()
    });
    await post("/v1/subjects", {
      id: "user:service-persistent",
      type: "user",
      displayName: "Service Persistent",
      sourceSystem: "synthetic",
      lifecycleState: "active",
      identifiers: { employeeId: "E-SERVICE" },
      version: "subject:v1",
      createdAt: TEST_NOW
    });

    expect(persistence.auditRepository?.listAuditEvents().map((event) => event.eventType)).toEqual([
      "decision.allowed",
      "connector.enforcement_readiness_checked",
      "subject.created"
    ]);
    expect(persistence.graphRepository?.exportGraph().subjects.map((subject) => subject.id)).toContain("user:service-persistent");
    expect(persistence.jobRepository?.exportJobs().decisions).toHaveLength(1);
    expect(persistence.jobRepository?.exportJobs().enforcementReadinessReports.map((report) => report.id)).toContain(readiness.id);
    expect(persistence.stateRepository?.readState()?.auditEvents?.map((event) => event.eventType)).toEqual([
      "decision.allowed",
      "connector.enforcement_readiness_checked",
      "subject.created"
    ]);

    await restartServer({
      app: createRebacLocalApp({
        now: () => "2026-05-21T18:00:00.000Z",
        persistence
      })
    });
    const hydratedReadiness = await get<{ items: Array<{ id: string }> }>("/v1/connectors/mock/enforcement-readiness");

    expect(hydratedReadiness.items.map((report) => report.id)).toContain(readiness.id);
    await expect(readdir(join(storageRoot, "state"))).resolves.toEqual(expect.arrayContaining([
      "graph-state.json",
      "job-state.json",
      "runtime-state.json"
    ]));
    await expect(readdir(join(storageRoot, "evidence"))).resolves.toContain("append-only-audit-events.jsonl");
    await expect(readdir(join(storageRoot, "evidence"))).resolves.not.toContain("audit-events.jsonl");
  });

  it("requires API keys when the runtime binds beyond loopback", () => {
    expect(() => readRebacApiRuntimeConfig({ REBAC_API_HOST: "0.0.0.0" })).toThrow(
      "REBAC_API_KEYS must be set when REBAC_API_HOST is not a loopback host."
    );
  });

  it("allows unauthenticated loopback runtime configuration for local development", () => {
    expect(readRebacApiRuntimeConfig({ REBAC_API_HOST: "localhost" })).toMatchObject({
      host: "localhost",
      port: 3000,
      apiKeys: []
    });
  });

  it("rejects API server runtime ports with trailing characters", () => {
    expect(() => readRebacApiRuntimeConfig({ REBAC_API_PORT: "3000abc" })).toThrow(
      "REBAC_API_PORT must be an integer between 1 and 65535."
    );
  });

  it("rejects oversized API keys at runtime configuration load", () => {
    expect(() => readRebacApiRuntimeConfig({ REBAC_API_KEYS: "x".repeat(4097) })).toThrow(
      "REBAC_API_KEYS entries must be 4096 bytes or less."
    );
  });

  it("rejects unsafe admin authorization runtime configuration material", () => {
    expect(() => readRebacApiRuntimeConfig({
      REBAC_ADMIN_AUTH_MODE: "idp_gateway",
      REBAC_ADMIN_SECRET_REFS: "Bearer live-admin-token"
    })).toThrow("contains secret material and must reference redacted external secret handles");
  });

  it("returns computed audit results when proof-point storage append fails", async () => {
    await restartServer({
      app: createRebacLocalApp({
        now: () => TEST_NOW,
        auditRepository: new ThrowingAuditRepository()
      })
    });

    const decision = await post<{ decision: string }>("/v1/decision/check", {
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan"
    });
    const integrity = await get<{ status: string; eventCount: number; auditEventId: string }>("/v1/audit/integrity");
    const audit = await get<{ items: Array<{ eventType: string }> }>("/v1/audit/events");
    const readiness = await get<{
      checks: Array<{ name: string; status: string; evidence?: JsonObject }>;
    }>("/v1/ready");
    const degradation = readiness.checks.find((check) => check.name === "persistence_degradation");

    expect(decision.decision).toBe("allow");
    expect(integrity).toMatchObject({ status: "verified", eventCount: 0 });
    expect(integrity.auditEventId).toMatch(/^evt:/);
    expect(audit.items.map((event) => event.eventType)).toEqual(["decision.allowed", "audit.integrity_verified"]);
    expect(degradation).toMatchObject({
      status: "warn",
      evidence: { degradedWrites: 2, components: ["audit"] }
    });
  });

  it("bounds retained persistence degradations for readiness checks", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "access-kit-bounded-degraded-state-"));
    tempDirs.push(stateRoot);
    const stateRepository = new LocalJsonFileStateRepository({ rootDir: stateRoot });
    const timestamps = Array.from({ length: 25 }, (_, index) => new Date(Date.parse(TEST_NOW) + index * 1000).toISOString());
    const app = createRebacLocalApp({
      now: sequenceNow(...timestamps),
      persistence: {
        auditRepository: new ThrowingAuditRepository(),
        stateRepository
      }
    });

    for (let index = 0; index < timestamps.length; index += 1) {
      checkDecision(app, {
        subjectId: "user:alice",
        action: "read",
        resourceId: "document:case-plan"
      });
    }

    expect(app.persistenceDegradations).toHaveLength(20);
    expect(app.persistenceDegradations[0]).toMatchObject({
      component: "audit",
      operation: "appendAuditEvent",
      occurredAt: "2026-05-21T17:00:05.000Z"
    });
    expect(app.persistenceDegradations.at(-1)).toMatchObject({
      component: "audit",
      operation: "appendAuditEvent",
      occurredAt: "2026-05-21T17:00:24.000Z"
    });
    const persistedDegradations = stateRepository.readState()?.persistenceDegradations ?? [];
    expect(persistedDegradations).toHaveLength(20);
    expect(persistedDegradations[0]).toMatchObject({
      component: "audit",
      operation: "appendAuditEvent",
      occurredAt: "2026-05-21T17:00:05.000Z"
    });
    expect(persistedDegradations.at(-1)).toMatchObject({
      component: "audit",
      operation: "appendAuditEvent",
      occurredAt: "2026-05-21T17:00:24.000Z"
    });
  });

  it("recovers degraded persistence receipts from runtime state after restart", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "access-kit-degraded-state-"));
    tempDirs.push(stateRoot);
    const stateRepository = new LocalJsonFileStateRepository({ rootDir: stateRoot });
    await restartServer({
      app: createRebacLocalApp({
        now: () => TEST_NOW,
        persistence: {
          auditRepository: new ThrowingAuditRepository(),
          stateRepository
        }
      })
    });

    await post<{ decision: string }>("/v1/decision/check", {
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan"
    });

    expect(stateRepository.readState()?.persistenceDegradations).toEqual([
      expect.objectContaining({
        component: "audit",
        operation: "appendAuditEvent",
        version: "persistence-degradation:v1"
      })
    ]);

    await restartServer({
      app: createRebacLocalApp({
        now: () => "2026-05-21T18:00:00.000Z",
        stateRepository
      })
    });
    const readiness = await get<{
      checks: Array<{ name: string; status: string; evidence?: JsonObject }>;
    }>("/v1/ready");
    const degradation = readiness.checks.find((check) => check.name === "persistence_degradation");

    expect(degradation).toMatchObject({
      status: "warn",
      evidence: { degradedWrites: 1, components: ["audit"] }
    });
  });

  it("returns evidence exports without exposing failed storage details", async () => {
    const { repository, snapshots } = createRecordingStateRepository();

    await restartServer({
      app: createRebacLocalApp({
        now: () => TEST_NOW,
        stateRepository: repository,
        evidenceRepository: new ThrowingEvidenceRepository()
      })
    });
    await post("/v1/decision/check", {
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan"
    });

    const evidence = await get<{ exportId: string; storageReceipt?: unknown }>("/v1/evidence/export");
    const readiness = await get<{
      checks: Array<{ name: string; status: string; evidence?: JsonObject }>;
    }>("/v1/ready");
    const degradation = readiness.checks.find((check) => check.name === "persistence_degradation");

    expect(evidence.exportId).toMatch(/^evidence:/);
    expect(evidence.storageReceipt).toBeUndefined();
    expect(degradation).toMatchObject({
      status: "warn",
      evidence: { degradedWrites: 1, components: ["evidence"] }
    });
    expect(snapshots.at(-1)?.persistenceDegradations).toEqual([
      expect.objectContaining({ component: "evidence", operation: "writeEvidenceExport" })
    ]);
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
    expect(body.code).toBe("UNSUPPORTED_CONNECTOR_MODE");
  });

  it("runs dry-run reconciliation with lifecycle defaults", async () => {
    const reconciliation = await post<{
      status: string;
      trigger: string;
      schedule: { cadence: string; scheduledAt: string; gracePeriodHours: number; overdue: boolean };
      findings: Array<{
        lifecycleState: string;
        ownerId: string;
        assigneeId: string;
        nativeGrantId: string;
        autoRepairPolicy: { liveProviderWrites: boolean; requireApproval: boolean };
      }>;
      counts: { findings: number; highOrCritical: number };
      auditEventIds: string[];
    }>(
      "/v1/reconciliation/run",
      {
        connectorId: "mock",
        dryRun: true,
        trigger: "scheduled",
        schedule: {
          cadence: "daily",
          scheduledAt: TEST_NOW
        }
      }
    );
    const evidence = await get<{
      conmonMetrics: Array<{ name: string; value: number; source: string }>;
      poamItems: Array<{ id: string; controlId: string; source: string; status: string }>;
      exceptionRegister: Array<{
        id: string;
        status: string;
        requestStatus: string;
        source: string;
        sourceFindingId: string;
        ownerApprovals: Array<{ decision: string }>;
        riskAcceptance: { status: string; residualRisk: string };
        remediation: { status: string; poamItemId: string };
      }>;
      accessReviews: Array<{
        campaignId: string;
        status: string;
        completedAt?: string;
        findingCount: number;
        exceptionCount: number;
        ownerApprovals: Array<{ decision: string }>;
        findingIds: string[];
        exceptionRequestIds: string[];
        remediationItemIds: string[];
      }>;
    }>("/v1/evidence/export?controls=CA-7");
    const [exceptionRequest] = evidence.exceptionRegister;

    expect(reconciliation.status).toBe("completed");
    expect(reconciliation.trigger).toBe("scheduled");
    expect(reconciliation.schedule).toMatchObject({
      cadence: "daily",
      scheduledAt: TEST_NOW,
      gracePeriodHours: 24,
      overdue: false
    });
    expect(reconciliation.findings).toHaveLength(1);
    expect(reconciliation.findings[0]).toMatchObject({
      lifecycleState: "open",
      ownerId: "role:security-operations",
      assigneeId: "role:security-engineer",
      nativeGrantId: "native-grant:mock:document:case-plan:user:external:read:direct",
      autoRepairPolicy: { liveProviderWrites: false, requireApproval: true }
    });
    expect(reconciliation.counts).toEqual({ findings: 1, highOrCritical: 1 });
    expect(reconciliation.auditEventIds).toHaveLength(2);
    expect(evidence.exceptionRegister).toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: "open",
        requestStatus: "requested",
        source: "drift",
        sourceFindingId: expect.stringMatching(/^drift:/),
        ownerApprovals: [expect.objectContaining({ decision: "pending" })],
        riskAcceptance: expect.objectContaining({ status: "pending", residualRisk: "high" }),
        remediation: expect.objectContaining({ status: "planned", poamItemId: expect.stringMatching(/^poam:governance:/) })
      })
    ]));
    expect(evidence.accessReviews).toEqual(expect.arrayContaining([
      expect.objectContaining({
        campaignId: "access-review:campaign:local-governance",
        status: "planned",
        findingCount: 1,
        exceptionCount: 1,
        ownerApprovals: [expect.objectContaining({ decision: "pending" })],
        findingIds: expect.arrayContaining([expect.stringMatching(/^governance-finding:/)]),
        exceptionRequestIds: expect.arrayContaining([exceptionRequest?.id]),
        remediationItemIds: expect.arrayContaining([exceptionRequest?.remediation.poamItemId])
      })
    ]));
    expect(evidence.accessReviews[0]?.completedAt).toBeUndefined();
    expect(evidence.conmonMetrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "access_review_campaigns", value: 1, source: "governance_store" }),
      expect.objectContaining({ name: "open_exception_requests", value: 1, source: "governance_store" }),
      expect.objectContaining({ name: "pending_owner_approvals", value: 2, source: "governance_store" }),
      expect.objectContaining({ name: "pending_risk_acceptances", value: 1, source: "governance_store" })
    ]));
    expect(evidence.poamItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: exceptionRequest?.remediation.poamItemId,
        controlId: "CA-7",
        source: "governance_findings",
        status: "planned"
      })
    ]));
  });

  it("sanitizes drift exception identifiers in evidence exports", async () => {
    const app = createRebacLocalApp({ now: () => TEST_NOW });
    const finding: DriftFinding = {
      id: "Drift/User.A@example.com/Case.Plan#001",
      resourceId: "Document/Case.Plan#001",
      subjectId: "User.A@example.com",
      nativeAccess: "owner",
      intendedAccess: "none",
      severity: "high",
      lifecycleState: "open",
      ownerId: "Role/Security.Ops",
      assigneeId: "User.Security@example.com",
      detectedAt: TEST_NOW,
      sourceConnectorId: "mock",
      recommendedAction: "exception",
      status: "open",
      exceptionExpiresAt: "2026-06-21T17:00:00.000Z",
      scheduledReconciliation: {
        cadence: "daily",
        scheduledAt: TEST_NOW,
        nextRunAt: "2026-05-22T17:00:00.000Z",
        gracePeriodHours: 24,
        overdue: false
      },
      hookEvidence: [],
      remediation: {},
      autoRepairPolicy: {
        enabled: false,
        allowedActions: ["review"],
        maxSeverity: "high",
        requireApproval: true,
        requireConnectorReadiness: true,
        liveProviderWrites: false
      },
      version: "drift:v1",
      createdAt: TEST_NOW
    };
    app.store.upsertDriftFinding(finding);
    await restartServer({ app });

    const evidence = await get<{
      exceptionRegister: Array<{ id: string; subjectId: string; resourceId: string; sourceFindingId?: string }>;
    }>("/v1/evidence/export?controls=CA-7");
    const [exception] = evidence.exceptionRegister;
    const evidenceIdPattern = /^[a-z0-9_:-]+$/;

    expect(exception).toMatchObject({
      id: "exception:drift_user_a_example_com_case_plan_001",
      subjectId: "user_a_example_com",
      resourceId: "document_case_plan_001",
      sourceFindingId: "drift_user_a_example_com_case_plan_001"
    });
    expect(exception?.id).toMatch(evidenceIdPattern);
    expect(exception?.subjectId).toMatch(evidenceIdPattern);
    expect(exception?.resourceId).toMatch(evidenceIdPattern);
    expect(exception?.sourceFindingId).toMatch(evidenceIdPattern);
  });

  it("keeps accepted governance findings aligned with exception expiry before the acceptance window closes", async () => {
    const app = createRebacLocalApp({ now: () => TEST_NOW });
    app.store.upsertDriftFinding({
      id: "drift:accepted-between-review-and-expiry",
      resourceId: "document:case-plan",
      subjectId: "user:alice",
      nativeAccess: "owner",
      intendedAccess: "none",
      severity: "critical",
      lifecycleState: "accepted",
      ownerId: "role:security-operations",
      assigneeId: "role:security-engineer",
      detectedAt: "2026-05-01T17:00:00.000Z",
      sourceConnectorId: "mock",
      recommendedAction: "exception",
      status: "accepted",
      scheduledReconciliation: {
        cadence: "daily",
        scheduledAt: "2026-05-01T17:00:00.000Z",
        nextRunAt: "2026-05-02T17:00:00.000Z",
        gracePeriodHours: 24,
        overdue: false
      },
      hookEvidence: [],
      remediation: {},
      autoRepairPolicy: {
        enabled: false,
        allowedActions: ["review"],
        maxSeverity: "critical",
        requireApproval: true,
        requireConnectorReadiness: true,
        liveProviderWrites: false
      },
      version: "drift:v1",
      createdAt: "2026-05-01T17:00:00.000Z"
    });
    await restartServer({ app });

    const evidence = await get<{
      exceptionRegister: Array<{
        status: string;
        requestStatus: string;
        riskAcceptance: { status: string; expiresAt: string };
      }>;
    }>("/v1/evidence/export?controls=CA-7");
    const [exception] = evidence.exceptionRegister;
    const [finding] = app.store.listGovernanceFindings();

    expect(finding).toMatchObject({
      sourceFindingId: "drift:accepted-between-review-and-expiry",
      status: "risk_accepted",
      remediation: { status: "overdue" }
    });
    expect(exception).toMatchObject({
      status: "approved",
      requestStatus: "risk_accepted",
      riskAcceptance: {
        status: "accepted",
        expiresAt: "2026-05-31T17:00:00.000Z"
      }
    });
  });

  it("expires stale exception requests and carries them into ConMon and POAM evidence", async () => {
    const app = createRebacLocalApp({ now: () => TEST_NOW });
    app.store.upsertDriftFinding({
      id: "drift:stale-exception",
      resourceId: "document:case-plan",
      subjectId: "user:alice",
      nativeAccess: "owner",
      intendedAccess: "none",
      severity: "critical",
      lifecycleState: "accepted",
      ownerId: "role:security-operations",
      assigneeId: "role:security-engineer",
      detectedAt: "2026-04-01T00:00:00.000Z",
      sourceConnectorId: "mock",
      recommendedAction: "exception",
      status: "accepted",
      scheduledReconciliation: {
        cadence: "daily",
        scheduledAt: "2026-04-01T00:00:00.000Z",
        nextRunAt: "2026-04-02T00:00:00.000Z",
        gracePeriodHours: 24,
        overdue: true
      },
      hookEvidence: [],
      remediation: {},
      autoRepairPolicy: {
        enabled: false,
        allowedActions: ["review"],
        maxSeverity: "critical",
        requireApproval: true,
        requireConnectorReadiness: true,
        liveProviderWrites: false
      },
      version: "drift:v1",
      createdAt: "2026-04-01T00:00:00.000Z"
    });
    await restartServer({ app });

    const evidence = await get<{
      conmonMetrics: Array<{ name: string; value: number }>;
      poamItems: Array<{ id: string; source: string; status: string }>;
      exceptionRegister: Array<{
        status: string;
        requestStatus: string;
        riskAcceptance: { status: string };
        remediation: { status: string; poamItemId: string };
      }>;
    }>("/v1/evidence/export?controls=CA-7");
    const [exception] = evidence.exceptionRegister;

    expect(exception).toMatchObject({
      status: "expired",
      requestStatus: "expired",
      riskAcceptance: { status: "expired" },
      remediation: { status: "overdue", poamItemId: "poam:governance:drift:stale-exception" }
    });
    expect(evidence.conmonMetrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "expired_exception_requests", value: 1 }),
      expect.objectContaining({ name: "overdue_remediation_items", value: 1 })
    ]));
    expect(evidence.poamItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "poam:governance:drift:stale-exception", source: "governance_findings", status: "open" })
    ]));
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

  it("records approved drift dry-run remediation with ticket and SIEM evidence", async () => {
    const reconciliation = await postWithIdempotency<{
      findings: Array<{ id: string }>;
    }>("/v1/reconciliation/run", "idem-drift-remediation-reconcile", {
      connectorId: "mock",
      dryRun: true
    });
    const findingId = reconciliation.findings[0]?.id;

    expect(findingId).toBe("drift:001");

    const readiness = await createReadyReadinessReport("mock", controlledEnforcement());
    const updated = await postWithIdempotency<{
      status: string;
      lifecycleState: string;
      hookEvidence: Array<{ system: string; referenceId: string; status: string }>;
      autoRepairPolicy: { enabled: boolean; liveProviderWrites: boolean; requireApproval: boolean };
      remediation: {
        approval: { approverId: string; changeTicket: string };
        dryRunRepair: { planId: string; mode: string; providerWrite: boolean; action: string };
      };
    }>(`/v1/reconciliation/findings/${encodeURIComponent(String(findingId))}/remediation`, "idem-drift-remediation-plan", {
      approval: {
        decision: "approved",
        approverId: "user:security-approver",
        changeTicket: "chg:drift-001",
        approvedAt: TEST_NOW,
        reason: "Approve dry-run revocation planning for unauthorized external access."
      },
      autoRepairPolicy: {
        enabled: false,
        allowedActions: ["revoke"],
        maxSeverity: "high",
        requireApproval: true,
        requireConnectorReadiness: true,
        liveProviderWrites: false,
        reason: "Dry-run only; no provider mutation is allowed."
      },
      readinessReportId: readiness.id,
      hookEvidence: [
        {
          system: "ticket",
          referenceId: "chg:drift-001",
          status: "linked",
          recordedAt: TEST_NOW
        },
        {
          system: "siem",
          referenceId: "siem:drift-001",
          status: "notified",
          recordedAt: TEST_NOW
        }
      ]
    });
    const filtered = await get<{ items: Array<{ id: string; lifecycleState: string }> }>(
      "/v1/reconciliation/findings?status=repairing&lifecycleState=repairing"
    );
    const audit = await get<{ items: Array<{ eventType: string }> }>("/v1/audit/events");

    expect(updated).toMatchObject({
      status: "repairing",
      lifecycleState: "repairing",
      autoRepairPolicy: { enabled: false, liveProviderWrites: false, requireApproval: true },
      remediation: {
        approval: { approverId: "user:security-approver", changeTicket: "chg:drift-001" },
        dryRunRepair: {
          mode: "dry_run",
          providerWrite: false,
          action: "revoke"
        }
      }
    });
    expect(updated.remediation.dryRunRepair.planId).toMatch(/^plan:revoke:/);
    expect(updated.hookEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ system: "ticket", referenceId: "chg:drift-001", status: "linked" }),
      expect.objectContaining({ system: "siem", referenceId: "siem:drift-001", status: "notified" })
    ]));
    expect(filtered.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "drift:001", lifecycleState: "repairing" })
    ]));
    expect(audit.items.map((event) => event.eventType)).toEqual(expect.arrayContaining([
      "drift.remediation_approved",
      "drift.repair_dry_run_planned"
    ]));
  });

  it("rejects drift remediation when connector readiness is only asserted by request policy", async () => {
    const reconciliation = await postWithIdempotency<{
      findings: Array<{ id: string }>;
    }>("/v1/reconciliation/run", "idem-drift-remediation-readiness-reconcile", {
      connectorId: "mock",
      dryRun: true
    });
    const findingId = reconciliation.findings[0]?.id;

    const response = await fetch(`${baseUrl}/v1/reconciliation/findings/${encodeURIComponent(String(findingId))}/remediation`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "idem-drift-remediation-missing-readiness" },
      body: JSON.stringify({
        approval: {
          decision: "approved",
          approverId: "user:security-approver",
          changeTicket: "chg:drift-001",
          approvedAt: TEST_NOW,
          reason: "Caller policy alone must not authorize drift remediation."
        },
        autoRepairPolicy: {
          enabled: false,
          allowedActions: ["revoke"],
          maxSeverity: "high",
          requireApproval: true,
          requireConnectorReadiness: true,
          liveProviderWrites: false,
          reason: "Dry-run only; no provider mutation is allowed."
        }
      })
    });
    const body = (await response.json()) as { code: string };

    expect(response.status).toBe(400);
    expect(body.code).toBe("ENFORCEMENT_READINESS_REQUIRED");
  });

  it("plans exception drift remediation as a review dry-run action", async () => {
    const app = createRebacLocalApp({ now: () => TEST_NOW });
    app.store.upsertDriftFinding({
      id: "drift:exception-review",
      resourceId: "resource:case-plan",
      subjectId: "user:case-owner",
      nativeAccess: "owner",
      intendedAccess: "none",
      severity: "high",
      lifecycleState: "open",
      ownerId: "role:security-operations",
      assigneeId: "role:security-engineer",
      detectedAt: TEST_NOW,
      sourceConnectorId: "mock",
      recommendedAction: "exception",
      status: "open",
      exceptionExpiresAt: "2026-06-21T17:00:00.000Z",
      scheduledReconciliation: {
        cadence: "daily",
        scheduledAt: TEST_NOW,
        nextRunAt: "2026-05-22T17:00:00.000Z",
        gracePeriodHours: 24,
        overdue: false
      },
      hookEvidence: [],
      remediation: {},
      autoRepairPolicy: {
        enabled: false,
        allowedActions: ["review"],
        maxSeverity: "high",
        requireApproval: true,
        requireConnectorReadiness: true,
        liveProviderWrites: false
      },
      version: "drift:v1",
      createdAt: TEST_NOW
    });
    await restartServer({ app });

    const readiness = await createReadyReadinessReport("mock", controlledEnforcement());
    const updated = await postWithIdempotency<{
      remediation: { dryRunRepair: { action: string; providerWrite: boolean; mode: string } };
    }>("/v1/reconciliation/findings/drift%3Aexception-review/remediation", "idem-drift-exception-review", {
      approval: {
        decision: "approved",
        approverId: "user:security-approver",
        changeTicket: "chg:drift-exception-review",
        approvedAt: TEST_NOW,
        reason: "Approve dry-run review planning for exception governance."
      },
      autoRepairPolicy: {
        enabled: false,
        allowedActions: ["review"],
        maxSeverity: "high",
        requireApproval: true,
        requireConnectorReadiness: true,
        liveProviderWrites: false,
        reason: "Dry-run review only; no provider mutation is allowed."
      },
      readinessReportId: readiness.id
    });

    expect(updated.remediation.dryRunRepair).toMatchObject({
      action: "review",
      mode: "dry_run",
      providerWrite: false
    });
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
      expect(payload.code).toBe("INVALID_RECONCILIATION_REQUEST");
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

  it("does not record a new decision when provisioning plan idempotency replays", async () => {
    const app = createRebacLocalApp({ now: () => TEST_NOW });
    const request = {
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan"
    };

    const first = await createProvisioningPlan(app, request, "mock", { mode: "dry_run" }, "idem-direct-plan");
    const decisionsAfterFirst = app.store.listDecisions();
    const replay = await createProvisioningPlan(app, request, "mock", { mode: "dry_run" }, "idem-direct-plan");

    expect(replay.id).toBe(first.id);
    expect(app.store.listDecisions()).toHaveLength(decisionsAfterFirst.length);
  });

  it("replays revocation plans by idempotency key and rejects conflicting grants", async () => {
    const requestBody = {
      grantId: "native-grant:mock:document:case-plan:user:alice:read:direct",
      connectorId: "mock",
      dryRun: true
    };
    const first = await postWithIdempotency<{
      id: string;
      connectorId: string;
      idempotencyKey: string;
      actions: Array<{ operation: string; requestedState: { nativeGrantId?: string }; compensation: { status: string } }>;
    }>("/v1/provisioning/plans", "idem-revoke-plan", requestBody);
    const replay = await postWithIdempotency<{ id: string }>("/v1/provisioning/plans", "idem-revoke-plan", requestBody);
    const conflict = await fetch(`${baseUrl}/v1/provisioning/plans`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "idem-revoke-plan" },
      body: JSON.stringify({
        ...requestBody,
        grantId: "native-grant:mock:document:case-plan:user:bob:read:direct"
      })
    });
    const body = (await conflict.json()) as { code: string };
    const audit = await get<{ items: Array<{ eventType: string }> }>("/v1/audit/events");

    expect(first).toMatchObject({
      connectorId: "mock",
      idempotencyKey: "idem-revoke-plan"
    });
    expect(first.actions[0]).toMatchObject({
      operation: "revoke",
      requestedState: { nativeGrantId: "native-grant:mock:document:case-plan:user:alice:read:direct" },
      compensation: { status: "planned" }
    });
    expect(replay.id).toBe(first.id);
    expect(conflict.status).toBe(409);
    expect(body.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(audit.items.map((event) => event.eventType)).toEqual(expect.arrayContaining([
      "provisioning.requested",
      "provisioning.planned",
      "provisioning.compensation_planned"
    ]));
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

  it("generates unique readiness report ids for concurrent checks", async () => {
    const app = createRebacLocalApp({ now: () => TEST_NOW });
    const connector = app.connectors.get("mock");

    expect(connector).toBeDefined();
    if (!connector) {
      return;
    }

    let releaseProbe: (() => void) | undefined;
    const probeGate = new Promise<void>((resolve) => {
      releaseProbe = resolve;
    });
    let probeCount = 0;
    const connectorId = "mock-delayed-readiness";
    app.connectors.set(connectorId, connectorWithProvisioningDelay(connector, connectorId, async () => {
      probeCount += 1;
      await probeGate;
    }));

    const request = { mode: "enforcement" as const, control: controlledEnforcement() as unknown as EnforcementControl };
    const firstCheck = checkEnforcementReadiness(app, connectorId, request);
    const secondCheck = checkEnforcementReadiness(app, connectorId, request);

    try {
      for (let attempt = 0; attempt < 20 && probeCount < 2; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      expect(probeCount).toBe(2);
    } finally {
      releaseProbe?.();
    }

    const reports = await Promise.all([firstCheck, secondCheck]);
    const storedReports = app.store.listEnforcementReadinessReports({ connectorId });

    expect(new Set(reports.map((report) => report.id)).size).toBe(2);
    expect(storedReports).toHaveLength(2);
    expect(storedReports.map((report) => report.id)).toEqual(expect.arrayContaining(reports.map((report) => report.id)));
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
    const blockedReadiness = app.store.recordEnforcementReadinessReport({
      ...readiness,
      id: `${readiness.id}:blocked`,
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
        readinessReportId: blockedReadiness.id
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

  it("rejects idempotent enforcement plan replay for a different readiness report", async () => {
    const approval = controlledApproval();
    const control = controlledEnforcement();
    const firstReadiness = await createReadyReadinessReport("mock", control);
    const secondReadiness = await createReadyReadinessReport("mock", control);
    const requestBody = {
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan",
      connectorId: "mock",
      mode: "enforcement",
      dryRun: false,
      approval,
      control
    };

    await postWithIdempotency<{ id: string }>("/v1/provisioning/plans", "idem-phase4-readiness-replay", {
      ...requestBody,
      readinessReportId: firstReadiness.id
    });
    const response = await fetch(`${baseUrl}/v1/provisioning/plans`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "idem-phase4-readiness-replay" },
      body: JSON.stringify({
        ...requestBody,
        readinessReportId: secondReadiness.id
      })
    });
    const body = (await response.json()) as { code: string };

    expect(firstReadiness.id).not.toBe(secondReadiness.id);
    expect(response.status).toBe(409);
    expect(body.code).toBe("IDEMPOTENCY_KEY_REUSED");
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
    expect(body.code).toBe("INVALID_RECONCILIATION_REQUEST");
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

function productionAdminAuthorizationDescriptor(): AdminAuthorizationDescriptor {
  return {
    version: "admin-authorization:v1",
    authentication: {
      mode: "idp_gateway",
      provider: "enterprise-idp",
      issuer: "https://idp.example.test/tenant",
      subjectClaim: "sub",
      groupsClaim: "groups",
      mfaRequired: true,
      sessionTtlMinutes: 60,
      revocationSlaMinutes: 15,
      evidenceRefs: ["evidence/admin-auth/idp-configuration.json"]
    },
    ingress: {
      mode: "identity_aware_gateway",
      mtlsRequired: false,
      trustedIdentityHeaders: ["x-access-kit-admin-subject", "x-access-kit-admin-groups"],
      evidenceRefs: ["evidence/admin-auth/gateway-policy.json"]
    },
    adminRebac: {
      policyId: "policy:admin-control-plane",
      separateFromApplicationAuthorization: true,
      leastPrivilegeRoles: ["access-kit.operator", "access-kit.approver", "access-kit.auditor"],
      roleBindings: ["group:access-kit-operators->access-kit.operator"],
      revocationSlaMinutes: 15,
      evidenceRefs: ["evidence/admin-auth/admin-rebac-policy.json"]
    },
    secrets: {
      manager: "external_secret_manager",
      secretRefs: ["ref:access-kit/admin-gateway/client-secret"],
      rotationDays: 30,
      noPlaintextEnvironmentSecrets: true,
      evidenceRefs: ["evidence/admin-auth/secret-rotation.json"]
    },
    emergency: {
      breakGlassApprovalRequired: true,
      breakGlassApproverRoles: ["Security engineer", "ISSO"],
      temporaryElevationMaxMinutes: 60,
      incidentModeNotificationTargets: ["siem:admin-actions", "pagerduty:security"],
      postActionReviewRequired: true,
      evidenceRefs: ["runbooks/break-glass-review.md"]
    },
    audit: {
      auditEventTypes: ["admin.action", "admin.post_action_review", "api.authentication_failed"],
      evidenceExportRequired: true,
      evidenceRefs: ["runbooks/audit-evidence-export.md"]
    }
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

function connectorWithProvisioningDelay(
  connector: ConnectorAdapter,
  connectorId: string,
  beforePlan: () => Promise<void>
): ConnectorAdapter {
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
      await beforePlan();
      const plan = await connector.planProvisioningChange(request);
      return { ...plan, connectorId };
    },
    applyProvisioningChange: (plan) => connector.applyProvisioningChange(plan),
    verifyProvisioningChange: (plan) => connector.verifyProvisioningChange(plan),
    revokeAccess: (nativeGrantId) => connector.revokeAccess(nativeGrantId),
    detectDrift: () => connector.detectDrift(),
    emitEvidence: (events) => connector.emitEvidence(events)
  };
}

class ThrowingAuditRepository implements AuditEventRepository {
  appendAuditEvent(): never {
    throw new Error("disk full");
  }

  listAuditEvents(): AuditEvent[] {
    return [];
  }

  verifyIntegrity(verifiedAt: string): AuditIntegrityReport {
    return {
      status: "verified",
      eventCount: 0,
      verifiedAt,
      findings: [],
      version: "audit-integrity:v1"
    };
  }
}

class ThrowingSeedGraphRepository extends LocalJsonFileGraphRepository {
  upsertSubject(): never {
    throw new Error("graph repository locked");
  }
}

class ThrowingSeedJobRepository extends LocalJsonFileJobRepository {
  recordDecision(): never {
    throw new Error("job repository locked");
  }
}

class ThrowingEvidenceRepository implements EvidencePackageRepository {
  writeEvidenceExport(): never {
    throw new Error("read-only volume");
  }

  readEvidenceExport(): undefined {
    return undefined;
  }
}

function createRecordingStateRepository(): { repository: RebacStateRepository; snapshots: RebacSeedData[] } {
  const snapshots: RebacSeedData[] = [];
  return {
    snapshots,
    repository: {
      readState: () => undefined,
      writeState: (state, storedAt) => {
        snapshots.push(JSON.parse(JSON.stringify(state)) as RebacSeedData);
        return {
          storedAt,
          backend: "external",
          location: "memory",
          stateHash: "test",
          entityCounts: {
            subjects: state.subjects?.length ?? 0,
            resources: state.resources?.length ?? 0,
            relationships: state.relationships?.length ?? 0,
            nativeGrants: state.nativeGrants?.length ?? 0,
            discoveryRuns: state.discoveryRuns?.length ?? 0,
            enforcementReadinessReports: state.enforcementReadinessReports?.length ?? 0,
            provisioningPlans: state.provisioningPlans?.length ?? 0,
            provisioningJobs: state.provisioningJobs?.length ?? 0,
            driftFindings: state.driftFindings?.length ?? 0,
            accessReviewCampaigns: state.accessReviewCampaigns?.length ?? 0,
            governanceFindings: state.governanceFindings?.length ?? 0,
            exceptionRequests: state.exceptionRequests?.length ?? 0,
            reconciliationRuns: state.reconciliationRuns?.length ?? 0,
            decisions: state.decisions?.length ?? 0,
            auditEvents: state.auditEvents?.length ?? 0,
            persistenceDegradations: state.persistenceDegradations?.length ?? 0
          },
          version: "rebac-state-storage-receipt:v1"
        };
      }
    }
  };
}

function createSeedDecision(): DecisionResult {
  return {
    decisionId: "decision:seeded",
    decision: "allow",
    subjectId: "user:seeded",
    action: "read",
    resourceId: "document:case-plan",
    reasonCode: "ALLOW_RELATIONSHIP_PATH",
    policyVersion: "policy:seed",
    modelVersion: "model:seed",
    relationshipVersion: "relationship:seed",
    tupleVersion: "tuple:seed",
    contextVersion: "context:seed",
    asOf: TEST_NOW,
    relationshipPath: [],
    constraints: {},
    evaluatedAt: TEST_NOW
  };
}

function createSeedDiscoveryRun() {
  return {
    id: "discovery-run:seeded",
    connectorId: "mock",
    mode: "read_only" as const,
    status: "completed" as const,
    startedAt: TEST_NOW,
    completedAt: "2026-05-21T17:01:00.000Z",
    counts: {
      subjects: 1,
      resources: 1,
      relationships: 1,
      nativeGrants: 0,
      warnings: 0
    },
    warnings: [],
    evidence: {
      readOnly: true,
      schemas: ["subject", "resource", "relationship"],
      connectorCapabilities: ["discovery"],
      nativeAccessReadback: true
    },
    auditEventIds: ["evt:seeded-discovery"],
    version: "discovery-run:v1" as const,
    createdAt: TEST_NOW
  };
}

function expectSnapshotsWithEventToIncludeCollection(
  snapshots: RebacSeedData[],
  eventType: string,
  collection: "discoveryRuns" | "enforcementReadinessReports" | "provisioningJobs" | "reconciliationRuns"
): void {
  let matchingEvents = 0;

  for (const snapshot of snapshots) {
    for (const event of snapshot.auditEvents?.filter((item) => item.eventType === eventType) ?? []) {
      matchingEvents += 1;
      const recordId = primaryRecordIdForEvent(event);
      const records = (snapshot[collection] ?? []) as Array<{ id: string; auditEventIds?: string[] }>;
      const record = records.find((item) => item.id === recordId);

      expect(record).toBeDefined();
      expect(record?.auditEventIds).toContain(event.eventId);
    }
  }

  expect(matchingEvents).toBeGreaterThan(0);
}

function expectSnapshotsWithProvisioningPlanEvent(snapshots: RebacSeedData[], eventType: string): void {
  let matchingEvents = 0;

  for (const snapshot of snapshots) {
    for (const event of snapshot.auditEvents?.filter((item) => item.eventType === eventType) ?? []) {
      matchingEvents += 1;
      const planId = (event.payload as JsonObject).planId;
      expect(typeof planId).toBe("string");
      expect(snapshot.provisioningPlans?.some((plan) => plan.id === planId)).toBe(true);
    }
  }

  expect(matchingEvents).toBeGreaterThan(0);
}

function primaryRecordIdForEvent(event: AuditEvent): string {
  const payload = event.payload as JsonObject;
  let field = "jobId";

  if (event.eventType === "connector.discovery_completed") {
    field = "discoveryRunId";
  } else if (event.eventType === "connector.enforcement_readiness_checked") {
    field = "id";
  } else if (event.eventType === "reconciliation.completed") {
    field = "runId";
  } else if (event.eventType === "provisioning.completed" || event.eventType === "provisioning.failed") {
    field = "id";
  }

  const value = payload[field];

  expect(typeof value).toBe("string");
  return value as string;
}

function tuple(
  id: string,
  subjectId: string,
  relation: string,
  objectId: string,
  overrides: Partial<RelationshipTuple> = {}
): RelationshipTuple {
  return {
    id,
    subjectId,
    relation,
    objectId,
    sourceSystem: "mock",
    assertedAt: TEST_NOW,
    status: "active",
    version: "tuple:v1",
    createdAt: TEST_NOW,
    ...overrides
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
