import type { JsonRecord, ValidationCheckStatus } from "./domain.js";

export type LiveEnforcementPilotEnvironment = "pilot_candidate" | "production";
export type LiveEnforcementPilotStatus = "ready" | "blocked";
export type LiveEnforcementPilotHealthStatus = "healthy" | "degraded" | "unknown";
export type LiveEnforcementPilotOperation = "revoke_native_grant";
export type LiveEnforcementPilotResourceRisk = "low" | "moderate" | "high";
export type LiveEnforcementPilotCheckComponent =
  | "connector"
  | "read_only"
  | "approval"
  | "runtime"
  | "verification"
  | "runbook"
  | "release_gate";

export interface LiveEnforcementPilotConnector {
  connectorId: string;
  provider: string;
  tenantBoundary: string;
  mode: "enforcement";
  liveWritesOptIn: boolean;
  allowedWriteScopes: string[];
  forbiddenWriteScopes: string[];
  leastPrivilegeReviewRef: string;
}

export interface LiveEnforcementPilotWritePath {
  operation: LiveEnforcementPilotOperation;
  scope: "single_resource_direct_grant";
  resourceRisk: LiveEnforcementPilotResourceRisk;
  maxActionsPerChange: number;
  revocationPriority: "emergency";
}

export interface LiveEnforcementPilotReadOnlyConfidence {
  minSuccessfulRuns: number;
  successfulRuns: number;
  maxEvidenceAgeHours: number;
  evidenceAgeHours: number;
  nativeReadbackVerified: boolean;
  driftFindingsReviewed: boolean;
  evidenceRefs: string[];
}

export interface LiveEnforcementPilotApprovalWorkflow {
  requiredApproverRoles: string[];
  minApprovers: number;
  separationOfDuties: boolean;
  changeTicketPattern: string;
  approvalExpiresMinutes: number;
  breakGlassProhibited: boolean;
  incidentModeBlocksEnforcement: boolean;
  evidenceRef: string;
}

export interface LiveEnforcementPilotRuntimeGates {
  connectorHealth: LiveEnforcementPilotHealthStatus;
  auditHealth: LiveEnforcementPilotHealthStatus;
  durableQueueRequired: boolean;
  immutableAuditRequired: boolean;
  adminAuthorizationRequired: boolean;
  healthSignalsRequired: boolean;
  degradedConnectorBlocksEnforcement: boolean;
  degradedAuditBlocksEnforcement: boolean;
  revocationsPrioritized: boolean;
  idempotencyRequired: boolean;
  readinessReportRequired: boolean;
  evidenceRefs: string[];
}

export interface LiveEnforcementPilotVerification {
  dryRunFirst: boolean;
  preWriteReadback: boolean;
  postWriteReadback: boolean;
  compensationRequired: boolean;
  rollbackPlanRef: string;
  driftReconciliationRequired: boolean;
  auditEventTypes: string[];
  evidenceRefs: string[];
}

export interface LiveEnforcementPilotReleaseGate {
  status: LiveEnforcementPilotStatus;
  readinessReportRef: string;
  releaseApprovalRef: string;
  outstandingBlockers: string[];
}

export interface LiveEnforcementPilotManifest {
  pilotId: string;
  environment: LiveEnforcementPilotEnvironment;
  generatedAt: string;
  connector: LiveEnforcementPilotConnector;
  writePath: LiveEnforcementPilotWritePath;
  readOnlyConfidence: LiveEnforcementPilotReadOnlyConfidence;
  approvalWorkflow: LiveEnforcementPilotApprovalWorkflow;
  runtimeGates: LiveEnforcementPilotRuntimeGates;
  verification: LiveEnforcementPilotVerification;
  runbookRefs: string[];
  releaseGate: LiveEnforcementPilotReleaseGate;
  evidenceRefs: string[];
  version: "live-enforcement-pilot-manifest:v1";
}

export interface LiveEnforcementPilotReadinessCheck {
  name: string;
  component: LiveEnforcementPilotCheckComponent;
  status: ValidationCheckStatus;
  message: string;
  evidence?: JsonRecord;
}

export interface LiveEnforcementPilotReadinessReport {
  pilotId: string;
  status: LiveEnforcementPilotStatus;
  checkedAt: string;
  checks: LiveEnforcementPilotReadinessCheck[];
  manifest: LiveEnforcementPilotManifest;
  version: "live-enforcement-pilot-readiness:v1";
}

export const requiredLiveEnforcementPilotRunbooks = [
  "runbooks/emergency-revocation.md",
  "runbooks/connector-outage.md",
  "runbooks/decision-api-outage.md",
  "runbooks/policy-rollback.md"
] as const;

export const requiredLiveEnforcementPilotAuditEvents = [
  "connector.enforcement_readiness_checked",
  "provisioning.approved",
  "connector.permission_changed",
  "provisioning.rollback_available",
  "drift.finding_reviewed"
] as const;

export function assessLiveEnforcementPilotReadiness(
  manifest: LiveEnforcementPilotManifest,
  checkedAt: string = new Date().toISOString()
): LiveEnforcementPilotReadinessReport {
  const checks: LiveEnforcementPilotReadinessCheck[] = [
    checkNarrowWritePath(manifest),
    checkReadOnlyConfidence(manifest),
    checkApprovalWorkflow(manifest),
    checkRuntimeGates(manifest),
    checkVerificationAndRollback(manifest),
    checkRunbooks(manifest),
    checkReleaseGate(manifest)
  ];

  return {
    pilotId: manifest.pilotId,
    status: checks.some((check) => check.status === "fail") ? "blocked" : "ready",
    checkedAt,
    checks,
    manifest,
    version: "live-enforcement-pilot-readiness:v1"
  };
}

function checkNarrowWritePath(manifest: LiveEnforcementPilotManifest): LiveEnforcementPilotReadinessCheck {
  const passed =
    manifest.connector.mode === "enforcement" &&
    manifest.connector.liveWritesOptIn &&
    manifest.connector.allowedWriteScopes.length > 0 &&
    manifest.writePath.operation === "revoke_native_grant" &&
    manifest.writePath.scope === "single_resource_direct_grant" &&
    manifest.writePath.maxActionsPerChange === 1 &&
    manifest.writePath.revocationPriority === "emergency" &&
    manifest.writePath.resourceRisk !== "high";

  return createCheck({
    component: "connector",
    name: "pilot_write_path_narrowly_scoped",
    passed,
    passMessage: "Live pilot writes are opt-in and limited to one emergency-priority direct-grant revocation.",
    failMessage: "Live pilot writes must be opt-in and limited to one non-high-risk direct-grant revocation.",
    evidence: {
      connectorId: manifest.connector.connectorId,
      provider: manifest.connector.provider,
      operation: manifest.writePath.operation,
      scope: manifest.writePath.scope,
      maxActionsPerChange: manifest.writePath.maxActionsPerChange,
      resourceRisk: manifest.writePath.resourceRisk
    }
  });
}

function checkReadOnlyConfidence(manifest: LiveEnforcementPilotManifest): LiveEnforcementPilotReadinessCheck {
  const confidence = manifest.readOnlyConfidence;
  const passed =
    confidence.successfulRuns >= confidence.minSuccessfulRuns &&
    confidence.evidenceAgeHours <= confidence.maxEvidenceAgeHours &&
    confidence.nativeReadbackVerified &&
    confidence.driftFindingsReviewed &&
    confidence.evidenceRefs.length > 0;

  return createCheck({
    component: "read_only",
    name: "read_only_confidence_before_writes",
    passed,
    passMessage: "Read-only connector evidence is fresh, repeated, readback-verified, and drift-reviewed.",
    failMessage: "Live pilot writes require fresh read-only confidence, native readback, and reviewed drift findings.",
    evidence: {
      successfulRuns: confidence.successfulRuns,
      minSuccessfulRuns: confidence.minSuccessfulRuns,
      evidenceAgeHours: confidence.evidenceAgeHours,
      maxEvidenceAgeHours: confidence.maxEvidenceAgeHours,
      nativeReadbackVerified: confidence.nativeReadbackVerified,
      driftFindingsReviewed: confidence.driftFindingsReviewed
    }
  });
}

function checkApprovalWorkflow(manifest: LiveEnforcementPilotManifest): LiveEnforcementPilotReadinessCheck {
  const approval = manifest.approvalWorkflow;
  const uniqueApproverRoles = new Set(approval.requiredApproverRoles);
  const passed =
    approval.requiredApproverRoles.length >= approval.minApprovers &&
    uniqueApproverRoles.size === approval.requiredApproverRoles.length &&
    approval.minApprovers >= 2 &&
    approval.separationOfDuties &&
    approval.changeTicketPattern.length > 0 &&
    approval.approvalExpiresMinutes > 0 &&
    approval.approvalExpiresMinutes <= 60 &&
    approval.breakGlassProhibited &&
    approval.incidentModeBlocksEnforcement &&
    approval.evidenceRef.length > 0;

  return createCheck({
    component: "approval",
    name: "approval_workflow_release_gate",
    passed,
    passMessage: "Approval workflow requires separation of duties, expiring approval, and incident/break-glass blocking.",
    failMessage: "Live pilot approval must require two roles, separation of duties, short expiry, and incident/break-glass blocking.",
    evidence: {
      requiredApproverRoles: approval.requiredApproverRoles,
      minApprovers: approval.minApprovers,
      distinctApproverRoles: uniqueApproverRoles.size,
      approvalExpiresMinutes: approval.approvalExpiresMinutes,
      breakGlassProhibited: approval.breakGlassProhibited,
      incidentModeBlocksEnforcement: approval.incidentModeBlocksEnforcement
    }
  });
}

function checkRuntimeGates(manifest: LiveEnforcementPilotManifest): LiveEnforcementPilotReadinessCheck {
  const gates = manifest.runtimeGates;
  const passed =
    gates.connectorHealth === "healthy" &&
    gates.auditHealth === "healthy" &&
    gates.durableQueueRequired &&
    gates.immutableAuditRequired &&
    gates.adminAuthorizationRequired &&
    gates.healthSignalsRequired &&
    gates.degradedConnectorBlocksEnforcement &&
    gates.degradedAuditBlocksEnforcement &&
    gates.revocationsPrioritized &&
    gates.idempotencyRequired &&
    gates.readinessReportRequired &&
    gates.evidenceRefs.length > 0;

  return createCheck({
    component: "runtime",
    name: "runtime_blocks_degraded_enforcement",
    passed,
    passMessage: "Runtime gates require durable queue, immutable audit, healthy connector/audit state, and revocation priority.",
    failMessage: "Live pilot runtime must block degraded connector or audit state before any live write is queued.",
    evidence: {
      connectorHealth: gates.connectorHealth,
      auditHealth: gates.auditHealth,
      durableQueueRequired: gates.durableQueueRequired,
      immutableAuditRequired: gates.immutableAuditRequired,
      degradedConnectorBlocksEnforcement: gates.degradedConnectorBlocksEnforcement,
      degradedAuditBlocksEnforcement: gates.degradedAuditBlocksEnforcement,
      revocationsPrioritized: gates.revocationsPrioritized
    }
  });
}

function checkVerificationAndRollback(manifest: LiveEnforcementPilotManifest): LiveEnforcementPilotReadinessCheck {
  const verification = manifest.verification;
  const requiredAuditEvents = new Set(requiredLiveEnforcementPilotAuditEvents);
  const auditEvents = new Set(verification.auditEventTypes);
  const missingAuditEvents = [...requiredAuditEvents].filter((eventType) => !auditEvents.has(eventType));
  const passed =
    manifest.verification.dryRunFirst &&
    verification.preWriteReadback &&
    verification.postWriteReadback &&
    verification.compensationRequired &&
    verification.rollbackPlanRef.length > 0 &&
    verification.driftReconciliationRequired &&
    verification.evidenceRefs.length > 0 &&
    missingAuditEvents.length === 0;

  return createCheck({
    component: "verification",
    name: "verification_and_rollback_hooks",
    passed,
    passMessage: "Pilot writes require dry-run, pre/post readback, rollback hooks, drift review, and audit coverage.",
    failMessage: "Live pilot writes require dry-run-first verification, rollback hooks, drift reconciliation, and all required audit events.",
    evidence: {
      dryRunFirst: verification.dryRunFirst,
      preWriteReadback: verification.preWriteReadback,
      postWriteReadback: verification.postWriteReadback,
      compensationRequired: verification.compensationRequired,
      rollbackPlanRef: verification.rollbackPlanRef,
      missingAuditEvents
    }
  });
}

function checkRunbooks(manifest: LiveEnforcementPilotManifest): LiveEnforcementPilotReadinessCheck {
  const runbooks = new Set(manifest.runbookRefs);
  const missing = requiredLiveEnforcementPilotRunbooks.filter((runbook) => !runbooks.has(runbook));
  const passed = missing.length === 0;

  return createCheck({
    component: "runbook",
    name: "operational_runbooks_present",
    passed,
    passMessage: "Pilot readiness references emergency revocation, connector outage, decision outage, and rollback runbooks.",
    failMessage: "Live pilot readiness must reference emergency revocation, outage, and rollback runbooks.",
    evidence: {
      runbookRefs: manifest.runbookRefs,
      missing
    }
  });
}

function checkReleaseGate(manifest: LiveEnforcementPilotManifest): LiveEnforcementPilotReadinessCheck {
  const releaseGate = manifest.releaseGate;
  const passed =
    releaseGate.status === "ready" &&
    releaseGate.readinessReportRef.length > 0 &&
    releaseGate.releaseApprovalRef.length > 0 &&
    releaseGate.outstandingBlockers.length === 0;

  return createCheck({
    component: "release_gate",
    name: "release_gate_ready_without_blockers",
    passed,
    passMessage: "Release gate references retained readiness and approval evidence without outstanding blockers.",
    failMessage: "Live pilot release gate must retain approval/readiness evidence and have no outstanding blockers.",
    evidence: {
      status: releaseGate.status,
      readinessReportRef: releaseGate.readinessReportRef,
      releaseApprovalRef: releaseGate.releaseApprovalRef,
      outstandingBlockers: releaseGate.outstandingBlockers
    }
  });
}

function createCheck(input: {
  component: LiveEnforcementPilotCheckComponent;
  name: string;
  passed: boolean;
  passMessage: string;
  failMessage: string;
  evidence?: JsonRecord;
}): LiveEnforcementPilotReadinessCheck {
  return {
    name: input.name,
    component: input.component,
    status: input.passed ? "pass" : "fail",
    message: input.passed ? input.passMessage : input.failMessage,
    evidence: input.evidence
  };
}
