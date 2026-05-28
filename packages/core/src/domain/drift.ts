import type { ProvisioningApproval } from "./provisioning.js";
import type { CanonicalId, IsoDateTime, JsonRecord, VersionedEntity } from "./shared.js";

export type DriftSeverity = "low" | "medium" | "high" | "critical";
export type DriftLifecycleState =
  | "open"
  | "triaged"
  | "accepted"
  | "remediation_pending"
  | "repairing"
  | "resolved"
  | "expired_exception";
export type DriftFindingStatus = "open" | "accepted" | "repairing" | "resolved";
export type DriftRecommendedAction = "revoke" | "exception" | "repair" | "review";
export type ReconciliationTrigger = "manual" | "scheduled";

export interface ReconciliationScheduleEvidence {
  cadence: "manual" | "hourly" | "daily" | "weekly";
  scheduledAt: IsoDateTime;
  windowStart?: IsoDateTime;
  windowEnd?: IsoDateTime;
  nextRunAt?: IsoDateTime;
  gracePeriodHours: number;
  overdue: boolean;
}

export interface DriftHookEvidence {
  system: "ticket" | "siem";
  referenceId: CanonicalId;
  status: "pending" | "linked" | "notified" | "failed";
  recordedAt: IsoDateTime;
  url?: string;
  evidence?: JsonRecord;
}

export interface DriftAutoRepairPolicy {
  enabled: boolean;
  allowedActions: Exclude<DriftRecommendedAction, "exception">[];
  maxSeverity: DriftSeverity;
  requireApproval: boolean;
  requireConnectorReadiness: boolean;
  liveProviderWrites: boolean;
  reason?: string;
}

export interface DriftDryRunRepairEvidence {
  planId: CanonicalId;
  mode: "dry_run";
  action: Exclude<DriftRecommendedAction, "exception">;
  status: "planned" | "blocked" | "verified";
  providerWrite: false;
  generatedAt: IsoDateTime;
  idempotencyKey: string;
  evidence: JsonRecord;
}

export interface DriftRemediationEvidence {
  approval?: ProvisioningApproval;
  approvedAt?: IsoDateTime;
  dryRunRepair?: DriftDryRunRepairEvidence;
}

export interface DriftFinding extends VersionedEntity {
  resourceId: CanonicalId;
  subjectId: CanonicalId;
  nativeGrantId?: CanonicalId;
  nativeAccess: string;
  intendedAccess: string;
  severity: DriftSeverity;
  lifecycleState: DriftLifecycleState;
  ownerId: CanonicalId;
  assigneeId: CanonicalId;
  detectedAt: IsoDateTime;
  exceptionExpiresAt?: IsoDateTime;
  sourceConnectorId: string;
  recommendedAction: DriftRecommendedAction;
  status: DriftFindingStatus;
  scheduledReconciliation: ReconciliationScheduleEvidence;
  hookEvidence: DriftHookEvidence[];
  remediation: DriftRemediationEvidence;
  autoRepairPolicy: DriftAutoRepairPolicy;
}

export interface ReconciliationRun extends VersionedEntity {
  connectorId: string;
  mode: "dry_run";
  dryRun: true;
  trigger: ReconciliationTrigger;
  schedule?: ReconciliationScheduleEvidence;
  status: "completed" | "failed";
  findings: DriftFinding[];
  counts: {
    findings: number;
    highOrCritical: number;
  };
  auditEventIds: CanonicalId[];
  completedAt?: IsoDateTime;
}
