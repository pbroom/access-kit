import manifest from "../../examples/sample-policy-repository/policy-repository.json" assert { type: "json" };
import { describe, expect, it } from "vitest";
import { automationContract } from "../../scripts/lib/automation-contract.js";

describe("sample policy repository automation wiring", () => {
  it("keeps the manifest and root CI contract pointed at the sample policy validator", () => {
    const ciWorkflow = automationContract.ci.workflows.find((workflow) => workflow.path === ".github/workflows/ci.yml");

    expect(manifest.currentPolicyVersion).toBe("policy:case-docs-v2");
    expect(manifest.ci.command).toBe("pnpm validate:sample-policy");
    expect(ciWorkflow?.jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "policy-tests",
          requiredRuns: ["pnpm validate:sample-policy"]
        })
      ])
    );
  });
});

