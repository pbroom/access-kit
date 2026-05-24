import { describe, expect, it } from "vitest";

import { automationContract } from "../../scripts/lib/automation-contract.js";
import { buildPrStewardActions } from "../../scripts/lib/pr-steward.js";

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
      "policy fixture validation",
      "CLI command contract",
      "container packaging validation",
      "release packaging validation",
      "deployment manifest validation",
      "persistence deployment evidence validation",
      "core engine tests",
      "API runtime tests",
      "CLI API smoke tests"
    ]);
  });

  it("uses the same state labels that the label manifest defines", () => {
    const definedLabels = new Set(automationContract.labels.definitions.map((label) => label.name));

    for (const label of automationContract.labels.state) {
      expect(definedLabels.has(label)).toBe(true);
    }
  });
});
