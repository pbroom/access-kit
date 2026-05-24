import {
  listOpenPullRequests,
  labelNames,
  summarizeChecks,
  type GitHubCheckSummary,
  type GitHubPullRequest
} from "./lib/github-cli.js";
import { buildPrStewardActions } from "./lib/pr-steward.js";

interface PullRequestStewardStatus {
  pr: GitHubPullRequest;
  labels: string[];
  checks: GitHubCheckSummary;
  actions: string[];
}

const args = new Set(process.argv.slice(2));
const outputJson = args.has("--json");
const failOnAttention = args.has("--fail-on-attention");
const dryRun = args.has("--dry-run");

const statuses = listOpenPullRequests().map(toStewardStatus);
const needsAttention = statuses.filter((status) => status.actions.length > 0);

if (outputJson) {
  console.log(JSON.stringify(statuses, null, 2));
} else {
  renderHumanStatus(statuses, dryRun);
}

if (failOnAttention && needsAttention.length > 0) {
  process.exitCode = 1;
}

function toStewardStatus(pr: GitHubPullRequest): PullRequestStewardStatus {
  const labels = labelNames(pr);
  const checks = summarizeChecks(pr.statusCheckRollup);
  const actions = buildPrStewardActions(labels, checks, pr.isDraft);

  return {
    pr,
    labels,
    checks,
    actions
  };
}

function renderHumanStatus(items: PullRequestStewardStatus[], isDryRun: boolean): void {
  if (isDryRun) {
    console.log("Mode: dry-run (read-only).");
  }

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
