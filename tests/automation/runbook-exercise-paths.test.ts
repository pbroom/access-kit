import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { requireRetainedRepositoryPath } from "../../scripts/lib/retained-paths.js";

const root = process.cwd();

describe("runbook exercise retained evidence paths", () => {
  it("accepts retained repository-relative evidence paths", async () => {
    await expect(requireRetainedRepositoryPath("runbooks/emergency-revocation.md", {
      root,
      label: "runbookRef"
    })).resolves.toBe(resolve(root, "runbooks/emergency-revocation.md"));
  });

  it("rejects absolute paths before resolving evidence", async () => {
    await expect(requireRetainedRepositoryPath(resolve(root, "runbooks/emergency-revocation.md"), {
      root,
      label: "runbookRef"
    })).rejects.toThrow("must be repository-relative");
  });

  it("rejects traversal outside the repository evidence boundary", async () => {
    await expect(requireRetainedRepositoryPath("../outside/package.json", {
      root,
      label: "evidenceRef"
    })).rejects.toThrow("must stay inside the repository");
  });

  it("rejects existing files outside retained evidence roots", async () => {
    await expect(requireRetainedRepositoryPath("package.json", {
      root,
      label: "evidenceRef"
    })).rejects.toThrow("must reference retained evidence under");
  });
});
