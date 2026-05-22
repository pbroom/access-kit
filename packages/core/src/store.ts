import type {
  AuditEvent,
  CanonicalId,
  DecisionResult,
  DriftFinding,
  NativeGrant,
  ProvisioningPlan,
  RelationshipTuple,
  Resource,
  Subject
} from "./domain.js";

export interface RebacSeedData {
  subjects?: Subject[];
  resources?: Resource[];
  relationships?: RelationshipTuple[];
  nativeGrants?: NativeGrant[];
  provisioningPlans?: ProvisioningPlan[];
  driftFindings?: DriftFinding[];
  decisions?: DecisionResult[];
  auditEvents?: AuditEvent[];
}

export class InMemoryRebacStore {
  readonly #subjects = new Map<CanonicalId, Subject>();
  readonly #resources = new Map<CanonicalId, Resource>();
  readonly #relationships = new Map<CanonicalId, RelationshipTuple>();
  readonly #nativeGrants = new Map<CanonicalId, NativeGrant>();
  readonly #provisioningPlans = new Map<CanonicalId, ProvisioningPlan>();
  readonly #driftFindings = new Map<CanonicalId, DriftFinding>();
  readonly #decisions = new Map<CanonicalId, DecisionResult>();
  readonly #auditEvents: AuditEvent[] = [];

  constructor(seed: RebacSeedData = {}) {
    seed.subjects?.forEach((subject) => this.upsertSubject(subject));
    seed.resources?.forEach((resource) => this.upsertResource(resource));
    seed.relationships?.forEach((relationship) => this.upsertRelationship(relationship));
    seed.nativeGrants?.forEach((grant) => this.upsertNativeGrant(grant));
    seed.provisioningPlans?.forEach((plan) => this.upsertProvisioningPlan(plan));
    seed.driftFindings?.forEach((finding) => this.upsertDriftFinding(finding));
    seed.decisions?.forEach((decision) => this.recordDecision(decision));
    seed.auditEvents?.forEach((event) => this.recordAuditEvent(event));
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
    this.#relationships.set(relationship.id, relationship);
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
    this.#relationships.set(id, deleted);
    return deleted;
  }

  listNativeGrants(): NativeGrant[] {
    return [...this.#nativeGrants.values()];
  }

  upsertNativeGrant(grant: NativeGrant): NativeGrant {
    this.#nativeGrants.set(grant.id, grant);
    return grant;
  }

  listProvisioningPlans(): ProvisioningPlan[] {
    return [...this.#provisioningPlans.values()];
  }

  getProvisioningPlan(id: CanonicalId): ProvisioningPlan | undefined {
    return this.#provisioningPlans.get(id);
  }

  upsertProvisioningPlan(plan: ProvisioningPlan): ProvisioningPlan {
    this.#provisioningPlans.set(plan.id, plan);
    return plan;
  }

  listDriftFindings(filter: Partial<Pick<DriftFinding, "severity">> = {}): DriftFinding[] {
    return [...this.#driftFindings.values()].filter((finding) => {
      return !filter.severity || finding.severity === filter.severity;
    });
  }

  upsertDriftFinding(finding: DriftFinding): DriftFinding {
    this.#driftFindings.set(finding.id, finding);
    return finding;
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
}
