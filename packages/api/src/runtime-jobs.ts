import type {
  ConnectorAdapter,
  DecisionRequest,
  EnforcementControl,
  EnforcementReadinessReport,
  ProvisioningActionResult,
  ProvisioningApproval,
  ProvisioningJob,
  ProvisioningMode,
  ProvisioningPlan,
  ProvisioningVerification
} from "@access-kit/core";
import { sha256 } from "@access-kit/core";
import { RebacLocalAppError, type RebacLocalApp } from "./runtime-app.js";
import {
  buildProvisioningPlanAuditInputs,
  executeControlledEnforcementJob,
  planEnforcementReadinessReport,
  prepareProvisioningPlanForExecution,
  type EnforcementReadinessRequest,
  type ProvisioningExecutionOptions
} from "./runtime-enforcement.js";
import { asJsonRecord, compactTimestamp, getConnector, getDefaultConnectorId, nextAppRecordSequence } from "./runtime-shared.js";
import {
  commitRuntimePersistence,
  persistAppState,
  persistJobDecision,
  persistJobEnforcementReadinessReport,
  persistJobProvisioningJob,
  persistJobProvisioningPlan,
  recordAudit
} from "./runtime-state.js";

export async function checkEnforcementReadiness(
  app: RebacLocalApp,
  connectorId: string,
  request: EnforcementReadinessRequest
): Promise<EnforcementReadinessReport> {
  const connector = getConnector(app, connectorId);
  const checkedAt = app.now();
  const reportId = createEnforcementReadinessReportId(app, connectorId, checkedAt);
  const planned = await planEnforcementReadinessReport(app, connector, connectorId, request, reportId, checkedAt);
  const auditEvent = recordAudit(app, planned.auditInput, { persistState: false });
  const report = { ...planned.report, auditEventIds: [auditEvent.eventId] };
  app.store.recordEnforcementReadinessReport(report);
  persistJobEnforcementReadinessReport(app, report, checkedAt);
  persistAppState(app, checkedAt);
  return report;
}

function createEnforcementReadinessReportId(app: RebacLocalApp, connectorId: string, checkedAt: string): string {
  const reports = app.store.listEnforcementReadinessReports({ connectorId });
  const sequence = nextAppRecordSequence(app, `readiness:${connectorId}`, reports.length);
  return `readiness:${connectorId}:${compactTimestamp(checkedAt)}:${sequence}`;
}

export function listEnforcementReadinessReports(
  app: RebacLocalApp,
  connectorId: string,
  status?: EnforcementReadinessReport["status"]
): EnforcementReadinessReport[] {
  getConnector(app, connectorId);
  return app.store.listEnforcementReadinessReports({ connectorId, status });
}

export async function createProvisioningPlan(
  app: RebacLocalApp,
  request: DecisionRequest,
  connectorId = getDefaultConnectorId(app),
  options: ProvisioningExecutionOptions = {},
  idempotencyKey?: string
): Promise<ProvisioningPlan> {
  return createProvisioningPlanFlow(
    app,
    connectorId,
    options,
    idempotencyKey,
    (existing) => planMatchesDecisionRequest(existing, request, connectorId, options),
    (connector) => {
      const decision = app.engine.explain(request);
      persistJobDecision(app, decision);
      return connector.planProvisioningChange(decision);
    }
  );
}

export async function createRevocationPlan(
  app: RebacLocalApp,
  nativeGrantId: string,
  connectorId = getDefaultConnectorId(app),
  options: ProvisioningExecutionOptions = {},
  idempotencyKey?: string
): Promise<ProvisioningPlan> {
  return createProvisioningPlanFlow(
    app,
    connectorId,
    options,
    idempotencyKey,
    (existing) => planMatchesRevocationRequest(existing, nativeGrantId, connectorId, options),
    (connector) => connector.revokeAccess(nativeGrantId)
  );
}

async function createProvisioningPlanFlow(
  app: RebacLocalApp,
  connectorId: string,
  options: ProvisioningExecutionOptions,
  idempotencyKey: string | undefined,
  matchesExisting: (plan: ProvisioningPlan) => boolean,
  prepareConnectorPlan: (connector: ConnectorAdapter) => Promise<ProvisioningPlan>
): Promise<ProvisioningPlan> {
  const connector = getConnector(app, connectorId);
  const existing = idempotencyKey ? app.store.getProvisioningPlanByIdempotencyKey(idempotencyKey) : undefined;

  if (existing) {
    if (!matchesExisting(existing)) {
      throw new RebacLocalAppError(
        409,
        "IDEMPOTENCY_KEY_REUSED",
        "Idempotency-Key was already used for a different provisioning plan request."
      );
    }

    return existing;
  }

  const plan = {
    ...prepareProvisioningPlanForExecution(app, connector, normalizePlanConnector(await prepareConnectorPlan(connector), connectorId), options),
    idempotencyKey
  };
  app.store.upsertProvisioningPlan(plan);
  recordProvisioningPlanAudit(app, plan);
  commitRuntimePersistence(app, plan.createdAt, [
    () => persistJobProvisioningPlan(app, plan, plan.createdAt)
  ]);
  return plan;
}

function recordProvisioningPlanAudit(app: RebacLocalApp, plan: ProvisioningPlan): void {
  for (const auditInput of buildProvisioningPlanAuditInputs(app, plan)) {
    recordAudit(app, auditInput, { persistState: false });
  }
}

export async function createProvisioningJob(
  app: RebacLocalApp,
  request: {
    planId: string;
    approverId: string;
    idempotencyKey: string;
    mode?: ProvisioningMode;
    approval?: ProvisioningApproval;
    control?: EnforcementControl;
  }
): Promise<ProvisioningJob | undefined> {
  const existing = app.store.getProvisioningJobByIdempotencyKey(request.idempotencyKey);

  if (existing) {
    if (existing.planId !== request.planId || existing.approverId !== request.approverId) {
      throw new RebacLocalAppError(
        409,
        "IDEMPOTENCY_KEY_REUSED",
        "Idempotency-Key was already used for a different provisioning job request."
      );
    }

    return existing;
  }

  const plan = app.store.getProvisioningPlan(request.planId);

  if (!plan) {
    return undefined;
  }

  const connector = getConnector(app, plan.connectorId);
  const startedAt = app.now();
  const jobId = `job:${sha256({ planId: request.planId, idempotencyKey: request.idempotencyKey }).slice(0, 24)}`;
  const requestedMode = request.mode ?? plan.mode;

  if (requestedMode !== plan.mode) {
    throw new RebacLocalAppError(400, "PROVISIONING_MODE_MISMATCH", `Plan ${plan.id} is ${plan.mode}, not ${requestedMode}.`);
  }

  if (requestedMode === "enforcement") {
    return createControlledEnforcementJob(app, connector, plan, {
      ...request,
      jobId,
      startedAt
    });
  }

  const verification = await buildDryRunVerification(connector, plan, app.now);
  const completedAt = verification.checkedAt ?? app.now();
  const actionResults = plan.actions.map((action): ProvisioningActionResult => ({
    actionId: action.actionId,
    operation: action.operation,
    status: "skipped",
    dryRun: true,
    idempotencyKey: action.idempotencyKey,
    message: "Dry-run only: provider write was not executed.",
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
    id: jobId,
    planId: plan.id,
    connectorId: plan.connectorId,
    mode: "dry_run",
    dryRun: true,
    status: "completed",
    approverId: request.approverId,
    idempotencyKey: request.idempotencyKey,
    actionResults,
    verification,
    auditEventIds: [],
    version: "provisioning-job:v1",
    createdAt: startedAt,
    startedAt,
    completedAt
  };
  app.store.upsertProvisioningJob(jobWithoutAuditIds);
  const auditEventIds = [
    ...actionResults.map((result) =>
      recordAudit(app, {
        eventType: "provisioning.skipped",
        actor: app.actor,
        subjectId: plan.subjectId,
        resourceId: plan.resourceId,
        correlationId: `corr:${jobId}:${result.actionId}:skipped`,
        payload: {
          jobId,
          planId: plan.id,
          actionId: result.actionId,
          operation: result.operation,
          dryRun: true,
          reason: result.message,
          providerWrite: false
      }
      }, { persistState: false }).eventId
    ),
    recordAudit(app, {
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
    }, { persistState: false }).eventId,
    recordAudit(app, {
      eventType: "provisioning.completed",
      actor: app.actor,
      subjectId: plan.subjectId,
      resourceId: plan.resourceId,
      correlationId: `corr:${jobId}:completed`,
      payload: asJsonRecord(jobWithoutAuditIds)
    }, { persistState: false }).eventId
  ];
  const job = { ...jobWithoutAuditIds, auditEventIds };
  app.store.upsertProvisioningJob(job);
  persistJobProvisioningJob(app, job, completedAt);
  persistAppState(app, completedAt);
  return job;
}

async function createControlledEnforcementJob(
  app: RebacLocalApp,
  connector: ConnectorAdapter,
  plan: ProvisioningPlan,
  request: {
    planId: string;
    approverId: string;
    idempotencyKey: string;
    jobId: string;
    startedAt: string;
    approval?: ProvisioningApproval;
    control?: EnforcementControl;
  }
): Promise<ProvisioningJob> {
  const execution = await executeControlledEnforcementJob(app, connector, plan, request);
  app.store.upsertProvisioningPlan(execution.updatedPlan);
  app.store.upsertProvisioningJob(execution.jobWithoutAuditIds);
  const auditEventIds = execution.auditInputs.map((auditInput) =>
    recordAudit(app, auditInput, { persistState: false }).eventId
  );
  const job = { ...execution.jobWithoutAuditIds, auditEventIds };
  app.store.upsertProvisioningJob(job);
  persistJobProvisioningPlan(app, execution.updatedPlan, execution.completedAt);
  persistJobProvisioningJob(app, job, execution.completedAt);
  persistAppState(app, execution.completedAt);
  return job;
}

export function getProvisioningJob(app: RebacLocalApp, jobId: string): ProvisioningJob | undefined {
  return app.store.getProvisioningJob(jobId);
}

function normalizePlanConnector(plan: ProvisioningPlan, connectorId: string): ProvisioningPlan {
  return {
    ...plan,
    connectorId
  };
}

function planMatchesDecisionRequest(
  plan: ProvisioningPlan,
  request: DecisionRequest,
  connectorId: string,
  options: ProvisioningExecutionOptions
): boolean {
  return (
    plan.connectorId === connectorId &&
    plan.subjectId === request.subjectId &&
    plan.resourceId === request.resourceId &&
    plan.action === request.action &&
    planMatchesExecutionOptions(plan, options)
  );
}

function planMatchesRevocationRequest(
  plan: ProvisioningPlan,
  nativeGrantId: string,
  connectorId: string,
  options: ProvisioningExecutionOptions
): boolean {
  return (
    plan.connectorId === connectorId &&
    plan.actions.some((action) => action.operation === "revoke" && action.requestedState.nativeGrantId === nativeGrantId) &&
    planMatchesExecutionOptions(plan, options, { ignoreApprovalApprovedAt: true })
  );
}

function planMatchesExecutionOptions(
  plan: ProvisioningPlan,
  options: ProvisioningExecutionOptions,
  replayOptions: { ignoreApprovalApprovedAt?: boolean } = {}
): boolean {
  return (
    plan.mode === (options.mode ?? "dry_run") &&
    JSON.stringify(normalizeApprovalForReplay(plan.approval, replayOptions) ?? null) ===
      JSON.stringify(normalizeApprovalForReplay(options.approval, replayOptions) ?? null) &&
    JSON.stringify(plan.control ?? null) === JSON.stringify(options.control ?? null) &&
    (plan.readinessReportId ?? null) === (options.readinessReportId ?? null)
  );
}

function normalizeApprovalForReplay(
  approval: ProvisioningApproval | undefined,
  options: { ignoreApprovalApprovedAt?: boolean }
): ProvisioningApproval | undefined {
  if (!approval || options.ignoreApprovalApprovedAt !== true) {
    return approval;
  }

  return {
    ...approval,
    approvedAt: "idempotency-replay-normalized"
  };
}

async function buildDryRunVerification(
  connector: ConnectorAdapter,
  plan: ProvisioningPlan,
  now: () => string
): Promise<ProvisioningVerification> {
  const verified = await connector.verifyProvisioningChange(plan);
  const checkedAt = now();

  if (verified) {
    return {
      status: "verified",
      method: "connector.verifyProvisioningChange",
      expectedState: {
        planId: plan.id,
        actionCount: plan.actions.length
      },
      readbackState: {
        dryRun: true,
        providerWrite: false,
        verificationHook: true
      },
      checkedAt,
      message: "Dry-run verification hook completed without provider mutation."
    };
  }

  return {
    status: "skipped",
    method: "connector.verifyProvisioningChange",
    expectedState: {
      planId: plan.id,
      actionCount: plan.actions.length
    },
    readbackState: {
      dryRun: true,
      providerWrite: false,
      verificationHook: false
    },
    checkedAt,
    message: "Connector did not provide positive dry-run verification; provider write remains skipped."
  };
}
