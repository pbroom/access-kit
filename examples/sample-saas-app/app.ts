import type { CanonicalId, DecisionRequest, DecisionResult } from "../../packages/core/src/index.js";
import {
  createAccessKitExpressPepMiddleware,
  type AccessKitClient,
  type ExpressPepRequest,
  type ExpressPepResponse,
  type PolicyTestCheck
} from "../../packages/typescript-client/src/index.js";

export interface SampleSaasCase {
  readonly caseId: string;
  readonly tenantId: CanonicalId;
  readonly resourceId: CanonicalId;
  readonly title: string;
}

export interface SampleSaasRequest extends ExpressPepRequest {
  readonly params?: {
    readonly caseId?: string;
    readonly tenantId?: CanonicalId;
  };
}

export interface SampleSaasAuthorizationContext {
  readonly correlationId: CanonicalId;
  readonly decision: DecisionResult["decision"];
  readonly decisionId: CanonicalId;
  readonly reasonCode: string;
}

export interface SampleSaasDecisionEvent extends SampleSaasAuthorizationContext {
  readonly outcome: "allow" | "deny";
}

export interface SampleSaasErrorEvent {
  readonly correlationId: CanonicalId;
  readonly outcome: "error";
  readonly reasonCode: "ACCESS_KIT_UNAVAILABLE";
}

export interface SampleSaasCaseResponse {
  readonly case: SampleSaasCase;
  readonly authorization: SampleSaasAuthorizationContext;
}

export interface SampleSaasExplainRequest {
  readonly caseId: string;
  readonly correlationId?: CanonicalId;
  readonly subjectId: CanonicalId;
  readonly tenantId: CanonicalId;
}

export interface SampleSaasExplainSummary {
  readonly correlationId: CanonicalId;
  readonly decision: DecisionResult["decision"];
  readonly decisionId?: CanonicalId;
  readonly reasonCode: string;
  readonly pathLength: number;
  readonly resourceId?: CanonicalId;
  readonly tenantId: CanonicalId;
}

export interface SampleSaasPolicyWorkflowReport {
  readonly checks: readonly PolicyTestCheck[];
  readonly correlationId: CanonicalId;
  readonly failingCheckNames: readonly string[];
  readonly valid: boolean;
}

interface MutableSampleSaasRequest extends SampleSaasRequest {
  accessKit?: SampleSaasAuthorizationContext;
}

interface ResolvedSampleSaasRoute {
  readonly case: SampleSaasCase;
  readonly tenantId: CanonicalId;
}

interface RouteLookup {
  readonly reasonCode?: "CASE_ROUTE_NOT_FOUND" | "CASE_ROUTE_OUTSIDE_TENANT_BOUNDARY";
  readonly route?: ResolvedSampleSaasRoute;
}

export const sampleSaasCases: readonly SampleSaasCase[] = [
  {
    caseId: "case-plan",
    resourceId: "document:case-plan",
    tenantId: "tenant:alpha",
    title: "Synthetic case plan"
  }
];

export class SampleSaasApplication {
  readonly #client: AccessKitClient;
  readonly #decisionEvents: Array<SampleSaasDecisionEvent | SampleSaasErrorEvent> = [];
  readonly #middleware: ReturnType<typeof createAccessKitExpressPepMiddleware<SampleSaasRequest>>;

  constructor(options: { readonly client: AccessKitClient }) {
    this.#client = options.client;
    this.#middleware = createAccessKitExpressPepMiddleware({
      client: this.#client,
      buildCorrelationId: buildSampleSaasCorrelationId,
      buildDecisionRequest,
      onDecision: (event) => {
        const logged = toDecisionEvent(event.correlationId, event.outcome, event.decision);
        this.#decisionEvents.push(logged);

        if (logged.outcome !== "error") {
          (event.request as MutableSampleSaasRequest).accessKit = logged;
        }
      }
    });
  }

  get decisionEvents(): readonly (SampleSaasDecisionEvent | SampleSaasErrorEvent)[] {
    return this.#decisionEvents;
  }

  async handleCaseRead(request: SampleSaasRequest, response: ExpressPepResponse): Promise<void> {
    const lookup = lookupCaseRoute(request);
    const correlationId = buildSampleSaasCorrelationId(request);

    if (!lookup.route) {
      denyRoute(response, 404, lookup.reasonCode ?? "CASE_ROUTE_NOT_FOUND", correlationId);
      return;
    }

    const route = lookup.route;

    await this.#middleware(request, response, () => {
      const authorization = (request as MutableSampleSaasRequest).accessKit;

      if (!authorization || authorization.decision !== "allow") {
        denyRoute(response, 503, "ACCESS_KIT_UNAVAILABLE", correlationId);
        return;
      }

      response.status(200).json({
        authorization,
        case: route.case
      } satisfies SampleSaasCaseResponse);
    });
  }

  async explainCaseAccess(request: SampleSaasExplainRequest): Promise<SampleSaasExplainSummary> {
    const correlationId = request.correlationId ?? `corr:sample-saas:explain:${request.tenantId}:${request.caseId}`;
    const lookup = lookupCaseByTenantAndId(request.tenantId, request.caseId);

    if (!lookup.route) {
      return {
        correlationId,
        decision: "deny",
        pathLength: 0,
        reasonCode: lookup.reasonCode ?? "CASE_ROUTE_NOT_FOUND",
        tenantId: request.tenantId
      };
    }

    const decision = await this.#client.explain({
      action: "read",
      context: decisionContext(lookup.route),
      resourceId: lookup.route.case.resourceId,
      subjectId: request.subjectId
    }, { correlationId });

    return {
      correlationId,
      decision: decision.decision,
      decisionId: decision.decisionId,
      pathLength: decision.relationshipPath.length,
      reasonCode: decision.reasonCode,
      resourceId: decision.resourceId,
      tenantId: lookup.route.tenantId
    };
  }

  async runPolicyWorkflow(policyId: CanonicalId, correlationId = "corr:sample-saas:policy-test"): Promise<SampleSaasPolicyWorkflowReport> {
    const result = await this.#client.testPolicy(policyId, { correlationId });
    const failingCheckNames = result.checks.filter((check) => check.status === "fail").map((check) => check.name);

    return {
      checks: result.checks,
      correlationId,
      failingCheckNames,
      valid: result.valid && failingCheckNames.length === 0
    };
  }
}

export function createSampleSaasApplication(options: { readonly client: AccessKitClient }): SampleSaasApplication {
  return new SampleSaasApplication(options);
}

function buildDecisionRequest(request: SampleSaasRequest): DecisionRequest {
  const lookup = lookupCaseRoute(request);

  if (!lookup.route) {
    throw new Error("Sample SaaS route is outside the synthetic tenant boundary.");
  }

  return {
    action: "read",
    context: decisionContext(lookup.route),
    resourceId: lookup.route.case.resourceId,
    subjectId: subjectIdFromRequest(request)
  };
}

function decisionContext(route: ResolvedSampleSaasRoute): Record<string, string> {
  return {
    appId: "sample-saas-app",
    routeTemplate: "/tenants/:tenantId/cases/:caseId",
    tenantId: route.tenantId
  };
}

function lookupCaseRoute(request: SampleSaasRequest): RouteLookup {
  const params = routeParams(request);

  if (!params) {
    return { reasonCode: "CASE_ROUTE_NOT_FOUND" };
  }

  return lookupCaseByTenantAndId(params.tenantId, params.caseId);
}

function lookupCaseByTenantAndId(tenantId: CanonicalId, caseId: string): RouteLookup {
  const sampleCase = sampleSaasCases.find((candidate) => candidate.caseId === caseId);

  if (!sampleCase) {
    return { reasonCode: "CASE_ROUTE_NOT_FOUND" };
  }

  if (sampleCase.tenantId !== tenantId) {
    return { reasonCode: "CASE_ROUTE_OUTSIDE_TENANT_BOUNDARY" };
  }

  return {
    route: {
      case: sampleCase,
      tenantId
    }
  };
}

function routeParams(request: SampleSaasRequest): { readonly caseId: string; readonly tenantId: CanonicalId } | undefined {
  if (request.params?.caseId && request.params.tenantId) {
    return {
      caseId: request.params.caseId,
      tenantId: request.params.tenantId
    };
  }

  const path = request.originalUrl ?? request.path;

  if (!path) {
    return undefined;
  }

  const pathname = new URL(path, "https://sample-saas.example.test").pathname;
  const match = /^\/tenants\/([^/]+)\/cases\/([^/]+)$/.exec(pathname);

  if (!match) {
    return undefined;
  }

  const tenantId = decodePathSegment(match[1]);
  const caseId = decodePathSegment(match[2]);

  return tenantId && caseId ? { caseId, tenantId } : undefined;
}

function decodePathSegment(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function subjectIdFromRequest(request: SampleSaasRequest): CanonicalId {
  return headerValue(request, "x-subject-id") ?? "user:anonymous";
}

function buildSampleSaasCorrelationId(request: SampleSaasRequest): CanonicalId {
  const supplied = headerValue(request, "x-correlation-id");

  if (supplied) {
    return supplied;
  }

  const params = routeParams(request);

  if (!params) {
    return "corr:sample-saas:unknown-route";
  }

  return `corr:sample-saas:${params.tenantId}:${params.caseId}`;
}

function headerValue(request: SampleSaasRequest, name: string): string | undefined {
  const headers = request.headers ?? {};
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  const value = entry?.[1];

  return Array.isArray(value) ? value[0] : value;
}

function toDecisionEvent(
  correlationId: CanonicalId,
  outcome: "allow" | "deny" | "error",
  decision: DecisionResult | undefined
): SampleSaasDecisionEvent | SampleSaasErrorEvent {
  if (outcome === "error" || !decision) {
    return {
      correlationId,
      outcome: "error",
      reasonCode: "ACCESS_KIT_UNAVAILABLE"
    };
  }

  return {
    correlationId,
    decision: decision.decision,
    decisionId: decision.decisionId,
    outcome,
    reasonCode: decision.reasonCode
  };
}

function denyRoute(
  response: ExpressPepResponse,
  status: number,
  reasonCode: "ACCESS_KIT_UNAVAILABLE" | "CASE_ROUTE_NOT_FOUND" | "CASE_ROUTE_OUTSIDE_TENANT_BOUNDARY",
  correlationId: CanonicalId
): void {
  response.setHeader("x-correlation-id", correlationId);
  response.status(status).json({
    code: "ACCESS_DENIED",
    correlationId,
    reasonCode
  });
}
