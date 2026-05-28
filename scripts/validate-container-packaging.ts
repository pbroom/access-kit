import { readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";

interface WorkflowDocument {
  jobs?: Record<string, unknown>;
}

type WorkflowJob = Record<string, unknown>;

const root = process.cwd();
const dockerfile = await readRequiredFile("Dockerfile");
const dockerignore = await readRequiredFile(".dockerignore");
const ci = YAML.parse(await readRequiredFile(".github/workflows/ci.yml")) as WorkflowDocument;

requireIncludes(dockerfile, "FROM node:22-bookworm-slim AS deps", "Dockerfile Node 22 build stage");
requireIncludes(dockerfile, "pnpm install --frozen-lockfile", "Dockerfile frozen lockfile install");
requireIncludes(dockerfile, "COPY packages/connectors-aws/package.json packages/connectors-aws/package.json", "Dockerfile AWS connector package manifest");
requireIncludes(dockerfile, "COPY packages/connectors-aws packages/connectors-aws", "Dockerfile AWS connector package source");
requireIncludes(dockerfile, "COPY packages/connectors-microsoft-graph/package.json packages/connectors-microsoft-graph/package.json", "Dockerfile Microsoft Graph connector package manifest");
requireIncludes(dockerfile, "COPY packages/connectors-microsoft-graph packages/connectors-microsoft-graph", "Dockerfile Microsoft Graph connector package source");
requireIncludes(dockerfile, "pnpm --filter @access-kit/api... build", "Dockerfile API workspace build");
requireIncludes(dockerfile, "pnpm deploy --filter @access-kit/api --prod --legacy /app", "Dockerfile production deploy");
requireIncludes(dockerfile, "FROM node:22-bookworm-slim AS runtime", "Dockerfile runtime stage");
requireIncludes(dockerfile, 'REBAC_API_HOST="0.0.0.0"', "Dockerfile container host binding");
requireIncludes(dockerfile, 'REBAC_STATE_PATH="/var/lib/access-kit/state/runtime-state.json"', "Dockerfile state path");
requireIncludes(dockerfile, 'REBAC_EVIDENCE_ROOT="/var/lib/access-kit/evidence"', "Dockerfile evidence path");
requireIncludes(dockerfile, "USER node", "Dockerfile non-root user");
requireIncludes(dockerfile, "HEALTHCHECK", "Dockerfile healthcheck");
requireIncludes(dockerfile, "/v1/ready", "Dockerfile readiness healthcheck");
requireIncludes(dockerfile, 'CMD ["node", "dist/bin.js"]', "Dockerfile API command");

for (const ignoredPath of ["node_modules", "dist", "coverage", "reports", "tests", ".git"]) {
  requireLine(dockerignore, ignoredPath, ".dockerignore");
}

const containerJob = ci.jobs?.["container-packaging"];
if (!isRecord(containerJob)) {
  throw new Error("CI workflow is missing container-packaging job");
}

const buildStep = findStep(containerJob, "Build rebac-api image");
requireExactStepRun(
  buildStep,
  "docker build --target runtime --tag access-kit-rebac-api:${{ github.sha }} .",
  "container build step"
);

const smokeStep = findStep(containerJob, "Smoke test rebac-api image");
const smokeRun = readStepRun(smokeStep, "container smoke step");
requireIncludes(smokeRun, "--name rebac-api-smoke", "container smoke step");
requireIncludes(smokeRun, "--env REBAC_API_KEYS=ci-smoke", "container smoke step");
requireIncludes(smokeRun, "did not become healthy within 20 seconds", "container smoke step");
requireIncludes(smokeRun, "http://127.0.0.1:3000/v1/ready", "container smoke step");
requireIncludes(smokeRun, 'test "$unauth_status" = "401"', "container smoke step");
requireIncludes(smokeRun, 'test "$auth_status" = "200"', "container smoke step");

console.log("Validated deployable API container packaging.");
console.log("PASS Dockerfile builds and runs the rebac-api runtime as a non-root container.");
console.log("PASS Container packaging CI job builds and smoke-tests health, readiness, and API auth.");

async function readRequiredFile(path: string): Promise<string> {
  return readFile(join(root, path), "utf8");
}

function requireIncludes(contents: string, needle: string, label: string): void {
  if (!contents.includes(needle)) {
    throw new Error(`${label} is missing required text: ${needle}`);
  }
}

function requireLine(contents: string, line: string, label: string): void {
  if (!contents.split(/\r?\n/).includes(line)) {
    throw new Error(`${label} is missing required line: ${line}`);
  }
}

function findStep(job: WorkflowJob, name: string): WorkflowJob {
  const steps = job.steps;

  if (!Array.isArray(steps)) {
    throw new Error("container-packaging job is missing steps");
  }

  const step = steps.find((entry) => isRecord(entry) && entry.name === name);

  if (!isRecord(step)) {
    throw new Error(`container-packaging job is missing step: ${name}`);
  }

  return step;
}

function readStepRun(step: WorkflowJob, label: string): string {
  if (typeof step.run !== "string") {
    throw new Error(`${label} must include a run script`);
  }

  return step.run;
}

function requireExactStepRun(step: WorkflowJob, expected: string, label: string): void {
  const run = readStepRun(step, label).trim();

  if (run !== expected) {
    throw new Error(`${label} run expected ${expected} but found ${run}`);
  }
}

function isRecord(value: unknown): value is WorkflowJob {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
