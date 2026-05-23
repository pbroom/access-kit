import { readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";

type WorkflowJob = Record<string, unknown>;

interface WorkflowDocument {
  name?: unknown;
  concurrency?: Record<string, unknown>;
  jobs?: Record<string, WorkflowJob>;
}

const root = process.cwd();

const ci = await readWorkflow(".github/workflows/ci.yml");
const security = await readWorkflow(".github/workflows/security.yml");

requireJob(ci, "contract-validation", [
  "pnpm validate:contracts",
  "pnpm validate:docs",
  "pnpm validate:automation",
  "pnpm validate:ci",
  "pnpm validate:packaging",
  "pnpm validate:release-packaging",
  "pnpm validate:deployment-manifests"
]);
requireJob(ci, "quality", [
  "pnpm typecheck",
  "pnpm lint",
  "pnpm test",
  "pnpm build"
]);
requireJob(ci, "evidence", ["pnpm evidence:check"]);
requireJob(ci, "container-packaging", [
  "docker build",
  "rebac-api-smoke",
  "did not become healthy within 20 seconds",
  "/v1/ready",
  "REBAC_API_KEYS=ci-smoke"
]);
requireJob(security, "dependency-audit", ["pnpm audit --audit-level high"]);
requireSecurityConcurrency(security);
requireJob(security, "secret-scan", ["gitleaks/gitleaks-action"]);
requireJob(security, "codeql", [
  "github/codeql-action/init",
  "github/codeql-action/analyze",
  "pnpm build"
]);

console.log("Validated CI workflow contract.");
console.log(
  "PASS CI contract, docs, automation, quality, evidence, container packaging, release packaging, deployment manifest, dependency audit, secret scan, and CodeQL jobs are present."
);

async function readWorkflow(path: string): Promise<WorkflowDocument> {
  const contents = await readFile(join(root, path), "utf8");
  const parsed = YAML.parse(contents) as WorkflowDocument;

  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Workflow ${path} did not parse to an object`);
  }

  if (!parsed.jobs || typeof parsed.jobs !== "object") {
    throw new Error(`Workflow ${path} is missing jobs`);
  }

  return parsed;
}

function requireJob(workflow: WorkflowDocument, jobName: string, needles: string[]): void {
  const job = workflow.jobs?.[jobName];

  if (!job) {
    throw new Error(`Workflow ${String(workflow.name)} is missing job ${jobName}`);
  }

  const jobText = JSON.stringify(job);
  const missing = needles.filter((needle) => !jobText.includes(needle));

  if (missing.length > 0) {
    throw new Error(`Workflow job ${jobName} is missing required entry: ${missing.join(", ")}`);
  }
}

function requireSecurityConcurrency(workflow: WorkflowDocument): void {
  const cancelInProgress = workflow.concurrency?.["cancel-in-progress"];

  if (cancelInProgress !== false) {
    throw new Error("Security workflow must not cancel in-progress scheduled scans");
  }
}
