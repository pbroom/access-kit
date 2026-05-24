import {
  AuditRecorder,
  createLocalEngineSeed,
  InMemoryRebacStore,
  RebacDecisionEngine,
  sha256,
  stableStringify,
  verifyAuditChain,
  type AccessReviewEvidence,
  type AuditEvent,
  type AuditEventExport,
  type AuditEventExportTarget,
  type AuditEventRepository,
  type AuditIntegrityReport,
  type AuditEventInput,
  type ControlImplementationStatement,
  type ConMonMetric,
  type ConnectorAdapter,
  type ConnectorHealthCheck,
  type DataFlowEvidence,
  type DecisionRequest,
  type DecisionResult,
  type DiscoveryRun,
  type EnforcementControl,
  type EnforcementReadinessCheck,
  type EnforcementReadinessReport,
  type EvidenceArtifact,
  type EvidenceExportFormat,
  type EvidenceControlMapping,
  type EvidenceExport,
  type EvidenceFramework,
  type EvidencePackageRepository,
  type EvidenceStorageReceipt,
  type ExceptionRecord,
  type JsonRecord,
  type PoamItem,
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
  type RebacGraphRepository,
  type RebacJobRepository,
  type RebacSeedData,
  type RebacStateRepository,
  type SystemBoundaryEvidence,
  type Subject
} from "@access-kit/core";
import {
  RebacLocalAppError,
  normalizeRuntimePersistence,
  type RebacLocalApp,
  type RebacLocalAppOptions,
  type RebacPersistenceDegradation,
  type RebacRuntimePersistence
} from "./runtime-app.js";
import { createRuntimeConnectors } from "./runtime-connectors.js";
import {
  buildEvidenceArtifacts,
  buildOperationalEvidence,
  getControlImplementationDefinition
} from "./runtime-evidence.js";
import { changeTicketMatches } from "./runtime-provisioning.js";
export { RebacLocalAppError, type RebacLocalApp, type RebacLocalAppOptions, type RebacPersistenceDegradation, type RebacRuntimePersistence } from "./runtime-app.js";
export { isSafeChangeTicketPattern } from "./runtime-provisioning.js";

interface RecordAuditOptions {
  occurredAt?: string;
  persistState?: boolean;
}

type RebacGraphSnapshot = ReturnType<RebacGraphRepository["exportGraph"]>;
type RebacJobSnapshot = ReturnType<RebacJobRepository["exportJobs"]>;

const appRecordSequences = new WeakMap<RebacLocalApp, Map<string, number>>();

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
  readinessReportId?: string;
}

interface EvidenceExportOptions {
  framework?: EvidenceFramework;
  periodStart?: string;
  periodEnd?: string;
}

interface AuditEventExportOptions {
  periodStart?: string;
  periodEnd?: string;
  target?: AuditEventExportTarget;
}

export interface EnforcementReadinessRequest {
  mode?: "enforcement";
  control: EnforcementControl;
  requiredApproverRole?: string;
  changeTicketPattern?: string;
}

const CHANGE_TICKET_PATTERN_MAX_LENGTH = 128;
const CHANGE_TICKET_VALUE_MAX_LENGTH = 256;
const MAX_PERSISTENCE_DEGRADATIONS = 20;

export function createRebacLocalApp(options: RebacLocalAppOptions = {}): RebacLocalApp {
  const now = options.now ?? (() => new Date().toISOString());
  const actor = options.actor ?? "service:api";
  const persistence = normalizeRuntimePersistence(options);
  const persistenceDegradations: RebacPersistenceDegradation[] = [];
  const persistedGraph = persistence.graphRepository?.exportGraph();
  const persistedJobs = persistence.jobRepository?.exportJobs();
  const seed = initialRuntimeSeed(persistence, options.seed ?? createLocalEngineSeed(), persistedGraph, persistedJobs);
  const store = new InMemoryRebacStore(seed);
  seedEmptyRuntimeRepositories(persistence, store, persistenceDegradations, now, persistedGraph, persistedJobs);
  const auditRecorder = new AuditRecorder(initialAuditEvents(persistence, store));
  const engine = new RebacDecisionEngine(store, {
    now,
    actor,
    auditRecorder,
    onAuditEvent: (event) => {
      const priorStoreAuditEvents = persistence.stateRepository ? store.listAuditEvents().slice(0, -1) : undefined;
      appendAuditEvent(persistence.auditRepository, event, event.occurredAt, priorStoreAuditEvents, persistenceDegradations);
      persistStoreSnapshot(persistence.stateRepository, store, event.occurredAt, persistenceDegradations);
    }
  });
  const connectors = createRuntimeConnectors();

  return {
    store,
    engine,
    auditRecorder,
    persistence,
    persistenceDegradations,
    graphRepository: persistence.graphRepository,
    jobRepository: persistence.jobRepository,
    stateRepository: persistence.stateRepository,
    auditRepository: persistence.auditRepository,
    evidenceRepository: persistence.evidenceRepository,
    connectors,
    now,
    actor
  };
}

export function checkDecision(app: RebacLocalApp, request: DecisionRequest): ReturnType<RebacDecisionEngine["check"]> {
  const decision = app.engine.check(request);
  persistJobDecision(app, decision);
  return decision;
}

export function explainDecision(app: RebacLocalApp, request: DecisionRequest): ReturnType<RebacDecisionEngine["explain"]> {
  const decision = app.engine.explain(request);
  persistJobDecision(app, decision);
  return decision;
}

export function createSubject(app: RebacLocalApp, subject: Subject): Subject {
  const saved = app.store.upsertSubject(subject);
  const event = recordAudit(app, {
    eventType: "subject.created",
    actor: app.actor,
    subjectId: saved.id,
    correlationId: `corr:${saved.id}:${saved.version}`,
    payload: asJsonRecord(saved)
  });
  persistGraphSubject(app, saved, event.occurredAt);
  return saved;
}

export function createResource(app: RebacLocalApp, resource: Resource): Resource {
  const saved = app.store.upsertResource(resource);
  const event = recordAudit(app, {
    eventType: "resource.discovered",
    actor: app.actor,
    resourceId: saved.id,
    correlationId: `corr:${saved.id}:${saved.version}`,
    payload: asJsonRecord(saved)
  });
  persistGraphResource(app, saved, event.occurredAt);
  return saved;
}

export function putRelationship(app: RebacLocalApp, relationship: RelationshipTuple): RelationshipTuple {
  const saved = app.store.upsertRelationship(relationship);
  const event = recordAudit(app, {
    eventType: "relationship.created",
    actor: app.actor,
    subjectId: saved.subjectId,
    resourceId: saved.objectId,
    correlationId: `corr:${saved.id}:${saved.version}`,
    payload: asJsonRecord(saved)
  });
  persistGraphRelationship(app, saved, event.occurredAt);
  return saved;
}

export function deleteRelationship(app: RebacLocalApp, relationshipId: string): RelationshipTuple | undefined {
  const deleted = app.store.deleteRelationship(relationshipId, app.now());

  if (deleted) {
    const event = recordAudit(app, {
      eventType: "relationship.deleted",
      actor: app.actor,
      subjectId: deleted.subjectId,
      resourceId: deleted.objectId,
      correlationId: `corr:${deleted.id}:deleted`,
      payload: asJsonRecord(deleted)
    });
    persistGraphRelationship(app, deleted, event.occurredAt);
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
  const runSequence = nextAppRecordSequence(app, `discovery:${connectorId}`, app.store.listDiscoveryRuns({ connectorId }).length);
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
  }, { persistState: false });

  const completedRun = { ...run, auditEventIds: [auditEvent.eventId] };
  app.store.recordDiscoveryRun(completedRun);
  persistAppState(app, completedAt);
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

export async function checkEnforcementReadiness(
  app: RebacLocalApp,
  connectorId: string,
  request: EnforcementReadinessRequest
): Promise<EnforcementReadinessReport> {
  const connector = getConnector(app, connectorId);
  const checkedAt = app.now();
  const control = request.control;
  const checks = await buildEnforcementReadinessChecks(connector, control, checkedAt);
  const reportId = createEnforcementReadinessReportId(app, connectorId, checkedAt);
  const reportWithoutAuditIds: EnforcementReadinessReport = {
    id: reportId,
    connectorId,
    provider: connector.provider ?? connector.id,
    tenantBoundary: connector.tenantBoundary ?? "synthetic:unknown",
    mode: "enforcement",
    status: checks.some((check) => check.status === "fail") ? "blocked" : "ready",
    checkedAt,
    control,
    checks,
    requiredApproverRole: request.requiredApproverRole ?? "access-approver",
    changeTicketPattern: request.changeTicketPattern ?? "^chg:[a-z0-9_:-]+$",
    liveProviderWritesAllowed: false,
    auditEventIds: [],
    version: "enforcement-readiness:v1",
    createdAt: checkedAt
  };
  const auditEvent = recordAudit(app, {
    eventType: "connector.enforcement_readiness_checked",
    actor: app.actor,
    correlationId: `corr:${reportId}`,
    payload: asJsonRecord(reportWithoutAuditIds)
  }, { persistState: false });
  const report = { ...reportWithoutAuditIds, auditEventIds: [auditEvent.eventId] };
  app.store.recordEnforcementReadinessReport(report);
  persistAppState(app, checkedAt);
  return report;
}

function createEnforcementReadinessReportId(app: RebacLocalApp, connectorId: string, checkedAt: string): string {
  const reports = app.store.listEnforcementReadinessReports({ connectorId });
  const sequence = nextAppRecordSequence(app, `readiness:${connectorId}`, reports.length);
  return `readiness:${connectorId}:${compactTimestamp(checkedAt)}:${sequence}`;
}

export function listEnforcementReadinessReports(
  app: RebacLocalApp,
  connectorId: string,
  status?: EnforcementReadinessReport["status"]
): EnforcementReadinessReport[] {
  getConnector(app, connectorId);
  return app.store.listEnforcementReadinessReports({ connectorId, status });
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
  persistJobDecision(app, decision);
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
  persistJobProvisioningPlan(app, plan, plan.createdAt);
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
  persistJobProvisioningPlan(app, plan, plan.createdAt);
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
  app.store.upsertProvisioningJob(jobWithoutAuditIds);
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
  persistJobProvisioningJob(app, job, completedAt);
  persistAppState(app, completedAt);
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
  assertEnforcementReadiness(app, plan.connectorId, plan.readinessReportId, approval, control);

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
  app.store.upsertProvisioningPlan({ ...plan, status: completed ? "applied" : "failed", updatedAt: completedAt });
  app.store.upsertProvisioningJob(jobWithoutAuditIds);
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
  app.store.upsertProvisioningJob(job);
  persistJobProvisioningPlan(app, { ...plan, status: completed ? "applied" : "failed", updatedAt: completedAt }, completedAt);
  persistJobProvisioningJob(app, job, completedAt);
  persistAppState(app, completedAt);
  return job;
}

export function getProvisioningJob(app: RebacLocalApp, jobId: string): ProvisioningJob | undefined {
  return app.store.getProvisioningJob(jobId);
}

export async function runReconciliation(app: RebacLocalApp, connectorId: string): Promise<ReconciliationRun> {
  const connector = getConnector(app, connectorId);
  const startedAt = app.now();
  const existingRuns = app.store.listReconciliationRuns().filter((run) => run.connectorId === connectorId).length;
  const runSequence = nextAppRecordSequence(app, `reconciliation:${connectorId}`, existingRuns);
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
  }, { persistState: false });
  const completedRun = { ...run, auditEventIds: [...auditEventIds, completedEvent.eventId] };
  app.store.recordReconciliationRun(completedRun);
  persistAppState(app, completedAt);
  return completedRun;
}

export function exportEvidence(app: RebacLocalApp, controls: string[], format: EvidenceExport["format"]): EvidenceExport {
  return exportEvidencePackage(app, controls, format, {});
}

export function exportAuditEvents(app: RebacLocalApp, options: AuditEventExportOptions = {}): AuditEventExport {
  const generatedAt = app.now();
  const allEvents = authoritativeAuditEvents(app);
  const periodStart = options.periodStart ?? allEvents
    .map((event) => event.occurredAt)
    .sort()
    .at(0) ?? generatedAt;
  const periodEnd = options.periodEnd ?? generatedAt;
  const events = allEvents.filter((event) => event.occurredAt >= periodStart && event.occurredAt <= periodEnd);
  const auditIntegrity = verifyAuditChain(allEvents, generatedAt);
  const exportMetadata: AuditEventExport = {
    exportId: `audit-export:${compactTimestamp(generatedAt)}`,
    generatedAt,
    periodStart,
    periodEnd,
    format: "jsonl",
    target: options.target ?? "operator_download",
    schemaVersion: "audit-event:v1",
    includesPayloadHashes: true,
    exportedEventCount: events.length,
    sourceEventIds: events.map((event) => event.eventId),
    records: events.map((event) => stableStringify(event)),
    auditIntegrity,
    version: "audit-event-export:v1"
  };

  recordAudit(app, {
    eventType: "audit.exported",
    actor: app.actor,
    correlationId: `corr:${exportMetadata.exportId}`,
    payload: asJsonRecord({
      exportId: exportMetadata.exportId,
      periodStart: exportMetadata.periodStart,
      periodEnd: exportMetadata.periodEnd,
      format: exportMetadata.format,
      target: exportMetadata.target,
      exportedEventCount: exportMetadata.exportedEventCount,
      sourceEventIds: exportMetadata.sourceEventIds,
      auditIntegrityStatus: exportMetadata.auditIntegrity.status,
      version: exportMetadata.version
    })
  });

  return exportMetadata;
}

export function exportEvidencePackage(
  app: RebacLocalApp,
  controls: string[],
  format: EvidenceExportFormat,
  options: EvidenceExportOptions = {}
): EvidenceExport {
  const generatedAt = app.now();
  const allEvents = app.store.listAuditEvents();
  const periodStart = options.periodStart ?? allEvents
    .map((event) => event.occurredAt)
    .sort()
    .at(0) ?? generatedAt;
  const periodEnd = options.periodEnd ?? generatedAt;
  const events = allEvents.filter((event) => event.occurredAt >= periodStart && event.occurredAt <= periodEnd);
  const auditIntegrity = verifyAuditChain(allEvents, generatedAt);
  const controlMappings = buildControlMappings(controls, events);
  const conmonMetrics = buildConMonMetrics(app, events, auditIntegrity);
  const poamItems = buildPoamItems(controlMappings, auditIntegrity, generatedAt);
  const systemBoundary = buildSystemBoundary(app);
  const dataFlows = buildDataFlows(app);
  const accessReviews = buildAccessReviews(app, events, generatedAt);
  const exceptionRegister = buildExceptionRegister(app, generatedAt);
  const operationalEvidence = buildOperationalEvidence(generatedAt);
  const artifacts = buildEvidenceArtifacts(format, events.length);
  const exportMetadata: EvidenceExport = {
    exportId: `evidence:${generatedAt.replaceAll(/[^0-9a-z]/gi, "").toLowerCase()}`,
    framework: options.framework ?? "nist-800-53",
    controls,
    periodStart,
    periodEnd,
    generatedAt,
    evidenceTypes: [
      "audit_events",
      "decision_logs",
      "provisioning_plans",
      "drift_findings",
      "audit_integrity",
      "control_mappings",
      "conmon_metrics",
      "poam_items",
      "siem_export",
      "system_boundary",
      "data_flows",
      "control_statements",
      "access_reviews",
      "exception_register",
      "operational_evidence"
    ],
    sourceEventIds: events.map((event) => event.eventId),
    responsibleRole: "ISSO",
    format,
    auditIntegrity,
    controlMappings,
    artifacts,
    conmonMetrics,
    poamItems,
    siemExport: {
      format: "jsonl",
      eventCount: events.length,
      schemaVersion: "audit-event:v1",
      includesPayloadHashes: true,
      target: "operator_download"
    },
    systemBoundary,
    dataFlows,
    controlStatements: buildControlStatements(controlMappings, artifacts, generatedAt),
    accessReviews,
    exceptionRegister,
    operationalEvidence
  };

  const evidenceEvent = recordAudit(app, {
    eventType: "evidence.generated",
    actor: app.actor,
    correlationId: `corr:${exportMetadata.exportId}`,
    payload: asJsonRecord(exportMetadata)
  });

  const storageReceipt = writeEvidenceExport(
    app.evidenceRepository,
    exportMetadata,
    evidenceEvent.occurredAt,
    app.persistenceDegradations
  );
  return storageReceipt ? { ...exportMetadata, storageReceipt } : exportMetadata;
}

export function verifyAuditIntegrity(app: RebacLocalApp): AuditIntegrityReport {
  const report = verifyAuditChain(authoritativeAuditEvents(app), app.now());
  const auditEvent = recordAudit(app, {
    eventType: "audit.integrity_verified",
    actor: app.actor,
    correlationId: `corr:audit-integrity:${compactTimestamp(report.verifiedAt)}`,
    payload: asJsonRecord(report)
  });

  return {
    ...report,
    auditEventId: auditEvent.eventId
  };
}

export function recordAudit(app: RebacLocalApp, input: AuditEventInput, options: RecordAuditOptions = {}): AuditEvent {
  const event = app.auditRecorder.record(input, options.occurredAt ?? app.now());
  const priorStoreAuditEvents = app.persistence.stateRepository ? app.store.listAuditEvents() : undefined;
  app.store.recordAuditEvent(event);
  appendAuditEvent(app.persistence.auditRepository, event, event.occurredAt, priorStoreAuditEvents, app.persistenceDegradations);
  if (options.persistState ?? true) {
    persistAppState(app, event.occurredAt);
  }
  return event;
}

function appendAuditEvent(
  repository: AuditEventRepository | undefined,
  event: AuditEvent,
  storedAt: string,
  expectedPriorEvents: AuditEvent[] | undefined,
  degradations: RebacPersistenceDegradation[]
): void {
  try {
    if (repository && expectedPriorEvents && !auditRepositoryMatches(repository, expectedPriorEvents)) {
      recordPersistenceDegradation(degradations, {
        component: "audit",
        operation: "appendAuditEvent",
        occurredAt: storedAt,
        message: "Audit repository did not match the authoritative runtime snapshot; append was skipped."
      });
      return;
    }

    repository?.appendAuditEvent(event, storedAt);
  } catch (error) {
    recordPersistenceDegradation(degradations, {
      component: "audit",
      operation: "appendAuditEvent",
      occurredAt: storedAt,
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

function initialRuntimeSeed(
  persistence: RebacRuntimePersistence,
  fallbackSeed: RebacSeedData,
  graph: RebacGraphSnapshot | undefined,
  jobs: RebacJobSnapshot | undefined
): RebacSeedData {
  const baseSeed = persistence.stateRepository?.readState() ?? fallbackSeed;

  return {
    ...baseSeed,
    ...(graph && shouldUsePersistedGraph(graph, baseSeed)
      ? {
          subjects: graph.subjects,
          resources: graph.resources,
          relationships: graph.relationships,
          nativeGrants: graph.nativeGrants
        }
      : {}),
    ...(jobs && shouldUsePersistedJobs(jobs, baseSeed)
      ? {
          provisioningPlans: jobs.provisioningPlans,
          provisioningJobs: jobs.provisioningJobs,
          decisions: jobs.decisions
        }
      : {})
  };
}

function shouldUsePersistedGraph(graph: RebacGraphSnapshot, baseSeed: RebacSeedData): boolean {
  return hasPersistedGraphRecords(graph)
    && containsAllById(graph.subjects, baseSeed.subjects)
    && containsAllById(graph.resources, baseSeed.resources)
    && containsAllById(graph.relationships, baseSeed.relationships)
    && containsAllById(graph.nativeGrants, baseSeed.nativeGrants);
}

function hasPersistedGraphRecords(graph: RebacGraphSnapshot): boolean {
  return graph.subjects.length > 0
    || graph.resources.length > 0
    || graph.relationships.length > 0
    || graph.nativeGrants.length > 0;
}

function shouldUsePersistedJobs(jobs: RebacJobSnapshot, baseSeed: RebacSeedData): boolean {
  return hasPersistedRuntimeJobRecords(jobs)
    && containsAllById(jobs.discoveryRuns, baseSeed.discoveryRuns)
    && containsAllById(jobs.enforcementReadinessReports, baseSeed.enforcementReadinessReports)
    && containsAllById(jobs.provisioningPlans, baseSeed.provisioningPlans)
    && containsAllById(jobs.provisioningJobs, baseSeed.provisioningJobs)
    && containsAllById(jobs.driftFindings, baseSeed.driftFindings)
    && containsAllById(jobs.reconciliationRuns, baseSeed.reconciliationRuns)
    && containsAllByKey(jobs.decisions, baseSeed.decisions, "decisionId");
}

function hasPersistedRuntimeJobRecords(jobs: RebacJobSnapshot): boolean {
  return jobs.provisioningPlans.length > 0
    || jobs.provisioningJobs.length > 0
    || jobs.decisions.length > 0;
}

function containsAllById<T extends { id: string }>(persisted: readonly T[], seeded: readonly T[] | undefined): boolean {
  return containsAllByKey(persisted, seeded, "id");
}

function containsAllByKey<T extends Record<K, string>, K extends keyof T>(
  persisted: readonly T[],
  seeded: readonly T[] | undefined,
  key: K
): boolean {
  if (!seeded || seeded.length === 0) {
    return true;
  }

  const persistedKeys = new Set(persisted.map((item) => item[key]));
  return seeded.every((item) => persistedKeys.has(item[key]));
}

function seedEmptyRuntimeRepositories(
  persistence: RebacRuntimePersistence,
  store: InMemoryRebacStore,
  degradations: RebacPersistenceDegradation[],
  now: () => string,
  persistedGraph: RebacGraphSnapshot | undefined,
  persistedJobs: RebacJobSnapshot | undefined
): void {
  const seed = store.exportSeedData();

  try {
    if (persistence.graphRepository && persistedGraph && !hasPersistedGraphRecords(persistedGraph)) {
      seed.subjects?.forEach((subject) => persistence.graphRepository?.upsertSubject(subject));
      seed.resources?.forEach((resource) => persistence.graphRepository?.upsertResource(resource));
      seed.relationships?.forEach((relationship) => persistence.graphRepository?.upsertRelationship(relationship));
      seed.nativeGrants?.forEach((grant) => persistence.graphRepository?.upsertNativeGrant(grant));
    }
  } catch (error) {
    recordPersistenceRepositoryError(degradations, "graph", "seedRuntimeRepository", now(), error);
  }

  try {
    if (persistence.jobRepository && persistedJobs && !hasPersistedRuntimeJobRecords(persistedJobs)) {
      seed.provisioningPlans?.forEach((plan) => persistence.jobRepository?.upsertProvisioningPlan(plan));
      seed.provisioningJobs?.forEach((job) => persistence.jobRepository?.upsertProvisioningJob(job));
      seed.decisions?.forEach((decision) => persistence.jobRepository?.recordDecision(decision));
    }
  } catch (error) {
    recordPersistenceRepositoryError(degradations, "job", "seedRuntimeRepository", now(), error);
  }
}

function recordPersistenceRepositoryError(
  degradations: RebacPersistenceDegradation[],
  component: RebacPersistenceDegradation["component"],
  operation: string,
  occurredAt: string,
  error: unknown
): void {
  recordPersistenceDegradation(degradations, {
    component,
    operation,
    occurredAt,
    message: error instanceof Error ? error.message : String(error)
  });
}

function initialAuditEvents(persistence: RebacRuntimePersistence, store: InMemoryRebacStore): AuditEvent[] {
  if (persistence.stateRepository) {
    return store.listAuditEvents();
  }

  return persistence.auditRepository?.listAuditEvents() ?? store.listAuditEvents();
}

function authoritativeAuditEvents(app: RebacLocalApp): AuditEvent[] {
  if (app.stateRepository) {
    return app.store.listAuditEvents();
  }

  return app.auditRepository?.listAuditEvents() ?? app.store.listAuditEvents();
}

function auditRepositoryMatches(repository: AuditEventRepository, expectedEvents: AuditEvent[]): boolean {
  const storedEvents = repository.listAuditEvents();

  return storedEvents.length === expectedEvents.length
    && storedEvents.every((event, index) => stableStringify(event) === stableStringify(expectedEvents[index]));
}

function persistAppState(app: RebacLocalApp, storedAt: string): void {
  persistStoreSnapshot(app.persistence.stateRepository, app.store, storedAt, app.persistenceDegradations);
}

function persistGraphSubject(app: RebacLocalApp, subject: Subject, storedAt: string): void {
  try {
    app.graphRepository?.upsertSubject(subject);
  } catch (error) {
    recordPersistenceRepositoryError(app.persistenceDegradations, "graph", "upsertSubject", storedAt, error);
  }
}

function persistGraphResource(app: RebacLocalApp, resource: Resource, storedAt: string): void {
  try {
    app.graphRepository?.upsertResource(resource);
  } catch (error) {
    recordPersistenceRepositoryError(app.persistenceDegradations, "graph", "upsertResource", storedAt, error);
  }
}

function persistGraphRelationship(app: RebacLocalApp, relationship: RelationshipTuple, storedAt: string): void {
  try {
    app.graphRepository?.upsertRelationship(relationship);
  } catch (error) {
    recordPersistenceRepositoryError(app.persistenceDegradations, "graph", "upsertRelationship", storedAt, error);
  }
}

function persistJobDecision(app: RebacLocalApp, decision: DecisionResult): void {
  try {
    app.jobRepository?.recordDecision(decision);
  } catch (error) {
    recordPersistenceRepositoryError(app.persistenceDegradations, "job", "recordDecision", decision.evaluatedAt, error);
  }
}

function persistJobProvisioningPlan(app: RebacLocalApp, plan: ProvisioningPlan, storedAt: string): void {
  try {
    app.jobRepository?.upsertProvisioningPlan(plan);
  } catch (error) {
    recordPersistenceRepositoryError(app.persistenceDegradations, "job", "upsertProvisioningPlan", storedAt, error);
  }
}

function persistJobProvisioningJob(app: RebacLocalApp, job: ProvisioningJob, storedAt: string): void {
  try {
    app.jobRepository?.upsertProvisioningJob(job);
  } catch (error) {
    recordPersistenceRepositoryError(app.persistenceDegradations, "job", "upsertProvisioningJob", storedAt, error);
  }
}

function persistStoreSnapshot(
  repository: RebacStateRepository | undefined,
  store: InMemoryRebacStore,
  storedAt: string,
  degradations: RebacPersistenceDegradation[]
): void {
  try {
    repository?.writeState(store.exportSeedData(), storedAt);
  } catch (error) {
    recordPersistenceDegradation(degradations, {
      component: "state",
      operation: "writeState",
      occurredAt: storedAt,
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

function recordPersistenceDegradation(
  degradations: RebacPersistenceDegradation[],
  degradation: RebacPersistenceDegradation
): void {
  if (degradations.length >= MAX_PERSISTENCE_DEGRADATIONS) {
    degradations.shift();
  }

  degradations.push(degradation);
}

function writeEvidenceExport(
  repository: EvidencePackageRepository | undefined,
  exportMetadata: EvidenceExport,
  storedAt: string,
  degradations: RebacPersistenceDegradation[]
): EvidenceStorageReceipt | undefined {
  try {
    return repository?.writeEvidenceExport(exportMetadata, storedAt);
  } catch (error) {
    recordPersistenceDegradation(degradations, {
      component: "evidence",
      operation: "writeEvidenceExport",
      occurredAt: storedAt,
      message: error instanceof Error ? error.message : String(error)
    });
    return undefined;
  }
}

function buildControlMappings(
  controls: string[],
  events: AuditEvent[]
): EvidenceControlMapping[] {
  return controls.map((controlId) => {
    const definition = getControlImplementationDefinition(controlId);

    if (!definition) {
      return {
        controlId,
        family: controlFamily(controlId),
        status: "planned",
        implementationSummary: "Control mapping is not yet defined for this local proof-point package.",
        evidenceTypes: [],
        sourceEventIds: [],
        gaps: ["Define implementation statement and source evidence selectors for this control."]
      };
    }

    const sourceEventIds = events
      .filter((event) => matchesAnyPrefix(event.eventType, definition.eventPrefixes))
      .map((event) => event.eventId);
    const status = sourceEventIds.length > 0 ? "implemented" : "partially_implemented";

    return {
      controlId,
      family: controlFamily(controlId),
      status,
      implementationSummary: definition.summary,
      evidenceTypes: definition.evidenceTypes,
      sourceEventIds,
      gaps: status === "implemented" ? [] : ["No matching audit events were observed for this control in the selected evidence period."]
    };
  });
}

function buildConMonMetrics(
  app: RebacLocalApp,
  events: AuditEvent[],
  auditIntegrity: AuditIntegrityReport
): ConMonMetric[] {
  const driftFindings = app.store.listDriftFindings();

  return [
    { name: "audit_events_in_period", value: events.length, unit: "count", source: "audit_log" },
    { name: "audit_chain_verified", value: auditIntegrity.status === "verified" ? 1 : 0, unit: "boolean", source: "audit_integrity" },
    { name: "audit_integrity_findings", value: auditIntegrity.findings.length, unit: "count", source: "audit_integrity" },
    { name: "allowed_decisions", value: countEvents(events, "decision.allowed"), unit: "count", source: "audit_log" },
    { name: "denied_decisions", value: countEvents(events, "decision.denied"), unit: "count", source: "audit_log" },
    { name: "provisioning_jobs", value: app.store.listProvisioningJobs().length, unit: "count", source: "provisioning_store" },
    { name: "open_drift_findings", value: driftFindings.filter((finding) => finding.status === "open").length, unit: "count", source: "drift_store" },
    {
      name: "high_or_critical_drift_findings",
      value: driftFindings.filter((finding) => finding.severity === "high" || finding.severity === "critical").length,
      unit: "count",
      source: "drift_store"
    },
    {
      name: "enforcement_readiness_reports",
      value: app.store.listEnforcementReadinessReports().length,
      unit: "count",
      source: "connector_readiness_store"
    }
  ];
}

function buildPoamItems(
  mappings: EvidenceControlMapping[],
  auditIntegrity: AuditIntegrityReport,
  generatedAt: string
): PoamItem[] {
  const plannedCompletion = addDays(generatedAt, 30);
  const items: PoamItem[] = [];

  if (auditIntegrity.status !== "verified") {
    items.push({
      id: "poam:audit-integrity",
      controlId: "AU-6",
      weakness: "Audit hash-chain verification reported one or more findings.",
      status: "open",
      ownerRole: "ISSO",
      plannedCompletion,
      source: "audit_integrity"
    });
  }

  mappings
    .filter((mapping) => mapping.status !== "implemented")
    .forEach((mapping) => {
      items.push({
        id: buildPoamControlId(mapping.controlId),
        controlId: mapping.controlId,
        weakness: mapping.gaps.at(0) ?? "Control implementation evidence is incomplete.",
        status: "planned",
        ownerRole: "ISSO",
        plannedCompletion,
        source: "control_mapping"
      });
    });

  return items;
}

function buildPoamControlId(controlId: string): string {
  const slug = controlId.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "");
  return `poam:${slug || "control"}`;
}

function buildSystemBoundary(app: RebacLocalApp): SystemBoundaryEvidence {
  const connectorComponents = [...app.connectors.values()].map((connector) => ({
    id: connectorComponentId(connector.id),
    name: `${connector.id} connector`,
    type: "connector" as const,
    trustZone: connector.provider === "mock" ? "local_runtime" as const : "synthetic_provider" as const,
    dataClassification: "synthetic",
    description: `${connector.provider ?? connector.id} adapter boundary for discovery, readback, reconciliation, and proof-point evidence.`
  }));

  return {
    boundaryId: "boundary:local-rebac-control-plane",
    name: "Local ReBAC control plane proof-point boundary",
    description: "Synthetic local runtime boundary used to prove ATO evidence package shape without live tenant data, secrets, or provider writes.",
    environment: "local_proof_point",
    liveTenantData: false,
    components: [
      {
        id: "component:operator-cli",
        name: "rebac CLI",
        type: "operator",
        trustZone: "operator_boundary",
        dataClassification: "synthetic",
        description: "Operator and assessor command surface that wraps the API contract."
      },
      {
        id: "component:api-runtime",
        name: "Local API runtime",
        type: "control_plane",
        trustZone: "local_runtime",
        dataClassification: "synthetic",
        description: "HTTP API runtime for decisions, provisioning, audit, reconciliation, and evidence export."
      },
      {
        id: "component:rebac-engine",
        name: "Deterministic ReBAC engine",
        type: "control_plane",
        trustZone: "local_runtime",
        dataClassification: "synthetic",
        description: "Non-LLM authorization engine for deterministic check and explain decisions."
      },
      {
        id: "component:local-store",
        name: "Restartable proof-point store",
        type: "data_store",
        trustZone: "local_runtime",
        dataClassification: "synthetic",
        description: "Local proof-point store for subjects, resources, relationships, native grants, jobs, findings, audit events, and optional JSON state snapshots."
      },
      {
        id: "component:local-evidence-repository",
        name: "Local file evidence repository",
        type: "data_store",
        trustZone: "local_runtime",
        dataClassification: "synthetic",
        description: "Optional JSONL/JSON proof-point repository for audit events and evidence packages; not production WORM storage."
      },
      ...connectorComponents
    ],
    externalSystems: [...new Set([...app.connectors.values()].map((connector) => connector.provider ?? connector.id))],
    assumptions: [
      "All examples are synthetic and must not include real tenant identifiers, secrets, production users, or sensitive records.",
      "Authorization decisions are deterministic and never made by an LLM.",
      "Live connector writes remain out of scope for this local Phase 5 package."
    ],
    version: "system-boundary:v1"
  };
}

function buildDataFlows(app: RebacLocalApp): DataFlowEvidence[] {
  const connectorFlows = [...app.connectors.values()].map((connector): DataFlowEvidence => ({
    id: `data-flow:api-connector:${sanitizeCanonicalId(connector.id)}`,
    name: `API to ${connector.id} connector`,
    source: "component:api-runtime",
    destination: connectorComponentId(connector.id),
    dataTypes: [
      "discovery_requests",
      "readback_requests",
      ...(connector.capabilities.supportsProvisioning ? ["dry_run_or_synthetic_enforcement_requests"] : []),
      ...(connector.capabilities.supportsReconciliation ? ["reconciliation_findings"] : [])
    ],
    protections: [
      "connector_boundary",
      connector.mode === "read_only" ? "read_only_synthetic_providers" : "controlled_enforcement_guardrails",
      connector.provider === "mock" ? "controlled_enforcement_guardrails" : "synthetic_provider_boundary"
    ],
    liveTenantData: false
  }));

  return [
    {
      id: "data-flow:cli-api",
      name: "Operator CLI to API",
      source: "component:operator-cli",
      destination: "component:api-runtime",
      dataTypes: ["operator_requests", "synthetic_subject_ids", "synthetic_resource_ids"],
      protections: ["api_contract_validation", "idempotency_keys_for_writes", "audit_event_emission"],
      liveTenantData: false
    },
    {
      id: "data-flow:api-engine",
      name: "API to deterministic ReBAC engine",
      source: "component:api-runtime",
      destination: "component:rebac-engine",
      dataTypes: ["decision_requests", "relationship_tuples", "policy_versions"],
      protections: ["deny_by_default", "versioned_decisions", "explainable_paths"],
      liveTenantData: false
    },
    {
      id: "data-flow:api-store",
      name: "API to local proof-point store",
      source: "component:api-runtime",
      destination: "component:local-store",
      dataTypes: ["inventory", "native_grants", "provisioning_jobs", "audit_events", "drift_findings"],
      protections: ["synthetic_data_only", "hash_chained_audit_events", "state_snapshot_hashes", "separate_intended_and_native_access"],
      liveTenantData: false
    },
    ...connectorFlows,
    {
      id: "data-flow:evidence-repository",
      name: "API to local evidence repository",
      source: "component:api-runtime",
      destination: "component:local-evidence-repository",
      dataTypes: ["audit_jsonl", "evidence_package_json", "storage_receipts"],
      protections: ["payload_hashes", "storage_receipts", "explicit_non_worm_flag"],
      liveTenantData: false
    }
  ];
}

function buildControlStatements(
  mappings: EvidenceControlMapping[],
  artifacts: EvidenceArtifact[],
  generatedAt: string
): ControlImplementationStatement[] {
  return mappings.map((mapping) => ({
    controlId: mapping.controlId,
    status: mapping.status,
    statement: `${mapping.implementationSummary} This statement is generated from the local synthetic Phase 5 proof-point package and requires assessor review before production use.`,
    responsibleRole: "ISSO",
    reviewerRole: "Security Control Assessor",
    reviewedAt: generatedAt,
    evidenceTypes: mapping.evidenceTypes,
    sourceArtifactNames: artifacts
      .filter((artifact) => artifactSupportsMapping(artifact, mapping))
      .map((artifact) => artifact.name),
    gaps: mapping.gaps
  }));
}

function artifactSupportsMapping(artifact: EvidenceArtifact, mapping: EvidenceControlMapping): boolean {
  if (artifact.type === "control_mapping") {
    return true;
  }

  return mapping.evidenceTypes.some((evidenceType) => artifact.name.includes(evidenceType.replaceAll("_", "-")));
}

function buildAccessReviews(app: RebacLocalApp, events: AuditEvent[], reviewedAt: string): AccessReviewEvidence[] {
  const driftFindings = app.store.listDriftFindings();
  const sourceEventIds = events
    .filter((event) => event.eventType.startsWith("decision.") || event.eventType.startsWith("relationship.") || event.eventType.startsWith("connector.current_access_read"))
    .map((event) => event.eventId);

  return [
    {
      reviewId: `access-review:${compactTimestamp(reviewedAt)}`,
      scope: "synthetic local subjects, resources, relationship tuples, native grants, and drift findings",
      reviewerRole: "Data Steward",
      status: sourceEventIds.length > 0 || driftFindings.length > 0 ? "completed" : "planned",
      reviewedAt,
      subjectCount: app.store.listSubjects().length,
      resourceCount: app.store.listResources().length,
      findingCount: driftFindings.length,
      exceptionCount: driftFindings.filter(requiresExceptionRecord).length,
      sourceEventIds,
      version: "access-review:v1"
    }
  ];
}

function buildExceptionRegister(app: RebacLocalApp, generatedAt: string): ExceptionRecord[] {
  return app.store
    .listDriftFindings()
    .filter(requiresExceptionRecord)
    .map((finding) => ({
      id: `exception:${sanitizeCanonicalId(finding.id)}`,
      subjectId: sanitizeCanonicalId(finding.subjectId),
      resourceId: sanitizeCanonicalId(finding.resourceId),
      action: "review",
      reason: `Drift finding ${finding.id} requires documented risk acceptance or remediation.`,
      status: "open",
      approverRole: "Authorizing Official",
      expiresAt: addDays(generatedAt, 30),
      reviewRequiredAt: addDays(generatedAt, 14),
      source: "drift",
      sourceFindingId: sanitizeCanonicalId(finding.id)
    }));
}

function requiresExceptionRecord(finding: { recommendedAction: string; severity: string }): boolean {
  return finding.recommendedAction === "exception" || finding.severity === "high" || finding.severity === "critical";
}

function controlFamily(controlId: string): string {
  return controlId.split("-").at(0) ?? "custom";
}

function matchesAnyPrefix(value: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => value.startsWith(prefix));
}

function countEvents(events: AuditEvent[], eventType: string): number {
  return events.filter((event) => event.eventType === eventType).length;
}

function addDays(timestamp: string, days: number): string {
  const date = new Date(timestamp);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function sanitizeCanonicalId(value: string): string {
  return value.replaceAll(/[^a-z0-9_:-]/gi, "_").toLowerCase();
}

function connectorComponentId(connectorId: string): string {
  return `component:connector:${sanitizeCanonicalId(connectorId)}`;
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

function nextAppRecordSequence(app: RebacLocalApp, key: string, existingCount: number): number {
  let sequences = appRecordSequences.get(app);

  if (!sequences) {
    sequences = new Map();
    appRecordSequences.set(app, sequences);
  }

  const sequence = Math.max(sequences.get(key) ?? 0, existingCount) + 1;
  sequences.set(key, sequence);
  return sequence;
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
    JSON.stringify(plan.control ?? null) === JSON.stringify(options.control ?? null) &&
    (plan.readinessReportId ?? null) === (options.readinessReportId ?? null)
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
  assertEnforcementReadiness(app, plan.connectorId, options.readinessReportId, options.approval, options.control);
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
    control: options.control,
    readinessReportId: options.readinessReportId
  };
}

async function buildEnforcementReadinessChecks(
  connector: ConnectorAdapter,
  control: EnforcementControl,
  checkedAt: string
): Promise<EnforcementReadinessCheck[]> {
  const provider = connector.provider ?? connector.id;
  const tenantBoundary = connector.tenantBoundary ?? "synthetic:unknown";
  const requiredReadScopes = connector.requiredReadScopes ?? [];

  return [
    {
      name: "connector_registered",
      status: "pass",
      message: `${connector.id} is registered.`,
      evidence: { connectorId: connector.id, provider, tenantBoundary }
    },
    {
      name: "synthetic_only_guardrail",
      status: control.syntheticOnly && !control.liveProviderWrites ? "pass" : "fail",
      message: "Phase 4 readiness requires synthetic-only enforcement with live provider writes disabled.",
      evidence: {
        syntheticOnly: control.syntheticOnly,
        liveProviderWrites: control.liveProviderWrites
      }
    },
    {
      name: "mock_enforcement_boundary",
      status: provider === "mock" && tenantBoundary === "synthetic:local" ? "pass" : "fail",
      message: "Phase 4 enforcement readiness is limited to the synthetic mock connector.",
      evidence: { provider, tenantBoundary }
    },
    {
      name: "provisioning_capability",
      status: connector.capabilities.supportsProvisioning ? "pass" : "fail",
      message: "Connector must declare provisioning support before enforcement can be planned.",
      evidence: { supportsProvisioning: connector.capabilities.supportsProvisioning }
    },
    {
      name: "readback_capability",
      status: connector.capabilities.supportsDiscovery && connector.capabilities.supportsReconciliation ? "pass" : "fail",
      message: "Connector must support discovery and reconciliation readback for enforcement verification.",
      evidence: {
        supportsDiscovery: connector.capabilities.supportsDiscovery,
        supportsReconciliation: connector.capabilities.supportsReconciliation,
        requiredReadScopes
      }
    },
    {
      name: "incident_mode_clear",
      status: control.incidentMode ? "fail" : "pass",
      message: "Incident mode must be clear before controlled enforcement can be planned.",
      evidence: { incidentMode: control.incidentMode }
    },
    {
      name: "break_glass_disabled",
      status: control.breakGlass ? "fail" : "pass",
      message: "Break-glass cannot be used for Phase 4 controlled enforcement readiness.",
      evidence: { breakGlass: control.breakGlass }
    },
    await buildRollbackCompensationReadinessCheck(connector, checkedAt),
    {
      name: "least_privilege_review",
      status: provider === "mock" ? "pass" : "fail",
      message: "Live connector least-privilege review remains incomplete for Phase 4.",
      evidence: {
        provider,
        requiredReadScopes,
        liveWriteScopesReviewed: false
      }
    }
  ];
}

async function buildRollbackCompensationReadinessCheck(
  connector: ConnectorAdapter,
  checkedAt: string
): Promise<EnforcementReadinessCheck> {
  try {
    const plan = await connector.planProvisioningChange(createCompensationProbeDecision(checkedAt));
    const actionsWithCompensation = plan.actions.filter(
      (action) =>
        action.compensation?.status === "planned" &&
        typeof action.compensation.idempotencyKey === "string" &&
        action.compensation.idempotencyKey.length > 0
    );
    const hasCompensation = plan.actions.length > 0 && actionsWithCompensation.length === plan.actions.length;

    return {
      name: "rollback_compensation_required",
      status: hasCompensation ? "pass" : "fail",
      message: "Provisioning plans must carry compensation intent before enforcement jobs can run.",
      evidence: {
        compensationRequired: true,
        actionCount: plan.actions.length,
        compensatedActionCount: actionsWithCompensation.length
      }
    };
  } catch (error) {
    return {
      name: "rollback_compensation_required",
      status: "fail",
      message: "Provisioning compensation readiness could not be verified.",
      evidence: { error: error instanceof Error ? error.message : "Unknown compensation probe failure" }
    };
  }
}

function createCompensationProbeDecision(evaluatedAt: string): DecisionResult {
  return {
    decisionId: "decision:enforcement-readiness-compensation-probe",
    decision: "allow",
    subjectId: "user:readiness-probe",
    action: "read",
    resourceId: "document:readiness-probe",
    reasonCode: "ALLOW_READINESS_COMPENSATION_PROBE",
    policyVersion: "readiness-probe",
    relationshipVersion: "readiness-probe",
    relationshipPath: [],
    constraints: {},
    evaluatedAt
  };
}

function assertEnforcementReadiness(
  app: RebacLocalApp,
  connectorId: string,
  readinessReportId: string | undefined,
  approval: ProvisioningApproval | undefined,
  control: EnforcementControl | undefined
): asserts readinessReportId is string {
  if (!readinessReportId) {
    throw new RebacLocalAppError(
      400,
      "ENFORCEMENT_READINESS_REQUIRED",
      "Controlled enforcement requires a ready connector readiness report."
    );
  }

  const report = app.store.getEnforcementReadinessReport(readinessReportId);
  const connector = getConnector(app, connectorId);

  if (!report) {
    throw new RebacLocalAppError(400, "ENFORCEMENT_READINESS_NOT_FOUND", `Readiness report ${readinessReportId} was not found.`);
  }

  if (report.connectorId !== connectorId) {
    throw new RebacLocalAppError(
      400,
      "ENFORCEMENT_READINESS_CONNECTOR_MISMATCH",
      "The readiness report connector must match the provisioning connector."
    );
  }

  if (report.provider !== (connector.provider ?? connector.id) || report.tenantBoundary !== (connector.tenantBoundary ?? "synthetic:unknown")) {
    throw new RebacLocalAppError(
      400,
      "ENFORCEMENT_READINESS_BOUNDARY_MISMATCH",
      "The readiness report provider boundary must match the current connector registration."
    );
  }

  if (report.status !== "ready") {
    throw new RebacLocalAppError(
      403,
      "ENFORCEMENT_READINESS_BLOCKED",
      "The connector readiness report is blocked and cannot authorize controlled enforcement."
    );
  }

  if (report.liveProviderWritesAllowed) {
    throw new RebacLocalAppError(
      403,
      "ENFORCEMENT_READINESS_LIVE_WRITES_BLOCKED",
      "Phase 4 readiness reports must not allow live provider writes."
    );
  }

  if (control && JSON.stringify(report.control) !== JSON.stringify(control)) {
    throw new RebacLocalAppError(
      400,
      "ENFORCEMENT_READINESS_CONTROL_MISMATCH",
      "The readiness report controls must match the provisioning controls."
    );
  }

  if (approval && !changeTicketMatches(report.changeTicketPattern, approval.changeTicket)) {
    throw new RebacLocalAppError(
      400,
      "ENFORCEMENT_READINESS_CHANGE_TICKET_MISMATCH",
      "The approval change ticket must match the readiness report change-ticket pattern."
    );
  }
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

  if (Number.isNaN(Date.parse(approval.approvedAt))) {
    throw new RebacLocalAppError(
      400,
      "CONTROLLED_ENFORCEMENT_APPROVAL_INVALID",
      "Controlled enforcement approval timestamps must be valid date-times."
    );
  }

  if (approval.expiresAt !== undefined) {
    const expiresAt = Date.parse(approval.expiresAt);
    const now = Date.parse(app.now());

    if (Number.isNaN(expiresAt) || Number.isNaN(now)) {
      throw new RebacLocalAppError(
        400,
        "CONTROLLED_ENFORCEMENT_APPROVAL_INVALID",
        "Controlled enforcement approval timestamps must be valid date-times."
      );
    }

    if (expiresAt <= now) {
      throw new RebacLocalAppError(
        400,
        "CONTROLLED_ENFORCEMENT_APPROVAL_EXPIRED",
        "Controlled enforcement approval has expired."
      );
    }
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
