import type {
  CanonicalId,
  DriftAutoRepairPolicy,
  DriftFinding,
  DriftHookEvidence,
  DriftLifecycleState,
  DriftRecommendedAction,
  DriftSeverity,
  ReconciliationScheduleEvidence,
  ReconciliationTrigger
} from "./domain.js";

export interface DriftLifecycleDefaultsOptions {
  now?: string;
  trigger?: ReconciliationTrigger;
  schedule?: Partial<ReconciliationScheduleEvidence>;
  ownerId?: CanonicalId;
  assigneeId?: CanonicalId;
  nativeGrantId?: CanonicalId;
  hookEvidence?: DriftHookEvidence[];
  autoRepairPolicy?: Partial<DriftAutoRepairPolicy>;
}

const severityRank: Record<DriftSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

export function enrichDriftFindingLifecycle(
  finding: DriftFinding,
  options: DriftLifecycleDefaultsOptions = {}
): DriftFinding {
  const now = options.now ?? finding.detectedAt ?? finding.createdAt;
  const scheduledReconciliation = finding.scheduledReconciliation ?? buildReconciliationSchedule(now, options.trigger, options.schedule);
  const exceptionExpiresAt = finding.exceptionExpiresAt;
  const lifecycleState = resolveDriftLifecycleState(finding, now);

  return {
    ...finding,
    nativeGrantId: finding.nativeGrantId ?? options.nativeGrantId,
    lifecycleState,
    ownerId: finding.ownerId ?? options.ownerId ?? defaultDriftOwner(finding.severity),
    assigneeId: finding.assigneeId ?? options.assigneeId ?? defaultDriftAssignee(finding.severity),
    exceptionExpiresAt,
    scheduledReconciliation,
    hookEvidence: finding.hookEvidence ?? options.hookEvidence ?? [],
    remediation: finding.remediation ?? {},
    autoRepairPolicy: {
      ...createDefaultDriftAutoRepairPolicy(finding.severity, finding.recommendedAction),
      ...(finding.autoRepairPolicy ?? {}),
      ...(options.autoRepairPolicy ?? {})
    }
  };
}

export function buildReconciliationSchedule(
  now: string,
  trigger: ReconciliationTrigger = "manual",
  schedule: Partial<ReconciliationScheduleEvidence> = {}
): ReconciliationScheduleEvidence {
  const cadence = schedule.cadence ?? (trigger === "scheduled" ? "daily" : "manual");
  const scheduledAt = schedule.scheduledAt ?? now;
  const gracePeriodHours = schedule.gracePeriodHours ?? defaultGracePeriodHours(cadence);
  const nextRunAt = schedule.nextRunAt ?? nextScheduledRun(scheduledAt, cadence);

  return {
    cadence,
    scheduledAt,
    windowStart: schedule.windowStart,
    windowEnd: schedule.windowEnd,
    nextRunAt,
    gracePeriodHours,
    overdue: schedule.overdue ?? isScheduleOverdue(now, nextRunAt, gracePeriodHours)
  };
}

export function createDefaultDriftAutoRepairPolicy(
  severity: DriftSeverity,
  recommendedAction: DriftRecommendedAction
): DriftAutoRepairPolicy {
  return {
    enabled: false,
    allowedActions: recommendedAction === "repair" || recommendedAction === "revoke" ? [recommendedAction] : [],
    maxSeverity: severity === "critical" ? "high" : severity,
    requireApproval: true,
    requireConnectorReadiness: true,
    liveProviderWrites: false,
    reason: "Auto-repair remains disabled until approval, connector readiness, and live-write policy controls explicitly allow it."
  };
}

export function driftSeverityAllowed(findingSeverity: DriftSeverity, maxSeverity: DriftSeverity): boolean {
  return severityRank[findingSeverity] <= severityRank[maxSeverity];
}

export function resolveDriftLifecycleState(finding: DriftFinding, now: string): DriftLifecycleState {
  if (finding.lifecycleState) {
    return finding.lifecycleState;
  }

  if (finding.exceptionExpiresAt && Date.parse(finding.exceptionExpiresAt) <= Date.parse(now)) {
    return "expired_exception";
  }

  if (finding.status === "accepted") {
    return "accepted";
  }

  if (finding.status === "repairing") {
    return "repairing";
  }

  if (finding.status === "resolved") {
    return "resolved";
  }

  return "open";
}

function defaultDriftOwner(severity: DriftSeverity): CanonicalId {
  return severity === "critical" || severity === "high" ? "role:security-operations" : "role:resource-owner";
}

function defaultDriftAssignee(severity: DriftSeverity): CanonicalId {
  return severity === "critical" ? "role:incident-commander" : "role:security-engineer";
}

function defaultGracePeriodHours(cadence: ReconciliationScheduleEvidence["cadence"]): number {
  if (cadence === "hourly") {
    return 2;
  }

  if (cadence === "weekly") {
    return 48;
  }

  return cadence === "manual" ? 0 : 24;
}

function nextScheduledRun(scheduledAt: string, cadence: ReconciliationScheduleEvidence["cadence"]): string | undefined {
  if (cadence === "manual") {
    return undefined;
  }

  const date = new Date(scheduledAt);
  const hours = cadence === "hourly" ? 1 : cadence === "daily" ? 24 : 24 * 7;
  date.setUTCHours(date.getUTCHours() + hours);
  return date.toISOString();
}

function isScheduleOverdue(now: string, nextRunAt: string | undefined, gracePeriodHours: number): boolean {
  if (!nextRunAt) {
    return false;
  }

  const due = new Date(nextRunAt);
  due.setUTCHours(due.getUTCHours() + gracePeriodHours);
  return Date.parse(now) > due.getTime();
}
