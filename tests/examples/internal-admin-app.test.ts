import { describe, expect, it } from "vitest";
import {
  assessAdminAuthorizationReadiness,
  createLocalBearerTokenAdminAuthorizationDescriptor
} from "../../packages/core/src/index.js";
import {
  createSampleAdminAuthorizationDescriptor,
  createSampleInternalAdminApplication,
  sampleAccessReviewContext,
  sampleApprovalEvidence,
  sampleBreakGlassApprovalEvidence,
  sampleExplainRequest
} from "../../examples/internal-admin-app/app.js";

describe("sample internal admin application", () => {
  it("requires production admin controls before serving admin actions", () => {
    const productionReport = assessAdminAuthorizationReadiness(
      createSampleAdminAuthorizationDescriptor(),
      "2026-05-26T14:00:00.000Z"
    );
    const localReport = assessAdminAuthorizationReadiness(
      createLocalBearerTokenAdminAuthorizationDescriptor(),
      "2026-05-26T14:00:00.000Z"
    );

    expect(productionReport.status).toBe("ready");
    expect(localReport.status).toBe("blocked");

    const app = createSampleInternalAdminApplication({
      adminDescriptor: createLocalBearerTokenAdminAuthorizationDescriptor()
    });

    expect(app.handle({
      action: "view_access_review",
      accessReview: sampleAccessReviewContext,
      session: session("user:admin-operator", "corr:local-admin-blocked")
    })).toMatchObject({
      status: "denied",
      reasonCode: "ADMIN_CONTROLS_NOT_READY"
    });
  });

  it("allows a scoped operator to view access-review context with audit traceability", () => {
    const app = createSampleInternalAdminApplication();
    const result = app.handle({
      action: "view_access_review",
      accessReview: sampleAccessReviewContext,
      session: session("user:admin-operator", "corr:operator-review")
    });

    expect(result).toMatchObject({
      status: "allowed",
      reasonCode: "ADMIN_ACTION_ALLOWED",
      accessReview: {
        reviewId: sampleAccessReviewContext.reviewId,
        resourceId: "document:case-plan"
      },
      adminDecision: {
        decision: "allow",
        reasonCode: "ALLOW_VIA_RELATIONSHIP_PATH"
      }
    });
    expect(result.auditEventIds.length).toBeGreaterThanOrEqual(2);
    expect(app.listAuditEvents().map((event) => event.eventType)).toEqual([
      "decision.allowed",
      "admin.action"
    ]);
  });

  it("does not let application authorization become admin authorization", () => {
    const app = createSampleInternalAdminApplication();
    const result = app.handle({
      action: "view_access_review",
      accessReview: sampleAccessReviewContext,
      session: session("user:alice", "corr:app-user-admin-denied")
    });

    expect(result).toMatchObject({
      status: "denied",
      reasonCode: "DENY_DEFAULT_NO_RELATIONSHIP_PATH",
      adminDecision: {
        decision: "deny"
      }
    });
    expect(app.listAuditEvents().map((event) => event.eventType)).toEqual([
      "decision.denied",
      "admin.action_denied"
    ]);
  });

  it("requires approval evidence before safe explain and redacts relationship paths", () => {
    const app = createSampleInternalAdminApplication();

    expect(app.handle({
      action: "explain_subject_access",
      accessReview: sampleAccessReviewContext,
      explainRequest: sampleExplainRequest,
      session: session("user:access-auditor", "corr:explain-needs-approval")
    })).toMatchObject({
      status: "needs_approval",
      reasonCode: "APPROVAL_EVIDENCE_REQUIRED"
    });

    const result = app.handle({
      action: "explain_subject_access",
      accessReview: sampleAccessReviewContext,
      approval: sampleApprovalEvidence,
      explainRequest: sampleExplainRequest,
      session: session("user:access-auditor", "corr:explain-approved")
    });

    expect(result).toMatchObject({
      status: "allowed",
      safeExplain: {
        decision: "allow",
        reasonCode: "ALLOW_VIA_RELATIONSHIP_PATH",
        pathLength: 3
      }
    });
    expect(result.safeExplain?.constraintKeys).toEqual(
      expect.arrayContaining(["denyByDefault", "deterministic", "explain", "llmDecisioning"])
    );
    expect(JSON.stringify(result.safeExplain)).not.toContain("group:case-team");
    expect(JSON.stringify(result.safeExplain)).not.toContain("workspace:case");
    expect(JSON.stringify(result.safeExplain)).not.toContain("relationshipPath");
    expect(app.listAuditEvents().map((event) => event.eventType)).toEqual([
      "decision.allowed",
      "admin.approval_required",
      "decision.allowed",
      "admin.action",
      "decision.allowed"
    ]);
  });

  it("rejects caller-supplied safe-explain approvals that are not trusted server-side records", () => {
    const app = createSampleInternalAdminApplication();

    expect(app.handle({
      action: "explain_subject_access",
      accessReview: sampleAccessReviewContext,
      approval: {
        ...sampleApprovalEvidence,
        approvalId: "approval:caller-forged-explain"
      },
      explainRequest: sampleExplainRequest,
      session: session("user:access-auditor", "corr:explain-forged-approval")
    })).toMatchObject({
      status: "needs_approval",
      reasonCode: "APPROVAL_NOT_TRUSTED"
    });

    expect(app.handle({
      action: "explain_subject_access",
      accessReview: sampleAccessReviewContext,
      approval: {
        ...sampleApprovalEvidence,
        approverRoles: ["Security engineer", "ISSO", "caller-added-role"]
      },
      explainRequest: sampleExplainRequest,
      session: session("user:access-auditor", "corr:explain-mutated-approval")
    })).toMatchObject({
      status: "needs_approval",
      reasonCode: "APPROVAL_TRUSTED_RECORD_MISMATCH"
    });
  });

  it("keeps exception approval on the approver role instead of operator read roles", () => {
    const app = createSampleInternalAdminApplication();

    expect(app.handle({
      action: "approve_exception_request",
      accessReview: sampleAccessReviewContext,
      approval: sampleApprovalEvidence,
      session: session("user:admin-operator", "corr:operator-cannot-approve")
    })).toMatchObject({
      status: "denied",
      reasonCode: "DENY_DEFAULT_NO_RELATIONSHIP_PATH"
    });

    expect(app.handle({
      action: "approve_exception_request",
      accessReview: sampleAccessReviewContext,
      approval: sampleApprovalEvidence,
      session: session("user:security-approver", "corr:approver-records-evidence")
    })).toMatchObject({
      status: "allowed",
      approval: {
        approvalId: sampleApprovalEvidence.approvalId,
        changeTicket: "CHG-2026-066"
      }
    });
  });

  it("bounds break-glass requests with approval, duration, and post-action review", () => {
    const app = createSampleInternalAdminApplication();

    expect(app.handle({
      action: "request_break_glass",
      breakGlass: {
        incidentId: "incident:missing-approval",
        justification: "Investigate emergency production access anomaly.",
        requestedMinutes: 30
      },
      session: session("user:incident-commander", "corr:bg-missing-approval")
    })).toMatchObject({
      status: "needs_approval",
      reasonCode: "APPROVAL_EVIDENCE_REQUIRED"
    });

    expect(app.handle({
      action: "request_break_glass",
      breakGlass: {
        incidentId: "incident:duration-too-long",
        justification: "Investigate emergency production access anomaly.",
        requestedMinutes: 180,
        approval: sampleBreakGlassApprovalEvidence,
        postActionReviewId: "post-action-review:bg-066"
      },
      session: session("user:incident-commander", "corr:bg-too-long")
    })).toMatchObject({
      status: "denied",
      reasonCode: "BREAK_GLASS_DURATION_EXCEEDS_BOUNDARY"
    });

    expect(app.handle({
      action: "request_break_glass",
      breakGlass: {
        incidentId: "incident:approved-break-glass",
        justification: "Investigate emergency production access anomaly.",
        requestedMinutes: 30,
        approval: sampleBreakGlassApprovalEvidence,
        postActionReviewId: "post-action-review:bg-066"
      },
      session: session("user:incident-commander", "corr:bg-approved")
    })).toMatchObject({
      status: "allowed",
      breakGlass: {
        incidentId: "incident:approved-break-glass",
        postActionReviewRequired: true,
        standingAdminAuthorization: false
      }
    });
  });

  it("rejects caller-supplied break-glass approvals that are not trusted server-side records", () => {
    const app = createSampleInternalAdminApplication();

    expect(app.handle({
      action: "request_break_glass",
      breakGlass: {
        incidentId: "incident:forged-break-glass",
        justification: "Investigate emergency production access anomaly.",
        requestedMinutes: 30,
        approval: {
          ...sampleBreakGlassApprovalEvidence,
          approvalId: "approval:caller-forged-break-glass"
        },
        postActionReviewId: "post-action-review:bg-066"
      },
      session: session("user:incident-commander", "corr:bg-forged-approval")
    })).toMatchObject({
      status: "needs_approval",
      reasonCode: "APPROVAL_NOT_TRUSTED"
    });

    expect(app.handle({
      action: "request_break_glass",
      breakGlass: {
        incidentId: "incident:mutated-break-glass",
        justification: "Investigate emergency production access anomaly.",
        requestedMinutes: 30,
        approval: {
          ...sampleBreakGlassApprovalEvidence,
          approverRoles: ["Security engineer", "ISSO", "caller-added-role"]
        },
        postActionReviewId: "post-action-review:bg-066"
      },
      session: session("user:incident-commander", "corr:bg-mutated-approval")
    })).toMatchObject({
      status: "needs_approval",
      reasonCode: "APPROVAL_TRUSTED_RECORD_MISMATCH"
    });
  });
});

function session(subjectId: string, correlationId: string): { subjectId: string; correlationId: string } {
  return { subjectId, correlationId };
}
