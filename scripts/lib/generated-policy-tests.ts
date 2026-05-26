import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import {
  InMemoryRebacStore,
  RebacDecisionEngine,
  type DecisionRequest,
  type DecisionValue,
  type JsonRecord,
  type PolicyModel,
  type PolicyModelActionMapping,
  type PolicyModelDenyRule,
  type PolicyModelRelation,
  type RelationshipPathStep,
  type RelationshipTuple,
  type Resource,
  type ResourceType,
  type Subject,
  type SubjectType
} from "../../packages/core/src/index.js";

export const GENERATED_POLICY_TEST_SCHEMA_VERSION = "access-kit.generated-policy-tests.v1";
export const GENERATED_POLICY_REVIEW_NOTICE =
  "Generated starter policy tests are review aids only and cannot replace explicit deny, boundary, and abuse-case coverage.";

export interface SamplePolicyManifestForGeneration {
  repositoryId: string;
  currentPolicyVersion: string;
  models: VersionedArtifact[];
  migrations: MigrationArtifact[];
  generatedPolicyTests?: GeneratedPolicyTestsManifestEntry;
}

export interface VersionedArtifact {
  version: string;
  path: string;
}

export interface MigrationArtifact {
  fromVersion: string;
  toVersion: string;
  path: string;
}

export interface GeneratedPolicyTestsManifestEntry {
  command: string;
  checkCommand: string;
  manifestPath: string;
}

export interface GeneratedPolicyTestFile {
  path: string;
  contents: string;
}

export interface GeneratedPolicyTestResult {
  manifest: GeneratedPolicyTestManifest;
  suites: GeneratedPolicyTestSuite[];
  migrationSnapshots: GeneratedMigrationRegressionSnapshot[];
  files: GeneratedPolicyTestFile[];
}

export interface GeneratedPolicyTestManifest {
  schemaVersion: typeof GENERATED_POLICY_TEST_SCHEMA_VERSION;
  repositoryId: string;
  generatedAt: string;
  generator: string;
  reviewNotice: string;
  suites: GeneratedPolicyTestManifestSuite[];
  migrationRegressionSnapshots: GeneratedPolicyTestManifestMigration[];
}

export interface GeneratedPolicyTestManifestSuite {
  policyVersion: string;
  relationshipVersion: string;
  modelPath: string;
  tupleFixturePath: string;
  authorizationTestsPath: string;
  exampleRequestPaths: string[];
  expectedResultPaths: string[];
}

export interface GeneratedPolicyTestManifestMigration {
  fromVersion: string;
  toVersion: string;
  migrationPath: string;
  snapshotPath: string;
}

export interface GeneratedPolicyTestSuite {
  schemaVersion: typeof GENERATED_POLICY_TEST_SCHEMA_VERSION;
  source: GeneratedPolicyTestSource;
  generatedAt: string;
  reviewNotice: string;
  tupleFixture: GeneratedTupleFixture;
  authorizationTests: GeneratedAuthorizationTest[];
}

export interface GeneratedPolicyTestSource {
  repositoryId: string;
  modelPath: string;
  modelVersion: string;
  relationshipVersion: string;
  generator: string;
}

export interface GeneratedTupleFixture {
  policyVersion: string;
  relationshipVersion: string;
  reviewOnly: true;
  subjects: Subject[];
  resources: Resource[];
  relationships: RelationshipTuple[];
}

export interface GeneratedAuthorizationTest {
  name: string;
  slug: string;
  category: "allow-path" | "deny-default" | "tenant-boundary" | "explicit-deny" | "classification-boundary";
  reviewOnly: true;
  coverageIntent: string;
  generatedFrom: JsonRecord;
  request: DecisionRequest;
  expected: GeneratedExpectedDecision;
}

export interface GeneratedExpectedDecision {
  decision: DecisionValue;
  reasonCode: string;
  policyVersion: string;
  relationshipVersion: string;
  relationshipPath: RelationshipPathStep[];
}

export interface GeneratedMigrationRegressionSnapshot {
  schemaVersion: typeof GENERATED_POLICY_TEST_SCHEMA_VERSION;
  generatedAt: string;
  reviewNotice: string;
  reviewOnly: true;
  migration: {
    fromVersion: string;
    toVersion: string;
    migrationPath: string;
    operations: string[];
  };
  sourceModel: GeneratedMigrationModelSurface;
  targetModel: GeneratedMigrationModelSurface;
  reviewerChecklist: string[];
  starterRegressionCases: Array<Pick<GeneratedAuthorizationTest, "name" | "slug" | "category" | "request" | "expected">>;
}

export interface GeneratedMigrationModelSurface {
  version: string;
  modelPath: string;
  resourceTypes: string[];
  relations: string[];
  actions: string[];
  contextConstraints: string[];
  classifications: string[];
}

interface GeneratePolicyTestOptions {
  root?: string;
  sampleRoot?: string;
  generatedAt?: string;
}

interface CompareGeneratedPolicyTestOptions extends GeneratePolicyTestOptions {
  write?: boolean;
}

interface SelectedModelSurface {
  subjectType: SubjectType;
  groupType?: SubjectType;
  containerType?: ResourceType;
  targetType: ResourceType;
  crossTenantTargetType: ResourceType;
  restrictedTargetType?: ResourceType;
  targetClassification: string;
  restrictedClassification?: string;
  readAction: PolicyModelActionMapping;
  writeAction?: PolicyModelActionMapping;
  membershipRelation?: PolicyModelRelation;
  containmentRelation?: PolicyModelRelation;
  readGrantRelation: string;
  explicitDenyRelation?: string;
}

interface SamplePolicyMigrationFile {
  id: string;
  fromVersion: string;
  toVersion: string;
  operations: string[];
}

const defaultGeneratedAt = "2026-05-26T12:00:00.000Z";
const generatorPath = "scripts/generate-policy-tests.ts";

export async function generatePolicyTestArtifacts(
  options: GeneratePolicyTestOptions = {}
): Promise<GeneratedPolicyTestResult> {
  const root = options.root ?? process.cwd();
  const sampleRoot = options.sampleRoot ?? join(root, "examples", "sample-policy-repository");
  const generatedAt = options.generatedAt ?? defaultGeneratedAt;
  const manifest = await readJson<SamplePolicyManifestForGeneration>(join(sampleRoot, "policy-repository.json"));
  const models = new Map<string, { artifact: VersionedArtifact; model: PolicyModel }>();

  for (const artifact of manifest.models) {
    models.set(artifact.version, {
      artifact,
      model: await readJson<PolicyModel>(join(sampleRoot, artifact.path))
    });
  }

  const suites = [...models.values()].map(({ artifact, model }) =>
    generateSuite({
      repositoryId: manifest.repositoryId,
      generatedAt,
      model,
      modelPath: artifact.path
    })
  );
  const suitesByPolicyVersion = new Map(suites.map((suite) => [suite.source.modelVersion, suite]));
  const migrationSnapshots: GeneratedMigrationRegressionSnapshot[] = [];

  for (const artifact of manifest.migrations) {
    const source = models.get(artifact.fromVersion);
    const target = models.get(artifact.toVersion);
    if (!source || !target) {
      continue;
    }

    const migration = await readJson<SamplePolicyMigrationFile>(join(sampleRoot, artifact.path));
    migrationSnapshots.push(
      generateMigrationSnapshot({
        generatedAt,
        artifact,
        migration,
        source,
        target,
        targetSuite: suitesByPolicyVersion.get(artifact.toVersion)
      })
    );
  }

  const fileInputs = buildFiles({
    repositoryId: manifest.repositoryId,
    generatedAt,
    suites,
    migrationSnapshots
  });

  return {
    manifest: fileInputs.manifest,
    suites,
    migrationSnapshots,
    files: fileInputs.files
  };
}

export async function compareGeneratedPolicyTestArtifacts(
  options: CompareGeneratedPolicyTestOptions = {}
): Promise<string[]> {
  const root = options.root ?? process.cwd();
  const sampleRoot = options.sampleRoot ?? join(root, "examples", "sample-policy-repository");
  const generated = await generatePolicyTestArtifacts({
    root,
    sampleRoot,
    generatedAt: options.generatedAt
  });
  const drift: string[] = [];

  for (const file of generated.files) {
    const absolutePath = join(sampleRoot, file.path);
    let existing: string | undefined;
    try {
      existing = await readFile(absolutePath, "utf8");
    } catch {
      existing = undefined;
    }

    if (existing !== file.contents) {
      drift.push(file.path);
      if (options.write) {
        await mkdir(dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, file.contents);
      }
    }
  }

  return drift;
}

function generateSuite(input: {
  repositoryId: string;
  generatedAt: string;
  model: PolicyModel;
  modelPath: string;
}): GeneratedPolicyTestSuite {
  const surface = selectModelSurface(input.model);
  const relationshipVersion = generatedRelationshipVersion(input.model.version);
  const tupleFixture = generateTupleFixture(input.model.version, relationshipVersion, surface);
  const authorizationTests = generateAuthorizationTests(input.model, tupleFixture, surface);

  return {
    schemaVersion: GENERATED_POLICY_TEST_SCHEMA_VERSION,
    source: {
      repositoryId: input.repositoryId,
      modelPath: input.modelPath,
      modelVersion: input.model.version,
      relationshipVersion,
      generator: generatorPath
    },
    generatedAt: input.generatedAt,
    reviewNotice: GENERATED_POLICY_REVIEW_NOTICE,
    tupleFixture,
    authorizationTests
  };
}

function selectModelSurface(model: PolicyModel): SelectedModelSurface {
  const subjectType = firstSubjectType(model, ["user", "service_account", "service_principal", "workload"]);
  const groupType = firstSubjectType(model, ["group"]);
  const membershipRelation = groupType
    ? model.relations.find((relation) => relation.kind === "membership" && relation.subjectTypes.includes(subjectType) && relation.objectTypes.includes(groupType))
    : undefined;
  const readAction = findAction(model, ["read", "view"]);
  const writeAction = findOptionalAction(model, ["write", "contribute", "manage", "admin"]);
  const readGrantRelation = findGrantRelation(model, readAction);
  const explicitDenyRelation = findExplicitDenyRelation(model.denyRules);
  const containmentRelation = model.relations.find((relation) => relation.kind === "containment" && relation.name === "contains");
  const containerType = selectResourceType(model, ["workspace", "folder", "organization"]);
  const targetType = selectResourceType(model, ["document", "dataset", "api", "application", "workspace"]);
  const crossTenantTargetType = targetType;
  const targetClassification = selectClassification(model, targetType, ["confidential", "internal"]);
  const restrictedClassification = findRestrictedClassification(model, writeAction);
  const restrictedTargetType = restrictedClassification ? targetType : undefined;

  return {
    subjectType,
    groupType,
    containerType: containmentRelation ? containerType : undefined,
    targetType,
    crossTenantTargetType,
    restrictedTargetType,
    targetClassification,
    restrictedClassification,
    readAction,
    writeAction,
    membershipRelation,
    containmentRelation,
    readGrantRelation,
    explicitDenyRelation
  };
}

function generateTupleFixture(
  policyVersion: string,
  relationshipVersion: string,
  surface: SelectedModelSurface
): GeneratedTupleFixture {
  const createdAt = "2026-05-26T00:00:00.000Z";
  const tenantId = "tenant:generated-review";
  const foreignTenantId = "tenant:generated-foreign";
  const subjects: Subject[] = [
    subject("generated-reviewer", surface.subjectType, "Generated Reviewer", tenantId),
    subject("generated-unassigned", surface.subjectType, "Generated Unassigned User", tenantId),
    subject("generated-outsider", surface.subjectType, "Generated Outside User", foreignTenantId)
  ];
  const grantSubjectId = surface.membershipRelation && surface.groupType ? `${surface.groupType}:generated-review-team` : `${surface.subjectType}:generated-reviewer`;

  if (surface.membershipRelation && surface.groupType) {
    subjects.push(subject("generated-review-team", surface.groupType, "Generated Review Team", tenantId));
  }

  const resources: Resource[] = [];
  const targetResource = resource("generated-case-plan", surface.targetType, "Generated Case Plan", surface.targetClassification, tenantId);
  const deniedResource = resource("generated-denied-report", surface.targetType, "Generated Denied Report", surface.targetClassification, tenantId);
  const foreignResource = resource("generated-foreign-plan", surface.crossTenantTargetType, "Generated Foreign Plan", surface.targetClassification, foreignTenantId);
  const restrictedResource = surface.restrictedTargetType && surface.restrictedClassification
    ? resource("generated-restricted-summary", surface.restrictedTargetType, "Generated Restricted Summary", surface.restrictedClassification, tenantId)
    : undefined;
  const relationships: RelationshipTuple[] = [];

  if (surface.containerType && surface.containmentRelation && surface.targetType !== surface.containerType) {
    const container = resource("generated-workspace", surface.containerType, "Generated Workspace", "internal", tenantId);
    resources.push(container, { ...targetResource, parentId: container.id }, { ...deniedResource, parentId: container.id }, foreignResource);
    if (restrictedResource) {
      resources.push({ ...restrictedResource, parentId: container.id });
    }
    relationships.push(
      relationship("generated-read-grant", grantSubjectId, surface.readGrantRelation, container.id, tenantId),
      relationship("generated-target-containment", container.id, surface.containmentRelation.name, targetResource.id, tenantId),
      relationship("generated-denied-containment", container.id, surface.containmentRelation.name, deniedResource.id, tenantId)
    );
    if (restrictedResource) {
      relationships.push(
        relationship("generated-restricted-containment", container.id, surface.containmentRelation.name, restrictedResource.id, tenantId)
      );
    }
  } else {
    resources.push(targetResource, deniedResource, foreignResource);
    if (restrictedResource) {
      resources.push(restrictedResource);
    }
    relationships.push(relationship("generated-read-grant", grantSubjectId, surface.readGrantRelation, targetResource.id, tenantId));
  }

  if (surface.membershipRelation && surface.groupType) {
    relationships.unshift(
      relationship(
        "generated-reviewer-membership",
        `${surface.subjectType}:generated-reviewer`,
        surface.membershipRelation.name,
        `${surface.groupType}:generated-review-team`,
        tenantId
      )
    );
  }

  if (surface.explicitDenyRelation) {
    relationships.push(relationship("generated-explicit-deny", grantSubjectId, surface.explicitDenyRelation, deniedResource.id, tenantId));
  }

  return {
    policyVersion,
    relationshipVersion,
    reviewOnly: true,
    subjects,
    resources,
    relationships
  };

  function subject(id: string, type: SubjectType, displayName: string, subjectTenantId: string): Subject {
    return {
      id: `${type}:${id}`,
      type,
      displayName,
      sourceSystem: "generated-policy-tests",
      lifecycleState: "active",
      identifiers: {
        generatedId: id
      },
      attributes: {
        tenantId: subjectTenantId
      },
      version: `subject:${relationshipVersion}`,
      createdAt
    };
  }

  function resource(
    id: string,
    type: ResourceType,
    displayName: string,
    classification: string,
    resourceTenantId: string
  ): Resource {
    const ownerId = `${surface.subjectType}:generated-reviewer`;
    return {
      id: `${type}:${id}`,
      type,
      displayName,
      sourceSystem: "generated-policy-tests",
      ownerId,
      dataStewardId: ownerId,
      technicalOwnerId: ownerId,
      classification,
      lifecycleState: "active",
      attributes: {
        tenantId: resourceTenantId
      },
      version: `resource:${relationshipVersion}`,
      createdAt
    };
  }

  function relationship(id: string, subjectId: string, relation: string, objectId: string, relationshipTenantId: string): RelationshipTuple {
    return {
      id: `relationship:${id}`,
      subjectId,
      relation,
      objectId,
      sourceSystem: "generated-policy-tests",
      assertedAt: createdAt,
      status: "active",
      attributes: {
        tenantId: relationshipTenantId
      },
      version: `tuple:${relationshipVersion}`,
      createdAt
    };
  }
}

function generateAuthorizationTests(
  model: PolicyModel,
  tupleFixture: GeneratedTupleFixture,
  surface: SelectedModelSurface
): GeneratedAuthorizationTest[] {
  const commonContext = generatedContext(model);
  const tests: Array<Omit<GeneratedAuthorizationTest, "expected">> = [
    {
      name: "generated reviewer can read through the starter relationship path",
      slug: "generated-reviewer-read-allowed",
      category: "allow-path",
      reviewOnly: true,
      coverageIntent: "Starter allow-path coverage proves the generated fixture can exercise a positive decision.",
      generatedFrom: { action: surface.readAction.name, grantRelation: surface.readGrantRelation },
      request: request(`${surface.subjectType}:generated-reviewer`, surface.readAction.name, findResourceId(tupleFixture, "generated-case-plan"), commonContext)
    },
    {
      name: "generated unassigned subject is denied by default",
      slug: "generated-unassigned-denied-by-default",
      category: "deny-default",
      reviewOnly: true,
      coverageIntent: "Starter deny-default coverage reminds reviewers to keep explicit no-path tests.",
      generatedFrom: { action: surface.readAction.name },
      request: request(`${surface.subjectType}:generated-unassigned`, surface.readAction.name, findResourceId(tupleFixture, "generated-case-plan"), commonContext)
    },
    {
      name: "generated cross-tenant subject is denied at the boundary",
      slug: "generated-cross-tenant-denied",
      category: "tenant-boundary",
      reviewOnly: true,
      coverageIntent: "Starter tenant-boundary coverage highlights cross-tenant denial review.",
      generatedFrom: { tenantBoundary: model.tenantBoundary },
      request: request(`${surface.subjectType}:generated-outsider`, surface.readAction.name, findResourceId(tupleFixture, "generated-case-plan"), commonContext)
    }
  ];

  if (surface.explicitDenyRelation) {
    tests.push({
      name: "generated explicit deny beats the starter allow path",
      slug: "generated-explicit-deny-overrides-allow",
      category: "explicit-deny",
      reviewOnly: true,
      coverageIntent: "Starter explicit-deny coverage is a review aid; teams still need authored abuse cases.",
      generatedFrom: { denyRelation: surface.explicitDenyRelation },
      request: request(`${surface.subjectType}:generated-reviewer`, surface.readAction.name, findResourceId(tupleFixture, "generated-denied-report"), commonContext)
    });
  }

  if (surface.writeAction && surface.restrictedTargetType && surface.restrictedClassification) {
    tests.push({
      name: "generated restricted resource write remains denied",
      slug: "generated-restricted-write-denied",
      category: "classification-boundary",
      reviewOnly: true,
      coverageIntent: "Starter classification-boundary coverage marks where reviewers add explicit boundary and abuse cases.",
      generatedFrom: {
        action: surface.writeAction.name,
        classification: surface.restrictedClassification
      },
      request: request(
        `${surface.subjectType}:generated-reviewer`,
        surface.writeAction.name,
        findResourceId(tupleFixture, "generated-restricted-summary"),
        commonContext
      )
    });
  }

  return tests.map((test) => ({
    ...test,
    expected: evaluateExpectedDecision(tupleFixture, test.request)
  }));

  function request(subjectId: string, action: string, resourceId: string, context: JsonRecord): DecisionRequest {
    return {
      subjectId,
      action,
      resourceId,
      policyVersion: tupleFixture.policyVersion,
      relationshipVersion: tupleFixture.relationshipVersion,
      context
    };
  }
}

function evaluateExpectedDecision(
  tupleFixture: GeneratedTupleFixture,
  request: DecisionRequest
): GeneratedExpectedDecision {
  const engine = new RebacDecisionEngine(
    new InMemoryRebacStore({
      subjects: tupleFixture.subjects,
      resources: tupleFixture.resources,
      relationships: tupleFixture.relationships
    }),
    {
      now: () => "2026-05-26T12:00:00.000Z",
      policyVersion: tupleFixture.policyVersion,
      relationshipVersion: tupleFixture.relationshipVersion
    }
  );
  const result = engine.explain(request);
  return {
    decision: result.decision,
    reasonCode: result.reasonCode,
    policyVersion: result.policyVersion,
    relationshipVersion: result.relationshipVersion,
    relationshipPath: result.relationshipPath
  };
}

function generateMigrationSnapshot(input: {
  generatedAt: string;
  artifact: MigrationArtifact;
  migration: SamplePolicyMigrationFile;
  source: { artifact: VersionedArtifact; model: PolicyModel };
  target: { artifact: VersionedArtifact; model: PolicyModel };
  targetSuite?: GeneratedPolicyTestSuite;
}): GeneratedMigrationRegressionSnapshot {
  return {
    schemaVersion: GENERATED_POLICY_TEST_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    reviewNotice: GENERATED_POLICY_REVIEW_NOTICE,
    reviewOnly: true,
    migration: {
      fromVersion: input.artifact.fromVersion,
      toVersion: input.artifact.toVersion,
      migrationPath: input.artifact.path,
      operations: input.migration.operations
    },
    sourceModel: modelSurface(input.source.model, input.source.artifact.path),
    targetModel: modelSurface(input.target.model, input.target.artifact.path),
    reviewerChecklist: [
      "Review generated cases against the migration intent before accepting them in CI.",
      "Keep hand-authored deny-default, tenant-boundary, explicit-deny, and abuse-case coverage in the repository.",
      "Confirm generated tuple fixtures use synthetic identifiers and do not encode production tenant data.",
      "Regenerate examples after model or migration changes, then review the diff like source code."
    ],
    starterRegressionCases: input.targetSuite?.authorizationTests.map((test) => ({
      name: test.name,
      slug: test.slug,
      category: test.category,
      request: test.request,
      expected: test.expected
    })) ?? []
  };
}

function buildFiles(input: {
  repositoryId: string;
  generatedAt: string;
  suites: GeneratedPolicyTestSuite[];
  migrationSnapshots: GeneratedMigrationRegressionSnapshot[];
}): { manifest: GeneratedPolicyTestManifest; files: GeneratedPolicyTestFile[] } {
  const files: GeneratedPolicyTestFile[] = [];
  const manifestSuites: GeneratedPolicyTestManifestSuite[] = [];
  const manifestMigrations: GeneratedPolicyTestManifestMigration[] = [];

  for (const suite of input.suites) {
    const suiteSlug = policyVersionSlug(suite.source.modelVersion);
    const suiteRoot = `generated/policy-tests/${suiteSlug}`;
    const tupleFixturePath = `${suiteRoot}/tuple-fixture.json`;
    const authorizationTestsPath = `${suiteRoot}/authorization-tests.json`;
    const exampleRequestPaths: string[] = [];
    const expectedResultPaths: string[] = [];

    files.push({ path: tupleFixturePath, contents: toPrettyJson(suite.tupleFixture) });
    files.push({ path: authorizationTestsPath, contents: toPrettyJson(suite) });

    for (const test of suite.authorizationTests) {
      const requestPath = `${suiteRoot}/example-requests/${test.slug}.request.json`;
      const expectedPath = `${suiteRoot}/expected-results/${test.slug}.expected.json`;
      exampleRequestPaths.push(requestPath);
      expectedResultPaths.push(expectedPath);
      files.push({ path: requestPath, contents: toPrettyJson(test.request) });
      files.push({ path: expectedPath, contents: toPrettyJson(test.expected) });
    }

    manifestSuites.push({
      policyVersion: suite.source.modelVersion,
      relationshipVersion: suite.source.relationshipVersion,
      modelPath: suite.source.modelPath,
      tupleFixturePath,
      authorizationTestsPath,
      exampleRequestPaths,
      expectedResultPaths
    });
  }

  for (const snapshot of input.migrationSnapshots) {
    const snapshotPath = `generated/policy-tests/migrations/${policyVersionSlug(snapshot.migration.fromVersion)}-to-${policyVersionSlug(snapshot.migration.toVersion)}.json`;
    files.push({ path: snapshotPath, contents: toPrettyJson(snapshot) });
    manifestMigrations.push({
      fromVersion: snapshot.migration.fromVersion,
      toVersion: snapshot.migration.toVersion,
      migrationPath: snapshot.migration.migrationPath,
      snapshotPath
    });
  }

  const manifest: GeneratedPolicyTestManifest = {
    schemaVersion: GENERATED_POLICY_TEST_SCHEMA_VERSION,
    repositoryId: input.repositoryId,
    generatedAt: input.generatedAt,
    generator: generatorPath,
    reviewNotice: GENERATED_POLICY_REVIEW_NOTICE,
    suites: manifestSuites,
    migrationRegressionSnapshots: manifestMigrations
  };

  return {
    manifest,
    files: [{ path: "generated/policy-tests/manifest.json", contents: toPrettyJson(manifest) }, ...files]
  };
}

function firstSubjectType(model: PolicyModel, preferred: SubjectType[]): SubjectType {
  for (const candidate of preferred) {
    if (model.relations.some((relation) => relation.subjectTypes.includes(candidate) || relation.objectTypes.includes(candidate))) {
      return candidate;
    }
  }
  const first = model.relations.flatMap((relation) => relation.subjectTypes).find(isSubjectType);
  if (!first) {
    throw new Error(`${model.version} does not expose a subject type usable for generated starter tests.`);
  }
  return first;
}

function selectResourceType(model: PolicyModel, preferred: ResourceType[]): ResourceType {
  for (const candidate of preferred) {
    if (model.resourceTypes.some((resourceType) => resourceType.type === candidate)) {
      return candidate;
    }
  }
  const first = model.resourceTypes[0]?.type;
  if (!first) {
    throw new Error(`${model.version} does not define a resource type.`);
  }
  return first;
}

function findAction(model: PolicyModel, preferred: string[]): PolicyModelActionMapping {
  const action = findOptionalAction(model, preferred);
  if (!action) {
    throw new Error(`${model.version} does not define any of these actions: ${preferred.join(", ")}`);
  }
  return action;
}

function findOptionalAction(model: PolicyModel, preferred: string[]): PolicyModelActionMapping | undefined {
  return preferred.map((name) => model.actions.find((action) => action.name === name)).find(Boolean);
}

function findGrantRelation(model: PolicyModel, action: PolicyModelActionMapping): string {
  const grantRelations = new Set(model.relations.filter((relation) => relation.kind === "grant").map((relation) => relation.name));
  const relation = action.grants.find((grant) => grantRelations.has(grant));
  if (!relation) {
    throw new Error(`${model.version} action ${action.name} does not reference a grant relation.`);
  }
  return relation;
}

function findExplicitDenyRelation(denyRules: PolicyModelDenyRule[]): string | undefined {
  return denyRules.find((rule) => !rule.actions || rule.actions.includes("read") || rule.actions.includes("view"))?.relation;
}

function findRestrictedClassification(model: PolicyModel, writeAction: PolicyModelActionMapping | undefined): string | undefined {
  if (!writeAction) {
    return undefined;
  }
  return model.classificationConstraints.find((constraint) => !constraint.allowedActions.includes(writeAction.name))?.classification;
}

function selectClassification(model: PolicyModel, resourceType: ResourceType, preferred: string[]): string {
  const resourceTypeEntry = model.resourceTypes.find((entry) => entry.type === resourceType);
  for (const candidate of preferred) {
    if (resourceTypeEntry?.classifications.includes(candidate)) {
      return candidate;
    }
  }
  return resourceTypeEntry?.classifications[0] ?? model.classificationConstraints[0]?.classification ?? "internal";
}

function generatedContext(model: PolicyModel): JsonRecord {
  const context: JsonRecord = {};
  for (const constraint of model.contextConstraints) {
    if (constraint.type === "string") {
      context[constraint.key] = constraint.key.toLowerCase().includes("justification")
        ? "generated review fixture"
        : "generated-policy-test";
    }
    if (constraint.type === "number") {
      context[constraint.key] = 10;
    }
    if (constraint.type === "boolean") {
      context[constraint.key] = true;
    }
  }
  return context;
}

function findResourceId(tupleFixture: GeneratedTupleFixture, suffix: string): string {
  const resource = tupleFixture.resources.find((item) => item.id.endsWith(`:${suffix}`));
  if (!resource) {
    throw new Error(`Generated tuple fixture is missing resource ${suffix}.`);
  }
  return resource.id;
}

function modelSurface(model: PolicyModel, modelPath: string): GeneratedMigrationModelSurface {
  return {
    version: model.version,
    modelPath,
    resourceTypes: model.resourceTypes.map((resourceType) => resourceType.type).sort(),
    relations: model.relations.map((relation) => relation.name).sort(),
    actions: model.actions.map((action) => action.name).sort(),
    contextConstraints: model.contextConstraints.map((constraint) => constraint.key).sort(),
    classifications: model.classificationConstraints.map((constraint) => constraint.classification).sort()
  };
}

function generatedRelationshipVersion(policyVersion: string): string {
  return `generated:${policyVersion.replace(/^policy:/, "tuple-set:")}`;
}

function policyVersionSlug(policyVersion: string): string {
  return policyVersion.replace(/^policy:/, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
}

function toPrettyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function isSubjectType(value: string): value is SubjectType {
  return ["user", "group", "service_account", "service_principal", "managed_identity", "device", "workload"].includes(value);
}

export function displayGeneratedPolicyTestPath(root: string, path: string): string {
  return relative(root, join(root, "examples", "sample-policy-repository", path));
}
