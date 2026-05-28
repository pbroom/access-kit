import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import manifest from "../../examples/sample-policy-repository/policy-repository.json" assert { type: "json" };
import { describe, expect, it } from "vitest";
import { automationContract } from "../../scripts/lib/automation-contract.js";

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const sampleRoot = join(repoRoot, "examples", "sample-policy-repository");

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

  it("accepts explicit classification-boundary positive and negative sample coverage", async () => {
    await expect(runSamplePolicyValidator(sampleRoot)).resolves.toContain("Validated sample policy repository.");
  });

  it("rejects classification-boundary overclaims that only declare model categories", async () => {
    const tempSampleRoot = await copySampleRepository();

    try {
      const snapshotPath = join(tempSampleRoot, "snapshots", "regression", "case-docs.v2.json");
      const snapshot = JSON.parse(await readFile(snapshotPath, "utf8")) as {
        cases: Array<{ coverage?: unknown[] }>;
      };
      for (const testCase of snapshot.cases) {
        delete testCase.coverage;
      }
      await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);

      await expect(runSamplePolicyValidator(tempSampleRoot)).rejects.toThrow(
        /must include explicit classification-boundary positive and negative regression coverage/
      );
    } finally {
      await rm(tempSampleRoot, { force: true, recursive: true });
    }
  });
});

async function copySampleRepository(): Promise<string> {
  const tempSampleRoot = await mkdtemp(join(tmpdir(), "access-kit-sample-policy-"));
  await cp(sampleRoot, tempSampleRoot, { recursive: true });
  return tempSampleRoot;
}

async function runSamplePolicyValidator(samplePolicyRoot: string): Promise<string> {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    ["--import", "tsx", "scripts/validate-sample-policy-repository.ts"],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        ACCESS_KIT_SAMPLE_POLICY_ROOT: samplePolicyRoot
      }
    }
  );
  return `${stdout}${stderr}`;
}
