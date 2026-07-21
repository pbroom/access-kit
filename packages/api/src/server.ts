import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  authenticateRequest,
  bearerChallenge,
  parseApiKeys,
  recordAuthenticationFailure,
  resolveRequestAuditActor,
  type AuthenticationFailureReason,
  type AuthenticationFailureSample,
  type ParsedApiKey
} from "./api-auth.js";
import { withRequestAuditActor } from "./request-audit-context.js";
import { HttpError, notFound, sendJson } from "./api-http.js";
import { buildRuntimeReadiness } from "./api-readiness.js";
import {
  checkDecision,
  checkEnforcementReadiness,
  createPolicy,
  createProvisioningJob,
  createProvisioningPlan,
  createRebacLocalApp,
  createResource,
  createRevocationPlan,
  createSubject,
  deleteRelationship,
  explainDecision,
  exportAuditEvents,
  exportEvidencePackage,
  getProvisioningJob,
  listEnforcementReadinessReports,
  listDiscoveryRuns,
  listPolicies,
  planDriftRemediationDryRun,
  publishPolicy,
  putRelationship,
  readNativeAccess,
  rollbackPolicy,
  runReconciliation,
  syncConnector,
  testConnector,
  validatePolicy,
  verifyAuditIntegrity,
  verifyEvidencePackage,
  RebacLocalAppError,
  type RebacLocalApp,
  type RebacLocalAppOptions
} from "./local-app.js";
import {
  decodeConnectorSyncRequest,
  decodeDecisionBatchRequest,
  decodeDecisionRequest,
  decodeDriftRemediationRequest,
  decodeEnforcementReadinessRequest,
  decodePolicyDraft,
  decodePolicyPublishRequest,
  decodePolicyRollbackRequest,
  decodePolicyValidationMode,
  decodeProvisioningJobRequest,
  decodeProvisioningPlanRequest,
  decodeReconciliationRunRequest,
  decodeRelationship,
  decodeResource,
  decodeSubject,
  driftSeverities
} from "./request-decoders.js";
import {
  type DiscoveryRunStatus,
  type DriftFindingStatus,
  type DriftLifecycleState,
  type DriftSeverity,
  type EnforcementReadinessReport,
  type AuditEventExportTarget,
  type EvidenceFramework,
  type NativeGrantType,
  type NativePrincipalType
} from "@access-kit/core";

export { API_ROUTE_SURFACES, type ApiRouteSurface } from "./api-routes.js";

export interface RebacApiServerOptions extends RebacLocalAppOptions {
  app?: RebacLocalApp;
  apiKeys?: readonly string[];
}

const maxRequestBodyBytes = 1024 * 1024;
const evidenceFormats = new Set(["json", "zip", "markdown"]);
const driftStatuses = new Set(["open", "accepted", "repairing", "resolved"]);
const driftLifecycleStates = new Set(["open", "triaged", "accepted", "remediation_pending", "repairing", "resolved", "expired_exception"]);
const evidenceFrameworks = new Set(["nist-800-53", "fedramp-rev5", "custom"]);
const evidenceControlIdPattern = /^[A-Z]{2}-[0-9]+(?:\([0-9]+\))?$/;
const auditExportTargets = new Set(["operator_download", "siem_forwarder"]);
const discoveryStatuses = new Set(["queued", "running", "completed", "completed_with_warnings", "failed"]);
const enforcementReadinessStatuses = new Set(["ready", "blocked"]);
const nativeGrantTypes = new Set(["direct", "inherited", "group"]);
const nativePrincipalTypes = new Set(["user", "group", "service_account", "service_principal", "managed_identity", "external_user", "unknown"]);
export function createRebacApiServer(options: RebacApiServerOptions = {}): Server {
  const app = options.app ?? createRebacLocalApp(options);
  const apiKeys = parseApiKeys(options.apiKeys);
  const authenticationFailureSamples = new Map<AuthenticationFailureReason, AuthenticationFailureSample>();
  const authenticationFailureAuditScope = randomUUID();

  return createServer(async (request, response) => {
    try {
      await routeRequest(app, request, response, apiKeys, authenticationFailureSamples, authenticationFailureAuditScope);
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(response, error.statusCode, {
          code: error.code,
          message: error.message,
          correlationId: "corr:bad-request"
        });
        return;
      }

      if (error instanceof RebacLocalAppError) {
        sendJson(response, error.statusCode, {
          code: error.code,
          message: error.message,
          correlationId: "corr:bad-request"
        });
        return;
      }

      const correlationId = `corr:internal-error:${randomUUID()}`;
      const detail = error instanceof Error ? error.message : "Unknown error";
      console.error(`[rebac-api] ${correlationId}: ${detail}`);

      sendJson(response, 500, {
        code: "INTERNAL_ERROR",
        message: "An internal error occurred.",
        correlationId
      });
    }
  });
}

async function routeRequest(
  app: RebacLocalApp,
  request: IncomingMessage,
  response: ServerResponse,
  apiKeys: readonly ParsedApiKey[],
  authenticationFailureSamples: Map<AuthenticationFailureReason, AuthenticationFailureSample>,
  authenticationFailureAuditScope: string
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  const method = request.method ?? "GET";
  const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

  if (method === "GET" && url.pathname === "/v1/health") {
    sendJson(response, 200, { status: "ok", version: "0.1.0" });
    return;
  }

  if (method === "GET" && url.pathname === "/v1/ready") {
    const readiness = buildRuntimeReadiness(app, apiKeys);
    sendJson(response, readiness.status === "not_ready" ? 503 : 200, readiness);
    return;
  }

  if (segments[0] !== "v1") {
    notFound(response);
    return;
  }

  const authentication = authenticateRequest(request, apiKeys);
  if (authentication.status !== "authenticated") {
    recordAuthenticationFailure(app, request, url, authentication.status, authenticationFailureSamples, authenticationFailureAuditScope);
    response.setHeader("WWW-Authenticate", bearerChallenge(authentication.status));
    sendJson(response, 401, {
      code: "UNAUTHENTICATED",
      message: "A valid bearer token is required.",
      correlationId: "corr:unauthenticated"
    });
    return;
  }

  const requestActor = resolveRequestAuditActor(app.actor, authentication.apiKeyLabel);
  await withRequestAuditActor(requestActor, async () => {
    if (segments[1] === "decision") {
      await routeDecision(app, request, response, segments);
      return;
    }

    if (segments[1] === "subjects") {
      await routeSubjects(app, request, response, segments);
      return;
    }

    if (segments[1] === "resources") {
      await routeResources(app, request, response, url, segments);
      return;
    }

    if (segments[1] === "relationships") {
      await routeRelationships(app, request, response, url, segments);
      return;
    }

    if (segments[1] === "policies") {
      await routePolicies(app, request, response, segments);
      return;
    }

    if (segments[1] === "provisioning") {
      await routeProvisioning(app, request, response, segments);
      return;
    }

    if (segments[1] === "reconciliation") {
      await routeReconciliation(app, request, response, url, segments);
      return;
    }

    if (segments[1] === "discovery") {
      await routeDiscovery(app, request, response, url, segments);
      return;
    }

    if (segments[1] === "audit") {
      if (segments[2] === "export" && method === "GET") {
        const periodStart = readOptionalDateTime(url.searchParams.get("from"), "from");
        const periodEnd = readOptionalDateTime(url.searchParams.get("to"), "to");

        if (periodStart && periodEnd && periodStart > periodEnd) {
          throw new HttpError(400, "INVALID_AUDIT_EXPORT_PERIOD", "from must be before to");
        }

        sendJson(response, 200, exportAuditEvents(app, {
          periodStart,
          periodEnd,
          target: readAuditExportTarget(url.searchParams.get("target"))
        }));
        return;
      }

      if (segments[2] === "events" && method === "GET") {
        sendJson(response, 200, {
          items: app.store.listAuditEvents({
            subjectId: url.searchParams.get("subjectId") ?? undefined,
            resourceId: url.searchParams.get("resourceId") ?? undefined,
            from: readAuditFilterDateTime(url.searchParams.get("from"), "from")
          })
        });
        return;
      }

      if (segments[2] === "integrity" && method === "GET") {
        sendJson(response, 200, verifyAuditIntegrity(app));
        return;
      }
    }

    if (segments[1] === "evidence" && segments[2] === "export" && method === "GET") {
      const controls = readEvidenceControls(url.searchParams.get("controls"));
      const framework = readEvidenceFramework(url.searchParams.get("framework"));
      const periodStart = readOptionalDateTime(url.searchParams.get("from"), "from");
      const periodEnd = readOptionalDateTime(url.searchParams.get("to"), "to");
      const format = url.searchParams.get("format") ?? "json";
      if (!isEvidenceFormat(format)) {
        throw new HttpError(400, "INVALID_EVIDENCE_FORMAT", "format must be one of json, zip, or markdown");
      }

      if (periodStart && periodEnd && periodStart > periodEnd) {
        throw new HttpError(400, "INVALID_EVIDENCE_PERIOD", "from must be before to");
      }

      sendJson(response, 200, exportEvidencePackage(app, controls, format, { framework, periodStart, periodEnd }));
      return;
    }

    if (segments[1] === "evidence" && segments[2] === "verify" && method === "POST") {
      const idempotencyKey = readIdempotencyKey(request);
      sendJson(response, 200, verifyEvidencePackage(app, await readJson(request), { idempotencyKey }));
      return;
    }

    if (segments[1] === "connectors") {
      await routeConnectors(app, request, response, segments);
      return;
    }

    notFound(response);
  });
}

async function routePolicies(
  app: RebacLocalApp,
  request: IncomingMessage,
  response: ServerResponse,
  segments: string[]
): Promise<void> {
  if (segments.length === 2 && request.method === "GET") {
    sendJson(response, 200, listPolicies(app));
    return;
  }

  if (segments.length === 2 && request.method === "POST") {
    sendJson(response, 201, createPolicy(app, decodePolicyDraft(await readJson(request)), readIdempotencyKey(request)));
    return;
  }

  const policyId = segments[2];
  const action = segments[3];

  if (!policyId || segments.length !== 4 || request.method !== "POST") {
    notFound(response);
    return;
  }

  const body = await readJson(request);

  if (action === "validate") {
    const mode = decodePolicyValidationMode(body);
    if (!mode) {
      throw new HttpError(400, "INVALID_POLICY_VALIDATION_REQUEST", "policy validation requires mode validate or test");
    }

    sendJson(response, 200, validatePolicy(app, policyId, mode));
    return;
  }

  if (action === "publish") {
    sendJson(response, 200, publishPolicy(app, policyId, decodePolicyPublishRequest(body), readIdempotencyKey(request)));
    return;
  }

  if (action === "rollback") {
    sendJson(response, 200, rollbackPolicy(app, policyId, decodePolicyRollbackRequest(body), readIdempotencyKey(request)));
    return;
  }

  notFound(response);
}

async function routeDecision(
  app: RebacLocalApp,
  request: IncomingMessage,
  response: ServerResponse,
  segments: string[]
): Promise<void> {
  if (request.method !== "POST") {
    notFound(response);
    return;
  }

  if (segments[2] === "check") {
    sendJson(response, 200, checkDecision(app, decodeDecisionRequest(await readJson(request))));
    return;
  }

  if (segments[2] === "explain") {
    sendJson(response, 200, explainDecision(app, decodeDecisionRequest(await readJson(request))));
    return;
  }

  if (segments[2] === "batch-check") {
    const requests = decodeDecisionBatchRequest(await readJson(request));

    sendJson(response, 200, { results: requests.map((item) => checkDecision(app, item)) });
    return;
  }

  notFound(response);
}

async function routeSubjects(
  app: RebacLocalApp,
  request: IncomingMessage,
  response: ServerResponse,
  segments: string[]
): Promise<void> {
  if (segments.length === 2 && request.method === "GET") {
    sendJson(response, 200, { items: app.store.listSubjects() });
    return;
  }

  if (segments.length === 2 && request.method === "POST") {
    sendJson(response, 201, createSubject(app, decodeSubject(await readJson(request))));
    return;
  }

  const subjectId = segments[2];
  if (!subjectId) {
    notFound(response);
    return;
  }

  if (segments.length === 3 && request.method === "GET") {
    const subject = app.store.getSubject(subjectId);
    if (subject) {
      sendJson(response, 200, subject);
    } else {
      notFound(response);
    }
    return;
  }

  if (segments[3] === "access" && request.method === "GET") {
    sendJson(response, 200, {
      items: app.store.listDecisions().filter((decision) => decision.subjectId === subjectId)
    });
    return;
  }

  notFound(response);
}

async function routeResources(
  app: RebacLocalApp,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  segments: string[]
): Promise<void> {
  if (segments.length === 2 && request.method === "GET") {
    sendJson(response, 200, { items: app.store.listResources() });
    return;
  }

  if (segments.length === 2 && request.method === "POST") {
    sendJson(response, 201, createResource(app, decodeResource(await readJson(request))));
    return;
  }

  const resourceId = segments[2];
  if (!resourceId) {
    notFound(response);
    return;
  }

  if (segments.length === 3 && request.method === "GET") {
    const resource = app.store.getResource(resourceId);
    if (resource) {
      sendJson(response, 200, resource);
    } else {
      notFound(response);
    }
    return;
  }

  if (segments[3] === "access" && request.method === "GET") {
    sendJson(response, 200, {
      items: app.store.listDecisions().filter((decision) => decision.resourceId === resourceId)
    });
    return;
  }

  if (segments[3] === "native-access" && request.method === "GET") {
    sendJson(response, 200, {
      items: readNativeAccess(app, resourceId, {
        sourceConnectorId: url.searchParams.get("connectorId") ?? undefined,
        subjectId: url.searchParams.get("subjectId") ?? undefined,
        nativePermission: url.searchParams.get("nativePermission") ?? undefined,
        grantType: readNativeGrantType(url.searchParams.get("grantType")),
        principalType: readNativePrincipalType(url.searchParams.get("principalType"))
      })
    });
    return;
  }

  notFound(response);
}

async function routeRelationships(
  app: RebacLocalApp,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  segments: string[]
): Promise<void> {
  if (segments.length !== 2) {
    notFound(response);
    return;
  }

  if (request.method === "GET") {
    sendJson(response, 200, {
      items: app.store.listRelationships({
        subjectId: url.searchParams.get("subjectId") ?? undefined,
        objectId: url.searchParams.get("objectId") ?? undefined,
        relation: url.searchParams.get("relation") ?? undefined
      })
    });
    return;
  }

  if (request.method === "PUT") {
    sendJson(response, 200, putRelationship(app, decodeRelationship(await readJson(request))));
    return;
  }

  if (request.method === "DELETE") {
    const relationshipId = url.searchParams.get("relationshipId");
    if (!relationshipId) {
      sendJson(response, 400, {
        code: "MISSING_RELATIONSHIP_ID",
        message: "relationshipId query parameter is required",
        correlationId: "corr:bad-request"
      });
      return;
    }

    const deleted = deleteRelationship(app, relationshipId);
    if (deleted) {
      sendJson(response, 200, deleted);
    } else {
      notFound(response);
    }
    return;
  }

  notFound(response);
}

async function routeReconciliation(
  app: RebacLocalApp,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  segments: string[]
): Promise<void> {
  if (segments[2] === "run" && request.method === "POST") {
    const body = decodeReconciliationRunRequest(await readJson(request));

    sendJson(response, 202, await runReconciliation(app, body.connectorId, {
      trigger: body.trigger,
      schedule: body.schedule
    }));
    return;
  }

  if (segments[2] === "findings" && segments.length === 3 && request.method === "GET") {
    sendJson(response, 200, {
      items: app.store.listDriftFindings({
        severity: readDriftSeverity(url.searchParams.get("severity")),
        status: readDriftStatus(url.searchParams.get("status")),
        lifecycleState: readDriftLifecycleState(url.searchParams.get("lifecycleState")),
        ownerId: url.searchParams.get("ownerId") ?? undefined,
        assigneeId: url.searchParams.get("assigneeId") ?? undefined
      })
    });
    return;
  }

  if (segments[2] === "findings" && segments[3] && segments[4] === "remediation" && request.method === "POST") {
    const body = decodeDriftRemediationRequest(await readJson(request));
    const updated = await planDriftRemediationDryRun(app, segments[3], body, readIdempotencyKey(request));

    if (updated) {
      sendJson(response, 202, updated);
    } else {
      notFound(response);
    }
    return;
  }

  notFound(response);
}

async function routeProvisioning(
  app: RebacLocalApp,
  request: IncomingMessage,
  response: ServerResponse,
  segments: string[]
): Promise<void> {
  if (segments[2] === "plans" && segments.length === 3 && request.method === "POST") {
    const idempotencyKey = readIdempotencyKey(request);
    const body = decodeProvisioningPlanRequest(await readJson(request));

    if (body.kind === "revocation") {
      sendJson(
        response,
        201,
        await createRevocationPlan(app, body.grantId, body.connectorId, body.execution, idempotencyKey)
      );
      return;
    }

    sendJson(
      response,
      201,
      await createProvisioningPlan(app, body.decisionRequest, body.connectorId, body.execution, idempotencyKey)
    );
    return;
  }

  if (segments[2] === "jobs" && segments.length === 3 && request.method === "POST") {
    const body = decodeProvisioningJobRequest(await readJson(request));

    const job = await createProvisioningJob(app, {
      planId: body.planId,
      approverId: body.approverId,
      idempotencyKey: readIdempotencyKey(request),
      mode: body.mode,
      approval: body.approval,
      control: body.control
    });

    if (!job) {
      notFound(response);
      return;
    }

    sendJson(response, 202, job);
    return;
  }

  if (segments[2] === "jobs" && segments.length === 4 && request.method === "GET") {
    const job = getProvisioningJob(app, segments[3] ?? "");

    if (!job) {
      notFound(response);
      return;
    }

    sendJson(response, 200, job);
    return;
  }

  notFound(response);
}

async function routeDiscovery(
  app: RebacLocalApp,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  segments: string[]
): Promise<void> {
  if (segments[2] === "runs" && request.method === "GET") {
    sendJson(response, 200, {
      items: listDiscoveryRuns(app, {
        connectorId: url.searchParams.get("connectorId") ?? undefined,
        status: readDiscoveryStatus(url.searchParams.get("status"))
      })
    });
    return;
  }

  notFound(response);
}

async function routeConnectors(
  app: RebacLocalApp,
  request: IncomingMessage,
  response: ServerResponse,
  segments: string[]
): Promise<void> {
  if (segments.length === 2 && request.method === "GET") {
    sendJson(response, 200, {
      items: [...app.connectors.values()].map((connector) => ({
        id: connector.id,
        mode: connector.mode,
        provider: connector.provider ?? connector.id,
        tenantBoundary: connector.tenantBoundary ?? "synthetic:unknown",
        requiredReadScopes: connector.requiredReadScopes ?? [],
        capabilities: connector.capabilities
      }))
    });
    return;
  }

  const connectorId = segments[2];
  if (!connectorId) {
    notFound(response);
    return;
  }

  if (segments[3] === "test" && request.method === "POST") {
    sendJson(response, 200, await testConnector(app, connectorId));
    return;
  }

  if (segments[3] === "enforcement-readiness" && request.method === "GET") {
    sendJson(response, 200, {
      items: listEnforcementReadinessReports(app, connectorId, readEnforcementReadinessStatus(new URL(request.url ?? "/", "http://localhost").searchParams.get("status")))
    });
    return;
  }

  if (segments[3] === "enforcement-readiness" && request.method === "POST") {
    sendJson(response, 200, await checkEnforcementReadiness(app, connectorId, decodeEnforcementReadinessRequest(await readJson(request))));
    return;
  }

  if (segments[3] === "sync" && request.method === "POST") {
    sendJson(response, 202, await syncConnector(app, connectorId, decodeConnectorSyncRequest(await readJson(request))));
    return;
  }

  notFound(response);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytesRead = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytesRead += buffer.byteLength;

    if (bytesRead > maxRequestBodyBytes) {
      throw new HttpError(413, "REQUEST_BODY_TOO_LARGE", `Request body exceeds ${maxRequestBodyBytes} bytes`);
    }

    chunks.push(buffer);
  }

  const body = Buffer.concat(chunks).toString("utf8");

  try {
    return body ? JSON.parse(body) : {};
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Request body must be valid JSON");
  }
}

function readIdempotencyKey(request: IncomingMessage): string {
  const value = request.headers["idempotency-key"];

  if (typeof value === "string" && value.length >= 8) {
    return value;
  }

  throw new HttpError(400, "MISSING_IDEMPOTENCY_KEY", "Idempotency-Key header is required");
}

function readDiscoveryStatus(status: string | null): DiscoveryRunStatus | undefined {
  if (!status) {
    return undefined;
  }

  if (discoveryStatuses.has(status)) {
    return status as DiscoveryRunStatus;
  }

  throw new HttpError(400, "INVALID_DISCOVERY_STATUS", "status must be a valid discovery run status");
}

function readEnforcementReadinessStatus(status: string | null): EnforcementReadinessReport["status"] | undefined {
  if (!status) {
    return undefined;
  }

  if (enforcementReadinessStatuses.has(status)) {
    return status as EnforcementReadinessReport["status"];
  }

  throw new HttpError(400, "INVALID_ENFORCEMENT_READINESS_STATUS", "status must be ready or blocked");
}

function readNativeGrantType(grantType: string | null): NativeGrantType | undefined {
  if (!grantType) {
    return undefined;
  }

  if (nativeGrantTypes.has(grantType)) {
    return grantType as NativeGrantType;
  }

  throw new HttpError(400, "INVALID_NATIVE_GRANT_TYPE", "grantType must be direct, inherited, or group");
}

function readNativePrincipalType(principalType: string | null): NativePrincipalType | undefined {
  if (!principalType) {
    return undefined;
  }

  if (nativePrincipalTypes.has(principalType)) {
    return principalType as NativePrincipalType;
  }

  throw new HttpError(400, "INVALID_NATIVE_PRINCIPAL_TYPE", "principalType is not supported");
}

function readEvidenceControls(value: string | null): string[] {
  const controls = (value ?? "AC-2,AC-3,AU-2")
    .split(",")
    .map((control) => control.trim())
    .filter(Boolean);

  if (controls.length === 0) {
    throw new HttpError(400, "INVALID_EVIDENCE_CONTROLS", "controls must include at least one control id");
  }

  if (controls.some((control) => !evidenceControlIdPattern.test(control))) {
    throw new HttpError(400, "INVALID_EVIDENCE_CONTROLS", "controls must be comma-separated control ids such as AC-3 or AU-6(1)");
  }

  return controls;
}

function readEvidenceFramework(value: string | null): EvidenceFramework {
  if (!value) {
    return "nist-800-53";
  }

  if (evidenceFrameworks.has(value)) {
    return value as EvidenceFramework;
  }

  throw new HttpError(400, "INVALID_EVIDENCE_FRAMEWORK", "framework must be nist-800-53, fedramp-rev5, or custom");
}

function readAuditExportTarget(value: string | null): AuditEventExportTarget | undefined {
  if (!value) {
    return undefined;
  }

  if (auditExportTargets.has(value)) {
    return value as AuditEventExportTarget;
  }

  throw new HttpError(400, "INVALID_AUDIT_EXPORT_TARGET", "target must be operator_download or siem_forwarder");
}

function readOptionalDateTime(value: string | null, label: string): string | undefined {
  if (!value) {
    return undefined;
  }

  if (Number.isNaN(Date.parse(value))) {
    throw new HttpError(400, "INVALID_EVIDENCE_PERIOD", `${label} must be a valid date-time`);
  }

  return new Date(value).toISOString();
}

function isEvidenceFormat(value: unknown): value is "json" | "zip" | "markdown" {
  return typeof value === "string" && evidenceFormats.has(value);
}

function readDriftSeverity(value: string | null): DriftSeverity | undefined {
  if (!value) {
    return undefined;
  }

  if (!driftSeverities.has(value)) {
    throw new HttpError(400, "INVALID_DRIFT_SEVERITY", "severity must be one of low, medium, high, or critical");
  }

  return value as DriftSeverity;
}

function readDriftStatus(value: string | null): DriftFindingStatus | undefined {
  if (!value) {
    return undefined;
  }

  if (!driftStatuses.has(value)) {
    throw new HttpError(400, "INVALID_DRIFT_STATUS", "status must be one of open, accepted, repairing, or resolved");
  }

  return value as DriftFindingStatus;
}

function readDriftLifecycleState(value: string | null): DriftLifecycleState | undefined {
  if (!value) {
    return undefined;
  }

  if (!driftLifecycleStates.has(value)) {
    throw new HttpError(400, "INVALID_DRIFT_LIFECYCLE_STATE", "lifecycleState must be a valid drift lifecycle state");
  }

  return value as DriftLifecycleState;
}

function readAuditFilterDateTime(value: string | null, name: string): string | undefined {
  if (!value) {
    return undefined;
  }

  if (Number.isNaN(Date.parse(value))) {
    throw new HttpError(400, "INVALID_AUDIT_FILTER", `${name} must be a valid date-time`);
  }

  return new Date(value).toISOString();
}
