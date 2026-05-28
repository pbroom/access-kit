import { describe, expect, it } from "vitest";
import {
  MICROSOFT_GRAPH_ENTRA_CONNECTOR_ID,
  MICROSOFT_GRAPH_ENTRA_REQUIRED_READ_SCOPES,
  MicrosoftGraphEntraReadOnlyConnector
} from "../../packages/connectors-microsoft-graph/src/index.js";
import {
  createFixtureClient,
  noSleep,
  now
} from "./microsoft-graph-fixtures.js";

describe("MicrosoftGraphEntraReadOnlyConnector Entra discovery", () => {
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

  it("consolidates Microsoft provider semantic gaps as warnings instead of canonical access", async () => {
    const connector = new MicrosoftGraphEntraReadOnlyConnector({
      client: createFixtureClient(),
      tenantId: "tenant-live-123",
      now: () => now,
      sleep: noSleep,
      sandboxEvidenceRef: "reports/microsoft-graph-provider-semantics-sandbox-fixture.json"
    });

    const subjects = await connector.discoverSubjects();
    const relationships = await connector.discoverRelationships();
    const metadata = connector.getDiscoveryMetadata();
    const findings = await connector.detectDrift();

    expect(subjects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "user",
        attributes: expect.objectContaining({ external: true })
      })
    ]));
    expect(relationships.map((relationship) => relationship.relation)).not.toEqual(expect.arrayContaining([
      "power_platform_role",
      "dataverse_role"
    ]));
    expect(metadata.warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining([
      "GRAPH_CHANGE_NOTIFICATION_DELIVERY_UNSUPPORTED",
      "GRAPH_POWER_PLATFORM_DATAVERSE_ROLE_MAPPING_UNSUPPORTED"
    ]));
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        nativeAccess: "GRAPH_CHANGE_NOTIFICATION_DELIVERY_UNSUPPORTED",
        intendedAccess: "complete_provider_coverage",
        sourceConnectorId: MICROSOFT_GRAPH_ENTRA_CONNECTOR_ID
      }),
      expect.objectContaining({
        nativeAccess: "GRAPH_POWER_PLATFORM_DATAVERSE_ROLE_MAPPING_UNSUPPORTED",
        intendedAccess: "complete_provider_coverage",
        sourceConnectorId: MICROSOFT_GRAPH_ENTRA_CONNECTOR_ID
      })
    ]));
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
    const failedPlan = await connector.applyProvisioningChange(plan);
    expect(failedPlan).toMatchObject({ status: "failed" });
    expect(failedPlan.actions.every((action) => action.status === "failed" && action.verification.status === "failed")).toBe(true);
  });
});
