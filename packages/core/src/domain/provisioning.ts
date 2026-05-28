import type { CanonicalId, IsoDateTime, JsonRecord, ValidationCheckStatus, VersionedEntity } from "./shared.js";

export type ProvisioningMode = "dry_run" | "enforcement";
export type ProvisioningStepStatus = "planned" | "skipped" | "verified" | "applied" | "failed";
export type ProvisioningVerificationStatus = "pending" | "verified" | "skipped" | "failed";
export type ProvisioningCompensationStatus = "planned" | "not_required" | "skipped" | "failed";
export type EnforcementReadinessStatus = "ready" | "blocked";

export interface ProvisioningAction {
  actionId: CanonicalId;
  operation: "grant" | "revoke" | "expire" | "repair" | "verify";
  targetPlatform: string;
  targetObjectId: CanonicalId;
  requestedState: JsonRecord;
  previousState?: JsonRecord;
  dryRun: boolean;
  idempotencyKey: string;
  status: ProvisioningStepStatus;
  verification: ProvisioningVerification;
  compensation?: ProvisioningCompensation;
}

export interface ProvisioningVerification {
  status: ProvisioningVerificationStatus;
  method: string;
  expectedState: JsonRecord;
  readbackState?: JsonRecord;
  checkedAt?: IsoDateTime;
  message?: string;
}

export interface ProvisioningCompensation {
  operation: ProvisioningAction["operation"];
  reason: string;
  status: ProvisioningCompensationStatus;
  idempotencyKey: string;
}

export interface ProvisioningApproval {
  decision: "approved";
  approverId: CanonicalId;
  changeTicket: CanonicalId;
  approvedAt: IsoDateTime;
  expiresAt?: IsoDateTime;
  reason?: string;
}

export interface EnforcementControl {
  syntheticOnly: boolean;
  liveProviderWrites: boolean;
  incidentMode: boolean;
  breakGlass: boolean;
}

export interface EnforcementReadinessCheck {
  name: string;
  status: ValidationCheckStatus;
  message: string;
  evidence?: JsonRecord;
}

export interface EnforcementReadinessReport extends VersionedEntity {
  connectorId: string;
  provider: string;
  tenantBoundary: string;
  mode: "enforcement";
  status: EnforcementReadinessStatus;
  checkedAt: IsoDateTime;
  control: EnforcementControl;
  checks: EnforcementReadinessCheck[];
  requiredApproverRole: string;
  changeTicketPattern: string;
  liveProviderWritesAllowed: boolean;
  auditEventIds: CanonicalId[];
}

export interface ProvisioningPlan extends VersionedEntity {
  sourceDecisionId?: CanonicalId;
  idempotencyKey?: string;
  connectorId: string;
  subjectId: CanonicalId;
  resourceId: CanonicalId;
  action: string;
  mode: ProvisioningMode;
  status: "planned" | "approved" | "applied" | "failed" | "rolled_back";
  actions: ProvisioningAction[];
  approval?: ProvisioningApproval;
  control?: EnforcementControl;
  readinessReportId?: CanonicalId;
}

export interface ProvisioningActionResult {
  actionId: CanonicalId;
  operation: ProvisioningAction["operation"];
  status: ProvisioningStepStatus;
  dryRun: boolean;
  idempotencyKey: string;
  message: string;
  verification: ProvisioningVerification;
  compensation?: ProvisioningCompensation;
}

export interface ProvisioningJob extends VersionedEntity {
  planId: CanonicalId;
  connectorId: string;
  mode: ProvisioningMode;
  dryRun: boolean;
  status: "queued" | "running" | "completed" | "failed" | "rolled_back";
  approverId: CanonicalId;
  idempotencyKey: string;
  actionResults: ProvisioningActionResult[];
  verification: ProvisioningVerification;
  auditEventIds: CanonicalId[];
  approval?: ProvisioningApproval;
  control?: EnforcementControl;
  startedAt: IsoDateTime;
  completedAt?: IsoDateTime;
}
