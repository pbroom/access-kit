import { describe, expect, it } from "vitest";
import { createRebacLocalApp, readNativeAccess, syncConnector } from "../../packages/api/src/local-app.js";
import { auditPayloadHash, type AuditEvent } from "../../packages/core/src/index.js";
import {
  SAMPLE_APPLICATION_RESOURCE_ID,
  SAMPLE_DOCUMENT_RESOURCE_ID,
  SAMPLE_READONLY_CONNECTOR_ID,
  SAMPLE_READONLY_REQUIRED_READ_SCOPES,
  SampleReadOnlyConnector,
  createDefaultSampleScenario,
  createSampleReadOnlyConnectorFromEnv,
  createSampleScenarioWithoutServiceGrant
} from "../../packages/connectors-sample-readonly/src/index.js";
import { validateConnectorSecurityGate } from "../../scripts/validate-connector-security-gate.js";

const now = "2026-05-26T12:00:00.000Z";

describe("SampleReadOnlyConnector", () => {
  it("maps synthetic provider fixtures into redacted subjects, resources, relationships, grants, and evidence", async () => {
    const connector = new SampleReadOnlyConnector({ now: () => now });

    const subjects = await connector.discoverSubjects();
    const resources = await connector.discoverResources();
    const relationships = await connector.discoverRelationships();
    const grants = [
      ...(await connector.readCurrentAccess(SAMPLE_APPLICATION_RESOURCE_ID)),
      ...(await connector.readCurrentAccess(SAMPLE_DOCUMENT_RESOURCE_ID))
    ];
    const metadata = connector.getDiscoveryMetadata();
    const evidence = await connector.emitEvidence([]);
    const serialized = JSON.stringify({ subjects, resources, relationships, grants, metadata, evidence });

    expect(subjects).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "user", sourceSystem: SAMPLE_READONLY_CONNECTOR_ID }),
      expect.objectContaining({ type: "group", sourceSystem: SAMPLE_READONLY_CONNECTOR_ID }),
      expect.objectContaining({ type: "service_principal", sourceSystem: SAMPLE_READONLY_CONNECTOR_ID })
    ]));
    expect(resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: SAMPLE_APPLICATION_RESOURCE_ID, lifecycleState: "active" }),
      expect.objectContaining({ id: SAMPLE_DOCUMENT_RESOURCE_ID, lifecycleState: "active" }),
      expect.objectContaining({ lifecycleState: "deleted" })
    ]));
    expect(relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({ relation: "member_of" }),
      expect.objectContaining({ relation: "assigned_to" }),
      expect.objectContaining({ relation: "contains" })
    ]));
    expect(grants).toEqual(expect.arrayContaining([
      expect.objectContaining({
        targetObjectId: SAMPLE_APPLICATION_RESOURCE_ID,
        nativePermission: "sample.app.read",
        grantType: "group",
        sourceConnectorId: SAMPLE_READONLY_CONNECTOR_ID
      }),
      expect.objectContaining({
        targetObjectId: SAMPLE_DOCUMENT_RESOURCE_ID,
        nativePermission: "sample.document.read",
        grantType: "inherited",
        sourceConnectorId: SAMPLE_READONLY_CONNECTOR_ID
      })
    ]));
    expect(metadata).toMatchObject({
      provider: "sample-provider",
      synthetic: true,
      requiredReadScopes: [...SAMPLE_READONLY_REQUIRED_READ_SCOPES],
      cursor: { deletedObjectBehavior: "mark_deleted" }
    });
    expect(metadata.warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining([
      "SAMPLE_PAGINATION_OBSERVED",
      "SAMPLE_THROTTLE_RETRIED",
      "SAMPLE_TOMBSTONE_OBSERVED"
    ]));
    expect(evidence.integrityManifest.packageHash).toMatch(/^sha256:/);
    expect(serialized).not.toContain("provider-user-alice");
    expect(serialized).not.toContain("alice@example.test");
    expect(serialized).not.toContain("provider-app-case-review");
    expect(serialized).not.toContain("raw-subject-cursor-page-2");
    expect(serialized).not.toContain("raw-grant-cursor-page-2");
  });

  it("records read-only sync evidence and replaces stale native grants on repeat sync", async () => {
    const app = createRebacLocalApp({ now: () => now });
    app.connectors.set(SAMPLE_READONLY_CONNECTOR_ID, new SampleReadOnlyConnector({
      now: () => now,
      scenarios: [createDefaultSampleScenario(), createSampleScenarioWithoutServiceGrant()]
    }));

    const first = await syncConnector(app, SAMPLE_READONLY_CONNECTOR_ID, "read_only");
    const firstApplicationGrants = readNativeAccess(app, SAMPLE_APPLICATION_RESOURCE_ID, {
      sourceConnectorId: SAMPLE_READONLY_CONNECTOR_ID
    });
    const second = await syncConnector(app, SAMPLE_READONLY_CONNECTOR_ID, "read_only");
    const secondApplicationGrants = readNativeAccess(app, SAMPLE_APPLICATION_RESOURCE_ID, {
      sourceConnectorId: SAMPLE_READONLY_CONNECTOR_ID
    });

    expect(first.status).toBe("completed_with_warnings");
    expect(first.counts).toMatchObject({ subjects: 3, resources: 3, nativeGrants: 3 });
    expect(first.warnings.map((warning) => warning.code)).toContain("SAMPLE_TOMBSTONE_OBSERVED");
    expect(first.evidence).toMatchObject({ readOnly: true, nativeAccessReadback: true });
    expect(firstApplicationGrants).toHaveLength(2);
    expect(firstApplicationGrants.map((grant) => grant.principalType)).toEqual(expect.arrayContaining(["group", "service_principal"]));
    expect(second.counts).toMatchObject({ nativeGrants: 2 });
    expect(secondApplicationGrants).toHaveLength(1);
    expect(secondApplicationGrants.map((grant) => grant.principalType)).toEqual(["group"]);
  });

  it("derives connector evidence periods from source audit events and falls back to now", async () => {
    const connector = new SampleReadOnlyConnector({ now: () => now });

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

  it("keeps provisioning hooks dry-run and fail-closed", async () => {
    const connector = new SampleReadOnlyConnector({ now: () => now });
    const review = connector.getSecurityReview();
    const plan = await connector.planProvisioningChange({
      decisionId: "decision:sample-write-probe",
      decision: "allow",
      subjectId: "user:sample-probe",
      action: "read",
      resourceId: SAMPLE_APPLICATION_RESOURCE_ID,
      reasonCode: "ALLOW_SAMPLE_PROBE",
      policyVersion: "policy:v1",
      relationshipVersion: "relationships:v1",
      modelVersion: "model:v1",
      tupleVersion: "tuple:v1",
      contextVersion: "context:none",
      relationshipPath: [],
      constraints: {},
      evaluatedAt: now,
      asOf: now
    });

    expect(connector.capabilities.supportsProvisioning).toBe(false);
    expect(review).toMatchObject({
      enforcement: {
        liveWritesAllowed: false,
        controlledSyntheticOnly: false,
        readinessRequired: true
      },
      secrets: {
        storesSecrets: false,
        handling: "none"
      }
    });
    expect(plan.mode).toBe("dry_run");
    expect(plan.actions.every((action) => action.dryRun && action.compensation?.status === "planned")).toBe(true);
    const failedPlan = await connector.applyProvisioningChange(plan);
    expect(failedPlan).toMatchObject({ status: "failed" });
    expect(failedPlan.actions.every((action) => action.status === "failed" && action.verification.status === "failed")).toBe(true);
    await expect(connector.verifyProvisioningChange(plan)).resolves.toBe(false);
  });

  it("resolves dry-run revocation plans from the fixture grant index", async () => {
    const connector = new SampleReadOnlyConnector({ now: () => now });
    const [documentGrant] = await connector.readCurrentAccess(SAMPLE_DOCUMENT_RESOURCE_ID);

    await expect(connector.revokeAccess(documentGrant!.id)).resolves.toMatchObject({
      resourceId: SAMPLE_DOCUMENT_RESOURCE_ID,
      actions: [
        expect.objectContaining({
          targetObjectId: SAMPLE_DOCUMENT_RESOURCE_ID,
          requestedState: { nativeGrantId: documentGrant!.id, status: "revoked" }
        })
      ]
    });
    await expect(connector.revokeAccess("native-grant:sample:missing")).rejects.toThrow("cannot resolve resource");
  });

  it("fails explicitly for empty fixtures and reports configured page caps", async () => {
    const scenario = createDefaultSampleScenario();
    const connector = new SampleReadOnlyConnector({
      now: () => now,
      maxPages: 2,
      scenarios: [
        {
          ...scenario,
          subjectPages: [
            ...scenario.subjectPages,
            {
              items: [
                {
                  rawId: "provider-user-after-page-cap",
                  kind: "user",
                  safeDisplayName: "Sample Page Cap User"
                }
              ]
            }
          ]
        }
      ]
    });

    await expect(() => new SampleReadOnlyConnector({ scenarios: [] })).toThrow("at least one scenario");
    await expect(connector.discoverSubjects()).resolves.toHaveLength(3);
    expect(connector.getDiscoveryMetadata().warnings.map((warning) => warning.code)).toContain("SAMPLE_PAGE_LIMIT_REACHED");
  });

  it("fails closed on ambiguous boundaries and passes the connector security gate when registered intentionally", async () => {
    const app = createRebacLocalApp({ now: () => now });
    const connector = new SampleReadOnlyConnector({ now: () => now });
    app.connectors.set(SAMPLE_READONLY_CONNECTOR_ID, connector);

    expect(() => new SampleReadOnlyConnector({ tenantBoundary: "synthetic:unknown" })).toThrow("explicit tenant boundary");
    expect(createSampleReadOnlyConnectorFromEnv({ REBAC_SAMPLE_READONLY_ENABLED: "true" })).toBeUndefined();
    expect(createSampleReadOnlyConnectorFromEnv({
      REBAC_SAMPLE_READONLY_ENABLED: "true",
      REBAC_SAMPLE_READONLY_TENANT_BOUNDARY: "synthetic:sample:tenant"
    })).toBeInstanceOf(SampleReadOnlyConnector);
    await expect(validateConnectorSecurityGate(app)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ connectorId: SAMPLE_READONLY_CONNECTOR_ID })
    ]));
  });
});

function createAuditEvent(eventId: string, occurredAt: string): AuditEvent {
  return {
    eventId,
    eventType: "connector.discovery",
    occurredAt,
    actor: `connector:${SAMPLE_READONLY_CONNECTOR_ID}`,
    correlationId: `corr:${eventId}`,
    payloadHash: auditPayloadHash({}),
    payload: {}
  };
}
