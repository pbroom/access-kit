import { MockConnector } from "@access-kit/connectors-mock";
import {
  AuditRecorder,
  createLocalEngineSeed,
  InMemoryRebacStore,
  RebacDecisionEngine,
  type AuditEvent,
  type AuditEventInput,
  type ConnectorAdapter,
  type DecisionRequest,
  type DriftFinding,
  type EvidenceExport,
  type JsonRecord,
  type ProvisioningPlan,
  type RelationshipTuple,
  type Resource,
  type Subject
} from "@access-kit/core";

export interface RebacLocalAppOptions {
  now?: () => string;
  actor?: string;
}

export interface RebacLocalApp {
  store: InMemoryRebacStore;
  engine: RebacDecisionEngine;
  auditRecorder: AuditRecorder;
  connectors: Map<string, ConnectorAdapter>;
  now: () => string;
  actor: string;
}

export interface ConnectorSyncResult {
  connectorId: string;
  mode: ConnectorAdapter["mode"];
  subjects: number;
  resources: number;
  relationships: number;
  nativeGrants: number;
}

export function createRebacLocalApp(options: RebacLocalAppOptions = {}): RebacLocalApp {
  const now = options.now ?? (() => new Date().toISOString());
  const actor = options.actor ?? "service:api";
  const store = new InMemoryRebacStore(createLocalEngineSeed());
  const auditRecorder = new AuditRecorder();
  const engine = new RebacDecisionEngine(store, { now, actor, auditRecorder });
  const connectors = new Map<string, ConnectorAdapter>([["mock", new MockConnector()]]);

  return {
    store,
    engine,
    auditRecorder,
    connectors,
    now,
    actor
  };
}

export function checkDecision(app: RebacLocalApp, request: DecisionRequest): ReturnType<RebacDecisionEngine["check"]> {
  return app.engine.check(request);
}

export function explainDecision(app: RebacLocalApp, request: DecisionRequest): ReturnType<RebacDecisionEngine["explain"]> {
  return app.engine.explain(request);
}

export function createSubject(app: RebacLocalApp, subject: Subject): Subject {
  const saved = app.store.upsertSubject(subject);
  recordAudit(app, {
    eventType: "subject.created",
    actor: app.actor,
    subjectId: saved.id,
    correlationId: `corr:${saved.id}:${saved.version}`,
    payload: asJsonRecord(saved)
  });
  return saved;
}

export function createResource(app: RebacLocalApp, resource: Resource): Resource {
  const saved = app.store.upsertResource(resource);
  recordAudit(app, {
    eventType: "resource.discovered",
    actor: app.actor,
    resourceId: saved.id,
    correlationId: `corr:${saved.id}:${saved.version}`,
    payload: asJsonRecord(saved)
  });
  return saved;
}

export function putRelationship(app: RebacLocalApp, relationship: RelationshipTuple): RelationshipTuple {
  const saved = app.store.upsertRelationship(relationship);
  recordAudit(app, {
    eventType: "relationship.created",
    actor: app.actor,
    subjectId: saved.subjectId,
    resourceId: saved.objectId,
    correlationId: `corr:${saved.id}:${saved.version}`,
    payload: asJsonRecord(saved)
  });
  return saved;
}

export function deleteRelationship(app: RebacLocalApp, relationshipId: string): RelationshipTuple | undefined {
  const deleted = app.store.deleteRelationship(relationshipId, app.now());

  if (deleted) {
    recordAudit(app, {
      eventType: "relationship.deleted",
      actor: app.actor,
      subjectId: deleted.subjectId,
      resourceId: deleted.objectId,
      correlationId: `corr:${deleted.id}:deleted`,
      payload: asJsonRecord(deleted)
    });
  }

  return deleted;
}

export async function syncConnector(
  app: RebacLocalApp,
  connectorId: string,
  mode: ConnectorAdapter["mode"]
): Promise<ConnectorSyncResult> {
  const connector = getConnector(app, connectorId);
  connector.mode = mode;
  const subjects = await connector.discoverSubjects();
  const resources = await connector.discoverResources();
  const relationships = await connector.discoverRelationships();

  subjects.forEach((subject) => app.store.upsertSubject(subject));
  resources.forEach((resource) => app.store.upsertResource(resource));
  relationships.forEach((relationship) => app.store.upsertRelationship(relationship));

  let nativeGrants = 0;
  for (const resource of resources) {
    const grants = await connector.readCurrentAccess(resource.id);
    grants.forEach((grant) => app.store.upsertNativeGrant(grant));
    nativeGrants += grants.length;
  }

  const result = {
    connectorId,
    mode,
    subjects: subjects.length,
    resources: resources.length,
    relationships: relationships.length,
    nativeGrants
  };

  recordAudit(app, {
    eventType: "admin.action_performed",
    actor: app.actor,
    correlationId: `corr:connector-sync:${connectorId}:${app.now()}`,
    payload: {
      action: "connector.sync",
      result
    }
  });

  return result;
}

export async function createProvisioningPlan(
  app: RebacLocalApp,
  request: DecisionRequest
): Promise<ProvisioningPlan> {
  const connector = getConnector(app, "mock");
  const decision = app.engine.explain(request);
  const plan = await connector.planProvisioningChange(decision);
  app.store.upsertProvisioningPlan(plan);
  recordAudit(app, {
    eventType: "provisioning.requested",
    actor: app.actor,
    subjectId: plan.subjectId,
    resourceId: plan.resourceId,
    correlationId: `corr:${plan.id}`,
    payload: asJsonRecord(plan)
  });
  return plan;
}

export async function runReconciliation(app: RebacLocalApp, connectorId: string): Promise<DriftFinding[]> {
  const connector = getConnector(app, connectorId);
  const findings = await connector.detectDrift();

  for (const finding of findings) {
    app.store.upsertDriftFinding(finding);
    recordAudit(app, {
      eventType: "drift.detected",
      actor: app.actor,
      subjectId: finding.subjectId,
      resourceId: finding.resourceId,
      correlationId: `corr:${finding.id}`,
      payload: asJsonRecord(finding)
    });
  }

  return findings;
}

export function exportEvidence(app: RebacLocalApp, controls: string[], format: EvidenceExport["format"]): EvidenceExport {
  const generatedAt = app.now();
  const events = app.store.listAuditEvents();
  const periodStart = events
    .map((event) => event.occurredAt)
    .sort()
    .at(0) ?? generatedAt;
  const exportMetadata: EvidenceExport = {
    exportId: `evidence:${generatedAt.replaceAll(/[^0-9a-z]/gi, "").toLowerCase()}`,
    framework: "nist-800-53",
    controls,
    periodStart,
    periodEnd: generatedAt,
    generatedAt,
    evidenceTypes: ["audit_events", "decision_logs", "provisioning_plans", "drift_findings"],
    sourceEventIds: events.map((event) => event.eventId),
    responsibleRole: "ISSO",
    format
  };

  recordAudit(app, {
    eventType: "evidence.generated",
    actor: app.actor,
    correlationId: `corr:${exportMetadata.exportId}`,
    payload: asJsonRecord(exportMetadata)
  });

  return exportMetadata;
}

export function recordAudit(app: RebacLocalApp, input: AuditEventInput): AuditEvent {
  const event = app.auditRecorder.record(input, app.now());
  app.store.recordAuditEvent(event);
  return event;
}

function getConnector(app: RebacLocalApp, connectorId: string): ConnectorAdapter {
  const connector = app.connectors.get(connectorId);

  if (!connector) {
    throw new Error(`Unknown connector: ${connectorId}`);
  }

  return connector;
}

function asJsonRecord(value: object): JsonRecord {
  return value as unknown as JsonRecord;
}
