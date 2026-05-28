import type { DiscoveryRunWarning, NativeGrant } from "@access-kit/core";
import { isDeletedAssignment, pushAwsMissingIdWarning } from "./discovery.js";
import { latestActivityForAssignment } from "./latency-confidence.js";
import type { AwsAccountAssignment, AwsEntityMaps, AwsLatencyWindows } from "./provider-models.js";
import { redactValue, safePermissionLabel } from "./provider-utils.js";

export interface AwsNativeGrantContext {
  connectorId: string;
  tenantBoundary: string;
  now: () => string;
  latencyWindows: AwsLatencyWindows;
  pushWarning: (warning: DiscoveryRunWarning) => void;
}

export function buildAwsNativeGrants(
  assignments: AwsAccountAssignment[],
  maps: AwsEntityMaps,
  context: AwsNativeGrantContext
): Map<string, NativeGrant[]> {
  const grantsByResource = new Map<string, NativeGrant[]>();

  for (const assignment of assignments) {
    if (!assignment.accountId || !assignment.permissionSetArn || !assignment.principalId) {
      pushAwsMissingIdWarning("native_grants", context.pushWarning);
      continue;
    }

    const accountResource = maps.accountsById.get(assignment.accountId);
    const permissionSetResource = maps.permissionSetsByArn.get(assignment.permissionSetArn);
    const permissionSet = maps.permissionSetMetadataByArn.get(assignment.permissionSetArn);
    const subject = maps.subjectsByPrincipalKey.get(assignment.principalId);
    if (!accountResource || !permissionSetResource || !subject) {
      context.pushWarning({
        code: "AWS_ASSIGNMENT_OUTSIDE_BOUNDARY_SKIPPED",
        message: "IAM Identity Center returned an assignment outside the imported account, permission-set, or principal boundary; the assignment was skipped.",
        severity: "warning",
        scope: "native_grants",
        retryable: false
      });
      continue;
    }

    const activity = latestActivityForAssignment(assignment, maps);
    const grant: NativeGrant = {
      id: `native-grant:${context.connectorId}:${redactValue(`${assignment.accountId}:${assignment.permissionSetArn}:${assignment.principalId}`)}`,
      targetPlatform: context.connectorId,
      targetObjectId: accountResource.id,
      subjectId: subject.id,
      principalType: maps.principalTypesBySubjectId.get(subject.id) ?? "unknown",
      nativePermission: `sso:${safePermissionLabel(permissionSet?.name ?? permissionSetResource.id)}`,
      grantType: assignment.principalType === "GROUP" ? "group" : "direct",
      sourceConnectorId: context.connectorId,
      status: isDeletedAssignment(assignment) ? "revoked" : "observed",
      observedAt: context.now(),
      expiresAt: undefined,
      attributes: {
        organizationBoundary: context.tenantBoundary,
        assignmentHash: redactValue(`${assignment.accountId}:${assignment.permissionSetArn}:${assignment.principalId}`),
        accountHash: redactValue(assignment.accountId),
        permissionSetHash: redactValue(assignment.permissionSetArn),
        principalHash: redactValue(assignment.principalId),
        permissionSetResourceId: permissionSetResource.id,
        createdAt: assignment.createdDate,
        tombstone: isDeletedAssignment(assignment),
        cloudTrailActivity: activity ? {
          eventHash: activity.eventHash,
          eventName: safePermissionLabel(activity.eventName),
          lastActivityAt: activity.eventTime,
          readOnly: activity.readOnly,
          cloudTrailActivityAgeMinutes: activity.cloudTrailActivityAgeMinutes,
          stale: activity.staleActivity,
          staleWindowMinutes: activity.staleWindowMinutes,
          eventBridgeDeliveredAt: activity.eventBridgeDeliveredAt,
          eventBridgeLatencyMinutes: activity.eventBridgeLatencyMinutes,
          eventBridgeAttempts: activity.eventBridgeAttempts,
          eventBridgeRetryState: activity.eventBridgeRetryState,
          partialOrderingObserved: activity.partialOrderingObserved,
          reconciliationConfidence: activity.reconciliationConfidence,
          confidenceReasons: activity.confidenceReasons,
          redacted: true
        } : {
          observed: false,
          staleWindowMinutes: context.latencyWindows.cloudTrailStaleActivityWindowMinutes,
          reconciliationConfidence: "low",
          confidenceReasons: ["no_cloudtrail_activity"],
          redacted: true
        },
        reconciliationConfidence: activity?.reconciliationConfidence ?? "low",
        staleActivityWindowMinutes: context.latencyWindows.cloudTrailStaleActivityWindowMinutes,
        eventBridgeLatencyWindowMinutes: context.latencyWindows.eventBridgeLatencyWindowMinutes,
        redacted: true
      },
      version: "native-grant:v1",
      createdAt: context.now()
    };

    grantsByResource.set(accountResource.id, [...grantsByResource.get(accountResource.id) ?? [], grant]);
  }

  return grantsByResource;
}
