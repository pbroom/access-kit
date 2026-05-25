import type { GitHubCheckSummary } from "./github-cli.js";
import { automationContract } from "./automation-contract.js";

const { labels: labelPolicy } = automationContract;

export function buildPrStewardActions(
  labels: string[],
  checks: GitHubCheckSummary,
  isDraft: boolean
): string[] {
  const actions: string[] = [];
  const waitsForHuman = labelPolicy.humanWait.some((label) => labels.includes(label));

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

  if (labels.includes(labelPolicy.securityPassRequired) && !waitsForHuman) {
    actions.push("Run the local security pass before merge.");
  }

  if (
    checks === "passing" &&
    !labels.includes(labelPolicy.readyToMerge) &&
    !labelPolicy.humanWait.some((label) => labels.includes(label)) &&
    !labels.includes(labelPolicy.securityPassRequired)
  ) {
    actions.push("Apply ready-to-merge after human review and security pass.");
  }

  if (!hasStateLabel(labels)) {
    actions.push(`Apply one state label: ${labelPolicy.state.join(", ")}.`);
  }

  return actions;
}

function hasStateLabel(labels: string[]): boolean {
  return labelPolicy.state.some((label) => labels.includes(label));
}
