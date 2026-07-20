import {
  AuditRecorder,
  assertAdminAuthorizationDescriptorSafe,
  createLocalEngineSeed,
  createLocalBearerTokenAdminAuthorizationDescriptor,
  InMemoryRebacStore,
  RebacDecisionEngine,
  type DecisionRequest
} from "@access-kit/core";
import {
  normalizeRuntimePersistence,
  type RebacLocalApp,
  type RebacLocalAppOptions,
  type RebacPersistenceDegradation
} from "./runtime-app.js";
import { getRequestAuditActor } from "./request-audit-context.js";
import { createRuntimeConnectors } from "./runtime-connectors.js";
import { initialRuntimeSeed, seedEmptyRuntimeRepositories } from "./runtime-seed.js";
import {
  appendAuditEvent,
  initialAuditEvents,
  persistJobDecision,
  persistStoreSnapshot
} from "./runtime-state.js";

export {
  RebacLocalAppError,
  type RebacLocalApp,
  type RebacLocalAppOptions,
  type RebacPersistenceDegradation,
  type RebacRuntimePersistence
} from "./runtime-app.js";
export { isSafeChangeTicketPattern } from "./runtime-provisioning.js";
export type { EnforcementReadinessRequest } from "./runtime-enforcement.js";
export {
  createPolicy,
  listPolicies,
  publishPolicy,
  rollbackPolicy,
  validatePolicy,
  type PolicyDraft,
  type PolicySummary,
  type PolicyValidationResult
} from "./runtime-policies.js";
export {
  createResource,
  createSubject,
  deleteRelationship,
  putRelationship
} from "./runtime-graph.js";
export {
  listDiscoveryRuns,
  readNativeAccess,
  syncConnector,
  testConnector
} from "./runtime-discovery.js";
export {
  checkEnforcementReadiness,
  createProvisioningJob,
  createProvisioningPlan,
  createRevocationPlan,
  getProvisioningJob,
  listEnforcementReadinessReports
} from "./runtime-jobs.js";
export {
  planDriftRemediationDryRun,
  runReconciliation
} from "./runtime-reconciliation.js";
export {
  exportAuditEvents,
  exportEvidence,
  exportEvidencePackage,
  verifyAuditIntegrity,
  verifyEvidencePackage
} from "./runtime-evidence-export.js";
export { recordAudit } from "./runtime-state.js";

export function createRebacLocalApp(options: RebacLocalAppOptions = {}): RebacLocalApp {
  const now = options.now ?? (() => new Date().toISOString());
  const actor = options.actor ?? "service:api";
  const adminAuthorization = options.adminAuthorization ?? createLocalBearerTokenAdminAuthorizationDescriptor();
  assertAdminAuthorizationDescriptorSafe(adminAuthorization);
  const persistence = normalizeRuntimePersistence(options);
  const persistenceDegradations: RebacPersistenceDegradation[] = [];
  const persistedGraph = persistence.graphRepository?.exportGraph();
  const persistedJobs = persistence.jobRepository?.exportJobs();
  const seed = initialRuntimeSeed(persistence, options.seed ?? createLocalEngineSeed(), persistedGraph, persistedJobs, now);
  const store = new InMemoryRebacStore(seed);
  persistenceDegradations.push(...store.listPersistenceDegradations());
  seedEmptyRuntimeRepositories(persistence, store, persistenceDegradations, now, persistedGraph, persistedJobs);
  store.replacePersistenceDegradations(persistenceDegradations);
  const auditRecorder = new AuditRecorder(initialAuditEvents(persistence, store));
  const engine = new RebacDecisionEngine(store, {
    now,
    actor,
    resolveAuditActor: getRequestAuditActor,
    auditRecorder,
    onAuditEvent: (event) => {
      const priorStoreAuditEvents = persistence.stateRepository ? store.listAuditEvents().slice(0, -1) : undefined;
      appendAuditEvent(persistence.auditRepository, event, event.occurredAt, priorStoreAuditEvents, persistenceDegradations);
      store.replacePersistenceDegradations(persistenceDegradations);
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
    jobQueue: persistence.jobQueue,
    stateRepository: persistence.stateRepository,
    auditRepository: persistence.auditRepository,
    evidenceRepository: persistence.evidenceRepository,
    adminAuthorization,
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
