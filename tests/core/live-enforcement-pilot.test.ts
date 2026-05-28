import { describe, expect, it } from "vitest";
import {
  assessLiveEnforcementPilotReadiness,
  type LiveEnforcementPilotManifest
} from "../../packages/core/src/live-enforcement-pilot.js";

describe("live enforcement pilot readiness", () => {
  it("marks the controlled Microsoft Graph revocation pilot ready when every gate is present", () => {
    const report = assessLiveEnforcementPilotReadiness(createManifest(), "2026-05-26T00:00:00.000Z");

    expect(report.status).toBe("ready");
    expect(report.checks.every((check) => check.status === "pass")).toBe(true);
    expect(report.checks.map((check) => check.name)).toEqual([
      "pilot_write_path_narrowly_scoped",
      "read_only_confidence_before_writes",
      "approval_workflow_release_gate",
      "runtime_blocks_degraded_enforcement",
      "verification_and_rollback_hooks",
      "operational_runbooks_present",
      "release_gate_ready_without_blockers"
    ]);
  });

  it("blocks live pilot writes when connector or audit health is degraded", () => {
    const report = assessLiveEnforcementPilotReadiness({
      ...createManifest(),
      runtimeGates: {
        ...createManifest().runtimeGates,
        connectorHealth: "degraded"
      }
    });

    expect(report.status).toBe("blocked");
    expect(report.checks).toContainEqual(expect.objectContaining({
      name: "runtime_blocks_degraded_enforcement",
      status: "fail"
    }));
  });

  it("blocks broad or high-risk pilot write paths", () => {
    const report = assessLiveEnforcementPilotReadiness({
      ...createManifest(),
      writePath: {
        ...createManifest().writePath,
        resourceRisk: "high"
      }
    });

    expect(report.status).toBe("blocked");
    expect(report.checks).toContainEqual(expect.objectContaining({
      name: "pilot_write_path_narrowly_scoped",
      status: "fail"
    }));
  });

  it("blocks pilot writes without explicit approved write scopes", () => {
    expectBlocked(
      {
        ...createManifest(),
        connector: {
          ...createManifest().connector,
          allowedWriteScopes: []
        }
      },
      "pilot_write_path_narrowly_scoped"
    );
  });

  it("blocks broad Microsoft Graph write scopes even when other gates pass", () => {
    expectBlocked(
      {
        ...createManifest(),
        connector: {
          ...createManifest().connector,
          allowedWriteScopes: ["Directory.ReadWrite.All"]
        }
      },
      "pilot_write_path_narrowly_scoped"
    );
  });

  it("blocks write scopes that are both allowed and forbidden", () => {
    expectBlocked(
      {
        ...createManifest(),
        connector: {
          ...createManifest().connector,
          forbiddenWriteScopes: [...createManifest().connector.forbiddenWriteScopes, "GroupMember.ReadWrite.All"]
        }
      },
      "pilot_write_path_narrowly_scoped"
    );
  });

  it("blocks pilot writes without enough read-only confidence", () => {
    expectBlocked(
      {
        ...createManifest(),
        readOnlyConfidence: {
          ...createManifest().readOnlyConfidence,
          successfulRuns: 2
        }
      },
      "read_only_confidence_before_writes"
    );
  });

  it("blocks approval workflows without distinct approver roles and incident gating", () => {
    expectBlocked(
      {
        ...createManifest(),
        approvalWorkflow: {
          ...createManifest().approvalWorkflow,
          requiredApproverRoles: ["resource-owner", "resource-owner"],
          incidentModeBlocksEnforcement: false
        }
      },
      "approval_workflow_release_gate"
    );
  });

  it("blocks pilot writes without required verification audit events", () => {
    expectBlocked(
      {
        ...createManifest(),
        verification: {
          ...createManifest().verification,
          auditEventTypes: ["connector.enforcement_readiness_checked"]
        }
      },
      "verification_and_rollback_hooks"
    );
  });

  it("blocks pilot writes when required operational runbooks are missing", () => {
    expectBlocked(
      {
        ...createManifest(),
        runbookRefs: ["runbooks/emergency-revocation.md"]
      },
      "operational_runbooks_present"
    );
  });

  it("blocks pilot writes with outstanding release blockers", () => {
    expectBlocked(
      {
        ...createManifest(),
        releaseGate: {
          ...createManifest().releaseGate,
          outstandingBlockers: ["assessor approval pending"]
        }
      },
      "release_gate_ready_without_blockers"
    );
  });
});

function expectBlocked(manifest: LiveEnforcementPilotManifest, checkName: string): void {
  const report = assessLiveEnforcementPilotReadiness(manifest, "2026-05-26T00:00:00.000Z");

  expect(report.status).toBe("blocked");
  expect(report.checks).toContainEqual(expect.objectContaining({
    name: checkName,
    status: "fail"
  }));
}

function createManifest(): LiveEnforcementPilotManifest {
  return {
    pilotId: "live-pilot:microsoft-graph-direct-grant-revocation",
    environment: "pilot_candidate",
    generatedAt: "2026-05-26T00:00:00.000Z",
    connector: {
      connectorId: "microsoft-graph-live-revocation",
      provider: "microsoft-graph",
      tenantBoundary: "tenant:pilot-redacted",
      mode: "enforcement",
      liveWritesOptIn: true,
      allowedWriteScopes: ["GroupMember.ReadWrite.All"],
      forbiddenWriteScopes: ["Directory.ReadWrite.All"],
      leastPrivilegeReviewRef: "deploy/live-enforcement-pilot/evidence/least-privilege-review.example.json"
    },
    writePath: {
      operation: "revoke_native_grant",
      scope: "single_resource_direct_grant",
      resourceRisk: "moderate",
      maxActionsPerChange: 1,
      revocationPriority: "emergency"
    },
    readOnlyConfidence: {
      minSuccessfulRuns: 3,
      successfulRuns: 3,
      maxEvidenceAgeHours: 24,
      evidenceAgeHours: 4,
      nativeReadbackVerified: true,
      driftFindingsReviewed: true,
      evidenceRefs: ["deploy/live-enforcement-pilot/evidence/read-only-confidence.example.json"]
    },
    approvalWorkflow: {
      requiredApproverRoles: ["resource-owner", "security-engineer"],
      minApprovers: 2,
      separationOfDuties: true,
      changeTicketPattern: "^chg:live-pilot:[a-z0-9_:-]+$",
      approvalExpiresMinutes: 30,
      breakGlassProhibited: true,
      incidentModeBlocksEnforcement: true,
      evidenceRef: "deploy/live-enforcement-pilot/evidence/approval-workflow.example.json"
    },
    runtimeGates: {
      connectorHealth: "healthy",
      auditHealth: "healthy",
      durableQueueRequired: true,
      immutableAuditRequired: true,
      adminAuthorizationRequired: true,
      healthSignalsRequired: true,
      degradedConnectorBlocksEnforcement: true,
      degradedAuditBlocksEnforcement: true,
      revocationsPrioritized: true,
      idempotencyRequired: true,
      readinessReportRequired: true,
      evidenceRefs: ["deploy/live-enforcement-pilot/evidence/runtime-gates.example.json"]
    },
    verification: {
      dryRunFirst: true,
      preWriteReadback: true,
      postWriteReadback: true,
      compensationRequired: true,
      rollbackPlanRef: "runbooks/policy-rollback.md",
      driftReconciliationRequired: true,
      auditEventTypes: [
        "connector.enforcement_readiness_checked",
        "provisioning.approved",
        "connector.permission_changed",
        "provisioning.rollback_available",
        "drift.finding_reviewed"
      ],
      evidenceRefs: ["deploy/live-enforcement-pilot/evidence/verification-rollback.example.json"]
    },
    runbookRefs: [
      "runbooks/emergency-revocation.md",
      "runbooks/connector-outage.md",
      "runbooks/decision-api-outage.md",
      "runbooks/policy-rollback.md"
    ],
    releaseGate: {
      status: "ready",
      readinessReportRef: "deploy/live-enforcement-pilot/readiness-report.example.json",
      releaseApprovalRef: "deploy/live-enforcement-pilot/evidence/release-approval.example.json",
      outstandingBlockers: []
    },
    evidenceRefs: [
      "deploy/live-enforcement-pilot/evidence/least-privilege-review.example.json",
      "deploy/live-enforcement-pilot/evidence/read-only-confidence.example.json"
    ],
    version: "live-enforcement-pilot-manifest:v1"
  };
}
