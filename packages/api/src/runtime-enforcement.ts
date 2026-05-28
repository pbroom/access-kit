import {
  type AuditEventInput,
  type ConnectorAdapter,
  type DecisionResult,
  type EnforcementControl,
  type EnforcementReadinessCheck,
  type EnforcementReadinessReport,
  type JsonRecord,
  type ProvisioningActionResult,
  type ProvisioningApproval,
  type ProvisioningJob,
  type ProvisioningMode,
  type ProvisioningPlan,
  type ProvisioningVerification
} from "@access-kit/core";
import { RebacLocalAppError, type RebacLocalApp } from "./runtime-app.js";
import { changeTicketMatches } from "./runtime-provisioning.js";

export interface ProvisioningExecutionOptions {
  mode?: ProvisioningMode;
  approval?: ProvisioningApproval;
  control?: EnforcementControl;
  readinessReportId?: string;
}

export interface EnforcementReadinessRequest {
  mode?: "enforcement";
  control: EnforcementControl;
  requiredApproverRole?: string;
  changeTicketPattern?: string;
}

export interface EnforcementReadinessPlan {
  report: EnforcementReadinessReport;
  auditInput: AuditEventInput;
}

export interface ControlledEnforcementJobRequest {
  approverId: string;
  idempotencyKey: string;
  jobId: string;
  startedAt: string;
  approval?: ProvisioningApproval;
  control?: EnforcementControl;
}

export interface ControlledEnforcementJobExecution {
  completedAt: string;
  updatedPlan: ProvisioningPlan;
  jobWithoutAuditIds: ProvisioningJob;
  auditInputs: AuditEventInput[];
}

export async function planEnforcementReadinessReport(
  app: RebacLocalApp,
  connector: ConnectorAdapter,
  connectorId: string,
  request: EnforcementReadinessRequest,
  reportId: string,
  checkedAt: string
): Promise<EnforcementReadinessPlan> {
  const control = request.control;
  const checks = await buildEnforcementReadinessChecks(connector, control, checkedAt);
  const report: EnforcementReadinessReport = {
    id: reportId,
    connectorId,
    provider: connector.provider ?? connector.id,
    tenantBoundary: connector.tenantBoundary ?? "synthetic:unknown",
    mode: "enforcement",
    status: checks.some((check) => check.status === "fail") ? "blocked" : "ready",
    checkedAt,
    control,
    checks,
    requiredApproverRole: request.requiredApproverRole ?? "access-approver",
    changeTicketPattern: request.changeTicketPattern ?? "^chg:[a-z0-9_:-]+$",
    liveProviderWritesAllowed: false,
    auditEventIds: [],
    version: "enforcement-readiness:v1",
    createdAt: checkedAt
  };

  return {
    report,
    auditInput: {
      eventType: "connector.enforcement_readiness_checked",
      actor: app.actor,
      correlationId: `corr:${reportId}`,
      payload: asJsonRecord(report)
    }
  };
}

export function prepareProvisioningPlanForExecution(
  app: RebacLocalApp,
  connector: ConnectorAdapter,
  plan: ProvisioningPlan,
  options: ProvisioningExecutionOptions
): ProvisioningPlan {
  const mode = options.mode ?? "dry_run";

  if (mode === "dry_run") {
    return {
      ...plan,
      mode,
      status: "planned",
      actions: plan.actions.map((action) => ({
        ...action,
        dryRun: true,
        status: "planned"
      }))
    };
  }

  assertControlledEnforcementAllowed(app, connector, options.approval, options.control, options.approval?.approverId);
  assertEnforcementReadiness(app, connector, plan.connectorId, options.readinessReportId, options.approval, options.control);
  return {
    ...plan,
    mode,
    status: "approved",
    actions: plan.actions.map((action) => ({
      ...action,
      dryRun: false,
      status: "planned"
    })),
    approval: options.approval,
    control: options.control,
    readinessReportId: options.readinessReportId
  };
}

export function buildProvisioningPlanAuditInputs(app: RebacLocalApp, plan: ProvisioningPlan): AuditEventInput[] {
  const inputs: AuditEventInput[] = [
    {
      eventType: "provisioning.requested",
      actor: app.actor,
      subjectId: plan.subjectId,
      resourceId: plan.resourceId,
      correlationId: `corr:${plan.id}`,
      payload: asJsonRecord(plan)
    },
    {
      eventType: "provisioning.planned",
      actor: app.actor,
      subjectId: plan.subjectId,
      resourceId: plan.resourceId,
      correlationId: `corr:${plan.id}:planned`,
      payload: {
        planId: plan.id,
        connectorId: plan.connectorId,
        mode: plan.mode,
        status: plan.status,
        actionIds: plan.actions.map((action) => action.actionId),
        idempotencyKeys: plan.actions.map((action) => action.idempotencyKey)
      }
    }
  ];

  if (plan.mode === "enforcement" && plan.approval && plan.control) {
    inputs.push({
      eventType: "provisioning.approved",
      actor: app.actor,
      subjectId: plan.subjectId,
      resourceId: plan.resourceId,
      correlationId: `corr:${plan.id}:approved`,
      payload: {
        planId: plan.id,
        connectorId: plan.connectorId,
        mode: plan.mode,
        status: plan.status,
        approval: plan.approval,
        control: plan.control
      }
    });
  }

  inputs.push(...buildCompensationAuditInputs(app, plan));
  return inputs;
}

export async function executeControlledEnforcementJob(
  app: RebacLocalApp,
  connector: ConnectorAdapter,
  plan: ProvisioningPlan,
  request: ControlledEnforcementJobRequest
): Promise<ControlledEnforcementJobExecution> {
  assertJobControlsMatchPlan(plan, request.approval, request.control);
  const approval = request.approval ?? plan.approval;
  const control = request.control ?? plan.control;
  assertControlledEnforcementAllowed(app, connector, approval, control, request.approverId);
  assertEnforcementReadiness(app, connector, plan.connectorId, plan.readinessReportId, approval, control);

  const appliedPlan = await connector.applyProvisioningChange(plan);
  const completedAt = app.now();
  const verification = await buildEnforcementVerification(connector, appliedPlan, completedAt);
  const completed = appliedPlan.status === "applied" && verification.status === "verified";
  const actionResults = plan.actions.map((action): ProvisioningActionResult => ({
    actionId: action.actionId,
    operation: action.operation,
    status: completed ? "applied" : "failed",
    dryRun: false,
    idempotencyKey: action.idempotencyKey,
    message: completed
      ? "Controlled synthetic enforcement executed through the mock connector and verified by readback."
      : "Controlled enforcement did not verify; rollback or compensation is required.",
    verification: {
      ...action.verification,
      status: verification.status,
      readbackState: verification.readbackState,
      checkedAt: verification.checkedAt,
      message: verification.message
    },
    compensation: action.compensation
  }));
  const jobWithoutAuditIds: ProvisioningJob = {
    id: request.jobId,
    planId: plan.id,
    connectorId: plan.connectorId,
    mode: "enforcement",
    dryRun: false,
    status: completed ? "completed" : "failed",
    approverId: request.approverId,
    idempotencyKey: request.idempotencyKey,
    actionResults,
    verification,
    auditEventIds: [],
    approval,
    control,
    version: "provisioning-job:v1",
    createdAt: request.startedAt,
    startedAt: request.startedAt,
    completedAt
  };
  const updatedPlan: ProvisioningPlan = { ...plan, status: completed ? "applied" : "failed", updatedAt: completedAt };
  const auditInputs = buildControlledEnforcementJobAuditInputs(app, request.jobId, plan, jobWithoutAuditIds, actionResults, verification, completed);

  return {
    completedAt,
    updatedPlan,
    jobWithoutAuditIds,
    auditInputs
  };
}

async function buildEnforcementReadinessChecks(
  connector: ConnectorAdapter,
  control: EnforcementControl,
  checkedAt: string
): Promise<EnforcementReadinessCheck[]> {
  const provider = connector.provider ?? connector.id;
  const tenantBoundary = connector.tenantBoundary ?? "synthetic:unknown";
  const requiredReadScopes = connector.requiredReadScopes ?? [];

  return [
    {
      name: "connector_registered",
      status: "pass",
      message: `${connector.id} is registered.`,
      evidence: { connectorId: connector.id, provider, tenantBoundary }
    },
    {
      name: "synthetic_only_guardrail",
      status: control.syntheticOnly && !control.liveProviderWrites ? "pass" : "fail",
      message: "Phase 4 readiness requires synthetic-only enforcement with live provider writes disabled.",
      evidence: {
        syntheticOnly: control.syntheticOnly,
        liveProviderWrites: control.liveProviderWrites
      }
    },
    {
      name: "mock_enforcement_boundary",
      status: provider === "mock" && tenantBoundary === "synthetic:local" ? "pass" : "fail",
      message: "Phase 4 enforcement readiness is limited to the synthetic mock connector.",
      evidence: { provider, tenantBoundary }
    },
    {
      name: "provisioning_capability",
      status: connector.capabilities.supportsProvisioning ? "pass" : "fail",
      message: "Connector must declare provisioning support before enforcement can be planned.",
      evidence: { supportsProvisioning: connector.capabilities.supportsProvisioning }
    },
    {
      name: "readback_capability",
      status: connector.capabilities.supportsDiscovery && connector.capabilities.supportsReconciliation ? "pass" : "fail",
      message: "Connector must support discovery and reconciliation readback for enforcement verification.",
      evidence: {
        supportsDiscovery: connector.capabilities.supportsDiscovery,
        supportsReconciliation: connector.capabilities.supportsReconciliation,
        requiredReadScopes
      }
    },
    {
      name: "incident_mode_clear",
      status: control.incidentMode ? "fail" : "pass",
      message: "Incident mode must be clear before controlled enforcement can be planned.",
      evidence: { incidentMode: control.incidentMode }
    },
    {
      name: "break_glass_disabled",
      status: control.breakGlass ? "fail" : "pass",
      message: "Break-glass cannot be used for Phase 4 controlled enforcement readiness.",
      evidence: { breakGlass: control.breakGlass }
    },
    await buildRollbackCompensationReadinessCheck(connector, checkedAt),
    {
      name: "least_privilege_review",
      status: provider === "mock" ? "pass" : "fail",
      message: "Live connector least-privilege review remains incomplete for Phase 4.",
      evidence: {
        provider,
        requiredReadScopes,
        liveWriteScopesReviewed: false
      }
    }
  ];
}

async function buildRollbackCompensationReadinessCheck(
  connector: ConnectorAdapter,
  checkedAt: string
): Promise<EnforcementReadinessCheck> {
  try {
    const plan = await connector.planProvisioningChange(createCompensationProbeDecision(checkedAt));
    const actionsWithCompensation = plan.actions.filter(
      (action) =>
        action.compensation?.status === "planned" &&
        typeof action.compensation.idempotencyKey === "string" &&
        action.compensation.idempotencyKey.length > 0
    );
    const hasCompensation = plan.actions.length > 0 && actionsWithCompensation.length === plan.actions.length;

    return {
      name: "rollback_compensation_required",
      status: hasCompensation ? "pass" : "fail",
      message: "Provisioning plans must carry compensation intent before enforcement jobs can run.",
      evidence: {
        compensationRequired: true,
        actionCount: plan.actions.length,
        compensatedActionCount: actionsWithCompensation.length
      }
    };
  } catch (error) {
    return {
      name: "rollback_compensation_required",
      status: "fail",
      message: "Provisioning compensation readiness could not be verified.",
      evidence: { error: error instanceof Error ? error.message : "Unknown compensation probe failure" }
    };
  }
}

function createCompensationProbeDecision(evaluatedAt: string): DecisionResult {
  return {
    decisionId: "decision:enforcement-readiness-compensation-probe",
    decision: "allow",
    subjectId: "user:readiness-probe",
    action: "read",
    resourceId: "document:readiness-probe",
    reasonCode: "ALLOW_READINESS_COMPENSATION_PROBE",
    policyVersion: "readiness-probe",
    modelVersion: "readiness-probe",
    relationshipVersion: "readiness-probe",
    tupleVersion: "readiness-probe",
    contextVersion: "context:none",
    asOf: evaluatedAt,
    relationshipPath: [],
    constraints: {},
    evaluatedAt
  };
}

export function assertEnforcementReadiness(
  app: RebacLocalApp,
  connector: ConnectorAdapter,
  connectorId: string,
  readinessReportId: string | undefined,
  approval: ProvisioningApproval | undefined,
  control: EnforcementControl | undefined
): asserts readinessReportId is string {
  if (!readinessReportId) {
    throw new RebacLocalAppError(
      400,
      "ENFORCEMENT_READINESS_REQUIRED",
      "Controlled enforcement requires a ready connector readiness report."
    );
  }

  const report = app.store.getEnforcementReadinessReport(readinessReportId);

  if (!report) {
    throw new RebacLocalAppError(400, "ENFORCEMENT_READINESS_NOT_FOUND", `Readiness report ${readinessReportId} was not found.`);
  }

  if (report.connectorId !== connectorId) {
    throw new RebacLocalAppError(
      400,
      "ENFORCEMENT_READINESS_CONNECTOR_MISMATCH",
      "The readiness report connector must match the provisioning connector."
    );
  }

  if (report.provider !== (connector.provider ?? connector.id) || report.tenantBoundary !== (connector.tenantBoundary ?? "synthetic:unknown")) {
    throw new RebacLocalAppError(
      400,
      "ENFORCEMENT_READINESS_BOUNDARY_MISMATCH",
      "The readiness report provider boundary must match the current connector registration."
    );
  }

  if (report.status !== "ready") {
    throw new RebacLocalAppError(
      403,
      "ENFORCEMENT_READINESS_BLOCKED",
      "The connector readiness report is blocked and cannot authorize controlled enforcement."
    );
  }

  if (report.liveProviderWritesAllowed) {
    throw new RebacLocalAppError(
      403,
      "ENFORCEMENT_READINESS_LIVE_WRITES_BLOCKED",
      "Phase 4 readiness reports must not allow live provider writes."
    );
  }

  if (control && JSON.stringify(report.control) !== JSON.stringify(control)) {
    throw new RebacLocalAppError(
      400,
      "ENFORCEMENT_READINESS_CONTROL_MISMATCH",
      "The readiness report controls must match the provisioning controls."
    );
  }

  if (approval && !changeTicketMatches(report.changeTicketPattern, approval.changeTicket)) {
    throw new RebacLocalAppError(
      400,
      "ENFORCEMENT_READINESS_CHANGE_TICKET_MISMATCH",
      "The approval change ticket must match the readiness report change-ticket pattern."
    );
  }
}

function assertControlledEnforcementAllowed(
  app: RebacLocalApp,
  connector: ConnectorAdapter,
  approval: ProvisioningApproval | undefined,
  control: EnforcementControl | undefined,
  approverId: string | undefined
): asserts approval is ProvisioningApproval {
  if (!approval) {
    throw new RebacLocalAppError(
      400,
      "CONTROLLED_ENFORCEMENT_APPROVAL_REQUIRED",
      "Controlled enforcement requires an approved change ticket."
    );
  }

  if (!control) {
    throw new RebacLocalAppError(
      400,
      "CONTROLLED_ENFORCEMENT_CONTROL_REQUIRED",
      "Controlled enforcement requires explicit synthetic-only control settings."
    );
  }

  if (approval.decision !== "approved" || !approval.approverId || !approval.changeTicket || !approval.approvedAt) {
    throw new RebacLocalAppError(
      400,
      "CONTROLLED_ENFORCEMENT_APPROVAL_INVALID",
      "Controlled enforcement approval must include decision, approverId, changeTicket, and approvedAt."
    );
  }

  if (approverId && approval.approverId !== approverId) {
    throw new RebacLocalAppError(
      400,
      "CONTROLLED_ENFORCEMENT_APPROVER_MISMATCH",
      "The job approverId must match the approved change ticket."
    );
  }

  if (Number.isNaN(Date.parse(approval.approvedAt))) {
    throw new RebacLocalAppError(
      400,
      "CONTROLLED_ENFORCEMENT_APPROVAL_INVALID",
      "Controlled enforcement approval timestamps must be valid date-times."
    );
  }

  if (approval.expiresAt !== undefined) {
    const expiresAt = Date.parse(approval.expiresAt);
    const now = Date.parse(app.now());

    if (Number.isNaN(expiresAt) || Number.isNaN(now)) {
      throw new RebacLocalAppError(
        400,
        "CONTROLLED_ENFORCEMENT_APPROVAL_INVALID",
        "Controlled enforcement approval timestamps must be valid date-times."
      );
    }

    if (expiresAt <= now) {
      throw new RebacLocalAppError(
        400,
        "CONTROLLED_ENFORCEMENT_APPROVAL_EXPIRED",
        "Controlled enforcement approval has expired."
      );
    }
  }

  if (!control.syntheticOnly || control.liveProviderWrites || control.breakGlass) {
    throw new RebacLocalAppError(
      403,
      "CONTROLLED_ENFORCEMENT_GUARDRAIL_REQUIRED",
      "Phase 4 enforcement must be synthetic-only, must not allow live provider writes, and must not use break-glass."
    );
  }

  if (control.incidentMode) {
    throw new RebacLocalAppError(
      409,
      "CONTROLLED_ENFORCEMENT_INCIDENT_MODE_BLOCKED",
      "Controlled enforcement is blocked while incident mode is active."
    );
  }

  if (!connector.capabilities.supportsProvisioning) {
    throw new RebacLocalAppError(403, "CONNECTOR_ENFORCEMENT_DISABLED", `${connector.id} does not support provisioning.`);
  }

  if (connector.provider !== "mock" || connector.tenantBoundary !== "synthetic:local") {
    throw new RebacLocalAppError(
      403,
      "CONNECTOR_ENFORCEMENT_NOT_ALLOWED",
      "Phase 4 controlled enforcement is limited to the synthetic mock connector."
    );
  }
}

function assertJobControlsMatchPlan(
  plan: ProvisioningPlan,
  approval: ProvisioningApproval | undefined,
  control: EnforcementControl | undefined
): void {
  if (approval && plan.approval && JSON.stringify(approval) !== JSON.stringify(plan.approval)) {
    throw new RebacLocalAppError(
      400,
      "CONTROLLED_ENFORCEMENT_APPROVAL_MISMATCH",
      "The job approval must match the approved provisioning plan."
    );
  }

  if (control && plan.control && JSON.stringify(control) !== JSON.stringify(plan.control)) {
    throw new RebacLocalAppError(
      400,
      "CONTROLLED_ENFORCEMENT_CONTROL_MISMATCH",
      "The job control settings must match the approved provisioning plan."
    );
  }
}

function buildCompensationAuditInputs(app: RebacLocalApp, plan: ProvisioningPlan): AuditEventInput[] {
  return plan.actions
    .filter((action) => action.compensation)
    .map((action) => ({
      eventType: "provisioning.compensation_planned",
      actor: app.actor,
      subjectId: plan.subjectId,
      resourceId: plan.resourceId,
      correlationId: `corr:${plan.id}:${action.actionId}:compensation`,
      payload: {
        planId: plan.id,
        actionId: action.actionId,
        compensation: action.compensation
      }
    }));
}

function buildControlledEnforcementJobAuditInputs(
  app: RebacLocalApp,
  jobId: string,
  plan: ProvisioningPlan,
  jobWithoutAuditIds: ProvisioningJob,
  actionResults: ProvisioningActionResult[],
  verification: ProvisioningVerification,
  completed: boolean
): AuditEventInput[] {
  const auditInputs: AuditEventInput[] = [
    ...actionResults.map((result): AuditEventInput => ({
      eventType: "connector.permission_changed",
      actor: app.actor,
      subjectId: plan.subjectId,
      resourceId: plan.resourceId,
      correlationId: `corr:${jobId}:${result.actionId}:permission-changed`,
      payload: {
        jobId,
        planId: plan.id,
        connectorId: plan.connectorId,
        actionId: result.actionId,
        operation: result.operation,
        dryRun: false,
        syntheticProviderWrite: true,
        liveProviderWrite: false,
        providerWrite: false,
        approval: jobWithoutAuditIds.approval,
        control: jobWithoutAuditIds.control
      }
    })),
    {
      eventType: "provisioning.verified",
      actor: app.actor,
      subjectId: plan.subjectId,
      resourceId: plan.resourceId,
      correlationId: `corr:${jobId}:verified`,
      payload: {
        jobId,
        planId: plan.id,
        connectorId: plan.connectorId,
        verification
      }
    }
  ];

  if (!completed) {
    auditInputs.push(...buildRollbackPlannedAuditInputs(app, jobId, plan));
  }

  auditInputs.push({
    eventType: completed ? "provisioning.completed" : "provisioning.failed",
    actor: app.actor,
    subjectId: plan.subjectId,
    resourceId: plan.resourceId,
    correlationId: `corr:${jobId}:${completed ? "completed" : "failed"}`,
    payload: asJsonRecord(jobWithoutAuditIds)
  });

  return auditInputs;
}

function buildRollbackPlannedAuditInputs(app: RebacLocalApp, jobId: string, plan: ProvisioningPlan): AuditEventInput[] {
  return plan.actions
    .filter((action) => action.compensation)
    .map((action) => ({
      eventType: "provisioning.rollback_planned",
      actor: app.actor,
      subjectId: plan.subjectId,
      resourceId: plan.resourceId,
      correlationId: `corr:${jobId}:${action.actionId}:rollback-planned`,
      payload: {
        jobId,
        planId: plan.id,
        actionId: action.actionId,
        compensation: action.compensation
      }
    }));
}

async function buildEnforcementVerification(
  connector: ConnectorAdapter,
  plan: ProvisioningPlan,
  checkedAt: string
): Promise<ProvisioningVerification> {
  const verified = await connector.verifyProvisioningChange(plan);

  if (verified) {
    return {
      status: "verified",
      method: "connector.verifyProvisioningChange",
      expectedState: {
        planId: plan.id,
        actionCount: plan.actions.length,
        mode: "enforcement"
      },
      readbackState: {
        dryRun: false,
        providerWrite: false,
        syntheticProviderWrite: true,
        liveProviderWrite: false,
        verificationHook: true
      },
      checkedAt,
      message: "Controlled synthetic enforcement verified; no live provider mutation occurred."
    };
  }

  return {
    status: "failed",
    method: "connector.verifyProvisioningChange",
    expectedState: {
      planId: plan.id,
      actionCount: plan.actions.length,
      mode: "enforcement"
    },
    readbackState: {
      dryRun: false,
      providerWrite: false,
      syntheticProviderWrite: false,
      liveProviderWrite: false,
      verificationHook: false
    },
    checkedAt,
    message: "Controlled enforcement verification failed; compensation must be reviewed before retry."
  };
}

function asJsonRecord(value: object): JsonRecord {
  return value as unknown as JsonRecord;
}
