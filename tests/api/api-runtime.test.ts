import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRebacApiServer } from "../../packages/api/src/index.js";

type JsonObject = Record<string, unknown>;

let server: Server;
let baseUrl: string;

beforeEach(async () => {
  server = createRebacApiServer({ now: () => "2026-05-21T17:00:00.000Z" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  server.close();
  await once(server, "close");
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
});

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
