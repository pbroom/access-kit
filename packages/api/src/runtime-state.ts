import {
  stableStringify,
  verifyAuditChain,
  type AccessReviewCampaign,
  type AuditEvent,
  type AuditEventInput,
  type AuditEventRepository,
  type AuditIntegrityReport,
  type DecisionResult,
  type DiscoveryRun,
  type DriftFinding,
  type EnforcementReadinessReport,
  type EvidenceExport,
  type EvidencePackageRepository,
  type EvidenceStorageReceipt,
  type ExceptionRequest,
  type GovernanceFinding,
  type InMemoryRebacStore,
  type NativeGrant,
  type ProvisioningJob,
  type ProvisioningPlan,
  type ReconciliationRun,
  type RelationshipTuple,
  type Resource,
  type RebacStateRepository,
  type Subject
} from "@access-kit/core";
import type { RebacLocalApp, RebacPersistenceDegradation, RebacRuntimePersistence } from "./runtime-app.js";
import { getRequestAuditActor } from "./request-audit-context.js";

export interface RecordAuditOptions {
  occurredAt?: string;
  persistState?: boolean;
}

export interface RuntimePersistenceCommitOptions {
  persistState?: boolean;
}

const MAX_PERSISTENCE_DEGRADATIONS = 20;

export function recordAudit(app: RebacLocalApp, input: AuditEventInput, options: RecordAuditOptions = {}): AuditEvent {
  const actor = getRequestAuditActor() ?? input.actor;
  const event = app.auditRecorder.record({ ...input, actor }, options.occurredAt ?? app.now());
  const priorStoreAuditEvents = app.persistence.stateRepository ? app.store.listAuditEvents() : undefined;
  app.store.recordAuditEvent(event);
  commitRuntimePersistence(app, event.occurredAt, [
    () => appendAuditEvent(app.persistence.auditRepository, event, event.occurredAt, priorStoreAuditEvents, app.persistenceDegradations)
  ], { persistState: options.persistState ?? true });
  return event;
}

export function appendAuditEvent(
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
        message: "Audit repository did not match the authoritative runtime snapshot; append was skipped.",
        version: "persistence-degradation:v1"
      });
      return;
    }

    repository?.appendAuditEvent(event, storedAt);
  } catch (error) {
    recordPersistenceDegradation(degradations, {
      component: "audit",
      operation: "appendAuditEvent",
      occurredAt: storedAt,
      message: error instanceof Error ? error.message : String(error),
      version: "persistence-degradation:v1"
    });
  }
}

export function recordPersistenceRepositoryError(
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
    message: error instanceof Error ? error.message : String(error),
    version: "persistence-degradation:v1"
  });
}

export function initialAuditEvents(persistence: RebacRuntimePersistence, store: InMemoryRebacStore): AuditEvent[] {
  if (persistence.stateRepository) {
    return store.listAuditEvents();
  }

  return persistence.auditRepository?.listAuditEvents() ?? store.listAuditEvents();
}

export function authoritativeAuditEvents(app: RebacLocalApp): AuditEvent[] {
  if (app.stateRepository) {
    return app.store.listAuditEvents();
  }

  return app.auditRepository?.listAuditEvents() ?? app.store.listAuditEvents();
}

export function verifyRuntimeAuditIntegrity(app: RebacLocalApp, verifiedAt: string): AuditIntegrityReport {
  return app.auditRepository?.verifyIntegrity(verifiedAt) ?? verifyAuditChain(authoritativeAuditEvents(app), verifiedAt);
}

function auditRepositoryMatches(repository: AuditEventRepository, expectedEvents: AuditEvent[]): boolean {
  const storedEvents = repository.listAuditEvents();

  return storedEvents.length === expectedEvents.length
    && storedEvents.every((event, index) => stableStringify(event) === stableStringify(expectedEvents[index]));
}

export function persistAppState(app: RebacLocalApp, storedAt: string): void {
  persistStoreSnapshot(app.persistence.stateRepository, app.store, storedAt, app.persistenceDegradations);
}

export function commitRuntimePersistence(
  app: RebacLocalApp,
  storedAt: string,
  operations: Array<() => void>,
  options: RuntimePersistenceCommitOptions = {}
): void {
  for (const operation of operations) {
    operation();
  }

  app.store.replacePersistenceDegradations(app.persistenceDegradations);
  if (options.persistState ?? true) {
    persistAppState(app, storedAt);
  }
}

export function persistGraphSubject(app: RebacLocalApp, subject: Subject, storedAt: string): void {
  try {
    app.graphRepository?.upsertSubject(subject);
  } catch (error) {
    recordPersistenceRepositoryError(app.persistenceDegradations, "graph", "upsertSubject", storedAt, error);
  }
}

export function persistGraphResource(app: RebacLocalApp, resource: Resource, storedAt: string): void {
  try {
    app.graphRepository?.upsertResource(resource);
  } catch (error) {
    recordPersistenceRepositoryError(app.persistenceDegradations, "graph", "upsertResource", storedAt, error);
  }
}

export function persistGraphRelationship(app: RebacLocalApp, relationship: RelationshipTuple, storedAt: string): void {
  try {
    app.graphRepository?.upsertRelationship(relationship);
  } catch (error) {
    recordPersistenceRepositoryError(app.persistenceDegradations, "graph", "upsertRelationship", storedAt, error);
  }
}

export function persistGraphNativeGrant(app: RebacLocalApp, grant: NativeGrant, storedAt: string): void {
  try {
    app.graphRepository?.upsertNativeGrant(grant);
  } catch (error) {
    recordPersistenceRepositoryError(app.persistenceDegradations, "graph", "upsertNativeGrant", storedAt, error);
  }
}

export function persistConnectorDiscoveryGraph(
  app: RebacLocalApp,
  graph: {
    subjects: Subject[];
    resources: Resource[];
    relationships: RelationshipTuple[];
    nativeGrants: NativeGrant[];
  },
  storedAt: string
): void {
  graph.subjects.forEach((subject) => persistGraphSubject(app, subject, storedAt));
  graph.resources.forEach((resource) => persistGraphResource(app, resource, storedAt));
  graph.relationships.forEach((relationship) => persistGraphRelationship(app, relationship, storedAt));
  graph.nativeGrants.forEach((grant) => persistGraphNativeGrant(app, grant, storedAt));
}

export function persistJobDiscoveryRun(app: RebacLocalApp, run: DiscoveryRun, storedAt: string): void {
  try {
    app.jobRepository?.recordDiscoveryRun(run);
  } catch (error) {
    recordPersistenceRepositoryError(app.persistenceDegradations, "job", "recordDiscoveryRun", storedAt, error);
  }
}

export function persistJobEnforcementReadinessReport(
  app: RebacLocalApp,
  report: EnforcementReadinessReport,
  storedAt: string
): void {
  try {
    app.jobRepository?.recordEnforcementReadinessReport(report);
  } catch (error) {
    recordPersistenceRepositoryError(app.persistenceDegradations, "job", "recordEnforcementReadinessReport", storedAt, error);
  }
}

export function persistJobDriftFinding(app: RebacLocalApp, finding: DriftFinding, storedAt: string): void {
  try {
    app.jobRepository?.upsertDriftFinding(finding);
  } catch (error) {
    recordPersistenceRepositoryError(app.persistenceDegradations, "job", "upsertDriftFinding", storedAt, error);
  }
}

export function persistJobAccessReviewCampaign(app: RebacLocalApp, campaign: AccessReviewCampaign, storedAt: string): void {
  try {
    app.jobRepository?.upsertAccessReviewCampaign(campaign);
  } catch (error) {
    recordPersistenceRepositoryError(app.persistenceDegradations, "job", "upsertAccessReviewCampaign", storedAt, error);
  }
}

export function persistJobGovernanceFinding(app: RebacLocalApp, finding: GovernanceFinding, storedAt: string): void {
  try {
    app.jobRepository?.upsertGovernanceFinding(finding);
  } catch (error) {
    recordPersistenceRepositoryError(app.persistenceDegradations, "job", "upsertGovernanceFinding", storedAt, error);
  }
}

export function persistJobExceptionRequest(app: RebacLocalApp, request: ExceptionRequest, storedAt: string): void {
  try {
    app.jobRepository?.upsertExceptionRequest(request);
  } catch (error) {
    recordPersistenceRepositoryError(app.persistenceDegradations, "job", "upsertExceptionRequest", storedAt, error);
  }
}

export function persistJobReconciliationRun(app: RebacLocalApp, run: ReconciliationRun, storedAt: string): void {
  try {
    app.jobRepository?.recordReconciliationRun(run);
  } catch (error) {
    recordPersistenceRepositoryError(app.persistenceDegradations, "job", "recordReconciliationRun", storedAt, error);
  }
}

export function persistJobDecision(app: RebacLocalApp, decision: DecisionResult): void {
  try {
    app.jobRepository?.recordDecision(decision);
  } catch (error) {
    recordPersistenceRepositoryError(app.persistenceDegradations, "job", "recordDecision", decision.evaluatedAt, error);
  }
}

export function persistJobProvisioningPlan(app: RebacLocalApp, plan: ProvisioningPlan, storedAt: string): void {
  try {
    app.jobRepository?.upsertProvisioningPlan(plan);
  } catch (error) {
    recordPersistenceRepositoryError(app.persistenceDegradations, "job", "upsertProvisioningPlan", storedAt, error);
  }
}

export function persistJobProvisioningJob(app: RebacLocalApp, job: ProvisioningJob, storedAt: string): void {
  try {
    app.jobRepository?.upsertProvisioningJob(job);
  } catch (error) {
    recordPersistenceRepositoryError(app.persistenceDegradations, "job", "upsertProvisioningJob", storedAt, error);
  }
}

export function persistStoreSnapshot(
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
      message: error instanceof Error ? error.message : String(error),
      version: "persistence-degradation:v1"
    });
    store.replacePersistenceDegradations(degradations);
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

export function writeEvidenceExport(
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
      message: error instanceof Error ? error.message : String(error),
      version: "persistence-degradation:v1"
    });
    return undefined;
  }
}
