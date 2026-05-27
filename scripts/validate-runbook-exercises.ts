import Ajv2020 from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";
import addFormats from "ajv-formats";
import { deepStrictEqual } from "node:assert";
import { join } from "node:path";
import { readJsonFile } from "./lib/files.js";
import { requireRetainedRepositoryPath } from "./lib/retained-paths.js";

type JsonObject = Record<string, unknown>;

const root = process.cwd();
const schemaPath = "schemas/runbook-exercise.schema.json";
const retainedExercisePath = "deploy/operations/runbook-exercises/rehearsal.example.json";
const schemaFixturePath = "tests/fixtures/schema-examples/runbook-exercise.json";
const requiredScenarioTypes = [
  "incident_response",
  "break_glass",
  "backup_restore",
  "contingency",
  "emergency_revocation",
  "siem_replay",
  "post_action_review"
] as const;
const forbiddenSensitivePatterns = [
  /AKIA[0-9A-Z]{16}/,
  /sk-[A-Za-z0-9_-]{20,}/,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/,
  /password=/i,
  /token=/i,
  /client_secret/i,
  /private_key/i,
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
];

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

const schema = await readJsonFile<AnySchema>(join(root, schemaPath));
const validate = ajv.compile(schema);
const retainedExercise = await readJsonFile<JsonObject>(join(root, retainedExercisePath));
const schemaFixture = await readJsonFile<JsonObject>(join(root, schemaFixturePath));

for (const [label, exercise] of [
  [retainedExercisePath, retainedExercise],
  [schemaFixturePath, schemaFixture]
] as const) {
  if (!validate(exercise)) {
    throw new Error(`${label} failed ${schemaPath}: ${ajv.errorsText(validate.errors)}`);
  }
}

try {
  deepStrictEqual(schemaFixture, retainedExercise);
} catch (cause) {
  throw new Error(`${schemaFixturePath} must match ${retainedExercisePath}.`, { cause });
}

await validateExercise(retainedExercise);

console.log("Validated runbook exercise evidence.");
console.log(
  "PASS Runbook rehearsal evidence covers incident response, break-glass, backup/restore, contingency, emergency revocation, SIEM replay, and post-action review."
);
console.log("PASS Exercise record is deployment-scoped, synthetic, redacted, and not assessor-approved production evidence.");

async function validateExercise(exercise: JsonObject): Promise<void> {
  const serialized = JSON.stringify(exercise);
  for (const pattern of forbiddenSensitivePatterns) {
    if (pattern.test(serialized)) {
      throw new Error(`Runbook exercise evidence contains data matching sensitive pattern ${pattern}.`);
    }
  }

  const deploymentScope = asRecord(exercise.deploymentScope, "deploymentScope");
  requireEquals(deploymentScope.liveTenantData, false, "deploymentScope.liveTenantData");
  requireEquals(deploymentScope.dataSource, "synthetic", "deploymentScope.dataSource");
  readString(deploymentScope.deploymentId, "deploymentScope.deploymentId");
  readString(deploymentScope.tenantBoundary, "deploymentScope.tenantBoundary");

  const classification = asRecord(exercise.classification, "classification");
  requireEquals(classification.evidenceKind, "rehearsed_proof", "classification.evidenceKind");
  requireEquals(classification.assessorApproved, false, "classification.assessorApproved");
  requireEquals(classification.productionOperation, false, "classification.productionOperation");

  const redaction = asRecord(exercise.redaction, "redaction");
  requireEquals(redaction.status, "redacted", "redaction.status");
  requireEquals(redaction.syntheticData, true, "redaction.syntheticData");
  requireEquals(redaction.sensitiveDataIncluded, false, "redaction.sensitiveDataIncluded");

  const retention = asRecord(exercise.retention, "retention");
  requireEquals(retention.location, retainedExercisePath, "retention.location");
  requireNonPlaceholderSha256(readString(retention.packageHash, "retention.packageHash"), "retention.packageHash");

  const scenarioTypes = new Set<string>();
  const scenarios = asArray(exercise.scenarios, "scenarios");
  for (const scenario of scenarios) {
    const record = asRecord(scenario, "scenario");
    const type = readString(record.type, "scenario.type");
    scenarioTypes.add(type);
    const status = readString(record.status, `${type}.status`);
    if (status !== "pass" && status !== "gap") {
      throw new Error(`${type}.status must be "pass" or "gap".`);
    }
    if (status === "gap" && asArray(record.gaps, `${type}.gaps`).length === 0) {
      throw new Error(`${type}.gaps must describe the finding when status is "gap".`);
    }
    await requireExistingPath(readString(record.runbookRef, `${type}.runbookRef`));

    for (const ref of asArray(record.evidenceRefs, `${type}.evidenceRefs`)) {
      await requireExistingPath(readString(ref, `${type}.evidenceRef`));
    }
  }

  for (const requiredType of requiredScenarioTypes) {
    if (!scenarioTypes.has(requiredType)) {
      throw new Error(`Runbook exercise evidence is missing required scenario ${requiredType}.`);
    }
  }

  for (const ref of asArray(exercise.runbookRefs, "runbookRefs")) {
    await requireExistingPath(readString(ref, "runbookRef"));
  }
}

async function requireExistingPath(path: string): Promise<void> {
  await requireRetainedRepositoryPath(path, {
    root,
    label: "Runbook exercise evidence"
  });
}

function requireEquals(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} must be ${String(expected)}.`);
  }
}

function asRecord(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value as JsonObject;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }

  return value;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value;
}

function requireNonPlaceholderSha256(value: string, label: string): void {
  const digest = value.replace(/^sha256:/, "");

  if (/^([a-f0-9])\1{63}$/.test(digest)) {
    throw new Error(`${label} must not be an all-repeated placeholder digest.`);
  }
}
