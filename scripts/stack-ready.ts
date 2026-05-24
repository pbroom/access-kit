import {
  listOpenPullRequests,
  labelNames,
  summarizeChecks,
  type GitHubPullRequest
} from "./lib/github-cli.js";

const prs = listOpenPullRequests().filter(isStackPr);

if (prs.length === 0) {
  console.log("No stack-labeled pull requests are open.");
  process.exit(0);
}

const blockers = prs.flatMap((pr) => readinessBlockers(pr).map((blocker) => `#${pr.number}: ${blocker}`));

if (blockers.length > 0) {
  console.error("Stack is not ready to merge:");
  for (const blocker of blockers) {
    console.error(`- ${blocker}`);
  }
  process.exit(1);
}

console.log(`Stack ready: ${prs.map((pr) => `#${pr.number}`).join(", ")}`);

function isStackPr(pr: GitHubPullRequest): boolean {
  const labels = labelNames(pr);
  return labels.includes("stack") || labels.includes("ready-to-merge");
}

function readinessBlockers(pr: GitHubPullRequest): string[] {
  const labels = labelNames(pr);
  const blockers: string[] = [];

  if (pr.isDraft) {
    blockers.push("PR is still a draft.");
  }

  for (const label of ["blocked", "needs-human", "security-pass-required"]) {
    if (labels.includes(label)) {
      blockers.push(`PR still has ${label}.`);
    }
  }

  if (!labels.includes("ready-to-merge")) {
    blockers.push("PR is missing ready-to-merge.");
  }

  const checkState = summarizeChecks(pr.statusCheckRollup);
  if (checkState !== "passing") {
    blockers.push(`CI checks are ${checkState}.`);
  }

  return blockers;
}
