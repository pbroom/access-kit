import { describe, expect, it } from "vitest";
import {
  buildAccessReviewGovernance,
  type AccessReviewCampaign
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
});
