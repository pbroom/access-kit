import { existsSync, readFileSync } from "node:fs";

import {
  sha256,
  type DiscoveryRunWarning,
  type JsonRecord,
  type NativeGrant,
  type NativePrincipalType,
  type Resource,
  type Subject
} from "@access-kit/core";

import {
  DRIVE_ITEM_SELECT,
  PERMISSION_SELECT,
  REDACTION_HASH_LENGTH,
  SECURITY_RELEVANT_COVERAGE_WARNING_CODES
} from "./constants.js";
import type {
  GraphAppRole,
  GraphAppRoleAssignment,
  GraphDeltaCapableRecord,
  GraphDirectoryObject,
  GraphDriveItem,
  GraphGroup,
  GraphPermission,
  MicrosoftPermissionGrantTarget
} from "./provider-models.js";

export function createTenantBoundary(tenantId: string): string {
  return `microsoft-graph:tenant:${redactValue(tenantId, 20)}`;
}

export function redactValue(value: string, length = REDACTION_HASH_LENGTH): string {
  return sha256({ value }).slice(0, length);
}

export function subjectPrefix(type: Subject["type"]): string {
  return type === "service_principal" ? "service-principal" : type;
}

export function isM365Group(group: GraphGroup): boolean {
  return (group.groupTypes ?? []).includes("Unified");
}

export function isTeamsBackedGroup(group: GraphGroup): boolean {
  return (group.resourceProvisioningOptions ?? []).some((option) => option.toLowerCase() === "team");
}

export function isGraphServicePrincipalObject(object: GraphDirectoryObject): boolean {
  return object["@odata.type"] === "#microsoft.graph.servicePrincipal" || Boolean(object.appId || object.servicePrincipalType);
}

export function driveRootChildrenPath(driveId: string): string {
  return `/drives/${encodeURIComponent(driveId)}/root/children?$select=${DRIVE_ITEM_SELECT}`;
}

export function driveItemChildrenPath(driveId: string, itemId: string): string {
  return `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/children?$select=${DRIVE_ITEM_SELECT}`;
}

export function permissionPathForTarget(target: MicrosoftPermissionGrantTarget): string | undefined {
  if (target.kind === "sharepoint_site" && target.siteId) {
    return `/sites/${encodeURIComponent(target.siteId)}/permissions?$select=${PERMISSION_SELECT}`;
  }

  if (target.kind === "drive" && target.driveId) {
    return `/drives/${encodeURIComponent(target.driveId)}/root/permissions?$select=${PERMISSION_SELECT}`;
  }

  if (target.kind === "drive_item" && target.driveId && target.itemId) {
    return `/drives/${encodeURIComponent(target.driveId)}/items/${encodeURIComponent(target.itemId)}/permissions?$select=${PERMISSION_SELECT}`;
  }

  return undefined;
}

export function driveItemResourceType(item: GraphDriveItem): Extract<Resource["type"], "folder" | "document"> | undefined {
  if (item.folder || item.package) {
    return "folder";
  }

  return item.file ? "document" : undefined;
}

export function isDriveItemContainer(item: GraphDriveItem): boolean {
  return Boolean(item.folder || item.package);
}

export function uniqueResources(resources: Resource[]): Resource[] {
  return [...new Map(resources.map((resource) => [resource.id, resource])).values()];
}

export function applyGraphDeltaChanges<T extends GraphDeltaCapableRecord>(cachedValues: T[], changes: T[]): T[] {
  const byId = new Map(cachedValues.flatMap((value) => value.id ? [[value.id, value] as const] : []));
  const anonymousValues = cachedValues.filter((value) => !value.id);

  for (const change of changes) {
    if (!change.id) {
      anonymousValues.push(change);
      continue;
    }

    const previous = byId.get(change.id);
    byId.set(change.id, isGraphTombstone(change) && previous ? { ...previous, ...change } : change);
  }

  return [...anonymousValues, ...byId.values()];
}

export function graphRecordDeleted(record: GraphDeltaCapableRecord & { deletedDateTime?: string | null; deleted?: JsonRecord | null }): boolean {
  return Boolean(record.deletedDateTime || record.deleted || isGraphTombstone(record));
}

export function isGraphTombstone(record: GraphDeltaCapableRecord): boolean {
  return Boolean(record["@removed"]);
}

export function tombstoneAttributes(record: GraphDeltaCapableRecord): JsonRecord {
  if (!isGraphTombstone(record)) {
    return {};
  }

  return {
    providerTombstone: true,
    tombstoneReason: record["@removed"]?.reason ?? "unknown"
  };
}


export function isSecurityRelevantCoverageWarning(warning: DiscoveryRunWarning): boolean {
  return warning.severity !== "info" && SECURITY_RELEVANT_COVERAGE_WARNING_CODES.has(warning.code);
}

export function nativeGrantTypeForPrincipal(principalType: NativePrincipalType): NativeGrant["grantType"] {
  return principalType === "group" ? "group" : "direct";
}

export function nativePermissionPrefix(target: MicrosoftPermissionGrantTarget): string {
  if (target.kind === "sharepoint_site") {
    return "sharePointSite";
  }

  return target.kind === "drive" ? "drive" : "driveItem";
}

export function permissionPrincipalType(kind: PermissionIdentityKind): NativePrincipalType {
  if (kind === "group") {
    return "group";
  }

  return kind === "application" ? "service_principal" : "user";
}

export type PermissionIdentityKind = "user" | "group" | "application" | "siteUser";

export interface PermissionIdentity {
  kind: PermissionIdentityKind;
  id?: string;
}

export function permissionIdentities(permission: GraphPermission): PermissionIdentity[] {
  const identities: PermissionIdentity[] = [];

  for (const identitySet of [
    permission.grantedToV2,
    permission.grantedTo,
    ...(permission.grantedToIdentitiesV2 ?? []),
    ...(permission.grantedToIdentities ?? [])
  ]) {
    if (!identitySet) {
      continue;
    }

    for (const kind of ["user", "group", "application", "siteUser"] as const) {
      const identity = identitySet[kind];
      if (identity) {
        identities.push({ kind, id: identity.id });
      }
    }
  }

  return [...new Map(identities.map((identity) => [`${identity.kind}:${identity.id ?? "missing"}`, identity])).values()];
}

export function mapAppRoles(appRoles: GraphAppRole[]): Map<string, GraphAppRole> {
  return new Map(appRoles.flatMap((role) => role.id ? [[role.id, role] as const] : []));
}

export function appRolePermission(assignment: GraphAppRoleAssignment, appRoles: Map<string, GraphAppRole>): string {
  const appRoleId = assignment.appRoleId ?? "";
  const role = appRoles.get(appRoleId);
  const label = role?.value ?? role?.displayName;
  return label ? `appRole:${safePermissionLabel(label)}` : `appRole:${redactValue(appRoleId || assignment.id || "unknown")}`;
}

export function safePermissionLabel(value: string): string {
  return value.replaceAll(/[^a-z0-9_.:-]+/gi, "-").replaceAll(/^-|-$/g, "") || "unknown";
}

export function compactTimestamp(value: string): string {
  return value.replaceAll(/[^0-9a-z]/gi, "").toLowerCase();
}

export function readTokenFile(path: string | undefined): string | undefined {
  if (!path || !existsSync(path)) {
    return undefined;
  }

  const value = readFileSync(path, "utf8").trim();
  return value.length > 0 ? value : undefined;
}
