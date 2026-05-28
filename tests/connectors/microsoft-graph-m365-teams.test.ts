import { describe, expect, it } from "vitest";
import {
  MICROSOFT_GRAPH_ENTRA_CONNECTOR_ID,
  MICROSOFT_GRAPH_ENTRA_REQUIRED_READ_SCOPES,
  MicrosoftGraphEntraReadOnlyConnector
} from "../../packages/connectors-microsoft-graph/src/index.js";
import {
  createFixtureClient,
  createM365TeamsFixtureClient,
  noSleep,
  now
} from "./microsoft-graph-fixtures.js";

describe("MicrosoftGraphEntraReadOnlyConnector M365 and Teams", () => {
  it("imports redacted Microsoft 365 group and Teams coupling semantics without collapsing provider coverage", async () => {
    const client = createM365TeamsFixtureClient();
    const connector = new MicrosoftGraphEntraReadOnlyConnector({
      client,
      tenantId: "tenant-live-123",
      now: () => now,
      sleep: noSleep,
      sandboxEvidenceRef: "reports/microsoft-graph-m365-teams-sandbox-fixture.json"
    });

    const subjects = await connector.discoverSubjects();
    const resources = await connector.discoverResources();
    const relationships = await connector.discoverRelationships();
    const metadata = connector.getDiscoveryMetadata();
    const workspace = resources.find((resource) => resource.type === "workspace");
    const team = resources.find((resource) => resource.type === "team");
    const workspaceGrants = await connector.readCurrentAccess(workspace!.id);
    const teamGrants = await connector.readCurrentAccess(team!.id);
    const serialized = JSON.stringify({ subjects, resources, relationships, workspaceGrants, teamGrants, metadata });

    expect(workspace).toEqual(expect.objectContaining({
      type: "workspace",
      sourceSystem: MICROSOFT_GRAPH_ENTRA_CONNECTOR_ID,
      attributes: expect.objectContaining({
        graphType: "microsoft365Group",
        teamBacked: true,
        redacted: true
      })
    }));
    expect(team).toEqual(expect.objectContaining({
      type: "team",
      parentId: workspace!.id,
      sourceSystem: MICROSOFT_GRAPH_ENTRA_CONNECTOR_ID,
      attributes: expect.objectContaining({
        graphType: "team",
        couplingSource: "microsoft_graph_team",
        redacted: true
      })
    }));
    expect(relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({ relation: "m365_group_member", objectId: workspace!.id }),
      expect.objectContaining({ relation: "team_member", objectId: team!.id }),
      expect.objectContaining({ relation: "m365_group_owner", objectId: workspace!.id }),
      expect.objectContaining({ relation: "team_owner", objectId: team!.id }),
      expect.objectContaining({ relation: "m365_group_backs_team", subjectId: workspace!.id, objectId: team!.id })
    ]));
    expect(workspaceGrants).toEqual(expect.arrayContaining([
      expect.objectContaining({ nativePermission: "m365Group:member", principalType: "service_principal" }),
      expect.objectContaining({ nativePermission: "m365Group:owner", principalType: "user" })
    ]));
    expect(teamGrants).toEqual(expect.arrayContaining([
      expect.objectContaining({ nativePermission: "team:member", principalType: "service_principal", inheritedFromObjectId: workspace!.id }),
      expect.objectContaining({ nativePermission: "team:owner", principalType: "user", inheritedFromObjectId: workspace!.id })
    ]));
    expect(metadata.requiredReadScopes).toEqual([...MICROSOFT_GRAPH_ENTRA_REQUIRED_READ_SCOPES]);
    expect(metadata.warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining([
      "GRAPH_GROUP_OWNER_SERVICE_PRINCIPAL_VISIBILITY_LIMITED",
      "GRAPH_TEAM_CHANNEL_COVERAGE_UNSUPPORTED"
    ]));
    expect(client.calls).toEqual(expect.arrayContaining([
      "/teams/raw-m365-group-1?$select=id,displayName,description,webUrl,isArchived,visibility",
      "/groups/raw-m365-group-1/owners?$select=id,displayName,userPrincipalName,appId,servicePrincipalType"
    ]));
    expect(client.requests.find((request) => request.path.startsWith("/teams/"))?.headers).toBeUndefined();
    expect(serialized).not.toContain("tenant-live-123");
    expect(serialized).not.toContain("M365 Collaboration");
    expect(serialized).not.toContain("Case Team");
    expect(serialized).not.toContain("owner@example.test");
    expect(serialized).not.toContain("https://teams.example.test");
    expect(serialized).not.toContain("raw-m365-group-1");
  });

  it("does not emit service-principal owner visibility warnings for user-only owners", async () => {
    const connector = new MicrosoftGraphEntraReadOnlyConnector({
      client: createM365TeamsFixtureClient([
        { id: "raw-user-owner", "@odata.type": "#microsoft.graph.user", displayName: "Owner Example" }
      ]),
      tenantId: "tenant-live-123",
      now: () => now,
      sleep: noSleep,
      sandboxEvidenceRef: "reports/microsoft-graph-m365-teams-sandbox-fixture.json"
    });

    await connector.discoverRelationships();

    expect(connector.getDiscoveryMetadata().warnings.map((warning) => warning.code))
      .not.toContain("GRAPH_GROUP_OWNER_SERVICE_PRINCIPAL_VISIBILITY_LIMITED");
  });

  it("does not report empty Microsoft 365 group ownership when owner readback fails", async () => {
    const connector = new MicrosoftGraphEntraReadOnlyConnector({
      client: createM365TeamsFixtureClient([], { value: [], status: 403 }),
      tenantId: "tenant-live-123",
      now: () => now,
      sleep: noSleep,
      sandboxEvidenceRef: "reports/microsoft-graph-m365-teams-sandbox-fixture.json"
    });

    await connector.discoverRelationships();

    const warningCodes = connector.getDiscoveryMetadata().warnings.map((warning) => warning.code);
    expect(warningCodes).toContain("GRAPH_COLLECTION_SKIPPED");
    expect(warningCodes).not.toContain("GRAPH_M365_GROUP_OWNER_COVERAGE_EMPTY");
  });

  it("does not warn for ordinary Microsoft 365 groups without Teams backing", async () => {
    const connector = new MicrosoftGraphEntraReadOnlyConnector({
      client: createFixtureClient(),
      tenantId: "tenant-live-123",
      now: () => now,
      sleep: noSleep,
      sandboxEvidenceRef: "reports/microsoft-graph-sandbox-fixture.json"
    });

    await connector.discoverResources();

    expect(connector.getDiscoveryMetadata().warnings.map((warning) => warning.code))
      .not.toContain("GRAPH_M365_GROUP_WITHOUT_TEAM");
  });
});
