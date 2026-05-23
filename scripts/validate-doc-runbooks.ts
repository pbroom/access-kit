import { readFile } from "node:fs/promises";

const requiredRunbooks = [
  "runbooks/emergency-revocation.md",
  "runbooks/policy-rollback.md",
  "runbooks/drift-remediation.md",
  "runbooks/connector-outage.md",
  "runbooks/break-glass-review.md",
  "runbooks/audit-evidence-export.md",
  "runbooks/compromised-connector-credential.md",
  "runbooks/decision-api-outage.md"
];

const requiredHeadings = [
  "Purpose",
  "Trigger",
  "Severity",
  "Required Role",
  "Prerequisites",
  "Commands Or Proposed Commands",
  "Expected Output",
  "Verification Steps",
  "Audit Events Emitted",
  "Evidence Retained",
  "Escalation Path",
  "Rollback Or Compensating Action"
];

const failures: string[] = [];

for (const runbook of requiredRunbooks) {
  let content: string;

  try {
    content = await readFile(runbook, "utf8");
  } catch (error: unknown) {
    failures.push(`${runbook}: ${error instanceof Error ? error.message : "could not read file"}`);
    continue;
  }

  for (const heading of requiredHeadings) {
    if (!hasHeading(content, heading)) {
      failures.push(`${runbook}: missing required section "## ${heading}"`);
    }
  }
}

if (failures.length > 0) {
  throw new Error(`Runbook validation failed:\n${failures.join("\n")}`);
}

console.log(`Validated ${requiredRunbooks.length} runbooks and ${requiredHeadings.length} required sections.`);

function hasHeading(content: string, heading: string): boolean {
  return new RegExp(`^## ${escapeRegExp(heading)}\\s*$`, "m").test(content);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
