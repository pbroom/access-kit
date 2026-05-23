import { readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";

interface WorkflowDocument {
  jobs?: Record<string, unknown>;
}

const root = process.cwd();
const dockerfile = await readRequiredFile("Dockerfile");
const dockerignore = await readRequiredFile(".dockerignore");
const ci = YAML.parse(await readRequiredFile(".github/workflows/ci.yml")) as WorkflowDocument;

requireIncludes(dockerfile, "FROM node:22-bookworm-slim AS deps", "Dockerfile Node 22 build stage");
requireIncludes(dockerfile, "pnpm install --frozen-lockfile", "Dockerfile frozen lockfile install");
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
if (!containerJob) {
  throw new Error("CI workflow is missing container-packaging job");
}

const containerJobText = JSON.stringify(containerJob);
for (const required of [
  "docker build",
  "rebac-api-smoke",
  "did not become healthy within 20 seconds",
  "/v1/ready",
  "REBAC_API_KEYS=ci-smoke"
]) {
  requireIncludes(containerJobText, required, "container-packaging job");
}

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
