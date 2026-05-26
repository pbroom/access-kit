import Ajv2020 from "ajv/dist/2020.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  InMemoryRebacStore,
  RebacDecisionEngine,
  validatePolicyModel,
  type DecisionRequest,
  type DecisionValue,
  type JsonRecord,
  type PolicyModel,
  type RelationshipPathStep,
  type RelationshipTuple,
  type Resource,
  type Subject
} from "../packages/core/src/index.js";

interface SamplePolicyManifest {
  repositoryId: string;
  currentPolicyVersion: string;
  ci: {
    workflow: string;
    command: string;
  };
  models: VersionedArtifact[];
  migrations: MigrationArtifact[];
  tupleFixtures: TupleFixtureArtifact[];
  regressionSnapshots: SnapshotArtifact[];
  generatedExamples: GeneratedExampleArtifact[];
}

interface VersionedArtifact {
  version: string;
  path: string;
}

interface MigrationArtifact {
  fromVersion: string;
  toVersion: string;
  path: string;
}

interface TupleFixtureArtifact {
  policyVersion: string;
  relationshipVersion: string;
  path: string;
}

interface SnapshotArtifact {
  policyVersion: string;
  relationshipVersion: string;
  path: string;
}

interface GeneratedExampleArtifact {
  caseName: string;
  requestPath: string;
  responsePath: string;
}

interface MigrationFile {
  id: string;
  fromVersion: string;
  toVersion: string;
  operations: string[];
  regressionSnapshot: string;
  generatedExamples: string[];
}

interface TupleFixture {
  policyVersion: string;
  relationshipVersion: string;
  subjects: Subject[];
  resources: Resource[];
  relationships: RelationshipTuple[];
}

interface RegressionSnapshot {
  policyVersion: string;
  relationshipVersion: string;
  evaluatedAt: string;
  cases: RegressionCase[];
}

interface RegressionCase {
  name: string;
  evaluatedAt?: string;
  request: DecisionRequest;
  expected: ExpectedDecision;
}

interface ExpectedDecision {
  decision: DecisionValue;
  reasonCode: string;
  policyVersion: string;
  relationshipVersion: string;
  relationshipPath: RelationshipPathStep[];
}

const root = process.cwd();
const sampleRoot = join(root, "examples", "sample-policy-repository");
const forbiddenIdentifierPattern = /(?:@|secret|token|password|prod(?:uction)?|tenant-[0-9a-f]{6,})/i;
const ajv = new Ajv2020({ allErrors: true, strict: false });

const manifest = await readSampleJson<SamplePolicyManifest>("policy-repository.json");
const modelSchema = await readSchemaJson<JsonRecord>("schemas/policy-model.schema.json");
const validateModelSchema = ajv.compile(modelSchema);

if (manifest.ci.command !== "pnpm validate:sample-policy") {
  throw new Error("Sample policy repository CI command must be pnpm validate:sample-policy.");
}

const models = new Map<string, PolicyModel>();
for (const artifact of manifest.models) {
  const model = await readSampleJson<PolicyModel>(artifact.path);

  if (model.version !== artifact.version) {
    throw new Error(`${artifact.path} declares ${model.version}, expected ${artifact.version}.`);
  }

  if (!validateModelSchema(model)) {
    throw new Error(`${artifact.path} failed policy-model schema validation: ${ajv.errorsText(validateModelSchema.errors)}`);
  }

  const result = validatePolicyModel(model);
  if (!result.valid) {
    const failures = result.checks
      .filter((check) => check.status === "fail")
      .map((check) => check.message ?? check.name)
      .join("; ");
    throw new Error(`${artifact.path} failed deterministic policy validation: ${failures}`);
  }

  requireTenantAndClassificationBoundaries(model, artifact.path);
  models.set(model.version, model);
}

if (!models.has(manifest.currentPolicyVersion)) {
  throw new Error(`Current policy version ${manifest.currentPolicyVersion} is not listed in model artifacts.`);
}

for (const artifact of manifest.migrations) {
  const migration = await readSampleJson<MigrationFile>(artifact.path);
  if (migration.fromVersion !== artifact.fromVersion || migration.toVersion !== artifact.toVersion) {
    throw new Error(`${artifact.path} does not match manifest migration ${artifact.fromVersion} -> ${artifact.toVersion}.`);
  }
  if (!models.has(migration.fromVersion) || !models.has(migration.toVersion)) {
    throw new Error(`${artifact.path} references a model version that is not checked in.`);
  }
  if (migration.operations.length === 0) {
    throw new Error(`${artifact.path} must declare reviewable migration operations.`);
  }
  const sourceModel = models.get(migration.fromVersion)!;
  const embeddedMigration = sourceModel.migrations.find((item) => item.toVersion === migration.toVersion);
  if (!embeddedMigration) {
    throw new Error(`${artifact.path} is not represented in ${migration.fromVersion} model migrations.`);
  }
}

const fixturesByRelationshipVersion = new Map<string, TupleFixture>();
for (const artifact of manifest.tupleFixtures) {
  const fixture = await readSampleJson<TupleFixture>(artifact.path);
  if (fixture.policyVersion !== artifact.policyVersion || fixture.relationshipVersion !== artifact.relationshipVersion) {
    throw new Error(`${artifact.path} does not match manifest policy or relationship version.`);
  }
  if (!models.has(fixture.policyVersion)) {
    throw new Error(`${artifact.path} references unknown policy version ${fixture.policyVersion}.`);
  }
  requireSyntheticFixtureBoundary(fixture, artifact.path);
  fixturesByRelationshipVersion.set(fixture.relationshipVersion, fixture);
}

const casesByName = new Map<string, RegressionCase>();
let denyDefaultCases = 0;
let tenantBoundaryCases = 0;
let explicitDenyCases = 0;

for (const artifact of manifest.regressionSnapshots) {
  const snapshot = await readSampleJson<RegressionSnapshot>(artifact.path);
  if (snapshot.policyVersion !== artifact.policyVersion || snapshot.relationshipVersion !== artifact.relationshipVersion) {
    throw new Error(`${artifact.path} does not match manifest policy or relationship version.`);
  }

  const fixture = fixturesByRelationshipVersion.get(snapshot.relationshipVersion);
  if (!fixture) {
    throw new Error(`${artifact.path} references missing tuple fixture ${snapshot.relationshipVersion}.`);
  }

  const storeSeed = {
    subjects: fixture.subjects,
    resources: fixture.resources,
    relationships: fixture.relationships
  };

  for (const testCase of snapshot.cases) {
    if (casesByName.has(testCase.name)) {
      throw new Error(`Duplicate regression case name: ${testCase.name}`);
    }

    const evaluatedAt = testCase.evaluatedAt ?? snapshot.evaluatedAt;
    const engine = new RebacDecisionEngine(new InMemoryRebacStore(storeSeed), {
      now: () => evaluatedAt,
      policyVersion: snapshot.policyVersion,
      relationshipVersion: snapshot.relationshipVersion
    });
    const actual = toExpectedDecision(engine.explain(testCase.request));
    assertJsonEqual(`${artifact.path} case ${testCase.name}`, actual, testCase.expected);
    casesByName.set(testCase.name, testCase);

    if (testCase.expected.reasonCode === "DENY_DEFAULT_NO_RELATIONSHIP_PATH") {
      denyDefaultCases += 1;
    }
    if (testCase.expected.reasonCode === "DENY_TENANT_BOUNDARY") {
      tenantBoundaryCases += 1;
    }
    if (testCase.expected.reasonCode === "DENY_EXPLICIT_OVERRIDE") {
      explicitDenyCases += 1;
    }
  }
}

if (denyDefaultCases === 0 || tenantBoundaryCases === 0 || explicitDenyCases === 0) {
  throw new Error("Sample policy snapshots must cover deny-default, tenant-boundary, and explicit-deny behavior.");
}

for (const example of manifest.generatedExamples) {
  const testCase = casesByName.get(example.caseName);
  if (!testCase) {
    throw new Error(`Generated example references unknown case ${example.caseName}.`);
  }

  const request = await readSampleJson<DecisionRequest>(example.requestPath);
  const response = await readSampleJson<ExpectedDecision>(example.responsePath);
  assertJsonEqual(`${example.requestPath} generated request`, request, testCase.request);
  assertJsonEqual(`${example.responsePath} generated response`, response, testCase.expected);
}

scanForForbiddenIdentifiers(manifest, "policy-repository.json");

console.log("Validated sample policy repository.");
console.log(`PASS ${models.size} model versions, ${manifest.migrations.length} migration(s), ${fixturesByRelationshipVersion.size} tuple fixture set(s), ${casesByName.size} regression case(s), and ${manifest.generatedExamples.length} generated API example(s).`);

async function readSampleJson<T>(path: string): Promise<T> {
  return readJson<T>(join(sampleRoot, path));
}

async function readSchemaJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(join(root, path), "utf8")) as T;
}

async function readJson<T>(path: string): Promise<T> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as T;
  scanForForbiddenIdentifiers(parsed, path);
  return parsed;
}

function requireTenantAndClassificationBoundaries(model: PolicyModel, path: string): void {
  if (model.tenantBoundary.crossTenantTraversal !== false) {
    throw new Error(`${path} must fail closed on cross-tenant traversal.`);
  }
  const classifications = new Set(model.classificationConstraints.map((constraint) => constraint.classification));
  for (const required of ["internal", "confidential"]) {
    if (!classifications.has(required)) {
      throw new Error(`${path} must include a ${required} classification constraint.`);
    }
  }
}

function requireSyntheticFixtureBoundary(fixture: TupleFixture, path: string): void {
  for (const subject of fixture.subjects) {
    if (subject.sourceSystem !== "sample-policy-repo") {
      throw new Error(`${path} subject ${subject.id} must use the sample source system.`);
    }
    if (typeof subject.attributes?.tenantId !== "string") {
      throw new Error(`${path} subject ${subject.id} must declare attributes.tenantId.`);
    }
  }

  for (const resource of fixture.resources) {
    if (resource.sourceSystem !== "sample-policy-repo") {
      throw new Error(`${path} resource ${resource.id} must use the sample source system.`);
    }
    if (typeof resource.attributes?.tenantId !== "string") {
      throw new Error(`${path} resource ${resource.id} must declare attributes.tenantId.`);
    }
    if (!resource.classification) {
      throw new Error(`${path} resource ${resource.id} must declare a classification.`);
    }
  }

  for (const relationship of fixture.relationships) {
    if (relationship.sourceSystem !== "sample-policy-repo") {
      throw new Error(`${path} relationship ${relationship.id} must use the sample source system.`);
    }
    if (typeof relationship.attributes?.tenantId !== "string") {
      throw new Error(`${path} relationship ${relationship.id} must declare attributes.tenantId.`);
    }
  }
}

function toExpectedDecision(result: {
  decision: DecisionValue;
  reasonCode: string;
  policyVersion: string;
  relationshipVersion: string;
  relationshipPath: RelationshipPathStep[];
}): ExpectedDecision {
  return {
    decision: result.decision,
    reasonCode: result.reasonCode,
    policyVersion: result.policyVersion,
    relationshipVersion: result.relationshipVersion,
    relationshipPath: result.relationshipPath
  };
}

function assertJsonEqual(label: string, actual: unknown, expected: unknown): void {
  const actualJson = stableStringify(actual);
  const expectedJson = stableStringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${label} drifted.\nActual: ${actualJson}\nExpected: ${expectedJson}`);
  }
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortJson(value[key])])
    );
  }

  return value;
}

function scanForForbiddenIdentifiers(value: unknown, path: string): void {
  if (typeof value === "string") {
    if (forbiddenIdentifierPattern.test(value)) {
      throw new Error(`${path} contains a forbidden production-like identifier: ${value}`);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForForbiddenIdentifiers(item, `${path}[${index}]`));
    return;
  }

  if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) {
      scanForForbiddenIdentifiers(entry, `${path}.${key}`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
