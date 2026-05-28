import type {
  AccessReviewCampaign,
  AuditEvent,
  CanonicalId,
  DecisionResult,
  DiscoveryRun,
  EnforcementReadinessReport,
  ExceptionRequest,
  DriftFinding,
  GovernanceFinding,
  NativeGrant,
  PersistenceDegradationReceipt,
  ProvisioningJob,
  ProvisioningPlan,
  ReconciliationRun,
  RelationshipTuple,
  Resource,
  Subject
} from "./domain.js";
import { matchesDriftFindingFilter } from "./drift-finding-filter.js";
import type { DriftFindingFilter } from "./persistence.js";

export interface RebacSeedData {
  subjects?: Subject[];
  resources?: Resource[];
  relationships?: RelationshipTuple[];
  nativeGrants?: NativeGrant[];
  discoveryRuns?: DiscoveryRun[];
  enforcementReadinessReports?: EnforcementReadinessReport[];
  provisioningPlans?: ProvisioningPlan[];
  provisioningJobs?: ProvisioningJob[];
  driftFindings?: DriftFinding[];
  accessReviewCampaigns?: AccessReviewCampaign[];
  governanceFindings?: GovernanceFinding[];
  exceptionRequests?: ExceptionRequest[];
  reconciliationRuns?: ReconciliationRun[];
  decisions?: DecisionResult[];
  auditEvents?: AuditEvent[];
  persistenceDegradations?: PersistenceDegradationReceipt[];
}

const MAX_PERSISTENCE_DEGRADATIONS = 20;
const emptyRelationships: readonly RelationshipTuple[] = [];

export interface RebacGraphSize {
  subjects: number;
  resources: number;
  relationships: number;
}

export class InMemoryRebacStore {
  readonly #subjects = new Map<CanonicalId, Subject>();
  readonly #resources = new Map<CanonicalId, Resource>();
  readonly #relationships = new Map<CanonicalId, RelationshipTuple>();
  readonly #relationshipsBySubject = new Map<CanonicalId, RelationshipTuple[]>();
  readonly #nativeGrants = new Map<CanonicalId, NativeGrant>();
  readonly #discoveryRuns = new Map<CanonicalId, DiscoveryRun>();
  readonly #enforcementReadinessReports = new Map<CanonicalId, EnforcementReadinessReport>();
  readonly #provisioningPlans = new Map<CanonicalId, ProvisioningPlan>();
  readonly #provisioningJobs = new Map<CanonicalId, ProvisioningJob>();
  readonly #driftFindings = new Map<CanonicalId, DriftFinding>();
  readonly #accessReviewCampaigns = new Map<CanonicalId, AccessReviewCampaign>();
  readonly #governanceFindings = new Map<CanonicalId, GovernanceFinding>();
  readonly #exceptionRequests = new Map<CanonicalId, ExceptionRequest>();
  readonly #reconciliationRuns = new Map<CanonicalId, ReconciliationRun>();
  readonly #decisions = new Map<CanonicalId, DecisionResult>();
  readonly #auditEvents: AuditEvent[] = [];
  readonly #persistenceDegradations: PersistenceDegradationReceipt[] = [];
  #relationshipRevision = 0;

  constructor(seed: RebacSeedData = {}) {
    seed.subjects?.forEach((subject) => this.upsertSubject(subject));
    seed.resources?.forEach((resource) => this.upsertResource(resource));
    seed.relationships?.forEach((relationship) => this.upsertRelationship(relationship));
    seed.nativeGrants?.forEach((grant) => this.upsertNativeGrant(grant));
    seed.discoveryRuns?.forEach((run) => this.recordDiscoveryRun(run));
    seed.enforcementReadinessReports?.forEach((report) => this.recordEnforcementReadinessReport(report));
    seed.provisioningPlans?.forEach((plan) => this.upsertProvisioningPlan(plan));
    seed.provisioningJobs?.forEach((job) => this.upsertProvisioningJob(job));
    seed.driftFindings?.forEach((finding) => this.upsertDriftFinding(finding));
    seed.accessReviewCampaigns?.forEach((campaign) => this.upsertAccessReviewCampaign(campaign));
    seed.governanceFindings?.forEach((finding) => this.upsertGovernanceFinding(finding));
    seed.exceptionRequests?.forEach((request) => this.upsertExceptionRequest(request));
    seed.reconciliationRuns?.forEach((run) => this.recordReconciliationRun(run));
    seed.decisions?.forEach((decision) => this.recordDecision(decision));
    seed.auditEvents?.forEach((event) => this.recordAuditEvent(event));
    seed.persistenceDegradations?.forEach((degradation) => this.recordPersistenceDegradation(degradation));
  }

  exportSeedData(): RebacSeedData {
    return {
      subjects: this.listSubjects(),
      resources: this.listResources(),
      relationships: this.listRelationships(),
      nativeGrants: this.listNativeGrants(),
      discoveryRuns: this.listDiscoveryRuns(),
      enforcementReadinessReports: this.listEnforcementReadinessReports(),
      provisioningPlans: this.listProvisioningPlans(),
      provisioningJobs: this.listProvisioningJobs(),
      driftFindings: this.listDriftFindings(),
      accessReviewCampaigns: this.listAccessReviewCampaigns(),
      governanceFindings: this.listGovernanceFindings(),
      exceptionRequests: this.listExceptionRequests(),
      reconciliationRuns: this.listReconciliationRuns(),
      decisions: this.listDecisions(),
      auditEvents: this.listAuditEvents(),
      persistenceDegradations: this.listPersistenceDegradations()
    };
  }

  graphSize(): RebacGraphSize {
    return {
      subjects: this.#subjects.size,
      resources: this.#resources.size,
      relationships: this.#relationships.size
    };
  }

  getSubject(id: CanonicalId): Subject | undefined {
    return this.#subjects.get(id);
  }

  listSubjects(): Subject[] {
    return [...this.#subjects.values()];
  }

  upsertSubject(subject: Subject): Subject {
    this.#subjects.set(subject.id, subject);
    return subject;
  }

  getResource(id: CanonicalId): Resource | undefined {
    return this.#resources.get(id);
  }

  listResources(): Resource[] {
    return [...this.#resources.values()];
  }

  upsertResource(resource: Resource): Resource {
    this.#resources.set(resource.id, resource);
    return resource;
  }

  getRelationship(id: CanonicalId): RelationshipTuple | undefined {
    return this.#relationships.get(id);
  }

  relationshipRevision(): number {
    return this.#relationshipRevision;
  }

  listRelationshipsForSubject(subjectId: CanonicalId): readonly RelationshipTuple[] {
    return this.#relationshipsBySubject.get(subjectId) ?? emptyRelationships;
  }

  listRelationships(filter: Partial<Pick<RelationshipTuple, "subjectId" | "objectId" | "relation">> = {}): RelationshipTuple[] {
    return [...this.#relationships.values()].filter((relationship) => {
      return (
        (!filter.subjectId || relationship.subjectId === filter.subjectId) &&
        (!filter.objectId || relationship.objectId === filter.objectId) &&
        (!filter.relation || relationship.relation === filter.relation)
      );
    });
  }

  upsertRelationship(relationship: RelationshipTuple): RelationshipTuple {
    const existing = this.#relationships.get(relationship.id);
    if (existing) {
      this.#removeRelationshipFromSubjectIndex(existing);
    }
    this.#relationships.set(relationship.id, relationship);
    this.#addRelationshipToSubjectIndex(relationship);
    this.#relationshipRevision += 1;
    return relationship;
  }

  deleteRelationship(id: CanonicalId, deletedAt: string): RelationshipTuple | undefined {
    const relationship = this.#relationships.get(id);

    if (!relationship) {
      return undefined;
    }

    const deleted: RelationshipTuple = {
      ...relationship,
      status: "deleted",
      updatedAt: deletedAt
    };
    this.#removeRelationshipFromSubjectIndex(relationship);
    this.#relationships.set(id, deleted);
    this.#addRelationshipToSubjectIndex(deleted);
    this.#relationshipRevision += 1;
    return deleted;
  }

  #addRelationshipToSubjectIndex(relationship: RelationshipTuple): void {
    const relationships = this.#relationshipsBySubject.get(relationship.subjectId);

    if (relationships) {
      relationships.push(relationship);
    } else {
      this.#relationshipsBySubject.set(relationship.subjectId, [relationship]);
    }
  }

  #removeRelationshipFromSubjectIndex(relationship: RelationshipTuple): void {
    const relationships = this.#relationshipsBySubject.get(relationship.subjectId);

    if (!relationships) {
      return;
    }

    const index = relationships.findIndex((entry) => entry.id === relationship.id);
    if (index !== -1) {
      relationships.splice(index, 1);
    }
    if (relationships.length === 0) {
      this.#relationshipsBySubject.delete(relationship.subjectId);
    }
  }

  listNativeGrants(
    filter: Partial<
      Pick<NativeGrant, "sourceConnectorId" | "targetObjectId" | "subjectId" | "nativePermission" | "status" | "grantType" | "principalType">
    > = {}
  ): NativeGrant[] {
    return [...this.#nativeGrants.values()].filter((grant) => {
      return (
        (!filter.sourceConnectorId || grant.sourceConnectorId === filter.sourceConnectorId) &&
        (!filter.targetObjectId || grant.targetObjectId === filter.targetObjectId) &&
        (!filter.subjectId || grant.subjectId === filter.subjectId) &&
        (!filter.nativePermission || grant.nativePermission === filter.nativePermission) &&
        (!filter.grantType || grant.grantType === filter.grantType) &&
        (!filter.principalType || grant.principalType === filter.principalType) &&
        (!filter.status || grant.status === filter.status)
      );
    });
  }

  upsertNativeGrant(grant: NativeGrant): NativeGrant {
    this.#nativeGrants.set(grant.id, grant);
    return grant;
  }

  replaceNativeGrantsForConnector(sourceConnectorId: CanonicalId, grants: NativeGrant[]): NativeGrant[] {
    for (const [id, grant] of this.#nativeGrants.entries()) {
      if (grant.sourceConnectorId === sourceConnectorId) {
        this.#nativeGrants.delete(id);
      }
    }

    grants.forEach((grant) => this.upsertNativeGrant(grant));
    return grants;
  }

  recordDiscoveryRun(run: DiscoveryRun): DiscoveryRun {
    assertNotRecorded(this.#discoveryRuns, run.id, "Discovery run");
    this.#discoveryRuns.set(run.id, run);
    return run;
  }

  listDiscoveryRuns(filter: Partial<Pick<DiscoveryRun, "connectorId" | "status">> = {}): DiscoveryRun[] {
    return [...this.#discoveryRuns.values()].filter((run) => {
      return (
        (!filter.connectorId || run.connectorId === filter.connectorId) &&
        (!filter.status || run.status === filter.status)
      );
    });
  }

  getEnforcementReadinessReport(id: CanonicalId): EnforcementReadinessReport | undefined {
    return this.#enforcementReadinessReports.get(id);
  }

  listEnforcementReadinessReports(filter: Partial<Pick<EnforcementReadinessReport, "connectorId" | "status">> = {}): EnforcementReadinessReport[] {
    return [...this.#enforcementReadinessReports.values()].filter((report) => {
      return (
        (!filter.connectorId || report.connectorId === filter.connectorId) &&
        (!filter.status || report.status === filter.status)
      );
    });
  }

  recordEnforcementReadinessReport(report: EnforcementReadinessReport): EnforcementReadinessReport {
    assertNotRecorded(this.#enforcementReadinessReports, report.id, "Enforcement readiness report");
    this.#enforcementReadinessReports.set(report.id, report);
    return report;
  }

  listProvisioningPlans(): ProvisioningPlan[] {
    return [...this.#provisioningPlans.values()];
  }

  getProvisioningPlan(id: CanonicalId): ProvisioningPlan | undefined {
    return this.#provisioningPlans.get(id);
  }

  getProvisioningPlanByIdempotencyKey(idempotencyKey: string): ProvisioningPlan | undefined {
    return [...this.#provisioningPlans.values()].find((plan) => plan.idempotencyKey === idempotencyKey);
  }

  upsertProvisioningPlan(plan: ProvisioningPlan): ProvisioningPlan {
    this.#provisioningPlans.set(plan.id, plan);
    return plan;
  }

  getProvisioningJob(id: CanonicalId): ProvisioningJob | undefined {
    return this.#provisioningJobs.get(id);
  }

  getProvisioningJobByIdempotencyKey(idempotencyKey: string): ProvisioningJob | undefined {
    return [...this.#provisioningJobs.values()].find((job) => job.idempotencyKey === idempotencyKey);
  }

  listProvisioningJobs(): ProvisioningJob[] {
    return [...this.#provisioningJobs.values()];
  }

  upsertProvisioningJob(job: ProvisioningJob): ProvisioningJob {
    this.#provisioningJobs.set(job.id, job);
    return job;
  }

  listDriftFindings(filter: DriftFindingFilter = {}): DriftFinding[] {
    return [...this.#driftFindings.values()].filter((finding) => matchesDriftFindingFilter(finding, filter));
  }

  getDriftFinding(id: CanonicalId): DriftFinding | undefined {
    return this.#driftFindings.get(id);
  }

  upsertDriftFinding(finding: DriftFinding): DriftFinding {
    this.#driftFindings.set(finding.id, finding);
    return finding;
  }

  listAccessReviewCampaigns(): AccessReviewCampaign[] {
    return [...this.#accessReviewCampaigns.values()];
  }

  getAccessReviewCampaign(id: CanonicalId): AccessReviewCampaign | undefined {
    return this.#accessReviewCampaigns.get(id);
  }

  upsertAccessReviewCampaign(campaign: AccessReviewCampaign): AccessReviewCampaign {
    this.#accessReviewCampaigns.set(campaign.id, campaign);
    return campaign;
  }

  listGovernanceFindings(filter: Partial<Pick<GovernanceFinding, "status" | "severity">> = {}): GovernanceFinding[] {
    return [...this.#governanceFindings.values()].filter((finding) => {
      return (
        (!filter.status || finding.status === filter.status) &&
        (!filter.severity || finding.severity === filter.severity)
      );
    });
  }

  getGovernanceFinding(id: CanonicalId): GovernanceFinding | undefined {
    return this.#governanceFindings.get(id);
  }

  upsertGovernanceFinding(finding: GovernanceFinding): GovernanceFinding {
    this.#governanceFindings.set(finding.id, finding);
    return finding;
  }

  listExceptionRequests(filter: Partial<Pick<ExceptionRequest, "status">> = {}): ExceptionRequest[] {
    return [...this.#exceptionRequests.values()].filter((request) => {
      return !filter.status || request.status === filter.status;
    });
  }

  getExceptionRequest(id: CanonicalId): ExceptionRequest | undefined {
    return this.#exceptionRequests.get(id);
  }

  upsertExceptionRequest(request: ExceptionRequest): ExceptionRequest {
    this.#exceptionRequests.set(request.id, request);
    return request;
  }

  recordReconciliationRun(run: ReconciliationRun): ReconciliationRun {
    assertNotRecorded(this.#reconciliationRuns, run.id, "Reconciliation run");
    this.#reconciliationRuns.set(run.id, run);
    return run;
  }

  listReconciliationRuns(): ReconciliationRun[] {
    return [...this.#reconciliationRuns.values()];
  }

  recordDecision(decision: DecisionResult): DecisionResult {
    this.#decisions.set(decision.decisionId, decision);
    return decision;
  }

  listDecisions(): DecisionResult[] {
    return [...this.#decisions.values()];
  }

  recordAuditEvent(event: AuditEvent): AuditEvent {
    this.#auditEvents.push(event);
    return event;
  }

  listAuditEvents(
    filter: Partial<Pick<AuditEvent, "subjectId" | "resourceId">> & { from?: string } = {}
  ): AuditEvent[] {
    return this.#auditEvents.filter((event) => {
      return (
        (!filter.subjectId || event.subjectId === filter.subjectId) &&
        (!filter.resourceId || event.resourceId === filter.resourceId) &&
        (!filter.from || event.occurredAt >= filter.from)
      );
    });
  }

  recordPersistenceDegradation(degradation: PersistenceDegradationReceipt): PersistenceDegradationReceipt {
    if (this.#persistenceDegradations.length >= MAX_PERSISTENCE_DEGRADATIONS) {
      this.#persistenceDegradations.shift();
    }

    this.#persistenceDegradations.push(degradation);
    return degradation;
  }

  replacePersistenceDegradations(degradations: PersistenceDegradationReceipt[]): void {
    this.#persistenceDegradations.splice(
      0,
      this.#persistenceDegradations.length,
      ...degradations.slice(-MAX_PERSISTENCE_DEGRADATIONS)
    );
  }

  listPersistenceDegradations(): PersistenceDegradationReceipt[] {
    return [...this.#persistenceDegradations];
  }
}

function assertNotRecorded<T>(items: Map<CanonicalId, T>, id: CanonicalId, entityName: string): void {
  if (items.has(id)) {
    throw new Error(`${entityName} ${id} has already been recorded.`);
  }
}
