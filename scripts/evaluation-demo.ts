import { pathToFileURL } from "node:url";
import {
  createDemoSeedHarness,
  type AuditEventExport,
  type DecisionResult,
  type DemoDecisionRequest,
  type DiscoveryRun,
  type EvidenceExport,
  type PolicyModelValidationResult,
  type ProvisioningJob,
  type ProvisioningPlan,
  type ReconciliationRun
} from "../packages/core/src/index.js";

export const EVALUATION_DEFAULT_BASE_URL = "http://127.0.0.1:3000";
export const EVALUATION_DEFAULT_API_KEY = "local-demo-token";
export const EVALUATION_CONNECTOR_ID = "mock";

export interface EvaluationDemoOptions {
  baseUrl?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
  retries?: number;
  retryDelayMs?: number;
}

export interface EvaluationDemoDecisionResult {
  name: string;
  expectedDecision: DemoDecisionRequest["expectedDecision"];
  expectedReasonCode: string;
  check: DecisionResult;
  explain: DecisionResult;
}

export interface EvaluationDemoResult {
  baseUrl: string;
  harnessId: string;
  seedCounts: {
    subjects: number;
    resources: number;
    relationships: number;
  };
  decisions: EvaluationDemoDecisionResult[];
  policy: {
    id: string;
    status: string;
    validation: PolicyModelValidationResult;
    tests: PolicyModelValidationResult;
  };
  provisioning: {
    plan: ProvisioningPlan;
    job: ProvisioningJob;
  };
  connectorSync: DiscoveryRun;
  reconciliation: ReconciliationRun;
  auditExport: AuditEventExport;
  evidenceExport: EvidenceExport;
}

type JsonRecord = Record<string, unknown>;

interface PolicySummary {
  id: string;
  version: string;
  status: string;
  createdAt: string;
}

interface HttpJsonOptions {
  method?: string;
  body?: unknown;
  apiKey?: string;
  idempotencyKey?: string;
}

export async function runEvaluationDemo(options: EvaluationDemoOptions = {}): Promise<EvaluationDemoResult> {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? process.env.REBAC_API_URL ?? EVALUATION_DEFAULT_BASE_URL);
  const apiKey = options.apiKey ?? process.env.REBAC_API_KEY ?? EVALUATION_DEFAULT_API_KEY;
  const fetchImpl = options.fetchImpl ?? fetch;
  const log = options.log ?? (() => undefined);
  const harness = createDemoSeedHarness();

  await waitForApi(baseUrl, fetchImpl, options.retries ?? 30, options.retryDelayMs ?? 1000);
  log(`health: ${baseUrl}/v1/health ok`);

  const ready = await httpJson<JsonRecord>(fetchImpl, baseUrl, "/v1/ready");
  log(`ready: ${String(ready.status ?? "unknown")}`);

  await seedHarness(fetchImpl, baseUrl, apiKey, harness.seed);
  log(
    `seeded: ${harness.seed.subjects?.length ?? 0} subjects, ` +
      `${harness.seed.resources?.length ?? 0} resources, ` +
      `${harness.seed.relationships?.length ?? 0} relationships from ${harness.version}`
  );

  const policy = await httpJson<PolicySummary>(fetchImpl, baseUrl, "/v1/policies", {
    method: "POST",
    body: harness.policy,
    apiKey,
    idempotencyKey: "evaluation-policy-create"
  });
  const validation = await httpJson<PolicyModelValidationResult>(
    fetchImpl,
    baseUrl,
    `/v1/policies/${encodeURIComponent(policy.id)}/validate`,
    {
      method: "POST",
      body: { mode: "validate" },
      apiKey
    }
  );
  const tests = await httpJson<PolicyModelValidationResult>(
    fetchImpl,
    baseUrl,
    `/v1/policies/${encodeURIComponent(policy.id)}/validate`,
    {
      method: "POST",
      body: { mode: "test" },
      apiKey
    }
  );
  assertPolicyPassed("validate", validation);
  assertPolicyPassed("test", tests);
  log(`policy: ${policy.id} validated and proof-point tests passed`);

  const evaluationPresets = harness.evaluation.decisionRequestNames.map((name) =>
    readDecisionPreset(harness.decisionRequests, name)
  );
  const decisions: EvaluationDemoDecisionResult[] = [];

  for (const preset of evaluationPresets) {
    const check = await httpJson<DecisionResult>(fetchImpl, baseUrl, "/v1/decision/check", {
      method: "POST",
      body: preset.request,
      apiKey
    });
    const explain = await httpJson<DecisionResult>(fetchImpl, baseUrl, "/v1/decision/explain", {
      method: "POST",
      body: preset.request,
      apiKey
    });

    assertExpectedDecision(preset.name, preset, check, "check");
    assertExpectedDecision(preset.name, preset, explain, "explain");
    log(`${preset.name}: ${check.decision} ${check.reasonCode}`);

    decisions.push({
      name: preset.name,
      expectedDecision: preset.expectedDecision,
      expectedReasonCode: preset.expectedReasonCode,
      check,
      explain
    });
  }

  const provisioningPreset = readDecisionPreset(harness.decisionRequests, "evaluation-write-case-plan");
  const plan = await httpJson<ProvisioningPlan>(fetchImpl, baseUrl, "/v1/provisioning/plans", {
    method: "POST",
    body: {
      subjectId: provisioningPreset.request.subjectId,
      action: provisioningPreset.request.action,
      resourceId: provisioningPreset.request.resourceId,
      context: provisioningPreset.request.context,
      connectorId: EVALUATION_CONNECTOR_ID,
      dryRun: true
    },
    apiKey,
    idempotencyKey: "evaluation-plan-create"
  });
  const job = await httpJson<ProvisioningJob>(fetchImpl, baseUrl, "/v1/provisioning/jobs", {
    method: "POST",
    body: {
      planId: plan.id,
      approverId: "user:case-owner",
      dryRun: true
    },
    apiKey,
    idempotencyKey: "evaluation-job-create"
  });
  assertProvisioning(plan, job);
  log(`provisioning: ${plan.status} plan, ${job.status} dry-run job`);

  const connectorSync = await httpJson<DiscoveryRun>(
    fetchImpl,
    baseUrl,
    `/v1/connectors/${encodeURIComponent(EVALUATION_CONNECTOR_ID)}/sync`,
    {
      method: "POST",
      body: { mode: "read_only" },
      apiKey
    }
  );
  const reconciliation = await httpJson<ReconciliationRun>(fetchImpl, baseUrl, "/v1/reconciliation/run", {
    method: "POST",
    body: { connectorId: EVALUATION_CONNECTOR_ID, dryRun: true },
    apiKey
  });
  assertDiscovery(connectorSync, reconciliation);
  log(`reconciliation: ${reconciliation.counts.findings} finding(s) from ${EVALUATION_CONNECTOR_ID}`);

  const auditExport = await httpJson<AuditEventExport>(
    fetchImpl,
    baseUrl,
    "/v1/audit/export?target=operator_download",
    { apiKey }
  );
  const controls = evaluationControls(harness.evidenceLabels, harness.evaluation.evidenceLabelNames);
  const evidenceQuery = new URLSearchParams({
    framework: "nist-800-53",
    controls: controls.join(","),
    format: "json"
  });
  const evidenceExport = await httpJson<EvidenceExport>(fetchImpl, baseUrl, `/v1/evidence/export?${evidenceQuery}`, {
    apiKey
  });
  assertExports(auditExport, evidenceExport, controls);
  log(`evidence: ${evidenceExport.controls.join(",")} with audit ${evidenceExport.auditIntegrity.status}`);

  return {
    baseUrl,
    harnessId: harness.id,
    seedCounts: {
      subjects: harness.seed.subjects?.length ?? 0,
      resources: harness.seed.resources?.length ?? 0,
      relationships: harness.seed.relationships?.length ?? 0
    },
    decisions,
    policy: {
      id: policy.id,
      status: policy.status,
      validation,
      tests
    },
    provisioning: {
      plan,
      job
    },
    connectorSync,
    reconciliation,
    auditExport,
    evidenceExport
  };
}

async function seedHarness(
  fetchImpl: typeof fetch,
  baseUrl: string,
  apiKey: string,
  seed: ReturnType<typeof createDemoSeedHarness>["seed"]
): Promise<void> {
  for (const subject of seed.subjects ?? []) {
    await httpJson<JsonRecord>(fetchImpl, baseUrl, "/v1/subjects", { method: "POST", body: subject, apiKey });
  }

  for (const resource of seed.resources ?? []) {
    await httpJson<JsonRecord>(fetchImpl, baseUrl, "/v1/resources", { method: "POST", body: resource, apiKey });
  }

  for (const relationship of seed.relationships ?? []) {
    await httpJson<JsonRecord>(fetchImpl, baseUrl, "/v1/relationships", {
      method: "PUT",
      body: relationship,
      apiKey
    });
  }
}

async function waitForApi(baseUrl: string, fetchImpl: typeof fetch, retries: number, retryDelayMs: number): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const health = await fetchImpl(`${baseUrl}/v1/health`);

      if (health.ok) {
        return;
      }

      lastError = new Error(`health returned ${health.status}`);
    } catch (error) {
      lastError = error;
    }

    if (attempt < retries) {
      await delay(retryDelayMs);
    }
  }

  throw new Error(`ReBAC API did not become healthy at ${baseUrl}: ${formatError(lastError)}`);
}

async function httpJson<T>(
  fetchImpl: typeof fetch,
  baseUrl: string,
  path: string,
  options: HttpJsonOptions = {}
): Promise<T> {
  const response = await fetchImpl(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
      ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {})
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) as unknown : undefined;

  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${path} returned ${response.status}: ${text}`);
  }

  return parsed as T;
}

function readDecisionPreset(requests: DemoDecisionRequest[], name: string): DemoDecisionRequest {
  const preset = requests.find((entry) => entry.name === name);

  if (!preset) {
    throw new Error(`Evaluation decision preset was not found: ${name}`);
  }

  return preset;
}

function assertExpectedDecision(
  name: string,
  preset: DemoDecisionRequest,
  result: DecisionResult,
  operation: "check" | "explain"
): void {
  if (result.decision !== preset.expectedDecision || result.reasonCode !== preset.expectedReasonCode) {
    throw new Error(
      `${operation} ${name} expected ${preset.expectedDecision}/${preset.expectedReasonCode} ` +
        `but received ${result.decision}/${result.reasonCode}`
    );
  }
}

function assertPolicyPassed(mode: "validate" | "test", result: PolicyModelValidationResult): void {
  if (!result.valid || result.checks.some((check) => check.status === "fail")) {
    throw new Error(`policy ${mode} did not pass`);
  }
}

function assertProvisioning(plan: ProvisioningPlan, job: ProvisioningJob): void {
  if (plan.mode !== "dry_run" || plan.status !== "planned" || plan.connectorId !== EVALUATION_CONNECTOR_ID) {
    throw new Error(`unexpected provisioning plan result: ${plan.id}`);
  }

  if (!job.dryRun || job.status !== "completed" || job.verification.readbackState?.providerWrite !== false) {
    throw new Error(`unexpected provisioning job result: ${job.id}`);
  }
}

function assertDiscovery(connectorSync: DiscoveryRun, reconciliation: ReconciliationRun): void {
  if (connectorSync.connectorId !== EVALUATION_CONNECTOR_ID || connectorSync.mode !== "read_only") {
    throw new Error(`unexpected connector sync result: ${connectorSync.id}`);
  }

  if (!reconciliation.dryRun || reconciliation.status !== "completed") {
    throw new Error(`unexpected reconciliation result: ${reconciliation.id}`);
  }
}

function assertExports(auditExport: AuditEventExport, evidenceExport: EvidenceExport, controls: string[]): void {
  if (auditExport.exportedEventCount === 0 || auditExport.auditIntegrity.status !== "verified") {
    throw new Error(`audit export did not include verified local events: ${auditExport.exportId}`);
  }

  for (const control of controls) {
    if (!evidenceExport.controls.includes(control)) {
      throw new Error(`evidence export omitted ${control}`);
    }
  }

  if (evidenceExport.auditIntegrity.status !== "verified") {
    throw new Error(`evidence export audit integrity was ${evidenceExport.auditIntegrity.status}`);
  }
}

function evaluationControls(
  labels: ReturnType<typeof createDemoSeedHarness>["evidenceLabels"],
  labelNames: string[]
): string[] {
  const selected = new Set(labelNames);
  return [...new Set(labels.filter((label) => selected.has(label.name)).flatMap((label) => label.controls))].sort();
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runEvaluationDemo({ log: console.log })
    .then((result) => {
      console.log(`complete: ${result.harnessId}`);
      console.log(`decisions: ${result.decisions.length}`);
      console.log(`policy tests: ${result.policy.tests.valid ? "pass" : "fail"}`);
      console.log(`dry-run job: ${result.provisioning.job.status}`);
      console.log(`reconciliation findings: ${result.reconciliation.counts.findings}`);
      console.log(`audit events exported: ${result.auditExport.exportedEventCount}`);
      console.log(`evidence controls: ${result.evidenceExport.controls.join(",")}`);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
