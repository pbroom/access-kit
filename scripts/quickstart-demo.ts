import { pathToFileURL } from "node:url";
import { createDemoSeedHarness, type DecisionResult, type DemoDecisionRequest } from "../packages/core/src/index.js";

export const QUICKSTART_DEFAULT_BASE_URL = "http://127.0.0.1:3000";
export const QUICKSTART_DEFAULT_API_KEY = "local-demo-token";

export interface QuickstartDemoOptions {
  baseUrl?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
  retries?: number;
  retryDelayMs?: number;
}

export interface QuickstartDemoDecisionResult {
  name: string;
  expectedDecision: DemoDecisionRequest["expectedDecision"];
  expectedReasonCode: string;
  check: DecisionResult;
  explain: DecisionResult;
}

export interface QuickstartDemoResult {
  baseUrl: string;
  harnessId: string;
  seedCounts: {
    subjects: number;
    resources: number;
    relationships: number;
  };
  decisions: QuickstartDemoDecisionResult[];
  auditEventCount: number;
}

type JsonRecord = Record<string, unknown>;

interface HttpJsonOptions {
  method?: string;
  body?: unknown;
  apiKey?: string;
}

export async function runQuickstartDemo(options: QuickstartDemoOptions = {}): Promise<QuickstartDemoResult> {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? process.env.REBAC_API_URL ?? QUICKSTART_DEFAULT_BASE_URL);
  const apiKey = options.apiKey ?? process.env.REBAC_API_KEY ?? QUICKSTART_DEFAULT_API_KEY;
  const fetchImpl = options.fetchImpl ?? fetch;
  const log = options.log ?? (() => undefined);
  const harness = createDemoSeedHarness();

  await waitForApi(baseUrl, fetchImpl, options.retries ?? 30, options.retryDelayMs ?? 1000);
  log(`health: ${baseUrl}/v1/health ok`);

  const ready = await httpJson<JsonRecord>(fetchImpl, baseUrl, "/v1/ready");
  log(`ready: ${String(ready.status ?? "unknown")}`);

  for (const subject of harness.seed.subjects ?? []) {
    await httpJson<JsonRecord>(fetchImpl, baseUrl, "/v1/subjects", { method: "POST", body: subject, apiKey });
  }

  for (const resource of harness.seed.resources ?? []) {
    await httpJson<JsonRecord>(fetchImpl, baseUrl, "/v1/resources", { method: "POST", body: resource, apiKey });
  }

  for (const relationship of harness.seed.relationships ?? []) {
    await httpJson<JsonRecord>(fetchImpl, baseUrl, "/v1/relationships", { method: "PUT", body: relationship, apiKey });
  }

  log(
    `seeded: ${harness.seed.subjects?.length ?? 0} subjects, ` +
      `${harness.seed.resources?.length ?? 0} resources, ` +
      `${harness.seed.relationships?.length ?? 0} relationships from ${harness.version}`
  );

  const decisions: QuickstartDemoDecisionResult[] = [];
  for (const name of harness.quickstart.decisionRequestNames) {
    const preset = harness.decisionRequests.find((entry) => entry.name === name);

    if (!preset) {
      throw new Error(`Quickstart decision preset was not found: ${name}`);
    }

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

    assertExpectedDecision(name, preset, check, "check");
    assertExpectedDecision(name, preset, explain, "explain");
    log(`${name}: ${check.decision} ${check.reasonCode}`);

    decisions.push({
      name,
      expectedDecision: preset.expectedDecision,
      expectedReasonCode: preset.expectedReasonCode,
      check,
      explain
    });
  }

  const audit = await httpJson<{ items?: unknown[] }>(fetchImpl, baseUrl, "/v1/audit/events", { apiKey });
  log(`audit events: ${audit.items?.length ?? 0}`);

  return {
    baseUrl,
    harnessId: harness.id,
    seedCounts: {
      subjects: harness.seed.subjects?.length ?? 0,
      resources: harness.seed.resources?.length ?? 0,
      relationships: harness.seed.relationships?.length ?? 0
    },
    decisions,
    auditEventCount: audit.items?.length ?? 0
  };
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
      ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {})
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${path} returned ${response.status}: ${text}`);
  }

  const parsed = text ? JSON.parse(text) as unknown : undefined;

  return parsed as T;
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
  runQuickstartDemo({ log: console.log })
    .then((result) => {
      const allow = result.decisions.find((decision) => decision.check.decision === "allow");
      const deny = result.decisions.find((decision) => decision.check.decision === "deny");

      console.log(`complete: ${result.harnessId}`);
      console.log(`first allow: ${allow?.name ?? "missing"}`);
      console.log(`deny by default: ${deny?.name ?? "missing"}`);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
