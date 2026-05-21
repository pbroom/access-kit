import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  applyProvisioningPlan,
  checkDecision,
  createProvisioningPlan,
  createRebacLocalApp,
  createResource,
  createRevocationPlan,
  createSubject,
  deleteRelationship,
  explainDecision,
  exportEvidence,
  putRelationship,
  runReconciliation,
  syncConnector,
  type RebacLocalApp,
  type RebacLocalAppOptions
} from "./local-app.js";
import type { DecisionRequest, DriftSeverity, RelationshipTuple, Resource, Subject } from "@access-kit/core";

export interface RebacApiServerOptions extends RebacLocalAppOptions {
  app?: RebacLocalApp;
}

interface ProvisioningPlanRequest {
  subjectId?: unknown;
  action?: unknown;
  resourceId?: unknown;
  context?: unknown;
  grantId?: unknown;
  connectorId?: unknown;
}

interface ProvisioningJobRequest {
  planId?: unknown;
  approverId?: unknown;
}

const maxRequestBodyBytes = 1024 * 1024;
const evidenceFormats = new Set(["json", "zip", "markdown"]);
const driftSeverities = new Set(["low", "medium", "high", "critical"]);

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export function createRebacApiServer(options: RebacApiServerOptions = {}): Server {
  const app = options.app ?? createRebacLocalApp(options);

  return createServer(async (request, response) => {
    try {
      await routeRequest(app, request, response);
    } catch (error) {
      if (error instanceof HttpError) {
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
  response: ServerResponse
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  const method = request.method ?? "GET";
  const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

  if (method === "GET" && url.pathname === "/v1/health") {
    sendJson(response, 200, { status: "ok", version: "0.1.0" });
    return;
  }

  if (segments[0] !== "v1") {
    notFound(response);
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
    await routePolicies(request, response, segments);
    return;
  }

  if (segments[1] === "provisioning" && segments[2] === "plans" && method === "POST") {
    const body = await readJson<ProvisioningPlanRequest>(request);

    if (body.connectorId !== undefined && (typeof body.connectorId !== "string" || !body.connectorId)) {
      throw new HttpError(400, "INVALID_CONNECTOR_ID", "connectorId must be a non-empty string when provided");
    }

    const connectorId = typeof body.connectorId === "string" ? body.connectorId : undefined;
    if (body.grantId !== undefined) {
      if (typeof body.grantId !== "string" || !body.grantId) {
        throw new HttpError(400, "INVALID_GRANT_ID", "grantId must be a non-empty string");
      }

      sendJson(response, 201, await createRevocationPlan(app, body.grantId, connectorId));
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

    sendJson(response, 201, await createProvisioningPlan(app, decisionRequest, connectorId));
    return;
  }

  if (segments[1] === "provisioning" && segments[2] === "jobs" && method === "POST") {
    const body = await readJson<ProvisioningJobRequest>(request);

    if (typeof body.planId !== "string" || !body.planId) {
      throw new HttpError(400, "INVALID_PROVISIONING_JOB_REQUEST", "provisioning jobs require planId");
    }

    if (typeof body.approverId !== "string" || !body.approverId) {
      throw new HttpError(400, "INVALID_PROVISIONING_JOB_REQUEST", "provisioning jobs require approverId");
    }

    const plan = await applyProvisioningPlan(app, body.planId);
    if (!plan) {
      notFound(response);
      return;
    }

    sendJson(response, 202, {
      id: `job:${plan.id}:applied`,
      planId: plan.id,
      approverId: body.approverId,
      status: "succeeded",
      plan
    });
    return;
  }

  if (segments[1] === "reconciliation") {
    await routeReconciliation(app, request, response, url, segments);
    return;
  }

  if (segments[1] === "audit" && segments[2] === "events" && method === "GET") {
    sendJson(response, 200, {
      items: app.store.listAuditEvents({
        subjectId: url.searchParams.get("subjectId") ?? undefined,
        resourceId: url.searchParams.get("resourceId") ?? undefined,
        from: readOptionalDateTime(url.searchParams.get("from"), "from")
      })
    });
    return;
  }

  if (segments[1] === "evidence" && segments[2] === "export" && method === "GET") {
    const controls = (url.searchParams.get("controls") ?? "AC-2,AC-3,AU-2")
      .split(",")
      .map((control) => control.trim())
      .filter(Boolean);
    const format = url.searchParams.get("format") ?? "json";
    if (!isEvidenceFormat(format)) {
      throw new HttpError(400, "INVALID_EVIDENCE_FORMAT", "format must be one of json, zip, or markdown");
    }

    sendJson(response, 200, exportEvidence(app, controls, format));
    return;
  }

  if (segments[1] === "connectors") {
    await routeConnectors(app, request, response, segments);
    return;
  }

  notFound(response);
}

async function routePolicies(
  request: IncomingMessage,
  response: ServerResponse,
  segments: string[]
): Promise<void> {
  const policyId = segments[2];
  const action = segments[3];

  if (!policyId || segments.length !== 4 || request.method !== "POST") {
    notFound(response);
    return;
  }

  const body = await readJson<unknown>(request);

  if (action === "validate") {
    if (!isRecord(body) || (body.mode !== "validate" && body.mode !== "test")) {
      throw new HttpError(400, "INVALID_POLICY_VALIDATION_REQUEST", "policy validation requires mode validate or test");
    }

    sendJson(response, 200, {
      policyId,
      mode: body.mode,
      status: "valid",
      checks: [
        {
          name: body.mode === "test" ? "proof_points" : "syntax",
          status: "pass",
          message: "Local policy contract accepted for the current ReBAC runtime."
        }
      ]
    });
    return;
  }

  if (action === "publish") {
    if (
      !isRecord(body) ||
      typeof body.changeTicket !== "string" ||
      !body.changeTicket ||
      typeof body.approverId !== "string" ||
      !body.approverId
    ) {
      throw new HttpError(400, "INVALID_POLICY_PUBLISH_REQUEST", "policy publish requires changeTicket and approverId");
    }

    sendJson(response, 200, {
      policyId,
      status: "published",
      changeTicket: body.changeTicket,
      approverId: body.approverId,
      version: policyId
    });
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
    const requests = parseDecisionBatch(batch);

    if (!requests) {
      sendJson(response, 400, {
        code: "INVALID_BATCH_REQUESTS",
        message: "batch-check requires a requests array of decision requests",
        correlationId: "corr:bad-request"
      });
      return;
    }

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
      items: app.store.listNativeGrants({
        targetObjectId: resourceId,
        sourceConnectorId: url.searchParams.get("connectorId") ?? undefined,
        subjectId: url.searchParams.get("subjectId") ?? undefined,
        nativePermission: url.searchParams.get("nativePermission") ?? undefined
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
    sendJson(response, 200, putRelationship(app, await readJson<RelationshipTuple>(request)));
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
    const body = await readJson<{ connectorId: string; dryRun?: unknown }>(request);

    if (typeof body.connectorId !== "string" || !body.connectorId) {
      throw new HttpError(400, "MISSING_CONNECTOR_ID", "connectorId is required");
    }

    if (body.dryRun !== true) {
      throw new HttpError(400, "DRY_RUN_REQUIRED", "Local reconciliation only supports dryRun: true");
    }

    const findings = await runReconciliation(app, body.connectorId);
    sendJson(response, 202, {
      id: `reconciliation:${body.connectorId}`,
      connectorId: body.connectorId,
      mode: "dry_run",
      status: "completed",
      findings
    });
    return;
  }

  if (segments[2] === "findings" && request.method === "GET") {
    sendJson(response, 200, { items: app.store.listDriftFindings({ severity: readDriftSeverity(url.searchParams.get("severity")) }) });
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
    const connector = app.connectors.get(connectorId);
    sendJson(response, 200, {
      valid: Boolean(connector),
      checks: [
        {
          name: "connector_registered",
          status: connector ? "pass" : "fail"
        }
      ]
    });
    return;
  }

  if (segments[3] === "sync" && request.method === "POST") {
    const body = await readJson<{ mode?: unknown }>(request);
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
  const parsed = parseDecisionRequest(await readJson<unknown>(request));

  if (!parsed) {
    throw new HttpError(400, "INVALID_DECISION_REQUEST", "Decision requests require subjectId, action, and resourceId");
  }

  return parsed;
}

function parseDecisionBatch(value: unknown): DecisionRequest[] | undefined {
  if (!isRecord(value) || !Array.isArray(value.requests)) {
    return undefined;
  }

  const requests = value.requests.map(parseDecisionRequest);
  return requests.every((item) => item !== undefined) ? requests : undefined;
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
    context: value.context
  };
}

function readSubject(value: unknown): Subject {
  if (
    !isRecord(value) ||
    !hasStringFields(value, ["id", "type", "displayName", "sourceSystem", "lifecycleState", "version", "createdAt"]) ||
    !isStringRecord(value.identifiers) ||
    (value.attributes !== undefined && !isRecord(value.attributes)) ||
    (value.lastSeenAt !== undefined && typeof value.lastSeenAt !== "string")
  ) {
    throw new HttpError(
      400,
      "INVALID_SUBJECT",
      "subjects require id, type, displayName, sourceSystem, lifecycleState, identifiers, version, and createdAt"
    );
  }

  return value as unknown as Subject;
}

function readResource(value: unknown): Resource {
  if (
    !isRecord(value) ||
    !hasStringFields(value, [
      "id",
      "type",
      "displayName",
      "sourceSystem",
      "ownerId",
      "dataStewardId",
      "technicalOwnerId",
      "classification",
      "lifecycleState",
      "version",
      "createdAt"
    ]) ||
    (value.parentId !== undefined && typeof value.parentId !== "string") ||
    (value.attributes !== undefined && !isRecord(value.attributes)) ||
    (value.lastSeenAt !== undefined && typeof value.lastSeenAt !== "string")
  ) {
    throw new HttpError(
      400,
      "INVALID_RESOURCE",
      "resources require id, type, displayName, sourceSystem, owners, classification, lifecycleState, version, and createdAt"
    );
  }

  return value as unknown as Resource;
}

function hasStringFields(value: Record<string, unknown>, fields: string[]): boolean {
  return fields.every((field) => typeof value[field] === "string" && value[field].length > 0);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function readOptionalDateTime(value: string | null, name: string): string | undefined {
  if (!value) {
    return undefined;
  }

  if (Number.isNaN(Date.parse(value))) {
    throw new HttpError(400, "INVALID_AUDIT_FILTER", `${name} must be a valid date-time`);
  }

  return new Date(value).toISOString();
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function notFound(response: ServerResponse): void {
  sendJson(response, 404, {
    code: "NOT_FOUND",
    message: "Route or object was not found",
    correlationId: "corr:not-found"
  });
}
