import { describe, expect, it } from "vitest";

import { automationContract } from "../../scripts/lib/automation-contract.js";
import { requireAutomationSecurityBaseline } from "../../scripts/lib/automation-security-baseline.js";
import { buildPrStewardActions } from "../../scripts/lib/pr-steward.js";

const baselineInputs = {
  packageScripts: {
    "security:pass": "pnpm audit --audit-level high && git diff --check && pnpm ci:check",
    "validate:ci": "tsx scripts/validate-ci-workflows.ts",
    "ci:check": "pnpm validate:ci && pnpm test"
  },
  labelNames: ["security-pass-required"],
  mergeBlockerLabels: ["security-pass-required"],
  ciWorkflow: "run: pnpm validate:ci",
  securityWorkflow: [
    "pnpm audit --audit-level high",
    "gitleaks/gitleaks-action",
    "github/codeql-action/init",
    "github/codeql-action/analyze",
    "pnpm build"
  ].join("\n")
};

describe("automation contract manifest", () => {
  it("drives steward stop-label behavior", () => {
    for (const label of automationContract.labels.humanWait) {
      expect(buildPrStewardActions([label, automationContract.labels.securityPassRequired], "passing", false)).toEqual([
        "Stop and wait for a human decision."
      ]);
    }
  });

  it("drives steward state-label guidance", () => {
    expect(buildPrStewardActions([], "passing", false)).toContain(
      `Apply one state label: ${automationContract.labels.state.join(", ")}.`
    );
  });

  it("keeps the evidence command plan in the canonical order", () => {
    expect(automationContract.evidence.commands.map((command) => command.name)).toEqual([
      "typecheck",
      "schema validation",
      "OpenAPI validation",
      "API collection validation",
      "policy fixture validation",
      "connector security gate validation",
      "CLI command contract",
      "container packaging validation",
      "release packaging validation",
      "deployment manifest validation",
      "persistence deployment evidence validation",
      "runbook exercise evidence validation",
      "secure SDLC release evidence validation",
      "live enforcement pilot validation",
      "core engine tests",
      "API runtime tests",
      "SDK PEP conformance tests",
      "sample internal admin app tests",
      "connector package tests",
      "CLI API smoke tests"
    ]);
  });

  it("uses defined labels across automation policy groups", () => {
    const definedLabels = new Set(automationContract.labels.definitions.map((label) => label.name));
    const policyLabels = new Set([
      ...automationContract.labels.state,
      ...automationContract.labels.humanWait,
      ...automationContract.labels.mergeBlockers,
      ...automationContract.labels.stackMembership,
      automationContract.labels.readyToMerge,
      automationContract.labels.securityPassRequired
    ]);

    for (const label of policyLabels) {
      expect(definedLabels.has(label)).toBe(true);
    }
  });

  it("enforces the hard-coded security baseline", () => {
    expect(() => requireAutomationSecurityBaseline(baselineInputs)).not.toThrow();
  });

  it("rejects a weakened security pass script even if the manifest matched it", () => {
    expect(() =>
      requireAutomationSecurityBaseline({
        ...baselineInputs,
        packageScripts: {
          ...baselineInputs.packageScripts,
          "security:pass": "git diff --check && pnpm ci:check"
        }
      })
    ).toThrow("pnpm audit --audit-level high");
  });

  it("rejects removing the required security merge blocker", () => {
    expect(() =>
      requireAutomationSecurityBaseline({
        ...baselineInputs,
        mergeBlockerLabels: []
      })
    ).toThrow("security-pass-required");
  });

  it("rejects weakening CI and security workflow validation", () => {
    expect(() =>
      requireAutomationSecurityBaseline({
        ...baselineInputs,
        ciWorkflow: "run: pnpm validate:automation"
      })
    ).toThrow("pnpm validate:ci");

    expect(() =>
      requireAutomationSecurityBaseline({
        ...baselineInputs,
        securityWorkflow: "pnpm audit --audit-level high\npnpm build"
      })
    ).toThrow("gitleaks/gitleaks-action");
  });
});
