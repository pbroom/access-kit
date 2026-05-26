import { type ApiContractOperationSnapshot } from "./contract-snapshot.js";

export const generatedClientContractVersion = "0.1.0";
export const generatedClientOperations = [
  { operationId: "getHealth", method: "GET", path: "/v1/health", auth: "public", idempotencyKey: false, deprecated: false },
  { operationId: "getReadiness", method: "GET", path: "/v1/ready", auth: "public", idempotencyKey: false, deprecated: false },
  { operationId: "checkDecision", method: "POST", path: "/v1/decision/check", auth: "bearer", idempotencyKey: false, deprecated: false },
  { operationId: "explainDecision", method: "POST", path: "/v1/decision/explain", auth: "bearer", idempotencyKey: false, deprecated: false },
  { operationId: "batchCheckDecision", method: "POST", path: "/v1/decision/batch-check", auth: "bearer", idempotencyKey: false, deprecated: false },
  { operationId: "listSubjects", method: "GET", path: "/v1/subjects", auth: "bearer", idempotencyKey: false, deprecated: false },
  { operationId: "createSubject", method: "POST", path: "/v1/subjects", auth: "bearer", idempotencyKey: true, deprecated: false },
  { operationId: "getSubject", method: "GET", path: "/v1/subjects/{id}", auth: "bearer", idempotencyKey: false, deprecated: false },
  { operationId: "getSubjectAccess", method: "GET", path: "/v1/subjects/{id}/access", auth: "bearer", idempotencyKey: false, deprecated: false },
  { operationId: "listResources", method: "GET", path: "/v1/resources", auth: "bearer", idempotencyKey: false, deprecated: false },
  { operationId: "createResource", method: "POST", path: "/v1/resources", auth: "bearer", idempotencyKey: true, deprecated: false },
  { operationId: "getResource", method: "GET", path: "/v1/resources/{id}", auth: "bearer", idempotencyKey: false, deprecated: false },
  { operationId: "getResourceAccess", method: "GET", path: "/v1/resources/{id}/access", auth: "bearer", idempotencyKey: false, deprecated: false },
  { operationId: "getResourceNativeAccess", method: "GET", path: "/v1/resources/{id}/native-access", auth: "bearer", idempotencyKey: false, deprecated: false },
  { operationId: "queryRelationships", method: "GET", path: "/v1/relationships", auth: "bearer", idempotencyKey: false, deprecated: false },
  { operationId: "putRelationship", method: "PUT", path: "/v1/relationships", auth: "bearer", idempotencyKey: true, deprecated: false },
  { operationId: "deleteRelationship", method: "DELETE", path: "/v1/relationships", auth: "bearer", idempotencyKey: true, deprecated: false },
  { operationId: "listPolicies", method: "GET", path: "/v1/policies", auth: "bearer", idempotencyKey: false, deprecated: false },
  { operationId: "createPolicy", method: "POST", path: "/v1/policies", auth: "bearer", idempotencyKey: true, deprecated: false },
  { operationId: "validatePolicy", method: "POST", path: "/v1/policies/{id}/validate", auth: "bearer", idempotencyKey: false, deprecated: false },
  { operationId: "publishPolicy", method: "POST", path: "/v1/policies/{id}/publish", auth: "bearer", idempotencyKey: true, deprecated: false },
  { operationId: "rollbackPolicy", method: "POST", path: "/v1/policies/{id}/rollback", auth: "bearer", idempotencyKey: true, deprecated: false },
  { operationId: "createProvisioningPlan", method: "POST", path: "/v1/provisioning/plans", auth: "bearer", idempotencyKey: true, deprecated: false },
  { operationId: "createProvisioningJob", method: "POST", path: "/v1/provisioning/jobs", auth: "bearer", idempotencyKey: true, deprecated: false },
  { operationId: "getProvisioningJob", method: "GET", path: "/v1/provisioning/jobs/{id}", auth: "bearer", idempotencyKey: false, deprecated: false },
  { operationId: "runReconciliation", method: "POST", path: "/v1/reconciliation/run", auth: "bearer", idempotencyKey: true, deprecated: false },
  { operationId: "listDriftFindings", method: "GET", path: "/v1/reconciliation/findings", auth: "bearer", idempotencyKey: false, deprecated: false },
  { operationId: "searchAuditEvents", method: "GET", path: "/v1/audit/events", auth: "bearer", idempotencyKey: false, deprecated: false },
  { operationId: "verifyAuditIntegrity", method: "GET", path: "/v1/audit/integrity", auth: "bearer", idempotencyKey: false, deprecated: false },
  { operationId: "exportAuditEvents", method: "GET", path: "/v1/audit/export", auth: "bearer", idempotencyKey: false, deprecated: false },
  { operationId: "exportEvidence", method: "GET", path: "/v1/evidence/export", auth: "bearer", idempotencyKey: false, deprecated: false },
  { operationId: "listConnectors", method: "GET", path: "/v1/connectors", auth: "bearer", idempotencyKey: false, deprecated: false },
  { operationId: "testConnector", method: "POST", path: "/v1/connectors/{id}/test", auth: "bearer", idempotencyKey: false, deprecated: false },
  { operationId: "listConnectorEnforcementReadiness", method: "GET", path: "/v1/connectors/{id}/enforcement-readiness", auth: "bearer", idempotencyKey: false, deprecated: false },
  { operationId: "checkConnectorEnforcementReadiness", method: "POST", path: "/v1/connectors/{id}/enforcement-readiness", auth: "bearer", idempotencyKey: false, deprecated: false },
  { operationId: "syncConnector", method: "POST", path: "/v1/connectors/{id}/sync", auth: "bearer", idempotencyKey: true, deprecated: false },
  { operationId: "listDiscoveryRuns", method: "GET", path: "/v1/discovery/runs", auth: "bearer", idempotencyKey: false, deprecated: false }
] as const satisfies readonly ApiContractOperationSnapshot[];

export type GeneratedClientOperationId = (typeof generatedClientOperations)[number]["operationId"];

export interface RebacClientOptions {
  readonly apiKey?: string;
  readonly baseUrl: string;
  readonly fetch?: typeof fetch;
}

export interface RebacRequestOptions {
  readonly body?: unknown;
  readonly idempotencyKey?: string;
  readonly pathParams?: Record<string, string>;
  readonly query?: Record<string, boolean | number | string | undefined>;
}

export class RebacClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly correlationId?: string,
    readonly retryAfter?: string
  ) {
    super(`${code} (${status})`);
  }
}

export function createRebacClient(options: RebacClientOptions): {
  readonly request: <T>(operationId: GeneratedClientOperationId, requestOptions?: RebacRequestOptions) => Promise<T>;
} {
  const clientFetch = options.fetch ?? fetch;
  const baseUrl = normalizeBaseUrl(options.baseUrl);

  return {
    async request<T>(
      operationId: GeneratedClientOperationId,
      requestOptions: RebacRequestOptions = {}
    ): Promise<T> {
      const operation = getGeneratedOperation(operationId);

      if (operation.auth === "bearer" && !options.apiKey) {
        throw new RebacClientError(401, "CLIENT_MISSING_API_KEY");
      }

      if (operation.idempotencyKey && !requestOptions.idempotencyKey) {
        throw new RebacClientError(400, "CLIENT_MISSING_IDEMPOTENCY_KEY");
      }

      if (requestOptions.body !== undefined && methodForbidsBody(operation.method)) {
        throw new RebacClientError(400, "CLIENT_INVALID_BODY");
      }

      const response = await clientFetch(buildUrl(baseUrl, operation, requestOptions), {
        body: requestOptions.body === undefined ? undefined : JSON.stringify(requestOptions.body),
        headers: buildHeaders(operation, options.apiKey, requestOptions),
        method: operation.method
      });

      if (!response.ok) {
        throw await buildClientError(response);
      }

      return (await response.json()) as T;
    }
  };
}

function getGeneratedOperation(operationId: GeneratedClientOperationId): ApiContractOperationSnapshot {
  const operation = generatedClientOperations.find((entry) => entry.operationId === operationId);

  if (!operation) {
    throw new RebacClientError(400, "CLIENT_UNKNOWN_OPERATION");
  }

  return operation;
}

function methodForbidsBody(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

function trimTrailingSlashes(value: string): string {
  let end = value.length;

  while (end > 0 && value.charCodeAt(end - 1) === 47) {
    end -= 1;
  }

  return value.slice(0, end);
}

function normalizeBaseUrl(value: string): string {
  const baseUrl = trimTrailingSlashes(value);

  try {
    new URL(baseUrl);
  } catch {
    throw new RebacClientError(400, "CLIENT_INVALID_BASE_URL");
  }

  return baseUrl;
}

function buildUrl(baseUrl: string, operation: ApiContractOperationSnapshot, options: RebacRequestOptions): string {
  const path = operation.path.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const value = options.pathParams?.[key];

    if (value === undefined) {
      throw new RebacClientError(400, `CLIENT_MISSING_PATH_PARAM:${key}`);
    }

    return encodeURIComponent(value);
  });
  const url = new URL(`${baseUrl}${path}`);

  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

function buildHeaders(
  operation: ApiContractOperationSnapshot,
  apiKey: string | undefined,
  options: RebacRequestOptions
): Record<string, string> {
  const headers: Record<string, string> = {};

  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }

  if (operation.auth === "bearer" && apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }

  if (operation.idempotencyKey && options.idempotencyKey) {
    headers["idempotency-key"] = options.idempotencyKey;
  }

  return headers;
}

async function buildClientError(response: Response): Promise<RebacClientError> {
  const retryAfter = response.headers.get("retry-after") ?? undefined;

  try {
    const body = (await response.json()) as { code?: unknown; correlationId?: unknown };
    const code = typeof body.code === "string" ? body.code : `HTTP_${response.status}`;
    const correlationId = typeof body.correlationId === "string" ? body.correlationId : undefined;

    return new RebacClientError(response.status, code, correlationId, retryAfter);
  } catch {
    return new RebacClientError(response.status, `HTTP_${response.status}`, undefined, retryAfter);
  }
}
