import Ajv2020 from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";
import addFormats from "ajv-formats";
import { deepStrictEqual } from "node:assert";
import { access } from "node:fs/promises";
import { join } from "node:path";
import {
  assessLiveEnforcementPilotReadiness,
  requiredLiveEnforcementPilotAuditEvents,
  requiredLiveEnforcementPilotRunbooks,
  type LiveEnforcementPilotManifest
} from "../packages/core/src/live-enforcement-pilot.js";
import { readJsonFile } from "./lib/files.js";

type JsonObject = Record<string, unknown>;

const root = process.cwd();
const manifestPath = "deploy/live-enforcement-pilot/manifest.example.json";
const schemaFixturePath = "tests/fixtures/schema-examples/live-enforcement-pilot-manifest.json";
const readinessReportPath = "deploy/live-enforcement-pilot/readiness-report.example.json";
const readinessSchemaFixturePath = "tests/fixtures/schema-examples/live-enforcement-pilot-readiness.json";
const schemaPath = "schemas/live-enforcement-pilot-manifest.schema.json";
const readinessSchemaPath = "schemas/live-enforcement-pilot-readiness.schema.json";

const schema = await readJsonFile<AnySchema>(join(root, schemaPath));
const readinessSchema = await readJsonFile<AnySchema>(join(root, readinessSchemaPath));
const manifest = await readJsonFile<LiveEnforcementPilotManifest>(join(root, manifestPath));
const storedReadinessReport = await readJsonFile<JsonObject>(join(root, readinessReportPath));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
ajv.addSchema(schema);

await requireMatchingFiles(manifestPath, schemaFixturePath, "Live enforcement pilot manifest schema fixture");
await requireMatchingFiles(readinessReportPath, readinessSchemaFixturePath, "Live enforcement pilot readiness schema fixture");

const validateManifest = ajv.compile(schema);
if (!validateManifest(manifest)) {
  throw new Error(`Live enforcement pilot manifest failed schema validation: ${ajv.errorsText(validateManifest.errors)}`);
}

const validateReadinessReport = ajv.compile(readinessSchema);
if (!validateReadinessReport(storedReadinessReport)) {
  throw new Error(`Live enforcement pilot readiness report failed schema validation: ${ajv.errorsText(validateReadinessReport.errors)}`);
}

const expectedStoredReadinessReport = assessLiveEnforcementPilotReadiness(
  manifest,
  readString(storedReadinessReport.checkedAt, "stored readiness report checkedAt")
);
try {
  deepStrictEqual(storedReadinessReport, expectedStoredReadinessReport);
} catch (cause) {
  throw new Error(
    "Live enforcement pilot readiness report is stale. Regenerate deploy/live-enforcement-pilot/readiness-report.example.json.",
    { cause }
  );
}
if (expectedStoredReadinessReport.status !== "ready") {
  const failures = expectedStoredReadinessReport.checks.filter((check) => check.status !== "pass").map((check) => check.name);
  throw new Error(`Live enforcement pilot was not ready: ${failures.join(", ")}`);
}

await requireExistingPath(manifest.connector.leastPrivilegeReviewRef, "least-privilege review");
for (const evidenceRef of allEvidenceRefs(manifest)) {
  await requireExistingPath(evidenceRef, "live enforcement pilot evidence ref");
}
for (const runbookRef of manifest.runbookRefs) {
  await requireExistingPath(runbookRef, "live enforcement pilot runbook ref");
}

validateRequiredRunbooks(manifest);
validateLeastPrivilegeReview(await readEvidence(manifest.connector.leastPrivilegeReviewRef), manifest);
validateReadOnlyConfidence(await readEvidence(manifest.readOnlyConfidence.evidenceRefs[0]), manifest);
validateApprovalWorkflow(await readEvidence(manifest.approvalWorkflow.evidenceRef), manifest);
validateRuntimeGates(await readEvidence(manifest.runtimeGates.evidenceRefs[0]), manifest);
validateVerificationRollback(await readEvidence(manifest.verification.evidenceRefs[0]), manifest);
validateReleaseApproval(await readEvidence(manifest.releaseGate.releaseApprovalRef), manifest);
validatePilotCandidateBoundary(manifest);

console.log("Validated live enforcement pilot gates.");
console.log("PASS Live enforcement pilot manifest, readiness report artifact, approval workflow, least-privilege review, verification, rollback, runbooks, and release gate are wired.");

function allEvidenceRefs(manifest: LiveEnforcementPilotManifest): string[] {
  return [
    manifest.connector.leastPrivilegeReviewRef,
    ...manifest.readOnlyConfidence.evidenceRefs,
    manifest.approvalWorkflow.evidenceRef,
    ...manifest.runtimeGates.evidenceRefs,
    ...manifest.verification.evidenceRefs,
    manifest.releaseGate.readinessReportRef,
    manifest.releaseGate.releaseApprovalRef,
    ...manifest.evidenceRefs
  ];
}

async function readEvidence(path: string | undefined): Promise<JsonObject> {
  return asRecord(await readJsonFile(join(root, readString(path, "evidence path"))), path);
}

function validateRequiredRunbooks(manifest: LiveEnforcementPilotManifest): void {
  const runbooks = new Set(manifest.runbookRefs);
  const missing = requiredLiveEnforcementPilotRunbooks.filter((runbook) => !runbooks.has(runbook));
  if (missing.length > 0) {
    throw new Error(`Live enforcement pilot is missing required runbooks: ${missing.join(", ")}`);
  }
}

function validateLeastPrivilegeReview(evidence: JsonObject, manifest: LiveEnforcementPilotManifest): void {
  requireEquals(evidence.version, "live-enforcement-pilot-least-privilege-review:v1", "least-privilege review version");
  requireEquals(evidence.pilotId, manifest.pilotId, "least-privilege review pilotId");
  requireEquals(evidence.connectorId, manifest.connector.connectorId, "least-privilege review connectorId");
  deepStrictEqual(asArray(evidence.approvedWriteScopes, "approved write scopes"), manifest.connector.allowedWriteScopes);
  deepStrictEqual(asArray(evidence.forbiddenWriteScopes, "forbidden write scopes"), manifest.connector.forbiddenWriteScopes);
}

function validateReadOnlyConfidence(evidence: JsonObject, manifest: LiveEnforcementPilotManifest): void {
  requireEquals(evidence.version, "live-enforcement-pilot-read-only-confidence:v1", "read-only confidence version");
  requireEquals(evidence.pilotId, manifest.pilotId, "read-only confidence pilotId");
  requireEquals(evidence.connectorId, manifest.connector.connectorId, "read-only confidence connectorId");
  requireEquals(evidence.successfulRuns, manifest.readOnlyConfidence.successfulRuns, "read-only successful run count");
  requireEquals(evidence.nativeReadbackVerified, manifest.readOnlyConfidence.nativeReadbackVerified, "native readback verification");
  requireEquals(evidence.driftFindingsReviewed, manifest.readOnlyConfidence.driftFindingsReviewed, "drift review state");
}

function validateApprovalWorkflow(evidence: JsonObject, manifest: LiveEnforcementPilotManifest): void {
  requireEquals(evidence.version, "live-enforcement-pilot-approval-workflow:v1", "approval workflow version");
  requireEquals(evidence.pilotId, manifest.pilotId, "approval workflow pilotId");
  deepStrictEqual(asArray(evidence.requiredApproverRoles, "approval roles"), manifest.approvalWorkflow.requiredApproverRoles);
  requireEquals(evidence.minApprovers, manifest.approvalWorkflow.minApprovers, "approval min approvers");
  requireEquals(evidence.separationOfDuties, true, "approval separation of duties");
  requireEquals(evidence.breakGlassProhibited, true, "approval break-glass block");
  requireEquals(evidence.incidentModeBlocksEnforcement, true, "approval incident-mode block");
}

function validateRuntimeGates(evidence: JsonObject, manifest: LiveEnforcementPilotManifest): void {
  requireEquals(evidence.version, "live-enforcement-pilot-runtime-gates:v1", "runtime gates version");
  requireEquals(evidence.pilotId, manifest.pilotId, "runtime gates pilotId");
  for (const control of [
    "durableQueueRequired",
    "immutableAuditRequired",
    "adminAuthorizationRequired",
    "healthSignalsRequired",
    "degradedConnectorBlocksEnforcement",
    "degradedAuditBlocksEnforcement",
    "revocationsPrioritized",
    "idempotencyRequired",
    "readinessReportRequired"
  ] as const) {
    requireEquals(evidence[control], manifest.runtimeGates[control], `runtime gate ${control}`);
  }
}

function validateVerificationRollback(evidence: JsonObject, manifest: LiveEnforcementPilotManifest): void {
  requireEquals(evidence.version, "live-enforcement-pilot-verification-rollback:v1", "verification rollback version");
  requireEquals(evidence.pilotId, manifest.pilotId, "verification rollback pilotId");
  for (const control of [
    "dryRunFirst",
    "preWriteReadback",
    "postWriteReadback",
    "compensationRequired",
    "driftReconciliationRequired"
  ] as const) {
    requireEquals(evidence[control], manifest.verification[control], `verification control ${control}`);
  }

  const auditEvents = new Set(asArray(evidence.auditEventTypes, "verification audit events"));
  const missing = requiredLiveEnforcementPilotAuditEvents.filter((eventType) => !auditEvents.has(eventType));
  if (missing.length > 0) {
    throw new Error(`Live enforcement pilot verification evidence is missing audit events: ${missing.join(", ")}`);
  }
}

function validateReleaseApproval(evidence: JsonObject, manifest: LiveEnforcementPilotManifest): void {
  requireEquals(evidence.version, "live-enforcement-pilot-release-approval:v1", "release approval version");
  requireEquals(evidence.pilotId, manifest.pilotId, "release approval pilotId");
  requireEquals(evidence.status, manifest.releaseGate.status, "release approval status");
  requireEquals(evidence.readinessReportRef, manifest.releaseGate.readinessReportRef, "release approval readiness ref");
  const controls = asRecord(evidence.releaseControls, "release controls");
  for (const control of [
    "readOnlyConfidenceReviewed",
    "leastPrivilegeReviewed",
    "operationalRunbooksReviewed",
    "emergencyRevocationReviewed",
    "rollbackReviewed",
    "releaseGateRequired"
  ]) {
    requireEquals(controls[control], true, `release control ${control}`);
  }
}

function validatePilotCandidateBoundary(manifest: LiveEnforcementPilotManifest): void {
  const degradedConnector = assessLiveEnforcementPilotReadiness({
    ...manifest,
    runtimeGates: {
      ...manifest.runtimeGates,
      connectorHealth: "degraded"
    }
  });
  const highRisk = assessLiveEnforcementPilotReadiness({
    ...manifest,
    writePath: {
      ...manifest.writePath,
      resourceRisk: "high"
    }
  });
  const broadWriteScope = assessLiveEnforcementPilotReadiness({
    ...manifest,
    connector: {
      ...manifest.connector,
      allowedWriteScopes: ["Directory.ReadWrite.All"]
    }
  });
  const forbiddenScopeOverlap = assessLiveEnforcementPilotReadiness({
    ...manifest,
    connector: {
      ...manifest.connector,
      forbiddenWriteScopes: [...manifest.connector.forbiddenWriteScopes, "GroupMember.ReadWrite.All"]
    }
  });

  if (degradedConnector.status !== "blocked") {
    throw new Error("Live enforcement pilot did not block degraded connector health.");
  }
  if (highRisk.status !== "blocked") {
    throw new Error("Live enforcement pilot did not block high-risk resource writes.");
  }
  if (broadWriteScope.status !== "blocked") {
    throw new Error("Live enforcement pilot did not block broad Microsoft Graph write scopes.");
  }
  if (forbiddenScopeOverlap.status !== "blocked") {
    throw new Error("Live enforcement pilot did not block allowed/forbidden write-scope overlap.");
  }
}

async function requireMatchingFiles(leftPath: string, rightPath: string, label: string): Promise<void> {
  const left = await readJsonFile(join(root, leftPath));
  const right = await readJsonFile(join(root, rightPath));
  try {
    deepStrictEqual(left, right);
  } catch (cause) {
    throw new Error(`${label} must match ${leftPath}.`, { cause });
  }
}

async function requireExistingPath(path: string, label: string): Promise<void> {
  await access(join(root, path)).catch((cause: unknown) => {
    throw new Error(`${label} does not exist: ${path}`, { cause });
  });
}

function asRecord(value: unknown, label: string | undefined): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label ?? "value"} must be an object`);
  }
  return value as JsonObject;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function requireEquals(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} mismatch: expected ${String(expected)}, received ${String(actual)}`);
  }
}
