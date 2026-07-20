import {
  stableStringify,
  verifyAuditChain,
  type AuditEvent,
  type InMemoryRebacStore,
  type RebacGraphRepository,
  type RebacJobRepository,
  type RebacSeedData
} from "@access-kit/core";
import type { RebacPersistenceDegradation, RebacRuntimePersistence } from "./runtime-app.js";
import { recordPersistenceRepositoryError } from "./runtime-state.js";

export type RebacGraphSnapshot = ReturnType<RebacGraphRepository["exportGraph"]>;
export type RebacJobSnapshot = ReturnType<RebacJobRepository["exportJobs"]>;

export function initialRuntimeSeed(
  persistence: RebacRuntimePersistence,
  fallbackSeed: RebacSeedData,
  graph: RebacGraphSnapshot | undefined,
  jobs: RebacJobSnapshot | undefined,
  now: () => string
): RebacSeedData {
  const baseSeed = persistence.stateRepository?.readState() ?? fallbackSeed;
  const auditEvents = recoverAppendOnlyAuditEvents(persistence, baseSeed, now);

  return {
    ...baseSeed,
    ...(auditEvents ? { auditEvents } : {}),
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
          discoveryRuns: jobs.discoveryRuns,
          enforcementReadinessReports: jobs.enforcementReadinessReports,
          provisioningPlans: jobs.provisioningPlans,
          provisioningJobs: jobs.provisioningJobs,
          driftFindings: jobs.driftFindings,
          accessReviewCampaigns: jobs.accessReviewCampaigns,
          governanceFindings: jobs.governanceFindings,
          exceptionRequests: jobs.exceptionRequests,
          reconciliationRuns: jobs.reconciliationRuns,
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

function recoverAppendOnlyAuditEvents(
  persistence: RebacRuntimePersistence,
  baseSeed: RebacSeedData,
  now: () => string
): AuditEvent[] | undefined {
  if (!persistence.stateRepository || !persistence.auditRepository) {
    return baseSeed.auditEvents;
  }

  const storedEvents = baseSeed.auditEvents ?? [];
  const repositoryEvents = persistence.auditRepository.listAuditEvents();

  if (repositoryEvents.length <= storedEvents.length || !auditEventsStartWith(repositoryEvents, storedEvents)) {
    return baseSeed.auditEvents;
  }

  return verifyAuditChain(repositoryEvents, now()).status === "verified" ? repositoryEvents : baseSeed.auditEvents;
}

function auditEventsStartWith(events: AuditEvent[], prefix: AuditEvent[]): boolean {
  return prefix.every((event, index) => stableStringify(event) === stableStringify(events[index]));
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
    && containsAllById(jobs.accessReviewCampaigns, baseSeed.accessReviewCampaigns)
    && containsAllById(jobs.governanceFindings, baseSeed.governanceFindings)
    && containsAllById(jobs.exceptionRequests, baseSeed.exceptionRequests)
    && containsAllById(jobs.reconciliationRuns, baseSeed.reconciliationRuns)
    && containsAllByKey(jobs.decisions, baseSeed.decisions, "decisionId");
}

function hasPersistedRuntimeJobRecords(jobs: RebacJobSnapshot): boolean {
  return jobs.discoveryRuns.length > 0
    || jobs.enforcementReadinessReports.length > 0
    || jobs.provisioningPlans.length > 0
    || jobs.provisioningJobs.length > 0
    || jobs.driftFindings.length > 0
    || jobs.accessReviewCampaigns.length > 0
    || jobs.governanceFindings.length > 0
    || jobs.exceptionRequests.length > 0
    || jobs.reconciliationRuns.length > 0
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

export function seedEmptyRuntimeRepositories(
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
      seed.discoveryRuns?.forEach((run) => persistence.jobRepository?.recordDiscoveryRun(run));
      seed.enforcementReadinessReports?.forEach((report) => persistence.jobRepository?.recordEnforcementReadinessReport(report));
      seed.provisioningPlans?.forEach((plan) => persistence.jobRepository?.upsertProvisioningPlan(plan));
      seed.provisioningJobs?.forEach((job) => persistence.jobRepository?.upsertProvisioningJob(job));
      seed.driftFindings?.forEach((finding) => persistence.jobRepository?.upsertDriftFinding(finding));
      seed.accessReviewCampaigns?.forEach((campaign) => persistence.jobRepository?.upsertAccessReviewCampaign(campaign));
      seed.governanceFindings?.forEach((finding) => persistence.jobRepository?.upsertGovernanceFinding(finding));
      seed.exceptionRequests?.forEach((request) => persistence.jobRepository?.upsertExceptionRequest(request));
      seed.reconciliationRuns?.forEach((run) => persistence.jobRepository?.recordReconciliationRun(run));
      seed.decisions?.forEach((decision) => persistence.jobRepository?.recordDecision(decision));
    }
  } catch (error) {
    recordPersistenceRepositoryError(degradations, "job", "seedRuntimeRepository", now(), error);
  }
}
