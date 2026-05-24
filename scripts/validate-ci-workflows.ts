import { readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { automationContract, type WorkflowContract } from "./lib/automation-contract.js";

type WorkflowJob = Record<string, unknown>;

interface WorkflowDocument {
  name?: unknown;
  concurrency?: Record<string, unknown>;
  jobs?: Record<string, WorkflowJob>;
}

const root = process.cwd();

const workflows: readonly WorkflowContract[] = automationContract.ci.workflows;

for (const contract of workflows) {
  const workflow = await readWorkflow(contract.path);

  for (const job of contract.jobs) {
    requireJob(workflow, job.name, job.requiredEntries);
  }

  if (contract.cancelInProgress !== undefined) {
    requireWorkflowConcurrency(workflow, contract.cancelInProgress);
  }
}

console.log("Validated CI workflow contract.");
console.log(
  "PASS CI contract, docs, automation, quality, evidence, container packaging, release packaging, deployment manifest, persistence deployment evidence, dependency audit, secret scan, and CodeQL jobs are present."
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

function requireJob(workflow: WorkflowDocument, jobName: string, needles: readonly string[]): void {
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

function requireWorkflowConcurrency(workflow: WorkflowDocument, expected: boolean): void {
  const cancelInProgress = workflow.concurrency?.["cancel-in-progress"];

  if (cancelInProgress !== expected) {
    throw new Error(`Workflow ${String(workflow.name)} cancel-in-progress must be ${String(expected)}`);
  }
}
