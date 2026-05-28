import { describe, expect, it } from "vitest";
import {
  MICROSOFT_GRAPH_ENTRA_CONNECTOR_ID,
  MicrosoftGraphEntraReadOnlyConnector
} from "../../packages/connectors-microsoft-graph/src/index.js";
import {
  FixtureGraphClient,
  createDeltaFixtureClient,
  createEmptySharePointOneDriveInventory,
  createStaleDeltaFixtureClient,
  createTwoSyncFixtureClient,
  noSleep,
  now
} from "./microsoft-graph-fixtures.js";

describe("MicrosoftGraphEntraReadOnlyConnector delta, cache, and retry behavior", () => {
  it("applies Microsoft Graph delta cursors and tombstones without leaking raw cursor material", async () => {
    const client = createDeltaFixtureClient();
    const connector = new MicrosoftGraphEntraReadOnlyConnector({
      client,
      tenantId: "tenant-live-123",
      now: () => now,
      sleep: noSleep,
      sandboxEvidenceRef: "reports/microsoft-graph-delta-sandbox-fixture.json"
    });

    const initialSubjects = await connector.discoverSubjects();
    const initialMetadata = connector.getDiscoveryMetadata();
    const updatedSubjects = await connector.discoverSubjects();
    const updatedMetadata = connector.getDiscoveryMetadata();
    const serialized = JSON.stringify({ initialMetadata, updatedMetadata, updatedSubjects });

    expect(initialSubjects).toEqual(expect.arrayContaining([
      expect.objectContaining({ lifecycleState: "active" })
    ]));
    expect(updatedSubjects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        lifecycleState: "deleted",
        attributes: expect.objectContaining({
          providerTombstone: true,
          tombstoneReason: "deleted",
          tenantId: expect.stringMatching(/^microsoft-graph:tenant:/)
        })
      })
    ]));
    expect(updatedMetadata.cursor).toMatchObject({
      startedFrom: expect.stringMatching(/^cursor:microsoft-graph:delta:/),
      next: expect.stringMatching(/^cursor:microsoft-graph:delta:/),
      deletedObjectBehavior: "mark_deleted"
    });
    expect(updatedMetadata.warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining([
      "GRAPH_DELTA_SYNC_APPLIED",
      "GRAPH_DELTA_TOMBSTONE_OBSERVED"
    ]));
    expect(client.calls).toContain("/users/delta?$deltatoken=raw-user-delta-1");
    expect(serialized).not.toContain("raw-user-delta-1");
    expect(serialized).not.toContain("raw-user-delta-2");
    expect(serialized).not.toContain("tenant-live-123");
  });

  it("recovers from stale Microsoft Graph delta cursors and surfaces coverage findings", async () => {
    const connector = new MicrosoftGraphEntraReadOnlyConnector({
      client: createStaleDeltaFixtureClient(),
      tenantId: "tenant-live-123",
      now: () => now,
      sleep: noSleep,
      sandboxEvidenceRef: "reports/microsoft-graph-delta-sandbox-fixture.json"
    });

    await connector.discoverSubjects();
    const recoveredSubjects = await connector.discoverSubjects();
    const metadata = connector.getDiscoveryMetadata();
    const findings = await connector.detectDrift();
    const serialized = JSON.stringify({ recoveredSubjects, metadata, findings });

    expect(recoveredSubjects).toEqual([
      expect.objectContaining({
        type: "user",
        lifecycleState: "active",
        attributes: expect.objectContaining({ tenantId: expect.stringMatching(/^microsoft-graph:tenant:/) })
      })
    ]);
    expect(metadata.warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining([
      "GRAPH_DELTA_TOKEN_STALE",
      "GRAPH_INCREMENTAL_SYNC_FULL_RESYNC"
    ]));
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        nativeAccess: "GRAPH_DELTA_TOKEN_STALE",
        intendedAccess: "complete_provider_coverage",
        severity: "medium",
        recommendedAction: "review",
        sourceConnectorId: MICROSOFT_GRAPH_ENTRA_CONNECTOR_ID
      })
    ]));
    expect(serialized).not.toContain("raw-user-delta-stale-token");
    expect(serialized).not.toContain("tenant-live-123");
  });

  it("awaits Microsoft Graph retryAfterSeconds before retrying throttled reads", async () => {
    const client = new FixtureGraphClient({
      "/users?$select=id,displayName,userPrincipalName,accountEnabled,userType,externalUserState,deletedDateTime": [
        { value: [], status: 429, retryAfterSeconds: 2.5 },
        { value: [{ id: "raw-user-1", displayName: "Alice Example", accountEnabled: true, userType: "Member" }], status: 200 }
      ],
      "/groups?$select=id,displayName,securityEnabled,mailEnabled,visibility,groupTypes,resourceProvisioningOptions,deletedDateTime": [
        { value: [], status: 200 }
      ],
      "/servicePrincipals?$select=id,displayName,appId,servicePrincipalType,appRoles,deletedDateTime": [
        { value: [], status: 200 }
      ],
      ...createEmptySharePointOneDriveInventory(["raw-user-1"])
    });
    const sleeps: number[] = [];
    const connector = new MicrosoftGraphEntraReadOnlyConnector({
      client,
      tenantId: "tenant-live-123",
      now: () => now,
      maxRetries: 1,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      }
    });

    await expect(connector.discoverSubjects()).resolves.toEqual([
      expect.objectContaining({ type: "user" })
    ]);
    expect(sleeps).toEqual([2500]);
    expect(client.calls.slice(0, 2)).toEqual([
      "/users?$select=id,displayName,userPrincipalName,accountEnabled,userType,externalUserState,deletedDateTime",
      "/users?$select=id,displayName,userPrincipalName,accountEnabled,userType,externalUserState,deletedDateTime"
    ]);
  });

  it("caps Microsoft Graph retryAfterSeconds before sleeping", async () => {
    const client = new FixtureGraphClient({
      "/users?$select=id,displayName,userPrincipalName,accountEnabled,userType,externalUserState,deletedDateTime": [
        { value: [], status: 429, retryAfterSeconds: 3600 },
        { value: [{ id: "raw-user-1", displayName: "Alice Example", accountEnabled: true, userType: "Member" }], status: 200 }
      ],
      "/groups?$select=id,displayName,securityEnabled,mailEnabled,visibility,groupTypes,resourceProvisioningOptions,deletedDateTime": [
        { value: [], status: 200 }
      ],
      "/servicePrincipals?$select=id,displayName,appId,servicePrincipalType,appRoles,deletedDateTime": [
        { value: [], status: 200 }
      ],
      ...createEmptySharePointOneDriveInventory(["raw-user-1"])
    });
    const sleeps: number[] = [];
    const connector = new MicrosoftGraphEntraReadOnlyConnector({
      client,
      tenantId: "tenant-live-123",
      now: () => now,
      maxRetries: 1,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      }
    });

    await connector.discoverSubjects();

    expect(sleeps).toEqual([60_000]);
  });

  it("reuses a resource-loaded snapshot for the first subject read", async () => {
    const client = createTwoSyncFixtureClient();
    const connector = new MicrosoftGraphEntraReadOnlyConnector({
      client,
      tenantId: "tenant-live-123",
      now: () => now,
      sleep: noSleep
    });

    const resources = await connector.discoverResources();
    const subjects = await connector.discoverSubjects();
    const userReadCount = () => client.calls.filter(
      (path) => path.startsWith("/users?$select=id,displayName,userPrincipalName")
    ).length;

    expect(resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "application" })
    ]));
    expect(subjects).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "user" })
    ]));
    expect(userReadCount()).toBe(1);

    await connector.discoverSubjects();

    expect(userReadCount()).toBe(2);
  });
});
