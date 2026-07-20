import {
  buildReconciliationSchedule,
  driftSeverityAllowed,
  enrichDriftFindingLifecycle,
  type DriftAutoRepairPolicy,
  type DriftFinding,
  type DriftHookEvidence,
  type ProvisioningApproval,
  type ReconciliationRun,
  type ReconciliationScheduleEvidence,
  type ReconciliationTrigger
} from "@access-kit/core";
import { RebacLocalAppError, type RebacLocalApp } from "./runtime-app.js";
import { assertEnforcementReadiness } from "./runtime-enforcement.js";
import { createProvisioningPlan, createRevocationPlan } from "./runtime-jobs.js";
import { asJsonRecord, compactTimestamp, getConnector, nextAppRecordSequence } from "./runtime-shared.js";
import {
  persistAppState,
  persistJobDriftFinding,
  persistJobReconciliationRun,
  recordAudit
} from "./runtime-state.js";

export interface ReconciliationRunOptions {
  trigger?: ReconciliationTrigger;
  schedule?: Partial<ReconciliationScheduleEvidence>;
}

export interface DriftRemediationPlanRequest {
  approval: ProvisioningApproval;
  autoRepairPolicy: DriftAutoRepairPolicy;
  readinessReportId?: string;
  hookEvidence?: DriftHookEvidence[];
}

export async function runReconciliation(
  app: RebacLocalApp,
  connectorId: string,
  options: ReconciliationRunOptions = {}
): Promise<ReconciliationRun> {
  const connector = getConnector(app, connectorId);
  const startedAt = app.now();
  const trigger = options.trigger ?? "manual";
  const schedule = buildReconciliationSchedule(startedAt, trigger, options.schedule);
  const existingRuns = app.store.listReconciliationRuns().filter((run) => run.connectorId === connectorId).length;
  const runSequence = nextAppRecordSequence(app, `reconciliation:${connectorId}`, existingRuns);
  const findings = (await connector.detectDrift()).map((finding) =>
    enrichDriftFindingLifecycle(finding, {
      now: startedAt,
      trigger,
      schedule,
      nativeGrantId: finding.nativeGrantId ?? inferNativeGrantIdForFinding(app, finding)
    })
  );
  const auditEventIds: string[] = [];

  for (const finding of findings) {
    app.store.upsertDriftFinding(finding);
    persistJobDriftFinding(app, finding, finding.detectedAt);
    const event = recordAudit(app, {
      eventType: "drift.detected",
      actor: app.actor,
      subjectId: finding.subjectId,
      resourceId: finding.resourceId,
      correlationId: `corr:${finding.id}`,
      payload: asJsonRecord(finding)
    });
    auditEventIds.push(event.eventId);
  }

  const completedAt = app.now();
  const run: ReconciliationRun = {
    id: `reconciliation:${connectorId}:${compactTimestamp(startedAt)}:${runSequence}`,
    connectorId,
    mode: "dry_run",
    dryRun: true,
    trigger,
    schedule,
    status: "completed",
    findings,
    counts: {
      findings: findings.length,
      highOrCritical: findings.filter((finding) => finding.severity === "high" || finding.severity === "critical").length
    },
    auditEventIds,
    version: "reconciliation-run:v1",
    createdAt: startedAt,
    completedAt
  };
  const completedEvent = recordAudit(app, {
    eventType: "reconciliation.completed",
    actor: app.actor,
    correlationId: `corr:${run.id}:completed`,
    payload: {
      runId: run.id,
      connectorId,
      dryRun: true,
      trigger,
      schedule,
      counts: run.counts,
      findingIds: findings.map((finding) => finding.id)
    }
  }, { persistState: false });
  const completedRun = { ...run, auditEventIds: [...auditEventIds, completedEvent.eventId] };
  app.store.recordReconciliationRun(completedRun);
  persistJobReconciliationRun(app, completedRun, completedAt);
  persistAppState(app, completedAt);
  return completedRun;
}

export async function planDriftRemediationDryRun(
  app: RebacLocalApp,
  findingId: string,
  request: DriftRemediationPlanRequest,
  idempotencyKey: string
): Promise<DriftFinding | undefined> {
  const finding = app.store.getDriftFinding(findingId);

  if (!finding) {
    return undefined;
  }

  assertDriftRemediationControls(finding, request);
  assertEnforcementReadiness(
    app,
    getConnector(app, finding.sourceConnectorId),
    finding.sourceConnectorId,
    request.readinessReportId,
    request.approval,
    undefined
  );
  const nativeGrantId = finding.nativeGrantId ?? inferNativeGrantIdForFinding(app, finding);

  if (!nativeGrantId && finding.recommendedAction === "revoke") {
    throw new RebacLocalAppError(
      409,
      "DRIFT_REPAIR_TARGET_MISSING",
      `Finding ${finding.id} cannot be dry-run repaired because no native grant target is available.`
    );
  }

  const plan = finding.recommendedAction === "revoke" && nativeGrantId
    ? await createRevocationPlan(app, nativeGrantId, finding.sourceConnectorId, { mode: "dry_run" }, idempotencyKey)
    : await createProvisioningPlan(app, {
        subjectId: finding.subjectId,
        resourceId: finding.resourceId,
        action: finding.intendedAccess === "none" ? "review" : finding.intendedAccess
      }, finding.sourceConnectorId, { mode: "dry_run" }, idempotencyKey);
  const plannedAt = app.now();
  const hookEvidence = mergeDriftHookEvidence(finding.hookEvidence, request.hookEvidence ?? []);
  const remediationAction = driftRemediationAction(finding.recommendedAction);
  const updatedFinding = enrichDriftFindingLifecycle({
    ...finding,
    nativeGrantId,
    status: "repairing",
    lifecycleState: "repairing",
    hookEvidence,
    autoRepairPolicy: request.autoRepairPolicy,
    remediation: {
      ...finding.remediation,
      approval: request.approval,
      approvedAt: request.approval.approvedAt,
      dryRunRepair: {
        planId: plan.id,
        mode: "dry_run",
        action: remediationAction,
        status: "planned",
        providerWrite: false,
        generatedAt: plannedAt,
        idempotencyKey,
        evidence: {
          connectorId: finding.sourceConnectorId,
          readinessReportId: request.readinessReportId,
          planId: plan.id,
          actionIds: plan.actions.map((action) => action.actionId),
          dryRun: true,
          liveProviderWrites: false
        }
      }
    },
    updatedAt: plannedAt
  }, { now: plannedAt });

  app.store.upsertDriftFinding(updatedFinding);
  persistJobDriftFinding(app, updatedFinding, plannedAt);
  recordAudit(app, {
    eventType: "drift.remediation_approved",
    actor: app.actor,
    subjectId: updatedFinding.subjectId,
    resourceId: updatedFinding.resourceId,
    correlationId: `corr:${updatedFinding.id}:remediation-approved`,
    payload: {
      findingId: updatedFinding.id,
      approval: request.approval,
      autoRepairPolicy: request.autoRepairPolicy,
      readinessReportId: request.readinessReportId,
      hookEvidence
    }
  }, { persistState: false });
  recordAudit(app, {
    eventType: "drift.repair_dry_run_planned",
    actor: app.actor,
    subjectId: updatedFinding.subjectId,
    resourceId: updatedFinding.resourceId,
    correlationId: `corr:${updatedFinding.id}:repair-dry-run`,
    payload: {
      findingId: updatedFinding.id,
      planId: plan.id,
      providerWrite: false,
      liveProviderWrites: false,
      dryRunRepair: updatedFinding.remediation.dryRunRepair
    }
  }, { persistState: false });
  persistAppState(app, plannedAt);
  return updatedFinding;
}

function inferNativeGrantIdForFinding(app: RebacLocalApp, finding: DriftFinding): string | undefined {
  const candidateGrants = app.store.listNativeGrants({
    sourceConnectorId: finding.sourceConnectorId,
    targetObjectId: finding.resourceId,
    subjectId: finding.subjectId
  });
  const matchingGrant = candidateGrants.find((grant) => grant.nativePermission === finding.nativeAccess)
    ?? candidateGrants.at(0);

  return matchingGrant?.id;
}

function assertDriftRemediationControls(finding: DriftFinding, request: DriftRemediationPlanRequest): void {
  const policy = request.autoRepairPolicy;

  if (policy.liveProviderWrites) {
    throw new RebacLocalAppError(
      403,
      "DRIFT_AUTO_REPAIR_LIVE_WRITES_BLOCKED",
      "Drift remediation dry-runs cannot enable live provider writes."
    );
  }

  if (!policy.requireApproval || !request.approval) {
    throw new RebacLocalAppError(
      409,
      "DRIFT_REMEDIATION_APPROVAL_REQUIRED",
      "Drift remediation requires explicit approval evidence."
    );
  }

  if (!policy.requireConnectorReadiness) {
    throw new RebacLocalAppError(
      409,
      "DRIFT_CONNECTOR_READINESS_REQUIRED",
      "Drift remediation must require connector readiness before any auto-repair policy can be accepted."
    );
  }

  if (!driftSeverityAllowed(finding.severity, policy.maxSeverity)) {
    throw new RebacLocalAppError(
      409,
      "DRIFT_AUTO_REPAIR_SEVERITY_BLOCKED",
      `Finding ${finding.id} severity ${finding.severity} exceeds auto-repair policy maximum ${policy.maxSeverity}.`
    );
  }

  const remediationAction = driftRemediationAction(finding.recommendedAction);
  if (!policy.allowedActions.includes(remediationAction)) {
    throw new RebacLocalAppError(
      409,
      "DRIFT_AUTO_REPAIR_ACTION_BLOCKED",
      `Finding ${finding.id} recommended action ${remediationAction} is not allowed by policy.`
    );
  }
}

function driftRemediationAction(action: DriftFinding["recommendedAction"]): Exclude<DriftFinding["recommendedAction"], "exception"> {
  return action === "exception" ? "review" : action;
}

function mergeDriftHookEvidence(existing: DriftHookEvidence[], incoming: DriftHookEvidence[]): DriftHookEvidence[] {
  const hooks = new Map(existing.map((hook) => [`${hook.system}:${hook.referenceId}`, hook]));

  for (const hook of incoming) {
    hooks.set(`${hook.system}:${hook.referenceId}`, hook);
  }

  return [...hooks.values()];
}
