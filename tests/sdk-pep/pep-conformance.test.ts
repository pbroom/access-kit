import { describe, expect, it } from "vitest";
import type { DecisionRequest, DecisionResult } from "../../packages/core/src/index.js";
import {
  AccessKitClientError,
  createAccessKitExpressPepMiddleware,
  type AccessKitClient,
  type AccessKitRequestOptions,
  type ExpressPepRequest,
  type ExpressPepResponse
} from "../../packages/typescript-client/src/index.js";

const protectedRequest: DecisionRequest = {
  subjectId: "user:alice",
  action: "read",
  resourceId: "document:case-plan"
};

const sensitiveRelationshipPath = [
  {
    subjectId: "user:executive@example.test",
    relation: "member_of_sensitive_compensation_group",
    objectId: "group:board-compensation-private"
  },
  {
    subjectId: "group:board-compensation-private",
    relation: "can_read_private_folder",
    objectId: "folder:executive-compensation-plans"
  }
];

describe("PEP conformance suite", () => {
  it("fails closed when the Access Kit API fails for a protected resource", async () => {
    const { client, checkCalls } = createMockClient({
      check: async () => {
        throw new AccessKitClientError(503, "HTTP_503", "corr:api-outage");
      }
    });
    const observation = await invokeProtectedPep(client, {
      headers: {
        "x-correlation-id": "corr:pep-api-failure",
        "x-local-role": "admin"
      },
      path: "/cases/case-plan"
    });

    expect(checkCalls).toEqual([
      {
        options: { correlationId: "corr:pep-api-failure" },
        request: protectedRequest
      }
    ]);
    expect(observation.nextCalled).toBe(false);
    expect(observation.response.statusCode).toBe(503);
    expect(observation.response.headers["x-correlation-id"]).toBe("corr:pep-api-failure");
    expect(observation.response.body).toEqual({
      code: "ACCESS_DENIED",
      correlationId: "corr:pep-api-failure",
      reasonCode: "ACCESS_KIT_UNAVAILABLE"
    });
    expect(observation.events).toEqual([
      {
        correlationId: "corr:pep-api-failure",
        outcome: "error"
      }
    ]);
  });

  it("propagates correlation IDs to Access Kit and the protected response", async () => {
    const { client, checkCalls } = createMockClient({
      check: async () => createDecision({ decisionId: "decision:pep-correlation", decision: "allow" })
    });
    const observation = await invokeProtectedPep(client, {
      headers: { "x-correlation-id": "corr:caller-supplied" }
    });

    expect(observation.nextCalled).toBe(true);
    expect(observation.response.headers["x-correlation-id"]).toBe("corr:caller-supplied");
    expect(checkCalls[0]).toEqual({
      options: { correlationId: "corr:caller-supplied" },
      request: protectedRequest
    });
    expect(observation.events).toEqual([
      {
        correlationId: "corr:caller-supplied",
        decisionId: "decision:pep-correlation",
        outcome: "allow",
        reasonCode: "ALLOW_VIA_RELATIONSHIP_PATH"
      }
    ]);
  });

  it("logs decision IDs and reason codes for denied deterministic decisions", async () => {
    const { client } = createMockClient({
      check: async () =>
        createDecision({
          decision: "deny",
          decisionId: "decision:pep-deny",
          reasonCode: "DENY_POLICY_CONSTRAINT"
        })
    });
    const observation = await invokeProtectedPep(client, {
      headers: { "x-correlation-id": "corr:pep-deny" }
    });

    expect(observation.nextCalled).toBe(false);
    expect(observation.response.statusCode).toBe(403);
    expect(observation.response.body).toEqual({
      code: "ACCESS_DENIED",
      correlationId: "corr:pep-deny",
      reasonCode: "DENY_POLICY_CONSTRAINT"
    });
    expect(observation.events).toEqual([
      {
        correlationId: "corr:pep-deny",
        decisionId: "decision:pep-deny",
        outcome: "deny",
        reasonCode: "DENY_POLICY_CONSTRAINT"
      }
    ]);
  });

  it("does not substitute local authorization fallback when Access Kit denies", async () => {
    const { client, checkCalls } = createMockClient({
      check: async () =>
        createDecision({
          decision: "deny",
          decisionId: "decision:pep-no-fallback",
          reasonCode: "DENY_DEFAULT_NO_RELATIONSHIP_PATH"
        })
    });
    const observation = await invokeProtectedPep(client, {
      headers: {
        "x-correlation-id": "corr:pep-no-fallback",
        "x-local-admin": "true",
        "x-user-role": "owner"
      }
    });

    expect(checkCalls).toHaveLength(1);
    expect(observation.nextCalled).toBe(false);
    expect(observation.response.statusCode).toBe(403);
    expect(observation.response.body).toMatchObject({
      code: "ACCESS_DENIED",
      reasonCode: "DENY_DEFAULT_NO_RELATIONSHIP_PATH"
    });
  });

  it("does not call explain or expose debug details from protected route denials", async () => {
    const { client, explainCalls } = createMockClient({
      check: async () =>
        createDecision({
          decision: "deny",
          decisionId: "decision:pep-debug-safe",
          reasonCode: "DENY_TENANT_BOUNDARY",
          relationshipPath: sensitiveRelationshipPath
        }),
      explain: async () => {
        throw new Error("PEP conformance failure: protected middleware called explain");
      }
    });
    const observation = await invokeProtectedPep(client, {
      headers: {
        "x-access-kit-debug": "explain",
        "x-correlation-id": "corr:pep-debug-safe"
      }
    });

    expect(explainCalls).toEqual([]);
    expect(observation.nextCalled).toBe(false);
    expect(observation.response.statusCode).toBe(403);
    expect(stringifyBody(observation.response.body)).not.toContain("relationshipPath");
    expect(stringifyBody(observation.response.body)).not.toContain("decision:pep-debug-safe");
  });

  it("redacts sensitive relationship paths from end-user denial responses", async () => {
    const { client } = createMockClient({
      check: async () =>
        createDecision({
          decision: "deny",
          decisionId: "decision:pep-sensitive-path",
          reasonCode: "DENY_DEFAULT_NO_RELATIONSHIP_PATH",
          relationshipPath: sensitiveRelationshipPath
        })
    });
    const observation = await invokeProtectedPep(client, {
      headers: { "x-correlation-id": "corr:pep-sensitive-path" }
    });
    const responseBody = stringifyBody(observation.response.body);

    expect(observation.nextCalled).toBe(false);
    expect(responseBody).toContain("DENY_DEFAULT_NO_RELATIONSHIP_PATH");
    expect(responseBody).not.toContain("executive@example.test");
    expect(responseBody).not.toContain("member_of_sensitive_compensation_group");
    expect(responseBody).not.toContain("board-compensation-private");
    expect(responseBody).not.toContain("executive-compensation-plans");
  });
});

interface PepObservation {
  readonly events: PepDecisionLogEntry[];
  readonly nextCalled: boolean;
  readonly response: TestPepResponse;
}

interface PepDecisionLogEntry {
  readonly correlationId: string;
  readonly decisionId?: string;
  readonly outcome: "allow" | "deny" | "error";
  readonly reasonCode?: string;
}

interface MockClient {
  readonly checkCalls: Array<{ request: DecisionRequest; options?: AccessKitRequestOptions }>;
  readonly client: AccessKitClient;
  readonly explainCalls: Array<{ request: DecisionRequest; options?: AccessKitRequestOptions }>;
}

function createMockClient(options: {
  readonly check: (request: DecisionRequest, options?: AccessKitRequestOptions) => Promise<DecisionResult>;
  readonly explain?: (request: DecisionRequest, options?: AccessKitRequestOptions) => Promise<DecisionResult>;
}): MockClient {
  const checkCalls: Array<{ request: DecisionRequest; options?: AccessKitRequestOptions }> = [];
  const explainCalls: Array<{ request: DecisionRequest; options?: AccessKitRequestOptions }> = [];

  return {
    checkCalls,
    explainCalls,
    client: {
      check: async (request, requestOptions) => {
        checkCalls.push({ options: requestOptions, request });
        return options.check(request, requestOptions);
      },
      explain: async (request, requestOptions) => {
        explainCalls.push({ options: requestOptions, request });
        if (options.explain) {
          return options.explain(request, requestOptions);
        }

        return createDecision();
      },
      testPolicy: async () => ({ checks: [], valid: true })
    }
  };
}

async function invokeProtectedPep(client: AccessKitClient, request: ExpressPepRequest): Promise<PepObservation> {
  const events: PepDecisionLogEntry[] = [];
  const middleware = createAccessKitExpressPepMiddleware({
    client,
    buildDecisionRequest: () => protectedRequest,
    onDecision: (event) => {
      events.push({
        correlationId: event.correlationId,
        decisionId: event.decision?.decisionId,
        outcome: event.outcome,
        reasonCode: event.decision?.reasonCode
      });
    }
  });
  const response = createResponse();
  let nextCalled = false;

  await middleware(request, response, () => {
    nextCalled = true;
  });

  return { events, nextCalled, response };
}

function createDecision(overrides: Partial<DecisionResult> = {}): DecisionResult {
  const decision: DecisionResult = {
    decisionId: "decision:pep-allow",
    decision: "allow",
    subjectId: protectedRequest.subjectId,
    action: protectedRequest.action,
    resourceId: protectedRequest.resourceId,
    reasonCode: "ALLOW_VIA_RELATIONSHIP_PATH",
    policyVersion: "policy:pep-conformance:v1",
    modelVersion: "model:pep-conformance:v1",
    relationshipVersion: "relationship:pep-conformance:v1",
    tupleVersion: "tuple:pep-conformance:v1",
    contextVersion: "context:pep-conformance:v1",
    asOf: "2026-05-26T00:00:00.000Z",
    relationshipPath: [],
    constraints: {},
    evaluatedAt: "2026-05-26T00:00:00.000Z"
  };

  return Object.assign(decision, overrides);
}

interface TestPepResponse extends ExpressPepResponse {
  body?: unknown;
  headers: Record<string, string>;
  statusCode?: number;
}

function createResponse(): TestPepResponse {
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

function stringifyBody(body: unknown): string {
  return JSON.stringify(body);
}
