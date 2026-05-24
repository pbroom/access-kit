import { readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import {
  automationContract,
  type WorkflowContract,
  type WorkflowJobContract
} from "./lib/automation-contract.js";

type WorkflowJob = Record<string, unknown>;
type WorkflowStep = Record<string, unknown>;

interface WorkflowDocument {
  path: string;
  name?: unknown;
  concurrency?: Record<string, unknown>;
  jobs?: Record<string, WorkflowJob>;
}

const root = process.cwd();

const workflows: readonly WorkflowContract[] = automationContract.ci.workflows;

for (const contract of workflows) {
  const workflow = await readWorkflow(contract.path);

  for (const job of contract.jobs) {
    requireJob(workflow, job);
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

  return { ...parsed, path };
}

function requireJob(workflow: WorkflowDocument, contract: WorkflowJobContract): void {
  const job = workflow.jobs?.[contract.name];

  if (!job) {
    throw new Error(`Workflow ${workflow.path} is missing job ${contract.name}`);
  }

  const needsStepRuns = Boolean(contract.requiredRuns?.length || contract.requiredRunSnippets?.length);
  const needsStepUses = Boolean(contract.requiredUses?.length);
  const steps = needsStepRuns || (needsStepUses && !isReusableWorkflowJob(job)) ? requireSteps(job) : readOptionalSteps(job);
  const runs = steps.map((step) => (typeof step.run === "string" ? step.run.trim() : ""));
  const uses = [
    ...steps.map((step) => (typeof step.uses === "string" ? step.uses : "")),
    typeof job.uses === "string" ? job.uses : ""
  ];

  const missingRuns = (contract.requiredRuns ?? []).filter((run) => !runs.includes(run));
  if (missingRuns.length > 0) {
    throw new Error(`Workflow job ${contract.name} is missing required run command: ${missingRuns.join(", ")}`);
  }

  const missingUses = (contract.requiredUses ?? []).filter(
    (action) => !uses.some((usedAction) => usedAction === action || usedAction.startsWith(`${action}@`))
  );
  if (missingUses.length > 0) {
    throw new Error(`Workflow job ${contract.name} is missing required action: ${missingUses.join(", ")}`);
  }

  const missingRunSnippets = (contract.requiredRunSnippets ?? []).filter(
    (snippet) => !runs.some((run) => run.includes(snippet))
  );
  if (missingRunSnippets.length > 0) {
    throw new Error(
      `Workflow job ${contract.name} is missing required run snippet: ${missingRunSnippets.join(", ")}`
    );
  }
}

function isReusableWorkflowJob(job: WorkflowJob): boolean {
  return typeof job.uses === "string";
}

function readOptionalSteps(job: WorkflowJob): WorkflowStep[] {
  return Array.isArray(job.steps) ? requireSteps(job) : [];
}

function requireSteps(job: WorkflowJob): WorkflowStep[] {
  const steps = job.steps;

  if (!Array.isArray(steps)) {
    throw new Error("Workflow job is missing steps");
  }

  return steps.map((step) => {
    if (!isRecord(step)) {
      throw new Error("Workflow job step must be an object");
    }

    return step;
  });
}

function requireWorkflowConcurrency(workflow: WorkflowDocument, expected: boolean): void {
  const cancelInProgress = workflow.concurrency?.["cancel-in-progress"];

  if (cancelInProgress !== expected) {
    throw new Error(`Workflow ${workflow.path} cancel-in-progress must be ${String(expected)}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
