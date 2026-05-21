export type CanonicalId = string;
export type IsoDateTime = string;
export type JsonRecord = Record<string, unknown>;

export type SubjectType =
  | "user"
  | "group"
  | "service_account"
  | "service_principal"
  | "managed_identity"
  | "device"
  | "workload";

export type ResourceType =
  | "organization"
  | "workspace"
  | "application"
  | "sharepoint_site"
  | "team"
  | "folder"
  | "document"
  | "power_app"
  | "flow"
  | "dataverse_environment"
  | "aws_account"
  | "aws_role"
  | "dataset"
  | "api";

export type LifecycleState =
  | "active"
  | "inactive"
  | "suspended"
  | "terminated"
  | "deleted";

export type DecisionValue = "allow" | "deny";
export type DriftSeverity = "low" | "medium" | "high" | "critical";
export type ConnectorMode = "read_only" | "simulation" | "dry_run" | "enforcement";

export interface VersionedEntity {
  id: CanonicalId;
  version: string;
  createdAt: IsoDateTime;
  updatedAt?: IsoDateTime;
}

export interface Subject extends VersionedEntity {
  type: SubjectType;
  displayName: string;
  sourceSystem: string;
  lifecycleState: LifecycleState;
  identifiers: Record<string, string>;
  attributes?: JsonRecord;
  lastSeenAt?: IsoDateTime;
}

export interface Resource extends VersionedEntity {
  type: ResourceType;
  displayName: string;
  sourceSystem: string;
  ownerId: CanonicalId;
  dataStewardId: CanonicalId;
  technicalOwnerId: CanonicalId;
  classification: string;
  lifecycleState: LifecycleState;
  parentId?: CanonicalId;
  attributes?: JsonRecord;
  lastSeenAt?: IsoDateTime;
}

export interface RelationshipTuple extends VersionedEntity {
  subjectId: CanonicalId;
  relation: string;
  objectId: CanonicalId;
  sourceSystem: string;
  assertedAt: IsoDateTime;
  assertedBy?: CanonicalId;
  expiresAt?: IsoDateTime;
  status: "active" | "expired" | "deleted";
  attributes?: JsonRecord;
}

export interface DecisionRequest {
  subjectId: CanonicalId;
  action: string;
  resourceId: CanonicalId;
  context?: JsonRecord;
  policyVersion?: string;
  relationshipVersion?: string;
}

export interface RelationshipPathStep {
  subjectId: CanonicalId;
  relation: string;
  objectId: CanonicalId;
}

export interface DecisionResult {
  decisionId: CanonicalId;
  decision: DecisionValue;
  subjectId: CanonicalId;
  action: string;
  resourceId: CanonicalId;
  reasonCode: string;
  policyVersion: string;
  relationshipVersion: string;
  relationshipPath: RelationshipPathStep[];
  constraints: JsonRecord;
  evaluatedAt: IsoDateTime;
}

export interface IntendedGrant extends VersionedEntity {
  subjectId: CanonicalId;
  resourceId: CanonicalId;
  action: string;
  source: "relationship" | "approval" | "break_glass" | "exception";
  relationshipPath: RelationshipPathStep[];
  status: "planned" | "active" | "expired" | "revoked";
  expiresAt?: IsoDateTime;
  reviewRequiredAt?: IsoDateTime;
}

export interface NativeGrant extends VersionedEntity {
  targetPlatform: string;
  targetObjectId: CanonicalId;
  subjectId: CanonicalId;
  nativePermission: string;
  sourceConnectorId: string;
  status: "observed" | "managed" | "revoked" | "unknown";
  observedAt: IsoDateTime;
}

export interface ProvisioningAction {
  actionId: CanonicalId;
  operation: "grant" | "revoke" | "expire" | "repair" | "verify";
  targetPlatform: string;
  targetObjectId: CanonicalId;
  requestedState: JsonRecord;
  previousState?: JsonRecord;
  dryRun: boolean;
  idempotencyKey: string;
}

export interface ProvisioningPlan extends VersionedEntity {
  sourceDecisionId?: CanonicalId;
  subjectId: CanonicalId;
  resourceId: CanonicalId;
  action: string;
  mode: "dry_run" | "enforcement";
  status: "planned" | "approved" | "applied" | "failed" | "rolled_back";
  actions: ProvisioningAction[];
}

export interface DriftFinding extends VersionedEntity {
  resourceId: CanonicalId;
  subjectId: CanonicalId;
  nativeAccess: string;
  intendedAccess: string;
  severity: DriftSeverity;
  detectedAt: IsoDateTime;
  sourceConnectorId: string;
  recommendedAction: "revoke" | "exception" | "repair" | "review";
  status: "open" | "accepted" | "repairing" | "resolved";
}

export interface AuditEvent {
  eventId: CanonicalId;
  eventType: string;
  occurredAt: IsoDateTime;
  actor: CanonicalId;
  subjectId?: CanonicalId;
  resourceId?: CanonicalId;
  correlationId: CanonicalId;
  policyVersion?: string;
  relationshipVersion?: string;
  payloadHash: string;
  previousEventHash?: string;
  payload: JsonRecord;
}

export interface EvidenceExport {
  exportId: CanonicalId;
  framework: "nist-800-53" | "fedramp-rev5" | "custom";
  controls: string[];
  periodStart: IsoDateTime;
  periodEnd: IsoDateTime;
  generatedAt: IsoDateTime;
  evidenceTypes: string[];
  sourceEventIds: CanonicalId[];
  responsibleRole: string;
  format: "json" | "zip" | "markdown";
}

export interface ConnectorCapabilities {
  supportsDiscovery: boolean;
  supportsProvisioning: boolean;
  supportsReconciliation: boolean;
  supportsDirectPermissions: boolean;
  supportsInheritedPermissions: boolean;
  supportsExternalUsers: boolean;
  supportsTimeBoundAccess: boolean;
}

export interface ConnectorAdapter {
  id: string;
  mode: ConnectorMode;
  capabilities: ConnectorCapabilities;
  discoverSubjects(): Promise<Subject[]>;
  discoverResources(): Promise<Resource[]>;
  discoverRelationships(): Promise<RelationshipTuple[]>;
  readCurrentAccess(resourceId: CanonicalId): Promise<NativeGrant[]>;
  planProvisioningChange(request: DecisionResult): Promise<ProvisioningPlan>;
  applyProvisioningChange(plan: ProvisioningPlan): Promise<ProvisioningPlan>;
  verifyProvisioningChange(plan: ProvisioningPlan): Promise<boolean>;
  revokeAccess(nativeGrantId: CanonicalId): Promise<ProvisioningPlan>;
  detectDrift(): Promise<DriftFinding[]>;
  emitEvidence(events: AuditEvent[]): Promise<EvidenceExport>;
}
