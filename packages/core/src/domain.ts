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
export type DiscoveryRunStatus = "queued" | "running" | "completed" | "completed_with_warnings" | "failed";
export type DiscoveryWarningSeverity = "info" | "warning" | "error";
export type DiscoveryWarningScope = "connector" | "subjects" | "resources" | "relationships" | "native_grants";
export type NativeGrantType = "direct" | "inherited" | "group";
export type NativePrincipalType =
  | "user"
  | "group"
  | "service_account"
  | "service_principal"
  | "managed_identity"
  | "external_user"
  | "unknown";
export type ValidationCheckStatus = "pass" | "warn" | "fail";
export type ProvisioningMode = "dry_run" | "enforcement";
export type ProvisioningStepStatus = "planned" | "skipped" | "verified" | "applied" | "failed";
export type ProvisioningVerificationStatus = "pending" | "verified" | "skipped" | "failed";
export type ProvisioningCompensationStatus = "planned" | "not_required" | "skipped" | "failed";
export type EnforcementReadinessStatus = "ready" | "blocked";
export type EvidenceFramework = "nist-800-53" | "fedramp-rev5" | "custom";
export type EvidenceExportFormat = "json" | "zip" | "markdown";
export type ControlImplementationStatus = "implemented" | "partially_implemented" | "planned";
export type AuditIntegrityStatus = "verified" | "failed";

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
  principalType: NativePrincipalType;
  nativePermission: string;
  grantType: NativeGrantType;
  sourceConnectorId: string;
  status: "observed" | "managed" | "revoked" | "unknown";
  observedAt: IsoDateTime;
  inheritedFromObjectId?: CanonicalId;
  expiresAt?: IsoDateTime;
  attributes?: JsonRecord;
}

export interface DiscoveryRunCounts {
  subjects: number;
  resources: number;
  relationships: number;
  nativeGrants: number;
  warnings: number;
}

export interface DiscoveryRunWarning {
  code: string;
  message: string;
  severity: DiscoveryWarningSeverity;
  scope: DiscoveryWarningScope;
  retryable: boolean;
  objectId?: CanonicalId;
}

export interface DiscoveryCursor {
  startedFrom?: string;
  next?: string;
  highWatermark: string;
  deletedObjectBehavior: "mark_deleted" | "ignore" | "unsupported";
}

export interface DiscoveryEvidence {
  readOnly: boolean;
  schemas: string[];
  connectorCapabilities: string[];
  nativeAccessReadback: boolean;
}

export interface DiscoveryRun extends VersionedEntity {
  connectorId: string;
  mode: "read_only";
  status: DiscoveryRunStatus;
  startedAt: IsoDateTime;
  completedAt?: IsoDateTime;
  counts: DiscoveryRunCounts;
  warnings: DiscoveryRunWarning[];
  cursor?: DiscoveryCursor;
  evidence: DiscoveryEvidence;
  auditEventIds: CanonicalId[];
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
  status: ProvisioningStepStatus;
  verification: ProvisioningVerification;
  compensation?: ProvisioningCompensation;
}

export interface ProvisioningVerification {
  status: ProvisioningVerificationStatus;
  method: string;
  expectedState: JsonRecord;
  readbackState?: JsonRecord;
  checkedAt?: IsoDateTime;
  message?: string;
}

export interface ProvisioningCompensation {
  operation: ProvisioningAction["operation"];
  reason: string;
  status: ProvisioningCompensationStatus;
  idempotencyKey: string;
}

export interface ProvisioningApproval {
  decision: "approved";
  approverId: CanonicalId;
  changeTicket: CanonicalId;
  approvedAt: IsoDateTime;
  expiresAt?: IsoDateTime;
  reason?: string;
}

export interface EnforcementControl {
  syntheticOnly: boolean;
  liveProviderWrites: boolean;
  incidentMode: boolean;
  breakGlass: boolean;
}

export interface EnforcementReadinessCheck {
  name: string;
  status: ValidationCheckStatus;
  message: string;
  evidence?: JsonRecord;
}

export interface EnforcementReadinessReport extends VersionedEntity {
  connectorId: string;
  provider: string;
  tenantBoundary: string;
  mode: "enforcement";
  status: EnforcementReadinessStatus;
  checkedAt: IsoDateTime;
  control: EnforcementControl;
  checks: EnforcementReadinessCheck[];
  requiredApproverRole: string;
  changeTicketPattern: string;
  liveProviderWritesAllowed: boolean;
  auditEventIds: CanonicalId[];
}

export interface ProvisioningPlan extends VersionedEntity {
  sourceDecisionId?: CanonicalId;
  idempotencyKey?: string;
  connectorId: string;
  subjectId: CanonicalId;
  resourceId: CanonicalId;
  action: string;
  mode: ProvisioningMode;
  status: "planned" | "approved" | "applied" | "failed" | "rolled_back";
  actions: ProvisioningAction[];
  approval?: ProvisioningApproval;
  control?: EnforcementControl;
  readinessReportId?: CanonicalId;
}

export interface ProvisioningActionResult {
  actionId: CanonicalId;
  operation: ProvisioningAction["operation"];
  status: ProvisioningStepStatus;
  dryRun: boolean;
  idempotencyKey: string;
  message: string;
  verification: ProvisioningVerification;
  compensation?: ProvisioningCompensation;
}

export interface ProvisioningJob extends VersionedEntity {
  planId: CanonicalId;
  connectorId: string;
  mode: ProvisioningMode;
  dryRun: boolean;
  status: "queued" | "running" | "completed" | "failed" | "rolled_back";
  approverId: CanonicalId;
  idempotencyKey: string;
  actionResults: ProvisioningActionResult[];
  verification: ProvisioningVerification;
  auditEventIds: CanonicalId[];
  approval?: ProvisioningApproval;
  control?: EnforcementControl;
  startedAt: IsoDateTime;
  completedAt?: IsoDateTime;
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

export interface ReconciliationRun extends VersionedEntity {
  connectorId: string;
  mode: "dry_run";
  dryRun: true;
  status: "completed" | "failed";
  findings: DriftFinding[];
  counts: {
    findings: number;
    highOrCritical: number;
  };
  auditEventIds: CanonicalId[];
  completedAt?: IsoDateTime;
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

export interface AuditIntegrityFinding {
  code: string;
  message: string;
  severity: "low" | "medium" | "high" | "critical";
  eventId?: CanonicalId;
  expected?: string;
  actual?: string;
}

export interface AuditIntegrityReport {
  status: AuditIntegrityStatus;
  eventCount: number;
  verifiedAt: IsoDateTime;
  firstEventId?: CanonicalId;
  lastEventId?: CanonicalId;
  firstEventHash?: string;
  lastEventHash?: string;
  findings: AuditIntegrityFinding[];
  auditEventId?: CanonicalId;
  version: string;
}

export interface EvidenceControlMapping {
  controlId: string;
  family: string;
  status: ControlImplementationStatus;
  implementationSummary: string;
  evidenceTypes: string[];
  sourceEventIds: CanonicalId[];
  gaps: string[];
}

export interface EvidenceArtifact {
  name: string;
  type: "audit_events" | "decision_logs" | "provisioning_logs" | "drift_findings" | "control_mapping" | "siem_export" | "poam" | "conmon";
  description: string;
  eventCount?: number;
  format: EvidenceExportFormat | "jsonl";
}

export interface ConMonMetric {
  name: string;
  value: number;
  unit: "count" | "boolean";
  source: string;
}

export interface PoamItem {
  id: CanonicalId;
  controlId: string;
  weakness: string;
  status: "open" | "planned" | "mitigated";
  ownerRole: string;
  plannedCompletion: IsoDateTime;
  source: string;
}

export interface SiemExportMetadata {
  format: "jsonl";
  eventCount: number;
  schemaVersion: string;
  includesPayloadHashes: boolean;
  target: "operator_download" | "siem_forwarder";
}

export interface AuditStorageReceipt {
  eventId: CanonicalId;
  sequence: number;
  eventHash: string;
  previousEventHash?: string;
  storedAt: IsoDateTime;
  backend: "memory" | "local_file" | "external";
  location: string;
  immutable: boolean;
  version: string;
}

export interface EvidenceStorageReceipt {
  exportId: CanonicalId;
  packageHash: string;
  storedAt: IsoDateTime;
  backend: "memory" | "local_file" | "external";
  location: string;
  immutable: boolean;
  version: string;
}

export interface EvidenceExport {
  exportId: CanonicalId;
  framework: EvidenceFramework;
  controls: string[];
  periodStart: IsoDateTime;
  periodEnd: IsoDateTime;
  generatedAt: IsoDateTime;
  evidenceTypes: string[];
  sourceEventIds: CanonicalId[];
  responsibleRole: string;
  format: EvidenceExportFormat;
  auditIntegrity: AuditIntegrityReport;
  controlMappings: EvidenceControlMapping[];
  artifacts: EvidenceArtifact[];
  conmonMetrics: ConMonMetric[];
  poamItems: PoamItem[];
  siemExport: SiemExportMetadata;
  storageReceipt?: EvidenceStorageReceipt;
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

export interface ConnectorHealthCheck {
  name: string;
  status: ValidationCheckStatus;
  message?: string;
  evidence?: JsonRecord;
}

export interface ConnectorDiscoveryMetadata {
  provider: string;
  tenantBoundary: string;
  requiredReadScopes: string[];
  synthetic: boolean;
  warnings: DiscoveryRunWarning[];
  cursor?: DiscoveryCursor;
}

export interface ConnectorAdapter {
  id: string;
  mode: ConnectorMode;
  capabilities: ConnectorCapabilities;
  provider?: string;
  tenantBoundary?: string;
  requiredReadScopes?: string[];
  discoverSubjects(): Promise<Subject[]>;
  discoverResources(): Promise<Resource[]>;
  discoverRelationships(): Promise<RelationshipTuple[]>;
  readCurrentAccess(resourceId: CanonicalId): Promise<NativeGrant[]>;
  testReadOnlyAccess?(): Promise<ConnectorHealthCheck[]>;
  getDiscoveryMetadata?(): ConnectorDiscoveryMetadata;
  planProvisioningChange(request: DecisionResult): Promise<ProvisioningPlan>;
  applyProvisioningChange(plan: ProvisioningPlan): Promise<ProvisioningPlan>;
  verifyProvisioningChange(plan: ProvisioningPlan): Promise<boolean>;
  revokeAccess(nativeGrantId: CanonicalId): Promise<ProvisioningPlan>;
  detectDrift(): Promise<DriftFinding[]>;
  emitEvidence(events: AuditEvent[]): Promise<EvidenceExport>;
}
