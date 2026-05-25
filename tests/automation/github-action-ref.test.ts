import { describe, expect, it } from "vitest";

import { isPinnedRequiredActionUse, isRequiredActionUse } from "../../scripts/lib/github-action-ref.js";

const fullSha = "34e114876b0b11c390a56381ad16ebd13914f8d5";

describe("GitHub Action refs", () => {
  it("matches required action uses by exact action name", () => {
    expect(isRequiredActionUse(`gitleaks/gitleaks-action@${fullSha}`, "gitleaks/gitleaks-action")).toBe(true);
    expect(isRequiredActionUse("gitleaks/gitleaks-action", "gitleaks/gitleaks-action")).toBe(true);
    expect(isRequiredActionUse(`gitleaks/gitleaks-action-extra@${fullSha}`, "gitleaks/gitleaks-action")).toBe(false);
  });

  it("accepts required action uses pinned to full SHA refs", () => {
    expect(isPinnedRequiredActionUse(`gitleaks/gitleaks-action@${fullSha}`, "gitleaks/gitleaks-action")).toBe(true);
    expect(
      isPinnedRequiredActionUse("github/codeql-action/init@458D36D7D4F47D0DD16CA424C1D3CDA0060F1360", "github/codeql-action/init")
    ).toBe(true);
  });

  it("rejects mutable or incomplete required action refs", () => {
    expect(isPinnedRequiredActionUse("gitleaks/gitleaks-action@v2", "gitleaks/gitleaks-action")).toBe(false);
    expect(isPinnedRequiredActionUse("gitleaks/gitleaks-action@main", "gitleaks/gitleaks-action")).toBe(false);
    expect(isPinnedRequiredActionUse("gitleaks/gitleaks-action", "gitleaks/gitleaks-action")).toBe(false);
    expect(
      isPinnedRequiredActionUse("gitleaks/gitleaks-action@ff98106e4c7b2bc287b24eaf42907196329070c", "gitleaks/gitleaks-action")
    ).toBe(false);
    expect(
      isPinnedRequiredActionUse(
        "gitleaks/gitleaks-action@ff98106e4c7b2bc287b24eaf42907196329070c7 # v2",
        "gitleaks/gitleaks-action"
      )
    ).toBe(false);
  });
});
