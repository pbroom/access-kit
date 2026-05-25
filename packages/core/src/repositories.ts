import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { auditEventHash, stableStringify, verifyAuditChain } from "./audit.js";
import type {
  AuditEvent,
  AuditIntegrityReport,
  AuditStorageReceipt,
  CanonicalId,
  DecisionResult,
  DiscoveryRun,
  DriftFinding,
  EnforcementReadinessReport,
  EvidenceExport,
  EvidenceStorageReceipt,
  NativeGrant,
  ProvisioningJob,
  ProvisioningPlan,
  ReconciliationRun,
  RelationshipTuple,
  Resource,
  Subject
} from "./domain.js";
import type {
  DescribedAuditEventRepository,
  DescribedPersistenceRepository,
  DiscoveryRunFilter,
  DriftFindingFilter,
  EnforcementReadinessReportFilter,
  NativeGrantFilter,
  PersistenceBackendDescriptor,
  RebacGraphRepository,
  RebacGraphSnapshot,
  RebacJobRepository,
  RebacJobSnapshot,
  RelationshipFilter
} from "./persistence.js";
import type { RebacSeedData } from "./store.js";

export interface AuditEventRepository {
  appendAuditEvent(event: AuditEvent, storedAt: string): AuditStorageReceipt;
  listAuditEvents(): AuditEvent[];
  verifyIntegrity(verifiedAt: string): AuditIntegrityReport;
}

export interface EvidencePackageRepository {
  writeEvidenceExport(evidence: EvidenceExport, storedAt: string): EvidenceStorageReceipt;
  readEvidenceExport(exportId: string): EvidenceExport | undefined;
}

export interface RebacStateRepository {
  readState(): RebacSeedData | undefined;
  writeState(state: RebacSeedData, storedAt: string): RebacStateStorageReceipt;
}

export interface RebacStateStorageReceipt {
  storedAt: string;
  backend: "local_file" | "external";
  location: string;
  stateHash: string;
  entityCounts: {
    subjects: number;
    resources: number;
    relationships: number;
    nativeGrants: number;
    discoveryRuns: number;
    enforcementReadinessReports: number;
    provisioningPlans: number;
    provisioningJobs: number;
    driftFindings: number;
    reconciliationRuns: number;
    decisions: number;
    auditEvents: number;
    persistenceDegradations: number;
  };
  version: string;
}

export interface RebacGraphStorageReceipt {
  storedAt: string;
  backend: "local_file" | "external";
  location: string;
  graphHash: string;
  entityCounts: {
    subjects: number;
    resources: number;
    relationships: number;
    nativeGrants: number;
  };
  version: "rebac-graph-storage-receipt:v1";
}

export interface RebacJobStorageReceipt {
  storedAt: string;
  backend: "local_file" | "external";
  location: string;
  jobsHash: string;
  entityCounts: {
    discoveryRuns: number;
    enforcementReadinessReports: number;
    provisioningPlans: number;
    provisioningJobs: number;
    driftFindings: number;
    reconciliationRuns: number;
    decisions: number;
  };
  version: "rebac-job-storage-receipt:v1";
}

export interface LocalFileEvidenceRepositoryOptions {
  rootDir: string;
}

export interface LocalAppendOnlyAuditRepositoryOptions {
  rootDir?: string;
  auditPath?: string;
  retentionDays?: number;
}

export interface LocalJsonFileGraphRepositoryOptions {
  rootDir?: string;
  graphPath?: string;
  now?: () => string;
}

export interface LocalJsonFileJobRepositoryOptions {
  rootDir?: string;
  jobsPath?: string;
  now?: () => string;
}

export interface LocalJsonFileStateRepositoryOptions {
  rootDir?: string;
  statePath?: string;
}

interface StoredRebacGraph {
  version: "rebac-graph-state:v1";
  storedAt: string;
  graphHash: string;
  graph: RebacGraphSnapshot;
  entityCounts: RebacGraphStorageReceipt["entityCounts"];
}

interface StoredRebacJobs {
  version: "rebac-job-state:v1";
  storedAt: string;
  jobsHash: string;
  jobs: RebacJobSnapshot;
  entityCounts: RebacJobStorageReceipt["entityCounts"];
}

interface StoredAuditEventRecord {
  version: "rebac-audit-event-record:v1";
  sequence: number;
  storedAt: string;
  eventHash: string;
  previousEventHash?: string;
  event: AuditEvent;
}

interface ReadAuditEventRecordsResult {
  records: StoredAuditEventRecord[];
  findings: AuditIntegrityReport["findings"];
}

interface StoredRebacState {
  version: "rebac-runtime-state:v1";
  storedAt: string;
  stateHash: string;
  state: RebacSeedData;
  entityCounts: RebacStateStorageReceipt["entityCounts"];
}

export class LocalFileEvidenceRepository implements AuditEventRepository, EvidencePackageRepository {
  readonly #rootDir: string;
  readonly #auditPath: string;
  readonly #evidenceDir: string;

  constructor(options: LocalFileEvidenceRepositoryOptions) {
    this.#rootDir = options.rootDir;
    this.#auditPath = join(this.#rootDir, "audit-events.jsonl");
    this.#evidenceDir = join(this.#rootDir, "evidence-packages");
    mkdirSync(this.#evidenceDir, { recursive: true });
  }

  appendAuditEvent(event: AuditEvent, storedAt: string): AuditStorageReceipt {
    const sequence = this.listAuditEvents().length + 1;
    appendFileSync(this.#auditPath, `${stableStringify(event)}\n`, "utf8");

    return {
      eventId: event.eventId,
      sequence,
      eventHash: auditEventHash(event),
      previousEventHash: event.previousEventHash,
      storedAt,
      backend: "local_file",
      location: "audit-events.jsonl",
      immutable: false,
      version: "audit-storage-receipt:v1"
    };
  }

  listAuditEvents(): AuditEvent[] {
    if (!existsSync(this.#auditPath)) {
      return [];
    }

    const lines = readFileSync(this.#auditPath, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    return lines.map((line) => JSON.parse(line) as AuditEvent);
  }

  verifyIntegrity(verifiedAt: string): AuditIntegrityReport {
    return verifyAuditChain(this.listAuditEvents(), verifiedAt);
  }

  writeEvidenceExport(evidence: EvidenceExport, storedAt: string): EvidenceStorageReceipt {
    const filename = `${sanitizeFileSegment(evidence.exportId)}.json`;
    const location = join(this.#evidenceDir, filename);
    const packageHash = evidence.integrityManifest.packageHash;
    const receipt: EvidenceStorageReceipt = {
      exportId: evidence.exportId,
      packageHash,
      storedAt,
      backend: "local_file",
      location: `evidence-packages/${filename}`,
      immutable: false,
      version: "evidence-storage-receipt:v1"
    };
    const storedEvidence: EvidenceExport = {
      ...evidence,
      storageReceipt: receipt
    };
    mkdirSync(dirname(location), { recursive: true });
    writeFileSync(location, `${stableStringify(storedEvidence)}\n`, "utf8");
    return receipt;
  }

  readEvidenceExport(exportId: string): EvidenceExport | undefined {
    const location = join(this.#evidenceDir, `${sanitizeFileSegment(exportId)}.json`);

    if (!existsSync(location)) {
      return undefined;
    }

    return JSON.parse(readFileSync(location, "utf8")) as EvidenceExport;
  }
}

export class LocalAppendOnlyAuditRepository implements DescribedAuditEventRepository {
  readonly #auditPath: string;
  readonly #location: string;
  readonly #retentionDays: number;

  constructor(options: LocalAppendOnlyAuditRepositoryOptions) {
    this.#auditPath = options.auditPath ?? join(requiredRootDir(options, "LocalAppendOnlyAuditRepository"), "append-only-audit-events.jsonl");
    this.#location = basename(this.#auditPath);
    this.#retentionDays = options.retentionDays ?? 365;
    mkdirSync(dirname(this.#auditPath), { recursive: true });
  }

  describePersistence(): PersistenceBackendDescriptor {
    return {
      component: "audit",
      backend: "local_file",
      durable: false,
      immutable: false,
      capabilities: ["audit_append", "audit_hash_chain", "audit_retention"],
      retentionDays: this.#retentionDays,
      location: this.#location,
      version: "persistence-backend:v1"
    };
  }

  appendAuditEvent(event: AuditEvent, storedAt: string): AuditStorageReceipt {
    const { records, findings } = this.#readRecords();
    assertStoredAuditRecords(records, findings);

    if (records.some((record) => record.event.eventId === event.eventId)) {
      throw new Error(`Audit event ${event.eventId} has already been appended.`);
    }

    const previousRecord = records.at(-1);
    const expectedPreviousEventHash = previousRecord?.eventHash;

    if (event.previousEventHash !== expectedPreviousEventHash) {
      throw new Error("Audit event previousEventHash does not match the current append-only tail.");
    }

    const eventHash = auditEventHash(event);
    const record: StoredAuditEventRecord = {
      version: "rebac-audit-event-record:v1",
      sequence: records.length + 1,
      storedAt,
      eventHash,
      previousEventHash: event.previousEventHash,
      event: clone(event)
    };
    appendFileSync(this.#auditPath, `${stableStringify(record)}\n`, "utf8");

    return {
      eventId: event.eventId,
      sequence: record.sequence,
      eventHash,
      previousEventHash: event.previousEventHash,
      storedAt,
      backend: "local_file",
      location: this.#location,
      immutable: false,
      version: "audit-storage-receipt:v1"
    };
  }

  listAuditEvents(): AuditEvent[] {
    const { records, findings } = this.#readRecords();
    assertStoredAuditRecords(records, findings);
    return clone(records.map((record) => record.event));
  }

  verifyIntegrity(verifiedAt: string): AuditIntegrityReport {
    const { records, findings } = this.#readRecords();
    const events = records.map((record) => record.event);
    const report = verifyAuditChain(events, verifiedAt);
    const recordFindings = [...findings, ...auditRecordIntegrityFindings(records)];

    return {
      ...report,
      status: report.status === "verified" && recordFindings.length === 0 ? "verified" : "failed",
      findings: [...recordFindings, ...report.findings]
    };
  }

  #readRecords(): ReadAuditEventRecordsResult {
    if (!existsSync(this.#auditPath)) {
      return { records: [], findings: [] };
    }

    const lines = readFileSync(this.#auditPath, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const records: StoredAuditEventRecord[] = [];
    const findings: AuditIntegrityReport["findings"] = [];

    for (const [index, line] of lines.entries()) {
      try {
        records.push(JSON.parse(line) as StoredAuditEventRecord);
      } catch (error) {
        findings.push({
          code: "MALFORMED_RECORD",
          message: `Stored audit record line ${index + 1} is not valid JSON.`,
          severity: "critical",
          expected: "valid JSONL audit record",
          actual: error instanceof Error ? error.message : "unparseable audit record"
        });
      }
    }

    return { records, findings };
  }
}

export class LocalJsonFileGraphRepository implements RebacGraphRepository, DescribedPersistenceRepository {
  readonly #graphPath: string;
  readonly #location: string;
  readonly #now: () => string;
  #graph: RebacGraphSnapshot;

  constructor(options: LocalJsonFileGraphRepositoryOptions) {
    this.#graphPath = options.graphPath ?? join(requiredRootDir(options, "LocalJsonFileGraphRepository"), "graph-state.json");
    this.#location = basename(this.#graphPath);
    this.#now = options.now ?? (() => new Date().toISOString());
    mkdirSync(dirname(this.#graphPath), { recursive: true });
    this.#graph = this.#readGraph() ?? emptyGraphSnapshot();
  }

  describePersistence(): PersistenceBackendDescriptor {
    return {
      component: "graph",
      backend: "local_file",
      durable: false,
      immutable: false,
      capabilities: ["graph_read", "graph_write", "relationship_query", "native_grant_readback", "backup_restore"],
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

  #readGraph(): RebacGraphSnapshot | undefined {
    if (!existsSync(this.#graphPath)) {
      return undefined;
    }

    const parsed = JSON.parse(readFileSync(this.#graphPath, "utf8")) as Partial<StoredRebacGraph>;

    if (!isStoredRebacGraph(parsed)) {
      throw new Error("ReBAC graph state must use the rebac-graph-state:v1 envelope.");
    }

    assertStoredGraphIntegrity(parsed);
    return normalizeGraphSnapshot(parsed.graph);
  }

  #persist(storedAt: string): RebacGraphStorageReceipt {
    const graph = normalizeGraphSnapshot(this.#graph);
    const graphHash = `sha256:${stableHash(graph)}`;
    const entityCounts = countGraphEntities(graph);
    const stored: StoredRebacGraph = {
      version: "rebac-graph-state:v1",
      storedAt,
      graphHash,
      graph,
      entityCounts
    };
    const tempPath = `${this.#graphPath}.${process.pid}.${Date.now()}.tmp`;
    mkdirSync(dirname(this.#graphPath), { recursive: true });
    writeFileSync(tempPath, `${stableStringify(stored)}\n`, "utf8");
    renameSync(tempPath, this.#graphPath);
    this.#graph = graph;

    return {
      storedAt,
      backend: "local_file",
      location: this.#location,
      graphHash,
      entityCounts,
      version: "rebac-graph-storage-receipt:v1"
    };
  }
}

export class LocalJsonFileJobRepository implements RebacJobRepository, DescribedPersistenceRepository {
  readonly #jobsPath: string;
  readonly #location: string;
  readonly #now: () => string;
  #jobs: RebacJobSnapshot;

  constructor(options: LocalJsonFileJobRepositoryOptions) {
    this.#jobsPath = options.jobsPath ?? join(requiredRootDir(options, "LocalJsonFileJobRepository"), "job-state.json");
    this.#location = basename(this.#jobsPath);
    this.#now = options.now ?? (() => new Date().toISOString());
    mkdirSync(dirname(this.#jobsPath), { recursive: true });
    this.#jobs = this.#readJobs() ?? emptyJobSnapshot();
  }

  describePersistence(): PersistenceBackendDescriptor {
    return {
      component: "job",
      backend: "local_file",
      durable: false,
      immutable: false,
      capabilities: ["job_enqueue", "idempotency_lookup", "transactional_writes", "backup_restore"],
      location: this.#location,
      version: "persistence-backend:v1"
    };
  }

  recordDiscoveryRun(run: DiscoveryRun): DiscoveryRun {
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
    this.#jobs.driftFindings = upsertById(this.#jobs.driftFindings, clone(finding));
    this.#persist(this.#now());
    return clone(finding);
  }

  getDriftFinding(id: CanonicalId): DriftFinding | undefined {
    return cloneOptional(this.#jobs.driftFindings.find((finding) => finding.id === id));
  }

  listDriftFindings(filter: DriftFindingFilter = {}): DriftFinding[] {
    return clone(this.#jobs.driftFindings.filter((finding) => !filter.severity || finding.severity === filter.severity));
  }

  recordReconciliationRun(run: ReconciliationRun): ReconciliationRun {
    this.#jobs.reconciliationRuns = appendUniqueById(this.#jobs.reconciliationRuns, clone(run), "Reconciliation run");
    this.#persist(this.#now());
    return clone(run);
  }

  listReconciliationRuns(): ReconciliationRun[] {
    return clone(this.#jobs.reconciliationRuns);
  }

  recordDecision(decision: DecisionResult): DecisionResult {
    this.#jobs.decisions = upsertByDecisionId(this.#jobs.decisions, clone(decision));
    this.#persist(this.#now());
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

  #readJobs(): RebacJobSnapshot | undefined {
    if (!existsSync(this.#jobsPath)) {
      return undefined;
    }

    const parsed = JSON.parse(readFileSync(this.#jobsPath, "utf8")) as Partial<StoredRebacJobs> | RebacJobSnapshot;

    if (!isStoredRebacJobs(parsed)) {
      throw new Error("ReBAC job state must use the rebac-job-state:v1 envelope.");
    }

    assertStoredJobsIntegrity(parsed);
    return normalizeJobSnapshot(parsed.jobs);
  }

  #persist(storedAt: string): RebacJobStorageReceipt {
    const jobs = normalizeJobSnapshot(this.#jobs);
    const jobsHash = `sha256:${stableHash(jobs)}`;
    const entityCounts = countJobEntities(jobs);
    const stored: StoredRebacJobs = {
      version: "rebac-job-state:v1",
      storedAt,
      jobsHash,
      jobs,
      entityCounts
    };
    const tempPath = `${this.#jobsPath}.${process.pid}.${Date.now()}.tmp`;
    mkdirSync(dirname(this.#jobsPath), { recursive: true });
    writeFileSync(tempPath, `${stableStringify(stored)}\n`, "utf8");
    renameSync(tempPath, this.#jobsPath);
    this.#jobs = jobs;

    return {
      storedAt,
      backend: "local_file",
      location: this.#location,
      jobsHash,
      entityCounts,
      version: "rebac-job-storage-receipt:v1"
    };
  }
}

export class LocalJsonFileStateRepository implements RebacStateRepository {
  readonly #statePath: string;
  readonly #location: string;

  constructor(options: LocalJsonFileStateRepositoryOptions) {
    this.#statePath = options.statePath ?? join(requiredRootDir(options, "LocalJsonFileStateRepository"), "runtime-state.json");
    this.#location = basename(this.#statePath);
    mkdirSync(dirname(this.#statePath), { recursive: true });
  }

  readState(): RebacSeedData | undefined {
    if (!existsSync(this.#statePath)) {
      return undefined;
    }

    const parsed = JSON.parse(readFileSync(this.#statePath, "utf8")) as Partial<StoredRebacState> | RebacSeedData;

    if (isStoredRebacState(parsed)) {
      assertStoredStateIntegrity(parsed);
      return parsed.state;
    }

    return migrateLegacyRuntimeState(parsed);
  }

  writeState(state: RebacSeedData, storedAt: string): RebacStateStorageReceipt {
    const stateHash = `sha256:${stableHash(state)}`;
    const entityCounts = countStateEntities(state);
    const stored: StoredRebacState = {
      version: "rebac-runtime-state:v1",
      storedAt,
      stateHash,
      state,
      entityCounts
    };
    const tempPath = `${this.#statePath}.${process.pid}.${Date.now()}.tmp`;
    mkdirSync(dirname(this.#statePath), { recursive: true });
    writeFileSync(tempPath, `${stableStringify(stored)}\n`, "utf8");
    renameSync(tempPath, this.#statePath);

    return {
      storedAt,
      backend: "local_file",
      location: this.#location,
      stateHash,
      entityCounts,
      version: "rebac-state-storage-receipt:v1"
    };
  }
}

function sanitizeFileSegment(value: string): string {
  return value.replaceAll(/[^a-z0-9_-]/gi, "_");
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function requiredRootDir(
  options:
    | LocalAppendOnlyAuditRepositoryOptions
    | LocalJsonFileGraphRepositoryOptions
    | LocalJsonFileJobRepositoryOptions
    | LocalJsonFileStateRepositoryOptions,
  repositoryName: string
): string {
  if (!options.rootDir) {
    throw new Error(`${repositoryName} requires rootDir or an explicit file path`);
  }

  return options.rootDir;
}

function isStoredRebacGraph(value: Partial<StoredRebacGraph> | RebacGraphSnapshot): value is StoredRebacGraph {
  return (
    typeof (value as StoredRebacGraph).version === "string" &&
    (value as StoredRebacGraph).version === "rebac-graph-state:v1" &&
    typeof (value as StoredRebacGraph).graph === "object" &&
    (value as StoredRebacGraph).graph !== null
  );
}

function isStoredRebacJobs(value: Partial<StoredRebacJobs> | RebacJobSnapshot): value is StoredRebacJobs {
  return (
    typeof (value as StoredRebacJobs).version === "string" &&
    (value as StoredRebacJobs).version === "rebac-job-state:v1" &&
    typeof (value as StoredRebacJobs).jobs === "object" &&
    (value as StoredRebacJobs).jobs !== null
  );
}

function isStoredRebacState(value: Partial<StoredRebacState> | RebacSeedData): value is StoredRebacState {
  return (
    typeof (value as StoredRebacState).version === "string" &&
    (value as StoredRebacState).version === "rebac-runtime-state:v1" &&
    typeof (value as StoredRebacState).state === "object" &&
    (value as StoredRebacState).state !== null
  );
}

function assertStoredJobsIntegrity(stored: StoredRebacJobs): void {
  const expectedJobsHash = `sha256:${stableHash(stored.jobs)}`;

  if (stored.jobsHash !== expectedJobsHash) {
    throw new Error("ReBAC job state hash does not match the stored job payload.");
  }
}

function assertStoredGraphIntegrity(stored: StoredRebacGraph): void {
  const expectedGraphHash = `sha256:${stableHash(stored.graph)}`;

  if (stored.graphHash !== expectedGraphHash) {
    throw new Error("ReBAC graph state hash does not match the stored graph payload.");
  }
}

function assertStoredAuditRecords(
  records: StoredAuditEventRecord[],
  parseFindings: AuditIntegrityReport["findings"] = []
): void {
  const findings = [...parseFindings, ...auditRecordIntegrityFindings(records)];

  if (findings.length > 0) {
    throw new Error(`Stored audit log integrity check failed: ${findings[0]?.message ?? "unknown finding"}`);
  }
}

function assertStoredStateIntegrity(stored: StoredRebacState): void {
  const expectedStateHash = `sha256:${stableHash(stored.state)}`;

  if (stored.stateHash !== expectedStateHash) {
    throw new Error("ReBAC runtime state hash does not match the stored state payload.");
  }
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

function emptyGraphSnapshot(): RebacGraphSnapshot {
  return {
    subjects: [],
    resources: [],
    relationships: [],
    nativeGrants: []
  };
}

function normalizeJobSnapshot(jobs: Partial<RebacJobSnapshot>): RebacJobSnapshot {
  return {
    discoveryRuns: clone(jobs.discoveryRuns ?? []),
    enforcementReadinessReports: clone(jobs.enforcementReadinessReports ?? []),
    provisioningPlans: clone(jobs.provisioningPlans ?? []),
    provisioningJobs: clone(jobs.provisioningJobs ?? []),
    driftFindings: clone(jobs.driftFindings ?? []),
    reconciliationRuns: clone(jobs.reconciliationRuns ?? []),
    decisions: clone(jobs.decisions ?? [])
  };
}

function auditRecordIntegrityFindings(records: StoredAuditEventRecord[]): AuditIntegrityReport["findings"] {
  return records.flatMap((record, index) => {
    const findings: AuditIntegrityReport["findings"] = [];
    const expectedSequence = index + 1;
    const expectedEventHash = auditEventHash(record.event);

    if (record.sequence !== expectedSequence) {
      findings.push({
        code: "AUDIT_RECORD_SEQUENCE_MISMATCH",
        message: "Stored audit record sequence does not match append-only order.",
        severity: "critical",
        eventId: record.event.eventId,
        expected: String(expectedSequence),
        actual: String(record.sequence)
      });
    }

    if (record.eventHash !== expectedEventHash) {
      findings.push({
        code: "AUDIT_RECORD_HASH_MISMATCH",
        message: "Stored audit record hash does not match the current event payload.",
        severity: "critical",
        eventId: record.event.eventId,
        expected: expectedEventHash,
        actual: record.eventHash
      });
    }

    if (record.previousEventHash !== record.event.previousEventHash) {
      findings.push({
        code: "AUDIT_RECORD_PREVIOUS_HASH_MISMATCH",
        message: "Stored audit record previous hash does not match the event previousEventHash.",
        severity: "critical",
        eventId: record.event.eventId,
        expected: record.event.previousEventHash ?? "<none>",
        actual: record.previousEventHash ?? "<none>"
      });
    }

    return findings;
  });
}

function upsertByDecisionId(items: DecisionResult[], item: DecisionResult): DecisionResult[] {
  const index = items.findIndex((entry) => entry.decisionId === item.decisionId);

  if (index === -1) {
    return [...items, item];
  }

  return items.map((entry, entryIndex) => (entryIndex === index ? item : entry));
}

function normalizeGraphSnapshot(graph: Partial<RebacGraphSnapshot>): RebacGraphSnapshot {
  return {
    subjects: clone(graph.subjects ?? []),
    resources: clone(graph.resources ?? []),
    relationships: clone(graph.relationships ?? []),
    nativeGrants: clone(graph.nativeGrants ?? [])
  };
}

function upsertById<T extends { id: CanonicalId }>(items: T[], item: T): T[] {
  const index = items.findIndex((entry) => entry.id === item.id);

  if (index === -1) {
    return [...items, item];
  }

  return items.map((entry, entryIndex) => (entryIndex === index ? item : entry));
}

function appendUniqueById<T extends { id: CanonicalId }>(items: T[], item: T, entityName: string): T[] {
  if (items.some((entry) => entry.id === item.id)) {
    throw new Error(`${entityName} ${item.id} has already been recorded.`);
  }

  return [...items, item];
}

function countJobEntities(jobs: RebacJobSnapshot): RebacJobStorageReceipt["entityCounts"] {
  return {
    discoveryRuns: jobs.discoveryRuns.length,
    enforcementReadinessReports: jobs.enforcementReadinessReports.length,
    provisioningPlans: jobs.provisioningPlans.length,
    provisioningJobs: jobs.provisioningJobs.length,
    driftFindings: jobs.driftFindings.length,
    reconciliationRuns: jobs.reconciliationRuns.length,
    decisions: jobs.decisions.length
  };
}

function countGraphEntities(graph: RebacGraphSnapshot): RebacGraphStorageReceipt["entityCounts"] {
  return {
    subjects: graph.subjects.length,
    resources: graph.resources.length,
    relationships: graph.relationships.length,
    nativeGrants: graph.nativeGrants.length
  };
}

function countStateEntities(state: RebacSeedData): RebacStateStorageReceipt["entityCounts"] {
  return {
    subjects: state.subjects?.length ?? 0,
    resources: state.resources?.length ?? 0,
    relationships: state.relationships?.length ?? 0,
    nativeGrants: state.nativeGrants?.length ?? 0,
    discoveryRuns: state.discoveryRuns?.length ?? 0,
    enforcementReadinessReports: state.enforcementReadinessReports?.length ?? 0,
    provisioningPlans: state.provisioningPlans?.length ?? 0,
    provisioningJobs: state.provisioningJobs?.length ?? 0,
    driftFindings: state.driftFindings?.length ?? 0,
    reconciliationRuns: state.reconciliationRuns?.length ?? 0,
    decisions: state.decisions?.length ?? 0,
    auditEvents: state.auditEvents?.length ?? 0,
    persistenceDegradations: state.persistenceDegradations?.length ?? 0
  };
}

function migrateLegacyRuntimeState(value: unknown): RebacSeedData {
  if (!isRecord(value)) {
    throw new Error("ReBAC runtime state must use the rebac-runtime-state:v1 envelope or a legacy state object.");
  }

  const allowedKeys = new Set([
    "subjects",
    "resources",
    "relationships",
    "nativeGrants",
    "discoveryRuns",
    "enforcementReadinessReports",
    "provisioningPlans",
    "provisioningJobs",
    "driftFindings",
    "reconciliationRuns",
    "decisions",
    "auditEvents",
    "persistenceDegradations"
  ]);

  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Legacy ReBAC runtime state contains unsupported field: ${key}`);
    }

    const items = value[key];
    if (!Array.isArray(items)) {
      throw new Error(`Legacy ReBAC runtime state field ${key} must be an array.`);
    }

    items.forEach((item, index) => {
      if (!isRecord(item)) {
        throw new Error(`Legacy ReBAC runtime state field ${key} item ${index} must be an object.`);
      }
    });
  }

  return value as RebacSeedData;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneOptional<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : clone(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
