import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  checkDecision,
  createProvisioningPlan,
  createRebacLocalApp,
  createResource,
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
import type { ConnectorAdapter, DecisionRequest, RelationshipTuple, Resource, Subject } from "@access-kit/core";

export interface RebacApiServerOptions extends RebacLocalAppOptions {
  app?: RebacLocalApp;
}

export function createRebacApiServer(options: RebacApiServerOptions = {}): Server {
  const app = options.app ?? createRebacLocalApp(options);

  return createServer(async (request, response) => {
    try {
      await routeRequest(app, request, response);
    } catch (error) {
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
    await routeResources(app, request, response, segments);
    return;
  }

  if (segments[1] === "relationships") {
    await routeRelationships(app, request, response, url, segments);
    return;
  }

  if (segments[1] === "provisioning" && segments[2] === "plans" && method === "POST") {
    const body = await readJson<DecisionRequest>(request);
    sendJson(response, 201, await createProvisioningPlan(app, body));
    return;
  }

  if (segments[1] === "reconciliation") {
    await routeReconciliation(app, request, response, segments);
    return;
  }

  if (segments[1] === "audit" && segments[2] === "events" && method === "GET") {
    sendJson(response, 200, { items: app.store.listAuditEvents() });
    return;
  }

  if (segments[1] === "evidence" && segments[2] === "export" && method === "GET") {
    const controls = (url.searchParams.get("controls") ?? "AC-2,AC-3,AU-2")
      .split(",")
      .map((control) => control.trim())
      .filter(Boolean);
    const format = (url.searchParams.get("format") ?? "json") as "json" | "zip" | "markdown";
    sendJson(response, 200, exportEvidence(app, controls, format));
    return;
  }

  if (segments[1] === "connectors") {
    await routeConnectors(app, request, response, segments);
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
    const body = await readJson<DecisionRequest>(request);
    sendJson(response, 200, checkDecision(app, body));
    return;
  }

  if (segments[2] === "explain") {
    const body = await readJson<DecisionRequest>(request);
    sendJson(response, 200, explainDecision(app, body));
    return;
  }

  if (segments[2] === "batch-check") {
    const batch = await readJson<{ requests: DecisionRequest[] }>(request);
    sendJson(response, 200, { results: batch.requests.map((item) => checkDecision(app, item)) });
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
    sendJson(response, 201, createSubject(app, await readJson<Subject>(request)));
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
  segments: string[]
): Promise<void> {
  if (segments.length === 2 && request.method === "GET") {
    sendJson(response, 200, { items: app.store.listResources() });
    return;
  }

  if (segments.length === 2 && request.method === "POST") {
    sendJson(response, 201, createResource(app, await readJson<Resource>(request)));
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
  segments: string[]
): Promise<void> {
  if (segments[2] === "run" && request.method === "POST") {
    const body = await readJson<{ connectorId: string }>(request);
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
    sendJson(response, 200, { items: app.store.listDriftFindings() });
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
    const body = await readJson<{ mode?: ConnectorAdapter["mode"] }>(request);
    sendJson(response, 202, await syncConnector(app, connectorId, body.mode ?? "read_only"));
    return;
  }

  notFound(response);
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const body = Buffer.concat(chunks).toString("utf8");
  return (body ? JSON.parse(body) : {}) as T;
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
