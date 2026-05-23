import { readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { runGh, runGhJson } from "./lib/github-cli.js";

interface LabelDefinition {
  name: string;
  color: string;
  description: string;
}

interface LabelManifest {
  labels: LabelDefinition[];
}

interface ExistingLabel {
  name: string;
  color: string;
  description: string;
}

const checkOnly = process.argv.includes("--check");
const manifest = await readManifest();
const existing = runGhJson<ExistingLabel[]>([
  "label",
  "list",
  "--limit",
  "200",
  "--json",
  "name,color,description"
]);

const existingByName = new Map(existing.map((label) => [label.name, label]));
const mismatches: string[] = [];

for (const label of manifest.labels) {
  const current = existingByName.get(label.name);

  if (!current) {
    mismatches.push(`${label.name} is missing`);
    if (!checkOnly) {
      runGh(["label", "create", label.name, "--color", label.color, "--description", label.description]);
      console.log(`Created label ${label.name}`);
    }
    continue;
  }

  if (current.color.toLowerCase() !== label.color.toLowerCase() || current.description !== label.description) {
    mismatches.push(`${label.name} differs from manifest`);
    if (!checkOnly) {
      runGh(["label", "edit", label.name, "--color", label.color, "--description", label.description]);
      console.log(`Updated label ${label.name}`);
    }
  }
}

if (checkOnly && mismatches.length > 0) {
  for (const mismatch of mismatches) {
    console.error(mismatch);
  }
  process.exit(1);
}

if (mismatches.length === 0) {
  console.log("GitHub labels match .github/labels.yml.");
}

async function readManifest(): Promise<LabelManifest> {
  const contents = await readFile(join(process.cwd(), ".github", "labels.yml"), "utf8");
  const parsed = YAML.parse(contents) as LabelManifest;

  if (!parsed || !Array.isArray(parsed.labels)) {
    throw new Error(".github/labels.yml must define a labels array.");
  }

  return parsed;
}
