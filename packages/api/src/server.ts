import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  authenticateRequest,
  bearerChallenge,
  normalizeApiKeys,
  recordAuthenticationFailure,
  type AuthenticationFailureReason,
  type AuthenticationFailureSample
} from "./api-auth.js";
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
  isSafeChangeTicketPattern,
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
  RebacLocalAppError,
  type PolicyDraft,
  type RebacLocalApp,
  type RebacLocalAppOptions
} from "./local-app.js";
import { validateRuntimeRequestSchema, type RuntimeRequestSchemaName } from "./request-schemas.js";
import {
  verifyEvidenceExport,
  type DecisionRequest,
  type DiscoveryRunStatus,
  type DriftAutoRepairPolicy,
  type DriftFindingStatus,
  type DriftHookEvidence,
  type DriftLifecycleState,
  type DriftSeverity,
  type EnforcementControl,
  type EnforcementReadinessReport,
  type AuditEventExportTarget,
  type EvidenceFramework,
  type NativeGrantType,
  type NativePrincipalType,
  type ProvisioningApproval,
  type ProvisioningMode,
  type ReconciliationScheduleEvidence,
  type ReconciliationTrigger,
  type RelationshipTuple,
  type Resource,
  type Subject
} from "@access-kit/core";

export { API_ROUTE_SURFACES, type ApiRouteSurface } from "./api-routes.js";

export interface RebacApiServerOptions extends RebacLocalAppOptions {
  app?: RebacLocalApp;
  apiKeys?: readonly string[];
}

interface ProvisioningPlanRequest {
  subjectId?: unknown;
  action?: unknown;
  resourceId?: unknown;
  context?: unknown;
  mode?: unknown;
  dryRun?: unknown;
  grantId?: unknown;
  connectorId?: unknown;
  approval?: unknown;
  control?: unknown;
  readinessReportId?: unknown;
}

interface ProvisioningJobRequest {
  planId?: unknown;
  approverId?: unknown;
  mode?: unknown;
  dryRun?: unknown;
  approval?: unknown;
  control?: unknown;
}

interface DriftRemediationRequest {
  approval?: unknown;
  autoRepairPolicy?: unknown;
  readinessReportId?: unknown;
  hookEvidence?: unknown;
}

interface EnforcementReadinessRequest {
  mode?: unknown;
  control?: unknown;
  requiredApproverRole?: unknown;
  changeTicketPattern?: unknown;
}

const maxRequestBodyBytes = 1024 * 1024;
const evidenceFormats = new Set(["json", "zip", "markdown"]);
const driftSeverities = new Set(["low", "medium", "high", "critical"]);
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
  const apiKeys = normalizeApiKeys(options.apiKeys);
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

      sendJson(response, 500, {
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : "Unknown error",
        correlationId: "corr:internal-error"
      });
    }
  });
}

async function routeRequest(
  app: RebacLocalApp,
  request: IncomingMessage,
  response: ServerResponse,
  apiKeys: readonly string[],
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
  if (authentication !== "authenticated") {
    recordAuthenticationFailure(app, request, url, authentication, authenticationFailureSamples, authenticationFailureAuditScope);
    response.setHeader("WWW-Authenticate", bearerChallenge(authentication));
    sendJson(response, 401, {
      code: "UNAUTHENTICATED",
      message: "A valid bearer token is required.",
      correlationId: "corr:unauthenticated"
    });
    return;
  }

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
    sendJson(response, 200, verifyEvidenceExport(await readJson<unknown>(request)));
    return;
  }

  if (segments[1] === "connectors") {
    await routeConnectors(app, request, response, segments);
    return;
  }

  notFound(response);
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
    sendJson(response, 201, createPolicy(app, readPolicyDraft(await readJson<unknown>(request)), readIdempotencyKey(request)));
    return;
  }

  const policyId = segments[2];
  const action = segments[3];

  if (!policyId || segments.length !== 4 || request.method !== "POST") {
    notFound(response);
    return;
  }

  const body = await readJson<unknown>(request);

  if (action === "validate") {
    const mode = readPolicyValidationMode(body);
    if (!mode) {
      throw new HttpError(400, "INVALID_POLICY_VALIDATION_REQUEST", "policy validation requires mode validate or test");
    }

    sendJson(response, 200, validatePolicy(app, policyId, mode));
    return;
  }

  if (action === "publish") {
    sendJson(response, 200, publishPolicy(app, policyId, readPolicyPublishRequest(body), readIdempotencyKey(request)));
    return;
  }

  if (action === "rollback") {
    sendJson(response, 200, rollbackPolicy(app, policyId, readPolicyRollbackRequest(body), readIdempotencyKey(request)));
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
    sendJson(response, 200, checkDecision(app, await readDecisionRequest(request)));
    return;
  }

  if (segments[2] === "explain") {
    sendJson(response, 200, explainDecision(app, await readDecisionRequest(request)));
    return;
  }

  if (segments[2] === "batch-check") {
    const batch = await readJson<unknown>(request);
    const parsed = readSchemaBacked<{ requests: DecisionRequest[] }>(
      "decisionBatch",
      batch,
      "INVALID_BATCH_REQUESTS",
      "batch-check requires a requests array of decision requests"
    );
    const requests = parsed.requests.map((item) => normalizeDecisionRequest(item));

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
    sendJson(response, 201, createSubject(app, readSubject(await readJson<unknown>(request))));
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
    sendJson(response, 201, createResource(app, readResource(await readJson<unknown>(request))));
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
    sendJson(response, 200, putRelationship(app, readRelationship(await readJson<unknown>(request))));
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
    const body = readReconciliationRunRequest(await readJson<unknown>(request));

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
    const body = readDriftRemediationRequest(await readJson<unknown>(request));
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
    const body = readProvisioningPlanRequest(await readJson<unknown>(request));
    const mode = readProvisioningMode(body.mode, body.dryRun);
    const approval = readProvisioningApproval(body.approval);
    const control = readEnforcementControl(body.control);
    const readinessReportId = readReadinessReportId(body.readinessReportId);

    if (body.connectorId !== undefined && (typeof body.connectorId !== "string" || !body.connectorId)) {
      throw new HttpError(400, "INVALID_CONNECTOR_ID", "connectorId must be a non-empty string when provided");
    }

    const connectorId = typeof body.connectorId === "string" ? body.connectorId : undefined;
    if (body.grantId !== undefined) {
      if (typeof body.grantId !== "string" || !body.grantId) {
        throw new HttpError(400, "INVALID_GRANT_ID", "grantId must be a non-empty string");
      }

      sendJson(
        response,
        201,
        await createRevocationPlan(app, body.grantId, connectorId, { mode, approval, control, readinessReportId }, idempotencyKey)
      );
      return;
    }

    const decisionRequest = parseDecisionRequest(body);
    if (!decisionRequest) {
      throw new HttpError(
        400,
        "INVALID_PROVISIONING_REQUEST",
        "Provisioning plans require subjectId, action, and resourceId or a grantId"
      );
    }

    sendJson(
      response,
      201,
      await createProvisioningPlan(app, decisionRequest, connectorId, { mode, approval, control, readinessReportId }, idempotencyKey)
    );
    return;
  }

  if (segments[2] === "jobs" && segments.length === 3 && request.method === "POST") {
    const body = readProvisioningJobRequest(await readJson<unknown>(request));

    if (typeof body.planId !== "string" || !body.planId) {
      throw new HttpError(400, "MISSING_PLAN_ID", "planId is required");
    }

    if (typeof body.approverId !== "string" || !body.approverId) {
      throw new HttpError(400, "MISSING_APPROVER_ID", "approverId is required");
    }

    const mode = readProvisioningMode(body.mode, body.dryRun);

    const job = await createProvisioningJob(app, {
      planId: body.planId,
      approverId: body.approverId,
      idempotencyKey: readIdempotencyKey(request),
      mode,
      approval: readProvisioningApproval(body.approval),
      control: readEnforcementControl(body.control)
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
    const body = readEnforcementReadinessBody(await readJson<unknown>(request));
    sendJson(response, 200, await checkEnforcementReadiness(app, connectorId, readEnforcementReadinessRequest(body)));
    return;
  }

  if (segments[3] === "sync" && request.method === "POST") {
    const body = readConnectorSyncRequest(await readJson<unknown>(request));
    sendJson(response, 202, await syncConnector(app, connectorId, readDiscoveryMode(body.mode)));
    return;
  }

  notFound(response);
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
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
    return (body ? JSON.parse(body) : {}) as T;
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Request body must be valid JSON");
  }
}

async function readDecisionRequest(request: IncomingMessage): Promise<DecisionRequest> {
  return normalizeDecisionRequest(
    readSchemaBacked<DecisionRequest>(
      "decisionRequest",
      await readJson<unknown>(request),
      "INVALID_DECISION_REQUEST",
      "Decision requests require subjectId, action, and resourceId"
    )
  );
}

function parseDecisionRequest(value: unknown): DecisionRequest | undefined {
  if (
    !isRecord(value) ||
    typeof value.subjectId !== "string" ||
    typeof value.action !== "string" ||
    typeof value.resourceId !== "string"
  ) {
    return undefined;
  }

  if (value.context !== undefined && !isRecord(value.context)) {
    return undefined;
  }

  return {
    subjectId: value.subjectId,
    action: value.action,
    resourceId: value.resourceId,
    context: value.context,
    policyVersion: typeof value.policyVersion === "string" ? value.policyVersion : undefined,
    modelVersion: typeof value.modelVersion === "string" ? value.modelVersion : undefined,
    relationshipVersion: typeof value.relationshipVersion === "string" ? value.relationshipVersion : undefined,
    tupleVersion: typeof value.tupleVersion === "string" ? value.tupleVersion : undefined,
    contextVersion: typeof value.contextVersion === "string" ? value.contextVersion : undefined,
    asOf: typeof value.asOf === "string" ? value.asOf : undefined
  };
}

function readSubject(value: unknown): Subject {
  return readSchemaBacked<Subject>(
    "subject",
    value,
    "INVALID_SUBJECT",
    "subjects require the canonical subject schema"
  );
}

function readResource(value: unknown): Resource {
  return readSchemaBacked<Resource>(
    "resource",
    value,
    "INVALID_RESOURCE",
    "resources require the canonical resource schema"
  );
}

function readRelationship(value: unknown): RelationshipTuple {
  return readSchemaBacked<RelationshipTuple>(
    "relationship",
    value,
    "INVALID_RELATIONSHIP",
    "relationships require the canonical relationship schema"
  );
}

function readPolicyDraft(value: unknown): PolicyDraft {
  return readSchemaBacked<PolicyDraft>(
    "policyDraft",
    value,
    "INVALID_POLICY_DRAFT",
    "policy drafts require name, model, and tests"
  );
}

function readPolicyValidationMode(value: unknown): "validate" | "test" | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (value.mode === "validate" || value.mode === "test") {
    return value.mode;
  }

  return undefined;
}

function readPolicyPublishRequest(value: unknown): { changeTicket: string; approverId: string } {
  return readSchemaBacked<{ changeTicket: string; approverId: string }>(
    "policyPublish",
    value,
    "INVALID_POLICY_PUBLISH_REQUEST",
    "policy publish requires changeTicket and approverId"
  );
}

function readPolicyRollbackRequest(value: unknown): { targetVersion: string; changeTicket: string; approverId: string } {
  return readSchemaBacked<{ targetVersion: string; changeTicket: string; approverId: string }>(
    "policyRollback",
    value,
    "INVALID_POLICY_ROLLBACK_REQUEST",
    "policy rollback requires targetVersion, changeTicket, and approverId"
  );
}

function readProvisioningPlanRequest(value: unknown): ProvisioningPlanRequest {
  return readSchemaBacked<ProvisioningPlanRequest>(
    "provisioningPlan",
    value,
    "INVALID_PROVISIONING_REQUEST",
    "Provisioning plans require a dry-run or controlled enforcement request"
  );
}

function readProvisioningJobRequest(value: unknown): ProvisioningJobRequest {
  return readSchemaBacked<ProvisioningJobRequest>(
    "provisioningJob",
    value,
    "INVALID_PROVISIONING_JOB_REQUEST",
    "Provisioning jobs require planId and approverId"
  );
}

function readReconciliationRunRequest(value: unknown): {
  connectorId: string;
  dryRun: true;
  trigger?: ReconciliationTrigger;
  schedule?: Partial<ReconciliationScheduleEvidence>;
} {
  return readSchemaBacked<{
    connectorId: string;
    dryRun: true;
    trigger?: ReconciliationTrigger;
    schedule?: Partial<ReconciliationScheduleEvidence>;
  }>(
    "reconciliationRun",
    value,
    "INVALID_RECONCILIATION_REQUEST",
    "Reconciliation runs require connectorId and dryRun: true"
  );
}

function readDriftRemediationRequest(value: unknown): {
  approval: ProvisioningApproval;
  autoRepairPolicy: DriftAutoRepairPolicy;
  readinessReportId?: string;
  hookEvidence?: DriftHookEvidence[];
} {
  const parsed = readSchemaBacked<DriftRemediationRequest>(
    "driftRemediation",
    value,
    "INVALID_DRIFT_REMEDIATION_REQUEST",
    "Drift remediation requires approval, autoRepairPolicy, and dry-run hook evidence"
  );

  if (!isProvisioningApproval(parsed.approval)) {
    throw new HttpError(400, "INVALID_DRIFT_REMEDIATION_REQUEST", "approval must match the provisioning approval shape");
  }

  if (!isDriftAutoRepairPolicy(parsed.autoRepairPolicy)) {
    throw new HttpError(400, "INVALID_DRIFT_REMEDIATION_REQUEST", "autoRepairPolicy must include safe dry-run controls");
  }

  if (parsed.hookEvidence !== undefined && !isDriftHookEvidenceArray(parsed.hookEvidence)) {
    throw new HttpError(400, "INVALID_DRIFT_REMEDIATION_REQUEST", "hookEvidence must contain ticket or SIEM hook evidence");
  }

  return {
    approval: parsed.approval,
    autoRepairPolicy: parsed.autoRepairPolicy,
    readinessReportId: readReadinessReportId(parsed.readinessReportId),
    hookEvidence: parsed.hookEvidence
  };
}

function readEnforcementReadinessBody(value: unknown): EnforcementReadinessRequest {
  return readSchemaBacked<EnforcementReadinessRequest>(
    "enforcementReadiness",
    value,
    "INVALID_ENFORCEMENT_READINESS_REQUEST",
    "Enforcement readiness requires a control block"
  );
}

function readConnectorSyncRequest(value: unknown): { mode: "read_only" } {
  return readSchemaBacked<{ mode: "read_only" }>(
    "connectorSync",
    value,
    "UNSUPPORTED_CONNECTOR_MODE",
    "connector sync requires mode read_only"
  );
}

function readSchemaBacked<T>(
  schemaName: RuntimeRequestSchemaName,
  value: unknown,
  code: string,
  message: string
): T {
  const errors = validateRuntimeRequestSchema(schemaName, value);

  if (errors.length > 0) {
    throw new HttpError(400, code, `${message}: ${errors.join("; ")}`);
  }

  return value as T;
}

function normalizeDecisionRequest(value: DecisionRequest): DecisionRequest {
  return {
    subjectId: value.subjectId,
    action: value.action,
    resourceId: value.resourceId,
    context: value.context,
    policyVersion: value.policyVersion,
    modelVersion: value.modelVersion,
    relationshipVersion: value.relationshipVersion,
    tupleVersion: value.tupleVersion,
    contextVersion: value.contextVersion,
    asOf: value.asOf
  };
}

function readDiscoveryMode(mode: unknown): "read_only" {
  if (mode === "read_only") {
    return "read_only";
  }

  if (mode === undefined) {
    throw new HttpError(400, "MISSING_CONNECTOR_MODE", "connector sync mode is required and must be read_only");
  }

  throw new HttpError(400, "UNSUPPORTED_CONNECTOR_MODE", "Phase 2 connector sync supports read_only mode only");
}

function readProvisioningMode(mode: unknown, dryRun: unknown): ProvisioningMode {
  if (mode === undefined) {
    if (dryRun === true) {
      return "dry_run";
    }

    throw new HttpError(
      400,
      "DRY_RUN_REQUIRED",
      "Provisioning defaults to dry-run; enforcement must explicitly request mode: enforcement and dryRun: false"
    );
  }

  if (mode === "dry_run") {
    if (dryRun === true) {
      return "dry_run";
    }

    throw new HttpError(400, "DRY_RUN_REQUIRED", "Dry-run provisioning requires dryRun: true");
  }

  if (mode === "enforcement") {
    if (dryRun === false) {
      return "enforcement";
    }

    throw new HttpError(400, "ENFORCEMENT_DRY_RUN_FALSE_REQUIRED", "Controlled enforcement requires dryRun: false");
  }

  throw new HttpError(400, "INVALID_PROVISIONING_MODE", "mode must be dry_run or enforcement");
}

function readProvisioningApproval(value: unknown): ProvisioningApproval | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (
    !isRecord(value) ||
    value.decision !== "approved" ||
    typeof value.approverId !== "string" ||
    typeof value.changeTicket !== "string" ||
    typeof value.approvedAt !== "string" ||
    (value.expiresAt !== undefined && typeof value.expiresAt !== "string") ||
    (value.reason !== undefined && typeof value.reason !== "string")
  ) {
    throw new HttpError(
      400,
      "INVALID_PROVISIONING_APPROVAL",
      "approval must include decision: approved, approverId, changeTicket, and approvedAt"
    );
  }

  const approvedAt = readProvisioningApprovalDateTime(value.approvedAt, "approvedAt");
  const expiresAt =
    value.expiresAt === undefined ? undefined : readProvisioningApprovalDateTime(value.expiresAt, "expiresAt");

  return {
    decision: value.decision,
    approverId: value.approverId,
    changeTicket: value.changeTicket,
    approvedAt,
    expiresAt,
    reason: value.reason
  };
}

function readProvisioningApprovalDateTime(value: string, fieldName: string): string {
  if (Number.isNaN(Date.parse(value))) {
    throw new HttpError(
      400,
      "INVALID_PROVISIONING_APPROVAL",
      `approval.${fieldName} must be a valid date-time`
    );
  }

  return value;
}

function readEnforcementControl(value: unknown): EnforcementControl | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (
    !isRecord(value) ||
    typeof value.syntheticOnly !== "boolean" ||
    typeof value.liveProviderWrites !== "boolean" ||
    typeof value.incidentMode !== "boolean" ||
    typeof value.breakGlass !== "boolean"
  ) {
    throw new HttpError(
      400,
      "INVALID_ENFORCEMENT_CONTROL",
      "control must include syntheticOnly, liveProviderWrites, incidentMode, and breakGlass booleans"
    );
  }

  return {
    syntheticOnly: value.syntheticOnly,
    liveProviderWrites: value.liveProviderWrites,
    incidentMode: value.incidentMode,
    breakGlass: value.breakGlass
  };
}

function readRequiredEnforcementControl(value: unknown): EnforcementControl {
  const control = readEnforcementControl(value);

  if (!control) {
    throw new HttpError(400, "INVALID_ENFORCEMENT_CONTROL", "control is required for enforcement readiness checks");
  }

  return control;
}

function readEnforcementReadinessRequest(value: unknown): {
  mode: "enforcement";
  control: EnforcementControl;
  requiredApproverRole?: string;
  changeTicketPattern?: string;
} {
  if (!isRecord(value)) {
    throw new HttpError(400, "INVALID_ENFORCEMENT_READINESS_REQUEST", "enforcement readiness requests require an object body");
  }

  if (value.mode !== undefined && value.mode !== "enforcement") {
    throw new HttpError(400, "INVALID_ENFORCEMENT_READINESS_MODE", "enforcement readiness mode must be enforcement");
  }

  if (value.requiredApproverRole !== undefined && (typeof value.requiredApproverRole !== "string" || !value.requiredApproverRole)) {
    throw new HttpError(400, "INVALID_APPROVER_ROLE", "requiredApproverRole must be a non-empty string when provided");
  }

  if (value.changeTicketPattern !== undefined && (typeof value.changeTicketPattern !== "string" || !value.changeTicketPattern)) {
    throw new HttpError(400, "INVALID_CHANGE_TICKET_PATTERN", "changeTicketPattern must be a non-empty string when provided");
  }

  if (typeof value.changeTicketPattern === "string") {
    assertRegularExpression(value.changeTicketPattern);
  }

  return {
    mode: "enforcement",
    control: readRequiredEnforcementControl(value.control),
    requiredApproverRole: value.requiredApproverRole,
    changeTicketPattern: value.changeTicketPattern
  };
}

function assertRegularExpression(pattern: string): void {
  if (!isSafeChangeTicketPattern(pattern)) {
    throw new HttpError(
      400,
      "INVALID_CHANGE_TICKET_PATTERN",
      "changeTicketPattern must be a valid safe regular expression without groups, alternation, or backreferences"
    );
  }
}

function readReadinessReportId(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || !value) {
    throw new HttpError(400, "INVALID_READINESS_REPORT_ID", "readinessReportId must be a non-empty string when provided");
  }

  return value;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isProvisioningApproval(value: unknown): value is ProvisioningApproval {
  return isRecord(value)
    && value.decision === "approved"
    && typeof value.approverId === "string"
    && typeof value.changeTicket === "string"
    && typeof value.approvedAt === "string";
}

function isDriftAutoRepairPolicy(value: unknown): value is DriftAutoRepairPolicy {
  if (!isRecord(value)) {
    return false;
  }

  const allowedActions = value.allowedActions;

  return typeof value.enabled === "boolean"
    && Array.isArray(allowedActions)
    && allowedActions.every((action) => action === "revoke" || action === "repair" || action === "review")
    && typeof value.maxSeverity === "string"
    && driftSeverities.has(value.maxSeverity)
    && typeof value.requireApproval === "boolean"
    && typeof value.requireConnectorReadiness === "boolean"
    && typeof value.liveProviderWrites === "boolean";
}

function isDriftHookEvidenceArray(value: unknown): value is DriftHookEvidence[] {
  return Array.isArray(value)
    && value.every((hook) =>
      isRecord(hook)
      && (hook.system === "ticket" || hook.system === "siem")
      && typeof hook.referenceId === "string"
      && (hook.status === "pending" || hook.status === "linked" || hook.status === "notified" || hook.status === "failed")
      && typeof hook.recordedAt === "string"
    );
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
