import { readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";

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
const workflowText = await readRequiredFile(".github/workflows/container-release.yml");

requireIncludes(workflowText, "workflow_dispatch", "container release trigger");
requireIncludes(workflowText, "rebac-api-v*", "container release tag trigger");
requireIncludes(workflowText, "ghcr.io", "container release registry");
requireIncludes(workflowText, "SHOULD_PUBLISH", "container release publish gate");

requirePermission(releaseWorkflow, "contents", "read");
requirePermission(releaseWorkflow, "packages", "write");
requirePermission(releaseWorkflow, "id-token", "write");
requirePermission(releaseWorkflow, "attestations", "write");
requireConcurrency(releaseWorkflow);

const releaseJob = releaseWorkflow.jobs?.["release-api-image"];
if (!releaseJob) {
  throw new Error("Container release workflow is missing release-api-image job");
}

const releaseJobText = JSON.stringify(releaseJob);
for (const required of [
  "docker/setup-buildx-action",
  "docker/login-action",
  "docker/metadata-action",
  "docker/build-push-action",
  "sigstore/cosign-installer",
  "actions/attest-build-provenance",
  "cosign sign --yes",
  "IMAGE_DIGEST",
  "steps.build.outputs.digest"
]) {
  requireIncludes(releaseJobText, required, "release-api-image job");
}

const buildStep = findStep(releaseJob, "Build image with SBOM and provenance metadata");
requireStepWith(buildStep, "target", "runtime", "build image step");
requireStepWith(buildStep, "provenance", "mode=max", "build image step");
requireStepWith(buildStep, "sbom", true, "build image step");

const attestStep = findStep(releaseJob, "Attest build provenance");
requireStepWith(attestStep, "push-to-registry", true, "attest build provenance step");

const summaryStep = findStep(releaseJob, "Publish release summary");
requireStepEnv(summaryStep, "IMAGE_DIGEST", "${{ steps.build.outputs.digest }}", "publish release summary step");
const summaryRun = readStepRun(summaryStep, "publish release summary step");
requireIncludes(summaryRun, 'if [ -n "$IMAGE_DIGEST" ]', "publish release summary step");
requireIncludes(summaryRun, 'image_ref="${IMAGE_REPOSITORY}@${IMAGE_DIGEST}"', "publish release summary step");

console.log("Validated deployable API release packaging.");
console.log("PASS Container release workflow publishes only on tags or explicit manual dispatch.");
console.log("PASS Container release workflow builds runtime image with SBOM/provenance, registry attestation, and keyless signing.");

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

function requireIncludes(contents: string, needle: string, label: string): void {
  if (!contents.includes(needle)) {
    throw new Error(`${label} is missing required text: ${needle}`);
  }
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
