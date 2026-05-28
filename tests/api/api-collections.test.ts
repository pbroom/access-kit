import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createDemoSeedData } from "../../packages/core/src/index.js";
import { createRebacApiServer, createRebacLocalApp } from "../../packages/api/src/index.js";
import {
  createApiCollectionDefinitions,
  readResponsePath,
  renderJsonTemplate,
  renderTemplate,
  requestUrl,
  type ApiCollectionRequestDefinition
} from "../../scripts/lib/api-collections.js";

const definitions = createApiCollectionDefinitions();
const apiKey = "collection-test-api-key";

let server: Server | undefined;

afterEach(async () => {
  if (!server?.listening) {
    return;
  }

  server.close();
  await once(server, "close");
  server = undefined;
});

describe("API collection examples", () => {
  it("run successfully against the demo seed API without checked-in secrets", async () => {
    const baseUrl = await startDemoSeedApi();
    const variables: Record<string, string> = {
      [definitions.baseUrlVariable]: baseUrl,
      [definitions.tokenVariable]: apiKey,
      [definitions.invalidTokenVariable]: definitions.invalidTokenValue,
      demo_policy_id: "policy:run-setup-first",
      provisioning_plan_id: "plan:run-dry-run-plan-first"
    };

    for (const request of definitions.requests) {
      const response = await sendCollectionRequest(baseUrl, request, variables);
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status, request.name).toBe(request.expectedStatus);

      if (request.expectedCode) {
        expect(body.code, request.name).toBe(request.expectedCode);
      }

      for (const capture of request.capture ?? []) {
        variables[capture.variable] = readResponsePath(body, capture.responsePath);
      }

      assertWorkflowBody(request, body);
    }
  });
});

async function startDemoSeedApi(): Promise<string> {
  const app = createRebacLocalApp({
    seed: createDemoSeedData(),
    now: () => "2026-05-21T17:00:00.000Z"
  });
  server = createRebacApiServer({ app, apiKeys: [apiKey] });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function sendCollectionRequest(
  baseUrl: string,
  request: ApiCollectionRequestDefinition,
  variables: Record<string, string>
): Promise<Response> {
  const headers = new Headers();

  if (request.body !== undefined) {
    headers.set("content-type", "application/json");
  }

  if (request.idempotencyKey) {
    headers.set("idempotency-key", request.idempotencyKey);
  }

  if (request.auth === "inherit") {
    headers.set("authorization", `Bearer ${apiKey}`);
  } else if (request.auth === "invalid") {
    headers.set("authorization", `Bearer ${definitions.invalidTokenValue}`);
  }

  return fetch(`${baseUrl}${renderTemplate(requestUrl(request), variables)}`, {
    method: request.method,
    headers,
    body: request.body === undefined ? undefined : JSON.stringify(renderJsonTemplate(request.body, variables))
  });
}

function assertWorkflowBody(request: ApiCollectionRequestDefinition, body: Record<string, unknown>): void {
  if (request.coverage.includes("decision_check")) {
    expect(body).toMatchObject({ decision: "allow", reasonCode: "ALLOW_VIA_RELATIONSHIP_PATH" });
  }

  if (request.coverage.includes("decision_explain")) {
    expect(body).toMatchObject({ decision: "deny", reasonCode: "DENY_EXPLICIT_OVERRIDE" });
    expect(body.relationshipPath).toEqual(expect.any(Array));
  }

  if (request.coverage.includes("policy_test")) {
    expect(body).toMatchObject({ valid: true });
    expect(body.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "proof_points", status: "pass" })
    ]));
  }

  if (request.coverage.includes("provisioning_plan")) {
    expect(body).toMatchObject({ status: "planned", connectorId: "mock" });
    expect(body.actions).toEqual(expect.any(Array));
  }

  if (request.coverage.includes("provisioning_job")) {
    expect(body).toMatchObject({ dryRun: true, connectorId: "mock" });
    expect(body.auditEventIds).toEqual(expect.any(Array));
  }

  if (request.coverage.includes("reconciliation")) {
    expect(body).toMatchObject({ connectorId: "mock", dryRun: true });
    expect(body.findings).toEqual(expect.any(Array));
  }

  if (request.coverage.includes("audit_export")) {
    expect(body).toHaveProperty("exportId");
    expect(body).toHaveProperty("records");
  }

  if (request.coverage.includes("evidence_export")) {
    expect(body).toHaveProperty("exportId");
    expect(body).toHaveProperty("controlMappings");
  }
}
