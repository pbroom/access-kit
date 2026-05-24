import { automationContract } from "./lib/automation-contract.js";
import { runGh, runGhJson } from "./lib/github-cli.js";

interface ExistingLabel {
  name: string;
  color: string;
  description: string;
}

const checkOnly = process.argv.includes("--check");
const labels = automationContract.labels.definitions;
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

for (const label of labels) {
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
  console.log("GitHub labels match the automation contract manifest.");
}
