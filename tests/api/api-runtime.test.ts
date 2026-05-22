import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createRebacApiServer,
  createRebacLocalApp,
  type RebacApiServerOptions
} from "../../packages/api/src/index.js";

type JsonObject = Record<string, unknown>;

let server: Server | undefined;
let baseUrl: string;

beforeEach(async () => {
  await startServer({ now: () => "2026-05-21T17:00:00.000Z" });
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

  it("runs mock connector sync and dry-run reconciliation", async () => {
    const sync = await post<{ connectorId: string; subjects: number }>("/v1/connectors/mock/sync", { mode: "read_only" });
    const reconciliation = await post<{ status: string; findings: unknown[] }>("/v1/reconciliation/run", {
      connectorId: "mock",
      dryRun: true
    });

    expect(sync.connectorId).toBe("mock");
    expect(sync.subjects).toBeGreaterThan(0);
    expect(reconciliation.status).toBe("completed");
    expect(reconciliation.findings).toHaveLength(1);
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
    expect(body.code).toBe("INVALID_CONNECTOR_MODE");
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

    const plan = await post<{ status: string; actions: unknown[] }>("/v1/provisioning/plans", {
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan"
    });

    expect(plan.status).toBe("planned");
    expect(plan.actions).toHaveLength(1);
  });

  it("validates provisioning connector IDs when provided", async () => {
    const response = await fetch(`${baseUrl}/v1/provisioning/plans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subjectId: "user:alice",
        action: "read",
        resourceId: "document:case-plan",
        connectorId: ""
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

async function post<T extends JsonObject>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "idem-test" },
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
