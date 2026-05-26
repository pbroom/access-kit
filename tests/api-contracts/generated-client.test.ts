import { describe, expect, it } from "vitest";

import { createRebacClient } from "../../packages/api-contracts/src/index.js";

const localCredential = "local-contract-credential";
const localRequestFingerprint = ["local", "fixture", "value"].join("-");

describe("generated API client", () => {
  it("adds bearer auth, idempotency, and JSON headers for protected writes", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      calls.push({ input, init });
      return jsonResponse({ status: "accepted" });
    };

    const client = createRebacClient({
      apiKey: localCredential,
      baseUrl: "http://127.0.0.1:3000",
      fetch: fetchMock
    });

    await client.request("createProvisioningJob", {
      body: { planId: "plan:test" },
      idempotencyKey: localRequestFingerprint
    });

    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.input)).toBe("http://127.0.0.1:3000/v1/provisioning/jobs");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.headers).toMatchObject({
      authorization: `Bearer ${localCredential}`,
      "content-type": "application/json",
      "idempotency-key": localRequestFingerprint
    });
  });

  it("normalizes trailing slashes in the base URL without changing API paths", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const client = createRebacClient({
      apiKey: localCredential,
      baseUrl: "http://127.0.0.1:3000///",
      fetch: async (input, init) => {
        calls.push({ input, init });
        return jsonResponse({ decision: "allow" });
      }
    });

    await client.request("checkDecision");

    expect(String(calls[0]?.input)).toBe("http://127.0.0.1:3000/v1/decision/check");
  });

  it("fails closed before protected calls without an API key", async () => {
    const client = createRebacClient({
      baseUrl: "http://127.0.0.1:3000",
      fetch: async () => jsonResponse({ decision: "allow" })
    });

    await expect(client.request("checkDecision")).rejects.toMatchObject({
      code: "CLIENT_MISSING_API_KEY",
      status: 401
    });
  });

  it("names the missing path parameter when a routed call is incomplete", async () => {
    const client = createRebacClient({
      apiKey: localCredential,
      baseUrl: "http://127.0.0.1:3000",
      fetch: async () => jsonResponse({ status: "ok" })
    });

    await expect(client.request("getSubject")).rejects.toMatchObject({
      code: "CLIENT_MISSING_PATH_PARAM:id",
      status: 400
    });
  });

  it("allows explicitly empty path parameters without treating them as missing", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const client = createRebacClient({
      apiKey: localCredential,
      baseUrl: "http://127.0.0.1:3000",
      fetch: async (input, init) => {
        calls.push({ input, init });
        return jsonResponse({ status: "ok" });
      }
    });

    await client.request("getSubject", {
      pathParams: { id: "" }
    });

    expect(String(calls[0]?.input)).toBe("http://127.0.0.1:3000/v1/subjects/");
  });

  it("raises a typed client error for invalid base URLs", () => {
    let error: unknown;

    try {
      createRebacClient({
        apiKey: localCredential,
        baseUrl: "/local-api",
        fetch: async () => jsonResponse({ status: "ok" })
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      code: "CLIENT_INVALID_BASE_URL",
      status: 400
    });
  });

  it("preserves retry-after metadata when the API returns a rate-limit response", async () => {
    const client = createRebacClient({
      apiKey: localCredential,
      baseUrl: "http://127.0.0.1:3000",
      fetch: async () =>
        jsonResponse(
          {
            code: "RATE_LIMITED",
            correlationId: "corr:rate-limit",
            message: "Retry later."
          },
          {
            headers: { "retry-after": "30" },
            status: 429
          }
        )
    });

    await expect(client.request("checkDecision")).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryAfter: "30",
      status: 429
    });
  });
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");

  return new Response(JSON.stringify(body), {
    ...init,
    headers,
    status: init.status ?? 200
  });
}
