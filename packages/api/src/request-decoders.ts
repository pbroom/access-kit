import {
  type DecisionRequest,
  type DriftAutoRepairPolicy,
  type DriftHookEvidence,
  type EnforcementControl,
  type JsonRecord,
  type ProvisioningApproval,
  type ProvisioningMode,
  type ReconciliationScheduleEvidence,
  type ReconciliationTrigger,
  type RelationshipTuple,
  type Resource,
  type Subject
} from "@access-kit/core";
import { HttpError } from "./api-http.js";
import { type PolicyDraft } from "./local-app.js";
import { validateRuntimeRequestSchema, type RuntimeRequestSchemaName } from "./request-schemas.js";
import { isSafeChangeTicketPattern } from "./runtime-provisioning.js";

interface ProvisioningPlanPayload {
  subjectId?: string;
  action?: string;
  resourceId?: string;
  context?: JsonRecord;
  mode?: ProvisioningMode;
  dryRun: boolean;
  grantId?: string;
  connectorId?: string;
  approval?: ProvisioningApproval;
  control?: EnforcementControl;
  readinessReportId?: string;
}

interface ProvisioningJobPayload {
  planId: string;
  approverId: string;
  mode?: ProvisioningMode;
  dryRun?: boolean;
  approval?: ProvisioningApproval;
  control?: EnforcementControl;
}

interface DriftRemediationPayload {
  approval?: ProvisioningApproval;
  autoRepairPolicy?: DriftAutoRepairPolicy;
  readinessReportId?: string;
  hookEvidence?: DriftHookEvidence[];
}

interface EnforcementReadinessPayload {
  mode?: "enforcement";
  control?: EnforcementControl;
  requiredApproverRole?: string;
  changeTicketPattern?: string;
}

export interface ProvisioningExecutionRequest {
  mode: ProvisioningMode;
  approval?: ProvisioningApproval;
  control?: EnforcementControl;
  readinessReportId?: string;
}

export type DecodedProvisioningPlanRequest =
  | {
      kind: "decision";
      decisionRequest: DecisionRequest;
      connectorId?: string;
      execution: ProvisioningExecutionRequest;
    }
  | {
      kind: "revocation";
      grantId: string;
      connectorId?: string;
      execution: ProvisioningExecutionRequest;
    };

export interface DecodedProvisioningJobRequest {
  planId: string;
  approverId: string;
  mode: ProvisioningMode;
  approval?: ProvisioningApproval;
  control?: EnforcementControl;
}

export interface DecodedDriftRemediationRequest {
  approval: ProvisioningApproval;
  autoRepairPolicy: DriftAutoRepairPolicy;
  readinessReportId?: string;
  hookEvidence?: DriftHookEvidence[];
}

export interface DecodedEnforcementReadinessRequest {
  mode: "enforcement";
  control: EnforcementControl;
  requiredApproverRole?: string;
  changeTicketPattern?: string;
}

const driftSeverities = new Set(["low", "medium", "high", "critical"]);

export function decodeDecisionRequest(value: unknown): DecisionRequest {
  return normalizeDecisionRequest(
    decodeSchemaBacked<DecisionRequest>(
      "decisionRequest",
      value,
      "INVALID_DECISION_REQUEST",
      "Decision requests require subjectId, action, and resourceId"
    )
  );
}

export function decodeDecisionBatchRequest(value: unknown): DecisionRequest[] {
  const parsed = decodeSchemaBacked<{ requests: DecisionRequest[] }>(
    "decisionBatch",
    value,
    "INVALID_BATCH_REQUESTS",
    "batch-check requires a requests array of decision requests"
  );

  return parsed.requests.map((item) => normalizeDecisionRequest(item));
}

export function decodeSubject(value: unknown): Subject {
  return decodeSchemaBacked<Subject>(
    "subject",
    value,
    "INVALID_SUBJECT",
    "subjects require the canonical subject schema"
  );
}

export function decodeResource(value: unknown): Resource {
  return decodeSchemaBacked<Resource>(
    "resource",
    value,
    "INVALID_RESOURCE",
    "resources require the canonical resource schema"
  );
}

export function decodeRelationship(value: unknown): RelationshipTuple {
  return decodeSchemaBacked<RelationshipTuple>(
    "relationship",
    value,
    "INVALID_RELATIONSHIP",
    "relationships require the canonical relationship schema"
  );
}

export function decodePolicyDraft(value: unknown): PolicyDraft {
  return decodeSchemaBacked<PolicyDraft>(
    "policyDraft",
    value,
    "INVALID_POLICY_DRAFT",
    "policy drafts require name, model, and tests"
  );
}

export function decodePolicyValidationMode(value: unknown): "validate" | "test" | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (value.mode === "validate" || value.mode === "test") {
    return value.mode;
  }

  return undefined;
}

export function decodePolicyPublishRequest(value: unknown): { changeTicket: string; approverId: string } {
  return decodeSchemaBacked<{ changeTicket: string; approverId: string }>(
    "policyPublish",
    value,
    "INVALID_POLICY_PUBLISH_REQUEST",
    "policy publish requires changeTicket and approverId"
  );
}

export function decodePolicyRollbackRequest(value: unknown): {
  targetVersion: string;
  changeTicket: string;
  approverId: string;
} {
  return decodeSchemaBacked<{ targetVersion: string; changeTicket: string; approverId: string }>(
    "policyRollback",
    value,
    "INVALID_POLICY_ROLLBACK_REQUEST",
    "policy rollback requires targetVersion, changeTicket, and approverId"
  );
}

export function decodeProvisioningPlanRequest(value: unknown): DecodedProvisioningPlanRequest {
  const parsed = decodeSchemaBacked<ProvisioningPlanPayload>(
    "provisioningPlan",
    value,
    "INVALID_PROVISIONING_REQUEST",
    "Provisioning plans require a dry-run or controlled enforcement request"
  );
  const execution = decodeProvisioningExecution(parsed);
  const connectorId = decodeConnectorId(parsed.connectorId);

  if (parsed.grantId !== undefined) {
    return {
      kind: "revocation",
      grantId: parsed.grantId,
      connectorId,
      execution
    };
  }

  const decisionRequest = decodeProvisioningDecisionRequest(parsed);
  if (!decisionRequest) {
    throw new HttpError(
      400,
      "INVALID_PROVISIONING_REQUEST",
      "Provisioning plans require subjectId, action, and resourceId or a grantId"
    );
  }

  return {
    kind: "decision",
    decisionRequest,
    connectorId,
    execution
  };
}

export function decodeProvisioningJobRequest(value: unknown): DecodedProvisioningJobRequest {
  const parsed = decodeSchemaBacked<ProvisioningJobPayload>(
    "provisioningJob",
    value,
    "INVALID_PROVISIONING_JOB_REQUEST",
    "Provisioning jobs require planId and approverId"
  );

  return {
    planId: parsed.planId,
    approverId: parsed.approverId,
    mode: decodeProvisioningMode(parsed.mode, parsed.dryRun),
    approval: decodeProvisioningApproval(parsed.approval),
    control: decodeEnforcementControl(parsed.control)
  };
}

export function decodeReconciliationRunRequest(value: unknown): {
  connectorId: string;
  dryRun: true;
  trigger?: ReconciliationTrigger;
  schedule?: Partial<ReconciliationScheduleEvidence>;
} {
  return decodeSchemaBacked<{
    connectorId: string;
    dryRun: true;
    trigger?: ReconciliationTrigger;
    schedule?: Partial<ReconciliationScheduleEvidence>;
  }>(
    "reconciliationRun",
    value,
    "INVALID_RECONCILIATION_REQUEST",
    "Reconciliation runs require connectorId and dryRun: true"
  );
}

export function decodeDriftRemediationRequest(value: unknown): DecodedDriftRemediationRequest {
  const parsed = decodeSchemaBacked<DriftRemediationPayload>(
    "driftRemediation",
    value,
    "INVALID_DRIFT_REMEDIATION_REQUEST",
    "Drift remediation requires approval, autoRepairPolicy, and dry-run hook evidence"
  );

  if (!isProvisioningApproval(parsed.approval)) {
    throw new HttpError(400, "INVALID_DRIFT_REMEDIATION_REQUEST", "approval must match the provisioning approval shape");
  }

  if (!isDriftAutoRepairPolicy(parsed.autoRepairPolicy)) {
    throw new HttpError(400, "INVALID_DRIFT_REMEDIATION_REQUEST", "autoRepairPolicy must include safe dry-run controls");
  }

  if (parsed.hookEvidence !== undefined && !isDriftHookEvidenceArray(parsed.hookEvidence)) {
    throw new HttpError(400, "INVALID_DRIFT_REMEDIATION_REQUEST", "hookEvidence must contain ticket or SIEM hook evidence");
  }

  return {
    approval: parsed.approval,
    autoRepairPolicy: parsed.autoRepairPolicy,
    readinessReportId: decodeReadinessReportId(parsed.readinessReportId),
    hookEvidence: parsed.hookEvidence
  };
}

export function decodeEnforcementReadinessRequest(value: unknown): DecodedEnforcementReadinessRequest {
  const parsed = decodeSchemaBacked<EnforcementReadinessPayload>(
    "enforcementReadiness",
    value,
    "INVALID_ENFORCEMENT_READINESS_REQUEST",
    "Enforcement readiness requires a control block"
  );

  if (parsed.mode !== undefined && parsed.mode !== "enforcement") {
    throw new HttpError(400, "INVALID_ENFORCEMENT_READINESS_MODE", "enforcement readiness mode must be enforcement");
  }

  if (parsed.requiredApproverRole !== undefined && !parsed.requiredApproverRole) {
    throw new HttpError(400, "INVALID_APPROVER_ROLE", "requiredApproverRole must be a non-empty string when provided");
  }

  if (parsed.changeTicketPattern !== undefined && !parsed.changeTicketPattern) {
    throw new HttpError(400, "INVALID_CHANGE_TICKET_PATTERN", "changeTicketPattern must be a non-empty string when provided");
  }

  if (typeof parsed.changeTicketPattern === "string") {
    assertRegularExpression(parsed.changeTicketPattern);
  }

  return {
    mode: "enforcement",
    control: decodeRequiredEnforcementControl(parsed.control),
    requiredApproverRole: parsed.requiredApproverRole,
    changeTicketPattern: parsed.changeTicketPattern
  };
}

export function decodeConnectorSyncRequest(value: unknown): "read_only" {
  const parsed = decodeSchemaBacked<{ mode: "read_only" }>(
    "connectorSync",
    value,
    "UNSUPPORTED_CONNECTOR_MODE",
    "connector sync requires mode read_only"
  );

  return decodeDiscoveryMode(parsed.mode);
}

function decodeSchemaBacked<T>(
  schemaName: RuntimeRequestSchemaName,
  value: unknown,
  code: string,
  message: string
): T {
  const errors = validateRuntimeRequestSchema(schemaName, value);

  if (errors.length > 0) {
    throw new HttpError(400, code, `${message}: ${errors.join("; ")}`);
  }

  return value as T;
}

function normalizeDecisionRequest(value: DecisionRequest): DecisionRequest {
  return {
    subjectId: value.subjectId,
    action: value.action,
    resourceId: value.resourceId,
    context: value.context,
    policyVersion: value.policyVersion,
    modelVersion: value.modelVersion,
    relationshipVersion: value.relationshipVersion,
    tupleVersion: value.tupleVersion,
    contextVersion: value.contextVersion,
    asOf: value.asOf
  };
}

function decodeProvisioningDecisionRequest(value: ProvisioningPlanPayload): DecisionRequest | undefined {
  if (!value.subjectId || !value.action || !value.resourceId) {
    return undefined;
  }

  return {
    subjectId: value.subjectId,
    action: value.action,
    resourceId: value.resourceId,
    context: value.context
  };
}

function decodeProvisioningExecution(value: ProvisioningPlanPayload): ProvisioningExecutionRequest {
  return {
    mode: decodeProvisioningMode(value.mode, value.dryRun),
    approval: decodeProvisioningApproval(value.approval),
    control: decodeEnforcementControl(value.control),
    readinessReportId: decodeReadinessReportId(value.readinessReportId)
  };
}

function decodeDiscoveryMode(mode: unknown): "read_only" {
  if (mode === "read_only") {
    return "read_only";
  }

  if (mode === undefined) {
    throw new HttpError(400, "MISSING_CONNECTOR_MODE", "connector sync mode is required and must be read_only");
  }

  throw new HttpError(400, "UNSUPPORTED_CONNECTOR_MODE", "Phase 2 connector sync supports read_only mode only");
}

function decodeProvisioningMode(mode: unknown, dryRun: unknown): ProvisioningMode {
  if (mode === undefined) {
    if (dryRun === true) {
      return "dry_run";
    }

    throw new HttpError(
      400,
      "DRY_RUN_REQUIRED",
      "Provisioning defaults to dry-run; enforcement must explicitly request mode: enforcement and dryRun: false"
    );
  }

  if (mode === "dry_run") {
    if (dryRun === true) {
      return "dry_run";
    }

    throw new HttpError(400, "DRY_RUN_REQUIRED", "Dry-run provisioning requires dryRun: true");
  }

  if (mode === "enforcement") {
    if (dryRun === false) {
      return "enforcement";
    }

    throw new HttpError(400, "ENFORCEMENT_DRY_RUN_FALSE_REQUIRED", "Controlled enforcement requires dryRun: false");
  }

  throw new HttpError(400, "INVALID_PROVISIONING_MODE", "mode must be dry_run or enforcement");
}

function decodeProvisioningApproval(value: unknown): ProvisioningApproval | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (
    !isRecord(value) ||
    value.decision !== "approved" ||
    typeof value.approverId !== "string" ||
    typeof value.changeTicket !== "string" ||
    typeof value.approvedAt !== "string" ||
    (value.expiresAt !== undefined && typeof value.expiresAt !== "string") ||
    (value.reason !== undefined && typeof value.reason !== "string")
  ) {
    throw new HttpError(
      400,
      "INVALID_PROVISIONING_APPROVAL",
      "approval must include decision: approved, approverId, changeTicket, and approvedAt"
    );
  }

  const approvedAt = decodeProvisioningApprovalDateTime(value.approvedAt, "approvedAt");
  const expiresAt =
    value.expiresAt === undefined ? undefined : decodeProvisioningApprovalDateTime(value.expiresAt, "expiresAt");

  return {
    decision: value.decision,
    approverId: value.approverId,
    changeTicket: value.changeTicket,
    approvedAt,
    expiresAt,
    reason: value.reason
  };
}

function decodeProvisioningApprovalDateTime(value: string, fieldName: string): string {
  if (Number.isNaN(Date.parse(value))) {
    throw new HttpError(
      400,
      "INVALID_PROVISIONING_APPROVAL",
      `approval.${fieldName} must be a valid date-time`
    );
  }

  return value;
}

function decodeEnforcementControl(value: unknown): EnforcementControl | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (
    !isRecord(value) ||
    typeof value.syntheticOnly !== "boolean" ||
    typeof value.liveProviderWrites !== "boolean" ||
    typeof value.incidentMode !== "boolean" ||
    typeof value.breakGlass !== "boolean"
  ) {
    throw new HttpError(
      400,
      "INVALID_ENFORCEMENT_CONTROL",
      "control must include syntheticOnly, liveProviderWrites, incidentMode, and breakGlass booleans"
    );
  }

  return {
    syntheticOnly: value.syntheticOnly,
    liveProviderWrites: value.liveProviderWrites,
    incidentMode: value.incidentMode,
    breakGlass: value.breakGlass
  };
}

function decodeRequiredEnforcementControl(value: unknown): EnforcementControl {
  const control = decodeEnforcementControl(value);

  if (!control) {
    throw new HttpError(400, "INVALID_ENFORCEMENT_CONTROL", "control is required for enforcement readiness checks");
  }

  return control;
}

function assertRegularExpression(pattern: string): void {
  if (!isSafeChangeTicketPattern(pattern)) {
    throw new HttpError(
      400,
      "INVALID_CHANGE_TICKET_PATTERN",
      "changeTicketPattern must be a valid safe regular expression without groups, alternation, or backreferences"
    );
  }
}

function decodeReadinessReportId(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || !value) {
    throw new HttpError(400, "INVALID_READINESS_REPORT_ID", "readinessReportId must be a non-empty string when provided");
  }

  return value;
}

function decodeConnectorId(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || !value) {
    throw new HttpError(400, "INVALID_CONNECTOR_ID", "connectorId must be a non-empty string when provided");
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isProvisioningApproval(value: unknown): value is ProvisioningApproval {
  return isRecord(value)
    && value.decision === "approved"
    && typeof value.approverId === "string"
    && typeof value.changeTicket === "string"
    && typeof value.approvedAt === "string";
}

function isDriftAutoRepairPolicy(value: unknown): value is DriftAutoRepairPolicy {
  if (!isRecord(value)) {
    return false;
  }

  const allowedActions = value.allowedActions;

  return typeof value.enabled === "boolean"
    && Array.isArray(allowedActions)
    && allowedActions.every((action) => action === "revoke" || action === "repair" || action === "review")
    && typeof value.maxSeverity === "string"
    && driftSeverities.has(value.maxSeverity)
    && typeof value.requireApproval === "boolean"
    && typeof value.requireConnectorReadiness === "boolean"
    && typeof value.liveProviderWrites === "boolean";
}

function isDriftHookEvidenceArray(value: unknown): value is DriftHookEvidence[] {
  return Array.isArray(value)
    && value.every((hook) =>
      isRecord(hook)
      && (hook.system === "ticket" || hook.system === "siem")
      && typeof hook.referenceId === "string"
      && (hook.status === "pending" || hook.status === "linked" || hook.status === "notified" || hook.status === "failed")
      && typeof hook.recordedAt === "string"
    );
}
