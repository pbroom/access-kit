import { readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { backlogStatuses, readBacklog } from "./lib/automation.js";

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
const readySlices = backlog.filter((item) => item.status === "ready");
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as PackageJson;
const automationDoc = await readFile(join(root, "docs", "automation.md"), "utf8");
const ciWorkflow = await readFile(join(root, ".github", "workflows", "ci.yml"), "utf8");
const prStewardWorkflow = await readFile(join(root, ".github", "workflows", "pr-steward.yml"), "utf8");
const labelsManifest = YAML.parse(
  await readFile(join(root, ".github", "labels.yml"), "utf8")
) as LabelManifest;

requireScripts(packageJson.scripts ?? {}, [
  "validate:automation",
  "pr:status",
  "steward:check",
  "backlog:next",
  "stack:ready",
  "security:pass",
  "labels:sync"
]);

requireDocNeedles(automationDoc, [
  "pnpm pr:status",
  "pnpm backlog:next",
  "pnpm stack:ready",
  "pnpm security:pass",
  "ready-for-automation",
  "needs-human",
  "ready-to-merge"
]);

requireLabels(labelsManifest, [
  "stack",
  "ready-for-automation",
  "needs-human",
  "security-pass-required",
  "blocked",
  "ready-to-merge",
  "next-slice"
]);

if (!ciWorkflow.includes("pnpm validate:automation")) {
  throw new Error("CI workflow must run pnpm validate:automation.");
}

for (const needle of ["pnpm steward:check", "pnpm backlog:next", "schedule:"]) {
  if (!prStewardWorkflow.includes(needle)) {
    throw new Error(`PR steward workflow is missing ${needle}.`);
  }
}

if (readySlices.length === 0) {
  throw new Error("Backlog must keep at least one ready next slice.");
}

console.log("Validated automation contract.");
console.log(
  `PASS backlog statuses (${backlogStatuses.join(", ")}), ${backlog.length} backlog slices, labels, scripts, docs, and CI automation validation are present.`
);

function requireScripts(scripts: Record<string, string>, names: string[]): void {
  for (const name of names) {
    if (!scripts[name]) {
      throw new Error(`package.json is missing script ${name}.`);
    }
  }
}

function requireDocNeedles(contents: string, needles: string[]): void {
  const missing = needles.filter((needle) => !contents.includes(needle));
  if (missing.length > 0) {
    throw new Error(`docs/automation.md is missing required content: ${missing.join(", ")}`);
  }
}

function requireLabels(manifest: LabelManifest, names: string[]): void {
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

  const missing = names.filter((name) => !labelsByName.has(name));
  if (missing.length > 0) {
    throw new Error(`.github/labels.yml is missing required labels: ${missing.join(", ")}`);
  }
}
