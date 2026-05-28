import {
  AuditRecorder,
  InMemoryRebacStore,
  RebacDecisionEngine,
  assessAdminAuthorizationReadiness,
  createLocalEngineSeed,
  type AdminAuthorizationDescriptor,
  type AdminAuthorizationReadinessReport,
  type AuditEvent,
  type CanonicalId,
  type DecisionRequest,
  type DecisionResult,
  type JsonRecord,
  type RebacSeedData,
  type RelationshipTuple,
  type Resource,
  type Subject
} from "../../packages/core/src/index.js";

export type InternalAdminAction =
  | "view_access_review"
  | "explain_subject_access"
  | "approve_exception_request"
  | "request_break_glass";

export interface AdminSession {
  readonly subjectId: CanonicalId;
  readonly correlationId: CanonicalId;
}

export interface AccessReviewContext {
  readonly reviewId: CanonicalId;
  readonly campaignId: CanonicalId;
  readonly resourceId: CanonicalId;
  readonly reviewedSubjectId: CanonicalId;
  readonly resourceOwnerId: CanonicalId;
  readonly reviewerId: CanonicalId;
  readonly dueAt: string;
}

export interface ApprovalEvidence {
  readonly approvalId: CanonicalId;
  readonly approverId: CanonicalId;
  readonly approverRoles: readonly string[];
  readonly changeTicket: CanonicalId;
  readonly approvedAt: string;
  readonly expiresAt: string;
  readonly reason: string;
  readonly accessReviewId: CanonicalId;
}

export interface BreakGlassRequest {
  readonly incidentId: CanonicalId;
  readonly justification: string;
  readonly requestedMinutes: number;
  readonly approval?: ApprovalEvidence;
  readonly postActionReviewId?: CanonicalId;
}

export interface InternalAdminActionRequest {
  readonly action: InternalAdminAction;
  readonly session: AdminSession;
  readonly accessReview?: AccessReviewContext;
  readonly approval?: ApprovalEvidence;
  readonly breakGlass?: BreakGlassRequest;
  readonly explainRequest?: DecisionRequest;
}

export interface SafeDecisionSummary {
  readonly decisionId: CanonicalId;
  readonly decision: DecisionResult["decision"];
  readonly reasonCode: string;
  readonly policyVersion: string;
  readonly relationshipVersion: string;
}

export interface SafeExplainSummary extends SafeDecisionSummary {
  readonly evaluatedAt: string;
  readonly pathLength: number;
  readonly constraintKeys: readonly string[];
}

export interface BreakGlassSummary {
  readonly incidentId: CanonicalId;
  readonly approvedUntil: string;
  readonly requestedMinutes: number;
  readonly postActionReviewRequired: true;
  readonly standingAdminAuthorization: false;
}

export interface InternalAdminActionResult {
  readonly status: "allowed" | "denied" | "needs_approval";
  readonly reasonCode: string;
  readonly correlationId: CanonicalId;
  readonly adminDecision?: SafeDecisionSummary;
  readonly safeExplain?: SafeExplainSummary;
  readonly approval?: ApprovalEvidence;
  readonly accessReview?: AccessReviewContext;
  readonly breakGlass?: BreakGlassSummary;
  readonly auditEventIds: readonly CanonicalId[];
}

interface ApprovalValidationResult {
  readonly valid: boolean;
  readonly reasonCode: string;
  readonly approval?: ApprovalEvidence;
}

interface AdminActionConfig {
  readonly action: DecisionRequest["action"];
  readonly resourceId: CanonicalId;
  readonly requiresAccessReview: boolean;
  readonly requiresApproval: boolean;
  readonly requiresBreakGlass: boolean;
}

interface ValidatedAdminArtifacts {
  readonly approval?: ApprovalEvidence;
  readonly breakGlassApproval?: ApprovalEvidence;
}

const timestamp = "2026-05-26T14:00:00.000Z";
const adminConsoleId = "application:access-kit-admin-console";
const accessReviewCaseId = "document:access-review-case-2026-q2";
const breakGlassBoundaryId = "api:admin-break-glass-boundary";

const actionConfigs = {
  view_access_review: {
    action: "read",
    resourceId: accessReviewCaseId,
    requiresAccessReview: true,
    requiresApproval: false,
    requiresBreakGlass: false
  },
  explain_subject_access: {
    action: "read",
    resourceId: adminConsoleId,
    requiresAccessReview: true,
    requiresApproval: true,
    requiresBreakGlass: false
  },
  approve_exception_request: {
    action: "manage",
    resourceId: adminConsoleId,
    requiresAccessReview: true,
    requiresApproval: true,
    requiresBreakGlass: false
  },
  request_break_glass: {
    action: "admin",
    resourceId: breakGlassBoundaryId,
    requiresAccessReview: false,
    requiresApproval: false,
    requiresBreakGlass: true
  }
} satisfies Record<InternalAdminAction, AdminActionConfig>;

export class SampleInternalAdminApplication {
  readonly #adminAudit: AuditRecorder;
  readonly #adminDescriptor: AdminAuthorizationDescriptor;
  readonly #adminEngine: RebacDecisionEngine;
  readonly #adminReadiness: AdminAuthorizationReadinessReport;
  readonly #adminStore: InMemoryRebacStore;
  readonly #applicationEngine: RebacDecisionEngine;
  readonly #applicationStore: InMemoryRebacStore;
  readonly #now: () => string;
  readonly #trustedApprovals: ReadonlyMap<CanonicalId, ApprovalEvidence>;

  constructor(options: {
    readonly adminDescriptor?: AdminAuthorizationDescriptor;
    readonly adminSeed?: RebacSeedData;
    readonly applicationSeed?: RebacSeedData;
    readonly now?: () => string;
    readonly trustedApprovals?: readonly ApprovalEvidence[];
  } = {}) {
    this.#now = options.now ?? (() => timestamp);
    this.#adminDescriptor = options.adminDescriptor ?? createSampleAdminAuthorizationDescriptor();
    this.#adminReadiness = assessAdminAuthorizationReadiness(this.#adminDescriptor, this.#now());
    this.#adminStore = new InMemoryRebacStore(options.adminSeed ?? createSampleAdminSeed());
    this.#applicationStore = new InMemoryRebacStore(options.applicationSeed ?? createLocalEngineSeed());
    this.#trustedApprovals = createTrustedApprovalStore(options.trustedApprovals ?? createSampleTrustedApprovals());
    this.#adminAudit = new AuditRecorder(this.#adminStore.listAuditEvents());
    this.#adminEngine = new RebacDecisionEngine(this.#adminStore, {
      actor: "service:sample-internal-admin-app",
      auditRecorder: this.#adminAudit,
      now: this.#now,
      policyVersion: "policy:internal-admin-sample:v1",
      relationshipVersion: "tuple-set:internal-admin-sample:v1"
    });
    this.#applicationEngine = new RebacDecisionEngine(this.#applicationStore, {
      actor: "service:sample-internal-admin-app",
      now: this.#now,
      policyVersion: "policy:sample-application:v1",
      relationshipVersion: "tuple-set:sample-application:v1"
    });
  }

  get adminReadiness(): AdminAuthorizationReadinessReport {
    return this.#adminReadiness;
  }

  listAuditEvents(): AuditEvent[] {
    return [...this.#adminStore.listAuditEvents(), ...this.#applicationStore.listAuditEvents()];
  }

  handle(request: InternalAdminActionRequest): InternalAdminActionResult {
    const config = actionConfigs[request.action];
    const actionAuditEventIds: CanonicalId[] = [];
    let validatedApproval: ApprovalEvidence | undefined;
    let validatedBreakGlassApproval: ApprovalEvidence | undefined;

    if (this.#adminReadiness.status !== "ready") {
      const event = this.#recordAdminEvent("admin.action_denied", request.session, {
        action: request.action,
        reasonCode: "ADMIN_CONTROLS_NOT_READY",
        readinessStatus: this.#adminReadiness.status
      });
      return denied("ADMIN_CONTROLS_NOT_READY", request, undefined, [event.eventId]);
    }

    const [adminDecision, adminDecisionEventIds] = this.#evaluateAdminDecision(request, config);
    actionAuditEventIds.push(...adminDecisionEventIds);

    if (adminDecision.decision !== "allow") {
      const event = this.#recordAdminEvent("admin.action_denied", request.session, {
        action: request.action,
        adminDecision: summarizeDecision(adminDecision)
      });
      return denied(adminDecision.reasonCode, request, adminDecision, [...actionAuditEventIds, event.eventId]);
    }

    if (config.requiresAccessReview && !request.accessReview) {
      const event = this.#recordAdminEvent("admin.action_denied", request.session, {
        action: request.action,
        reasonCode: "ACCESS_REVIEW_CONTEXT_REQUIRED"
      });
      return denied("ACCESS_REVIEW_CONTEXT_REQUIRED", request, adminDecision, [...actionAuditEventIds, event.eventId]);
    }

    if (config.requiresApproval) {
      const approvalStatus = validateApprovalEvidence(
        request.approval,
        request.accessReview,
        this.#now(),
        this.#trustedApprovals
      );
      if (!approvalStatus.valid) {
        const event = this.#recordAdminEvent("admin.approval_required", request.session, {
          action: request.action,
          reasonCode: approvalStatus.reasonCode,
          accessReviewId: request.accessReview?.reviewId
        });
        return needsApproval(approvalStatus.reasonCode, request, adminDecision, [...actionAuditEventIds, event.eventId]);
      }
      validatedApproval = approvalStatus.approval;
    }

    if (config.requiresBreakGlass) {
      const breakGlassStatus = this.#validateBreakGlass(request.breakGlass);
      if (!breakGlassStatus.valid) {
        const event = this.#recordAdminEvent(
          breakGlassStatus.needsApproval ? "admin.approval_required" : "admin.break_glass_denied",
          request.session,
          {
            action: request.action,
            reasonCode: breakGlassStatus.reasonCode,
            incidentId: request.breakGlass?.incidentId,
            requestedMinutes: request.breakGlass?.requestedMinutes
          }
        );
        const auditEventIds = [...actionAuditEventIds, event.eventId];
        return breakGlassStatus.needsApproval
          ? needsApproval(breakGlassStatus.reasonCode, request, adminDecision, auditEventIds)
          : denied(breakGlassStatus.reasonCode, request, adminDecision, auditEventIds);
      }
      validatedBreakGlassApproval = breakGlassStatus.approval;
    }

    return this.#completeAllowedAction(request, adminDecision, actionAuditEventIds, {
      approval: validatedApproval,
      breakGlassApproval: validatedBreakGlassApproval
    });
  }

  #completeAllowedAction(
    request: InternalAdminActionRequest,
    adminDecision: DecisionResult,
    actionAuditEventIds: CanonicalId[],
    validated: ValidatedAdminArtifacts
  ): InternalAdminActionResult {
    if (request.action === "explain_subject_access") {
      if (!request.explainRequest) {
        const event = this.#recordAdminEvent("admin.action_denied", request.session, {
          action: request.action,
          reasonCode: "EXPLAIN_REQUEST_REQUIRED"
        });
        return denied("EXPLAIN_REQUEST_REQUIRED", request, adminDecision, [...actionAuditEventIds, event.eventId]);
      }

      const [explainDecision, explainAuditEventIds] = this.#evaluateApplicationExplain(request.explainRequest);
      const safeExplain = summarizeExplain(explainDecision);
      const approval = validated.approval;
      const event = this.#recordAdminEvent("admin.action", request.session, {
        action: request.action,
        approvalId: approval?.approvalId,
        accessReviewId: request.accessReview?.reviewId,
        targetDecisionId: explainDecision.decisionId,
        safeExplain
      });

      return allowed(request, adminDecision, [...actionAuditEventIds, ...explainAuditEventIds, event.eventId], {
        accessReview: request.accessReview,
        approval,
        safeExplain
      });
    }

    if (request.action === "request_break_glass") {
      const approval = validated.breakGlassApproval;
      const event = this.#recordAdminEvent("admin.action", request.session, {
        action: request.action,
        approvalId: approval?.approvalId,
        incidentId: request.breakGlass?.incidentId,
        postActionReviewId: request.breakGlass?.postActionReviewId,
        standingAdminAuthorization: false
      });

      if (!request.breakGlass || !approval) {
        throw new Error("Invariant violated: break-glass request and approval must be present after validation");
      }

      return allowed(request, adminDecision, [...actionAuditEventIds, event.eventId], {
        approval,
        breakGlass: {
          incidentId: request.breakGlass.incidentId,
          approvedUntil: approval.expiresAt,
          requestedMinutes: request.breakGlass.requestedMinutes,
          postActionReviewRequired: true,
          standingAdminAuthorization: false
        }
      });
    }

    const event = this.#recordAdminEvent("admin.action", request.session, {
      action: request.action,
      approvalId: validated.approval?.approvalId,
      accessReviewId: request.accessReview?.reviewId
    });

    return allowed(request, adminDecision, [...actionAuditEventIds, event.eventId], {
      accessReview: request.accessReview,
      approval: validated.approval
    });
  }

  #evaluateAdminDecision(
    request: InternalAdminActionRequest,
    config: AdminActionConfig
  ): readonly [DecisionResult, readonly CanonicalId[]] {
    const before = this.#adminStore.listAuditEvents().length;
    const decision = this.#adminEngine.check({
      subjectId: request.session.subjectId,
      action: config.action,
      resourceId: config.resourceId,
      context: {
        adminAction: request.action,
        correlationId: request.session.correlationId,
        separateFromApplicationAuthorization: true
      }
    });
    const eventIds = this.#adminStore.listAuditEvents().slice(before).map((event) => event.eventId);
    return [decision, eventIds];
  }

  #evaluateApplicationExplain(request: DecisionRequest): readonly [DecisionResult, readonly CanonicalId[]] {
    const before = this.#applicationStore.listAuditEvents().length;
    const decision = this.#applicationEngine.explain(request);
    const eventIds = this.#applicationStore.listAuditEvents().slice(before).map((event) => event.eventId);
    return [decision, eventIds];
  }

  #recordAdminEvent(eventType: string, session: AdminSession, payload: JsonRecord): AuditEvent {
    const event = this.#adminAudit.record(
      {
        eventType,
        actor: session.subjectId,
        correlationId: session.correlationId,
        payload: {
          ...payload,
          sample: "AK-066 internal admin app"
        }
      },
      this.#now()
    );
    this.#adminStore.recordAuditEvent(event);
    return event;
  }

  #validateBreakGlass(request: BreakGlassRequest | undefined): {
    readonly valid: boolean;
    readonly needsApproval: boolean;
    readonly reasonCode: string;
    readonly approval?: ApprovalEvidence;
  } {
    if (!request) {
      return { valid: false, needsApproval: true, reasonCode: "BREAK_GLASS_REQUEST_REQUIRED" };
    }

    const approvalStatus = validateApprovalEvidence(
      request.approval,
      undefined,
      this.#now(),
      this.#trustedApprovals,
      {
        requiredApproverRoles: this.#adminDescriptor.emergency.breakGlassApproverRoles
      }
    );
    if (!approvalStatus.valid) {
      return { valid: false, needsApproval: true, reasonCode: approvalStatus.reasonCode };
    }

    if (request.requestedMinutes > this.#adminDescriptor.emergency.temporaryElevationMaxMinutes) {
      return {
        valid: false,
        needsApproval: false,
        reasonCode: "BREAK_GLASS_DURATION_EXCEEDS_BOUNDARY"
      };
    }

    if (!request.postActionReviewId) {
      return { valid: false, needsApproval: true, reasonCode: "POST_ACTION_REVIEW_REQUIRED" };
    }

    if (request.justification.trim().length < 16) {
      return { valid: false, needsApproval: true, reasonCode: "BREAK_GLASS_JUSTIFICATION_REQUIRED" };
    }

    return {
      valid: true,
      needsApproval: false,
      reasonCode: "BREAK_GLASS_APPROVED_WITH_REVIEW",
      approval: approvalStatus.approval
    };
  }
}

export function createSampleInternalAdminApplication(
  options: ConstructorParameters<typeof SampleInternalAdminApplication>[0] = {}
): SampleInternalAdminApplication {
  return new SampleInternalAdminApplication(options);
}

export function createSampleAdminAuthorizationDescriptor(): AdminAuthorizationDescriptor {
  return {
    version: "admin-authorization:v1",
    authentication: {
      mode: "idp_gateway",
      provider: "sample-idp",
      issuer: "https://idp.example.test/admin",
      subjectClaim: "sub",
      groupsClaim: "groups",
      mfaRequired: true,
      sessionTtlMinutes: 60,
      revocationSlaMinutes: 15,
      evidenceRefs: ["examples/internal-admin-app/README.md#admin-control-boundary"]
    },
    ingress: {
      mode: "identity_aware_gateway",
      mtlsRequired: false,
      trustedIdentityHeaders: ["x-access-kit-admin-subject", "x-access-kit-admin-groups"],
      evidenceRefs: ["examples/internal-admin-app/README.md#admin-control-boundary"]
    },
    adminRebac: {
      policyId: "policy:sample-internal-admin-rebac",
      separateFromApplicationAuthorization: true,
      leastPrivilegeRoles: [
        "access-kit.admin.operator",
        "access-kit.admin.approver",
        "access-kit.admin.auditor",
        "access-kit.admin.break-glass-responder"
      ],
      roleBindings: [
        "group:admin-operators->access-kit.admin.operator",
        "group:admin-approvers->access-kit.admin.approver",
        "group:admin-auditors->access-kit.admin.auditor",
        "group:break-glass-responders->access-kit.admin.break-glass-responder"
      ],
      revocationSlaMinutes: 15,
      evidenceRefs: ["examples/internal-admin-app/README.md#least-privilege-admin-roles"]
    },
    secrets: {
      manager: "external_secret_manager",
      secretRefs: ["ref:sample-admin-gateway/session-signing-key"],
      rotationDays: 30,
      noPlaintextEnvironmentSecrets: true,
      evidenceRefs: ["examples/internal-admin-app/README.md#admin-control-boundary"]
    },
    emergency: {
      breakGlassApprovalRequired: true,
      breakGlassApproverRoles: ["Security engineer", "ISSO"],
      temporaryElevationMaxMinutes: 60,
      incidentModeNotificationTargets: ["siem:admin-actions", "pagerduty:security"],
      postActionReviewRequired: true,
      evidenceRefs: ["examples/internal-admin-app/README.md#break-glass-boundary"]
    },
    audit: {
      auditEventTypes: ["admin.action", "admin.post_action_review", "api.authentication_failed"],
      evidenceExportRequired: true,
      evidenceRefs: ["examples/internal-admin-app/README.md#audit-traceability"]
    }
  };
}

export function createSampleAdminSeed(): RebacSeedData {
  return {
    subjects: [
      subject("user:admin-operator", "Admin Operator", "user"),
      subject("user:security-approver", "Security Approver", "user"),
      subject("user:access-auditor", "Access Auditor", "user"),
      subject("user:incident-commander", "Incident Commander", "user"),
      subject("user:alice", "Application User Alice", "user"),
      subject("group:admin-operators", "Admin Operators", "group"),
      subject("group:admin-approvers", "Admin Approvers", "group"),
      subject("group:admin-auditors", "Admin Auditors", "group"),
      subject("group:break-glass-responders", "Break Glass Responders", "group")
    ],
    resources: [
      resource(adminConsoleId, "Internal Admin Console", "application"),
      resource(accessReviewCaseId, "Q2 Access Review Case", "document"),
      resource(breakGlassBoundaryId, "Break Glass Boundary", "api")
    ],
    relationships: [
      tuple("relationship:operator-member", "user:admin-operator", "member_of", "group:admin-operators"),
      tuple("relationship:approver-member", "user:security-approver", "member_of", "group:admin-approvers"),
      tuple("relationship:auditor-member", "user:access-auditor", "member_of", "group:admin-auditors"),
      tuple("relationship:incident-commander-member", "user:incident-commander", "member_of", "group:break-glass-responders"),
      tuple("relationship:operator-review-read", "group:admin-operators", "reader_of", accessReviewCaseId),
      tuple("relationship:operator-console-read", "group:admin-operators", "reader_of", adminConsoleId),
      tuple("relationship:auditor-review-read", "group:admin-auditors", "reader_of", accessReviewCaseId),
      tuple("relationship:auditor-console-read", "group:admin-auditors", "reader_of", adminConsoleId),
      tuple("relationship:approver-console-admin", "group:admin-approvers", "admin_of", adminConsoleId),
      tuple("relationship:responder-break-glass-admin", "group:break-glass-responders", "admin_of", breakGlassBoundaryId)
    ]
  };
}

export const sampleAccessReviewContext: AccessReviewContext = {
  reviewId: "access-review:2026-q2-case-plan",
  campaignId: "access-review-campaign:2026-q2",
  resourceId: "document:case-plan",
  reviewedSubjectId: "user:alice",
  resourceOwnerId: "user:owner",
  reviewerId: "user:access-auditor",
  dueAt: "2026-06-15T00:00:00.000Z"
};

export const sampleApprovalEvidence: ApprovalEvidence = {
  approvalId: "approval:access-review-2026-q2-explain",
  approverId: "user:security-approver",
  approverRoles: ["Security engineer", "ISSO"],
  changeTicket: "CHG-2026-066",
  approvedAt: "2026-05-26T13:45:00.000Z",
  expiresAt: "2026-05-26T15:00:00.000Z",
  reason: "Review the case-plan relationship path during the Q2 access-review campaign.",
  accessReviewId: sampleAccessReviewContext.reviewId
};

export const sampleBreakGlassApprovalEvidence: ApprovalEvidence = {
  ...sampleApprovalEvidence,
  approvalId: "approval:break-glass-066",
  accessReviewId: "break-glass:incident-review",
  reason: "Approve emergency break-glass access for incident response under post-action review."
};

export const sampleExplainRequest: DecisionRequest = {
  subjectId: sampleAccessReviewContext.reviewedSubjectId,
  action: "read",
  resourceId: sampleAccessReviewContext.resourceId,
  context: {
    accessReviewId: sampleAccessReviewContext.reviewId,
    purpose: "admin-access-review"
  }
};

function createSampleTrustedApprovals(): readonly ApprovalEvidence[] {
  return [sampleApprovalEvidence, sampleBreakGlassApprovalEvidence];
}

function createTrustedApprovalStore(approvals: readonly ApprovalEvidence[]): ReadonlyMap<CanonicalId, ApprovalEvidence> {
  return new Map(approvals.map((approval) => [approval.approvalId, approval]));
}

function validateApprovalEvidence(
  approval: ApprovalEvidence | undefined,
  accessReview: AccessReviewContext | undefined,
  now: string,
  trustedApprovals: ReadonlyMap<CanonicalId, ApprovalEvidence>,
  options: { readonly requiredApproverRoles?: readonly string[] } = {}
): ApprovalValidationResult {
  if (!approval) {
    return { valid: false, reasonCode: "APPROVAL_EVIDENCE_REQUIRED" };
  }

  const trustedApproval = trustedApprovals.get(approval.approvalId);
  if (!trustedApproval) {
    return { valid: false, reasonCode: "APPROVAL_NOT_TRUSTED" };
  }

  if (!approvalMatchesTrustedRecord(approval, trustedApproval)) {
    return { valid: false, reasonCode: "APPROVAL_TRUSTED_RECORD_MISMATCH" };
  }

  if (!trustedApproval.changeTicket.startsWith("CHG-")) {
    return { valid: false, reasonCode: "APPROVAL_CHANGE_TICKET_REQUIRED" };
  }

  if (Date.parse(trustedApproval.expiresAt) <= Date.parse(now)) {
    return { valid: false, reasonCode: "APPROVAL_EXPIRED" };
  }

  if (accessReview && trustedApproval.accessReviewId !== accessReview.reviewId) {
    return { valid: false, reasonCode: "APPROVAL_ACCESS_REVIEW_MISMATCH" };
  }

  const requiredApproverRoles = options.requiredApproverRoles ?? [];
  if (requiredApproverRoles.some((role) => !trustedApproval.approverRoles.includes(role))) {
    return { valid: false, reasonCode: "BREAK_GLASS_MULTI_ROLE_APPROVAL_REQUIRED" };
  }

  return { valid: true, reasonCode: "APPROVAL_VALID", approval: trustedApproval };
}

function approvalMatchesTrustedRecord(approval: ApprovalEvidence, trustedApproval: ApprovalEvidence): boolean {
  return (
    approval.approvalId === trustedApproval.approvalId &&
    approval.approverId === trustedApproval.approverId &&
    approval.changeTicket === trustedApproval.changeTicket &&
    approval.approvedAt === trustedApproval.approvedAt &&
    approval.expiresAt === trustedApproval.expiresAt &&
    approval.reason === trustedApproval.reason &&
    approval.accessReviewId === trustedApproval.accessReviewId &&
    arraysEqual(approval.approverRoles, trustedApproval.approverRoles)
  );
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function allowed(
  request: InternalAdminActionRequest,
  adminDecision: DecisionResult,
  auditEventIds: readonly CanonicalId[],
  details: Partial<Pick<InternalAdminActionResult, "accessReview" | "approval" | "breakGlass" | "safeExplain">> = {}
): InternalAdminActionResult {
  return {
    status: "allowed",
    reasonCode: "ADMIN_ACTION_ALLOWED",
    correlationId: request.session.correlationId,
    adminDecision: summarizeDecision(adminDecision),
    auditEventIds,
    ...details
  };
}

function denied(
  reasonCode: string,
  request: InternalAdminActionRequest,
  adminDecision: DecisionResult | undefined,
  auditEventIds: readonly CanonicalId[]
): InternalAdminActionResult {
  return {
    status: "denied",
    reasonCode,
    correlationId: request.session.correlationId,
    adminDecision: adminDecision ? summarizeDecision(adminDecision) : undefined,
    auditEventIds
  };
}

function needsApproval(
  reasonCode: string,
  request: InternalAdminActionRequest,
  adminDecision: DecisionResult,
  auditEventIds: readonly CanonicalId[]
): InternalAdminActionResult {
  return {
    status: "needs_approval",
    reasonCode,
    correlationId: request.session.correlationId,
    adminDecision: summarizeDecision(adminDecision),
    auditEventIds
  };
}

function summarizeDecision(decision: DecisionResult): SafeDecisionSummary {
  return {
    decisionId: decision.decisionId,
    decision: decision.decision,
    reasonCode: decision.reasonCode,
    policyVersion: decision.policyVersion,
    relationshipVersion: decision.relationshipVersion
  };
}

function summarizeExplain(decision: DecisionResult): SafeExplainSummary {
  return {
    ...summarizeDecision(decision),
    evaluatedAt: decision.evaluatedAt,
    pathLength: decision.relationshipPath.length,
    constraintKeys: Object.keys(decision.constraints).sort()
  };
}

function subject(id: CanonicalId, displayName: string, type: Subject["type"]): Subject {
  return {
    id,
    type,
    displayName,
    sourceSystem: "sample-internal-admin-app",
    lifecycleState: "active",
    identifiers: { sampleId: id },
    version: "subject:v1",
    createdAt: timestamp,
    lastSeenAt: timestamp
  };
}

function resource(id: CanonicalId, displayName: string, type: Resource["type"]): Resource {
  return {
    id,
    type,
    displayName,
    sourceSystem: "sample-internal-admin-app",
    ownerId: "user:security-approver",
    dataStewardId: "user:access-auditor",
    technicalOwnerId: "user:admin-operator",
    classification: "internal-admin",
    lifecycleState: "active",
    version: "resource:v1",
    createdAt: timestamp,
    lastSeenAt: timestamp
  };
}

function tuple(
  id: CanonicalId,
  subjectId: CanonicalId,
  relation: string,
  objectId: CanonicalId
): RelationshipTuple {
  return {
    id,
    subjectId,
    relation,
    objectId,
    sourceSystem: "sample-internal-admin-app",
    assertedAt: timestamp,
    assertedBy: "user:security-approver",
    status: "active",
    version: "tuple:v1",
    createdAt: timestamp
  };
}
