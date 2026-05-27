import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  AWS_READONLY_ACCESS_ANALYSIS_CONNECTOR_ID,
  AWS_READONLY_ACCESS_ANALYSIS_REQUIRED_READ_SCOPES,
  AwsReadOnlyAccessAnalysisConnector,
  JsonAwsReadClient,
  awsReadClientKey,
  type AwsReadClientPages
} from "../../packages/connectors-aws/src/index.js";
import { auditPayloadHash, type AuditEvent } from "../../packages/core/src/index.js";
import { createRuntimeConnectors } from "../../packages/api/src/runtime-connectors.js";
import {
  createRebacLocalApp,
  listDiscoveryRuns,
  readNativeAccess,
  runReconciliation,
  syncConnector
} from "../../packages/api/src/local-app.js";
import { validateConnectorSecurityGate } from "../../scripts/validate-connector-security-gate.js";

const now = "2026-05-26T12:00:00.000Z";
const organizationId = "o-rawexample";
const rawAccountId = "123456789012";
const rawSuspendedAccountId = "210987654321";
const rawPermissionSetArn = "arn:aws:sso:::permissionSet/ssoins-raw/ps-raw-reader";
const rawRoleArn = "arn:aws:iam::123456789012:role/CaseReadOnly";
const rawGroupPrincipal = "principal-group-raw";
const noSleep = async (): Promise<void> => {};

describe("AwsReadOnlyAccessAnalysisConnector", () => {
  it("uses a stable pre-discovery cursor before source readback starts", () => {
    let nowCall = 0;
    const connector = new AwsReadOnlyAccessAnalysisConnector({
      client: new JsonAwsReadClient(createFixturePages()),
      organizationId,
      now: () => `2026-05-26T12:00:0${nowCall++}.000Z`
    });

    expect(connector.getDiscoveryMetadata().cursor).toEqual({
      startedFrom: "cursor:aws:initial",
      highWatermark: "cursor:aws:pre-discovery",
      deletedObjectBehavior: "mark_deleted"
    });
    expect(connector.getDiscoveryMetadata().cursor).toEqual({
      startedFrom: "cursor:aws:initial",
      highWatermark: "cursor:aws:pre-discovery",
      deletedObjectBehavior: "mark_deleted"
    });
  });

  it("reuses the AWS readback snapshot across discovery entrypoints", async () => {
    const client = new JsonAwsReadClient(createFixturePages());
    const connector = new AwsReadOnlyAccessAnalysisConnector({
      client,
      organizationId,
      now: () => now,
      maxRetries: 1,
      sleep: noSleep
    });

    await connector.discoverSubjects();
    const callsAfterFirstDiscovery = client.calls.length;

    await connector.discoverSubjects();
    await connector.discoverResources();
    await connector.detectDrift();

    expect(client.calls).toHaveLength(callsAfterFirstDiscovery);
  });

  it("imports redacted AWS accounts, roles, Identity Center assignments, CloudTrail activity, and Access Analyzer findings", async () => {
    const sleeps: number[] = [];
    const connector = new AwsReadOnlyAccessAnalysisConnector({
      client: new JsonAwsReadClient(createFixturePages()),
      organizationId,
      now: () => now,
      maxRetries: 1,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      }
    });

    const subjects = await connector.discoverSubjects();
    const resources = await connector.discoverResources();
    const relationships = await connector.discoverRelationships();
    const account = resources.find((resource) => resource.type === "aws_account" && resource.lifecycleState === "active");
    const grants = await connector.readCurrentAccess(account!.id);
    const findings = await connector.detectDrift();
    const metadata = connector.getDiscoveryMetadata();
    const serialized = JSON.stringify({ subjects, resources, relationships, grants, findings, metadata });

    expect(subjects).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "group", sourceSystem: AWS_READONLY_ACCESS_ANALYSIS_CONNECTOR_ID }),
      expect.objectContaining({ type: "user", sourceSystem: AWS_READONLY_ACCESS_ANALYSIS_CONNECTOR_ID }),
      expect.objectContaining({ type: "service_account", sourceSystem: AWS_READONLY_ACCESS_ANALYSIS_CONNECTOR_ID })
    ]));
    expect(resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "organization", sourceSystem: AWS_READONLY_ACCESS_ANALYSIS_CONNECTOR_ID }),
      expect.objectContaining({ type: "aws_account", lifecycleState: "active" }),
      expect.objectContaining({ type: "aws_account", lifecycleState: "suspended" }),
      expect.objectContaining({ type: "aws_role" })
    ]));
    expect(relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({ relation: "contains" }),
      expect.objectContaining({ relation: "defines_permission_set" }),
      expect.objectContaining({ relation: "assigned_account_access" }),
      expect.objectContaining({ relation: "assigned_permission_set" })
    ]));
    expect(grants).toEqual([
      expect.objectContaining({
        nativePermission: "sso:CaseReadOnly",
        grantType: "group",
        principalType: "group",
        sourceConnectorId: AWS_READONLY_ACCESS_ANALYSIS_CONNECTOR_ID,
        attributes: expect.objectContaining({
          cloudTrailActivity: expect.objectContaining({
            eventName: "AssumeRoleWithSAML",
            lastActivityAt: "2026-05-26T11:45:00.000Z",
            redacted: true
          }),
          redacted: true
        })
      })
    ]);
    expect(findings).toEqual([
      expect.objectContaining({
        severity: "critical",
        recommendedAction: "revoke",
        sourceConnectorId: AWS_READONLY_ACCESS_ANALYSIS_CONNECTOR_ID
      })
    ]);
    expect(metadata).toMatchObject({
      provider: "aws",
      synthetic: false,
      requiredReadScopes: [...AWS_READONLY_ACCESS_ANALYSIS_REQUIRED_READ_SCOPES],
      cursor: { deletedObjectBehavior: "mark_deleted" }
    });
    expect(metadata.warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining([
      "AWS_SANDBOX_EVIDENCE_REQUIRED",
      "AWS_PAGINATION_OBSERVED",
      "AWS_THROTTLE_RETRIED",
      "AWS_TOMBSTONE_MARKED",
      "AWS_ACCESS_ANALYZER_FINDINGS_OBSERVED"
    ]));
    expect(sleeps).toEqual([2000]);
    expect(serialized).not.toContain(organizationId);
    expect(serialized).not.toContain(rawAccountId);
    expect(serialized).not.toContain(rawPermissionSetArn);
    expect(serialized).not.toContain(rawRoleArn);
    expect(serialized).not.toContain(rawGroupPrincipal);
    expect(serialized).not.toContain("raw-account-page-2");
    expect(serialized).not.toContain("raw-event-1");
    expect(serialized).not.toContain("case-prod@example.test");
  });

  it("upgrades throttled readback warnings when retries are exhausted", async () => {
    const pages = createFixturePages();
    pages[awsReadClientKey("ssoAdmin.listAccountAssignments", {
      accountId: rawAccountId,
      permissionSetArn: rawPermissionSetArn
    })] = [
      { value: [], status: 429, retryAfterSeconds: 1, requestId: "raw-request-id-1" },
      { value: [], status: 429, retryAfterSeconds: 1, requestId: "raw-request-id-2" }
    ];
    const sleeps: number[] = [];
    const connector = new AwsReadOnlyAccessAnalysisConnector({
      client: new JsonAwsReadClient(pages),
      organizationId,
      now: () => now,
      maxRetries: 1,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      }
    });

    await connector.discoverSubjects();

    expect(connector.getDiscoveryMetadata().warnings.filter((warning) => warning.code === "AWS_THROTTLE_RETRIED")).toEqual([
      expect.objectContaining({
        scope: "native_grants",
        severity: "warning",
        retryable: false
      })
    ]);
    expect(sleeps).toEqual([1000]);
  });

  it("skips Access Analyzer findings outside imported AWS resources", async () => {
    const pages: AwsReadClientPages = {
      ...createFixturePages(),
      "accessAnalyzer.listFindings": [
        {
          value: [{
            id: "raw-finding-unknown-resource",
            resource: "arn:aws:iam::999999999999:role/OutsideImportedBoundary",
            principal: { AWS: "999999999999" },
            action: ["sts:AssumeRole"],
            status: "ACTIVE",
            findingType: "ExternalAccess",
            isPublic: true,
            createdAt: "2026-05-26T10:00:00.000Z"
          }],
          status: 200
        }
      ]
    };
    const connector = new AwsReadOnlyAccessAnalysisConnector({
      client: new JsonAwsReadClient(pages),
      organizationId,
      now: () => now,
      maxRetries: 1,
      sleep: noSleep
    });

    await expect(connector.detectDrift()).resolves.toEqual([]);
    expect(connector.getDiscoveryMetadata().warnings.map((warning) => warning.code)).toContain("AWS_ACCESS_ANALYZER_FINDING_SKIPPED");
  });

  it("keeps AWS provider writes disabled even when provisioning hooks are called", async () => {
    const connector = new AwsReadOnlyAccessAnalysisConnector({
      client: new JsonAwsReadClient(createFixturePages()),
      organizationId,
      now: () => now,
      sleep: noSleep
    });
    const review = connector.getSecurityReview();
    const plan = await connector.planProvisioningChange({
      decisionId: "decision:aws-write-probe",
      decision: "allow",
      subjectId: "group:probe",
      action: "sts:AssumeRole",
      resourceId: "aws-account:probe",
      reasonCode: "ALLOW_PROBE",
      policyVersion: "policy:v1",
      relationshipVersion: "relationships:v1",
      relationshipPath: [],
      constraints: {},
      evaluatedAt: now
    });

    expect(connector.capabilities.supportsProvisioning).toBe(false);
    expect(review).toMatchObject({
      synthetic: false,
      identity: { kind: "role" },
      consent: { status: "approved" },
      enforcement: { liveWritesAllowed: false }
    });
    expect(plan.mode).toBe("dry_run");
    expect(plan.actions.every((action) => action.dryRun && action.compensation?.status === "planned")).toBe(true);
    await expect(connector.applyProvisioningChange(plan)).resolves.toMatchObject({ status: "failed" });
  });

  it("passes the connector security gate as an approved live-read AWS connector", async () => {
    const app = createRebacLocalApp({ now: () => now });
    app.connectors.set(AWS_READONLY_ACCESS_ANALYSIS_CONNECTOR_ID, new AwsReadOnlyAccessAnalysisConnector({
      client: new JsonAwsReadClient(createFixturePages()),
      organizationId,
      now: () => now,
      sleep: noSleep,
      sandboxEvidenceRef: "reports/aws-readonly-sandbox-fixture.json"
    }));

    await expect(validateConnectorSecurityGate(app)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ connectorId: AWS_READONLY_ACCESS_ANALYSIS_CONNECTOR_ID })
    ]));
  });

  it("records AWS discovery warnings, native grants, and Access Analyzer drift through runtime paths", async () => {
    const app = createRebacLocalApp({ now: () => now });
    const connector = new AwsReadOnlyAccessAnalysisConnector({
      client: new JsonAwsReadClient(createFixturePages()),
      organizationId,
      now: () => now,
      sleep: noSleep
    });
    app.connectors.set(AWS_READONLY_ACCESS_ANALYSIS_CONNECTOR_ID, connector);

    const run = await syncConnector(app, AWS_READONLY_ACCESS_ANALYSIS_CONNECTOR_ID, "read_only");
    const accountId = runNativeAccessResourceId(app);
    const grants = readNativeAccess(app, accountId);
    const reconciliation = await runReconciliation(app, AWS_READONLY_ACCESS_ANALYSIS_CONNECTOR_ID);

    expect(run.status).toBe("completed_with_warnings");
    expect(run.counts).toMatchObject({
      subjects: 3,
      resources: 5,
      nativeGrants: 2,
      warnings: expect.any(Number)
    });
    expect(run.evidence).toMatchObject({ readOnly: true, nativeAccessReadback: true });
    expect(listDiscoveryRuns(app, { connectorId: AWS_READONLY_ACCESS_ANALYSIS_CONNECTOR_ID })).toEqual([
      expect.objectContaining({ id: run.id, status: "completed_with_warnings" })
    ]);
    expect(grants).toEqual([
      expect.objectContaining({ nativePermission: "sso:CaseReadOnly", sourceConnectorId: AWS_READONLY_ACCESS_ANALYSIS_CONNECTOR_ID })
    ]);
    expect(reconciliation.counts).toEqual({ findings: 1, highOrCritical: 1 });
    expect(JSON.stringify({ grants, reconciliation })).not.toContain(rawAccountId);
    expect(JSON.stringify({ grants, reconciliation })).not.toContain(rawRoleArn);
  });

  it("registers the AWS connector only when redacted sandbox fixture configuration is present", () => {
    expect(createRuntimeConnectors({ env: {} }).has(AWS_READONLY_ACCESS_ANALYSIS_CONNECTOR_ID)).toBe(false);

    const dir = mkdtempSync(join(tmpdir(), "access-kit-aws-fixture-"));
    const fixturePath = join(dir, "aws-readonly-fixture.json");
    try {
      writeFileSync(fixturePath, JSON.stringify({ pages: createFixturePages() }), "utf8");
      const connectors = createRuntimeConnectors({
        env: {
          REBAC_AWS_READONLY_ACCESS_ANALYSIS_ENABLED: "true",
          REBAC_AWS_ORGANIZATION_ID: organizationId,
          REBAC_AWS_READONLY_FIXTURE_FILE: fixturePath,
          REBAC_AWS_SANDBOX_EVIDENCE: "reports/aws-readonly-sandbox-fixture.json"
        }
      });

      expect(connectors.has(AWS_READONLY_ACCESS_ANALYSIS_CONNECTOR_ID)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("derives connector evidence periods from source audit events and falls back to now", async () => {
    const connector = new AwsReadOnlyAccessAnalysisConnector({
      client: new JsonAwsReadClient(createFixturePages()),
      organizationId,
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
});

function runNativeAccessResourceId(app: ReturnType<typeof createRebacLocalApp>): string {
  const account = app.store.listResources().find((resource) => resource.type === "aws_account" && resource.lifecycleState === "active");
  if (!account) {
    throw new Error("Expected synced active AWS account resource");
  }

  return account.id;
}

function createFixturePages(): AwsReadClientPages {
  return {
    "organizations.describeOrganization": [
      {
        value: [{
          id: organizationId,
          arn: "arn:aws:organizations::111111111111:organization/o-rawexample",
          managementAccountId: "111111111111",
          featureSet: "ALL"
        }],
        status: 200
      }
    ],
    "organizations.listAccounts": [
      {
        value: [{
          id: rawAccountId,
          arn: "arn:aws:organizations::111111111111:account/o-rawexample/123456789012",
          name: "Case Production",
          email: "case-prod@example.test",
          status: "ACTIVE",
          joinedTimestamp: "2026-04-01T00:00:00.000Z"
        }],
        nextToken: "raw-account-page-2",
        status: 200
      }
    ],
    [awsReadClientKey("organizations.listAccounts", { nextToken: "raw-account-page-2" })]: [
      {
        value: [{
          id: rawSuspendedAccountId,
          name: "Suspended Workload",
          status: "SUSPENDED"
        }],
        status: 200
      }
    ],
    "ssoAdmin.listPermissionSets": [
      {
        value: [{
          arn: rawPermissionSetArn,
          name: "CaseReadOnly",
          sessionDuration: "PT4H",
          createdDate: "2026-04-15T00:00:00.000Z"
        }],
        status: 200
      }
    ],
    "iam.listRoles": [
      {
        value: [{
          arn: rawRoleArn,
          roleName: "CaseReadOnly",
          roleId: "AROARAWROLEID",
          accountId: rawAccountId,
          maxSessionDuration: 14400,
          createDate: "2026-04-15T00:00:00.000Z"
        }],
        status: 200
      }
    ],
    [awsReadClientKey("ssoAdmin.listAccountAssignments", {
      accountId: rawAccountId,
      permissionSetArn: rawPermissionSetArn
    })]: [
      { value: [], status: 429, retryAfterSeconds: 2, requestId: "raw-request-id" },
      {
        value: [{
          accountId: rawAccountId,
          permissionSetArn: rawPermissionSetArn,
          principalId: rawGroupPrincipal,
          principalType: "GROUP",
          createdDate: "2026-05-20T00:00:00.000Z"
        }],
        status: 200
      }
    ],
    [awsReadClientKey("ssoAdmin.listAccountAssignments", {
      accountId: rawSuspendedAccountId,
      permissionSetArn: rawPermissionSetArn
    })]: [
      {
        value: [{
          accountId: rawSuspendedAccountId,
          permissionSetArn: rawPermissionSetArn,
          principalId: "principal-user-raw",
          principalType: "USER",
          status: "DELETED",
          deletedDateTime: "2026-05-22T00:00:00.000Z"
        }],
        status: 200
      }
    ],
    "cloudTrail.lookupEvents": [
      {
        value: [{
          eventId: "raw-event-1",
          eventTime: "2026-05-26T11:45:00.000Z",
          eventName: "AssumeRoleWithSAML",
          username: "case-operator@example.test",
          recipientAccountId: rawAccountId,
          readOnly: false,
          resources: [
            { resourceName: rawRoleArn, resourceType: "AWS::IAM::Role" },
            { resourceName: rawPermissionSetArn, resourceType: "AWS::SSO::PermissionSet" }
          ]
        }],
        status: 200
      }
    ],
    "accessAnalyzer.listFindings": [
      {
        value: [{
          id: "raw-finding-1",
          analyzerArn: "arn:aws:access-analyzer:us-east-1:123456789012:analyzer/org",
          resource: rawRoleArn,
          resourceType: "AWS::IAM::Role",
          principal: { AWS: "999999999999" },
          action: ["sts:AssumeRole"],
          status: "ACTIVE",
          findingType: "ExternalAccess",
          isPublic: true,
          createdAt: "2026-05-26T10:00:00.000Z",
          updatedAt: "2026-05-26T11:00:00.000Z"
        }],
        status: 200
      }
    ]
  };
}

function createAuditEvent(eventId: string, occurredAt: string): AuditEvent {
  return {
    eventId,
    eventType: "connector.discovery",
    occurredAt,
    actor: "connector:aws-readonly-access-analysis",
    correlationId: `corr:${eventId}`,
    payloadHash: auditPayloadHash({}),
    payload: {}
  };
}
