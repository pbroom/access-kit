import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

interface SecureSdlcManifest {
  artifacts: SecureSdlcArtifact[];
}

interface SecureSdlcArtifact {
  category: string;
  evidencePaths: string[];
  mitigationRefs: Array<{ evidencePath: string }>;
}

const repoRoot = process.cwd();
const manifestPath = "release/security-evidence/ak-044-secure-sdlc.example.json";

describe("secure SDLC evidence validation", () => {
  it("rejects absolute retained evidence paths", () => {
    const manifest = readValidManifest();
    manifest.artifacts[0]!.evidencePaths[0] = "/tmp/fake-sast.sarif";

    const result = runValidator(manifest);

    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toContain("sast evidence path must be repo-relative");
  });

  it("rejects traversal in mitigation evidence refs", () => {
    const manifest = readValidManifest();
    manifest.artifacts[0]!.mitigationRefs[0]!.evidencePath = "../docs/security-model.md";

    const result = runValidator(manifest);

    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toContain("artifact 0 mitigationRefs[0] evidence path must not contain traversal segments");
  });
});

function readValidManifest(): SecureSdlcManifest {
  return JSON.parse(readFileSync(join(repoRoot, manifestPath), "utf8")) as SecureSdlcManifest;
}

function runValidator(manifest: SecureSdlcManifest): SpawnSyncReturns<string> {
  const tempDir = mkdtempSync(join(tmpdir(), "access-kit-secure-sdlc-"));
  const tempManifestPath = join(tempDir, "secure-sdlc.json");

  try {
    writeFileSync(tempManifestPath, JSON.stringify(manifest, null, 2));
    return spawnSync(process.execPath, ["--import", "tsx", "scripts/validate-secure-sdlc-evidence.ts"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        REBAC_SECURE_SDLC_MANIFEST: tempManifestPath
      }
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
