import type { DriftFinding, DriftSeverity } from "./drift.js";
import type { CanonicalId, IsoDateTime, VersionedEntity } from "./shared.js";
import type {
  ExceptionRequestStatus,
  GovernanceApproval,
  GovernanceRemediationTracking,
  GovernanceRiskAcceptance,
  GovernanceWorkflowSource
} from "./evidence-governance.js";

export type {
  ExceptionRequestStatus,
  GovernanceApproval,
  GovernanceApprovalDecision,
  GovernanceRemediationStatus,
  GovernanceRemediationTracking,
  GovernanceRiskAcceptance,
  GovernanceRiskAcceptanceStatus,
  GovernanceRiskSeverity,
  GovernanceWorkflowSource
} from "./evidence-governance.js";

export type AccessReviewCampaignStatus = "planned" | "active" | "completed";
export type GovernanceFindingStatus = "open" | "risk_accepted" | "remediation_planned" | "remediated" | "expired";

export interface AccessReviewCampaign extends VersionedEntity {
  name: string;
  scope: string;
  ownerRole: string;
  reviewerRole: string;
  status: AccessReviewCampaignStatus;
  startedAt: IsoDateTime;
  dueAt: IsoDateTime;
  completedAt?: IsoDateTime;
  subjectCount: number;
  resourceCount: number;
  findingIds: CanonicalId[];
  exceptionRequestIds: CanonicalId[];
  remediationItemIds: CanonicalId[];
  sourceEventIds: CanonicalId[];
  ownerApprovals: GovernanceApproval[];
}

export interface GovernanceFinding extends VersionedEntity {
  campaignId: CanonicalId;
  subjectId: CanonicalId;
  resourceId: CanonicalId;
  action: string;
  severity: DriftSeverity;
  status: GovernanceFindingStatus;
  source: GovernanceWorkflowSource;
  sourceFindingId?: CanonicalId;
  ownerRole: string;
  weakness: string;
  recommendedAction: DriftFinding["recommendedAction"];
  detectedAt: IsoDateTime;
  dueAt: IsoDateTime;
  controlId: string;
  remediation: GovernanceRemediationTracking;
  exceptionRequestId?: CanonicalId;
  evidenceRefs: string[];
}

export interface ExceptionRequest extends VersionedEntity {
  campaignId: CanonicalId;
  findingId: CanonicalId;
  subjectId: CanonicalId;
  resourceId: CanonicalId;
  action: string;
  justification: string;
  status: ExceptionRequestStatus;
  requesterRole: string;
  ownerRole: string;
  requestedAt: IsoDateTime;
  expiresAt: IsoDateTime;
  reviewRequiredAt: IsoDateTime;
  ownerApprovals: GovernanceApproval[];
  riskAcceptance: GovernanceRiskAcceptance;
  remediation: GovernanceRemediationTracking;
  source: GovernanceWorkflowSource;
  sourceFindingId?: CanonicalId;
  controlIds: string[];
  evidenceRefs: string[];
}
