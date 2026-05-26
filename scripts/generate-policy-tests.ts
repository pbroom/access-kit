import { compareGeneratedPolicyTestArtifacts, displayGeneratedPolicyTestPath } from "./lib/generated-policy-tests.js";

const checkOnly = process.argv.includes("--check");
const root = process.cwd();
const drift = await compareGeneratedPolicyTestArtifacts({ root, write: !checkOnly });

if (drift.length > 0 && checkOnly) {
  throw new Error(
    `Generated policy test artifacts are out of date:\n${drift
      .map((path) => `- ${displayGeneratedPolicyTestPath(root, path)}`)
      .join("\n")}\nRun pnpm generate:policy-tests and review the generated starter coverage.`
  );
}

if (drift.length > 0) {
  console.log(`Generated ${drift.length} policy test artifact(s).`);
  for (const path of drift) {
    console.log(`WROTE ${displayGeneratedPolicyTestPath(root, path)}`);
  }
} else {
  console.log("Generated policy test artifacts are up to date.");
}
