import { describe, expect, it } from "vitest";
import {
  FetchMicrosoftGraphClient,
  MICROSOFT_GRAPH_ENTRA_CONNECTOR_ID,
  MicrosoftGraphEntraReadOnlyConnector,
  createMicrosoftGraphEntraReadOnlyConnectorFromEnv
} from "../../packages/connectors-microsoft-graph/src/index.js";
import { createRuntimeConnectors } from "../../packages/api/src/runtime-connectors.js";
import { createRebacLocalApp } from "../../packages/api/src/local-app.js";
import { validateConnectorSecurityGate } from "../../scripts/validate-connector-security-gate.js";
import {
  createAuditEvent,
  FixtureGraphClient,
  createFixtureClient,
  noSleep,
  now
} from "./microsoft-graph-fixtures.js";

describe("MicrosoftGraphEntraReadOnlyConnector client, security gate, evidence, and env wiring", () => {
  it("rejects cross-origin Microsoft Graph pagination URLs before sending bearer tokens", async () => {
    const requested: Array<{ url: string; authorization?: string }> = [];
    const client = new FetchMicrosoftGraphClient({
      accessToken: "test-token",
      fetch: (async (input, init) => {
        const headers = init?.headers as Record<string, string>;
        requested.push({ url: String(input), authorization: headers.Authorization });
        return new Response(JSON.stringify({
          value: [],
          "@odata.nextLink": "https://evil.example.test/v1.0/users?page=2"
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }) as typeof fetch
    });
    const connector = new MicrosoftGraphEntraReadOnlyConnector({
      client,
      tenantId: "tenant-live-123",
      now: () => now
    });

    await expect(connector.discoverSubjects()).rejects.toThrow("not in the approved Graph endpoint allowlist");
    expect(requested).toEqual([
      {
        url: "https://graph.microsoft.com/v1.0/users?$select=id,displayName,userPrincipalName,accountEnabled,userType,externalUserState,deletedDateTime",
        authorization: "Bearer test-token"
      }
    ]);
  });

  it("rejects non-HTTPS absolute Microsoft Graph pagination URLs", async () => {
    const requested: string[] = [];
    const client = new FetchMicrosoftGraphClient({
      accessToken: "test-token",
      fetch: (async (input) => {
        requested.push(String(input));
        return new Response(JSON.stringify({
          value: [],
          "@odata.nextLink": "http://graph.microsoft.com/v1.0/users?page=2"
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }) as typeof fetch
    });
    const connector = new MicrosoftGraphEntraReadOnlyConnector({
      client,
      tenantId: "tenant-live-123",
      now: () => now
    });

    await expect(connector.discoverSubjects()).rejects.toThrow("Microsoft Graph URL must use HTTPS");
    expect(requested).toEqual([
      "https://graph.microsoft.com/v1.0/users?$select=id,displayName,userPrincipalName,accountEnabled,userType,externalUserState,deletedDateTime"
    ]);
  });

  it("returns production-like 404 responses for unconfigured fixture paths", async () => {
    const client = new FixtureGraphClient({});

    await expect(client.list("/missing")).resolves.toEqual({ value: [], status: 404 });
    await expect(client.get("/missing")).resolves.toEqual({ status: 404 });
    expect(client.calls).toEqual(["/missing", "/missing"]);
  });

  it("passes the connector security gate as an approved live-read connector", async () => {
    const app = createRebacLocalApp({ now: () => now });
    app.connectors.set(MICROSOFT_GRAPH_ENTRA_CONNECTOR_ID, new MicrosoftGraphEntraReadOnlyConnector({
      client: createFixtureClient(),
      tenantId: "tenant-live-123",
      now: () => now,
      sleep: noSleep,
      sandboxEvidenceRef: "reports/microsoft-graph-sandbox-fixture.json"
    }));

    await expect(validateConnectorSecurityGate(app)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ connectorId: MICROSOFT_GRAPH_ENTRA_CONNECTOR_ID })
    ]));
  });

  it("derives connector evidence periods from source audit events and falls back to now", async () => {
    const connector = new MicrosoftGraphEntraReadOnlyConnector({
      client: createFixtureClient(),
      tenantId: "tenant-live-123",
      now: () => now,
      sleep: noSleep
    });

    await expect(connector.emitEvidence([
      createAuditEvent("evt:late", "2026-05-26T12:30:00.000Z"),
      createAuditEvent("evt:early", "2026-05-26T10:15:00.000Z")
    ])).resolves.toMatchObject({
      periodStart: "2026-05-26T10:15:00.000Z",
      periodEnd: "2026-05-26T12:30:00.000Z",
      sourceEventIds: ["evt:late", "evt:early"]
    });

    await expect(connector.emitEvidence([])).resolves.toMatchObject({
      periodStart: now,
      periodEnd: now,
      sourceEventIds: []
    });
  });

  it("registers the Microsoft Graph connector only when sandbox environment credentials are present", () => {
    expect(createRuntimeConnectors({ env: {} }).has(MICROSOFT_GRAPH_ENTRA_CONNECTOR_ID)).toBe(false);

    const connectors = createRuntimeConnectors({
      env: {
        REBAC_MICROSOFT_GRAPH_ENTRA_ID_ENABLED: "true",
        REBAC_MICROSOFT_GRAPH_TENANT_ID: "tenant-live-123",
        REBAC_MICROSOFT_GRAPH_ACCESS_TOKEN: "test-token",
        REBAC_MICROSOFT_GRAPH_SANDBOX_EVIDENCE: "reports/microsoft-graph-sandbox-fixture.json"
      }
    });
    const direct = createMicrosoftGraphEntraReadOnlyConnectorFromEnv({
      REBAC_MICROSOFT_GRAPH_ENTRA_ID_ENABLED: "true",
      REBAC_MICROSOFT_GRAPH_TENANT_ID: "tenant-live-123",
      REBAC_MICROSOFT_GRAPH_ACCESS_TOKEN: "test-token"
    });

    expect(connectors.has(MICROSOFT_GRAPH_ENTRA_CONNECTOR_ID)).toBe(true);
    expect(direct?.getDiscoveryMetadata()).toMatchObject({ provider: "microsoft-graph", synthetic: false });
  });
});
