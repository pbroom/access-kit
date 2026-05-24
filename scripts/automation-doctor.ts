import { spawnSync } from "node:child_process";

interface DoctorCheck {
  name: string;
  command: string;
  args: string[];
}

const checks: DoctorCheck[] = [
  {
    name: "GitHub git fetch",
    command: "git",
    args: ["fetch", "origin", "--prune", "--dry-run"]
  },
  {
    name: "GitHub CLI PR access",
    command: "gh",
    args: ["pr", "list", "--state", "open", "--limit", "1", "--json", "number,title"]
  },
  {
    name: "PR steward status",
    command: "node",
    args: ["--import", "tsx", "scripts/pr-steward.ts", "--dry-run"]
  },
  {
    name: "Backlog batch selector",
    command: "node",
    args: ["--import", "tsx", "scripts/backlog-batch.ts", "--max=3"]
  }
];

const failures: string[] = [];

for (const check of checks) {
  const result = spawnSync(check.command, check.args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  if (result.error || result.status !== 0) {
    const detail = result.error?.message ?? (result.stderr.trim() || result.stdout.trim() || "unknown failure");
    failures.push(`${check.name}: ${detail}`);
    continue;
  }

  console.log(`PASS ${check.name}`);
}

if (failures.length > 0) {
  console.error("Automation environment doctor failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Automation environment doctor passed.");
