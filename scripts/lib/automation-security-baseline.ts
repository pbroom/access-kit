export interface AutomationSecurityBaselineInputs {
  readonly packageScripts: Record<string, string>;
  readonly labelNames: readonly string[];
  readonly mergeBlockerLabels: readonly string[];
  readonly ciWorkflow: string;
  readonly securityWorkflow: string;
}

const requiredSecurityPassEntries = ["pnpm audit --audit-level high", "git diff --check", "pnpm ci:check"] as const;
const requiredMergeBlockerLabel = "security-pass-required";
const requiredValidateCiCommand = "tsx scripts/validate-ci-workflows.ts";
const requiredSecurityWorkflowNeedles = [
  "pnpm audit --audit-level high",
  "gitleaks/gitleaks-action",
  "github/codeql-action/init",
  "github/codeql-action/analyze",
  "pnpm build"
] as const;

export function requireAutomationSecurityBaseline(inputs: AutomationSecurityBaselineInputs): void {
  requireScriptEntries(inputs.packageScripts, "security:pass", requiredSecurityPassEntries);
  requireExactScript(inputs.packageScripts, "validate:ci", requiredValidateCiCommand);
  requireScriptEntries(inputs.packageScripts, "validate", ["pnpm validate:ci"]);

  if (!inputs.labelNames.includes(requiredMergeBlockerLabel)) {
    throw new Error(`.github/labels.yml is missing required baseline label ${requiredMergeBlockerLabel}.`);
  }

  if (!inputs.mergeBlockerLabels.includes(requiredMergeBlockerLabel)) {
    throw new Error(`Automation merge blockers must include ${requiredMergeBlockerLabel}.`);
  }

  if (!inputs.ciWorkflow.includes("pnpm validate:ci")) {
    throw new Error("CI workflow must keep running pnpm validate:ci.");
  }

  const missingSecurityNeedles = requiredSecurityWorkflowNeedles.filter(
    (needle) => !inputs.securityWorkflow.includes(needle)
  );

  if (missingSecurityNeedles.length > 0) {
    throw new Error(`Security workflow is missing baseline entries: ${missingSecurityNeedles.join(", ")}`);
  }
}

function requireExactScript(scripts: Record<string, string>, name: string, expectedCommand: string): void {
  const command = scripts[name];

  if (!command) {
    throw new Error(`package.json is missing baseline script ${name}.`);
  }

  if (command !== expectedCommand) {
    throw new Error(`package.json script ${name} must be: ${expectedCommand}`);
  }
}

function requireScriptEntries(scripts: Record<string, string>, name: string, entries: readonly string[]): void {
  const command = scripts[name];

  if (!command) {
    throw new Error(`package.json is missing baseline script ${name}.`);
  }

  const missing = entries.filter((entry) => !command.includes(entry));

  if (missing.length > 0) {
    throw new Error(`package.json script ${name} is missing baseline entries: ${missing.join(", ")}`);
  }
}
