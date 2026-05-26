import type {
  AccessReviewCampaign,
  CanonicalId,
  DecisionResult,
  DiscoveryRun,
  DriftFinding,
  EnforcementReadinessReport,
  ExceptionRequest,
  GovernanceFinding,
  JsonRecord,
  NativeGrant,
  ProvisioningJob,
  ProvisioningPlan,
  ReconciliationRun,
  RelationshipTuple,
  Resource,
  Subject
} from "./domain.js";
import type {
  DescribedPersistenceRepository,
  DiscoveryRunFilter,
  DriftFindingFilter,
  ExceptionRequestFilter,
  GovernanceFindingFilter,
  EnforcementReadinessReportFilter,
  NativeGrantFilter,
  PersistenceBackendDescriptor,
  RebacGraphRepository,
  RebacGraphSnapshot,
  RebacJobRepository,
  RebacJobSnapshot,
  RelationshipFilter
} from "./persistence.js";
import {
  assertObjectArrayFields,
  assertStoredPayloadHash,
  countGraphEntities,
  countJobEntities,
  normalizeGraphSnapshot,
  normalizeJobSnapshot,
  stableHash
} from "./repository-envelopes.js";
import { matchesDriftFindingFilter } from "./drift-finding-filter.js";
import { isProductionSensitiveKey } from "./production-secret-material.js";
import type { RebacGraphStorageReceipt, RebacJobStorageReceipt } from "./repositories.js";

export type ProductionRepositoryStoreComponent = "graph" | "connector_state" | "job" | "audit";
export type ProductionConnectorStateCapability =
  | "connector_state_read"
  | "connector_state_write"
  | "discovery_run_history"
  | "drift_finding_history"
  | "reconciliation_evidence"
  | "readiness_report_history"
  | "idempotency_lookup"
  | "transactional_writes"
  | "backup_restore";

export interface ProductionConnectorStateStoreDescriptor {
  component: "connector_state";
  backend: "external_connector_state";
  durable: boolean;
  immutable: boolean;
  capabilities: ProductionConnectorStateCapability[];
  location: string;
  version: "production-connector-state-backend:v1";
}

export interface ProductionRepositoryBackupMetadata {
  id: CanonicalId;
  component: ProductionRepositoryStoreComponent;
  createdAt: string;
  location: string;
  snapshotHash: string;
  tenantBoundary: string;
  entityCounts: Record<string, number>;
  version: "production-repository-backup:v1";
}

export interface ExternalSnapshotStore<TRecord extends object> {
  readCurrent(): TRecord | undefined;
  writeCurrent(record: TRecord): void;
  compareExchangeCurrent(expected: TRecord | undefined, record: TRecord): boolean;
  readBackup(id: CanonicalId): TRecord | undefined;
  writeBackup(id: CanonicalId, record: TRecord): void;
}

export interface ProductionGraphStoreRecord {
  version: "production-graph-store:v1";
  storedAt: string;
  tenantBoundary: string;
  graphHash: string;
  graph: RebacGraphSnapshot;
  entityCounts: RebacGraphStorageReceipt["entityCounts"];
  backupMetadata: ProductionRepositoryBackupMetadata[];
}

export interface ProductionConnectorStateStoreRecord {
  version: "production-connector-state-store:v1";
  storedAt: string;
  tenantBoundary: string;
  jobsHash: string;
  jobs: RebacJobSnapshot;
  entityCounts: RebacJobStorageReceipt["entityCounts"];
  backupMetadata: ProductionRepositoryBackupMetadata[];
}

export interface ProductionGraphStoreAdapterOptions {
  store: ExternalSnapshotStore<ProductionGraphStoreRecord>;
  tenantBoundary: string;
  location: string;
  now?: () => string;
}

export interface ProductionConnectorStateStoreAdapterOptions {
  store: ExternalSnapshotStore<ProductionConnectorStateStoreRecord>;
  tenantBoundary: string;
  location: string;
  now?: () => string;
}

export class InMemoryExternalSnapshotStore<TRecord extends object> implements ExternalSnapshotStore<TRecord> {
  #current?: TRecord;
  readonly #backups = new Map<CanonicalId, TRecord>();

  readCurrent(): TRecord | undefined {
    return cloneOptional(this.#current);
  }

  writeCurrent(record: TRecord): void {
    this.#current = clone(record);
  }

  compareExchangeCurrent(expected: TRecord | undefined, record: TRecord): boolean {
    const currentHash = this.#current === undefined ? undefined : stableHash(this.#current);
    const expectedHash = expected === undefined ? undefined : stableHash(expected);

    if (currentHash !== expectedHash) {
      return false;
    }

    this.writeCurrent(record);
    return true;
  }

  readBackup(id: CanonicalId): TRecord | undefined {
    return cloneOptional(this.#backups.get(id));
  }

  writeBackup(id: CanonicalId, record: TRecord): void {
    this.#backups.set(id, clone(record));
  }
}

export class ProductionGraphStoreAdapter implements RebacGraphRepository, DescribedPersistenceRepository {
  readonly #store: ExternalSnapshotStore<ProductionGraphStoreRecord>;
  readonly #tenantBoundary: string;
  readonly #location: string;
  readonly #now: () => string;
  #graph: RebacGraphSnapshot;
  #backupMetadata: ProductionRepositoryBackupMetadata[];

  constructor(options: ProductionGraphStoreAdapterOptions) {
    assertTenantBoundary(options.tenantBoundary);
    assertNoSecretMaterial(options.location, "production graph store location");
    this.#store = options.store;
    this.#tenantBoundary = options.tenantBoundary;
    this.#location = options.location;
    this.#now = options.now ?? (() => new Date().toISOString());
    const stored = this.#readGraphRecord();
    this.#graph = stored?.graph ?? emptyGraphSnapshot();
    this.#backupMetadata = stored?.backupMetadata ?? [];
  }

  describePersistence(): PersistenceBackendDescriptor {
    return {
      component: "graph",
      backend: "external_graph",
      durable: true,
      immutable: false,
      capabilities: ["graph_read", "graph_write", "relationship_query", "native_grant_readback", "transactional_writes", "backup_restore"],
      location: this.#location,
      version: "persistence-backend:v1"
    };
  }

  getSubject(id: CanonicalId): Subject | undefined {
    return cloneOptional(this.#graph.subjects.find((subject) => subject.id === id));
  }

  listSubjects(): Subject[] {
    return clone(this.#graph.subjects);
  }

  upsertSubject(subject: Subject): Subject {
    assertEntityTenant(subject, this.#tenantBoundary, `Subject ${subject.id}`);
    assertNoSecretMaterial(subject, `Subject ${subject.id}`);
    this.#graph.subjects = upsertById(this.#graph.subjects, clone(subject));
    this.#persist(this.#now());
    return clone(subject);
  }

  getResource(id: CanonicalId): Resource | undefined {
    return cloneOptional(this.#graph.resources.find((resource) => resource.id === id));
  }

  listResources(): Resource[] {
    return clone(this.#graph.resources);
  }

  upsertResource(resource: Resource): Resource {
    assertEntityTenant(resource, this.#tenantBoundary, `Resource ${resource.id}`);
    assertNoSecretMaterial(resource, `Resource ${resource.id}`);
    this.#graph.resources = upsertById(this.#graph.resources, clone(resource));
    this.#persist(this.#now());
    return clone(resource);
  }

  getRelationship(id: CanonicalId): RelationshipTuple | undefined {
    return cloneOptional(this.#graph.relationships.find((relationship) => relationship.id === id));
  }

  listRelationships(filter: RelationshipFilter = {}): RelationshipTuple[] {
    return clone(
      this.#graph.relationships.filter((relationship) => {
        return (
          (!filter.subjectId || relationship.subjectId === filter.subjectId) &&
          (!filter.objectId || relationship.objectId === filter.objectId) &&
          (!filter.relation || relationship.relation === filter.relation)
        );
      })
    );
  }

  upsertRelationship(relationship: RelationshipTuple): RelationshipTuple {
    this.#assertRelationshipTenant(relationship);
    assertNoSecretMaterial(relationship, `Relationship ${relationship.id}`);
    this.#graph.relationships = upsertById(this.#graph.relationships, clone(relationship));
    this.#persist(this.#now());
    return clone(relationship);
  }

  deleteRelationship(id: CanonicalId, deletedAt: string): RelationshipTuple | undefined {
    const relationship = this.#graph.relationships.find((entry) => entry.id === id);

    if (!relationship) {
      return undefined;
    }

    const deleted: RelationshipTuple = {
      ...relationship,
      status: "deleted",
      updatedAt: deletedAt
    };
    this.#graph.relationships = upsertById(this.#graph.relationships, deleted);
    this.#persist(this.#now());
    return clone(deleted);
  }

  listNativeGrants(filter: NativeGrantFilter = {}): NativeGrant[] {
    return clone(
      this.#graph.nativeGrants.filter((grant) => {
        return (
          (!filter.sourceConnectorId || grant.sourceConnectorId === filter.sourceConnectorId) &&
          (!filter.targetObjectId || grant.targetObjectId === filter.targetObjectId) &&
          (!filter.subjectId || grant.subjectId === filter.subjectId) &&
          (!filter.nativePermission || grant.nativePermission === filter.nativePermission) &&
          (!filter.grantType || grant.grantType === filter.grantType) &&
          (!filter.principalType || grant.principalType === filter.principalType) &&
          (!filter.status || grant.status === filter.status)
        );
      })
    );
  }

  upsertNativeGrant(grant: NativeGrant): NativeGrant {
    this.#assertNativeGrantTenant(grant);
    assertNoSecretMaterial(grant, `Native grant ${grant.id}`);
    this.#graph.nativeGrants = upsertById(this.#graph.nativeGrants, clone(grant));
    this.#persist(this.#now());
    return clone(grant);
  }

  exportGraph(): RebacGraphSnapshot {
    return clone(this.#graph);
  }

  flush(storedAt: string = this.#now()): RebacGraphStorageReceipt {
    return this.#persist(storedAt);
  }

  createBackup(id: CanonicalId, createdAt: string = this.#now()): ProductionRepositoryBackupMetadata {
    const graph = normalizeGraphSnapshot(this.#graph);
    const entityCounts = countGraphEntities(graph);
    const graphHash = `sha256:${stableHash(graph)}`;
    const metadata = createBackupMetadata({
      id,
      component: "graph",
      createdAt,
      location: `${this.#location}#backup:${id}`,
      snapshotHash: graphHash,
      tenantBoundary: this.#tenantBoundary,
      entityCounts
    });
    const record = this.#createRecord(createdAt, graph, [...this.#backupMetadata, metadata]);
    this.#store.writeCurrent(record);
    this.#store.writeBackup(id, record);
    this.#graph = record.graph;
    this.#backupMetadata = record.backupMetadata;
    return clone(metadata);
  }

  restoreBackup(id: CanonicalId, restoredAt: string = this.#now()): RebacGraphStorageReceipt {
    const backup = this.#readGraphBackup(id);
    this.#graph = backup.graph;
    this.#backupMetadata = backup.backupMetadata;
    return this.#persist(restoredAt);
  }

  listBackupMetadata(): ProductionRepositoryBackupMetadata[] {
    return clone(this.#backupMetadata);
  }

  #readGraphRecord(): ProductionGraphStoreRecord | undefined {
    const stored = this.#store.readCurrent();

    if (!stored) {
      return undefined;
    }

    return validateGraphRecord(stored, this.#tenantBoundary);
  }

  #readGraphBackup(id: CanonicalId): ProductionGraphStoreRecord {
    const backup = this.#store.readBackup(id);

    if (!backup) {
      throw new Error(`Production graph backup ${id} does not exist.`);
    }

    return validateGraphRecord(backup, this.#tenantBoundary);
  }

  #assertRelationshipTenant(relationship: RelationshipTuple): void {
    const subject = this.#graph.subjects.find((entry) => entry.id === relationship.subjectId);
    const resource = this.#graph.resources.find((entry) => entry.id === relationship.objectId);

    if (!subject || !resource) {
      throw new Error(`Relationship ${relationship.id} must reference existing tenant-bound subject and resource records.`);
    }

    assertEntityTenant(subject, this.#tenantBoundary, `Relationship ${relationship.id} subject ${subject.id}`);
    assertEntityTenant(resource, this.#tenantBoundary, `Relationship ${relationship.id} resource ${resource.id}`);
    assertOptionalTenantAttribute(relationship.attributes, this.#tenantBoundary, `Relationship ${relationship.id}`);
  }

  #assertNativeGrantTenant(grant: NativeGrant): void {
    const subject = this.#graph.subjects.find((entry) => entry.id === grant.subjectId);
    const resource = this.#graph.resources.find((entry) => entry.id === grant.targetObjectId);

    if (!subject || !resource) {
      throw new Error(`Native grant ${grant.id} must reference existing tenant-bound subject and resource records.`);
    }

    assertEntityTenant(subject, this.#tenantBoundary, `Native grant ${grant.id} subject ${subject.id}`);
    assertEntityTenant(resource, this.#tenantBoundary, `Native grant ${grant.id} resource ${resource.id}`);
  }

  #persist(storedAt: string): RebacGraphStorageReceipt {
    const record = this.#createRecord(storedAt, normalizeGraphSnapshot(this.#graph), this.#backupMetadata);
    this.#store.writeCurrent(record);
    this.#graph = record.graph;
    this.#backupMetadata = record.backupMetadata;

    return {
      storedAt,
      backend: "external",
      location: this.#location,
      graphHash: record.graphHash,
      entityCounts: record.entityCounts,
      version: "rebac-graph-storage-receipt:v1"
    };
  }

  #createRecord(
    storedAt: string,
    graph: RebacGraphSnapshot,
    backupMetadata: ProductionRepositoryBackupMetadata[]
  ): ProductionGraphStoreRecord {
    assertGraphTenantBoundary(graph, this.#tenantBoundary);
    assertNoSecretMaterial(graph, "Production graph snapshot");
    const graphHash = `sha256:${stableHash(graph)}`;
    return {
      version: "production-graph-store:v1",
      storedAt,
      tenantBoundary: this.#tenantBoundary,
      graphHash,
      graph,
      entityCounts: countGraphEntities(graph),
      backupMetadata: clone(backupMetadata)
    };
  }
}

export class ProductionConnectorStateStoreAdapter implements RebacJobRepository {
  readonly #store: ExternalSnapshotStore<ProductionConnectorStateStoreRecord>;
  readonly #tenantBoundary: string;
  readonly #location: string;
  readonly #now: () => string;
  #jobs: RebacJobSnapshot;
  #backupMetadata: ProductionRepositoryBackupMetadata[];

  constructor(options: ProductionConnectorStateStoreAdapterOptions) {
    assertTenantBoundary(options.tenantBoundary);
    assertNoSecretMaterial(options.location, "production connector-state store location");
    this.#store = options.store;
    this.#tenantBoundary = options.tenantBoundary;
    this.#location = options.location;
    this.#now = options.now ?? (() => new Date().toISOString());
    const stored = this.#readJobsRecord();
    this.#jobs = stored?.jobs ?? emptyJobSnapshot();
    this.#backupMetadata = stored?.backupMetadata ?? [];
  }

  describeConnectorStatePersistence(): ProductionConnectorStateStoreDescriptor {
    return {
      component: "connector_state",
      backend: "external_connector_state",
      durable: true,
      immutable: false,
      capabilities: [
        "connector_state_read",
        "connector_state_write",
        "discovery_run_history",
        "drift_finding_history",
        "reconciliation_evidence",
        "readiness_report_history",
        "idempotency_lookup",
        "transactional_writes",
        "backup_restore"
      ],
      location: this.#location,
      version: "production-connector-state-backend:v1"
    };
  }

  recordDiscoveryRun(run: DiscoveryRun): DiscoveryRun {
    assertEvidenceTenantBoundary(run.evidence as unknown as JsonRecord, this.#tenantBoundary, `Discovery run ${run.id}`);
    assertNoSecretMaterial(run, `Discovery run ${run.id}`);
    this.#jobs.discoveryRuns = appendUniqueById(this.#jobs.discoveryRuns, clone(run), "Discovery run");
    this.#persist(this.#now());
    return clone(run);
  }

  listDiscoveryRuns(filter: DiscoveryRunFilter = {}): DiscoveryRun[] {
    return clone(
      this.#jobs.discoveryRuns.filter((run) => {
        return (!filter.connectorId || run.connectorId === filter.connectorId) && (!filter.status || run.status === filter.status);
      })
    );
  }

  recordEnforcementReadinessReport(report: EnforcementReadinessReport): EnforcementReadinessReport {
    assertReportTenantBoundary(report, this.#tenantBoundary);
    assertNoSecretMaterial(report, `Enforcement readiness report ${report.id}`);
    this.#jobs.enforcementReadinessReports = appendUniqueById(
      this.#jobs.enforcementReadinessReports,
      clone(report),
      "Enforcement readiness report"
    );
    this.#persist(this.#now());
    return clone(report);
  }

  getEnforcementReadinessReport(id: CanonicalId): EnforcementReadinessReport | undefined {
    return cloneOptional(this.#jobs.enforcementReadinessReports.find((report) => report.id === id));
  }

  listEnforcementReadinessReports(filter: EnforcementReadinessReportFilter = {}): EnforcementReadinessReport[] {
    return clone(
      this.#jobs.enforcementReadinessReports.filter((report) => {
        return (!filter.connectorId || report.connectorId === filter.connectorId) && (!filter.status || report.status === filter.status);
      })
    );
  }

  upsertProvisioningPlan(plan: ProvisioningPlan): ProvisioningPlan {
    assertNoSecretMaterial(plan, `Provisioning plan ${plan.id}`);
    this.#jobs.provisioningPlans = upsertById(this.#jobs.provisioningPlans, clone(plan));
    this.#persist(this.#now());
    return clone(plan);
  }

  getProvisioningPlan(id: CanonicalId): ProvisioningPlan | undefined {
    return cloneOptional(this.#jobs.provisioningPlans.find((plan) => plan.id === id));
  }

  getProvisioningPlanByIdempotencyKey(idempotencyKey: string): ProvisioningPlan | undefined {
    return cloneOptional(this.#jobs.provisioningPlans.find((plan) => plan.idempotencyKey === idempotencyKey));
  }

  listProvisioningPlans(): ProvisioningPlan[] {
    return clone(this.#jobs.provisioningPlans);
  }

  upsertProvisioningJob(job: ProvisioningJob): ProvisioningJob {
    assertNoSecretMaterial(job, `Provisioning job ${job.id}`);
    this.#jobs.provisioningJobs = upsertById(this.#jobs.provisioningJobs, clone(job));
    this.#persist(this.#now());
    return clone(job);
  }

  getProvisioningJob(id: CanonicalId): ProvisioningJob | undefined {
    return cloneOptional(this.#jobs.provisioningJobs.find((job) => job.id === id));
  }

  getProvisioningJobByIdempotencyKey(idempotencyKey: string): ProvisioningJob | undefined {
    return cloneOptional(this.#jobs.provisioningJobs.find((job) => job.idempotencyKey === idempotencyKey));
  }

  listProvisioningJobs(): ProvisioningJob[] {
    return clone(this.#jobs.provisioningJobs);
  }

  upsertDriftFinding(finding: DriftFinding): DriftFinding {
    assertNoSecretMaterial(finding, `Drift finding ${finding.id}`);
    this.#jobs.driftFindings = upsertById(this.#jobs.driftFindings, clone(finding));
    this.#persist(this.#now());
    return clone(finding);
  }

  getDriftFinding(id: CanonicalId): DriftFinding | undefined {
    return cloneOptional(this.#jobs.driftFindings.find((finding) => finding.id === id));
  }

  listDriftFindings(filter: DriftFindingFilter = {}): DriftFinding[] {
    return clone(this.#jobs.driftFindings.filter((finding) => matchesDriftFindingFilter(finding, filter)));
  }

  upsertAccessReviewCampaign(campaign: AccessReviewCampaign): AccessReviewCampaign {
    assertNoSecretMaterial(campaign, `Access review campaign ${campaign.id}`);
    this.#jobs.accessReviewCampaigns = upsertById(this.#jobs.accessReviewCampaigns, clone(campaign));
    this.#persist(this.#now());
    return clone(campaign);
  }

  getAccessReviewCampaign(id: CanonicalId): AccessReviewCampaign | undefined {
    return cloneOptional(this.#jobs.accessReviewCampaigns.find((campaign) => campaign.id === id));
  }

  listAccessReviewCampaigns(): AccessReviewCampaign[] {
    return clone(this.#jobs.accessReviewCampaigns);
  }

  upsertGovernanceFinding(finding: GovernanceFinding): GovernanceFinding {
    assertNoSecretMaterial(finding, `Governance finding ${finding.id}`);
    this.#jobs.governanceFindings = upsertById(this.#jobs.governanceFindings, clone(finding));
    this.#persist(this.#now());
    return clone(finding);
  }

  getGovernanceFinding(id: CanonicalId): GovernanceFinding | undefined {
    return cloneOptional(this.#jobs.governanceFindings.find((finding) => finding.id === id));
  }

  listGovernanceFindings(filter: GovernanceFindingFilter = {}): GovernanceFinding[] {
    return clone(
      this.#jobs.governanceFindings.filter((finding) => (
        (!filter.status || finding.status === filter.status) &&
        (!filter.severity || finding.severity === filter.severity)
      ))
    );
  }

  upsertExceptionRequest(request: ExceptionRequest): ExceptionRequest {
    assertNoSecretMaterial(request, `Exception request ${request.id}`);
    this.#jobs.exceptionRequests = upsertById(this.#jobs.exceptionRequests, clone(request));
    this.#persist(this.#now());
    return clone(request);
  }

  getExceptionRequest(id: CanonicalId): ExceptionRequest | undefined {
    return cloneOptional(this.#jobs.exceptionRequests.find((request) => request.id === id));
  }

  listExceptionRequests(filter: ExceptionRequestFilter = {}): ExceptionRequest[] {
    return clone(this.#jobs.exceptionRequests.filter((request) => !filter.status || request.status === filter.status));
  }

  recordReconciliationRun(run: ReconciliationRun): ReconciliationRun {
    assertNoSecretMaterial(run, `Reconciliation run ${run.id}`);
    this.#jobs.reconciliationRuns = appendUniqueById(this.#jobs.reconciliationRuns, clone(run), "Reconciliation run");
    this.#persist(this.#now());
    return clone(run);
  }

  listReconciliationRuns(): ReconciliationRun[] {
    return clone(this.#jobs.reconciliationRuns);
  }

  recordDecision(decision: DecisionResult): DecisionResult {
    assertNoSecretMaterial(decision, `Decision ${decision.decisionId}`);
    this.#jobs.decisions = upsertByDecisionId(this.#jobs.decisions, clone(decision));
    this.#persist(decision.evaluatedAt);
    return clone(decision);
  }

  listDecisions(): DecisionResult[] {
    return clone(this.#jobs.decisions);
  }

  exportJobs(): RebacJobSnapshot {
    return clone(this.#jobs);
  }

  flush(storedAt: string = this.#now()): RebacJobStorageReceipt {
    return this.#persist(storedAt);
  }

  createBackup(id: CanonicalId, createdAt: string = this.#now()): ProductionRepositoryBackupMetadata {
    const jobs = normalizeJobSnapshot(this.#jobs);
    const entityCounts = countJobEntities(jobs);
    const jobsHash = `sha256:${stableHash(jobs)}`;
    const metadata = createBackupMetadata({
      id,
      component: "connector_state",
      createdAt,
      location: `${this.#location}#backup:${id}`,
      snapshotHash: jobsHash,
      tenantBoundary: this.#tenantBoundary,
      entityCounts
    });
    const record = this.#createRecord(createdAt, jobs, [...this.#backupMetadata, metadata]);
    this.#store.writeCurrent(record);
    this.#store.writeBackup(id, record);
    this.#jobs = record.jobs;
    this.#backupMetadata = record.backupMetadata;
    return clone(metadata);
  }

  restoreBackup(id: CanonicalId, restoredAt: string = this.#now()): RebacJobStorageReceipt {
    const backup = this.#readJobsBackup(id);
    this.#jobs = backup.jobs;
    this.#backupMetadata = backup.backupMetadata;
    return this.#persist(restoredAt);
  }

  listBackupMetadata(): ProductionRepositoryBackupMetadata[] {
    return clone(this.#backupMetadata);
  }

  #readJobsRecord(): ProductionConnectorStateStoreRecord | undefined {
    const stored = this.#store.readCurrent();

    if (!stored) {
      return undefined;
    }

    return validateConnectorStateRecord(stored, this.#tenantBoundary);
  }

  #readJobsBackup(id: CanonicalId): ProductionConnectorStateStoreRecord {
    const backup = this.#store.readBackup(id);

    if (!backup) {
      throw new Error(`Production connector-state backup ${id} does not exist.`);
    }

    return validateConnectorStateRecord(backup, this.#tenantBoundary);
  }

  #persist(storedAt: string): RebacJobStorageReceipt {
    const record = this.#createRecord(storedAt, normalizeJobSnapshot(this.#jobs), this.#backupMetadata);
    this.#store.writeCurrent(record);
    this.#jobs = record.jobs;
    this.#backupMetadata = record.backupMetadata;

    return {
      storedAt,
      backend: "external",
      location: this.#location,
      jobsHash: record.jobsHash,
      entityCounts: record.entityCounts,
      version: "rebac-job-storage-receipt:v1"
    };
  }

  #createRecord(
    storedAt: string,
    jobs: RebacJobSnapshot,
    backupMetadata: ProductionRepositoryBackupMetadata[]
  ): ProductionConnectorStateStoreRecord {
    assertConnectorStateTenantBoundary(jobs, this.#tenantBoundary);
    assertNoSecretMaterial(jobs, "Production connector-state snapshot");
    const jobsHash = `sha256:${stableHash(jobs)}`;
    return {
      version: "production-connector-state-store:v1",
      storedAt,
      tenantBoundary: this.#tenantBoundary,
      jobsHash,
      jobs,
      entityCounts: countJobEntities(jobs),
      backupMetadata: clone(backupMetadata)
    };
  }
}

function validateGraphRecord(record: ProductionGraphStoreRecord, tenantBoundary: string): ProductionGraphStoreRecord {
  if (record.version !== "production-graph-store:v1") {
    throw new Error("Production graph store must use the production-graph-store:v1 envelope.");
  }
  if (record.tenantBoundary !== tenantBoundary) {
    throw new Error("Production graph store tenant boundary does not match the configured tenant boundary.");
  }
  assertObjectArrayFields(record.graph, "Production graph store payload", ["subjects", "resources", "relationships", "nativeGrants"]);
  assertStoredPayloadHash(record.graph, record.graphHash, "Production graph store hash does not match the stored graph payload.");
  assertGraphTenantBoundary(record.graph, tenantBoundary);
  assertNoSecretMaterial(record.graph, "Production graph snapshot");
  return {
    ...record,
    graph: normalizeGraphSnapshot(record.graph),
    backupMetadata: clone(record.backupMetadata ?? [])
  };
}

function validateConnectorStateRecord(
  record: ProductionConnectorStateStoreRecord,
  tenantBoundary: string
): ProductionConnectorStateStoreRecord {
  if (record.version !== "production-connector-state-store:v1") {
    throw new Error("Production connector-state store must use the production-connector-state-store:v1 envelope.");
  }
  if (record.tenantBoundary !== tenantBoundary) {
    throw new Error("Production connector-state store tenant boundary does not match the configured tenant boundary.");
  }
  assertObjectArrayFields(record.jobs, "Production connector-state store payload", [
    "discoveryRuns",
    "enforcementReadinessReports",
    "provisioningPlans",
    "provisioningJobs",
    "driftFindings",
    "accessReviewCampaigns",
    "governanceFindings",
    "exceptionRequests",
    "reconciliationRuns",
    "decisions"
  ]);
  assertStoredPayloadHash(record.jobs, record.jobsHash, "Production connector-state store hash does not match the stored job payload.");
  assertConnectorStateTenantBoundary(record.jobs, tenantBoundary);
  assertNoSecretMaterial(record.jobs, "Production connector-state snapshot");
  return {
    ...record,
    jobs: normalizeJobSnapshot(record.jobs),
    backupMetadata: clone(record.backupMetadata ?? [])
  };
}

function assertGraphTenantBoundary(graph: RebacGraphSnapshot, tenantBoundary: string): void {
  for (const subject of graph.subjects) {
    assertEntityTenant(subject, tenantBoundary, `Subject ${subject.id}`);
  }
  for (const resource of graph.resources) {
    assertEntityTenant(resource, tenantBoundary, `Resource ${resource.id}`);
  }
  for (const relationship of graph.relationships) {
    assertOptionalTenantAttribute(relationship.attributes, tenantBoundary, `Relationship ${relationship.id}`);
  }
}

function assertConnectorStateTenantBoundary(jobs: RebacJobSnapshot, tenantBoundary: string): void {
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

function assertEntityTenant(entity: { attributes?: JsonRecord }, tenantBoundary: string, label: string): void {
  const tenantId = entity.attributes?.tenantId;

  if (typeof tenantId !== "string" || tenantId.length === 0) {
    throw new Error(`${label} must include attributes.tenantId for production persistence.`);
  }
  if (tenantId !== tenantBoundary) {
    throw new Error(`${label} crosses the configured tenant boundary.`);
  }
}

function assertOptionalTenantAttribute(attributes: JsonRecord | undefined, tenantBoundary: string, label: string): void {
  const tenantId = attributes?.tenantId;

  if (tenantId !== undefined && tenantId !== tenantBoundary) {
    throw new Error(`${label} crosses the configured tenant boundary.`);
  }
}

function assertTenantBoundary(tenantBoundary: string): void {
  if (tenantBoundary.length === 0) {
    throw new Error("Production repository adapters require a tenant boundary.");
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

function createBackupMetadata(
  metadata: Omit<ProductionRepositoryBackupMetadata, "version">
): ProductionRepositoryBackupMetadata {
  return {
    ...metadata,
    version: "production-repository-backup:v1"
  };
}

function emptyGraphSnapshot(): RebacGraphSnapshot {
  return {
    subjects: [],
    resources: [],
    relationships: [],
    nativeGrants: []
  };
}

function emptyJobSnapshot(): RebacJobSnapshot {
  return {
    discoveryRuns: [],
    enforcementReadinessReports: [],
    provisioningPlans: [],
    provisioningJobs: [],
    driftFindings: [],
    accessReviewCampaigns: [],
    governanceFindings: [],
    exceptionRequests: [],
    reconciliationRuns: [],
    decisions: []
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
