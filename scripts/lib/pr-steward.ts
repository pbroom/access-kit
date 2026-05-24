import type { GitHubCheckSummary } from "./github-cli.js";

export function buildPrStewardActions(
  labels: string[],
  checks: GitHubCheckSummary,
  isDraft: boolean
): string[] {
  const actions: string[] = [];
  const waitsForHuman = labels.includes("needs-human") || labels.includes("blocked");

  if (waitsForHuman) {
    actions.push("Stop and wait for a human decision.");
  }

  if (isDraft) {
    actions.push("Draft PR is not ready for stack review.");
  }

  if (checks === "failing") {
    actions.push("Resolve failing CI checks, then push an update.");
  }

  if (checks === "pending") {
    actions.push("Wait for CI and review automation to finish.");
  }

  if (labels.includes("security-pass-required") && !waitsForHuman) {
    actions.push("Run the local security pass before merge.");
  }

  if (
    checks === "passing" &&
    !labels.includes("ready-to-merge") &&
    !labels.includes("needs-human") &&
    !labels.includes("blocked") &&
    !labels.includes("security-pass-required")
  ) {
    actions.push("Apply ready-to-merge after human review and security pass.");
  }

  if (!hasStateLabel(labels)) {
    actions.push("Apply one state label: ready-for-automation, needs-human, blocked, or ready-to-merge.");
  }

  return actions;
}

function hasStateLabel(labels: string[]): boolean {
  return ["ready-for-automation", "needs-human", "blocked", "ready-to-merge"].some((label) =>
    labels.includes(label)
  );
}
