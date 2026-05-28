import { verifyAuditChain } from "./audit.js";
import { finalizeEvidenceExport, type EvidenceExportDraft } from "./evidence-integrity.js";
import type {
  AuditEvent,
  CanonicalId,
  DecisionResult,
  EvidenceExport,
  IsoDateTime,
  ProvisioningPlan
} from "./domain.js";

export interface ReadOnlyDryRunPlanOptions {
  readonly connectorId: string;
  readonly request: DecisionResult;
  readonly createdAt: IsoDateTime;
  readonly targetObjectId?: CanonicalId;
  readonly verificationMethod?: string;
  readonly compensationReason?: string;
}

export interface ReadOnlyNoWriteApplyFailureOptions {
  readonly checkedAt?: IsoDateTime;
  readonly verificationMessage?: string;
}

export interface ReadOnlyRevocationPlanOptions {
  readonly connectorId: string;
  readonly nativeGrantId: CanonicalId;
  readonly resourceId: CanonicalId;
  readonly createdAt: IsoDateTime;
  readonly subjectId?: CanonicalId;
  readonly verificationMethod?: string;
  readonly compensationReason?: string;
}

export type ReadOnlyConnectorEvidenceDraft = Omit<
  EvidenceExportDraft,
  "periodStart" | "periodEnd" | "generatedAt" | "sourceEventIds" | "auditIntegrity" | "siemExport"
> & Partial<Pick<EvidenceExportDraft, "siemExport">>;

export interface ReadOnlyConnectorEvidenceOptions {
  readonly events: readonly AuditEvent[];
  readonly generatedAt: IsoDateTime;
  readonly draft: ReadOnlyConnectorEvidenceDraft;
}

const defaultVerificationMethod = "connector.current_access_readback";
const defaultDryRunCompensationReason = "Reverse provider state if later enforcement does not verify cleanly.";
const defaultRevocationCompensationReason = "Restore previous native grant if revocation verification fails after enforcement is enabled.";

export function createReadOnlyDryRunPlan(options: ReadOnlyDryRunPlanOptions): ProvisioningPlan {
  const operation = options.request.decision === "allow" ? "grant" : "revoke";
  const compensationOperation = options.request.decision === "allow" ? "revoke" : "grant";
  const targetObjectId = options.targetObjectId ?? options.request.resourceId;
  const requestedState = { subjectId: options.request.subjectId, permission: options.request.action };
  const expectedState = { subjectId: options.request.subjectId, permission: options.request.action };

  return {
    id: `plan:${options.connectorId}:${options.request.decisionId}`,
    sourceDecisionId: options.request.decisionId,
    connectorId: options.connectorId,
    subjectId: options.request.subjectId,
    resourceId: options.request.resourceId,
    action: options.request.action,
    mode: "dry_run",
    status: "planned",
    actions: [
      {
        actionId: `action:${options.connectorId}:${options.request.decisionId}`,
        operation,
        targetPlatform: options.connectorId,
        targetObjectId,
        requestedState,
        dryRun: true,
        idempotencyKey: `${options.connectorId}:${options.request.subjectId}:${options.request.action}:${options.request.resourceId}:${options.request.policyVersion}`,
        status: "planned",
        verification: {
          status: "pending",
          method: options.verificationMethod ?? defaultVerificationMethod,
          expectedState
        },
        compensation: {
          operation: compensationOperation,
          reason: options.compensationReason ?? defaultDryRunCompensationReason,
          status: "planned",
          idempotencyKey: `compensate:${options.connectorId}:${options.request.subjectId}:${options.request.action}:${options.request.resourceId}:${options.request.policyVersion}`
        }
      }
    ],
    version: "plan:v1",
    createdAt: options.createdAt
  };
}

export function createReadOnlyNoWriteApplyFailure(
  plan: ProvisioningPlan,
  options: ReadOnlyNoWriteApplyFailureOptions = {}
): ProvisioningPlan {
  const updateVerification = options.checkedAt !== undefined || options.verificationMessage !== undefined;

  return {
    ...plan,
    status: "failed",
    actions: plan.actions.map((action) => ({
      ...action,
      status: "failed",
      verification: updateVerification
        ? {
            ...action.verification,
            status: "failed",
            checkedAt: options.checkedAt ?? action.verification.checkedAt,
            message: options.verificationMessage ?? action.verification.message
          }
        : action.verification
    }))
  };
}

export function createReadOnlyRevocationPlan(options: ReadOnlyRevocationPlanOptions): ProvisioningPlan {
  const requestedState = { nativeGrantId: options.nativeGrantId, status: "revoked" };
  const expectedState = { nativeGrantId: options.nativeGrantId, status: "revoked" };

  return {
    id: `plan:revoke:${options.connectorId}:${options.nativeGrantId}`,
    connectorId: options.connectorId,
    subjectId: options.subjectId ?? "subject:unknown",
    resourceId: options.resourceId,
    action: "revoke",
    mode: "dry_run",
    status: "planned",
    actions: [
      {
        actionId: `action:revoke:${options.connectorId}:${options.nativeGrantId}`,
        operation: "revoke",
        targetPlatform: options.connectorId,
        targetObjectId: options.resourceId,
        requestedState,
        dryRun: true,
        idempotencyKey: `revoke:${options.connectorId}:${options.nativeGrantId}`,
        status: "planned",
        verification: {
          status: "pending",
          method: options.verificationMethod ?? defaultVerificationMethod,
          expectedState
        },
        compensation: {
          operation: "grant",
          reason: options.compensationReason ?? defaultRevocationCompensationReason,
          status: "planned",
          idempotencyKey: `compensate:${options.connectorId}:${options.nativeGrantId}`
        }
      }
    ],
    version: "plan:v1",
    createdAt: options.createdAt
  };
}

export function readOnlyConnectorSourceEventIds(events: readonly AuditEvent[]): CanonicalId[] {
  return events.map((event) => event.eventId);
}

export function deriveReadOnlyConnectorEvidencePeriod(
  events: readonly AuditEvent[],
  now: IsoDateTime
): Pick<EvidenceExport, "periodStart" | "periodEnd"> {
  const occurredAt = events.map((event) => event.occurredAt).sort();

  return {
    periodStart: occurredAt.at(0) ?? now,
    periodEnd: occurredAt.at(-1) ?? now
  };
}

export function createReadOnlyConnectorEvidenceExport(options: ReadOnlyConnectorEvidenceOptions): EvidenceExport {
  const { siemExport, ...draft } = options.draft;
  const evidencePeriod = deriveReadOnlyConnectorEvidencePeriod(options.events, options.generatedAt);
  const sourceEventIds = readOnlyConnectorSourceEventIds(options.events);

  return finalizeEvidenceExport({
    ...draft,
    periodStart: evidencePeriod.periodStart,
    periodEnd: evidencePeriod.periodEnd,
    generatedAt: options.generatedAt,
    sourceEventIds,
    auditIntegrity: verifyAuditChain([...options.events], options.generatedAt),
    siemExport: siemExport ?? {
      format: "jsonl",
      eventCount: options.events.length,
      schemaVersion: "audit-event:v1",
      includesPayloadHashes: true,
      target: "operator_download"
    }
  });
}
