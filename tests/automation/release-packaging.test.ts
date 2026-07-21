import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

interface ProductReleaseManifest {
  labels: string[];
  productionReady: boolean;
  releaseType: "proof_point" | "production_ready";
  artifacts: ProductReleaseArtifact[];
}

interface ProductReleaseArtifact {
  kind: string;
  sbom: string;
  provenance: string;
  signature: string;
}

const repoRoot = process.cwd();
const manifestPath = "releases/v0.1.0/manifest.json";

describe("release packaging validation", () => {
  it("rejects placeholder-like artifact evidence", () => {
    const manifest = readValidManifest();
    manifest.artifacts.find((artifact) => artifact.kind === "source")!.sbom =
      "Dependency audit and package lock retained with release evidence";

    const result = runValidator(manifest);

    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toContain("source artifact SBOM must not be placeholder-like release evidence");
  });

  it("rejects artifact evidence that is neither retained nor signed", () => {
    const manifest = readValidManifest();
    manifest.artifacts.find((artifact) => artifact.kind === "container")!.signature = "signed image evidence";

    const result = runValidator(manifest);

    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toContain("container artifact signature must be a concrete repo-relative retained path or signed attestation ref");
  });

  it("rejects proof-point releases that also claim production-ready labels", () => {
    const manifest = readValidManifest();
    manifest.labels.push("production-ready");

    const result = runValidator(manifest);

    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toContain("proof-point release labels must not include production-ready");
  });

  it("collects unexpected validator errors into the final documentation lint summary", () => {
    const missingReleaseDir = mkdtempSync(join(tmpdir(), "access-kit-missing-release-packaging-"));
    rmSync(missingReleaseDir, { recursive: true, force: true });

    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/validate-docs-lint.ts"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        REBAC_RELEASE_MANIFEST_DIR: missingReleaseDir
      }
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toContain("Documentation lint failed:");
    expect(result.stderr + result.stdout).toContain("release packaging validation:");
  });
});

function readValidManifest(): ProductReleaseManifest {
  return JSON.parse(readFileSync(join(repoRoot, manifestPath), "utf8")) as ProductReleaseManifest;
}

function runValidator(manifest: ProductReleaseManifest): SpawnSyncReturns<string> {
  const tempDir = mkdtempSync(join(tmpdir(), "access-kit-release-packaging-"));
  const tempReleaseDir = join(tempDir, "vtest");

  try {
    mkdirSync(tempReleaseDir, { recursive: true });
    writeFileSync(join(tempReleaseDir, "manifest.json"), JSON.stringify(manifest, null, 2));
    return spawnSync(process.execPath, ["--import", "tsx", "scripts/validate-docs-lint.ts"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        REBAC_RELEASE_MANIFEST_DIR: tempDir
      }
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
