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
    return spawnSync(process.execPath, ["--import", "tsx", "scripts/validate-release-packaging.ts"], {
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
