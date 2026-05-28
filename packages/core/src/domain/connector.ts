import type { DriftFinding } from "./drift.js";
import type { AuditEvent, EvidenceExport } from "./evidence.js";
import type { ProvisioningPlan } from "./provisioning.js";
import type {
  CanonicalId,
  DecisionResult,
  IsoDateTime,
  JsonRecord,
  NativeGrant,
  RelationshipTuple,
  Resource,
  Subject,
  ValidationCheckStatus,
  VersionedEntity
} from "./shared.js";

export type ConnectorMode = "read_only" | "simulation" | "dry_run" | "enforcement";
export type DiscoveryRunStatus = "queued" | "running" | "completed" | "completed_with_warnings" | "failed";
export type DiscoveryWarningSeverity = "info" | "warning" | "error";
export type DiscoveryWarningScope = "connector" | "subjects" | "resources" | "relationships" | "native_grants";

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
  nativeAccessReadbackComplete?: boolean;
  cursor?: DiscoveryCursor;
}

export interface ConnectorSecurityReview {
  connectorId: string;
  provider: string;
  tenantBoundary: string;
  synthetic: boolean;
  identity: {
    kind: "synthetic" | "managed_identity" | "service_principal" | "access_key" | "role";
    subject: string;
    evidence: string[];
  };
  consent: {
    status: "synthetic" | "approved" | "blocked";
    scopesApproved: string[];
    evidence: string[];
  };
  leastPrivilege: {
    requiredReadScopes: string[];
    forbiddenWriteScopes: string[];
    scopeJustification: string;
  };
  operations: {
    pagination: "required" | "not_applicable";
    throttling: "required" | "not_applicable";
    deletion: "mark_deleted" | "ignore" | "unsupported" | "not_applicable";
    coverageWarnings: "required";
    nativeAccessReadback: boolean;
  };
  secrets: {
    storesSecrets: boolean;
    handling: "none" | "managed_identity" | "vault_required";
    rotation: "not_applicable" | "required";
    evidence: string[];
  };
  enforcement: {
    liveWritesAllowed: boolean;
    controlledSyntheticOnly: boolean;
    readinessRequired: boolean;
    rollbackRequired: boolean;
    emergencyRevocationRequired: boolean;
    monitoringRequired: boolean;
  };
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
  getSecurityReview?(): ConnectorSecurityReview;
  planProvisioningChange(request: DecisionResult): Promise<ProvisioningPlan>;
  applyProvisioningChange(plan: ProvisioningPlan): Promise<ProvisioningPlan>;
  verifyProvisioningChange(plan: ProvisioningPlan): Promise<boolean>;
  revokeAccess(nativeGrantId: CanonicalId): Promise<ProvisioningPlan>;
  detectDrift(): Promise<DriftFinding[]>;
  emitEvidence(events: AuditEvent[]): Promise<EvidenceExport>;
}
