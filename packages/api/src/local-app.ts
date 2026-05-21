import {
  MockConnector,
  SyntheticAwsConnector,
  SyntheticEntraConnector,
  SyntheticSharePointConnector
} from "@access-kit/connectors-mock";
import {
  AuditRecorder,
  createLocalEngineSeed,
  InMemoryRebacStore,
  RebacDecisionEngine,
  sha256,
  type AuditEvent,
  type AuditEventInput,
  type ConnectorAdapter,
  type ConnectorHealthCheck,
  type DecisionRequest,
  type DiscoveryRun,
  type EvidenceExport,
  type JsonRecord,
  type NativeGrant,
  type NativeGrantType,
  type NativePrincipalType,
  type ProvisioningActionResult,
  type ProvisioningJob,
  type ProvisioningPlan,
  type ProvisioningVerification,
  type ReconciliationRun,
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

type NativeAccessFilter = Partial<
  Pick<NativeGrant, "sourceConnectorId" | "subjectId" | "nativePermission"> & {
    grantType: NativeGrantType;
    principalType: NativePrincipalType;
  }
>;

export function createRebacLocalApp(options: RebacLocalAppOptions = {}): RebacLocalApp {
  const now = options.now ?? (() => new Date().toISOString());
  const actor = options.actor ?? "service:api";
  const store = new InMemoryRebacStore(createLocalEngineSeed());
  const auditRecorder = new AuditRecorder();
  const engine = new RebacDecisionEngine(store, { now, actor, auditRecorder });
  const connectorList: ConnectorAdapter[] = [
    new MockConnector(),
    new SyntheticEntraConnector(),
    new SyntheticSharePointConnector(),
    new SyntheticAwsConnector()
  ];
  const connectors = new Map<string, ConnectorAdapter>(connectorList.map((connector) => [connector.id, connector]));

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
  mode: "read_only"
): Promise<DiscoveryRun> {
  const connector = getConnector(app, connectorId);
  const startedAt = app.now();
  const runSequence = app.store.listDiscoveryRuns({ connectorId }).length + 1;
  const runKey = `${connectorId}:${compactTimestamp(startedAt)}:${runSequence}`;
  connector.mode = mode;
  const metadata = connector.getDiscoveryMetadata?.();
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

  const completedAt = app.now();
  const warnings = metadata?.warnings ?? [];
  const run: DiscoveryRun = {
    id: `discovery:${runKey}`,
    connectorId,
    mode: "read_only",
    status: warnings.length > 0 ? "completed_with_warnings" : "completed",
    startedAt,
    completedAt,
    counts: {
      subjects: subjects.length,
      resources: resources.length,
      relationships: relationships.length,
      nativeGrants,
      warnings: warnings.length
    },
    warnings,
    cursor: metadata?.cursor,
    evidence: {
      readOnly: true,
      schemas: ["subject", "resource", "relationship", "native-grant", "discovery-run"],
      connectorCapabilities: Object.entries(connector.capabilities)
        .filter(([, enabled]) => enabled)
        .map(([name]) => name),
      nativeAccessReadback: nativeGrants > 0
    },
    auditEventIds: [],
    version: "discovery-run:v1",
    createdAt: startedAt,
    updatedAt: completedAt
  };

  const auditEvent = recordAudit(app, {
    eventType: "connector.discovery_completed",
    actor: app.actor,
    correlationId: `corr:connector-discovery:${runKey}`,
    payload: {
      action: "connector.discovery.read_only",
      connectorId,
      provider: metadata?.provider ?? connector.provider ?? connector.id,
      tenantBoundary: metadata?.tenantBoundary ?? connector.tenantBoundary ?? "synthetic:unknown",
      mode: run.mode,
      status: run.status,
      counts: run.counts,
      warnings: run.warnings,
      cursor: run.cursor,
      evidence: run.evidence,
      discoveryRunId: run.id
    }
  });

  const completedRun = { ...run, auditEventIds: [auditEvent.eventId] };
  app.store.recordDiscoveryRun(completedRun);
  return completedRun;
}

export function listDiscoveryRuns(
  app: RebacLocalApp,
  filter: Partial<Pick<DiscoveryRun, "connectorId" | "status">> = {}
): DiscoveryRun[] {
  return app.store.listDiscoveryRuns(filter);
}

export function readNativeAccess(app: RebacLocalApp, resourceId: string, filter: NativeAccessFilter = {}): NativeGrant[] {
  const grants = app.store.listNativeGrants({
    targetObjectId: resourceId,
    ...filter
  });

  recordAudit(app, {
    eventType: "connector.current_access_read",
    actor: app.actor,
    resourceId,
    correlationId: `corr:connector-current-access:${resourceId}:${compactTimestamp(app.now())}`,
    payload: {
      action: "connector.current_access.read",
      resourceId,
      filters: filter,
      resultCount: grants.length
    }
  });

  return grants;
}

export async function testConnector(app: RebacLocalApp, connectorId: string): Promise<{ valid: boolean; checks: ConnectorHealthCheck[] }> {
  const connector = app.connectors.get(connectorId);

  if (!connector) {
    return {
      valid: false,
      checks: [
        {
          name: "connector_registered",
          status: "fail",
          message: `Connector ${connectorId} is not registered.`
        }
      ]
    };
  }

  const checks = connector.testReadOnlyAccess
    ? await connector.testReadOnlyAccess()
    : [
        {
          name: "connector_registered",
          status: "pass" as const,
          message: `${connectorId} is registered.`
        }
      ];

  return {
    valid: checks.every((check) => check.status !== "fail"),
    checks
  };
}

export async function createProvisioningPlan(
  app: RebacLocalApp,
  request: DecisionRequest,
  connectorId = getDefaultConnectorId(app)
): Promise<ProvisioningPlan> {
  const connector = getConnector(app, connectorId);
  const decision = app.engine.explain(request);
  const plan = normalizePlanConnector(await connector.planProvisioningChange(decision), connectorId);
  app.store.upsertProvisioningPlan(plan);
  recordAudit(app, {
    eventType: "provisioning.requested",
    actor: app.actor,
    subjectId: plan.subjectId,
    resourceId: plan.resourceId,
    correlationId: `corr:${plan.id}`,
    payload: asJsonRecord(plan)
  });
  recordAudit(app, {
    eventType: "provisioning.planned",
    actor: app.actor,
    subjectId: plan.subjectId,
    resourceId: plan.resourceId,
    correlationId: `corr:${plan.id}:planned`,
    payload: {
      planId: plan.id,
      connectorId: plan.connectorId,
      mode: plan.mode,
      status: plan.status,
      actionIds: plan.actions.map((action) => action.actionId),
      idempotencyKeys: plan.actions.map((action) => action.idempotencyKey)
    }
  });
  recordCompensationAudit(app, plan);
  return plan;
}

export async function createRevocationPlan(
  app: RebacLocalApp,
  nativeGrantId: string,
  connectorId = getDefaultConnectorId(app)
): Promise<ProvisioningPlan> {
  const connector = getConnector(app, connectorId);
  const plan = normalizePlanConnector(await connector.revokeAccess(nativeGrantId), connectorId);
  app.store.upsertProvisioningPlan(plan);
  recordAudit(app, {
    eventType: "provisioning.requested",
    actor: app.actor,
    subjectId: plan.subjectId,
    resourceId: plan.resourceId,
    correlationId: `corr:${plan.id}`,
    payload: asJsonRecord(plan)
  });
  recordAudit(app, {
    eventType: "provisioning.planned",
    actor: app.actor,
    subjectId: plan.subjectId,
    resourceId: plan.resourceId,
    correlationId: `corr:${plan.id}:planned`,
    payload: {
      planId: plan.id,
      connectorId: plan.connectorId,
      mode: plan.mode,
      status: plan.status,
      actionIds: plan.actions.map((action) => action.actionId),
      idempotencyKeys: plan.actions.map((action) => action.idempotencyKey)
    }
  });
  recordCompensationAudit(app, plan);
  return plan;
}

export async function createProvisioningJob(
  app: RebacLocalApp,
  request: { planId: string; approverId: string; idempotencyKey: string }
): Promise<ProvisioningJob | undefined> {
  const existing = app.store.getProvisioningJobByIdempotencyKey(request.idempotencyKey);

  if (existing) {
    return existing;
  }

  const plan = app.store.getProvisioningPlan(request.planId);

  if (!plan) {
    return undefined;
  }

  const connector = getConnector(app, plan.connectorId);
  const startedAt = app.now();
  const jobId = `job:${sha256({ planId: request.planId, idempotencyKey: request.idempotencyKey }).slice(0, 24)}`;
  const completedAt = app.now();
  const verification = await buildDryRunVerification(connector, plan, completedAt);
  const actionResults = plan.actions.map((action): ProvisioningActionResult => ({
    actionId: action.actionId,
    operation: action.operation,
    status: "skipped",
    dryRun: true,
    idempotencyKey: action.idempotencyKey,
    message: "Dry-run only: provider write was not executed.",
    verification: {
      ...action.verification,
      status: verification.status,
      readbackState: verification.readbackState,
      checkedAt: verification.checkedAt,
      message: verification.message
    },
    compensation: action.compensation
  }));
  const jobWithoutAuditIds: ProvisioningJob = {
    id: jobId,
    planId: plan.id,
    connectorId: plan.connectorId,
    mode: "dry_run",
    dryRun: true,
    status: "completed",
    approverId: request.approverId,
    idempotencyKey: request.idempotencyKey,
    actionResults,
    verification,
    auditEventIds: [],
    version: "provisioning-job:v1",
    createdAt: startedAt,
    startedAt,
    completedAt
  };
  const auditEventIds = [
    ...actionResults.map((result) =>
      recordAudit(app, {
        eventType: "provisioning.skipped",
        actor: app.actor,
        subjectId: plan.subjectId,
        resourceId: plan.resourceId,
        correlationId: `corr:${jobId}:${result.actionId}:skipped`,
        payload: {
          jobId,
          planId: plan.id,
          actionId: result.actionId,
          operation: result.operation,
          dryRun: true,
          reason: result.message,
          providerWrite: false
        }
      }).eventId
    ),
    recordAudit(app, {
      eventType: "provisioning.verified",
      actor: app.actor,
      subjectId: plan.subjectId,
      resourceId: plan.resourceId,
      correlationId: `corr:${jobId}:verified`,
      payload: {
        jobId,
        planId: plan.id,
        connectorId: plan.connectorId,
        verification
      }
    }).eventId,
    recordAudit(app, {
      eventType: "provisioning.completed",
      actor: app.actor,
      subjectId: plan.subjectId,
      resourceId: plan.resourceId,
      correlationId: `corr:${jobId}:completed`,
      payload: asJsonRecord(jobWithoutAuditIds)
    }).eventId
  ];
  const job = { ...jobWithoutAuditIds, auditEventIds };
  app.store.upsertProvisioningJob(job);
  return job;
}

export function getProvisioningJob(app: RebacLocalApp, jobId: string): ProvisioningJob | undefined {
  return app.store.getProvisioningJob(jobId);
}

export async function runReconciliation(app: RebacLocalApp, connectorId: string): Promise<ReconciliationRun> {
  const connector = getConnector(app, connectorId);
  const startedAt = app.now();
  const runSequence = app.store.listReconciliationRuns().filter((run) => run.connectorId === connectorId).length + 1;
  const findings = await connector.detectDrift();
  const auditEventIds: string[] = [];

  for (const finding of findings) {
    app.store.upsertDriftFinding(finding);
    const event = recordAudit(app, {
      eventType: "drift.detected",
      actor: app.actor,
      subjectId: finding.subjectId,
      resourceId: finding.resourceId,
      correlationId: `corr:${finding.id}`,
      payload: asJsonRecord(finding)
    });
    auditEventIds.push(event.eventId);
  }

  const completedAt = app.now();
  const run: ReconciliationRun = {
    id: `reconciliation:${connectorId}:${compactTimestamp(startedAt)}:${runSequence}`,
    connectorId,
    mode: "dry_run",
    dryRun: true,
    status: "completed",
    findings,
    counts: {
      findings: findings.length,
      highOrCritical: findings.filter((finding) => finding.severity === "high" || finding.severity === "critical").length
    },
    auditEventIds,
    version: "reconciliation-run:v1",
    createdAt: startedAt,
    completedAt
  };
  const completedEvent = recordAudit(app, {
    eventType: "reconciliation.completed",
    actor: app.actor,
    correlationId: `corr:${run.id}:completed`,
    payload: {
      runId: run.id,
      connectorId,
      dryRun: true,
      counts: run.counts,
      findingIds: findings.map((finding) => finding.id)
    }
  });
  const completedRun = { ...run, auditEventIds: [...auditEventIds, completedEvent.eventId] };
  app.store.recordReconciliationRun(completedRun);
  return completedRun;
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

function getDefaultConnectorId(app: RebacLocalApp): string {
  const connectorId = app.connectors.keys().next().value;

  if (!connectorId) {
    throw new Error("No connectors are registered");
  }

  return connectorId;
}

function asJsonRecord(value: object): JsonRecord {
  return value as unknown as JsonRecord;
}

function compactTimestamp(timestamp: string): string {
  return timestamp.replaceAll(/[^0-9a-z]/gi, "").toLowerCase();
}

function normalizePlanConnector(plan: ProvisioningPlan, connectorId: string): ProvisioningPlan {
  return {
    ...plan,
    connectorId
  };
}

function recordCompensationAudit(app: RebacLocalApp, plan: ProvisioningPlan): void {
  for (const action of plan.actions) {
    if (!action.compensation) {
      continue;
    }

    recordAudit(app, {
      eventType: "provisioning.compensation_planned",
      actor: app.actor,
      subjectId: plan.subjectId,
      resourceId: plan.resourceId,
      correlationId: `corr:${plan.id}:${action.actionId}:compensation`,
      payload: {
        planId: plan.id,
        actionId: action.actionId,
        compensation: action.compensation
      }
    });
  }
}

async function buildDryRunVerification(
  connector: ConnectorAdapter,
  plan: ProvisioningPlan,
  checkedAt: string
): Promise<ProvisioningVerification> {
  const verified = await connector.verifyProvisioningChange(plan);

  if (verified) {
    return {
      status: "verified",
      method: "connector.verifyProvisioningChange",
      expectedState: {
        planId: plan.id,
        actionCount: plan.actions.length
      },
      readbackState: {
        dryRun: true,
        providerWrite: false,
        verificationHook: true
      },
      checkedAt,
      message: "Dry-run verification hook completed without provider mutation."
    };
  }

  return {
    status: "skipped",
    method: "connector.verifyProvisioningChange",
    expectedState: {
      planId: plan.id,
      actionCount: plan.actions.length
    },
    readbackState: {
      dryRun: true,
      providerWrite: false,
      verificationHook: false
    },
    checkedAt,
    message: "Connector did not provide positive dry-run verification; provider write remains skipped."
  };
}
