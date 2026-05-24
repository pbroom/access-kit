import Ajv2020 from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";
import addFormats from "ajv-formats";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import {
  assessPersistenceDeploymentReadiness,
  type PersistenceBackendDescriptor,
  type PersistenceComponent,
  type PersistenceDeploymentManifest
} from "../packages/core/src/persistence.js";
import { readJsonFile } from "./lib/files.js";

type JsonObject = Record<string, unknown>;

const root = process.cwd();
const manifestPath = "deploy/persistence/production-manifest.example.json";
const schemaPath = "schemas/persistence-deployment-manifest.schema.json";
const checkedAt = "2026-05-24T00:00:00.000Z";

const schema = await readJsonFile<AnySchema>(join(root, schemaPath));
const manifest = await readJsonFile<PersistenceDeploymentManifest>(join(root, manifestPath));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

const validateManifest = ajv.compile(schema);
if (!validateManifest(manifest)) {
  throw new Error(`Persistence deployment manifest failed schema validation: ${ajv.errorsText(validateManifest.errors)}`);
}

const readinessReport = assessPersistenceDeploymentReadiness(manifest, checkedAt);
if (readinessReport.status !== "ready") {
  const failures = readinessReport.checks.filter((check) => check.status !== "pass").map((check) => check.name);
  throw new Error(`Persistence deployment manifest was not ready: ${failures.join(", ")}`);
}

const descriptors = descriptorsByComponent(manifest.descriptors);
for (const component of ["graph", "audit", "job"] as const) {
  if (!descriptors.has(component)) {
    throw new Error(`Persistence deployment manifest is missing ${component} descriptor`);
  }
}

const evidence = await loadEvidenceRefs(manifest);
await validateIacOutputs(evidence.get("deploy/persistence/evidence/iac-outputs.example.json"), descriptors);
await validateReleaseApproval(evidence.get("deploy/persistence/evidence/release-approval.example.json"));
validateBackupRestore(evidence.get("deploy/persistence/evidence/backup-restore.example.json"), descriptors);
await validateOperatorAccess(evidence.get("deploy/persistence/evidence/operator-access.example.json"), manifest);
validateLocalProofPointBlocked(manifest);

console.log("Validated persistence deployment manifest.");
console.log("PASS Production persistence manifest schema, readiness, IaC evidence, release approval, backup/restore, and operator controls are wired.");
console.log("PASS Local proof-point persistence manifests remain blocked from production readiness.");

async function loadEvidenceRefs(manifest: PersistenceDeploymentManifest): Promise<Map<string, JsonObject>> {
  const evidence = new Map<string, JsonObject>();

  for (const ref of manifest.evidenceRefs) {
    if (!ref.startsWith("deploy/persistence/evidence/") || !ref.endsWith(".json")) {
      throw new Error(`Persistence evidence ref must point to deploy/persistence/evidence/*.json: ${ref}`);
    }

    evidence.set(ref, asRecord(await readJsonFile(join(root, ref)), ref));
  }

  return evidence;
}

async function validateIacOutputs(
  evidence: JsonObject | undefined,
  descriptors: Map<PersistenceComponent, PersistenceBackendDescriptor>
): Promise<void> {
  const iac = requireEvidence(evidence, "IaC outputs");
  requireEquals(iac.version, "persistence-iac-outputs:v1", "IaC outputs version");
  requireEquals(iac.environment, "production", "IaC outputs environment");
  await requireExistingPath(readString(iac.deploymentManifestPath, "IaC deployment manifest path"), "IaC deployment manifest path");

  const outputs = asRecord(iac.outputs, "IaC outputs");
  requireEquals(outputs.graphBackendLocation, descriptors.get("graph")?.location, "graph IaC location");
  requireEquals(outputs.auditBackendLocation, descriptors.get("audit")?.location, "audit IaC location");
  requireEquals(outputs.jobBackendLocation, descriptors.get("job")?.location, "job IaC location");
  requireEquals(outputs.namespace, "access-kit", "IaC namespace");
  requireEquals(outputs.stateMountPath, "/var/lib/access-kit", "IaC state mount path");
}

async function validateReleaseApproval(evidence: JsonObject | undefined): Promise<void> {
  const approval = requireEvidence(evidence, "release approval");
  requireEquals(approval.version, "persistence-release-approval:v1", "release approval version");
  requireEquals(approval.environment, "production", "release approval environment");
  await requireExistingPath(readString(approval.releaseWorkflow, "release workflow"), "release workflow");
  const deploymentManifestPath = readString(approval.deploymentManifestPath, "release deployment manifest path");
  await requireExistingPath(deploymentManifestPath, "release deployment manifest path");
  requireEquals(approval.deploymentImage, await readDeploymentImage(deploymentManifestPath), "release deployment image");

  const controls = asRecord(approval.releaseControls, "release controls");
  for (const control of ["digestPinned", "provenanceAttested", "signatureRequired", "changeApprovalRequired"]) {
    requireEquals(controls[control], true, `release control ${control}`);
  }

  const changeTicket = readString(approval.changeTicket, "release change ticket");
  if (!changeTicket.startsWith("CHG-")) {
    throw new Error("release approval change ticket must use CHG-* syntax");
  }
}

function validateBackupRestore(evidence: JsonObject | undefined, descriptors: Map<PersistenceComponent, PersistenceBackendDescriptor>): void {
  const backup = requireEvidence(evidence, "backup/restore");
  requireEquals(backup.version, "persistence-backup-restore:v1", "backup/restore version");
  requireEquals(backup.environment, "production", "backup/restore environment");
  const results = asArray(backup.results, "backup/restore results");

  for (const component of ["graph", "audit", "job"] as const) {
    const result = results.find((entry) => isRecord(entry) && entry.component === component);
    if (!isRecord(result)) {
      throw new Error(`backup/restore evidence is missing ${component} result`);
    }
    requireEquals(result.status, "pass", `${component} backup/restore status`);
    requireEquals(result.location, descriptors.get(component)?.location, `${component} backup/restore location`);
  }
}

async function validateOperatorAccess(evidence: JsonObject | undefined, manifest: PersistenceDeploymentManifest): Promise<void> {
  const access = requireEvidence(evidence, "operator access");
  requireEquals(access.version, "persistence-operator-access:v1", "operator access version");
  requireEquals(access.environment, "production", "operator access environment");
  const controls = asRecord(access.controls, "operator access controls");

  for (const control of [
    "identityProviderBackedAccess",
    "operatorAuthorization",
    "secretsExternalized",
    "monitoringConfigured",
    "migrationPlanReviewed"
  ] as const) {
    requireEquals(controls[control], manifest.controls[control], `operator access control ${control}`);
  }

  for (const ref of asArray(access.evidenceRefs, "operator access evidence refs")) {
    await requireExistingPath(readString(ref, "operator access evidence ref"), "operator access evidence ref");
  }
}

function validateLocalProofPointBlocked(manifest: PersistenceDeploymentManifest): void {
  const localManifest: PersistenceDeploymentManifest = {
    ...manifest,
    environment: "local_proof_point",
    descriptors: [
      {
        component: "graph",
        backend: "local_file",
        durable: false,
        immutable: false,
        capabilities: ["graph_read", "graph_write", "relationship_query", "native_grant_readback"],
        location: "file://var/lib/access-kit/state/graph.json",
        version: "persistence-backend:v1"
      },
      {
        component: "audit",
        backend: "local_file",
        durable: false,
        immutable: false,
        capabilities: ["audit_append", "audit_hash_chain"],
        retentionDays: 30,
        location: "file://var/lib/access-kit/evidence/audit-events.jsonl",
        version: "persistence-backend:v1"
      },
      {
        component: "job",
        backend: "local_file",
        durable: false,
        immutable: false,
        capabilities: ["job_enqueue", "idempotency_lookup"],
        location: "file://var/lib/access-kit/state/jobs.json",
        version: "persistence-backend:v1"
      }
    ]
  };
  const report = assessPersistenceDeploymentReadiness(localManifest, checkedAt);
  const failedChecks = new Set(report.checks.filter((check) => check.status === "fail").map((check) => check.name));

  for (const expectedFailure of [
    "deployment_environment_production",
    "graph_repository_backend_kind",
    "audit_repository_backend_kind",
    "job_repository_backend_kind"
  ]) {
    if (!failedChecks.has(expectedFailure)) {
      throw new Error(`local proof-point manifest did not fail expected check: ${expectedFailure}`);
    }
  }
}

async function readDeploymentImage(path: string): Promise<string> {
  const manifest = YAML.parse(await readFile(join(root, path), "utf8")) as unknown;
  const containers = asArray(
    asRecord(asRecord(asRecord(asRecord(manifest, path).spec, "deployment spec").template, "deployment template").spec, "pod spec").containers,
    "deployment containers"
  );
  const container = containers.find((entry) => isRecord(entry) && entry.name === "rebac-api");

  if (!isRecord(container)) {
    throw new Error("deployment manifest is missing rebac-api container");
  }

  return readString(container.image, "deployment image");
}

function descriptorsByComponent(descriptors: PersistenceBackendDescriptor[]): Map<PersistenceComponent, PersistenceBackendDescriptor> {
  const byComponent = new Map<PersistenceComponent, PersistenceBackendDescriptor>();

  for (const descriptor of descriptors) {
    if (byComponent.has(descriptor.component)) {
      throw new Error(`Persistence deployment manifest has duplicate ${descriptor.component} descriptor`);
    }
    byComponent.set(descriptor.component, descriptor);
  }

  return byComponent;
}

function requireEvidence(evidence: JsonObject | undefined, label: string): JsonObject {
  if (!evidence) {
    throw new Error(`Missing persistence deployment evidence: ${label}`);
  }
  return evidence;
}

async function requireExistingPath(path: string, label: string): Promise<void> {
  if (!path || path.includes("..")) {
    throw new Error(`${label} must be a repository-local path`);
  }

  await readFile(join(root, path), "utf8").catch((error: unknown) => {
    throw new Error(`${label} does not exist at ${path}: ${String(error)}`);
  });
}

function requireEquals(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} expected ${String(expected)} but found ${String(actual)}`);
  }
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function asRecord(value: unknown, label: string): JsonObject {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
}

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
