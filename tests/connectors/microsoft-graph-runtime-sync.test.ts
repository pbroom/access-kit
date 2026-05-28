import { describe, expect, it } from "vitest";
import {
  MICROSOFT_GRAPH_ENTRA_CONNECTOR_ID,
  MicrosoftGraphEntraReadOnlyConnector
} from "../../packages/connectors-microsoft-graph/src/index.js";
import {
  createRebacLocalApp,
  listDiscoveryRuns,
  readNativeAccess,
  syncConnector
} from "../../packages/api/src/local-app.js";
import {
  createFixtureClient,
  createPartialSecondSyncFixtureClient,
  createTwoSyncFixtureClient,
  noSleep,
  now
} from "./microsoft-graph-fixtures.js";

describe("MicrosoftGraphEntraReadOnlyConnector runtime sync", () => {
  it("records Microsoft Graph discovery warnings and native grants through the runtime sync path", async () => {
    const app = createRebacLocalApp({ now: () => now });
    const client = createFixtureClient();
    const connector = new MicrosoftGraphEntraReadOnlyConnector({
      client,
      tenantId: "tenant-live-123",
      now: () => now,
      sleep: noSleep
    });
    app.connectors.set(MICROSOFT_GRAPH_ENTRA_CONNECTOR_ID, connector);
    const applicationId = "application:entra:351056de453711cb";

    const run = await syncConnector(app, MICROSOFT_GRAPH_ENTRA_CONNECTOR_ID, "read_only");
    const grants = readNativeAccess(app, applicationId);

    expect(run.status).toBe("completed_with_warnings");
    expect(run.counts).toMatchObject({
      subjects: 4,
      resources: 1,
      nativeGrants: 1,
      warnings: expect.any(Number)
    });
    expect(run.warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining([
      "GRAPH_SANDBOX_EVIDENCE_REQUIRED",
      "GRAPH_THROTTLE_RETRIED"
    ]));
    expect(run.evidence).toMatchObject({ readOnly: true, nativeAccessReadback: true });
    expect(listDiscoveryRuns(app, { connectorId: MICROSOFT_GRAPH_ENTRA_CONNECTOR_ID })).toEqual([
      expect.objectContaining({ id: run.id, status: "completed_with_warnings" })
    ]);
    expect(JSON.stringify(grants)).not.toContain("raw-assignment-1");
    expect(grants).toEqual([
      expect.objectContaining({ nativePermission: "appRole:Reader", sourceConnectorId: MICROSOFT_GRAPH_ENTRA_CONNECTOR_ID })
    ]);
  });

  it("refreshes Microsoft Graph readback on every runtime sync and drops stale native grants", async () => {
    const app = createRebacLocalApp({ now: () => now });
    const connector = new MicrosoftGraphEntraReadOnlyConnector({
      client: createTwoSyncFixtureClient(),
      tenantId: "tenant-live-123",
      now: () => now,
      sandboxEvidenceRef: "reports/microsoft-graph-sandbox-fixture.json"
    });
    app.connectors.set(MICROSOFT_GRAPH_ENTRA_CONNECTOR_ID, connector);
    const applicationId = "application:entra:351056de453711cb";

    const first = await syncConnector(app, MICROSOFT_GRAPH_ENTRA_CONNECTOR_ID, "read_only");
    const firstGrants = readNativeAccess(app, applicationId);
    const second = await syncConnector(app, MICROSOFT_GRAPH_ENTRA_CONNECTOR_ID, "read_only");
    const secondGrants = readNativeAccess(app, applicationId);

    expect(first.id).not.toBe(second.id);
    expect(firstGrants).toEqual([
      expect.objectContaining({ nativePermission: "appRole:Reader" })
    ]);
    expect(secondGrants).toEqual([]);
  });

  it("preserves previous Microsoft Graph native grants when app-role readback is incomplete", async () => {
    const app = createRebacLocalApp({ now: () => now });
    const connector = new MicrosoftGraphEntraReadOnlyConnector({
      client: createPartialSecondSyncFixtureClient(),
      tenantId: "tenant-live-123",
      now: () => now,
      maxRetries: 0,
      sandboxEvidenceRef: "reports/microsoft-graph-sandbox-fixture.json"
    });
    app.connectors.set(MICROSOFT_GRAPH_ENTRA_CONNECTOR_ID, connector);
    const applicationId = "application:entra:351056de453711cb";

    await syncConnector(app, MICROSOFT_GRAPH_ENTRA_CONNECTOR_ID, "read_only");
    const firstGrants = readNativeAccess(app, applicationId);
    const second = await syncConnector(app, MICROSOFT_GRAPH_ENTRA_CONNECTOR_ID, "read_only");
    const secondGrants = readNativeAccess(app, applicationId);

    expect(firstGrants).toEqual([
      expect.objectContaining({ nativePermission: "appRole:Reader" })
    ]);
    expect(second.status).toBe("completed_with_warnings");
    expect(second.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "GRAPH_COLLECTION_SKIPPED",
        scope: "native_grants"
      })
    ]));
    expect(secondGrants).toEqual([
      expect.objectContaining({ nativePermission: "appRole:Reader" })
    ]);
  });
});
