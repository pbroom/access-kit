import type { DiscoveryCursor, DiscoveryRunWarning, NativePrincipalType, RelationshipTuple, Resource, Subject } from "@access-kit/core";
import { accessAnalyzerPrincipalKey } from "./drift-findings.js";
import { buildActivityIndex } from "./latency-confidence.js";
import type {
  AwsAccessAnalyzerFinding,
  AwsAccount,
  AwsAccountAssignment,
  AwsCloudTrailEvent,
  AwsEntityMaps,
  AwsLatencyWindows,
  AwsOrganization,
  AwsPermissionSet,
  AwsRole
} from "./provider-models.js";
import { compactTimestamp, rawKeyEntry, redactValue } from "./provider-utils.js";

export interface AwsDiscoveryContext {
  connectorId: string;
  tenantBoundary: string;
  organizationId: string;
  now: () => string;
  pushWarning: (warning: DiscoveryRunWarning) => void;
}

export function buildAwsEntityMaps(
  organization: AwsOrganization,
  accounts: AwsAccount[],
  permissionSets: AwsPermissionSet[],
  roles: AwsRole[],
  cloudTrailEvents: AwsCloudTrailEvent[],
  latencyWindows: AwsLatencyWindows,
  context: AwsDiscoveryContext
): AwsEntityMaps {
  const organizationRawId = organization.id ?? context.organizationId;
  const organizationResource = organizationResourceFor(organizationRawId, organization, context);
  const accountsById = new Map<string, Resource>();
  const permissionSetsByArn = new Map<string, Resource>();
  const permissionSetMetadataByArn = new Map<string, AwsPermissionSet>();
  const rolesByArn = new Map<string, Resource>();
  const subjectsByPrincipalKey = new Map<string, Subject>();
  const principalTypesBySubjectId = new Map<string, NativePrincipalType>();
  const resourcesByRawKey = new Map<string, Resource>([
    [organizationRawId, organizationResource],
    ...rawKeyEntry(organization.arn, organizationResource)
  ]);
  const activityIndex = buildActivityIndex(cloudTrailEvents, context.now(), latencyWindows);
  const latestActivityByRawKey = activityIndex.activityByRawKey;

  for (const account of accounts) {
    if (!account.id) {
      pushAwsMissingIdWarning("resources", context.pushWarning);
      continue;
    }

    const resource = accountResource(account, context);
    accountsById.set(account.id, resource);
    resourcesByRawKey.set(account.id, resource);
    for (const [key, value] of rawKeyEntry(account.arn, resource)) {
      resourcesByRawKey.set(key, value);
    }
    if (account.deletedDateTime || account.status === "SUSPENDED") {
      pushAwsTombstoneWarning("resources", context.pushWarning);
    }
  }

  for (const permissionSet of permissionSets) {
    if (!permissionSet.arn) {
      pushAwsMissingIdWarning("resources", context.pushWarning);
      continue;
    }

    const resource = permissionSetResource(permissionSet, organizationResource.id, context);
    permissionSetsByArn.set(permissionSet.arn, resource);
    permissionSetMetadataByArn.set(permissionSet.arn, permissionSet);
    resourcesByRawKey.set(permissionSet.arn, resource);
    if (permissionSet.deletedDateTime) {
      pushAwsTombstoneWarning("resources", context.pushWarning);
    }
  }

  for (const role of roles) {
    if (!role.arn) {
      pushAwsMissingIdWarning("resources", context.pushWarning);
      continue;
    }

    const parentId = role.accountId ? accountsById.get(role.accountId)?.id : undefined;
    const resource = roleResource(role, parentId, context);
    rolesByArn.set(role.arn, resource);
    resourcesByRawKey.set(role.arn, resource);
    for (const [key, value] of rawKeyEntry(role.roleId, resource)) {
      resourcesByRawKey.set(key, value);
    }
    if (role.deletedDateTime) {
      pushAwsTombstoneWarning("resources", context.pushWarning);
    }
  }

  return {
    organizationResource,
    accountsById,
    permissionSetsByArn,
    permissionSetMetadataByArn,
    rolesByArn,
    subjectsByPrincipalKey,
    principalTypesBySubjectId,
    resourcesByRawKey,
    latestActivityByRawKey,
    latencyModel: activityIndex.latencyModel
  };
}

export function addAwsAssignmentSubjects(
  assignments: AwsAccountAssignment[],
  maps: AwsEntityMaps,
  context: AwsDiscoveryContext
): void {
  for (const assignment of assignments) {
    if (!assignment.principalId) {
      pushAwsMissingIdWarning("native_grants", context.pushWarning);
      continue;
    }

    const subject = subjectForPrincipal(assignment.principalId, assignment.principalType, context);
    maps.subjectsByPrincipalKey.set(assignment.principalId, subject);
    maps.principalTypesBySubjectId.set(subject.id, nativePrincipalType(assignment.principalType));
    if (isDeletedAssignment(assignment)) {
      pushAwsTombstoneWarning("native_grants", context.pushWarning);
    }
  }
}

export function addAwsAccessAnalyzerSubjects(
  findings: AwsAccessAnalyzerFinding[],
  maps: AwsEntityMaps,
  context: AwsDiscoveryContext
): void {
  for (const finding of findings) {
    const principalKey = accessAnalyzerPrincipalKey(finding.principal);
    if (!principalKey || maps.subjectsByPrincipalKey.has(principalKey)) {
      continue;
    }

    const subject = subjectForAnalyzerPrincipal(principalKey, context);
    maps.subjectsByPrincipalKey.set(principalKey, subject);
    maps.principalTypesBySubjectId.set(subject.id, "service_account");
  }
}

export function buildAwsRelationships(
  accounts: AwsAccount[],
  permissionSets: AwsPermissionSet[],
  roles: AwsRole[],
  assignments: AwsAccountAssignment[],
  maps: AwsEntityMaps,
  context: AwsDiscoveryContext
): RelationshipTuple[] {
  const relationships: RelationshipTuple[] = [];

  for (const account of accounts) {
    if (!account.id) {
      continue;
    }

    const accountResource = maps.accountsById.get(account.id);
    if (accountResource) {
      relationships.push(relationship(
        `org:${context.organizationId}:account:${account.id}`,
        maps.organizationResource.id,
        "contains",
        accountResource.id,
        account.deletedDateTime || account.status === "SUSPENDED" ? "deleted" : "active",
        context
      ));
    }
  }

  for (const permissionSet of permissionSets) {
    if (!permissionSet.arn) {
      continue;
    }

    const permissionSetResource = maps.permissionSetsByArn.get(permissionSet.arn);
    if (permissionSetResource) {
      relationships.push(relationship(
        `org:${context.organizationId}:permission-set:${permissionSet.arn}`,
        maps.organizationResource.id,
        "defines_permission_set",
        permissionSetResource.id,
        permissionSet.deletedDateTime ? "deleted" : "active",
        context
      ));
    }
  }

  for (const role of roles) {
    if (!role.arn || !role.accountId) {
      continue;
    }

    const accountResource = maps.accountsById.get(role.accountId);
    const roleResource = maps.rolesByArn.get(role.arn);
    if (accountResource && roleResource) {
      relationships.push(relationship(
        `account:${role.accountId}:role:${role.arn}`,
        accountResource.id,
        "contains",
        roleResource.id,
        role.deletedDateTime ? "deleted" : "active",
        context
      ));
    }
  }

  for (const assignment of assignments) {
    const subject = assignment.principalId ? maps.subjectsByPrincipalKey.get(assignment.principalId) : undefined;
    const accountResource = assignment.accountId ? maps.accountsById.get(assignment.accountId) : undefined;
    const permissionSetResource = assignment.permissionSetArn ? maps.permissionSetsByArn.get(assignment.permissionSetArn) : undefined;
    const status = isDeletedAssignment(assignment) ? "deleted" : "active";

    if (subject && accountResource) {
      relationships.push(relationship(
        `assignment:${assignment.accountId}:${assignment.permissionSetArn}:${assignment.principalId}:account`,
        subject.id,
        "assigned_account_access",
        accountResource.id,
        status,
        context
      ));
    }

    if (subject && permissionSetResource) {
      relationships.push(relationship(
        `assignment:${assignment.accountId}:${assignment.permissionSetArn}:${assignment.principalId}:permission-set`,
        subject.id,
        "assigned_permission_set",
        permissionSetResource.id,
        status,
        context
      ));
    }
  }

  return relationships;
}

export function buildAwsCursor(now: string): DiscoveryCursor {
  return {
    startedFrom: "cursor:aws:initial",
    highWatermark: `cursor:aws:${compactTimestamp(now)}`,
    deletedObjectBehavior: "mark_deleted"
  };
}

export function buildAwsPreDiscoveryCursor(): DiscoveryCursor {
  return {
    startedFrom: "cursor:aws:initial",
    highWatermark: "cursor:aws:pre-discovery",
    deletedObjectBehavior: "mark_deleted"
  };
}

export function createAwsOrganizationBoundary(organizationId: string): string {
  return `aws:organization:${redactValue(organizationId, 20)}`;
}

export function pushAwsMissingIdWarning(
  scope: DiscoveryRunWarning["scope"],
  pushWarning: (warning: DiscoveryRunWarning) => void
): void {
  pushWarning({
    code: "AWS_OBJECT_MISSING_ID_SKIPPED",
    message: "AWS readback returned an object without the required identifier; the object was skipped.",
    severity: "warning",
    scope,
    retryable: false
  });
}

export function pushAwsTombstoneWarning(
  scope: DiscoveryRunWarning["scope"],
  pushWarning: (warning: DiscoveryRunWarning) => void
): void {
  pushWarning({
    code: "AWS_TOMBSTONE_MARKED",
    message: "AWS readback included a deleted or suspended object; the connector marked it as deleted instead of dropping evidence.",
    severity: "info",
    scope,
    retryable: false
  });
}

export function isDeletedAssignment(assignment: AwsAccountAssignment): boolean {
  return Boolean(assignment.deletedDateTime) || assignment.status === "DELETED";
}

function organizationResourceFor(
  organizationId: string,
  organization: AwsOrganization,
  context: AwsDiscoveryContext
): Resource {
  return {
    id: `organization:aws:${redactValue(organizationId)}`,
    type: "organization",
    displayName: `AWS organization ${redactValue(organizationId)}`,
    sourceSystem: context.connectorId,
    ownerId: "user:access-kit-owner",
    dataStewardId: "user:access-kit-steward",
    technicalOwnerId: "user:access-kit-operator",
    classification: "internal",
    lifecycleState: "active",
    attributes: {
      organizationHash: redactValue(organizationId),
      arnHash: organization.arn ? redactValue(organization.arn) : undefined,
      featureSet: organization.featureSet,
      managementAccountHash: organization.managementAccountId ? redactValue(organization.managementAccountId) : undefined,
      redacted: true
    },
    version: "resource:v1",
    createdAt: context.now(),
    lastSeenAt: context.now()
  };
}

function accountResource(account: AwsAccount, context: AwsDiscoveryContext): Resource {
  const rawId = account.id ?? "unknown";
  return {
    id: `aws-account:${redactValue(rawId)}`,
    type: "aws_account",
    displayName: `AWS account ${redactValue(rawId)}`,
    sourceSystem: context.connectorId,
    ownerId: "user:access-kit-owner",
    dataStewardId: "user:access-kit-steward",
    technicalOwnerId: "user:access-kit-operator",
    classification: "internal",
    lifecycleState: account.deletedDateTime ? "deleted" : account.status === "SUSPENDED" ? "suspended" : "active",
    parentId: `organization:aws:${redactValue(context.organizationId)}`,
    attributes: {
      organizationBoundary: context.tenantBoundary,
      accountHash: redactValue(rawId),
      arnHash: account.arn ? redactValue(account.arn) : undefined,
      emailHash: account.email ? redactValue(account.email) : undefined,
      status: account.status,
      joinedTimestamp: account.joinedTimestamp,
      redacted: true
    },
    version: "resource:v1",
    createdAt: context.now(),
    lastSeenAt: context.now()
  };
}

function permissionSetResource(
  permissionSet: AwsPermissionSet,
  parentId: string,
  context: AwsDiscoveryContext
): Resource {
  const rawArn = permissionSet.arn ?? "unknown";
  return {
    id: `aws-role:permission-set:${redactValue(rawArn)}`,
    type: "aws_role",
    displayName: `AWS IAM Identity Center permission set ${redactValue(rawArn)}`,
    sourceSystem: context.connectorId,
    ownerId: "user:access-kit-owner",
    dataStewardId: "user:access-kit-steward",
    technicalOwnerId: "user:access-kit-operator",
    classification: "internal",
    lifecycleState: permissionSet.deletedDateTime ? "deleted" : "active",
    parentId,
    attributes: {
      organizationBoundary: context.tenantBoundary,
      permissionSetHash: redactValue(rawArn),
      nameHash: permissionSet.name ? redactValue(permissionSet.name) : undefined,
      sessionDuration: permissionSet.sessionDuration,
      redacted: true
    },
    version: "resource:v1",
    createdAt: context.now(),
    lastSeenAt: context.now()
  };
}

function roleResource(role: AwsRole, parentId: string | undefined, context: AwsDiscoveryContext): Resource {
  const rawArn = role.arn ?? role.roleId ?? role.roleName ?? "unknown";
  return {
    id: `aws-role:${redactValue(rawArn)}`,
    type: "aws_role",
    displayName: `AWS IAM role ${redactValue(rawArn)}`,
    sourceSystem: context.connectorId,
    ownerId: "user:access-kit-owner",
    dataStewardId: "user:access-kit-steward",
    technicalOwnerId: "user:access-kit-operator",
    classification: "internal",
    lifecycleState: role.deletedDateTime ? "deleted" : "active",
    parentId,
    attributes: {
      organizationBoundary: context.tenantBoundary,
      arnHash: role.arn ? redactValue(role.arn) : undefined,
      roleIdHash: role.roleId ? redactValue(role.roleId) : undefined,
      roleNameHash: role.roleName ? redactValue(role.roleName) : undefined,
      pathHash: role.path ? redactValue(role.path) : undefined,
      maxSessionDuration: role.maxSessionDuration,
      redacted: true
    },
    version: "resource:v1",
    createdAt: context.now(),
    lastSeenAt: context.now()
  };
}

function subjectForPrincipal(
  principalId: string,
  principalType: string | undefined,
  context: AwsDiscoveryContext
): Subject {
  const type = subjectType(principalType);
  return {
    id: `${subjectPrefix(type)}:aws-identity-center:${redactValue(principalId)}`,
    type,
    displayName: `AWS Identity Center ${type.replace("_", " ")} ${redactValue(principalId)}`,
    sourceSystem: context.connectorId,
    lifecycleState: "active",
    identifiers: {
      principalHash: redactValue(principalId)
    },
    attributes: {
      organizationBoundary: context.tenantBoundary,
      principalType: principalType ?? "UNKNOWN",
      redacted: true
    },
    version: "subject:v1",
    createdAt: context.now(),
    lastSeenAt: context.now()
  };
}

function subjectForAnalyzerPrincipal(principalKey: string, context: AwsDiscoveryContext): Subject {
  return {
    id: `service-account:aws-external:${redactValue(principalKey)}`,
    type: "service_account",
    displayName: `AWS external principal ${redactValue(principalKey)}`,
    sourceSystem: context.connectorId,
    lifecycleState: "active",
    identifiers: {
      principalHash: redactValue(principalKey)
    },
    attributes: {
      organizationBoundary: context.tenantBoundary,
      source: "access_analyzer",
      external: true,
      redacted: true
    },
    version: "subject:v1",
    createdAt: context.now(),
    lastSeenAt: context.now()
  };
}

function relationship(
  idSeed: string,
  subjectId: string,
  relation: string,
  objectId: string,
  status: RelationshipTuple["status"],
  context: AwsDiscoveryContext
): RelationshipTuple {
  return {
    id: `relationship:${context.connectorId}:${redactValue(idSeed)}`,
    subjectId,
    relation,
    objectId,
    sourceSystem: context.connectorId,
    assertedAt: context.now(),
    status,
    attributes: {
      organizationBoundary: context.tenantBoundary,
      redacted: true
    },
    version: "tuple:v1",
    createdAt: context.now()
  };
}

function subjectType(principalType: string | undefined): Subject["type"] {
  switch (principalType) {
    case "GROUP":
      return "group";
    case "USER":
      return "user";
    default:
      return "service_account";
  }
}

function subjectPrefix(type: Subject["type"]): string {
  return type === "service_account" ? "service-account" : type === "service_principal" ? "service-principal" : type;
}

function nativePrincipalType(principalType: string | undefined): NativePrincipalType {
  switch (principalType) {
    case "GROUP":
      return "group";
    case "USER":
      return "user";
    default:
      return "service_account";
  }
}
