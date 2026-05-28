import type {
  DiscoveryCursor,
  DriftFinding,
  NativeGrant,
  NativePrincipalType,
  RelationshipTuple,
  Resource,
  Subject
} from "@access-kit/core";

export interface AwsConnectorEnv {
  REBAC_AWS_READONLY_ACCESS_ANALYSIS_ENABLED?: string;
  REBAC_AWS_READONLY_ENABLED?: string;
  REBAC_AWS_ORGANIZATION_ID?: string;
  REBAC_AWS_READONLY_FIXTURE_FILE?: string;
  REBAC_AWS_SANDBOX_EVIDENCE?: string;
}

export interface AwsOrganization {
  id?: string;
  arn?: string;
  masterAccountId?: string;
  managementAccountId?: string;
  featureSet?: string;
}

export interface AwsAccount {
  id?: string;
  arn?: string;
  name?: string;
  email?: string;
  status?: string;
  joinedTimestamp?: string;
  deletedDateTime?: string;
}

export interface AwsPermissionSet {
  arn?: string;
  name?: string;
  description?: string;
  sessionDuration?: string;
  relayState?: string;
  createdDate?: string;
  deletedDateTime?: string;
}

export interface AwsAccountAssignment {
  accountId?: string;
  permissionSetArn?: string;
  principalId?: string;
  principalType?: string;
  createdDate?: string;
  deletedDateTime?: string;
  status?: string;
}

export interface AwsRole {
  arn?: string;
  roleName?: string;
  roleId?: string;
  accountId?: string;
  path?: string;
  maxSessionDuration?: number;
  createDate?: string;
  deletedDateTime?: string;
}

export interface AwsCloudTrailResource {
  resourceName?: string;
  resourceType?: string;
}

export interface AwsCloudTrailEvent {
  eventId?: string;
  eventTime?: string;
  eventName?: string;
  username?: string;
  recipientAccountId?: string;
  readOnly?: boolean | string;
  resources?: AwsCloudTrailResource[];
  errorCode?: string;
  eventBridgeDeliveredAt?: string;
  eventBridgeAttemptCount?: number;
  eventBridgeRetryState?: string;
}

export interface AwsAccessAnalyzerFinding {
  id?: string;
  analyzerArn?: string;
  resource?: string;
  resourceType?: string;
  principal?: string | Record<string, string>;
  action?: string[];
  status?: string;
  findingType?: string;
  isPublic?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export type AwsReconciliationConfidenceLevel = "high" | "medium" | "low";

export interface AwsLatencyWindows {
  eventBridgeLatencyWindowMinutes: number;
  cloudTrailStaleActivityWindowMinutes: number;
  accessAnalyzerStaleFindingWindowMinutes: number;
}

export interface AwsActivity {
  eventHash: string;
  eventName: string;
  eventTime: string;
  readOnly: boolean;
  cloudTrailActivityAgeMinutes?: number;
  eventBridgeDeliveredAt?: string;
  eventBridgeLatencyMinutes?: number;
  eventBridgeAttempts?: number;
  eventBridgeRetryState?: string;
  staleActivity: boolean;
  staleWindowMinutes: number;
  partialOrderingObserved: boolean;
  reconciliationConfidence: AwsReconciliationConfidenceLevel;
  confidenceReasons: string[];
}

export interface AwsLatencyModel {
  windows: AwsLatencyWindows;
  observedAt: string;
  eventBridge: {
    observed: boolean;
    maxLatencyMinutes?: number;
    retryObserved: boolean;
    latencyWindowExceeded: boolean;
    partialOrderingObserved: boolean;
    redacted: true;
  };
  cloudTrail: {
    latestEventAt?: string;
    maxActivityAgeMinutes?: number;
    staleActivityObserved: boolean;
    redacted: true;
  };
}

export interface AwsActivityIndex {
  activityByRawKey: Map<string, AwsActivity>;
  latencyModel: AwsLatencyModel;
}

export interface AwsReconciliationConfidence {
  level: AwsReconciliationConfidenceLevel;
  reasons: string[];
  staleFindingWindowMinutes: number;
  staleActivityWindowMinutes: number;
}

export interface AwsEntityMaps {
  organizationResource: Resource;
  accountsById: Map<string, Resource>;
  permissionSetsByArn: Map<string, Resource>;
  permissionSetMetadataByArn: Map<string, AwsPermissionSet>;
  rolesByArn: Map<string, Resource>;
  subjectsByPrincipalKey: Map<string, Subject>;
  principalTypesBySubjectId: Map<string, NativePrincipalType>;
  resourcesByRawKey: Map<string, Resource>;
  latestActivityByRawKey: Map<string, AwsActivity>;
  latencyModel: AwsLatencyModel;
}

export interface AwsSnapshot {
  subjects: Subject[];
  resources: Resource[];
  relationships: RelationshipTuple[];
  grantsByResource: Map<string, NativeGrant[]>;
  findings: DriftFinding[];
  cursor: DiscoveryCursor;
  latencyModel: AwsLatencyModel;
}
