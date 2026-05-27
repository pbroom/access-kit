import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { AnySchema } from "ajv";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import YAML from "yaml";
import { isPinnedRequiredActionUse } from "./lib/github-action-ref.js";
import { readJsonFile } from "./lib/files.js";

type WorkflowJob = Record<string, unknown>;

interface WorkflowDocument {
  concurrency?: Record<string, unknown>;
  env?: Record<string, unknown>;
  jobs?: Record<string, WorkflowJob>;
  on?: Record<string, unknown>;
  permissions?: Record<string, unknown>;
}

const root = process.cwd();
const releaseWorkflow = await readWorkflow(".github/workflows/container-release.yml");
const releaseManifestSchema = await readJsonFile<AnySchema>("schemas/product-release-manifest.schema.json");
const releaseManifestPaths = await listReleaseManifestPaths("releases");
const releaseManifests = await Promise.all(
  releaseManifestPaths.map(async (path) => ({
    path,
    manifest: await readJsonFile<ProductReleaseManifest>(path),
  })),
);

for (const { path, manifest } of releaseManifests) {
  validateReleaseManifest(releaseManifestSchema, manifest, path);
}

requireWorkflowDispatch(releaseWorkflow);
requirePushTag(releaseWorkflow, "rebac-api-v*");
requireEnv(releaseWorkflow, "REGISTRY", "ghcr.io");
requireEnv(releaseWorkflow, "IMAGE_NAME", "${{ github.repository }}/rebac-api");
requireEnv(releaseWorkflow, "SHOULD_PUBLISH", "${{ github.event_name == 'push' || inputs.publish == true }}");

requirePermission(releaseWorkflow, "contents", "read");
requirePermission(releaseWorkflow, "packages", "write");
requirePermission(releaseWorkflow, "id-token", "write");
requirePermission(releaseWorkflow, "attestations", "write");
requireConcurrency(releaseWorkflow);

const releaseJob = releaseWorkflow.jobs?.["release-api-image"];
if (!releaseJob) {
  throw new Error("Container release workflow is missing release-api-image job");
}

requireStepUses(releaseJob, "Set up Docker Buildx", "docker/setup-buildx-action");
requireStepUses(releaseJob, "Log in to GHCR", "docker/login-action");
requireStepUses(releaseJob, "Generate image metadata", "docker/metadata-action");
requireStepUses(releaseJob, "Build image with SBOM and provenance metadata", "docker/build-push-action");
requireStepUses(releaseJob, "Install cosign", "sigstore/cosign-installer");
requireStepUses(releaseJob, "Attest build provenance", "actions/attest-build-provenance");

const buildStep = findStep(releaseJob, "Build image with SBOM and provenance metadata");
requireStepWith(buildStep, "target", "runtime", "build image step");
requireStepWith(buildStep, "provenance", "mode=max", "build image step");
requireStepWith(buildStep, "sbom", true, "build image step");

const attestStep = findStep(releaseJob, "Attest build provenance");
requireStepWith(attestStep, "push-to-registry", true, "attest build provenance step");
requireStepWith(attestStep, "subject-digest", "${{ steps.build.outputs.digest }}", "attest build provenance step");

const signStep = findStep(releaseJob, "Sign published image");
requireStepEnv(signStep, "IMAGE_REF", "${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}@${{ steps.build.outputs.digest }}", "sign published image step");
requireExactStepRun(signStep, 'cosign sign --yes "$IMAGE_REF"', "sign published image step");

const summaryStep = findStep(releaseJob, "Publish release summary");
requireStepEnv(summaryStep, "IMAGE_DIGEST", "${{ steps.build.outputs.digest }}", "publish release summary step");
const summaryRun = readStepRun(summaryStep, "publish release summary step");
requireIncludes(summaryRun, 'if [ -n "$IMAGE_DIGEST" ]', "publish release summary step");
requireIncludes(summaryRun, 'image_ref="${IMAGE_REPOSITORY}@${IMAGE_DIGEST}"', "publish release summary step");

console.log("Validated deployable API release packaging.");
console.log("PASS Container release workflow publishes only on tags or explicit manual dispatch.");
console.log("PASS Container release workflow builds runtime image with SBOM/provenance, registry attestation, and keyless signing.");
console.log("PASS Product release manifest covers source, container, CLI, SDK, docs site, compatibility, support, security, and CVE disclosure channels.");
console.log("PASS Release artifacts retain SBOM, provenance, signature, vulnerability disclosure, and proof-point versus production-ready labels.");

interface ProductReleaseManifest {
  productVersion: string;
  releaseType: string;
  productionReady: boolean;
  labels: string[];
  artifacts: ProductReleaseArtifact[];
  compatibility: Array<{ component: string }>;
  policies: {
    supportPolicy: string;
    securityPolicy: string;
    vulnerabilityDisclosure: string;
    cveDisclosurePath: string;
  };
  validation: {
    requiredCommands: string[];
    evidenceRefs: string[];
  };
  version: string;
}

interface ProductReleaseArtifact {
  kind: string;
  name: string;
  proofPoint: boolean;
  productionReady: boolean;
  sbom: string;
  provenance: string;
  signature: string;
  vulnerabilityDisclosure: string;
}

async function readWorkflow(path: string): Promise<WorkflowDocument> {
  const contents = await readRequiredFile(path);
  const parsed = YAML.parse(contents) as WorkflowDocument;

  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Workflow ${path} did not parse to an object`);
  }

  if (!parsed.jobs || typeof parsed.jobs !== "object") {
    throw new Error(`Workflow ${path} is missing jobs`);
  }

  return parsed;
}

async function readRequiredFile(path: string): Promise<string> {
  return readFile(join(root, path), "utf8");
}

async function listReleaseManifestPaths(directory: string): Promise<string[]> {
  const entries = await readdir(join(root, directory), { withFileTypes: true });
  const paths = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(directory, entry.name, "manifest.json"))
    .sort();

  if (paths.length === 0) {
    throw new Error(`${directory} must contain at least one release manifest`);
  }

  return paths;
}

function validateReleaseManifest(schema: AnySchema, manifest: ProductReleaseManifest, path: string): void {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  if (!validate(manifest)) {
    throw new Error(`${path} failed schema validation: ${ajv.errorsText(validate.errors)}`);
  }

  requireEquals(manifest.version, "product-release-manifest:v1", `${path} product release manifest version`);
  requireReleaseLabels(manifest, path);

  for (const kind of ["source", "container", "cli", "sdk", "docs_site"]) {
    const artifact = manifest.artifacts.find((entry) => entry.kind === kind);

    if (!artifact) {
      throw new Error(`${path} is missing ${kind} artifact channel`);
    }

    if (manifest.releaseType === "proof_point") {
      requireEquals(artifact.proofPoint, true, `${path} ${kind} artifact proofPoint`);
    }

    requireEquals(artifact.productionReady, manifest.productionReady, `${path} ${kind} artifact productionReady`);
    requireNonEmpty(artifact.sbom, `${path} ${kind} artifact SBOM`);
    requireNonEmpty(artifact.provenance, `${path} ${kind} artifact provenance`);
    requireNonEmpty(artifact.signature, `${path} ${kind} artifact signature`);
    requireNonEmpty(artifact.vulnerabilityDisclosure, `${path} ${kind} artifact vulnerability disclosure`);
  }

  for (const component of ["Node.js", "pnpm", "API contract", "Container runtime", "Release manifest"]) {
    if (!manifest.compatibility.some((entry) => entry.component === component)) {
      throw new Error(`${path} compatibility matrix is missing ${component}`);
    }
  }

  requireEquals(manifest.policies.supportPolicy, "docs/support-policy.md", `${path} support policy path`);
  requireEquals(manifest.policies.securityPolicy, "SECURITY.md", `${path} security policy path`);
  requireIncludes(manifest.policies.vulnerabilityDisclosure, "GitHub private vulnerability reporting", `${path} vulnerability disclosure path`);
  requireIncludes(manifest.policies.cveDisclosurePath, "CVE", `${path} CVE disclosure path`);
  requireIncludes(manifest.validation.requiredCommands.join("\n"), "corepack pnpm ci:check", `${path} release validation commands`);
  requireIncludes(manifest.validation.requiredCommands.join("\n"), "git diff --check", `${path} release validation commands`);
  requireIncludes(manifest.validation.evidenceRefs.join("\n"), "reports/proof-point-validation.md", `${path} release evidence refs`);
}

function requireReleaseLabels(manifest: ProductReleaseManifest, path: string): void {
  const labelText = manifest.labels.join("\n");

  if (manifest.releaseType === "proof_point") {
    requireEquals(manifest.productionReady, false, `${path} proof-point release productionReady`);
    requireIncludes(labelText, "proof-point", `${path} proof-point release labels`);
    requireIncludes(labelText, "not-production-ready", `${path} proof-point release labels`);
    return;
  }

  requireEquals(manifest.releaseType, "production_ready", `${path} product release type`);
  requireEquals(manifest.productionReady, true, `${path} production-ready release productionReady`);
  requireIncludes(labelText, "production-ready", `${path} production-ready release labels`);

  if (manifest.labels.includes("not-production-ready")) {
    throw new Error(`${path} production-ready release labels must not include not-production-ready`);
  }
}

function requireIncludes(contents: string, needle: string, label: string): void {
  if (!contents.includes(needle)) {
    throw new Error(`${label} is missing required text: ${needle}`);
  }
}

function requireNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${label} must be non-empty`);
  }
}

function requireWorkflowDispatch(workflow: WorkflowDocument): void {
  const triggers = asRecord(workflow.on, "container release triggers");
  const workflowDispatch = asRecord(triggers.workflow_dispatch, "container release workflow_dispatch trigger");
  const inputs = asRecord(workflowDispatch.inputs, "container release workflow_dispatch inputs");
  const publish = asRecord(inputs.publish, "container release publish input");
  requireEquals(publish.type, "boolean", "container release publish input type");
  requireEquals(publish.default, false, "container release publish input default");
}

function requirePushTag(workflow: WorkflowDocument, tag: string): void {
  const triggers = asRecord(workflow.on, "container release triggers");
  const push = asRecord(triggers.push, "container release push trigger");
  const tags = push.tags;

  if (!Array.isArray(tags) || !tags.includes(tag)) {
    throw new Error(`container release push trigger must include tag ${tag}`);
  }
}

function requireEnv(workflow: WorkflowDocument, name: string, expected: string): void {
  const env = asRecord(workflow.env, "container release env");
  requireEquals(env[name], expected, `container release env ${name}`);
}

function findStep(job: WorkflowJob, name: string): WorkflowJob {
  const steps = job.steps;

  if (!Array.isArray(steps)) {
    throw new Error("release-api-image job is missing steps");
  }

  const step = steps.find((entry) => isRecord(entry) && entry.name === name);

  if (!isRecord(step)) {
    throw new Error(`release-api-image job is missing step: ${name}`);
  }

  return step;
}

function requireStepUses(job: WorkflowJob, name: string, actionPrefix: string): void {
  const step = findStep(job, name);

  if (typeof step.uses !== "string" || !isPinnedRequiredActionUse(step.uses, actionPrefix)) {
    throw new Error(`${name} must use ${actionPrefix} pinned to a full 40-character SHA ref`);
  }
}

function requireStepWith(step: WorkflowJob, key: string, expected: unknown, label: string): void {
  const withBlock = step.with;

  if (!isRecord(withBlock) || withBlock[key] !== expected) {
    throw new Error(`${label} must set ${key} to ${String(expected)}`);
  }
}

function requireStepEnv(step: WorkflowJob, key: string, expected: string, label: string): void {
  const envBlock = step.env;

  if (!isRecord(envBlock) || envBlock[key] !== expected) {
    throw new Error(`${label} must set env ${key} to ${expected}`);
  }
}

function readStepRun(step: WorkflowJob, label: string): string {
  if (typeof step.run !== "string") {
    throw new Error(`${label} must include a run script`);
  }

  return step.run;
}

function requireExactStepRun(step: WorkflowJob, expected: string, label: string): void {
  const run = readStepRun(step, label).trim();
  requireEquals(run, expected, `${label} run`);
}

function requirePermission(workflow: WorkflowDocument, permission: string, expected: string): void {
  const actual = workflow.permissions?.[permission];

  if (actual !== expected) {
    throw new Error(`Container release workflow permission ${permission} must be ${expected}`);
  }
}

function requireConcurrency(workflow: WorkflowDocument): void {
  const cancelInProgress = workflow.concurrency?.["cancel-in-progress"];

  if (cancelInProgress !== false) {
    throw new Error("Container release workflow must not cancel in-progress release jobs");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }

  return value;
}

function requireEquals(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} expected ${String(expected)} but found ${String(actual)}`);
  }
}
