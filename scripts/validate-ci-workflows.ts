import { readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";

type WorkflowJob = Record<string, unknown>;

interface WorkflowDocument {
  name?: unknown;
  jobs?: Record<string, WorkflowJob>;
}

const root = process.cwd();

const ci = await readWorkflow(".github/workflows/ci.yml");
const security = await readWorkflow(".github/workflows/security.yml");

requireJob(ci, "contract-validation", [
  "pnpm validate:contracts",
  "pnpm validate:ci"
]);
requireJob(ci, "quality", [
  "pnpm typecheck",
  "pnpm lint",
  "pnpm test",
  "pnpm build"
]);
requireJob(ci, "evidence", ["pnpm evidence:check"]);
requireJob(security, "dependency-audit", ["pnpm audit --audit-level high"]);
requireJob(security, "secret-scan", ["gitleaks/gitleaks-action@v2"]);
requireJob(security, "codeql", [
  "github/codeql-action/init@v3",
  "github/codeql-action/analyze@v3",
  "pnpm build"
]);

console.log("Validated CI workflow contract.");
console.log("PASS CI contract, quality, evidence, dependency audit, secret scan, and CodeQL jobs are present.");

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
