import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";
import SwaggerParser from "@apidevtools/swagger-parser";
import type { AnySchema } from "ajv";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import YAML from "yaml";
import { readJsonFile } from "./lib/files.js";
import { isPinnedRequiredActionUse } from "./lib/github-action-ref.js";

type RecordValue = Record<string, unknown>;

interface OpenApiDocument {
  paths: Record<string, Record<string, unknown>>;
}

interface ProductReleaseManifest {
  version: string;
  releaseType: string;
  productionReady: boolean;
  labels: string[];
  artifacts: Array<{
    kind: string;
    proofPoint: boolean;
    productionReady: boolean;
    sbom: string;
    provenance: string;
    signature: string;
    vulnerabilityDisclosure: string;
  }>;
  compatibility: Array<{ component: string }>;
  policies: {
    supportPolicy: string;
    securityPolicy: string;
    vulnerabilityDisclosure: string;
    cveDisclosurePath: string;
  };
  validation: {
    requiredCommands: string[];
    evidenceRefs: string[];
  };
}

const root = process.cwd();
const failures: string[] = [];

await captureFailure("runbook heading validation", validateRunbookHeadings);
await captureFailure("documentation example validation", validateDocumentationExamples);
await captureFailure("container packaging validation", validateContainerPackaging);
await captureFailure("release packaging validation", validateReleasePackaging);

if (failures.length > 0) {
  throw new Error(`Documentation lint failed:\n${failures.join("\n")}`);
}

console.log("Validated documentation headings, examples, and static packaging contracts.");

async function captureFailure(label: string, validate: () => Promise<void>): Promise<void> {
  try {
    await validate();
  } catch (error: unknown) {
    failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function validateRunbookHeadings(): Promise<void> {
  const runbooks = [
    "runbooks/emergency-revocation.md",
    "runbooks/policy-rollback.md",
    "runbooks/drift-remediation.md",
    "runbooks/connector-outage.md",
    "runbooks/break-glass-review.md",
    "runbooks/access-review-exceptions.md",
    "runbooks/audit-evidence-export.md",
    "runbooks/compromised-connector-credential.md",
    "runbooks/decision-api-outage.md",
    "runbooks/degraded-mode-operations.md"
  ];
  const headings = [
    "Purpose",
    "Trigger",
    "Severity",
    "Required Role",
    "Prerequisites",
    "Commands Or Proposed Commands",
    "Expected Output",
    "Verification Steps",
    "Audit Events Emitted",
    "Evidence Retained",
    "Escalation Path",
    "Rollback Or Compensating Action"
  ];

  for (const path of runbooks) {
    let content: string;
    try {
      content = await readFile(join(root, path), "utf8");
    } catch (error: unknown) {
      failures.push(`${path}: ${error instanceof Error ? error.message : "could not read file"}`);
      continue;
    }

    for (const heading of headings) {
      if (!new RegExp(`^## ${escapeRegExp(heading)}\\s*$`, "m").test(content)) {
        failures.push(`${path}: missing required section "## ${heading}"`);
      }
    }
  }
}

async function validateDocumentationExamples(): Promise<void> {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);

  const decisionSchemaPath = "schemas/decision.schema.json";
  const decisionSchema = await readJsonFile<AnySchema>(join(root, decisionSchemaPath));
  ajv.addSchema(decisionSchema, decisionSchemaPath);
  validateSchema(
    ajv,
    "examples/api/explain.response.json",
    decisionSchemaPath,
    await readJsonFile(join(root, "examples/api/explain.response.json"))
  );

  const openApiPath = join(root, "openapi/rebac-control-plane.yaml");
  await SwaggerParser.validate(openApiPath);
  const openApi = YAML.parse(await readFile(openApiPath, "utf8")) as OpenApiDocument;
  const requestSchema = getRequestSchema(openApi, "/v1/decision/check", "post");
  validateInlineSchema(
    ajv,
    "examples/api/decision-check.request.json",
    requestSchema,
    await readJsonFile(join(root, "examples/api/decision-check.request.json"))
  );

  validateInlineSchema(
    ajv,
    "examples/control-evidence-mapping.json",
    {
      type: "object",
      additionalProperties: false,
      required: [
        "controlId",
        "family",
        "status",
        "implementationSummary",
        "evidenceTypes",
        "sourceEventIds",
        "sourceArtifacts",
        "gaps"
      ],
      properties: {
        controlId: { type: "string", pattern: "^[A-Z]{2}-[0-9]+(?:\\([0-9]+\\))?$" },
        family: { type: "string", pattern: "^[A-Z]{2}$" },
        status: { type: "string", enum: ["implemented", "partially_implemented", "planned"] },
        implementationSummary: { type: "string", minLength: 1 },
        evidenceTypes: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
        sourceEventIds: { type: "array", items: { type: "string", pattern: "^[a-z0-9_:-]+$" } },
        sourceArtifacts: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
        gaps: { type: "array", items: { type: "string", minLength: 1 } }
      }
    },
    await readJsonFile(join(root, "examples/control-evidence-mapping.json"))
  );
}

async function validateContainerPackaging(): Promise<void> {
  const dockerfile = await readFile(join(root, "Dockerfile"), "utf8");
  const dockerignore = await readFile(join(root, ".dockerignore"), "utf8");
  const ci = asRecord(YAML.parse(await readFile(join(root, ".github/workflows/ci.yml"), "utf8")), "CI workflow");

  requireText(dockerfile, [
    "FROM node:22-bookworm-slim AS deps",
    "pnpm install --frozen-lockfile",
    "COPY packages/connectors-aws/package.json packages/connectors-aws/package.json",
    "COPY packages/connectors-aws packages/connectors-aws",
    "COPY packages/connectors-microsoft-graph/package.json packages/connectors-microsoft-graph/package.json",
    "COPY packages/connectors-microsoft-graph packages/connectors-microsoft-graph",
    "pnpm --filter @access-kit/api... build",
    "pnpm deploy --filter @access-kit/api --prod --legacy /app",
    "FROM node:22-bookworm-slim AS runtime",
    'REBAC_API_HOST="0.0.0.0"',
    'REBAC_STATE_PATH="/var/lib/access-kit/state/runtime-state.json"',
    'REBAC_EVIDENCE_ROOT="/var/lib/access-kit/evidence"',
    "USER node",
    "HEALTHCHECK",
    "/v1/ready",
    'CMD ["node", "dist/bin.js"]'
  ], "Dockerfile");

  for (const line of ["node_modules", "dist", "coverage", "reports", "tests", ".git"]) {
    if (!dockerignore.split(/\r?\n/).includes(line)) {
      failures.push(`.dockerignore is missing required line: ${line}`);
    }
  }

  const jobs = asRecord(ci.jobs, "CI jobs");
  const job = asRecord(jobs["container-packaging"], "container-packaging job");
  const build = findStep(job, "Build rebac-api image");
  requireEquals(
    readStepRun(build, "container build step").trim(),
    "docker build --target runtime --tag access-kit-rebac-api:${{ github.sha }} .",
    "container build step"
  );
  requireText(readStepRun(findStep(job, "Smoke test rebac-api image"), "container smoke step"), [
    "--name rebac-api-smoke",
    "--env REBAC_API_KEYS=ci-smoke",
    "did not become healthy within 20 seconds",
    "http://127.0.0.1:3000/v1/ready",
    'test "$unauth_status" = "401"',
    'test "$auth_status" = "200"'
  ], "container smoke step");
}

async function validateReleasePackaging(): Promise<void> {
  const workflow = asRecord(
    YAML.parse(await readFile(join(root, ".github/workflows/container-release.yml"), "utf8")),
    "container release workflow"
  );
  const releaseDirectory = process.env.REBAC_RELEASE_MANIFEST_DIR ?? "releases";
  const releaseRoot = isAbsolute(releaseDirectory) ? releaseDirectory : join(root, releaseDirectory);
  const entries = await readdir(releaseRoot, { withFileTypes: true });
  const paths = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(releaseRoot, entry.name, "manifest.json"))
    .sort();

  if (paths.length === 0) {
    failures.push(`${releaseDirectory} must contain at least one release manifest`);
  }

  const schema = await readJsonFile<AnySchema>(join(root, "schemas/product-release-manifest.schema.json"));
  for (const path of paths) {
    const manifest = await readJsonFile<ProductReleaseManifest>(path);
    validateReleaseManifest(schema, manifest, path);
  }

  const triggers = asRecord(workflow.on, "container release triggers");
  const dispatch = asRecord(triggers.workflow_dispatch, "container release workflow_dispatch");
  const inputs = asRecord(dispatch.inputs, "container release workflow_dispatch inputs");
  const publish = asRecord(inputs.publish, "container release publish input");
  requireEquals(publish.type, "boolean", "container release publish input type");
  requireEquals(publish.default, false, "container release publish input default");
  const push = asRecord(triggers.push, "container release push trigger");
  requireArrayEntry(push.tags, "rebac-api-v*", "container release tags");

  const env = asRecord(workflow.env, "container release env");
  requireEquals(env.REGISTRY, "ghcr.io", "container release registry");
  requireEquals(env.IMAGE_NAME, "${{ github.repository }}/rebac-api", "container release image name");
  requireEquals(env.SHOULD_PUBLISH, "${{ github.event_name == 'push' || inputs.publish == true }}", "container release publish gate");

  const permissions = asRecord(workflow.permissions, "container release permissions");
  for (const [name, value] of Object.entries({
    contents: "read",
    packages: "write",
    "id-token": "write",
    attestations: "write"
  })) {
    requireEquals(permissions[name], value, `container release ${name} permission`);
  }
  requireEquals(asRecord(workflow.concurrency, "container release concurrency")["cancel-in-progress"], false, "container release concurrency");

  const jobs = asRecord(workflow.jobs, "container release jobs");
  const job = asRecord(jobs["release-api-image"], "release-api-image job");
  for (const [name, action] of [
    ["Set up Docker Buildx", "docker/setup-buildx-action"],
    ["Log in to GHCR", "docker/login-action"],
    ["Generate image metadata", "docker/metadata-action"],
    ["Build image with SBOM and provenance metadata", "docker/build-push-action"],
    ["Install cosign", "sigstore/cosign-installer"],
    ["Attest build provenance", "actions/attest-build-provenance"]
  ]) {
    const uses = findStep(job, name).uses;
    if (typeof uses !== "string" || !isPinnedRequiredActionUse(uses, action)) {
      failures.push(`${name} must use ${action} pinned to a full 40-character SHA ref`);
    }
  }

  const build = findStep(job, "Build image with SBOM and provenance metadata");
  requireWith(build, "target", "runtime", "build image step");
  requireWith(build, "provenance", "mode=max", "build image step");
  requireWith(build, "sbom", true, "build image step");
  const attest = findStep(job, "Attest build provenance");
  requireWith(attest, "push-to-registry", true, "attest build provenance step");
  requireWith(attest, "subject-digest", "${{ steps.build.outputs.digest }}", "attest build provenance step");
  const sign = findStep(job, "Sign published image");
  requireEnv(sign, "IMAGE_REF", "${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}@${{ steps.build.outputs.digest }}", "sign published image step");
  requireEquals(readStepRun(sign, "sign published image step").trim(), 'cosign sign --yes "$IMAGE_REF"', "sign published image step");
  const summary = findStep(job, "Publish release summary");
  requireEnv(summary, "IMAGE_DIGEST", "${{ steps.build.outputs.digest }}", "publish release summary step");
  requireText(readStepRun(summary, "publish release summary step"), [
    'if [ -n "$IMAGE_DIGEST" ]',
    'image_ref="${IMAGE_REPOSITORY}@${IMAGE_DIGEST}"'
  ], "publish release summary step");
}

function validateReleaseManifest(schema: AnySchema, manifest: ProductReleaseManifest, path: string): void {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (!validate(manifest)) {
    failures.push(`${path} failed schema validation: ${ajv.errorsText(validate.errors)}`);
    return;
  }

  requireEquals(manifest.version, "product-release-manifest:v1", `${path} manifest version`);
  if (manifest.releaseType === "proof_point") {
    requireEquals(manifest.productionReady, false, `${path} proof-point productionReady`);
    requireArrayEntry(manifest.labels, "proof-point", `${path} labels`);
    requireArrayEntry(manifest.labels, "not-production-ready", `${path} labels`);
    if (manifest.labels.includes("production-ready")) {
      failures.push(`${path} proof-point release labels must not include production-ready`);
    }
  } else {
    requireEquals(manifest.releaseType, "production_ready", `${path} release type`);
    requireEquals(manifest.productionReady, true, `${path} production-ready productionReady`);
    requireArrayEntry(manifest.labels, "production-ready", `${path} labels`);
    if (manifest.labels.includes("not-production-ready")) {
      failures.push(`${path} production-ready release labels must not include not-production-ready`);
    }
  }

  for (const kind of ["source", "container", "cli", "sdk", "docs_site"]) {
    const artifact = manifest.artifacts.find((entry) => entry.kind === kind);
    if (!artifact) {
      failures.push(`${path} is missing ${kind} artifact channel`);
      continue;
    }
    if (manifest.releaseType === "proof_point") {
      requireEquals(artifact.proofPoint, true, `${path} ${kind} artifact proofPoint`);
    }
    requireEquals(artifact.productionReady, manifest.productionReady, `${path} ${kind} artifact productionReady`);
    for (const [label, value] of [
      ["SBOM", artifact.sbom],
      ["provenance", artifact.provenance],
      ["signature", artifact.signature]
    ]) {
      requireReleaseEvidenceRef(value, `${path} ${kind} artifact ${label}`);
    }
    requireNonEmpty(artifact.vulnerabilityDisclosure, `${path} ${kind} artifact vulnerability disclosure`);
  }

  for (const component of ["Node.js", "pnpm", "API contract", "Container runtime", "Release manifest"]) {
    if (!manifest.compatibility.some((entry) => entry.component === component)) {
      failures.push(`${path} compatibility matrix is missing ${component}`);
    }
  }
  requireEquals(manifest.policies.supportPolicy, "docs/support-policy.md", `${path} support policy path`);
  requireEquals(manifest.policies.securityPolicy, "SECURITY.md", `${path} security policy path`);
  requireText(manifest.policies.vulnerabilityDisclosure, ["GitHub private vulnerability reporting"], `${path} vulnerability disclosure`);
  requireText(manifest.policies.cveDisclosurePath, ["CVE"], `${path} CVE disclosure path`);
  requireText(manifest.validation.requiredCommands.join("\n"), ["corepack pnpm ci:check", "git diff --check"], `${path} validation commands`);
  requireText(manifest.validation.evidenceRefs.join("\n"), ["reports/proof-point-validation.md"], `${path} evidence refs`);
  for (const evidenceRef of manifest.validation.evidenceRefs) {
    requireReleaseEvidenceRef(evidenceRef, `${path} release evidence ref`);
  }
}

function validateSchema(ajv: Ajv2020, path: string, schemaPath: string, data: unknown): void {
  const validate = ajv.getSchema(schemaPath);
  if (!validate || !validate(data)) {
    failures.push(`${path} failed ${schemaPath}: ${ajv.errorsText(validate?.errors)}`);
  }
}

function validateInlineSchema(ajv: Ajv2020, path: string, schema: RecordValue, data: unknown): void {
  const validate = ajv.compile(schema);
  if (!validate(data)) {
    failures.push(`${path} failed validation: ${ajv.errorsText(validate.errors)}`);
  }
}

function getRequestSchema(openApi: OpenApiDocument, path: string, method: string): RecordValue {
  const operation = asRecord(asRecord(openApi.paths[path], `${path} path`)[method], `${method} ${path}`);
  const requestBody = asRecord(operation.requestBody, `${method} ${path} requestBody`);
  const content = asRecord(requestBody.content, `${method} ${path} content`);
  const json = asRecord(content["application/json"], `${method} ${path} JSON content`);
  return asRecord(resolveLocalRefs(json.schema, openApi), `${method} ${path} schema`);
}

function resolveLocalRefs(value: unknown, document: unknown, seen = new Set<string>()): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => resolveLocalRefs(entry, document, seen));
  }
  if (!isRecord(value)) {
    return value;
  }
  if (typeof value.$ref === "string") {
    if (!value.$ref.startsWith("#/") || seen.has(value.$ref)) {
      throw new Error(`Unsupported or circular OpenAPI ref: ${value.$ref}`);
    }
    let resolved: unknown = document;
    for (const segment of value.$ref.slice(2).split("/")) {
      resolved = asRecord(resolved, value.$ref)[segment.replace(/~1/g, "/").replace(/~0/g, "~")];
    }
    return resolveLocalRefs(resolved, document, new Set([...seen, value.$ref]));
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, resolveLocalRefs(entry, document, seen)]));
}

function findStep(job: RecordValue, name: string): RecordValue {
  const steps = Array.isArray(job.steps) ? job.steps : [];
  const step = steps.find((entry) => isRecord(entry) && entry.name === name);
  if (!isRecord(step)) {
    throw new Error(`Workflow job is missing step: ${name}`);
  }
  return step;
}

function readStepRun(step: RecordValue, label: string): string {
  if (typeof step.run !== "string") {
    throw new Error(`${label} must include a run script`);
  }
  return step.run;
}

function requireWith(step: RecordValue, key: string, expected: unknown, label: string): void {
  requireEquals(asRecord(step.with, `${label} with`)[key], expected, `${label} ${key}`);
}

function requireEnv(step: RecordValue, key: string, expected: string, label: string): void {
  requireEquals(asRecord(step.env, `${label} env`)[key], expected, `${label} ${key}`);
}

function requireText(contents: string, needles: readonly string[], label: string): void {
  for (const needle of needles) {
    if (!contents.includes(needle)) {
      failures.push(`${label} is missing required text: ${needle}`);
    }
  }
}

function requireArrayEntry(value: unknown, expected: string, label: string): void {
  if (!Array.isArray(value) || !value.includes(expected)) {
    failures.push(`${label} is missing required entry: ${expected}`);
  }
}

function requireEquals(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    failures.push(`${label} expected ${String(expected)} but found ${String(actual)}`);
  }
}

function requireNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) {
    failures.push(`${label} must be non-empty`);
  }
}

function requireReleaseEvidenceRef(value: string, label: string): void {
  requireNonEmpty(value, label);
  if (isRetainedPath(value) || /^(attestation|cosign|npm-provenance|npm-integrity):[a-z0-9][a-z0-9._:/@+-]*$/u.test(value)) {
    return;
  }
  if (/<[^>]+>|\b(?:placeholder|tbd|todo|when configured|when .* lands|retained with release evidence|metadata from|source release provenance|documentation source paths)\b/iu.test(value)) {
    failures.push(`${label} must not be placeholder-like release evidence: ${value}`);
    return;
  }
  failures.push(`${label} must be a concrete repo-relative retained path or signed attestation ref: ${value}`);
}

function isRetainedPath(path: string): boolean {
  if (isAbsolute(path) || path.includes("\\") || path.split("/").some((part) => part === "" || part === "." || part === "..")) {
    return false;
  }
  const resolved = resolve(root, path);
  return (resolved === root || resolved.startsWith(`${root}${sep}`)) && existsSync(resolved);
}

function asRecord(value: unknown, label: string): RecordValue {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
