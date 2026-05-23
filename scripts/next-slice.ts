import { findNextReadySlice, readBacklog } from "./lib/automation.js";

const args = new Set(process.argv.slice(2));
const outputJson = args.has("--json");

const next = findNextReadySlice(await readBacklog());

if (!next) {
  if (outputJson) {
    console.log(JSON.stringify({ next: null }, null, 2));
  } else {
    console.log("No ready backlog slice is available. Review blocked or in-review items.");
  }
} else if (outputJson) {
  console.log(JSON.stringify({ next }, null, 2));
} else {
  console.log(`Next ready slice: ${next.id} ${next.slice}`);
  console.log(`Suggested branch: ${next.branch}`);
  console.log(`Acceptance: ${next.acceptance}`);
  console.log(`Security: ${next.security}`);
  console.log(`Next action: ${next.nextAction}`);
}
