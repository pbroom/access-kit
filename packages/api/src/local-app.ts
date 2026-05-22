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
  type EnforcementControl,
  type EvidenceExport,
  type JsonRecord,
  type NativeGrant,
  type NativeGrantType,
  type NativePrincipalType,
  type ProvisioningApproval,
  type ProvisioningActionResult,
  type ProvisioningJob,
  type ProvisioningMode,
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

export class RebacLocalAppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
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

interface ProvisioningExecutionOptions {
  mode?: ProvisioningMode;
  approval?: ProvisioningApproval;
  control?: EnforcementControl;
}

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
  connectorId = getDefaultConnectorId(app),
  options: ProvisioningExecutionOptions = {},
  idempotencyKey?: string
): Promise<ProvisioningPlan> {
  const connector = getConnector(app, connectorId);
  const existing = idempotencyKey ? app.store.getProvisioningPlanByIdempotencyKey(idempotencyKey) : undefined;

  if (existing) {
    if (!planMatchesDecisionRequest(existing, request, connectorId, options)) {
      throw new RebacLocalAppError(
        409,
        "IDEMPOTENCY_KEY_REUSED",
        "Idempotency-Key was already used for a different provisioning plan request."
      );
    }

    return existing;
  }

  const decision = app.engine.explain(request);
  const plan = {
    ...prepareProvisioningPlan(
      app,
      connector,
      normalizePlanConnector(await connector.planProvisioningChange(decision), connectorId),
      options
    ),
    idempotencyKey
  };
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
  recordPlanApprovalAudit(app, plan);
  recordCompensationAudit(app, plan);
  return plan;
}

export async function createRevocationPlan(
  app: RebacLocalApp,
  nativeGrantId: string,
  connectorId = getDefaultConnectorId(app),
  options: ProvisioningExecutionOptions = {},
  idempotencyKey?: string
): Promise<ProvisioningPlan> {
  const connector = getConnector(app, connectorId);
  const existing = idempotencyKey ? app.store.getProvisioningPlanByIdempotencyKey(idempotencyKey) : undefined;

  if (existing) {
    if (!planMatchesRevocationRequest(existing, nativeGrantId, connectorId, options)) {
      throw new RebacLocalAppError(
        409,
        "IDEMPOTENCY_KEY_REUSED",
        "Idempotency-Key was already used for a different provisioning plan request."
      );
    }

    return existing;
  }

  const plan = {
    ...prepareProvisioningPlan(app, connector, normalizePlanConnector(await connector.revokeAccess(nativeGrantId), connectorId), options),
    idempotencyKey
  };
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
  recordPlanApprovalAudit(app, plan);
  recordCompensationAudit(app, plan);
  return plan;
}

export async function createProvisioningJob(
  app: RebacLocalApp,
  request: {
    planId: string;
    approverId: string;
    idempotencyKey: string;
    mode?: ProvisioningMode;
    approval?: ProvisioningApproval;
    control?: EnforcementControl;
  }
): Promise<ProvisioningJob | undefined> {
  const existing = app.store.getProvisioningJobByIdempotencyKey(request.idempotencyKey);

  if (existing) {
    if (existing.planId !== request.planId || existing.approverId !== request.approverId) {
      throw new RebacLocalAppError(
        409,
        "IDEMPOTENCY_KEY_REUSED",
        "Idempotency-Key was already used for a different provisioning job request."
      );
    }

    return existing;
  }

  const plan = app.store.getProvisioningPlan(request.planId);

  if (!plan) {
    return undefined;
  }

  const connector = getConnector(app, plan.connectorId);
  const startedAt = app.now();
  const jobId = `job:${sha256({ planId: request.planId, idempotencyKey: request.idempotencyKey }).slice(0, 24)}`;
  const requestedMode = request.mode ?? plan.mode;

  if (requestedMode !== plan.mode) {
    throw new RebacLocalAppError(400, "PROVISIONING_MODE_MISMATCH", `Plan ${plan.id} is ${plan.mode}, not ${requestedMode}.`);
  }

  if (requestedMode === "enforcement") {
    return createControlledEnforcementJob(app, connector, plan, {
      ...request,
      jobId,
      startedAt
    });
  }

  const verification = await buildDryRunVerification(connector, plan, app.now);
  const completedAt = verification.checkedAt ?? app.now();
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

async function createControlledEnforcementJob(
  app: RebacLocalApp,
  connector: ConnectorAdapter,
  plan: ProvisioningPlan,
  request: {
    planId: string;
    approverId: string;
    idempotencyKey: string;
    jobId: string;
    startedAt: string;
    approval?: ProvisioningApproval;
    control?: EnforcementControl;
  }
): Promise<ProvisioningJob> {
  assertJobControlsMatchPlan(plan, request.approval, request.control);
  const approval = request.approval ?? plan.approval;
  const control = request.control ?? plan.control;
  assertControlledEnforcementAllowed(app, connector, approval, control, request.approverId);

  const appliedPlan = await connector.applyProvisioningChange(plan);
  const completedAt = app.now();
  const verification = await buildEnforcementVerification(connector, appliedPlan, completedAt);
  const completed = appliedPlan.status === "applied" && verification.status === "verified";
  const actionResults = plan.actions.map((action): ProvisioningActionResult => ({
    actionId: action.actionId,
    operation: action.operation,
    status: completed ? "applied" : "failed",
    dryRun: false,
    idempotencyKey: action.idempotencyKey,
    message: completed
      ? "Controlled synthetic enforcement executed through the mock connector and verified by readback."
      : "Controlled enforcement did not verify; rollback or compensation is required.",
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
    id: request.jobId,
    planId: plan.id,
    connectorId: plan.connectorId,
    mode: "enforcement",
    dryRun: false,
    status: completed ? "completed" : "failed",
    approverId: request.approverId,
    idempotencyKey: request.idempotencyKey,
    actionResults,
    verification,
    auditEventIds: [],
    approval,
    control,
    version: "provisioning-job:v1",
    createdAt: request.startedAt,
    startedAt: request.startedAt,
    completedAt
  };
  const auditEventIds = [
    ...actionResults.map((result) =>
      recordAudit(app, {
        eventType: "connector.permission_changed",
        actor: app.actor,
        subjectId: plan.subjectId,
        resourceId: plan.resourceId,
        correlationId: `corr:${request.jobId}:${result.actionId}:permission-changed`,
        payload: {
          jobId: request.jobId,
          planId: plan.id,
          connectorId: plan.connectorId,
          actionId: result.actionId,
          operation: result.operation,
          dryRun: false,
          syntheticProviderWrite: true,
          liveProviderWrite: false,
          providerWrite: false,
          approval,
          control
        }
      }).eventId
    ),
    recordAudit(app, {
      eventType: "provisioning.verified",
      actor: app.actor,
      subjectId: plan.subjectId,
      resourceId: plan.resourceId,
      correlationId: `corr:${request.jobId}:verified`,
      payload: {
        jobId: request.jobId,
        planId: plan.id,
        connectorId: plan.connectorId,
        verification
      }
    }).eventId
  ];

  if (!completed) {
    auditEventIds.push(...recordRollbackPlannedAudit(app, request.jobId, plan));
  }

  auditEventIds.push(
    recordAudit(app, {
      eventType: completed ? "provisioning.completed" : "provisioning.failed",
      actor: app.actor,
      subjectId: plan.subjectId,
      resourceId: plan.resourceId,
      correlationId: `corr:${request.jobId}:${completed ? "completed" : "failed"}`,
      payload: asJsonRecord(jobWithoutAuditIds)
    }).eventId
  );

  const job = { ...jobWithoutAuditIds, auditEventIds };
  app.store.upsertProvisioningPlan({ ...plan, status: completed ? "applied" : "failed", updatedAt: completedAt });
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

function planMatchesDecisionRequest(
  plan: ProvisioningPlan,
  request: DecisionRequest,
  connectorId: string,
  options: ProvisioningExecutionOptions
): boolean {
  return (
    plan.connectorId === connectorId &&
    plan.subjectId === request.subjectId &&
    plan.resourceId === request.resourceId &&
    plan.action === request.action &&
    planMatchesExecutionOptions(plan, options)
  );
}

function planMatchesRevocationRequest(
  plan: ProvisioningPlan,
  nativeGrantId: string,
  connectorId: string,
  options: ProvisioningExecutionOptions
): boolean {
  return (
    plan.connectorId === connectorId &&
    plan.actions.some((action) => action.operation === "revoke" && action.requestedState.nativeGrantId === nativeGrantId) &&
    planMatchesExecutionOptions(plan, options)
  );
}

function planMatchesExecutionOptions(plan: ProvisioningPlan, options: ProvisioningExecutionOptions): boolean {
  return (
    plan.mode === (options.mode ?? "dry_run") &&
    JSON.stringify(plan.approval ?? null) === JSON.stringify(options.approval ?? null) &&
    JSON.stringify(plan.control ?? null) === JSON.stringify(options.control ?? null)
  );
}

function prepareProvisioningPlan(
  app: RebacLocalApp,
  connector: ConnectorAdapter,
  plan: ProvisioningPlan,
  options: ProvisioningExecutionOptions
): ProvisioningPlan {
  const mode = options.mode ?? "dry_run";

  if (mode === "dry_run") {
    return {
      ...plan,
      mode,
      status: "planned",
      actions: plan.actions.map((action) => ({
        ...action,
        dryRun: true,
        status: "planned"
      }))
    };
  }

  assertControlledEnforcementAllowed(app, connector, options.approval, options.control, options.approval?.approverId);
  return {
    ...plan,
    mode,
    status: "approved",
    actions: plan.actions.map((action) => ({
      ...action,
      dryRun: false,
      status: "planned"
    })),
    approval: options.approval,
    control: options.control
  };
}

function assertControlledEnforcementAllowed(
  app: RebacLocalApp,
  connector: ConnectorAdapter,
  approval: ProvisioningApproval | undefined,
  control: EnforcementControl | undefined,
  approverId: string | undefined
): asserts approval is ProvisioningApproval {
  if (!approval) {
    throw new RebacLocalAppError(
      400,
      "CONTROLLED_ENFORCEMENT_APPROVAL_REQUIRED",
      "Controlled enforcement requires an approved change ticket."
    );
  }

  if (!control) {
    throw new RebacLocalAppError(
      400,
      "CONTROLLED_ENFORCEMENT_CONTROL_REQUIRED",
      "Controlled enforcement requires explicit synthetic-only control settings."
    );
  }

  if (approval.decision !== "approved" || !approval.approverId || !approval.changeTicket || !approval.approvedAt) {
    throw new RebacLocalAppError(
      400,
      "CONTROLLED_ENFORCEMENT_APPROVAL_INVALID",
      "Controlled enforcement approval must include decision, approverId, changeTicket, and approvedAt."
    );
  }

  if (approverId && approval.approverId !== approverId) {
    throw new RebacLocalAppError(
      400,
      "CONTROLLED_ENFORCEMENT_APPROVER_MISMATCH",
      "The job approverId must match the approved change ticket."
    );
  }

  if (approval.expiresAt && Date.parse(approval.expiresAt) <= Date.parse(app.now())) {
    throw new RebacLocalAppError(
      400,
      "CONTROLLED_ENFORCEMENT_APPROVAL_EXPIRED",
      "Controlled enforcement approval has expired."
    );
  }

  if (!control.syntheticOnly || control.liveProviderWrites || control.breakGlass) {
    throw new RebacLocalAppError(
      403,
      "CONTROLLED_ENFORCEMENT_GUARDRAIL_REQUIRED",
      "Phase 4 enforcement must be synthetic-only, must not allow live provider writes, and must not use break-glass."
    );
  }

  if (control.incidentMode) {
    throw new RebacLocalAppError(
      409,
      "CONTROLLED_ENFORCEMENT_INCIDENT_MODE_BLOCKED",
      "Controlled enforcement is blocked while incident mode is active."
    );
  }

  if (!connector.capabilities.supportsProvisioning) {
    throw new RebacLocalAppError(403, "CONNECTOR_ENFORCEMENT_DISABLED", `${connector.id} does not support provisioning.`);
  }

  if (connector.provider !== "mock" || connector.tenantBoundary !== "synthetic:local") {
    throw new RebacLocalAppError(
      403,
      "CONNECTOR_ENFORCEMENT_NOT_ALLOWED",
      "Phase 4 controlled enforcement is limited to the synthetic mock connector."
    );
  }
}

function assertJobControlsMatchPlan(
  plan: ProvisioningPlan,
  approval: ProvisioningApproval | undefined,
  control: EnforcementControl | undefined
): void {
  if (approval && plan.approval && JSON.stringify(approval) !== JSON.stringify(plan.approval)) {
    throw new RebacLocalAppError(
      400,
      "CONTROLLED_ENFORCEMENT_APPROVAL_MISMATCH",
      "The job approval must match the approved provisioning plan."
    );
  }

  if (control && plan.control && JSON.stringify(control) !== JSON.stringify(plan.control)) {
    throw new RebacLocalAppError(
      400,
      "CONTROLLED_ENFORCEMENT_CONTROL_MISMATCH",
      "The job control settings must match the approved provisioning plan."
    );
  }
}

function recordPlanApprovalAudit(app: RebacLocalApp, plan: ProvisioningPlan): void {
  if (plan.mode !== "enforcement" || !plan.approval || !plan.control) {
    return;
  }

  recordAudit(app, {
    eventType: "provisioning.approved",
    actor: app.actor,
    subjectId: plan.subjectId,
    resourceId: plan.resourceId,
    correlationId: `corr:${plan.id}:approved`,
    payload: {
      planId: plan.id,
      connectorId: plan.connectorId,
      mode: plan.mode,
      status: plan.status,
      approval: plan.approval,
      control: plan.control
    }
  });
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

function recordRollbackPlannedAudit(app: RebacLocalApp, jobId: string, plan: ProvisioningPlan): string[] {
  return plan.actions
    .filter((action) => action.compensation)
    .map((action) =>
      recordAudit(app, {
        eventType: "provisioning.rollback_planned",
        actor: app.actor,
        subjectId: plan.subjectId,
        resourceId: plan.resourceId,
        correlationId: `corr:${jobId}:${action.actionId}:rollback-planned`,
        payload: {
          jobId,
          planId: plan.id,
          actionId: action.actionId,
          compensation: action.compensation
        }
      }).eventId
    );
}

async function buildDryRunVerification(
  connector: ConnectorAdapter,
  plan: ProvisioningPlan,
  now: () => string
): Promise<ProvisioningVerification> {
  const verified = await connector.verifyProvisioningChange(plan);
  const checkedAt = now();

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

async function buildEnforcementVerification(
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
        actionCount: plan.actions.length,
        mode: "enforcement"
      },
      readbackState: {
        dryRun: false,
        providerWrite: false,
        syntheticProviderWrite: true,
        liveProviderWrite: false,
        verificationHook: true
      },
      checkedAt,
      message: "Controlled synthetic enforcement verified; no live provider mutation occurred."
    };
  }

  return {
    status: "failed",
    method: "connector.verifyProvisioningChange",
    expectedState: {
      planId: plan.id,
      actionCount: plan.actions.length,
      mode: "enforcement"
    },
    readbackState: {
      dryRun: false,
      providerWrite: false,
      syntheticProviderWrite: false,
      liveProviderWrite: false,
      verificationHook: false
    },
    checkedAt,
    message: "Controlled enforcement verification failed; compensation must be reviewed before retry."
  };
}
