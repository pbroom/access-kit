import { createDemoSeedHarness } from "../../packages/core/src/index.js";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type ApiCollectionAuthMode = "inherit" | "none" | "invalid";
export type ApiCollectionMethod = "GET" | "POST";

export type ApiCollectionCoverage =
  | "decision_check"
  | "decision_explain"
  | "policy_create"
  | "policy_test"
  | "provisioning_plan"
  | "provisioning_job"
  | "reconciliation"
  | "auth_failure_missing"
  | "auth_failure_invalid"
  | "audit_export"
  | "evidence_export";

export interface ApiCollectionCapture {
  readonly variable: string;
  readonly responsePath: readonly string[];
}

export interface ApiCollectionRequestDefinition {
  readonly name: string;
  readonly slug: string;
  readonly folder: string;
  readonly sequence: number;
  readonly method: ApiCollectionMethod;
  readonly path: string;
  readonly query?: Record<string, string>;
  readonly body?: JsonValue;
  readonly auth: ApiCollectionAuthMode;
  readonly idempotencyKey?: string;
  readonly expectedStatus: number;
  readonly expectedCode?: string;
  readonly coverage: readonly ApiCollectionCoverage[];
  readonly capture?: readonly ApiCollectionCapture[];
  readonly description: string;
}

export interface ApiCollectionDefinitionSet {
  readonly name: string;
  readonly description: string;
  readonly baseUrlVariable: string;
  readonly tokenVariable: string;
  readonly invalidTokenVariable: string;
  readonly defaultBaseUrl: string;
  readonly invalidTokenValue: string;
  readonly requiredCoverage: readonly ApiCollectionCoverage[];
  readonly requests: readonly ApiCollectionRequestDefinition[];
}

export function createApiCollectionDefinitions(): ApiCollectionDefinitionSet {
  const harness = createDemoSeedHarness();
  const allowDecision = requiredDecisionRequest("quickstart-allow-case-plan");
  const explicitDenyDecision = requiredDecisionRequest("evaluation-explicit-deny-restricted-notes");
  const ownerAdminDecision = requiredDecisionRequest("evaluation-owner-admin-case-plan");

  return {
    name: "Access Kit Demo Seed Evaluation",
    description:
      "Synthetic local Postman and Bruno workflows for the Access Kit demo seed harness. No live tenant data or secrets are included.",
    baseUrlVariable: "base_url",
    tokenVariable: "rebac_api_token",
    invalidTokenVariable: "invalid_rebac_api_token",
    defaultBaseUrl: "http://127.0.0.1:8080",
    invalidTokenValue: "intentionally-invalid",
    requiredCoverage: [
      "decision_check",
      "decision_explain",
      "policy_create",
      "policy_test",
      "provisioning_plan",
      "provisioning_job",
      "reconciliation",
      "auth_failure_missing",
      "auth_failure_invalid",
      "audit_export",
      "evidence_export"
    ],
    requests: [
      {
        name: "Create Demo Policy Draft",
        slug: "01-create-demo-policy-draft",
        folder: "Setup",
        sequence: 1,
        method: "POST",
        path: "/v1/policies",
        auth: "inherit",
        idempotencyKey: "example0",
        expectedStatus: 201,
        coverage: ["policy_create"],
        capture: [{ variable: "demo_policy_id", responsePath: ["id"] }],
        description:
          "Creates a policy draft from the demo seed harness policy model so the next policy-test request can run proof points.",
        body: {
          name: harness.policy.name,
          model: cloneJson(harness.policy.model),
          tests: harness.policy.tests.map((test) => ({
            name: test.name,
            request: cloneJson(test.request),
            expectedDecision: test.expectedDecision,
            expectedReasonCode: test.expectedReasonCode
          }))
        }
      },
      {
        name: "Decision Check - Allow Case Plan",
        slug: "02-decision-check-allow-case-plan",
        folder: "Decision",
        sequence: 2,
        method: "POST",
        path: "/v1/decision/check",
        auth: "inherit",
        expectedStatus: 200,
        coverage: ["decision_check"],
        description:
          "Runs the fast allow/deny decision preset for Alice reading the synthetic case plan.",
        body: cloneJson(allowDecision.request)
      },
      {
        name: "Explain Decision - Explicit Deny",
        slug: "03-explain-decision-explicit-deny",
        folder: "Decision",
        sequence: 3,
        method: "POST",
        path: "/v1/decision/explain",
        auth: "inherit",
        expectedStatus: 200,
        coverage: ["decision_explain"],
        description:
          "Runs the explain route for the restricted-notes preset and returns the explicit deny reason and relationship context.",
        body: cloneJson(explicitDenyDecision.request)
      },
      {
        name: "Run Policy Proof-Point Tests",
        slug: "04-run-policy-proof-point-tests",
        folder: "Policy",
        sequence: 4,
        method: "POST",
        path: "/v1/policies/{{demo_policy_id}}/validate",
        auth: "inherit",
        expectedStatus: 200,
        coverage: ["policy_test"],
        description:
          "Executes the policy-test validation mode after the setup request captures the generated demo policy id.",
        body: {
          mode: "test"
        }
      },
      {
        name: "Create Dry-Run Provisioning Plan",
        slug: "05-create-dry-run-provisioning-plan",
        folder: "Provisioning",
        sequence: 5,
        method: "POST",
        path: "/v1/provisioning/plans",
        auth: "inherit",
        idempotencyKey: "example1",
        expectedStatus: 201,
        coverage: ["provisioning_plan"],
        capture: [{ variable: "provisioning_plan_id", responsePath: ["id"] }],
        description:
          "Creates a non-writing provisioning plan against the mock connector using the demo seed owner-admin preset.",
        body: {
          subjectId: ownerAdminDecision.request.subjectId,
          action: ownerAdminDecision.request.action,
          resourceId: ownerAdminDecision.request.resourceId,
          connectorId: "mock",
          dryRun: true,
          context: {
            ...ownerAdminDecision.request.context,
            workflow: "api-collection-dry-run"
          }
        }
      },
      {
        name: "Run Dry-Run Provisioning Job",
        slug: "06-run-dry-run-provisioning-job",
        folder: "Provisioning",
        sequence: 6,
        method: "POST",
        path: "/v1/provisioning/jobs",
        auth: "inherit",
        idempotencyKey: "example2",
        expectedStatus: 202,
        coverage: ["provisioning_job"],
        description:
          "Runs the captured provisioning plan as a dry-run job; provider writes remain skipped.",
        body: {
          planId: "{{provisioning_plan_id}}",
          approverId: "user:case-owner",
          dryRun: true
        }
      },
      {
        name: "Run Reconciliation",
        slug: "07-run-reconciliation",
        folder: "Reconciliation",
        sequence: 7,
        method: "POST",
        path: "/v1/reconciliation/run",
        auth: "inherit",
        idempotencyKey: "example3",
        expectedStatus: 202,
        coverage: ["reconciliation"],
        description:
          "Runs dry-run reconciliation and drift detection for the synthetic mock connector.",
        body: {
          connectorId: "mock",
          dryRun: true
        }
      },
      {
        name: "Missing Bearer Token Fails Closed",
        slug: "08-missing-bearer-token-fails-closed",
        folder: "Authentication Failures",
        sequence: 8,
        method: "POST",
        path: "/v1/decision/check",
        auth: "none",
        expectedStatus: 401,
        expectedCode: "UNAUTHENTICATED",
        coverage: ["auth_failure_missing"],
        description:
          "Demonstrates deny-on-auth-failure behavior when a protected decision route has no bearer token.",
        body: cloneJson(allowDecision.request)
      },
      {
        name: "Invalid Bearer Token Fails Closed",
        slug: "09-invalid-bearer-token-fails-closed",
        folder: "Authentication Failures",
        sequence: 9,
        method: "POST",
        path: "/v1/decision/check",
        auth: "invalid",
        expectedStatus: 401,
        expectedCode: "UNAUTHENTICATED",
        coverage: ["auth_failure_invalid"],
        description:
          "Demonstrates deny-on-auth-failure behavior when a protected decision route has an intentionally invalid bearer token.",
        body: cloneJson(allowDecision.request)
      },
      {
        name: "Export Audit Events",
        slug: "10-export-audit-events",
        folder: "Exports",
        sequence: 10,
        method: "GET",
        path: "/v1/audit/export",
        query: {
          from: "2026-05-21T00:00:00.000Z",
          to: "2026-05-22T00:00:00.000Z",
          target: "operator_download"
        },
        auth: "inherit",
        expectedStatus: 200,
        coverage: ["audit_export"],
        description:
          "Exports SIEM-ready audit records after decision, provisioning, reconciliation, and auth-failure requests."
      },
      {
        name: "Export Evidence Package",
        slug: "11-export-evidence-package",
        folder: "Exports",
        sequence: 11,
        method: "GET",
        path: "/v1/evidence/export",
        query: {
          framework: "fedramp-rev5",
          controls: "AC-3,AU-6",
          from: "2026-05-21T00:00:00.000Z",
          to: "2026-05-22T00:00:00.000Z",
          format: "json"
        },
        auth: "inherit",
        expectedStatus: 200,
        coverage: ["evidence_export"],
        description:
          "Exports local proof-point evidence for the demo seed evaluation controls."
      }
    ]
  };

  function requiredDecisionRequest(name: string) {
    const request = harness.decisionRequests.find((candidate) => candidate.name === name);
    if (!request) {
      throw new Error(`Demo seed harness is missing decision request ${name}.`);
    }
    return request;
  }
}

export function requestUrl(definition: ApiCollectionRequestDefinition): string {
  const query = new URLSearchParams(definition.query ?? {});
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return `${definition.path}${suffix}`;
}

export function renderTemplate(value: string, variables: Record<string, string>): string {
  return value.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_match, key: string) => {
    const replacement = variables[key];
    if (replacement === undefined) {
      throw new Error(`Missing collection variable ${key}.`);
    }
    return replacement;
  });
}

export function renderJsonTemplate(value: JsonValue, variables: Record<string, string>): JsonValue {
  if (typeof value === "string") {
    return renderTemplate(value, variables);
  }

  if (Array.isArray(value)) {
    return value.map((item) => renderJsonTemplate(item, variables));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, renderJsonTemplate(entry, variables)])
    );
  }

  return value;
}

export function readResponsePath(body: unknown, path: readonly string[]): string {
  let value = body;

  for (const segment of path) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Response path ${path.join(".")} did not resolve to a string.`);
    }
    value = (value as Record<string, unknown>)[segment];
  }

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Response path ${path.join(".")} did not resolve to a string.`);
  }

  return value;
}

function cloneJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
