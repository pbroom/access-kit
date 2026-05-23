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
