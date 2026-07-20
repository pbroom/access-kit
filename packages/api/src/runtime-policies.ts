import {
  sha256,
  validatePolicyModel,
  type PersistedPolicyDraft,
  type PersistedPolicySummary,
  type PolicyModelValidationResult
} from "@access-kit/core";
import { RebacLocalAppError, type RebacLocalApp } from "./runtime-app.js";
import { persistAppState } from "./runtime-state.js";

export type PolicyDraft = PersistedPolicyDraft;
export type PolicySummary = PersistedPolicySummary;
export type PolicyValidationResult = PolicyModelValidationResult;

export interface PolicyPublishRequest {
  changeTicket: string;
  approverId: string;
}

export interface PolicyRollbackRequest extends PolicyPublishRequest {
  targetVersion: string;
}

export function listPolicies(app: RebacLocalApp): { items: PolicySummary[] } {
  return { items: app.store.listPolicies().map((record) => record.summary) };
}

export function createPolicy(app: RebacLocalApp, draft: PolicyDraft, idempotencyKey: string): PolicySummary {
  const existing = app.store.getPolicyIdempotencyRecord(`create:${idempotencyKey}`);

  if (existing) {
    return existing.summary;
  }

  const createdAt = app.now();
  const id = `policy:${slugify(draft.name)}:${sha256(draft).slice(0, 12)}`;
  const summary: PolicySummary = {
    id,
    version: `${id}:draft`,
    status: "draft",
    createdAt
  };
  app.store.upsertPolicy({ draft, summary });
  app.store.setPolicyIdempotencyRecord({ key: `create:${idempotencyKey}`, summary });
  persistAppState(app, createdAt);
  return summary;
}

export function validatePolicy(app: RebacLocalApp, policyId: string, mode: "validate" | "test" = "validate"): PolicyValidationResult {
  const existing = app.store.getPolicy(policyId);

  if (!existing) {
    throw new RebacLocalAppError(404, "POLICY_NOT_FOUND", `Policy ${policyId} was not found.`);
  }

  const validation = validatePolicyModel(existing.draft.model);
  const checks = mode === "test" && validation.valid
    ? [
        ...validation.checks,
        {
          name: "proof_points",
          status: "pass" as const,
          message: "Policy model is eligible for deterministic proof-point execution."
        }
      ]
    : validation.checks;
  const result: PolicyValidationResult = { valid: validation.valid, checks };
  const summary =
    validation.valid && ["draft", "rolled_back", "validated"].includes(existing.summary.status)
      ? { ...existing.summary, status: "validated" as const }
      : !validation.valid && existing.summary.status === "validated"
        ? { ...existing.summary, status: "draft" as const }
        : existing.summary;

  app.store.upsertPolicy({ ...existing, summary, validation: result });
  persistAppState(app, policyStateStoredAt(summary));
  return result;
}

export function publishPolicy(app: RebacLocalApp, policyId: string, request: PolicyPublishRequest, idempotencyKey: string): PolicySummary {
  const idempotencyScope = `publish:${policyId}:${idempotencyKey}`;
  const existing = app.store.getPolicyIdempotencyRecord(idempotencyScope);

  if (existing) {
    return existing.summary;
  }

  const prior = app.store.getPolicy(policyId);
  if (!prior) {
    throw new RebacLocalAppError(404, "POLICY_NOT_FOUND", `Policy ${policyId} was not found.`);
  }

  if (prior.summary.status !== "validated") {
    throw new RebacLocalAppError(409, "POLICY_NOT_VALIDATED", `Policy ${policyId} must pass validation before publication.`);
  }

  const validation = validatePolicyModel(prior.draft.model);
  if (!validation.valid) {
    app.store.upsertPolicy({
      ...prior,
      summary: { ...prior.summary, status: "draft" },
      validation
    });
    persistAppState(app, policyStateStoredAt(prior.summary));
    throw new RebacLocalAppError(422, "POLICY_VALIDATION_FAILED", `Policy ${policyId} failed deterministic validation.`);
  }

  // Approval fields are validated at the HTTP boundary but not persisted by the local stub.
  void request;

  const now = app.now();
  const summary: PolicySummary = {
    id: policyId,
    version: `${policyId}:published`,
    status: "published",
    createdAt: prior.summary.createdAt,
    publishedAt: now
  };
  app.store.upsertPolicy({ ...prior, summary, validation });
  app.store.setPolicyIdempotencyRecord({ key: idempotencyScope, summary });
  persistAppState(app, now);
  return summary;
}

export function rollbackPolicy(app: RebacLocalApp, policyId: string, request: PolicyRollbackRequest, idempotencyKey: string): PolicySummary {
  const idempotencyScope = `rollback:${policyId}:${idempotencyKey}`;
  const existing = app.store.getPolicyIdempotencyRecord(idempotencyScope);

  if (existing) {
    return existing.summary;
  }

  const prior = app.store.getPolicy(policyId);
  if (!prior) {
    throw new RebacLocalAppError(404, "POLICY_NOT_FOUND", `Policy ${policyId} was not found.`);
  }

  const summary: PolicySummary = {
    id: policyId,
    version: request.targetVersion,
    status: "rolled_back",
    createdAt: prior.summary.createdAt,
    publishedAt: prior.summary.publishedAt
  };
  app.store.upsertPolicy({ ...prior, summary });
  app.store.setPolicyIdempotencyRecord({ key: idempotencyScope, summary });
  persistAppState(app, policyStateStoredAt(summary));
  return summary;
}

function policyStateStoredAt(summary: PolicySummary): string {
  return summary.publishedAt ?? summary.createdAt;
}

function slugify(value: string): string {
  const slug = value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "");
  return slug || "draft";
}
