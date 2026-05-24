import { describe, expect, it } from "vitest";

import { readCheckConclusion, summarizeChecks } from "../../scripts/lib/github-cli.js";
import { buildPrStewardActions } from "../../scripts/lib/pr-steward.js";

describe("GitHub check rollup helpers", () => {
  it("treats skipped terminal checks as passing", () => {
    expect(
      summarizeChecks([
        { status: "COMPLETED", conclusion: "SUCCESS" },
        { status: "COMPLETED", conclusion: "NEUTRAL" },
        { status: "COMPLETED", conclusion: "SKIPPED" }
      ])
    ).toBe("passing");
  });

  it("prioritizes failing conclusions over skipped checks", () => {
    expect(
      summarizeChecks([
        { status: "COMPLETED", conclusion: "SKIPPED" },
        { status: "COMPLETED", conclusion: "FAILURE" }
      ])
    ).toBe("failing");
  });

  it("reports unfinished checks as pending", () => {
    expect(summarizeChecks([{ status: "IN_PROGRESS" }, { conclusion: "" }])).toBe("pending");
  });

  it("returns unknown when GitHub provides no check conclusions", () => {
    expect(summarizeChecks(undefined)).toBe("unknown");
    expect(summarizeChecks([{ status: "COMPLETED" }])).toBe("unknown");
  });

  it("normalizes status-only checks", () => {
    expect(readCheckConclusion({ status: "queued" })).toBe("PENDING");
    expect(readCheckConclusion({ status: "completed" })).toBeUndefined();
  });
});

describe("PR steward action helpers", () => {
  it("does not ask for a security pass while waiting for a human decision", () => {
    expect(buildPrStewardActions(["needs-human", "security-pass-required"], "passing", false)).toEqual([
      "Stop and wait for a human decision."
    ]);

    expect(buildPrStewardActions(["blocked", "security-pass-required"], "passing", false)).toEqual([
      "Stop and wait for a human decision."
    ]);
  });
});
