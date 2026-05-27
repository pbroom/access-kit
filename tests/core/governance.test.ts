import { describe, expect, it } from "vitest";
import {
  buildAccessReviewGovernance,
  type AccessReviewCampaign,
  type DriftFinding
} from "../../packages/core/src/index.js";

const now = "2026-05-21T17:00:00.000Z";

describe("access review governance", () => {
  it("does not synthesize completed owner approval from observed activity alone", () => {
    const records = buildAccessReviewGovernance({
      generatedAt: now,
      subjectCount: 1,
      resourceCount: 1,
      sourceEventIds: ["audit:event:decision-allow"],
      driftFindings: []
    });

    expect(records.campaigns).toHaveLength(1);
    expect(records.campaigns[0]?.status).toBe("active");
    expect(records.campaigns[0]?.completedAt).toBeUndefined();
    expect(records.campaigns[0]?.ownerApprovals).toEqual([
      expect.objectContaining({ decision: "pending" })
    ]);
    expect(records.campaigns[0]?.ownerApprovals[0]?.decidedAt).toBeUndefined();
  });

  it("preserves explicit owner approval as campaign completion evidence", () => {
    const approvedCampaign: AccessReviewCampaign = {
      id: "access-review:campaign:local-governance",
      name: "Local access review and exception governance campaign",
      scope: "local",
      ownerRole: "Data Owner",
      reviewerRole: "Data Steward",
      status: "completed",
      startedAt: now,
      dueAt: "2026-06-20T17:00:00.000Z",
      completedAt: now,
      subjectCount: 1,
      resourceCount: 1,
      findingIds: [],
      exceptionRequestIds: [],
      remediationItemIds: [],
      sourceEventIds: ["audit:event:decision-allow"],
      ownerApprovals: [
        {
          approverRole: "Data Owner",
          decision: "approved",
          decidedAt: now,
          evidenceRefs: ["ticket:access-review-approval"]
        }
      ],
      version: "access-review-campaign:v1",
      createdAt: now,
      updatedAt: now
    };

    const records = buildAccessReviewGovernance({
      generatedAt: now,
      subjectCount: 1,
      resourceCount: 1,
      sourceEventIds: ["audit:event:decision-allow"],
      driftFindings: [],
      existingCampaigns: [approvedCampaign]
    });

    expect(records.campaigns[0]).toMatchObject({
      status: "completed",
      completedAt: now,
      ownerApprovals: approvedCampaign.ownerApprovals
    });
  });

  it("excludes remediated findings from campaign remediation item references", () => {
    const records = buildAccessReviewGovernance({
      generatedAt: now,
      subjectCount: 2,
      resourceCount: 2,
      sourceEventIds: ["audit:event:reconciliation"],
      driftFindings: [
        createDriftFinding({
          id: "drift:open-finding",
          resourceId: "document:case-plan"
        }),
        createDriftFinding({
          id: "drift:remediated-finding",
          resourceId: "document:closed-case-plan",
          status: "resolved"
        })
      ]
    });
    const campaign = records.campaigns[0];

    expect(campaign?.findingIds).toEqual(expect.arrayContaining([
      "governance-finding:drift:open-finding",
      "governance-finding:drift:remediated-finding"
    ]));
    expect(records.findings.find((finding) => finding.id === "governance-finding:drift:remediated-finding")?.status).toBe("remediated");
    expect(campaign?.remediationItemIds).toEqual(["poam:governance:drift:open-finding"]);
  });
});

function createDriftFinding(overrides: Partial<DriftFinding> = {}): DriftFinding {
  return {
    id: "drift:governance-finding",
    resourceId: "document:case-plan",
    subjectId: "user:alice",
    nativeAccess: "owner",
    intendedAccess: "none",
    severity: "high",
    lifecycleState: "open",
    ownerId: "role:security-operations",
    assigneeId: "role:security-engineer",
    detectedAt: now,
    sourceConnectorId: "mock",
    recommendedAction: "revoke",
    status: "open",
    scheduledReconciliation: {
      cadence: "daily",
      scheduledAt: now,
      nextRunAt: "2026-05-22T17:00:00.000Z",
      gracePeriodHours: 24,
      overdue: false
    },
    hookEvidence: [],
    remediation: {},
    autoRepairPolicy: {
      enabled: false,
      allowedActions: ["revoke", "repair", "review"],
      maxSeverity: "high",
      requireApproval: true,
      requireConnectorReadiness: true,
      liveProviderWrites: false
    },
    version: "drift:v1",
    createdAt: now,
    ...overrides
  };
}
