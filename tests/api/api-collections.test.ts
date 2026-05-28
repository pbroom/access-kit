import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createDemoSeedData } from "../../packages/core/src/index.js";
import { createRebacApiServer, createRebacLocalApp } from "../../packages/api/src/index.js";
import {
  createApiCollectionModel,
  renderBrunoRequest,
  renderPostmanCollection,
  type ApiCollectionRequestModel
} from "../../scripts/lib/api-collection-renderer.js";
import {
  createApiCollectionDefinitions,
  readResponsePath,
  renderJsonTemplate,
  renderTemplate
} from "../../scripts/lib/api-collections.js";

const definitions = createApiCollectionDefinitions();
const collection = createApiCollectionModel(definitions);
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
  it("normalizes shared request details before format adapters render them", () => {
    expect(collection.folders.map((folder) => folder.name)).toEqual([
      "Setup",
      "Decision",
      "Policy",
      "Provisioning",
      "Reconciliation",
      "Authentication Failures",
      "Exports"
    ]);

    const createPolicy = requiredCollectionRequest("Create Demo Policy Draft");
    expect(createPolicy.url).toBe("/v1/policies");
    expect(createPolicy.bodyMode).toBe("json");
    expect(createPolicy.headers).toEqual([
      { key: "Content-Type", value: "application/json" },
      { key: "Idempotency-Key", value: "example0" }
    ]);
    expect(createPolicy.capture).toEqual([{ variable: "demo_policy_id", responsePath: ["id"] }]);
    expect(collection.environmentVariables.map((variable) => variable.key)).toEqual([
      collection.baseUrlVariable,
      collection.tokenVariable,
      collection.invalidTokenVariable
    ]);

    const auditExport = requiredCollectionRequest("Export Audit Events");
    expect(auditExport.url).toContain("/v1/audit/export?");
    expect(auditExport.url).toContain("target=operator_download");
    expect(auditExport.bodyMode).toBe("none");
    expect(auditExport.headers).toEqual([]);

    const invalidAuth = requiredCollectionRequest("Invalid Bearer Token Fails Closed");
    expect(invalidAuth.auth).toBe("invalid");
    expect(renderBrunoRequest(invalidAuth, collection)).toContain("token: {{invalid_rebac_api_token}}");

    const postman = renderPostmanCollection(collection) as { variable?: Array<Record<string, string>> };
    expect(postman.variable).toEqual([
      { key: "base_url", value: "http://127.0.0.1:8080" },
      { key: "rebac_api_token", value: "", type: "secret" },
      { key: "invalid_rebac_api_token", value: "intentionally-invalid", type: "secret" },
      { key: "demo_policy_id", value: "" },
      { key: "provisioning_plan_id", value: "" }
    ]);
  });

  it("run successfully against the demo seed API without checked-in secrets", async () => {
    const baseUrl = await startDemoSeedApi();
    const variables: Record<string, string> = {
      [collection.baseUrlVariable]: baseUrl,
      [collection.tokenVariable]: apiKey,
      [collection.invalidTokenVariable]: collection.invalidTokenValue,
      demo_policy_id: "policy:run-setup-first",
      provisioning_plan_id: "plan:run-dry-run-plan-first"
    };

    for (const request of collection.requests) {
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
  request: ApiCollectionRequestModel,
  variables: Record<string, string>
): Promise<Response> {
  const headers = new Headers();

  for (const header of request.headers) {
    headers.set(header.key, header.value);
  }

  if (request.auth === "inherit") {
    headers.set("authorization", `Bearer ${apiKey}`);
  } else if (request.auth === "invalid") {
    headers.set("authorization", `Bearer ${collection.invalidTokenValue}`);
  }

  return fetch(`${baseUrl}${renderTemplate(request.url, variables)}`, {
    method: request.method,
    headers,
    body: request.body === undefined ? undefined : JSON.stringify(renderJsonTemplate(request.body, variables))
  });
}

function requiredCollectionRequest(name: string): ApiCollectionRequestModel {
  const request = collection.requests.find((candidate) => candidate.name === name);
  if (!request) {
    throw new Error(`API collection model is missing ${name}.`);
  }
  return request;
}

function assertWorkflowBody(request: ApiCollectionRequestModel, body: Record<string, unknown>): void {
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
