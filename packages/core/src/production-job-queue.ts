import type {
  CanonicalId,
  DecisionResult,
  DiscoveryRun,
  DriftFinding,
  EnforcementControl,
  EnforcementReadinessReport,
  JsonRecord,
  ProvisioningApproval,
  ProvisioningJob,
  ProvisioningPlan,
  ReconciliationRun
} from "./domain.js";
import type {
  DescribedPersistenceRepository,
  DiscoveryRunFilter,
  DriftFindingFilter,
  EnforcementReadinessReportFilter,
  PersistenceBackendDescriptor,
  RebacJobRepository,
  RebacJobSnapshot
} from "./persistence.js";
import {
  assertObjectArrayFields,
  assertStoredPayloadHash,
  countJobEntities,
  normalizeJobSnapshot,
  stableHash
} from "./repository-envelopes.js";
import type { RebacJobStorageReceipt } from "./repositories.js";
import type { ExternalSnapshotStore, ProductionRepositoryBackupMetadata } from "./production-repositories.js";
import { isProductionSensitiveKey } from "./production-secret-material.js";

export type ProductionQueuedJobKind = "discovery" | "reconciliation" | "provisioning" | "evidence" | "revocation";
export type ProductionQueuedJobPriority = "emergency" | "high" | "normal" | "low";
export type ProductionQueuedJobStatus = "queued" | "running" | "completed" | "failed" | "dead_lettered";
export type ProductionConnectorHealthStatus = "healthy" | "degraded" | "offline";

export interface ProductionJobQueueBackoffPolicy {
  strategy: "exponential";
  initialDelayMs: number;
  maxDelayMs: number;
  multiplier?: number;
}

export interface ProductionJobQueueEnqueueRequest {
  kind: ProductionQueuedJobKind;
  connectorId: CanonicalId;
  idempotencyKey: string;
  payload: JsonRecord;
  priority?: ProductionQueuedJobPriority;
  requestedAt?: string;
  maxAttempts?: number;
  backoff?: ProductionJobQueueBackoffPolicy;
  approval?: ProvisioningApproval;
  control?: EnforcementControl;
  readinessReportId?: CanonicalId;
  replayedFromJobId?: CanonicalId;
}

export interface ProductionProvisioningJobQueueOptions {
  plan?: ProvisioningPlan;
  requestedAt?: string;
  priority?: ProductionQueuedJobPriority;
  maxAttempts?: number;
  backoff?: ProductionJobQueueBackoffPolicy;
  readinessReportId?: CanonicalId;
}

export interface ProductionRevocationJobQueueRequest {
  connectorId: CanonicalId;
  nativeGrantId: CanonicalId;
  idempotencyKey: string;
  requestedAt?: string;
  reason?: string;
  approval?: ProvisioningApproval;
  control?: EnforcementControl;
  readinessReportId?: CanonicalId;
  maxAttempts?: number;
  backoff?: ProductionJobQueueBackoffPolicy;
}

export interface ProductionQueuedJob {
  id: CanonicalId;
  kind: ProductionQueuedJobKind;
  connectorId: CanonicalId;
  status: ProductionQueuedJobStatus;
  priority: ProductionQueuedJobPriority;
  idempotencyKey: string;
  requestHash: string;
  payload: JsonRecord;
  attempts: number;
  maxAttempts: number;
  backoff: ProductionJobQueueBackoffPolicy;
  requestedAt: string;
  availableAt: string;
  updatedAt: string;
  workerId?: CanonicalId;
  startedAt?: string;
  leaseExpiresAt?: string;
  completedAt?: string;
  failedAt?: string;
  deadLetteredAt?: string;
  lastError?: string;
  replayedFromJobId?: CanonicalId;
  approval?: ProvisioningApproval;
  control?: EnforcementControl;
  readinessReportId?: CanonicalId;
  version: "production-queued-job:v1";
}

export interface ProductionJobQueueIdempotencyRecord {
  idempotencyKey: string;
  jobId: CanonicalId;
  requestHash: string;
  recordedAt: string;
  version: "production-job-idempotency:v1";
}

export interface ProductionConnectorHealth {
  connectorId: CanonicalId;
  status: ProductionConnectorHealthStatus;
  updatedAt: string;
  reason?: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  version: "production-connector-health:v1";
}

export interface ProductionJobQueueSnapshot {
  queuedJobs: ProductionQueuedJob[];
  connectorHealth: ProductionConnectorHealth[];
  idempotencyRecords: ProductionJobQueueIdempotencyRecord[];
}

export type ProductionJobQueueEntityCounts = RebacJobStorageReceipt["entityCounts"] & {
  queuedJobs: number;
  deadLetteredJobs: number;
  connectorHealth: number;
  idempotencyRecords: number;
};

export interface ProductionJobQueueStoreRecord {
  version: "production-job-queue-store:v1";
  storedAt: string;
  tenantBoundary: string;
  jobsHash: string;
  queueHash: string;
  jobs: RebacJobSnapshot;
  queue: ProductionJobQueueSnapshot;
  entityCounts: ProductionJobQueueEntityCounts;
  backupMetadata: ProductionRepositoryBackupMetadata[];
}

export interface ProductionJobQueueAdapterOptions {
  store: ExternalSnapshotStore<ProductionJobQueueStoreRecord>;
  tenantBoundary: string;
  location: string;
  now?: () => string;
}

export interface ProductionQueuedJobFilter {
  kind?: ProductionQueuedJobKind;
  connectorId?: CanonicalId;
  status?: ProductionQueuedJobStatus;
}

export interface ProductionJobReservationRequest {
  workerId: CanonicalId;
  reservedAt?: string;
  leaseDurationMs?: number;
}

export interface ProductionJobFailureRequest {
  workerId?: CanonicalId;
  failedAt?: string;
  error: string;
}

export interface ProductionJobCompletionRequest {
  workerId?: CanonicalId;
  completedAt?: string;
}

export interface ProductionJobReplayRequest {
  requestedAt?: string;
  idempotencyKey?: string;
}

export class ProductionJobQueueAdapter implements RebacJobRepository, DescribedPersistenceRepository {
  readonly #store: ExternalSnapshotStore<ProductionJobQueueStoreRecord>;
  readonly #tenantBoundary: string;
  readonly #location: string;
  readonly #now: () => string;
  #jobs: RebacJobSnapshot;
  #queue: ProductionJobQueueSnapshot;
  #backupMetadata: ProductionRepositoryBackupMetadata[];

  constructor(options: ProductionJobQueueAdapterOptions) {
    assertTenantBoundary(options.tenantBoundary);
    assertNoSecretMaterial(options.location, "production job queue location");
    this.#store = options.store;
    this.#tenantBoundary = options.tenantBoundary;
    this.#location = options.location;
    this.#now = options.now ?? (() => new Date().toISOString());
    const stored = this.#readQueueRecord();
    this.#jobs = stored?.jobs ?? emptyJobSnapshot();
    this.#queue = stored?.queue ?? emptyQueueSnapshot();
    this.#backupMetadata = stored?.backupMetadata ?? [];
  }

  describePersistence(): PersistenceBackendDescriptor {
    return {
      component: "job",
      backend: "external_queue",
      durable: true,
      immutable: false,
      capabilities: ["job_enqueue", "idempotency_lookup", "transactional_writes", "backup_restore"],
      location: this.#location,
      version: "persistence-backend:v1"
    };
  }

  enqueueJob(request: ProductionJobQueueEnqueueRequest): ProductionQueuedJob {
    const normalized = this.#normalizeEnqueueRequest(request);
    assertEnforcementEvidence(normalized);
    assertNoSecretMaterial(normalized.payload, `Queued ${normalized.kind} job payload`);
    return this.#enqueueNormalizedJob(normalized);
  }

  enqueueProvisioningJob(job: ProvisioningJob, options: ProductionProvisioningJobQueueOptions = {}): ProductionQueuedJob {
    this.#refreshFromStore();
    const plan = options.plan ?? this.getProvisioningPlan(job.planId);
    const normalized = this.#normalizeEnqueueRequest({
      kind: planHasRevocation(plan) || jobHasRevocation(job) ? "revocation" : "provisioning",
      connectorId: job.connectorId,
      idempotencyKey: job.idempotencyKey,
      requestedAt: options.requestedAt,
      priority: options.priority ?? (planHasRevocation(plan) || jobHasRevocation(job) ? "emergency" : undefined),
      maxAttempts: options.maxAttempts,
      backoff: options.backoff,
      approval: job.approval ?? plan?.approval,
      control: job.control ?? plan?.control,
      readinessReportId: options.readinessReportId ?? plan?.readinessReportId,
      payload: {
        jobId: job.id,
        planId: job.planId,
        connectorId: job.connectorId,
        mode: job.mode,
        dryRun: job.dryRun,
        status: job.status
      }
    });
    assertEnforcementEvidence(normalized);
    assertNoSecretMaterial(normalized.payload, `Queued ${normalized.kind} job payload`);
    assertNoSecretMaterial(job, `Provisioning job ${job.id}`);
    if (plan) {
      assertNoSecretMaterial(plan, `Provisioning plan ${plan.id}`);
    }

    return this.#enqueueNormalizedJob(normalized, (jobs) => {
      const nextJobs = {
        ...jobs,
        provisioningPlans: plan ? upsertById(jobs.provisioningPlans, clone(plan)) : jobs.provisioningPlans,
        provisioningJobs: upsertById(jobs.provisioningJobs, clone(job))
      };
      return nextJobs;
    });
  }

  enqueueRevocationJob(request: ProductionRevocationJobQueueRequest): ProductionQueuedJob {
    return this.enqueueJob({
      kind: "revocation",
      connectorId: request.connectorId,
      idempotencyKey: request.idempotencyKey,
      requestedAt: request.requestedAt,
      priority: "emergency",
      maxAttempts: request.maxAttempts,
      backoff: request.backoff,
      approval: request.approval,
      control: request.control,
      readinessReportId: request.readinessReportId,
      payload: {
        nativeGrantId: request.nativeGrantId,
        reason: request.reason ?? "operator_requested_revocation"
      }
    });
  }

  reserveNextJob(request: ProductionJobReservationRequest): ProductionQueuedJob | undefined {
    const reservedAt = request.reservedAt ?? this.#now();
    return this.#commitSnapshot(reservedAt, (jobs, queue) => {
      const recoveredQueue = recoverExpiredRunningJobs(queue, reservedAt);
      const eligible = recoveredQueue.queuedJobs
        .filter((job) => job.status === "queued" && job.availableAt <= reservedAt && this.#isConnectorReservable(job, recoveredQueue))
        .sort(compareQueuedJobs)[0];

      if (!eligible) {
        return { jobs, queue: recoveredQueue, result: undefined };
      }

      const running: ProductionQueuedJob = {
        ...eligible,
        status: "running",
        workerId: request.workerId,
        startedAt: reservedAt,
        leaseExpiresAt: addMilliseconds(reservedAt, request.leaseDurationMs ?? defaultLeaseDurationMs()),
        updatedAt: reservedAt,
        attempts: eligible.attempts + 1
      };
      return {
        jobs,
        queue: {
          ...recoveredQueue,
          queuedJobs: upsertById(recoveredQueue.queuedJobs, running)
        },
        result: running
      };
    });
  }

  completeJob(jobId: CanonicalId, request: ProductionJobCompletionRequest = {}): ProductionQueuedJob {
    const completedAt = request.completedAt ?? this.#now();
    return this.#commitSnapshot(completedAt, (jobs, queue) => {
      const job = requiredQueuedJob(queue, jobId);
      assertJobRunning(job, "complete");
      assertLeaseActive(job, completedAt, "complete");
      assertWorkerMatches(job, request.workerId);
      const completed: ProductionQueuedJob = {
        ...job,
        status: "completed",
        workerId: request.workerId ?? job.workerId,
        completedAt,
        updatedAt: completedAt
      };
      return {
        jobs,
        queue: {
          ...queue,
          queuedJobs: upsertById(queue.queuedJobs, completed)
        },
        result: completed
      };
    });
  }

  recordJobFailure(jobId: CanonicalId, request: ProductionJobFailureRequest): ProductionQueuedJob {
    const failedAt = request.failedAt ?? this.#now();
    return this.#commitSnapshot(failedAt, (jobs, queue) => {
      const job = requiredQueuedJob(queue, jobId);
      assertJobRunning(job, "record failure for");
      assertWorkerMatches(job, request.workerId);
      const retryable = job.attempts < job.maxAttempts;
      const failed: ProductionQueuedJob = retryable
        ? {
          ...job,
          status: "queued",
          workerId: undefined,
          leaseExpiresAt: undefined,
          failedAt,
          lastError: request.error,
          availableAt: addMilliseconds(failedAt, backoffDelayMs(job)),
          updatedAt: failedAt
        }
        : {
          ...job,
          status: "dead_lettered",
          workerId: request.workerId ?? job.workerId,
          failedAt,
          deadLetteredAt: failedAt,
          lastError: request.error,
          updatedAt: failedAt
        };
      return {
        jobs,
        queue: {
          ...queue,
          queuedJobs: upsertById(queue.queuedJobs, failed)
        },
        result: failed
      };
    });
  }

  replayDeadLetteredJob(jobId: CanonicalId, request: ProductionJobReplayRequest = {}): ProductionQueuedJob {
    const requestedAt = request.requestedAt ?? this.#now();
    this.#refreshFromStore();
    const job = requiredQueuedJob(this.#queue, jobId);

    if (job.status !== "dead_lettered") {
      throw new Error(`Production queue job ${jobId} is not dead-lettered and cannot be replayed.`);
    }

    return this.enqueueJob({
      kind: job.kind,
      connectorId: job.connectorId,
      idempotencyKey: request.idempotencyKey ?? `${job.idempotencyKey}:replay:${stableHash({ jobId, requestedAt }).slice(0, 12)}`,
      payload: {
        ...job.payload,
        replayedFromJobId: job.id
      },
      priority: job.priority,
      requestedAt,
      maxAttempts: job.maxAttempts,
      backoff: job.backoff,
      approval: job.approval,
      control: job.control,
      readinessReportId: job.readinessReportId,
      replayedFromJobId: job.id
    });
  }

  getQueuedJob(id: CanonicalId): ProductionQueuedJob | undefined {
    this.#refreshFromStore();
    return cloneOptional(this.#queue.queuedJobs.find((job) => job.id === id));
  }

  listQueuedJobs(filter: ProductionQueuedJobFilter = {}): ProductionQueuedJob[] {
    this.#refreshFromStore();
    return clone(
      this.#queue.queuedJobs.filter((job) => {
        return (
          (!filter.kind || job.kind === filter.kind) &&
          (!filter.connectorId || job.connectorId === filter.connectorId) &&
          (!filter.status || job.status === filter.status)
        );
      })
    );
  }

  listDeadLetteredJobs(): ProductionQueuedJob[] {
    return this.listQueuedJobs({ status: "dead_lettered" });
  }

  setConnectorHealth(health: Omit<ProductionConnectorHealth, "version">): ProductionConnectorHealth {
    const next: ProductionConnectorHealth = {
      ...health,
      version: "production-connector-health:v1"
    };
    assertNoSecretMaterial(next, `Connector health ${next.connectorId}`);
    return this.#commitSnapshot(next.updatedAt, (jobs, queue) => ({
      jobs,
      queue: {
        ...queue,
        connectorHealth: upsertByConnectorId(queue.connectorHealth, next)
      },
      result: next
    }));
  }

  getConnectorHealth(connectorId: CanonicalId): ProductionConnectorHealth {
    this.#refreshFromStore();
    return clone(
      this.#queue.connectorHealth.find((health) => health.connectorId === connectorId) ?? {
        connectorId,
        status: "healthy",
        updatedAt: this.#now(),
        version: "production-connector-health:v1"
      }
    );
  }

  listConnectorHealth(): ProductionConnectorHealth[] {
    this.#refreshFromStore();
    return clone(this.#queue.connectorHealth);
  }

  exportQueue(): ProductionJobQueueSnapshot {
    this.#refreshFromStore();
    return clone(this.#queue);
  }

  recordDiscoveryRun(run: DiscoveryRun): DiscoveryRun {
    assertEvidenceTenantBoundary(run.evidence as unknown as JsonRecord, this.#tenantBoundary, `Discovery run ${run.id}`);
    assertNoSecretMaterial(run, `Discovery run ${run.id}`);
    return this.#commitSnapshot(this.#now(), (jobs, queue) => ({
      jobs: {
        ...jobs,
        discoveryRuns: appendUniqueById(jobs.discoveryRuns, clone(run), "Discovery run")
      },
      queue,
      result: run
    }));
  }

  listDiscoveryRuns(filter: DiscoveryRunFilter = {}): DiscoveryRun[] {
    this.#refreshFromStore();
    return clone(
      this.#jobs.discoveryRuns.filter((run) => {
        return (!filter.connectorId || run.connectorId === filter.connectorId) && (!filter.status || run.status === filter.status);
      })
    );
  }

  recordEnforcementReadinessReport(report: EnforcementReadinessReport): EnforcementReadinessReport {
    assertReportTenantBoundary(report, this.#tenantBoundary);
    assertNoSecretMaterial(report, `Enforcement readiness report ${report.id}`);
    return this.#commitSnapshot(this.#now(), (jobs, queue) => ({
      jobs: {
        ...jobs,
        enforcementReadinessReports: appendUniqueById(
          jobs.enforcementReadinessReports,
          clone(report),
          "Enforcement readiness report"
        )
      },
      queue,
      result: report
    }));
  }

  getEnforcementReadinessReport(id: CanonicalId): EnforcementReadinessReport | undefined {
    this.#refreshFromStore();
    return cloneOptional(this.#jobs.enforcementReadinessReports.find((report) => report.id === id));
  }

  listEnforcementReadinessReports(filter: EnforcementReadinessReportFilter = {}): EnforcementReadinessReport[] {
    this.#refreshFromStore();
    return clone(
      this.#jobs.enforcementReadinessReports.filter((report) => {
        return (!filter.connectorId || report.connectorId === filter.connectorId) && (!filter.status || report.status === filter.status);
      })
    );
  }

  upsertProvisioningPlan(plan: ProvisioningPlan): ProvisioningPlan {
    assertNoSecretMaterial(plan, `Provisioning plan ${plan.id}`);
    return this.#commitSnapshot(this.#now(), (jobs, queue) => ({
      jobs: {
        ...jobs,
        provisioningPlans: upsertById(jobs.provisioningPlans, clone(plan))
      },
      queue,
      result: plan
    }));
  }

  getProvisioningPlan(id: CanonicalId): ProvisioningPlan | undefined {
    this.#refreshFromStore();
    return cloneOptional(this.#jobs.provisioningPlans.find((plan) => plan.id === id));
  }

  getProvisioningPlanByIdempotencyKey(idempotencyKey: string): ProvisioningPlan | undefined {
    this.#refreshFromStore();
    return cloneOptional(this.#jobs.provisioningPlans.find((plan) => plan.idempotencyKey === idempotencyKey));
  }

  listProvisioningPlans(): ProvisioningPlan[] {
    this.#refreshFromStore();
    return clone(this.#jobs.provisioningPlans);
  }

  upsertProvisioningJob(job: ProvisioningJob): ProvisioningJob {
    assertNoSecretMaterial(job, `Provisioning job ${job.id}`);
    return this.#commitSnapshot(this.#now(), (jobs, queue) => ({
      jobs: {
        ...jobs,
        provisioningJobs: upsertById(jobs.provisioningJobs, clone(job))
      },
      queue,
      result: job
    }));
  }

  getProvisioningJob(id: CanonicalId): ProvisioningJob | undefined {
    this.#refreshFromStore();
    return cloneOptional(this.#jobs.provisioningJobs.find((job) => job.id === id));
  }

  getProvisioningJobByIdempotencyKey(idempotencyKey: string): ProvisioningJob | undefined {
    this.#refreshFromStore();
    return cloneOptional(this.#jobs.provisioningJobs.find((job) => job.idempotencyKey === idempotencyKey));
  }

  listProvisioningJobs(): ProvisioningJob[] {
    this.#refreshFromStore();
    return clone(this.#jobs.provisioningJobs);
  }

  upsertDriftFinding(finding: DriftFinding): DriftFinding {
    assertNoSecretMaterial(finding, `Drift finding ${finding.id}`);
    return this.#commitSnapshot(this.#now(), (jobs, queue) => ({
      jobs: {
        ...jobs,
        driftFindings: upsertById(jobs.driftFindings, clone(finding))
      },
      queue,
      result: finding
    }));
  }

  getDriftFinding(id: CanonicalId): DriftFinding | undefined {
    this.#refreshFromStore();
    return cloneOptional(this.#jobs.driftFindings.find((finding) => finding.id === id));
  }

  listDriftFindings(filter: DriftFindingFilter = {}): DriftFinding[] {
    this.#refreshFromStore();
    return clone(this.#jobs.driftFindings.filter((finding) => !filter.severity || finding.severity === filter.severity));
  }

  recordReconciliationRun(run: ReconciliationRun): ReconciliationRun {
    assertNoSecretMaterial(run, `Reconciliation run ${run.id}`);
    return this.#commitSnapshot(this.#now(), (jobs, queue) => ({
      jobs: {
        ...jobs,
        reconciliationRuns: appendUniqueById(jobs.reconciliationRuns, clone(run), "Reconciliation run")
      },
      queue,
      result: run
    }));
  }

  listReconciliationRuns(): ReconciliationRun[] {
    this.#refreshFromStore();
    return clone(this.#jobs.reconciliationRuns);
  }

  recordDecision(decision: DecisionResult): DecisionResult {
    assertNoSecretMaterial(decision, `Decision ${decision.decisionId}`);
    return this.#commitSnapshot(decision.evaluatedAt, (jobs, queue) => ({
      jobs: {
        ...jobs,
        decisions: upsertByDecisionId(jobs.decisions, clone(decision))
      },
      queue,
      result: decision
    }));
  }

  listDecisions(): DecisionResult[] {
    this.#refreshFromStore();
    return clone(this.#jobs.decisions);
  }

  exportJobs(): RebacJobSnapshot {
    this.#refreshFromStore();
    return clone(this.#jobs);
  }

  flush(storedAt: string = this.#now()): RebacJobStorageReceipt {
    this.#refreshFromStore();
    return this.#persist(storedAt);
  }

  createBackup(id: CanonicalId, createdAt: string = this.#now()): ProductionRepositoryBackupMetadata {
    this.#refreshFromStore();
    const jobs = normalizeJobSnapshot(this.#jobs);
    const queue = normalizeQueueSnapshot(this.#queue);
    const metadata = createBackupMetadata({
      id,
      component: "job",
      createdAt,
      location: `${this.#location}#backup:${id}`,
      snapshotHash: `sha256:${stableHash({ jobs, queue })}`,
      tenantBoundary: this.#tenantBoundary,
      entityCounts: countQueueEntities(jobs, queue)
    });
    const record = this.#createRecord(createdAt, jobs, queue, [...this.#backupMetadata, metadata]);
    this.#store.writeCurrent(record);
    this.#store.writeBackup(id, record);
    this.#jobs = record.jobs;
    this.#queue = record.queue;
    this.#backupMetadata = record.backupMetadata;
    return clone(metadata);
  }

  restoreBackup(id: CanonicalId, restoredAt: string = this.#now()): RebacJobStorageReceipt {
    const backup = this.#readQueueBackup(id);
    this.#jobs = backup.jobs;
    this.#queue = backup.queue;
    this.#backupMetadata = backup.backupMetadata;
    return this.#persist(restoredAt);
  }

  listBackupMetadata(): ProductionRepositoryBackupMetadata[] {
    this.#refreshFromStore();
    return clone(this.#backupMetadata);
  }

  #enqueueNormalizedJob(
    normalized: RequiredQueueRequest,
    mutateJobs: (jobs: RebacJobSnapshot) => RebacJobSnapshot = (jobs) => jobs
  ): ProductionQueuedJob {
    return this.#commitSnapshot(normalized.requestedAt, (jobs, queue) => {
      const existing = queue.idempotencyRecords.find((record) => record.idempotencyKey === normalized.idempotencyKey);

      if (existing) {
        if (existing.requestHash !== normalized.requestHash) {
          throw new Error(`Production queue idempotency key ${normalized.idempotencyKey} was reused for a different job request.`);
        }

        return { jobs, queue, result: requiredQueuedJob(queue, existing.jobId) };
      }

      const job = createQueuedJob(normalized);
      return {
        jobs: mutateJobs(jobs),
        queue: {
          ...queue,
          queuedJobs: [...queue.queuedJobs, job],
          idempotencyRecords: [
            ...queue.idempotencyRecords,
            {
              idempotencyKey: job.idempotencyKey,
              jobId: job.id,
              requestHash: job.requestHash,
              recordedAt: job.requestedAt,
              version: "production-job-idempotency:v1"
            }
          ]
        },
        result: job
      };
    });
  }

  #commitSnapshot<T>(
    storedAt: string,
    mutate: (
      jobs: RebacJobSnapshot,
      queue: ProductionJobQueueSnapshot,
      backupMetadata: ProductionRepositoryBackupMetadata[]
    ) => {
      jobs: RebacJobSnapshot;
      queue: ProductionJobQueueSnapshot;
      backupMetadata?: ProductionRepositoryBackupMetadata[];
      result: T;
    }
  ): T {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const expected = this.#readQueueRecord();
      const jobs = expected?.jobs ?? emptyJobSnapshot();
      const queue = expected?.queue ?? emptyQueueSnapshot();
      const backupMetadata = expected?.backupMetadata ?? [];
      const mutation = mutate(clone(jobs), clone(queue), clone(backupMetadata));
      const record = this.#createRecord(
        storedAt,
        normalizeJobSnapshot(mutation.jobs),
        normalizeQueueSnapshot(mutation.queue),
        mutation.backupMetadata ?? backupMetadata
      );

      if (this.#store.compareExchangeCurrent(expected, record)) {
        this.#jobs = record.jobs;
        this.#queue = record.queue;
        this.#backupMetadata = record.backupMetadata;
        return cloneOptional(mutation.result) as T;
      }

    }

    throw new Error("Production job queue write conflict persisted after retry.");
  }

  #refreshFromStore(): void {
    const stored = this.#readQueueRecord();
    this.#jobs = stored?.jobs ?? emptyJobSnapshot();
    this.#queue = stored?.queue ?? emptyQueueSnapshot();
    this.#backupMetadata = stored?.backupMetadata ?? [];
  }

  #normalizeEnqueueRequest(request: ProductionJobQueueEnqueueRequest): RequiredQueueRequest {
    if (request.idempotencyKey.length === 0) {
      throw new Error("Production queue jobs require an idempotency key.");
    }
    if (request.connectorId.length === 0) {
      throw new Error("Production queue jobs require a connector id.");
    }

    const requestedAt = request.requestedAt ?? this.#now();
    const priority = request.priority ?? defaultPriority(request.kind);
    const maxAttempts = request.maxAttempts ?? 3;
    const backoff = request.backoff ?? defaultBackoffPolicy();
    const payload = clone(request.payload);
    const requestHash = `sha256:${stableHash({
      kind: request.kind,
      connectorId: request.connectorId,
      idempotencyKey: request.idempotencyKey,
      payload,
      priority,
      maxAttempts,
      backoff,
      approval: request.approval,
      control: request.control,
      readinessReportId: request.readinessReportId,
      replayedFromJobId: request.replayedFromJobId
    })}`;

    return {
      kind: request.kind,
      connectorId: request.connectorId,
      idempotencyKey: request.idempotencyKey,
      payload,
      priority,
      requestedAt,
      maxAttempts,
      backoff,
      approval: request.approval,
      control: request.control,
      readinessReportId: request.readinessReportId,
      requestHash,
      replayedFromJobId: request.replayedFromJobId
    };
  }

  #isConnectorReservable(job: ProductionQueuedJob, queue: ProductionJobQueueSnapshot): boolean {
    const health = queue.connectorHealth.find((entry) => entry.connectorId === job.connectorId);

    if (!health || health.status === "healthy") {
      return true;
    }

    return job.kind === "revocation" && job.priority === "emergency";
  }

  #readQueueRecord(): ProductionJobQueueStoreRecord | undefined {
    const stored = this.#store.readCurrent();

    if (!stored) {
      return undefined;
    }

    return validateQueueRecord(stored, this.#tenantBoundary);
  }

  #readQueueBackup(id: CanonicalId): ProductionJobQueueStoreRecord {
    const backup = this.#store.readBackup(id);

    if (!backup) {
      throw new Error(`Production job queue backup ${id} does not exist.`);
    }

    return validateQueueRecord(backup, this.#tenantBoundary);
  }

  #persist(storedAt: string): RebacJobStorageReceipt {
    const record = this.#createRecord(
      storedAt,
      normalizeJobSnapshot(this.#jobs),
      normalizeQueueSnapshot(this.#queue),
      this.#backupMetadata
    );
    this.#store.writeCurrent(record);
    this.#jobs = record.jobs;
    this.#queue = record.queue;
    this.#backupMetadata = record.backupMetadata;

    return {
      storedAt,
      backend: "external",
      location: this.#location,
      jobsHash: record.jobsHash,
      entityCounts: countJobEntities(record.jobs),
      version: "rebac-job-storage-receipt:v1"
    };
  }

  #createRecord(
    storedAt: string,
    jobs: RebacJobSnapshot,
    queue: ProductionJobQueueSnapshot,
    backupMetadata: ProductionRepositoryBackupMetadata[]
  ): ProductionJobQueueStoreRecord {
    assertJobTenantBoundary(jobs, this.#tenantBoundary);
    assertNoSecretMaterial(jobs, "Production job queue job snapshot");
    assertNoSecretMaterial(queue, "Production job queue snapshot");
    return {
      version: "production-job-queue-store:v1",
      storedAt,
      tenantBoundary: this.#tenantBoundary,
      jobsHash: `sha256:${stableHash(jobs)}`,
      queueHash: `sha256:${stableHash(queue)}`,
      jobs,
      queue,
      entityCounts: countQueueEntities(jobs, queue),
      backupMetadata: clone(backupMetadata)
    };
  }
}

interface RequiredQueueRequest {
  kind: ProductionQueuedJobKind;
  connectorId: CanonicalId;
  idempotencyKey: string;
  payload: JsonRecord;
  priority: ProductionQueuedJobPriority;
  requestedAt: string;
  maxAttempts: number;
  backoff: ProductionJobQueueBackoffPolicy;
  approval?: ProvisioningApproval;
  control?: EnforcementControl;
  readinessReportId?: CanonicalId;
  requestHash: string;
  replayedFromJobId?: CanonicalId;
}

function createQueuedJob(request: RequiredQueueRequest): ProductionQueuedJob {
  return {
    id: `queue:${stableHash({
      connectorId: request.connectorId,
      idempotencyKey: request.idempotencyKey,
      kind: request.kind
    }).slice(0, 24)}`,
    kind: request.kind,
    connectorId: request.connectorId,
    status: "queued",
    priority: request.priority,
    idempotencyKey: request.idempotencyKey,
    requestHash: request.requestHash,
    payload: request.payload,
    attempts: 0,
    maxAttempts: request.maxAttempts,
    backoff: request.backoff,
    requestedAt: request.requestedAt,
    availableAt: request.requestedAt,
    updatedAt: request.requestedAt,
    approval: request.approval,
    control: request.control,
    readinessReportId: request.readinessReportId,
    replayedFromJobId: request.replayedFromJobId,
    version: "production-queued-job:v1"
  };
}

function requiredQueuedJob(queue: ProductionJobQueueSnapshot, id: CanonicalId): ProductionQueuedJob {
  const job = queue.queuedJobs.find((entry) => entry.id === id);

  if (!job) {
    throw new Error(`Production queue job ${id} does not exist.`);
  }

  return clone(job);
}

function recoverExpiredRunningJobs(queue: ProductionJobQueueSnapshot, recoveredAt: string): ProductionJobQueueSnapshot {
  let recovered = false;
  const queuedJobs = queue.queuedJobs.map((job) => {
    if (job.status !== "running" || !job.leaseExpiresAt || job.leaseExpiresAt > recoveredAt) {
      return job;
    }

    recovered = true;
    return {
      ...job,
      status: "queued" as const,
      workerId: undefined,
      leaseExpiresAt: undefined,
      availableAt: recoveredAt,
      updatedAt: recoveredAt,
      lastError: `Worker lease expired at ${job.leaseExpiresAt}; job returned to queue.`
    };
  });

  return recovered ? { ...queue, queuedJobs } : queue;
}

function validateQueueRecord(record: ProductionJobQueueStoreRecord, tenantBoundary: string): ProductionJobQueueStoreRecord {
  if (record.version !== "production-job-queue-store:v1") {
    throw new Error("Production job queue store must use the production-job-queue-store:v1 envelope.");
  }
  if (record.tenantBoundary !== tenantBoundary) {
    throw new Error("Production job queue store tenant boundary does not match the configured tenant boundary.");
  }
  assertObjectArrayFields(record.jobs, "Production job queue job payload", [
    "discoveryRuns",
    "enforcementReadinessReports",
    "provisioningPlans",
    "provisioningJobs",
    "driftFindings",
    "reconciliationRuns",
    "decisions"
  ]);
  assertObjectArrayFields(record.queue, "Production job queue payload", [
    "queuedJobs",
    "connectorHealth",
    "idempotencyRecords"
  ]);
  assertStoredPayloadHash(record.jobs, record.jobsHash, "Production job queue store hash does not match the stored job payload.");
  assertStoredPayloadHash(record.queue, record.queueHash, "Production job queue store hash does not match the stored queue payload.");
  assertJobTenantBoundary(record.jobs, tenantBoundary);
  assertNoSecretMaterial(record.jobs, "Production job queue job snapshot");
  assertNoSecretMaterial(record.queue, "Production job queue snapshot");
  return {
    ...record,
    jobs: normalizeJobSnapshot(record.jobs),
    queue: normalizeQueueSnapshot(record.queue),
    backupMetadata: clone(record.backupMetadata ?? [])
  };
}

function assertEnforcementEvidence(request: RequiredQueueRequest): void {
  if (request.kind !== "provisioning") {
    return;
  }

  const enforcementMode = request.payload.mode === "enforcement" || request.payload.dryRun === false;

  if (!enforcementMode) {
    return;
  }

  if (!request.approval || !request.control || !request.readinessReportId) {
    throw new Error("Production queue enforcement jobs require approval, control, and readiness evidence before enqueue.");
  }
}

function assertJobTenantBoundary(jobs: RebacJobSnapshot, tenantBoundary: string): void {
  for (const run of jobs.discoveryRuns) {
    assertEvidenceTenantBoundary(run.evidence as unknown as JsonRecord, tenantBoundary, `Discovery run ${run.id}`);
  }
  for (const report of jobs.enforcementReadinessReports) {
    assertReportTenantBoundary(report, tenantBoundary);
  }
}

function assertReportTenantBoundary(report: EnforcementReadinessReport, tenantBoundary: string): void {
  if (report.tenantBoundary !== tenantBoundary) {
    throw new Error(`Enforcement readiness report ${report.id} crosses the configured tenant boundary.`);
  }
}

function assertEvidenceTenantBoundary(evidence: JsonRecord, tenantBoundary: string, label: string): void {
  if (evidence.tenantBoundary !== tenantBoundary) {
    throw new Error(`${label} must include matching evidence.tenantBoundary for production persistence.`);
  }
}

function assertTenantBoundary(tenantBoundary: string): void {
  if (tenantBoundary.length === 0) {
    throw new Error("Production job queue adapters require a tenant boundary.");
  }
}

function assertNoSecretMaterial(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecretMaterial(entry, `${path}[${index}]`));
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (isProductionSensitiveKey(key)) {
      throw new Error(`${path}.${key} contains secret material and cannot be persisted by a production adapter.`);
    }
    assertNoSecretMaterial(entry, `${path}.${key}`);
  }
}

function assertWorkerMatches(job: ProductionQueuedJob, workerId: CanonicalId | undefined): void {
  if (workerId && job.workerId && workerId !== job.workerId) {
    throw new Error(`Production queue job ${job.id} is reserved by worker ${job.workerId}, not ${workerId}.`);
  }
}

function assertJobRunning(job: ProductionQueuedJob, operation: string): void {
  if (job.status !== "running") {
    throw new Error(`Cannot ${operation} production queue job ${job.id} because it is ${job.status}.`);
  }
}

function assertLeaseActive(job: ProductionQueuedJob, checkedAt: string, operation: string): void {
  if (job.leaseExpiresAt && job.leaseExpiresAt <= checkedAt) {
    throw new Error(`Cannot ${operation} production queue job ${job.id} because its worker lease expired at ${job.leaseExpiresAt}.`);
  }
}

function defaultPriority(kind: ProductionQueuedJobKind): ProductionQueuedJobPriority {
  return kind === "revocation" ? "emergency" : "normal";
}

function defaultBackoffPolicy(): ProductionJobQueueBackoffPolicy {
  return {
    strategy: "exponential",
    initialDelayMs: 30_000,
    maxDelayMs: 900_000,
    multiplier: 2
  };
}

function defaultLeaseDurationMs(): number {
  return 300_000;
}

function backoffDelayMs(job: ProductionQueuedJob): number {
  const multiplier = job.backoff.multiplier ?? 2;
  return Math.min(job.backoff.maxDelayMs, job.backoff.initialDelayMs * multiplier ** Math.max(0, job.attempts - 1));
}

function addMilliseconds(isoDate: string, milliseconds: number): string {
  return new Date(Date.parse(isoDate) + milliseconds).toISOString();
}

function compareQueuedJobs(left: ProductionQueuedJob, right: ProductionQueuedJob): number {
  return priorityRank(left.priority) - priorityRank(right.priority) || left.requestedAt.localeCompare(right.requestedAt);
}

function priorityRank(priority: ProductionQueuedJobPriority): number {
  switch (priority) {
    case "emergency":
      return 0;
    case "high":
      return 1;
    case "normal":
      return 2;
    case "low":
      return 3;
  }
}

function planHasRevocation(plan: ProvisioningPlan | undefined): boolean {
  return plan?.actions.some((action) => action.operation === "revoke") ?? false;
}

function jobHasRevocation(job: ProvisioningJob): boolean {
  return job.actionResults.some((result) => result.operation === "revoke");
}

function createBackupMetadata(metadata: Omit<ProductionRepositoryBackupMetadata, "version">): ProductionRepositoryBackupMetadata {
  return {
    ...metadata,
    version: "production-repository-backup:v1"
  };
}

function countQueueEntities(jobs: RebacJobSnapshot, queue: ProductionJobQueueSnapshot): ProductionJobQueueEntityCounts {
  return {
    ...countJobEntities(jobs),
    queuedJobs: queue.queuedJobs.length,
    deadLetteredJobs: queue.queuedJobs.filter((job) => job.status === "dead_lettered").length,
    connectorHealth: queue.connectorHealth.length,
    idempotencyRecords: queue.idempotencyRecords.length
  };
}

function emptyJobSnapshot(): RebacJobSnapshot {
  return {
    discoveryRuns: [],
    enforcementReadinessReports: [],
    provisioningPlans: [],
    provisioningJobs: [],
    driftFindings: [],
    reconciliationRuns: [],
    decisions: []
  };
}

function emptyQueueSnapshot(): ProductionJobQueueSnapshot {
  return {
    queuedJobs: [],
    connectorHealth: [],
    idempotencyRecords: []
  };
}

function normalizeQueueSnapshot(queue: Partial<ProductionJobQueueSnapshot>): ProductionJobQueueSnapshot {
  return {
    queuedJobs: clone(queue.queuedJobs ?? []),
    connectorHealth: clone(queue.connectorHealth ?? []),
    idempotencyRecords: clone(queue.idempotencyRecords ?? [])
  };
}

function appendUniqueById<T extends { id: CanonicalId }>(items: T[], item: T, label: string): T[] {
  if (items.some((entry) => entry.id === item.id)) {
    throw new Error(`${label} ${item.id} has already been recorded.`);
  }

  return [...items, item];
}

function upsertByDecisionId(items: DecisionResult[], item: DecisionResult): DecisionResult[] {
  const index = items.findIndex((entry) => entry.decisionId === item.decisionId);

  if (index === -1) {
    return [...items, item];
  }

  return items.map((entry, entryIndex) => (entryIndex === index ? item : entry));
}

function upsertByConnectorId(items: ProductionConnectorHealth[], item: ProductionConnectorHealth): ProductionConnectorHealth[] {
  const index = items.findIndex((entry) => entry.connectorId === item.connectorId);

  if (index === -1) {
    return [...items, item];
  }

  return items.map((entry, entryIndex) => (entryIndex === index ? item : entry));
}

function upsertById<T extends { id: CanonicalId }>(items: T[], item: T): T[] {
  const index = items.findIndex((entry) => entry.id === item.id);

  if (index === -1) {
    return [...items, item];
  }

  return items.map((entry, entryIndex) => (entryIndex === index ? item : entry));
}

function cloneOptional<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : clone(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
