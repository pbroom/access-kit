import { readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { findNextReadySlice, backlogStatuses, readBacklog } from "./lib/automation.js";
import { automationContract, type LabelContract, type PackageScriptContract } from "./lib/automation-contract.js";

interface PackageJson {
  scripts?: Record<string, string>;
}

interface LabelManifest {
  labels?: Array<{
    name?: unknown;
    color?: unknown;
    description?: unknown;
  }>;
}

const root = process.cwd();

const backlog = await readBacklog();
const nextReadySlice = findNextReadySlice(backlog);
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as PackageJson;
const automationDoc = await readFile(join(root, "docs", "automation.md"), "utf8");
const ciWorkflow = await readFile(join(root, ".github", "workflows", "ci.yml"), "utf8");
const prStewardWorkflow = await readFile(join(root, ".github", "workflows", "pr-steward.yml"), "utf8");
const labelsManifest = YAML.parse(
  await readFile(join(root, ".github", "labels.yml"), "utf8")
) as LabelManifest;

requireScripts(packageJson.scripts ?? {}, automationContract.packageScripts);
requireValidationPlans(packageJson.scripts ?? {}, automationContract.validationPlans);
requireNodeImportTsxScripts(packageJson.scripts ?? {}, automationContract.nodeImportTsxScripts);
requireDocNeedles(automationDoc, automationContract.docs.automationRequiredText);
requireLabels(labelsManifest, automationContract.labels.definitions);

if (!ciWorkflow.includes(automationContract.ci.automationGateCommand)) {
  throw new Error("CI workflow must run pnpm validate:automation.");
}

for (const needle of automationContract.ci.prStewardWorkflow.requiredText) {
  if (!prStewardWorkflow.includes(needle)) {
    throw new Error(`PR steward workflow is missing ${needle}.`);
  }
}

if ((prStewardWorkflow.match(/set -o pipefail/g) ?? []).length < automationContract.ci.prStewardWorkflow.minPipefailCount) {
  throw new Error("PR steward workflow must preserve command failures when piping output through tee.");
}

if (!nextReadySlice && !backlog.some((item) => item.status === "in_progress" || item.status === "in_review")) {
  throw new Error("Backlog must keep an active slice or at least one dependency-cleared ready next slice.");
}

console.log("Validated automation contract.");
console.log(
  `PASS backlog statuses (${backlogStatuses.join(", ")}), ${backlog.length} backlog slices, labels, scripts, docs, and CI automation validation are present.`
);

function requireScripts(scripts: Record<string, string>, contracts: readonly PackageScriptContract[]): void {
  for (const contract of contracts) {
    const command = scripts[contract.name];

    if (!command) {
      throw new Error(`package.json is missing script ${contract.name}.`);
    }

    if (command !== contract.command) {
      throw new Error(`package.json script ${contract.name} must be: ${contract.command}`);
    }
  }
}

function requireValidationPlans(
  scripts: Record<string, string>,
  plans: typeof automationContract.validationPlans
): void {
  for (const plan of plans) {
    const command = scripts[plan.script];

    if (!command) {
      throw new Error(`package.json is missing validation plan script ${plan.script}.`);
    }

    const missing = plan.requiredScripts.filter((requiredScript) => !command.includes(requiredScript));

    if (missing.length > 0) {
      throw new Error(`package.json script ${plan.script} is missing required entries: ${missing.join(", ")}`);
    }
  }
}

function requireNodeImportTsxScripts(scripts: Record<string, string>, names: readonly string[]): void {
  for (const name of names) {
    const command = scripts[name];

    if (!command?.startsWith("node --import tsx ")) {
      throw new Error(
        `package.json script ${name} must use node --import tsx to avoid tsx CLI IPC in automation.`
      );
    }
  }
}

function requireDocNeedles(contents: string, needles: readonly string[]): void {
  const missing = needles.filter((needle) => !contents.includes(needle));
  if (missing.length > 0) {
    throw new Error(`docs/automation.md is missing required content: ${missing.join(", ")}`);
  }
}

function requireLabels(manifest: LabelManifest, definitions: readonly LabelContract[]): void {
  if (!Array.isArray(manifest.labels)) {
    throw new Error(".github/labels.yml must contain labels.");
  }

  const labelsByName = new Map<string, { color: string; description: string }>();

  for (const label of manifest.labels) {
    if (typeof label.name !== "string" || typeof label.color !== "string" || typeof label.description !== "string") {
      throw new Error("Each label must include name, color, and description strings.");
    }

    if (!/^[0-9a-fA-F]{6}$/.test(label.color)) {
      throw new Error(`Label ${label.name} has invalid hex color ${label.color}.`);
    }

    if (label.description.length < 10) {
      throw new Error(`Label ${label.name} description is too short.`);
    }

    labelsByName.set(label.name, {
      color: label.color,
      description: label.description
    });
  }

  const missing = definitions.map((definition) => definition.name).filter((name) => !labelsByName.has(name));
  if (missing.length > 0) {
    throw new Error(`.github/labels.yml is missing required labels: ${missing.join(", ")}`);
  }

  for (const definition of definitions) {
    const label = labelsByName.get(definition.name);

    if (!label) {
      continue;
    }

    if (label.color.toLowerCase() !== definition.color.toLowerCase() || label.description !== definition.description) {
      throw new Error(`.github/labels.yml label ${definition.name} differs from automation contract manifest.`);
    }
  }
}
