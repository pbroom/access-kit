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
  modelVersion?: string;
  relationshipVersion?: string;
  tupleVersion?: string;
  contextVersion?: string;
  asOf?: IsoDateTime;
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
  modelVersion: string;
  relationshipVersion: string;
  tupleVersion: string;
  contextVersion: string;
  asOf: IsoDateTime;
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
