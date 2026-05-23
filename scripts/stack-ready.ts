import { listOpenPullRequests, labelNames, type GitHubPullRequest } from "./lib/github-cli.js";

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

function summarizeChecks(checks: unknown[] | undefined): "passing" | "failing" | "pending" | "unknown" {
  if (!checks || checks.length === 0) {
    return "unknown";
  }

  const conclusions = checks
    .map((check) => {
      if (!check || typeof check !== "object") {
        return undefined;
      }

      const record = check as Record<string, unknown>;
      if (typeof record.conclusion === "string") {
        return record.conclusion.toUpperCase();
      }

      if (typeof record.status === "string" && record.status.toUpperCase() !== "COMPLETED") {
        return "PENDING";
      }

      return undefined;
    })
    .filter((conclusion): conclusion is string => conclusion !== undefined);

  if (conclusions.length === 0) {
    return "unknown";
  }

  if (conclusions.some((conclusion) => ["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED"].includes(conclusion))) {
    return "failing";
  }

  if (conclusions.some((conclusion) => conclusion === "" || conclusion === "PENDING" || conclusion === "SKIPPED")) {
    return "pending";
  }

  if (conclusions.every((conclusion) => conclusion === "SUCCESS" || conclusion === "NEUTRAL")) {
    return "passing";
  }

  return "unknown";
}
