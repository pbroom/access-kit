import type {
  AuditIntegrityReport,
  CanonicalId,
  DecisionResult,
  DiscoveryRun,
  DriftFinding,
  EnforcementReadinessReport,
  JsonRecord,
  NativeGrant,
  ProvisioningJob,
  ProvisioningPlan,
  ReconciliationRun,
  RelationshipTuple,
  Resource,
  Subject,
  ValidationCheckStatus
} from "./domain.js";
import type { AuditEventRepository } from "./repositories.js";
import { InMemoryRebacStore, type RebacSeedData } from "./store.js";

export type PersistenceComponent = "graph" | "audit" | "job";
export type PersistenceBackendKind =
  | "memory"
  | "local_file"
  | "external_graph"
  | "external_append_only_audit"
  | "external_queue";
export type PersistenceReadinessStatus = "ready" | "blocked";
export type PersistenceCapability =
  | "graph_read"
  | "graph_write"
  | "relationship_query"
  | "native_grant_readback"
  | "audit_append"
  | "audit_hash_chain"
  | "audit_immutability"
  | "audit_retention"
  | "job_enqueue"
  | "idempotency_lookup"
  | "transactional_writes"
  | "backup_restore";

export interface PersistenceBackendDescriptor {
  component: PersistenceComponent;
  backend: PersistenceBackendKind;
  durable: boolean;
  immutable: boolean;
  capabilities: PersistenceCapability[];
  retentionDays?: number;
  location?: string;
  version: "persistence-backend:v1";
}

export interface PersistenceReadinessCheck {
  name: string;
  component: PersistenceComponent;
  status: ValidationCheckStatus;
  message: string;
  evidence?: JsonRecord;
}

export interface PersistenceReadinessReport {
  status: PersistenceReadinessStatus;
  checkedAt: string;
  checks: PersistenceReadinessCheck[];
  descriptors: PersistenceBackendDescriptor[];
  requiredCapabilities: Record<PersistenceComponent, PersistenceCapability[]>;
  version: "persistence-readiness:v1";
}

export interface RebacGraphSnapshot {
  subjects: Subject[];
  resources: Resource[];
  relationships: RelationshipTuple[];
  nativeGrants: NativeGrant[];
}

export interface RebacJobSnapshot {
  discoveryRuns: DiscoveryRun[];
  enforcementReadinessReports: EnforcementReadinessReport[];
  provisioningPlans: ProvisioningPlan[];
  provisioningJobs: ProvisioningJob[];
  driftFindings: DriftFinding[];
  reconciliationRuns: ReconciliationRun[];
  decisions: DecisionResult[];
}

export type RelationshipFilter = Partial<Pick<RelationshipTuple, "subjectId" | "objectId" | "relation">>;
export type NativeGrantFilter = Partial<
  Pick<NativeGrant, "sourceConnectorId" | "targetObjectId" | "subjectId" | "nativePermission" | "status" | "grantType" | "principalType">
>;
export type DiscoveryRunFilter = Partial<Pick<DiscoveryRun, "connectorId" | "status">>;
export type EnforcementReadinessReportFilter = Partial<Pick<EnforcementReadinessReport, "connectorId" | "status">>;
export type DriftFindingFilter = Partial<Pick<DriftFinding, "severity">>;

export interface RebacGraphRepository {
  getSubject(id: CanonicalId): Subject | undefined;
  listSubjects(): Subject[];
  upsertSubject(subject: Subject): Subject;
  getResource(id: CanonicalId): Resource | undefined;
  listResources(): Resource[];
  upsertResource(resource: Resource): Resource;
  getRelationship(id: CanonicalId): RelationshipTuple | undefined;
  listRelationships(filter?: RelationshipFilter): RelationshipTuple[];
  upsertRelationship(relationship: RelationshipTuple): RelationshipTuple;
  deleteRelationship(id: CanonicalId, deletedAt: string): RelationshipTuple | undefined;
  listNativeGrants(filter?: NativeGrantFilter): NativeGrant[];
  upsertNativeGrant(grant: NativeGrant): NativeGrant;
  exportGraph(): RebacGraphSnapshot;
}

export interface RebacJobRepository {
  recordDiscoveryRun(run: DiscoveryRun): DiscoveryRun;
  listDiscoveryRuns(filter?: DiscoveryRunFilter): DiscoveryRun[];
  recordEnforcementReadinessReport(report: EnforcementReadinessReport): EnforcementReadinessReport;
  getEnforcementReadinessReport(id: CanonicalId): EnforcementReadinessReport | undefined;
  listEnforcementReadinessReports(filter?: EnforcementReadinessReportFilter): EnforcementReadinessReport[];
  upsertProvisioningPlan(plan: ProvisioningPlan): ProvisioningPlan;
  getProvisioningPlan(id: CanonicalId): ProvisioningPlan | undefined;
  getProvisioningPlanByIdempotencyKey(idempotencyKey: string): ProvisioningPlan | undefined;
  listProvisioningPlans(): ProvisioningPlan[];
  upsertProvisioningJob(job: ProvisioningJob): ProvisioningJob;
  getProvisioningJob(id: CanonicalId): ProvisioningJob | undefined;
  getProvisioningJobByIdempotencyKey(idempotencyKey: string): ProvisioningJob | undefined;
  listProvisioningJobs(): ProvisioningJob[];
  upsertDriftFinding(finding: DriftFinding): DriftFinding;
  listDriftFindings(filter?: DriftFindingFilter): DriftFinding[];
  recordReconciliationRun(run: ReconciliationRun): ReconciliationRun;
  listReconciliationRuns(): ReconciliationRun[];
  recordDecision(decision: DecisionResult): DecisionResult;
  listDecisions(): DecisionResult[];
  exportJobs(): RebacJobSnapshot;
}

export interface PersistentRebacRepositorySet {
  graph: RebacGraphRepository;
  audit: AuditEventRepository;
  jobs: RebacJobRepository;
}

export interface DescribedPersistenceRepository {
  describePersistence(): PersistenceBackendDescriptor;
}

export interface DescribedAuditEventRepository extends AuditEventRepository, DescribedPersistenceRepository {
  verifyIntegrity(verifiedAt: string): AuditIntegrityReport;
}

export const requiredProductionPersistenceCapabilities: Record<PersistenceComponent, PersistenceCapability[]> = {
  graph: ["graph_read", "graph_write", "relationship_query", "transactional_writes", "backup_restore"],
  audit: ["audit_append", "audit_hash_chain", "audit_immutability", "audit_retention", "backup_restore"],
  job: ["job_enqueue", "idempotency_lookup", "transactional_writes", "backup_restore"]
};

export class InMemoryRebacPersistenceRepository implements RebacGraphRepository, RebacJobRepository, DescribedPersistenceRepository {
  readonly #store: InMemoryRebacStore;

  constructor(seed: RebacSeedData = {}) {
    this.#store = new InMemoryRebacStore(clone(seed));
  }

  describePersistence(): PersistenceBackendDescriptor {
    return {
      component: "graph",
      backend: "memory",
      durable: false,
      immutable: false,
      capabilities: ["graph_read", "graph_write", "relationship_query", "native_grant_readback"],
      version: "persistence-backend:v1"
    };
  }

  getSubject(id: CanonicalId): Subject | undefined {
    return cloneOptional(this.#store.getSubject(id));
  }

  listSubjects(): Subject[] {
    return clone(this.#store.listSubjects());
  }

  upsertSubject(subject: Subject): Subject {
    return clone(this.#store.upsertSubject(clone(subject)));
  }

  getResource(id: CanonicalId): Resource | undefined {
    return cloneOptional(this.#store.getResource(id));
  }

  listResources(): Resource[] {
    return clone(this.#store.listResources());
  }

  upsertResource(resource: Resource): Resource {
    return clone(this.#store.upsertResource(clone(resource)));
  }

  getRelationship(id: CanonicalId): RelationshipTuple | undefined {
    return cloneOptional(this.#store.getRelationship(id));
  }

  listRelationships(filter: RelationshipFilter = {}): RelationshipTuple[] {
    return clone(this.#store.listRelationships(filter));
  }

  upsertRelationship(relationship: RelationshipTuple): RelationshipTuple {
    return clone(this.#store.upsertRelationship(clone(relationship)));
  }

  deleteRelationship(id: CanonicalId, deletedAt: string): RelationshipTuple | undefined {
    return cloneOptional(this.#store.deleteRelationship(id, deletedAt));
  }

  listNativeGrants(filter: NativeGrantFilter = {}): NativeGrant[] {
    return clone(this.#store.listNativeGrants(filter));
  }

  upsertNativeGrant(grant: NativeGrant): NativeGrant {
    return clone(this.#store.upsertNativeGrant(clone(grant)));
  }

  recordDiscoveryRun(run: DiscoveryRun): DiscoveryRun {
    return clone(this.#store.recordDiscoveryRun(clone(run)));
  }

  listDiscoveryRuns(filter: DiscoveryRunFilter = {}): DiscoveryRun[] {
    return clone(this.#store.listDiscoveryRuns(filter));
  }

  recordEnforcementReadinessReport(report: EnforcementReadinessReport): EnforcementReadinessReport {
    return clone(this.#store.recordEnforcementReadinessReport(clone(report)));
  }

  getEnforcementReadinessReport(id: CanonicalId): EnforcementReadinessReport | undefined {
    return cloneOptional(this.#store.getEnforcementReadinessReport(id));
  }

  listEnforcementReadinessReports(filter: EnforcementReadinessReportFilter = {}): EnforcementReadinessReport[] {
    return clone(this.#store.listEnforcementReadinessReports(filter));
  }

  upsertProvisioningPlan(plan: ProvisioningPlan): ProvisioningPlan {
    return clone(this.#store.upsertProvisioningPlan(clone(plan)));
  }

  getProvisioningPlan(id: CanonicalId): ProvisioningPlan | undefined {
    return cloneOptional(this.#store.getProvisioningPlan(id));
  }

  getProvisioningPlanByIdempotencyKey(idempotencyKey: string): ProvisioningPlan | undefined {
    return cloneOptional(this.#store.getProvisioningPlanByIdempotencyKey(idempotencyKey));
  }

  listProvisioningPlans(): ProvisioningPlan[] {
    return clone(this.#store.listProvisioningPlans());
  }

  upsertProvisioningJob(job: ProvisioningJob): ProvisioningJob {
    return clone(this.#store.upsertProvisioningJob(clone(job)));
  }

  getProvisioningJob(id: CanonicalId): ProvisioningJob | undefined {
    return cloneOptional(this.#store.getProvisioningJob(id));
  }

  getProvisioningJobByIdempotencyKey(idempotencyKey: string): ProvisioningJob | undefined {
    return cloneOptional(this.#store.getProvisioningJobByIdempotencyKey(idempotencyKey));
  }

  listProvisioningJobs(): ProvisioningJob[] {
    return clone(this.#store.listProvisioningJobs());
  }

  upsertDriftFinding(finding: DriftFinding): DriftFinding {
    return clone(this.#store.upsertDriftFinding(clone(finding)));
  }

  listDriftFindings(filter: DriftFindingFilter = {}): DriftFinding[] {
    return clone(this.#store.listDriftFindings(filter));
  }

  recordReconciliationRun(run: ReconciliationRun): ReconciliationRun {
    return clone(this.#store.recordReconciliationRun(clone(run)));
  }

  listReconciliationRuns(): ReconciliationRun[] {
    return clone(this.#store.listReconciliationRuns());
  }

  recordDecision(decision: DecisionResult): DecisionResult {
    return clone(this.#store.recordDecision(clone(decision)));
  }

  listDecisions(): DecisionResult[] {
    return clone(this.#store.listDecisions());
  }

  exportGraph(): RebacGraphSnapshot {
    return {
      subjects: this.listSubjects(),
      resources: this.listResources(),
      relationships: this.listRelationships(),
      nativeGrants: this.listNativeGrants()
    };
  }

  exportJobs(): RebacJobSnapshot {
    return {
      discoveryRuns: this.listDiscoveryRuns(),
      enforcementReadinessReports: this.listEnforcementReadinessReports(),
      provisioningPlans: this.listProvisioningPlans(),
      provisioningJobs: this.listProvisioningJobs(),
      driftFindings: this.listDriftFindings(),
      reconciliationRuns: this.listReconciliationRuns(),
      decisions: this.listDecisions()
    };
  }

  exportSeedData(): RebacSeedData {
    return clone(this.#store.exportSeedData());
  }
}

export function assessPersistenceReadiness(
  descriptors: PersistenceBackendDescriptor[],
  checkedAt: string,
  requiredCapabilities: Record<PersistenceComponent, PersistenceCapability[]> = requiredProductionPersistenceCapabilities
): PersistenceReadinessReport {
  const checks: PersistenceReadinessCheck[] = [];
  const descriptorsByComponent = new Map<PersistenceComponent, PersistenceBackendDescriptor[]>();

  for (const descriptor of descriptors) {
    const componentDescriptors = descriptorsByComponent.get(descriptor.component) ?? [];
    componentDescriptors.push(descriptor);
    descriptorsByComponent.set(descriptor.component, componentDescriptors);
  }

  for (const component of Object.keys(requiredCapabilities) as PersistenceComponent[]) {
    const componentDescriptors = descriptorsByComponent.get(component) ?? [];
    const descriptor = componentDescriptors[0];

    if (componentDescriptors.length > 1) {
      checks.push({
        name: `${component}_repository_descriptor_unique`,
        component,
        status: "fail",
        message: `Multiple ${component} persistence backend descriptors are configured; exactly one is allowed.`,
        evidence: {
          count: componentDescriptors.length,
          backends: componentDescriptors.map((entry) => entry.backend)
        }
      });
    }

    if (!descriptor) {
      checks.push({
        name: `${component}_repository_present`,
        component,
        status: "fail",
        message: `No ${component} persistence backend is configured.`
      });
      continue;
    }

    checks.push({
      name: `${component}_repository_durable`,
      component,
      status: descriptor.durable ? "pass" : "fail",
      message: descriptor.durable
        ? `${component} persistence backend is durable.`
        : `${component} persistence backend is not durable.`,
      evidence: { backend: descriptor.backend, location: descriptor.location }
    });

    const missingCapabilities = requiredCapabilities[component].filter((capability) => !descriptor.capabilities.includes(capability));
    checks.push({
      name: `${component}_repository_capabilities`,
      component,
      status: missingCapabilities.length === 0 ? "pass" : "fail",
      message:
        missingCapabilities.length === 0
          ? `${component} persistence backend advertises required capabilities.`
          : `${component} persistence backend is missing required capabilities: ${missingCapabilities.join(", ")}.`,
      evidence: {
        advertised: descriptor.capabilities,
        missing: missingCapabilities
      }
    });

    if (component === "audit") {
      checks.push({
        name: "audit_repository_immutable",
        component,
        status: descriptor.immutable ? "pass" : "fail",
        message: descriptor.immutable
          ? "Audit persistence backend claims immutability controls."
          : "Audit persistence backend does not claim immutability controls.",
        evidence: { backend: descriptor.backend }
      });

      checks.push({
        name: "audit_repository_retention",
        component,
        status: typeof descriptor.retentionDays === "number" && descriptor.retentionDays >= 365 ? "pass" : "fail",
        message:
          typeof descriptor.retentionDays === "number" && descriptor.retentionDays >= 365
            ? "Audit persistence backend declares at least one year of retention."
            : "Audit persistence backend must declare retention of at least one year.",
        evidence: { retentionDays: descriptor.retentionDays }
      });
    }
  }

  return {
    status: checks.every((check) => check.status === "pass") ? "ready" : "blocked",
    checkedAt,
    checks,
    descriptors: clone(descriptors),
    requiredCapabilities: clone(requiredCapabilities),
    version: "persistence-readiness:v1"
  };
}

function cloneOptional<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : clone(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
