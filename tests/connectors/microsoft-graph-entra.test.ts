import { describe, expect, it } from "vitest";
import {
  FetchMicrosoftGraphClient,
  MICROSOFT_GRAPH_ENTRA_CONNECTOR_ID,
  MICROSOFT_GRAPH_ENTRA_REQUIRED_READ_SCOPES,
  MicrosoftGraphEntraReadOnlyConnector,
  createMicrosoftGraphEntraReadOnlyConnectorFromEnv,
  type MicrosoftGraphCollectionPage,
  type MicrosoftGraphRecordResponse,
  type MicrosoftGraphReadClient
} from "../../packages/connectors-microsoft-graph/src/index.js";
import { auditPayloadHash, type AuditEvent } from "../../packages/core/src/index.js";
import { createRuntimeConnectors } from "../../packages/api/src/runtime-connectors.js";
import {
  createRebacLocalApp,
  listDiscoveryRuns,
  readNativeAccess,
  syncConnector
} from "../../packages/api/src/local-app.js";
import { validateConnectorSecurityGate } from "../../scripts/validate-connector-security-gate.js";

const now = "2026-05-26T12:00:00.000Z";
const noSleep = async (): Promise<void> => {};

class FixtureGraphClient implements MicrosoftGraphReadClient {
  readonly calls: string[] = [];
  readonly #pages: Map<string, Array<MicrosoftGraphCollectionPage<unknown>>>;
  readonly #records: Map<string, Array<MicrosoftGraphRecordResponse<unknown>>>;

  constructor(
    pages: Record<string, Array<MicrosoftGraphCollectionPage<unknown>>>,
    records: Record<string, Array<MicrosoftGraphRecordResponse<unknown>>> = {}
  ) {
    this.#pages = new Map(Object.entries(pages));
    this.#records = new Map(Object.entries(records));
  }

  async list<T>(pathOrUrl: string): Promise<MicrosoftGraphCollectionPage<T>> {
    this.calls.push(pathOrUrl);
    const pages = this.#pages.get(pathOrUrl);
    if (!pages || pages.length === 0) {
      throw new Error(`No fixture page for ${pathOrUrl}`);
    }

    return pages.shift() as MicrosoftGraphCollectionPage<T>;
  }

  async get<T>(pathOrUrl: string): Promise<MicrosoftGraphRecordResponse<T>> {
    this.calls.push(pathOrUrl);
    const records = this.#records.get(pathOrUrl);
    if (!records || records.length === 0) {
      throw new Error(`No fixture record for ${pathOrUrl}`);
    }

    return records.shift() as MicrosoftGraphRecordResponse<T>;
  }
}

describe("MicrosoftGraphEntraReadOnlyConnector", () => {
  it("uses a stable pre-discovery cursor before any source events are processed", () => {
    let nowCall = 0;
    const connector = new MicrosoftGraphEntraReadOnlyConnector({
      client: createFixtureClient(),
      tenantId: "tenant-live-123",
      now: () => `2026-05-26T12:00:0${nowCall++}.000Z`
    });

    expect(connector.getDiscoveryMetadata().cursor).toEqual({
      startedFrom: "cursor:microsoft-graph:initial",
      highWatermark: "cursor:microsoft-graph:pre-discovery",
      deletedObjectBehavior: "mark_deleted"
    });
    expect(connector.getDiscoveryMetadata().cursor).toEqual({
      startedFrom: "cursor:microsoft-graph:initial",
      highWatermark: "cursor:microsoft-graph:pre-discovery",
      deletedObjectBehavior: "mark_deleted"
    });
  });

  it("imports redacted Entra subjects, groups, service principals, app roles, and provider warnings", async () => {
    const client = createFixtureClient();
    const connector = new MicrosoftGraphEntraReadOnlyConnector({
      client,
      tenantId: "tenant-live-123",
      now: () => now,
      maxRetries: 1,
      sleep: noSleep
    });

    const subjects = await connector.discoverSubjects();
    const resources = await connector.discoverResources();
    const relationships = await connector.discoverRelationships();
    const grants = await connector.readCurrentAccess(resources[0]!.id);
    const metadata = connector.getDiscoveryMetadata();
    const serialized = JSON.stringify({ subjects, resources, relationships, grants, metadata });

    expect(subjects).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "user", sourceSystem: MICROSOFT_GRAPH_ENTRA_CONNECTOR_ID }),
      expect.objectContaining({ type: "group", sourceSystem: MICROSOFT_GRAPH_ENTRA_CONNECTOR_ID }),
      expect.objectContaining({ type: "service_principal", sourceSystem: MICROSOFT_GRAPH_ENTRA_CONNECTOR_ID })
    ]));
    expect(resources).toEqual([
      expect.objectContaining({ type: "application", sourceSystem: MICROSOFT_GRAPH_ENTRA_CONNECTOR_ID })
    ]);
    expect(relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({ relation: "member_of" }),
      expect.objectContaining({ relation: "represents" })
    ]));
    expect(grants).toEqual([
      expect.objectContaining({
        nativePermission: "appRole:Reader",
        grantType: "group",
        principalType: "group",
        sourceConnectorId: MICROSOFT_GRAPH_ENTRA_CONNECTOR_ID
      })
    ]);
    expect(metadata).toMatchObject({
      provider: "microsoft-graph",
      synthetic: false,
      requiredReadScopes: [...MICROSOFT_GRAPH_ENTRA_REQUIRED_READ_SCOPES],
      cursor: { deletedObjectBehavior: "mark_deleted" }
    });
    expect(metadata.warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining([
      "GRAPH_SANDBOX_EVIDENCE_REQUIRED",
      "GRAPH_PAGINATION_OBSERVED",
      "GRAPH_THROTTLE_RETRIED"
    ]));
    expect(serialized).not.toContain("alice@example.test");
    expect(serialized).not.toContain("tenant-live-123");
    expect(serialized).not.toContain("raw-user-1");
    expect(serialized).not.toContain("/users?page=2");
  });

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

  it("keeps live provider writes disabled even when provisioning hooks are called", async () => {
    const connector = new MicrosoftGraphEntraReadOnlyConnector({
      client: createFixtureClient(),
      tenantId: "tenant-live-123",
      now: () => now,
      sleep: noSleep
    });
    const review = connector.getSecurityReview();
    const plan = await connector.planProvisioningChange({
      decisionId: "decision:graph-write-probe",
      decision: "allow",
      subjectId: "user:probe",
      action: "read",
      resourceId: "application:probe",
      reasonCode: "ALLOW_PROBE",
      policyVersion: "policy:v1",
      modelVersion: "model:v1",
      relationshipVersion: "relationships:v1",
      tupleVersion: "tuple:v1",
      contextVersion: "context:none",
      asOf: now,
      relationshipPath: [],
      constraints: {},
      evaluatedAt: now
    });

    expect(connector.capabilities.supportsProvisioning).toBe(false);
    expect(review).toMatchObject({
      synthetic: false,
      consent: { status: "approved" },
      enforcement: { liveWritesAllowed: false }
    });
    expect(plan.mode).toBe("dry_run");
    expect(plan.actions.every((action) => action.dryRun && action.compensation?.status === "planned")).toBe(true);
    await expect(connector.applyProvisioningChange(plan)).resolves.toMatchObject({ status: "failed" });
  });

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
      ]
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
      ]
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

function createFixtureClient(): FixtureGraphClient {
  return new FixtureGraphClient({
    "/users?$select=id,displayName,userPrincipalName,accountEnabled,userType,externalUserState,deletedDateTime": [
      {
        value: [
          {
            id: "raw-user-1",
            displayName: "Alice Example",
            userPrincipalName: "alice@example.test",
            accountEnabled: true,
            userType: "Member"
          }
        ],
        nextLink: "/users?page=2",
        status: 200
      }
    ],
    "/users?page=2": [
      {
        value: [
          {
            id: "raw-user-2",
            displayName: "External Reviewer",
            userPrincipalName: "external@example.test",
            accountEnabled: true,
            userType: "Guest",
            externalUserState: "Accepted"
          }
        ],
        status: 200
      }
    ],
    "/groups?$select=id,displayName,securityEnabled,mailEnabled,visibility,groupTypes,resourceProvisioningOptions,deletedDateTime": [
      {
        value: [
          {
            id: "raw-group-1",
            displayName: "Case Reviewers",
            securityEnabled: true,
            groupTypes: []
          }
        ],
        status: 200
      }
    ],
    "/servicePrincipals?$select=id,displayName,appId,servicePrincipalType,appRoles,deletedDateTime": [
      {
        value: [
          {
            id: "raw-sp-1",
            displayName: "Case Portal",
            appId: "raw-app-id",
            servicePrincipalType: "Application",
            appRoles: [{ id: "raw-role-reader", displayName: "Reader", value: "Reader" }]
          }
        ],
        status: 200
      }
    ],
    "/groups/raw-group-1/members?$select=id,displayName,userPrincipalName,appId,servicePrincipalType": [
      {
        value: [
          { id: "raw-user-1", "@odata.type": "#microsoft.graph.user", displayName: "Alice Example" },
          { id: "raw-sp-1", "@odata.type": "#microsoft.graph.servicePrincipal", displayName: "Case Portal" }
        ],
        status: 200
      }
    ],
    "/servicePrincipals/raw-sp-1/appRoleAssignedTo?$select=id,principalId,principalType,principalDisplayName,resourceId,resourceDisplayName,appRoleId,createdDateTime": [
      { value: [], status: 429, retryAfterSeconds: 1 },
      {
        value: [
          {
            id: "raw-assignment-1",
            principalId: "raw-group-1",
            principalType: "Group",
            principalDisplayName: "Case Reviewers",
            resourceId: "raw-sp-1",
            resourceDisplayName: "Case Portal",
            appRoleId: "raw-role-reader",
            createdDateTime: "2026-05-26T11:59:00.000Z"
          }
        ],
        status: 200
      }
    ]
  });
}

function createM365TeamsFixtureClient(ownerObjects: Array<Record<string, unknown>> = [
  { id: "raw-user-owner", "@odata.type": "#microsoft.graph.user", displayName: "Owner Example" },
  { id: "raw-sp-bot", "@odata.type": "#microsoft.graph.servicePrincipal", displayName: "Automation Bot" }
]): FixtureGraphClient {
  return new FixtureGraphClient({
    "/users?$select=id,displayName,userPrincipalName,accountEnabled,userType,externalUserState,deletedDateTime": [
      {
        value: [
          {
            id: "raw-user-owner",
            displayName: "Owner Example",
            userPrincipalName: "owner@example.test",
            accountEnabled: true,
            userType: "Member"
          },
          {
            id: "raw-user-member",
            displayName: "Member Example",
            userPrincipalName: "member@example.test",
            accountEnabled: true,
            userType: "Member"
          }
        ],
        status: 200
      }
    ],
    "/groups?$select=id,displayName,securityEnabled,mailEnabled,visibility,groupTypes,resourceProvisioningOptions,deletedDateTime": [
      {
        value: [
          {
            id: "raw-m365-group-1",
            displayName: "M365 Collaboration",
            securityEnabled: true,
            mailEnabled: true,
            visibility: "Private",
            groupTypes: ["Unified"],
            resourceProvisioningOptions: ["Team"]
          }
        ],
        status: 200
      }
    ],
    "/servicePrincipals?$select=id,displayName,appId,servicePrincipalType,appRoles,deletedDateTime": [
      {
        value: [
          {
            id: "raw-sp-bot",
            displayName: "Automation Bot",
            appId: "raw-sp-app",
            servicePrincipalType: "Application",
            appRoles: []
          }
        ],
        status: 200
      }
    ],
    "/groups/raw-m365-group-1/members?$select=id,displayName,userPrincipalName,appId,servicePrincipalType": [
      {
        value: [
          { id: "raw-user-member", "@odata.type": "#microsoft.graph.user", displayName: "Member Example" },
          { id: "raw-sp-bot", "@odata.type": "#microsoft.graph.servicePrincipal", displayName: "Automation Bot" }
        ],
        status: 200
      }
    ],
    "/groups/raw-m365-group-1/owners?$select=id,displayName,userPrincipalName,appId,servicePrincipalType": [
      {
        value: ownerObjects,
        status: 200
      }
    ],
    "/servicePrincipals/raw-sp-bot/appRoleAssignedTo?$select=id,principalId,principalType,principalDisplayName,resourceId,resourceDisplayName,appRoleId,createdDateTime": [
      { value: [], status: 200 }
    ]
  }, {
    "/teams/raw-m365-group-1?$select=id,displayName,description,webUrl,isArchived,visibility": [
      {
        value: {
          id: "raw-m365-group-1",
          displayName: "Case Team",
          description: "Sensitive case collaboration",
          webUrl: "https://teams.example.test/raw-m365-group-1",
          isArchived: false,
          visibility: "Private"
        },
        status: 200
      }
    ]
  });
}

function createAuditEvent(eventId: string, occurredAt: string): AuditEvent {
  return {
    eventId,
    eventType: "connector.discovery",
    occurredAt,
    actor: "connector:microsoft-graph-entra-readonly",
    correlationId: `corr:${eventId}`,
    payloadHash: auditPayloadHash({}),
    payload: {}
  };
}

function createTwoSyncFixtureClient(): FixtureGraphClient {
  return new FixtureGraphClient({
    "/users?$select=id,displayName,userPrincipalName,accountEnabled,userType,externalUserState,deletedDateTime": [
      { value: [{ id: "raw-user-1", displayName: "Alice Example", accountEnabled: true, userType: "Member" }], status: 200 },
      { value: [{ id: "raw-user-1", displayName: "Alice Example", accountEnabled: true, userType: "Member" }], status: 200 }
    ],
    "/groups?$select=id,displayName,securityEnabled,mailEnabled,visibility,groupTypes,resourceProvisioningOptions,deletedDateTime": [
      { value: [{ id: "raw-group-1", displayName: "Case Reviewers", securityEnabled: true, groupTypes: [] }], status: 200 },
      { value: [{ id: "raw-group-1", displayName: "Case Reviewers", securityEnabled: true, groupTypes: [] }], status: 200 }
    ],
    "/servicePrincipals?$select=id,displayName,appId,servicePrincipalType,appRoles,deletedDateTime": [
      {
        value: [{
          id: "raw-sp-1",
          displayName: "Case Portal",
          appId: "raw-app-id",
          servicePrincipalType: "Application",
          appRoles: [{ id: "raw-role-reader", displayName: "Reader", value: "Reader" }]
        }],
        status: 200
      },
      {
        value: [{
          id: "raw-sp-1",
          displayName: "Case Portal",
          appId: "raw-app-id",
          servicePrincipalType: "Application",
          appRoles: [{ id: "raw-role-reader", displayName: "Reader", value: "Reader" }]
        }],
        status: 200
      }
    ],
    "/groups/raw-group-1/members?$select=id,displayName,userPrincipalName,appId,servicePrincipalType": [
      { value: [{ id: "raw-user-1", "@odata.type": "#microsoft.graph.user", displayName: "Alice Example" }], status: 200 },
      { value: [{ id: "raw-user-1", "@odata.type": "#microsoft.graph.user", displayName: "Alice Example" }], status: 200 }
    ],
    "/servicePrincipals/raw-sp-1/appRoleAssignedTo?$select=id,principalId,principalType,principalDisplayName,resourceId,resourceDisplayName,appRoleId,createdDateTime": [
      {
        value: [{
          id: "raw-assignment-1",
          principalId: "raw-group-1",
          principalType: "Group",
          resourceId: "raw-sp-1",
          appRoleId: "raw-role-reader"
        }],
        status: 200
      },
      { value: [], status: 200 }
    ]
  });
}
