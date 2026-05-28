import type { CanonicalId, IsoDateTime } from "./shared.js";

export type GovernanceApprovalDecision = "pending" | "approved" | "rejected";
export type GovernanceWorkflowSource = "drift" | "access_review" | "manual";
export type GovernanceRemediationStatus = "open" | "planned" | "in_progress" | "completed" | "overdue";
export type GovernanceRiskAcceptanceStatus = "pending" | "accepted" | "expired" | "revoked";
export type GovernanceRiskSeverity = "low" | "medium" | "high" | "critical";
export type ExceptionRequestStatus = "requested" | "owner_approved" | "risk_accepted" | "expired" | "revoked" | "remediated";

export interface GovernanceApproval {
  approverRole: string;
  decision: GovernanceApprovalDecision;
  decidedAt?: IsoDateTime;
  evidenceRefs: string[];
}

export interface GovernanceRemediationTracking {
  status: GovernanceRemediationStatus;
  ownerRole: string;
  plan: string;
  dueAt: IsoDateTime;
  completedAt?: IsoDateTime;
  evidenceRefs: string[];
  poamItemId: CanonicalId;
}

export interface GovernanceRiskAcceptance {
  status: GovernanceRiskAcceptanceStatus;
  acceptedByRole?: string;
  acceptedAt?: IsoDateTime;
  rationale: string;
  residualRisk: GovernanceRiskSeverity;
  expiresAt: IsoDateTime;
  reviewRequiredAt: IsoDateTime;
  evidenceRefs: string[];
}

export interface AccessReviewEvidence {
  reviewId: CanonicalId;
  campaignId: CanonicalId;
  scope: string;
  ownerRole: string;
  reviewerRole: string;
  status: "completed" | "planned";
  reviewedAt: IsoDateTime;
  dueAt: IsoDateTime;
  completedAt?: IsoDateTime;
  subjectCount: number;
  resourceCount: number;
  findingCount: number;
  exceptionCount: number;
  findingIds: CanonicalId[];
  exceptionRequestIds: CanonicalId[];
  remediationItemIds: CanonicalId[];
  ownerApprovals: GovernanceApproval[];
  sourceEventIds: CanonicalId[];
  version: string;
}

export interface ExceptionRecord {
  id: CanonicalId;
  subjectId: CanonicalId;
  resourceId: CanonicalId;
  action: string;
  reason: string;
  status: "open" | "approved" | "expired" | "revoked" | "remediated";
  requestStatus: ExceptionRequestStatus;
  requesterRole: string;
  ownerRole: string;
  approverRole: string;
  requestedAt: IsoDateTime;
  expiresAt: IsoDateTime;
  reviewRequiredAt: IsoDateTime;
  ownerApprovals: GovernanceApproval[];
  riskAcceptance: GovernanceRiskAcceptance;
  remediation: GovernanceRemediationTracking;
  source: GovernanceWorkflowSource;
  findingId?: CanonicalId;
  sourceFindingId?: CanonicalId;
  controlIds: string[];
  evidenceRefs: string[];
  version: string;
}
