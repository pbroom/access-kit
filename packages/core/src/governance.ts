import type {
  AccessReviewCampaign,
  AuditEvent,
  CanonicalId,
  DriftFinding,
  ExceptionRequest,
  GovernanceApproval,
  GovernanceFinding,
  GovernanceFindingStatus,
  GovernanceRemediationTracking,
  GovernanceRiskAcceptance,
  GovernanceRiskAcceptanceStatus
} from "./domain.js";

const LOCAL_ACCESS_REVIEW_CAMPAIGN_ID = "access-review:campaign:local-governance";
const ACCESS_REVIEW_VERSION = "access-review-campaign:v1";
const GOVERNANCE_FINDING_VERSION = "governance-finding:v1";
const EXCEPTION_REQUEST_VERSION = "exception-request:v1";

export interface AccessReviewGovernanceInput {
  generatedAt: string;
  subjectCount: number;
  resourceCount: number;
  sourceEventIds: CanonicalId[];
  driftFindings: DriftFinding[];
  existingCampaigns?: AccessReviewCampaign[];
  existingFindings?: GovernanceFinding[];
  existingExceptionRequests?: ExceptionRequest[];
}

export interface AccessReviewGovernanceRecords {
  campaigns: AccessReviewCampaign[];
  findings: GovernanceFinding[];
  exceptionRequests: ExceptionRequest[];
}

export function buildAccessReviewGovernance(input: AccessReviewGovernanceInput): AccessReviewGovernanceRecords {
  const campaignsById = toIdMap(input.existingCampaigns ?? []);
  const findingsById = toIdMap(input.existingFindings ?? []);
  const exceptionRequestsById = toIdMap(input.existingExceptionRequests ?? []);

  for (const driftFinding of input.driftFindings) {
    const existingExceptionRequest = exceptionRequestsById.get(exceptionRequestId(driftFinding.id));
    const finding = buildGovernanceFinding(
      driftFinding,
      findingsById.get(governanceFindingId(driftFinding.id)),
      input.generatedAt,
      exceptionExpiresAt(driftFinding, existingExceptionRequest)
    );
    findingsById.set(finding.id, finding);

    if (requiresExceptionRequest(driftFinding)) {
      const exceptionRequest = buildExceptionRequest(
        driftFinding,
        finding,
        existingExceptionRequest,
        input.generatedAt
      );
      exceptionRequestsById.set(exceptionRequest.id, exceptionRequest);
      findingsById.set(finding.id, {
        ...finding,
        exceptionRequestId: exceptionRequest.id,
        updatedAt: input.generatedAt
      });
    }
  }

  const campaign = buildAccessReviewCampaign({
    existing: campaignsById.get(LOCAL_ACCESS_REVIEW_CAMPAIGN_ID),
    generatedAt: input.generatedAt,
    subjectCount: input.subjectCount,
    resourceCount: input.resourceCount,
    sourceEventIds: input.sourceEventIds,
    findings: [...findingsById.values()].filter((finding) => finding.campaignId === LOCAL_ACCESS_REVIEW_CAMPAIGN_ID),
    exceptionRequests: [...exceptionRequestsById.values()].filter((request) => request.campaignId === LOCAL_ACCESS_REVIEW_CAMPAIGN_ID)
  });
  campaignsById.set(campaign.id, campaign);

  return {
    campaigns: sortById([...campaignsById.values()]),
    findings: sortById([...findingsById.values()]),
    exceptionRequests: sortById([...exceptionRequestsById.values()])
  };
}

export function sourceEventIdsForAccessReview(events: AuditEvent[]): CanonicalId[] {
  return events
    .filter((event) => (
      event.eventType.startsWith("decision.") ||
      event.eventType.startsWith("relationship.") ||
      event.eventType.startsWith("connector.current_access_read") ||
      event.eventType.startsWith("reconciliation.")
    ))
    .map((event) => event.eventId);
}

export function requiresExceptionRequest(finding: Pick<DriftFinding, "recommendedAction" | "severity">): boolean {
  return finding.recommendedAction === "exception" || finding.severity === "high" || finding.severity === "critical";
}

export function governanceEvidenceId(value: string): CanonicalId {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9_:-]+/g, "_")
    .replaceAll(/_+/g, "_")
    .replaceAll(/^_|_$/g, "") || "unknown";
}

function buildAccessReviewCampaign(input: {
  existing?: AccessReviewCampaign;
  generatedAt: string;
  subjectCount: number;
  resourceCount: number;
  sourceEventIds: CanonicalId[];
  findings: GovernanceFinding[];
  exceptionRequests: ExceptionRequest[];
}): AccessReviewCampaign {
  const hasEvidence = input.sourceEventIds.length > 0 || input.findings.length > 0 || input.exceptionRequests.length > 0;
  const existingOwnerApprovals = input.existing?.ownerApprovals ?? [];
  const completedOwnerApproval = existingOwnerApprovals.find((approval) => approval.decision === "approved");
  const status = completedOwnerApproval ? "completed" : hasEvidence ? "active" : "planned";
  const completedAt = status === "completed"
    ? input.existing?.completedAt ?? completedOwnerApproval?.decidedAt ?? input.generatedAt
    : undefined;
  const ownerApprovals = existingOwnerApprovals.length
    ? existingOwnerApprovals
    : [buildOwnerApproval("Data Owner", "pending", undefined, ["evidence:access-review-campaign"])];

  return {
    id: LOCAL_ACCESS_REVIEW_CAMPAIGN_ID,
    name: "Local access review and exception governance campaign",
    scope: "synthetic local subjects, resources, relationship tuples, native grants, drift findings, exception requests, and remediation records",
    ownerRole: "Data Owner",
    reviewerRole: "Data Steward",
    status,
    startedAt: input.existing?.startedAt ?? input.generatedAt,
    dueAt: input.existing?.dueAt ?? addDays(input.generatedAt, 30),
    completedAt,
    subjectCount: input.subjectCount,
    resourceCount: input.resourceCount,
    findingIds: input.findings.map((finding) => finding.id).sort(),
    exceptionRequestIds: input.exceptionRequests.map((request) => request.id).sort(),
    remediationItemIds: input.findings.map((finding) => finding.remediation.poamItemId).sort(),
    sourceEventIds: [...new Set(input.sourceEventIds)].sort(),
    ownerApprovals,
    version: ACCESS_REVIEW_VERSION,
    createdAt: input.existing?.createdAt ?? input.generatedAt,
    updatedAt: input.generatedAt
  };
}

function buildGovernanceFinding(
  driftFinding: DriftFinding,
  existing: GovernanceFinding | undefined,
  generatedAt: string,
  riskAcceptanceExpiresAt: string
): GovernanceFinding {
  const normalizedSourceFindingId = governanceEvidenceId(driftFinding.id);
  const remediation = buildRemediationTracking(driftFinding, existing?.remediation, generatedAt);
  const status = governanceFindingStatus(driftFinding, remediation.status, generatedAt, riskAcceptanceExpiresAt);
  const evidenceRefs = existing?.evidenceRefs.length
    ? existing.evidenceRefs
    : [`drift:${normalizedSourceFindingId}`, "runbooks/access-review-exceptions.md"];

  return {
    id: governanceFindingId(driftFinding.id),
    campaignId: existing?.campaignId ?? LOCAL_ACCESS_REVIEW_CAMPAIGN_ID,
    subjectId: governanceEvidenceId(driftFinding.subjectId),
    resourceId: governanceEvidenceId(driftFinding.resourceId),
    action: driftFinding.nativeAccess || "review",
    severity: driftFinding.severity,
    status,
    source: "drift",
    sourceFindingId: normalizedSourceFindingId,
    ownerRole: existing?.ownerRole ?? "Resource Owner",
    weakness: `Native ${driftFinding.nativeAccess} access for ${driftFinding.subjectId} on ${driftFinding.resourceId} differs from intended ${driftFinding.intendedAccess} access.`,
    recommendedAction: driftFinding.recommendedAction,
    detectedAt: driftFinding.detectedAt,
    dueAt: remediation.dueAt,
    controlId: "CA-7",
    remediation,
    exceptionRequestId: existing?.exceptionRequestId,
    evidenceRefs,
    version: GOVERNANCE_FINDING_VERSION,
    createdAt: existing?.createdAt ?? driftFinding.createdAt,
    updatedAt: generatedAt
  };
}

function buildExceptionRequest(
  driftFinding: DriftFinding,
  finding: GovernanceFinding,
  existing: ExceptionRequest | undefined,
  generatedAt: string
): ExceptionRequest {
  const normalizedSourceFindingId = governanceEvidenceId(driftFinding.id);
  const requestedAt = existing?.requestedAt ?? driftFinding.detectedAt;
  const expiresAt = existing?.expiresAt ?? addDays(requestedAt, 30);
  const reviewRequiredAt = existing?.reviewRequiredAt ?? addDays(requestedAt, 14);
  const status = exceptionRequestStatus(driftFinding, generatedAt, expiresAt);
  const riskAcceptance = buildRiskAcceptance(existing?.riskAcceptance, driftFinding, status, generatedAt, expiresAt, reviewRequiredAt);
  const ownerApprovals = existing?.ownerApprovals.length
    ? existing.ownerApprovals
    : [buildOwnerApproval("Resource Owner", status === "risk_accepted" ? "approved" : "pending", riskAcceptance.acceptedAt, ["evidence:exception-request"])];

  return {
    id: exceptionRequestId(driftFinding.id),
    campaignId: finding.campaignId,
    findingId: finding.id,
    subjectId: finding.subjectId,
    resourceId: finding.resourceId,
    action: finding.action,
    justification: existing?.justification ?? `Drift finding ${driftFinding.id} requires documented risk acceptance or remediation.`,
    status,
    requesterRole: existing?.requesterRole ?? "Security Engineer",
    ownerRole: existing?.ownerRole ?? "Resource Owner",
    requestedAt,
    expiresAt,
    reviewRequiredAt,
    ownerApprovals,
    riskAcceptance,
    remediation: finding.remediation,
    source: "drift",
    sourceFindingId: normalizedSourceFindingId,
    controlIds: existing?.controlIds.length ? existing.controlIds : ["CA-7", "RA-5"],
    evidenceRefs: existing?.evidenceRefs.length
      ? existing.evidenceRefs
      : [`drift:${normalizedSourceFindingId}`, "runbooks/access-review-exceptions.md"],
    version: EXCEPTION_REQUEST_VERSION,
    createdAt: existing?.createdAt ?? requestedAt,
    updatedAt: generatedAt
  };
}

function buildRemediationTracking(
  driftFinding: DriftFinding,
  existing: GovernanceRemediationTracking | undefined,
  generatedAt: string
): GovernanceRemediationTracking {
  const dueAt = existing?.dueAt ?? addDays(driftFinding.detectedAt, 14);
  const status = remediationStatus(driftFinding, generatedAt, dueAt);

  return {
    status,
    ownerRole: existing?.ownerRole ?? "Resource Owner",
    plan: existing?.plan ?? remediationPlan(driftFinding),
    dueAt,
    completedAt: status === "completed" ? existing?.completedAt ?? generatedAt : existing?.completedAt,
    evidenceRefs: existing?.evidenceRefs.length
      ? existing.evidenceRefs
      : [`drift:${governanceEvidenceId(driftFinding.id)}`, "runbooks/drift-remediation.md"],
    poamItemId: existing?.poamItemId ?? `poam:governance:${governanceEvidenceId(driftFinding.id)}`
  };
}

function buildRiskAcceptance(
  existing: GovernanceRiskAcceptance | undefined,
  driftFinding: DriftFinding,
  requestStatus: ExceptionRequest["status"],
  generatedAt: string,
  expiresAt: string,
  reviewRequiredAt: string
): GovernanceRiskAcceptance {
  const status = riskAcceptanceStatus(existing?.status, requestStatus);

  return {
    status,
    acceptedByRole: status === "accepted" ? existing?.acceptedByRole ?? "Authorizing Official" : existing?.acceptedByRole,
    acceptedAt: status === "accepted" ? existing?.acceptedAt ?? generatedAt : existing?.acceptedAt,
    rationale: existing?.rationale ?? `Residual access drift ${driftFinding.id} is tracked for owner review, remediation, or time-bound acceptance.`,
    residualRisk: existing?.residualRisk ?? driftFinding.severity,
    expiresAt,
    reviewRequiredAt,
    evidenceRefs: existing?.evidenceRefs.length
      ? existing.evidenceRefs
      : [`drift:${governanceEvidenceId(driftFinding.id)}`, "runbooks/access-review-exceptions.md"]
  };
}

function remediationPlan(finding: DriftFinding): string {
  if (finding.recommendedAction === "revoke") {
    return "Validate intended access, plan revocation, and verify reconciliation closure.";
  }
  if (finding.recommendedAction === "repair") {
    return "Repair intended relationship or native grant mismatch and rerun reconciliation.";
  }
  if (finding.recommendedAction === "exception") {
    return "Obtain owner approval, document risk acceptance, set expiry, and track remediation before access can remain.";
  }

  return "Review access with the resource owner and choose revoke, repair, or time-bound exception handling.";
}

function exceptionExpiresAt(finding: DriftFinding, existing: ExceptionRequest | undefined): string {
  return existing?.expiresAt ?? addDays(existing?.requestedAt ?? finding.detectedAt, 30);
}

function governanceFindingStatus(
  finding: DriftFinding,
  remediationStatusValue: GovernanceRemediationTracking["status"],
  generatedAt: string,
  riskAcceptanceExpiresAt: string
): GovernanceFindingStatus {
  if (finding.status === "resolved" || remediationStatusValue === "completed") {
    return "remediated";
  }
  if (finding.status === "accepted") {
    return isAfter(generatedAt, riskAcceptanceExpiresAt) ? "expired" : "risk_accepted";
  }
  if (finding.status === "repairing") {
    return "remediation_planned";
  }

  return "open";
}

function remediationStatus(finding: DriftFinding, generatedAt: string, dueAt: string): GovernanceRemediationTracking["status"] {
  if (finding.status === "resolved") {
    return "completed";
  }
  if (finding.status === "repairing") {
    return "in_progress";
  }
  if (isAfter(generatedAt, dueAt)) {
    return "overdue";
  }

  return finding.recommendedAction === "review" ? "open" : "planned";
}

function exceptionRequestStatus(finding: DriftFinding, generatedAt: string, expiresAt: string): ExceptionRequest["status"] {
  if (finding.status === "resolved") {
    return "remediated";
  }
  if (isAfter(generatedAt, expiresAt)) {
    return "expired";
  }
  if (finding.status === "accepted") {
    return "risk_accepted";
  }

  return "requested";
}

function riskAcceptanceStatus(
  existingStatus: GovernanceRiskAcceptanceStatus | undefined,
  requestStatus: ExceptionRequest["status"]
): GovernanceRiskAcceptanceStatus {
  if (requestStatus === "expired") {
    return "expired";
  }
  if (requestStatus === "revoked") {
    return "revoked";
  }
  if (requestStatus === "risk_accepted" || existingStatus === "accepted") {
    return "accepted";
  }

  return "pending";
}

function governanceFindingId(sourceFindingId: string): CanonicalId {
  return `governance-finding:${governanceEvidenceId(sourceFindingId)}`;
}

function exceptionRequestId(sourceFindingId: string): CanonicalId {
  return `exception:${governanceEvidenceId(sourceFindingId)}`;
}

function buildOwnerApproval(
  approverRole: string,
  decision: GovernanceApproval["decision"],
  decidedAt: string | undefined,
  evidenceRefs: string[]
): GovernanceApproval {
  return {
    approverRole,
    decision,
    decidedAt,
    evidenceRefs
  };
}

function addDays(timestamp: string, days: number): string {
  const date = new Date(timestamp);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function isAfter(value: string, compareTo: string): boolean {
  return Date.parse(value) > Date.parse(compareTo);
}

function toIdMap<T extends { id: CanonicalId }>(items: T[]): Map<CanonicalId, T> {
  return new Map(items.map((item) => [item.id, item]));
}

function sortById<T extends { id: CanonicalId }>(items: T[]): T[] {
  return [...items].sort((left, right) => left.id.localeCompare(right.id));
}
