import { readBacklog, selectReadyBacklogBatch } from "./lib/automation.js";

const args = process.argv.slice(2);
const outputJson = args.includes("--json");
const maxItems = readMaxItems(args);
const batch = selectReadyBacklogBatch(await readBacklog(), { maxItems });

if (outputJson) {
  console.log(JSON.stringify({ batch }, null, 2));
} else if (batch.length === 0) {
  console.log("No dependency-cleared backlog batch is available. Review blocked or in-review items.");
} else {
  console.log(`Next ready backlog batch (${batch.length}):`);

  for (const item of batch) {
    const dependencies = item.dependsOn.length > 0 ? item.dependsOn.join(", ") : "-";
    console.log(`- ${item.id} ${item.slice}`);
    console.log(`  Priority: ${item.priority}`);
    console.log(`  Depends on: ${dependencies}`);
    console.log(`  Parallel-safe: ${item.parallel ? "yes" : "no"}`);
    console.log(`  Area: ${item.area}`);
    console.log(`  Suggested branch: ${item.branch}`);
    console.log(`  Acceptance: ${item.acceptance}`);
    console.log(`  Security: ${item.security}`);
    console.log(`  Next action: ${item.nextAction}`);
  }
}

function readMaxItems(values: string[]): number {
  const maxArg = values.find((value) => value.startsWith("--max="));

  if (!maxArg) {
    return 3;
  }

  const parsed = Number(maxArg.slice("--max=".length));

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) {
    throw new Error("--max must be an integer from 1 through 5.");
  }

  return parsed;
}
