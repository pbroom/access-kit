import { listOpenPullRequests, labelNames, type GitHubPullRequest } from "./lib/github-cli.js";

interface PullRequestStewardStatus {
  pr: GitHubPullRequest;
  labels: string[];
  checks: "passing" | "failing" | "pending" | "unknown";
  actions: string[];
}

const args = new Set(process.argv.slice(2));
const outputJson = args.has("--json");
const failOnAttention = args.has("--fail-on-attention");

const statuses = listOpenPullRequests().map(toStewardStatus);
const needsAttention = statuses.filter((status) => status.actions.length > 0);

if (outputJson) {
  console.log(JSON.stringify(statuses, null, 2));
} else {
  renderHumanStatus(statuses);
}

if (failOnAttention && needsAttention.length > 0) {
  process.exitCode = 1;
}

function toStewardStatus(pr: GitHubPullRequest): PullRequestStewardStatus {
  const labels = labelNames(pr);
  const checks = summarizeChecks(pr.statusCheckRollup);
  const actions: string[] = [];

  if (labels.includes("needs-human") || labels.includes("blocked")) {
    actions.push("Stop and wait for a human decision.");
  }

  if (pr.isDraft) {
    actions.push("Draft PR is not ready for stack review.");
  }

  if (checks === "failing") {
    actions.push("Resolve failing CI checks, then push an update.");
  }

  if (checks === "pending") {
    actions.push("Wait for CI and review automation to finish.");
  }

  if (labels.includes("security-pass-required")) {
    actions.push("Run the local security pass before merge.");
  }

  if (checks === "passing" && !labels.includes("ready-to-merge") && !labels.includes("needs-human")) {
    actions.push("Apply ready-to-merge after human review and security pass.");
  }

  if (!hasStateLabel(labels)) {
    actions.push("Apply one state label: ready-for-codex, needs-human, blocked, or ready-to-merge.");
  }

  return {
    pr,
    labels,
    checks,
    actions
  };
}

function hasStateLabel(labels: string[]): boolean {
  return ["ready-for-codex", "needs-human", "blocked", "ready-to-merge"].some((label) =>
    labels.includes(label)
  );
}

function summarizeChecks(checks: unknown[] | undefined): "passing" | "failing" | "pending" | "unknown" {
  if (!checks || checks.length === 0) {
    return "unknown";
  }

  const conclusions = checks
    .map(readCheckConclusion)
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

function readCheckConclusion(check: unknown): string | undefined {
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
}

function renderHumanStatus(items: PullRequestStewardStatus[]): void {
  if (items.length === 0) {
    console.log("No open pull requests.");
    return;
  }

  console.log("Open PR steward status:");

  for (const item of items) {
    const labels = item.labels.length > 0 ? item.labels.join(", ") : "none";
    console.log(
      `- #${item.pr.number} ${item.pr.title} (${item.pr.headRefName} -> ${item.pr.baseRefName})`
    );
    console.log(`  URL: ${item.pr.url}`);
    console.log(`  Labels: ${labels}`);
    console.log(`  Checks: ${item.checks}`);

    if (item.actions.length === 0) {
      console.log("  Action: no steward action required.");
    } else {
      for (const action of item.actions) {
        console.log(`  Action: ${action}`);
      }
    }
  }
}
