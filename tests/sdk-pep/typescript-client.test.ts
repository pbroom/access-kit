import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultPolicyModel, createDemoSeedData } from "../../packages/core/src/index.js";
import { createRebacApiServer } from "../../packages/api/src/index.js";
import {
  AccessKitClientError,
  createAccessKitClient,
  createAccessKitExpressPepMiddleware,
  type ExpressPepResponse
} from "../../packages/typescript-client/src/index.js";

const apiKey = "local-pep-test-key";
let server: Server | undefined;
let baseUrl: string;

beforeEach(async () => {
  server = createRebacApiServer({ apiKeys: [apiKey], seed: createDemoSeedData() });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
    server = undefined;
  }
});

describe("TypeScript client and Express PEP starter", () => {
  it("checks and explains allow decisions through the local API", async () => {
    const client = createAccessKitClient({ apiKey, baseUrl });
    const request = {
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan"
    };

    const check = await client.check(request, { correlationId: "corr:pep-check" });
    const explain = await client.explain(request, { correlationId: "corr:pep-explain" });

    expect(check).toMatchObject({
      decision: "allow",
      reasonCode: "ALLOW_VIA_RELATIONSHIP_PATH"
    });
    expect(check.relationshipPath).toEqual([]);
    expect(explain).toMatchObject({
      decision: "allow",
      reasonCode: "ALLOW_VIA_RELATIONSHIP_PATH"
    });
    expect(explain.relationshipPath.length).toBeGreaterThan(0);
  });

  it("denies by default without making local authorization decisions", async () => {
    const events: Array<{ outcome: string; reasonCode?: string }> = [];
    const middleware = createAccessKitExpressPepMiddleware({
      client: createAccessKitClient({ apiKey, baseUrl }),
      buildDecisionRequest: () => ({
        subjectId: "user:external-reviewer",
        action: "read",
        resourceId: "document:case-plan"
      }),
      onDecision: (event) => events.push({ outcome: event.outcome, reasonCode: event.decision?.reasonCode })
    });
    const response = createResponse();
    let nextCalled = false;

    await middleware({ headers: { "x-correlation-id": "corr:pep-deny" } }, response, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(response.statusCode).toBe(403);
    expect(response.headers["x-correlation-id"]).toBe("corr:pep-deny");
    expect(response.body).toEqual({
      code: "ACCESS_DENIED",
      correlationId: "corr:pep-deny",
      reasonCode: "DENY_DEFAULT_NO_RELATIONSHIP_PATH"
    });
    expect(events).toEqual([{ outcome: "deny", reasonCode: "DENY_DEFAULT_NO_RELATIONSHIP_PATH" }]);
  });

  it("fails closed when API authorization fails", async () => {
    const middleware = createAccessKitExpressPepMiddleware({
      client: createAccessKitClient({ apiKey: "wrong-local-key", baseUrl }),
      buildDecisionRequest: () => ({
        subjectId: "user:alice",
        action: "read",
        resourceId: "document:case-plan"
      })
    });
    const response = createResponse();
    let nextCalled = false;

    await middleware({ headers: { "x-correlation-id": "corr:pep-auth-failure" } }, response, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(response.statusCode).toBe(503);
    expect(response.body).toEqual({
      code: "ACCESS_DENIED",
      correlationId: "corr:pep-auth-failure",
      reasonCode: "ACCESS_KIT_UNAVAILABLE"
    });
  });

  it("allows protected route handlers only after an allow decision", async () => {
    const middleware = createAccessKitExpressPepMiddleware({
      client: createAccessKitClient({ apiKey, baseUrl }),
      buildDecisionRequest: () => ({
        subjectId: "user:alice",
        action: "read",
        resourceId: "document:case-plan"
      })
    });
    const response = createResponse();
    let nextCalled = false;

    await middleware({ headers: { "x-correlation-id": "corr:pep-allow" } }, response, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(response.headers["x-correlation-id"]).toBe("corr:pep-allow");
    expect(response.body).toBeUndefined();
  });

  it("runs policy-test CI examples through the local API", async () => {
    const client = createAccessKitClient({ apiKey, baseUrl });
    const draft = await createPolicy(baseUrl, {
      name: "pep starter policy",
      model: createDefaultPolicyModel(),
      tests: [{ name: "pep starter proof points" }]
    });

    const result = await client.testPolicy(draft.id, { correlationId: "corr:pep-policy-test" });

    expect(result).toMatchObject({ valid: true });
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "proof_points", status: "pass" })
    ]));
  });

  it("surfaces local API authentication failures as typed client errors", async () => {
    const client = createAccessKitClient({ apiKey: "wrong-local-key", baseUrl });

    await expect(client.check({
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan"
    })).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      correlationId: "corr:unauthenticated",
      status: 401
    });
  });

  it("rejects missing client credentials before a protected call can fall open", () => {
    expect(() => createAccessKitClient({ apiKey: "", baseUrl })).toThrow(AccessKitClientError);
    expect(() => createAccessKitClient({ apiKey: "", baseUrl })).toThrow("CLIENT_MISSING_API_KEY");
  });
});

async function createPolicy(baseUrl: string, body: unknown): Promise<{ id: string }> {
  const response = await fetch(`${baseUrl}/v1/policies`, {
    body: JSON.stringify(body),
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "idempotency-key": "idem:pep-starter-policy"
    },
    method: "POST"
  });

  expect(response.status).toBe(201);
  return (await response.json()) as { id: string };
}

function createResponse(): ExpressPepResponse & {
  body?: unknown;
  headers: Record<string, string>;
  statusCode?: number;
} {
  return {
    headers: {},
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    status(status) {
      this.statusCode = status;
      return this;
    },
    json(body) {
      this.body = body;
    }
  };
}
