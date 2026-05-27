import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DecisionRequest, DecisionResult } from "../../packages/core/src/index.js";
import { createDefaultPolicyModel, createDemoSeedData } from "../../packages/core/src/index.js";
import { createRebacApiServer } from "../../packages/api/src/index.js";
import {
  createAccessKitClient,
  type AccessKitClient,
  type AccessKitRequestOptions,
  type ExpressPepResponse,
  type PolicyTestResult
} from "../../packages/typescript-client/src/index.js";
import { createSampleSaasApplication } from "../../examples/sample-saas-app/app.js";

const apiKey = "local-sample-saas-test-key";
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

describe("sample SaaS application", () => {
  it("serves a tenant case only after Access Kit allows the protected route", async () => {
    const app = createSampleSaasApplication({
      client: createAccessKitClient({ apiKey, baseUrl })
    });
    const response = createResponse();

    await app.handleCaseRead({
      headers: {
        "x-correlation-id": "corr:sample-saas-allow",
        "x-subject-id": "user:alice"
      },
      path: "/tenants/tenant%3Aalpha/cases/case-plan"
    }, response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      authorization: {
        correlationId: "corr:sample-saas-allow",
        decision: "allow",
        reasonCode: "ALLOW_VIA_RELATIONSHIP_PATH"
      },
      case: {
        caseId: "case-plan",
        resourceId: "document:case-plan",
        tenantId: "tenant:alpha"
      }
    });
    expect(response.headers["x-correlation-id"]).toBe("corr:sample-saas-allow");
    expect(stringify(response.body)).not.toContain("relationshipPath");
    expect(app.decisionEvents).toEqual([
      expect.objectContaining({
        correlationId: "corr:sample-saas-allow",
        outcome: "allow",
        reasonCode: "ALLOW_VIA_RELATIONSHIP_PATH"
      })
    ]);
  });

  it("fails closed on tenant-boundary mismatches without resolving protected content", async () => {
    let checkCalls = 0;
    const app = createSampleSaasApplication({
      client: createMockClient({
        check: async () => {
          checkCalls += 1;
          return decision({ decision: "allow" });
        }
      })
    });
    const response = createResponse();

    await app.handleCaseRead({
      headers: {
        "x-correlation-id": "corr:sample-saas-tenant-mismatch",
        "x-subject-id": "user:alice"
      },
      path: "/tenants/tenant%3Abeta/cases/case-plan"
    }, response);

    expect(checkCalls).toBe(0);
    expect(response.statusCode).toBe(404);
    expect(response.body).toEqual({
      code: "ACCESS_DENIED",
      correlationId: "corr:sample-saas-tenant-mismatch",
      reasonCode: "CASE_ROUTE_OUTSIDE_TENANT_BOUNDARY"
    });
    expect(stringify(response.body)).not.toContain("document:case-plan");
    expect(app.decisionEvents).toEqual([]);
  });

  it("fails closed when Access Kit is unavailable and does not authorize locally", async () => {
    const app = createSampleSaasApplication({
      client: createAccessKitClient({ apiKey: "wrong-local-key", baseUrl })
    });
    const response = createResponse();

    await app.handleCaseRead({
      headers: {
        "x-correlation-id": "corr:sample-saas-unavailable",
        "x-local-role": "owner",
        "x-subject-id": "user:alice"
      },
      path: "/tenants/tenant%3Aalpha/cases/case-plan"
    }, response);

    expect(response.statusCode).toBe(503);
    expect(response.body).toEqual({
      code: "ACCESS_DENIED",
      correlationId: "corr:sample-saas-unavailable",
      reasonCode: "ACCESS_KIT_UNAVAILABLE"
    });
    expect(app.decisionEvents).toEqual([
      {
        correlationId: "corr:sample-saas-unavailable",
        outcome: "error",
        reasonCode: "ACCESS_KIT_UNAVAILABLE"
      }
    ]);
  });

  it("returns 403 when Access Kit explicitly denies an in-boundary route", async () => {
    const app = createSampleSaasApplication({
      client: createMockClient({
        check: async () => decision({ decision: "deny" })
      })
    });
    const response = createResponse();

    await app.handleCaseRead({
      headers: {
        "x-correlation-id": "corr:sample-saas-deny",
        "x-subject-id": "user:unassigned"
      },
      path: "/tenants/tenant%3Aalpha/cases/case-plan"
    }, response);

    expect(response.statusCode).toBe(403);
    expect(response.body).toEqual({
      code: "ACCESS_DENIED",
      correlationId: "corr:sample-saas-deny",
      reasonCode: "DENY_DEFAULT_NO_RELATIONSHIP_PATH"
    });
    expect(app.decisionEvents).toEqual([
      expect.objectContaining({
        correlationId: "corr:sample-saas-deny",
        decision: "deny",
        outcome: "deny",
        reasonCode: "DENY_DEFAULT_NO_RELATIONSHIP_PATH"
      })
    ]);
  });

  it("keeps explain behind a diagnostic path and redacts raw relationship paths", async () => {
    const app = createSampleSaasApplication({
      client: createAccessKitClient({ apiKey, baseUrl })
    });

    const summary = await app.explainCaseAccess({
      caseId: "case-plan",
      correlationId: "corr:sample-saas-explain",
      subjectId: "user:alice",
      tenantId: "tenant:alpha"
    });

    expect(summary).toMatchObject({
      correlationId: "corr:sample-saas-explain",
      decision: "allow",
      reasonCode: "ALLOW_VIA_RELATIONSHIP_PATH",
      resourceId: "document:case-plan",
      tenantId: "tenant:alpha"
    });
    expect(summary.pathLength).toBeGreaterThan(0);
    expect(stringify(summary)).not.toContain("relationshipPath");
    expect(stringify(summary)).not.toContain("group:case-team");
    expect(stringify(summary)).not.toContain("workspace:case");
  });

  it("runs the policy-test workflow through the Access Kit client", async () => {
    const app = createSampleSaasApplication({
      client: createAccessKitClient({ apiKey, baseUrl })
    });
    const policy = await createPolicy({
      name: "sample SaaS policy-test workflow",
      model: createDefaultPolicyModel(),
      tests: [{ name: "sample SaaS proof points" }]
    });

    const report = await app.runPolicyWorkflow(policy.id, "corr:sample-saas-policy-test");

    expect(report).toMatchObject({
      correlationId: "corr:sample-saas-policy-test",
      failingCheckNames: [],
      valid: true
    });
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "proof_points", status: "pass" })
    ]));
  });

  it("does not call explain from the protected route handler", async () => {
    const calls: Array<"check" | "explain"> = [];
    const app = createSampleSaasApplication({
      client: createMockClient({
        check: async () => {
          calls.push("check");
          return decision({ decision: "allow" });
        },
        explain: async () => {
          calls.push("explain");
          throw new Error("Protected routes must not call explain.");
        }
      })
    });
    const response = createResponse();

    await app.handleCaseRead({
      headers: {
        "x-correlation-id": "corr:sample-saas-no-explain",
        "x-subject-id": "user:alice"
      },
      path: "/tenants/tenant%3Aalpha/cases/case-plan"
    }, response);

    expect(response.statusCode).toBe(200);
    expect(calls).toEqual(["check"]);
  });
});

async function createPolicy(body: unknown): Promise<{ id: string }> {
  const response = await fetch(`${baseUrl}/v1/policies`, {
    body: JSON.stringify(body),
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "idempotency-key": "idem:sample-saas-policy"
    },
    method: "POST"
  });

  expect(response.status).toBe(201);
  return (await response.json()) as { id: string };
}

function createMockClient(options: {
  readonly check?: (request: DecisionRequest, options?: AccessKitRequestOptions) => Promise<DecisionResult>;
  readonly explain?: (request: DecisionRequest, options?: AccessKitRequestOptions) => Promise<DecisionResult>;
  readonly testPolicy?: (policyId: string, options?: AccessKitRequestOptions) => Promise<PolicyTestResult>;
}): AccessKitClient {
  return {
    check: options.check ?? (async () => decision()),
    explain: options.explain ?? (async () => decision({ relationshipPathLength: 3 })),
    testPolicy: options.testPolicy ?? (async () => ({ checks: [], valid: true }))
  };
}

function decision(options: {
  readonly decision?: DecisionResult["decision"];
  readonly relationshipPathLength?: number;
} = {}): DecisionResult {
  return {
    action: "read",
    constraints: {},
    decision: options.decision ?? "allow",
    decisionId: "decision:sample-saas-test",
    evaluatedAt: "2026-05-26T14:00:00.000Z",
    policyVersion: "policy:test",
    reasonCode: options.decision === "deny" ? "DENY_DEFAULT_NO_RELATIONSHIP_PATH" : "ALLOW_VIA_RELATIONSHIP_PATH",
    relationshipPath: Array.from({ length: options.relationshipPathLength ?? 0 }, (_, index) => ({
      objectId: `object:${index}`,
      relation: "member_of",
      subjectId: `subject:${index}`
    })),
    relationshipVersion: "relationships:test",
    resourceId: "document:case-plan",
    subjectId: "user:alice"
  };
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

function stringify(value: unknown): string {
  return JSON.stringify(value);
}
