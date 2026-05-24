import { spawnSync } from "node:child_process";

export interface GitHubLabelRef {
  name: string;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  url: string;
  headRefName: string;
  baseRefName: string;
  isDraft: boolean;
  labels: GitHubLabelRef[];
  mergeStateStatus?: string;
  reviewDecision?: string;
  statusCheckRollup?: unknown[];
}

export type GitHubCheckSummary = "passing" | "failing" | "pending" | "unknown";

const FAILING_CHECK_CONCLUSIONS = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED"]);
const PENDING_CHECK_CONCLUSIONS = new Set(["", "PENDING"]);
const PASSING_CHECK_CONCLUSIONS = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);

export function runGhJson<T>(args: string[]): T {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  if (result.error) {
    throw new Error(`Unable to run gh: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`gh ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }

  return JSON.parse(result.stdout) as T;
}

export function runGh(args: string[]): void {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  if (result.error) {
    throw new Error(`Unable to run gh: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`gh ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
}

export function listOpenPullRequests(): GitHubPullRequest[] {
  return runGhJson<GitHubPullRequest[]>([
    "pr",
    "list",
    "--state",
    "open",
    "--limit",
    "100",
    "--json",
    [
      "number",
      "title",
      "url",
      "headRefName",
      "baseRefName",
      "isDraft",
      "labels",
      "mergeStateStatus",
      "reviewDecision",
      "statusCheckRollup"
    ].join(",")
  ]);
}

export function labelNames(pr: GitHubPullRequest): string[] {
  return pr.labels.map((label) => label.name).sort();
}

export function summarizeChecks(checks: unknown[] | undefined): GitHubCheckSummary {
  if (!checks || checks.length === 0) {
    return "unknown";
  }

  const conclusions = checks
    .map(readCheckConclusion)
    .filter((conclusion): conclusion is string => conclusion !== undefined);

  if (conclusions.length === 0) {
    return "unknown";
  }

  if (conclusions.some((conclusion) => FAILING_CHECK_CONCLUSIONS.has(conclusion))) {
    return "failing";
  }

  if (conclusions.some((conclusion) => PENDING_CHECK_CONCLUSIONS.has(conclusion))) {
    return "pending";
  }

  if (conclusions.every((conclusion) => PASSING_CHECK_CONCLUSIONS.has(conclusion))) {
    return "passing";
  }

  return "unknown";
}

export function readCheckConclusion(check: unknown): string | undefined {
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
