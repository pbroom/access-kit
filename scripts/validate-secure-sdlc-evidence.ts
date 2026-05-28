import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";

const repoRoot = process.cwd();
const manifestPath = process.env.REBAC_SECURE_SDLC_MANIFEST ?? "release/security-evidence/ak-044-secure-sdlc.example.json";
const requiredCategories = [
  "sast",
  "dast",
  "dependency_scan",
  "sbom",
  "fuzzing",
  "tenant_isolation_abuse",
  "threat_model",
  "vulnerability_triage",
  "nist_ssdf"
] as const;
const requiredAbusePaths = [
  "authorization",
  "connector",
  "persistence",
  "cross_tenant_isolation",
  "evidence"
] as const;
const requiredControlFamilies = ["AC", "CA", "RA", "SA", "SC", "SI", "SR"] as const;
const statusByCategory = new Map<(typeof requiredCategories)[number], SecureSdlcArtifact["status"]>([
  ["sast", "retained"],
  ["dast", "release-gate-required"],
  ["dependency_scan", "retained"],
  ["sbom", "retained"],
  ["fuzzing", "retained"],
  ["tenant_isolation_abuse", "retained"],
  ["threat_model", "retained"],
  ["vulnerability_triage", "release-gate-required"],
  ["nist_ssdf", "retained"]
]);

interface SecureSdlcArtifact {
  category: (typeof requiredCategories)[number];
  status: "retained" | "release-gate-required";
  owner: string;
  evidencePaths: string[];
  mitigationRefs: MitigationRef[];
  controls: string[];
  retention: string;
}

interface MitigationRef {
  abusePath: (typeof requiredAbusePaths)[number];
  mitigation: string;
  evidencePath: string;
}

interface SecureSdlcManifest {
  version: string;
  releaseRef: string;
  generatedAt: string;
  scope: string;
  artifacts: SecureSdlcArtifact[];
}

const manifest = readManifest(manifestPath);
requireEquals(manifest.version, "secure-sdlc-evidence:v1", "manifest version");
requireNonEmptyString(manifest.releaseRef, "releaseRef");
requireNonEmptyString(manifest.generatedAt, "generatedAt");
requireEquals(manifest.scope, "local-proof-point-release", "scope");

const artifactsByCategory = new Map(manifest.artifacts.map((artifact) => [artifact.category, artifact]));
const coveredAbusePaths = new Set<(typeof requiredAbusePaths)[number]>();
const coveredControlFamilies = new Set<string>();

requireUniqueCategories(manifest.artifacts);

for (const category of requiredCategories) {
  const artifact = artifactsByCategory.get(category);
  if (!artifact) {
    throw new Error(`Secure SDLC manifest is missing ${category} evidence.`);
  }

  validateArtifact(artifact);
  for (const mitigation of artifact.mitigationRefs) {
    coveredAbusePaths.add(mitigation.abusePath);
  }
  for (const control of artifact.controls) {
    coveredControlFamilies.add(readControlFamily(control));
  }
}

for (const abusePath of requiredAbusePaths) {
  if (!coveredAbusePaths.has(abusePath)) {
    throw new Error(`Secure SDLC manifest does not map evidence to ${abusePath} abuse-path mitigation.`);
  }
}

for (const family of requiredControlFamilies) {
  if (!coveredControlFamilies.has(family)) {
    throw new Error(`Secure SDLC manifest does not include ${family} control coverage.`);
  }
}

console.log("Validated secure SDLC release evidence.");
console.log("PASS SAST, DAST, dependency, SBOM, fuzzing, tenant-isolation abuse, threat-model, vulnerability triage, and NIST SSDF evidence are retained or release-gated.");
console.log("PASS Secure SDLC evidence maps mitigations across authorization, connector, persistence, cross-tenant isolation, and evidence-abuse paths.");

function readManifest(path: string): SecureSdlcManifest {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const value = asRecord(parsed, "secure SDLC manifest");
  const artifacts = value.artifacts;

  if (!Array.isArray(artifacts)) {
    throw new Error("secure SDLC manifest artifacts must be an array.");
  }

  return {
    version: readString(value.version, "version"),
    releaseRef: readString(value.releaseRef, "releaseRef"),
    generatedAt: readString(value.generatedAt, "generatedAt"),
    scope: readString(value.scope, "scope"),
    artifacts: artifacts.map((artifact, index) => readArtifact(artifact, index))
  };
}

function readArtifact(value: unknown, index: number): SecureSdlcArtifact {
  const artifact = asRecord(value, `artifact ${index}`);
  const evidencePaths = readStringArray(artifact.evidencePaths, `artifact ${index} evidencePaths`);
  const mitigationRefs = readMitigationRefs(artifact.mitigationRefs, index);
  const controls = readStringArray(artifact.controls, `artifact ${index} controls`);
  const category = readCategory(artifact.category, `artifact ${index} category`);
  const status = readStatus(artifact.status, `artifact ${index} status`);

  return {
    category,
    status,
    owner: readString(artifact.owner, `artifact ${index} owner`),
    evidencePaths,
    mitigationRefs,
    controls,
    retention: readString(artifact.retention, `artifact ${index} retention`)
  };
}

function validateArtifact(artifact: SecureSdlcArtifact): void {
  requireEquals(artifact.status, statusByCategory.get(artifact.category), `${artifact.category} evidence status`);
  requireNonEmptyString(artifact.owner, `${artifact.category} owner`);
  requireEquals(artifact.retention, "per-release", `${artifact.category} retention`);

  if (artifact.evidencePaths.length < 2) {
    throw new Error(`${artifact.category} evidence must reference at least two retained paths.`);
  }

  for (const evidencePath of artifact.evidencePaths) {
    requireRepoRelativeRetainedPath(evidencePath, `${artifact.category} evidence path`);
  }

  if (artifact.controls.length === 0) {
    throw new Error(`${artifact.category} evidence must map to at least one control.`);
  }

  if (artifact.mitigationRefs.length === 0) {
    throw new Error(`${artifact.category} evidence must map to at least one abuse-path mitigation.`);
  }

  for (const control of artifact.controls) {
    if (!/^[A-Z]{2,3}-\d+[A-Z]?$/u.test(control)) {
      throw new Error(`${artifact.category} control ${control} must use a NIST-style family-number identifier.`);
    }
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value;
}

function readStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty array.`);
  }

  return value.map((item, index) => readString(item, `${label}[${index}]`));
}

function readMitigationRefs(value: unknown, artifactIndex: number): MitigationRef[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`artifact ${artifactIndex} mitigationRefs must be a non-empty array.`);
  }

  return value.map((item, index) => {
    const mitigation = asRecord(item, `artifact ${artifactIndex} mitigationRefs[${index}]`);
    const evidencePath = readString(mitigation.evidencePath, `artifact ${artifactIndex} mitigationRefs[${index}] evidencePath`);
    requireRepoRelativeRetainedPath(evidencePath, `artifact ${artifactIndex} mitigationRefs[${index}] evidence path`);

    return {
      abusePath: readAbusePath(mitigation.abusePath, `artifact ${artifactIndex} mitigationRefs[${index}] abusePath`),
      mitigation: readString(mitigation.mitigation, `artifact ${artifactIndex} mitigationRefs[${index}] mitigation`),
      evidencePath
    };
  });
}

function requireRepoRelativeRetainedPath(repoPath: string, label: string): void {
  if (isAbsolute(repoPath)) {
    throw new Error(`${label} must be repo-relative, not absolute: ${repoPath}`);
  }

  const parts = repoPath.split("/");
  if (repoPath.includes("\\") || parts.some((part) => part === "" || part === ".")) {
    throw new Error(`${label} must be a normalized repo-relative path: ${repoPath}`);
  }

  if (parts.includes("..")) {
    throw new Error(`${label} must not contain traversal segments: ${repoPath}`);
  }

  const resolved = resolve(repoRoot, repoPath);
  if (resolved !== repoRoot && !resolved.startsWith(`${repoRoot}${sep}`)) {
    throw new Error(`${label} must stay within the repository: ${repoPath}`);
  }

  if (!existsSync(resolved)) {
    throw new Error(`${label} does not exist: ${repoPath}`);
  }
}

function readCategory(value: unknown, label: string): SecureSdlcArtifact["category"] {
  const category = readString(value, label);
  if (!requiredCategories.includes(category as (typeof requiredCategories)[number])) {
    throw new Error(`${label} must be one of ${requiredCategories.join(", ")}.`);
  }

  return category as SecureSdlcArtifact["category"];
}

function readStatus(value: unknown, label: string): SecureSdlcArtifact["status"] {
  const status = readString(value, label);
  if (status !== "retained" && status !== "release-gate-required") {
    throw new Error(`${label} must be retained or release-gate-required.`);
  }

  return status;
}

function readAbusePath(value: unknown, label: string): MitigationRef["abusePath"] {
  const abusePath = readString(value, label);
  if (!requiredAbusePaths.includes(abusePath as (typeof requiredAbusePaths)[number])) {
    throw new Error(`${label} must be one of ${requiredAbusePaths.join(", ")}.`);
  }

  return abusePath as MitigationRef["abusePath"];
}

function readControlFamily(control: string): string {
  const [family] = control.split("-");
  if (!family) {
    throw new Error(`control ${control} must include a family prefix.`);
  }

  return family;
}

function requireUniqueCategories(artifacts: SecureSdlcArtifact[]): void {
  const seen = new Set<string>();
  for (const artifact of artifacts) {
    if (seen.has(artifact.category)) {
      throw new Error(`Secure SDLC manifest contains duplicate ${artifact.category} evidence.`);
    }
    seen.add(artifact.category);
  }
}

function requireEquals(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} must be ${String(expected)}.`);
  }
}

function requireNonEmptyString(value: string, label: string): void {
  if (value.length === 0) {
    throw new Error(`${label} must be non-empty.`);
  }
}
