import type { DecisionRequest, DecisionResult } from "@access-kit/core";

export type AccessKitDecision = DecisionResult["decision"];

export interface AccessKitClientOptions {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly fetch?: typeof fetch;
}

export interface AccessKitRequestOptions {
  readonly correlationId?: string;
}

export class AccessKitClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly correlationId?: string,
    readonly retryAfter?: string
  ) {
    super(`${code} (${status})`);
  }
}

export interface AccessKitClient {
  readonly check: (request: DecisionRequest, options?: AccessKitRequestOptions) => Promise<DecisionResult>;
  readonly explain: (request: DecisionRequest, options?: AccessKitRequestOptions) => Promise<DecisionResult>;
  readonly testPolicy: (policyId: string, options?: AccessKitRequestOptions) => Promise<PolicyTestResult>;
}

export interface PolicyTestResult {
  readonly valid: boolean;
  readonly checks: readonly PolicyTestCheck[];
}

export interface PolicyTestCheck {
  readonly name: string;
  readonly status: "fail" | "pass" | "warn";
  readonly message: string;
}

export function createAccessKitClient(options: AccessKitClientOptions): AccessKitClient {
  if (!options.apiKey) {
    throw new AccessKitClientError(401, "CLIENT_MISSING_API_KEY");
  }

  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const clientFetch = options.fetch ?? fetch;

  return {
    check: (request, requestOptions) =>
      postJson<DecisionResult>(clientFetch, baseUrl, "/v1/decision/check", options.apiKey, request, requestOptions),
    explain: (request, requestOptions) =>
      postJson<DecisionResult>(clientFetch, baseUrl, "/v1/decision/explain", options.apiKey, request, requestOptions),
    testPolicy: (policyId, requestOptions) =>
      postJson<PolicyTestResult>(
        clientFetch,
        baseUrl,
        `/v1/policies/${encodeURIComponent(policyId)}/validate`,
        options.apiKey,
        { mode: "test" },
        requestOptions
      )
  };
}

export interface ExpressPepRequest {
  readonly headers?: Record<string, string | string[] | undefined>;
  readonly method?: string;
  readonly originalUrl?: string;
  readonly path?: string;
}

export interface ExpressPepResponse {
  readonly setHeader: (name: string, value: string) => void;
  readonly status: (status: number) => ExpressPepResponse;
  readonly json: (body: unknown) => void;
}

export type ExpressPepNext = (error?: unknown) => void;

export interface AccessKitExpressPepOptions<Request extends ExpressPepRequest = ExpressPepRequest> {
  readonly client: AccessKitClient;
  readonly buildDecisionRequest: (request: Request) => DecisionRequest;
  readonly buildCorrelationId?: (request: Request) => string | undefined;
  readonly onDecision?: (event: AccessKitPepDecisionEvent<Request>) => void;
}

export interface AccessKitPepDecisionEvent<Request extends ExpressPepRequest = ExpressPepRequest> {
  readonly request: Request;
  readonly correlationId: string;
  readonly decision?: DecisionResult;
  readonly error?: unknown;
  readonly outcome: "allow" | "deny" | "error";
}

export function createAccessKitExpressPepMiddleware<Request extends ExpressPepRequest = ExpressPepRequest>(
  options: AccessKitExpressPepOptions<Request>
): (request: Request, response: ExpressPepResponse, next: ExpressPepNext) => Promise<void> {
  return async (request, response, next) => {
    const correlationId = resolveCorrelationId(request, options.buildCorrelationId?.(request));
    response.setHeader("x-correlation-id", correlationId);

    let decisionRequest: DecisionRequest;
    try {
      decisionRequest = options.buildDecisionRequest(request);
    } catch (error) {
      next(error);
      return;
    }

    let decision: DecisionResult;
    try {
      decision = await options.client.check(decisionRequest, { correlationId });
    } catch (error) {
      options.onDecision?.({ request, correlationId, error, outcome: "error" });
      deny(response, 503, "ACCESS_KIT_UNAVAILABLE", correlationId);
      return;
    }

    if (decision.decision !== "allow") {
      options.onDecision?.({ request, correlationId, decision, outcome: "deny" });
      deny(response, 403, decision.reasonCode, correlationId);
      return;
    }

    options.onDecision?.({ request, correlationId, decision, outcome: "allow" });
    next();
  };
}

function deny(response: ExpressPepResponse, status: number, reasonCode: string, correlationId: string): void {
  response.status(status).json({
    code: "ACCESS_DENIED",
    correlationId,
    reasonCode
  });
}

async function postJson<T>(
  clientFetch: typeof fetch,
  baseUrl: string,
  path: string,
  apiKey: string,
  body: unknown,
  options: AccessKitRequestOptions = {}
): Promise<T> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json"
  };

  if (options.correlationId) {
    headers["x-correlation-id"] = options.correlationId;
  }

  const response = await clientFetch(`${baseUrl}${path}`, {
    body: JSON.stringify(body),
    headers,
    method: "POST"
  });

  if (!response.ok) {
    throw await buildClientError(response);
  }

  return (await response.json()) as T;
}

async function buildClientError(response: Response): Promise<AccessKitClientError> {
  const retryAfter = response.headers.get("retry-after") ?? undefined;

  try {
    const body = (await response.json()) as { code?: unknown; correlationId?: unknown };
    const code = typeof body.code === "string" ? body.code : `HTTP_${response.status}`;
    const correlationId = typeof body.correlationId === "string" ? body.correlationId : undefined;

    return new AccessKitClientError(response.status, code, correlationId, retryAfter);
  } catch {
    return new AccessKitClientError(response.status, `HTTP_${response.status}`, undefined, retryAfter);
  }
}

function resolveCorrelationId(request: ExpressPepRequest, candidate: string | undefined): string {
  if (candidate) {
    return candidate;
  }

  const header = request.headers?.["x-correlation-id"];
  const headerValue = Array.isArray(header) ? header[0] : header;

  return headerValue ?? `corr:pep:${Date.now().toString(36)}`;
}

function normalizeBaseUrl(value: string): string {
  const baseUrl = trimTrailingSlashes(value);

  try {
    new URL(baseUrl);
  } catch {
    throw new AccessKitClientError(400, "CLIENT_INVALID_BASE_URL");
  }

  return baseUrl;
}

function trimTrailingSlashes(value: string): string {
  let end = value.length;

  while (end > 0 && value.charCodeAt(end - 1) === 47) {
    end -= 1;
  }

  return value.slice(0, end);
}
