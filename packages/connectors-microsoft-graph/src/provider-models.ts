import type {
  DiscoveryCursor,
  DiscoveryRunWarning,
  JsonRecord,
  NativeGrant,
  NativePrincipalType,
  RelationshipTuple,
  Resource,
  Subject
} from "@access-kit/core";

export interface MicrosoftGraphConnectorEnv {
  REBAC_MICROSOFT_GRAPH_ENTRA_ID_ENABLED?: string;
  REBAC_MICROSOFT_GRAPH_ENTRA_ENABLED?: string;
  REBAC_MICROSOFT_GRAPH_TENANT_ID?: string;
  REBAC_MICROSOFT_GRAPH_ACCESS_TOKEN?: string;
  REBAC_MICROSOFT_GRAPH_TOKEN_FILE?: string;
  REBAC_MICROSOFT_GRAPH_BASE_URL?: string;
  REBAC_MICROSOFT_GRAPH_SANDBOX_EVIDENCE?: string;
}

export interface GraphUser {
  id?: string;
  "@removed"?: GraphRemovedMarker | null;
  displayName?: string | null;
  userPrincipalName?: string | null;
  accountEnabled?: boolean | null;
  userType?: string | null;
  externalUserState?: string | null;
  deletedDateTime?: string | null;
}

export interface GraphGroup {
  id?: string;
  "@removed"?: GraphRemovedMarker | null;
  displayName?: string | null;
  securityEnabled?: boolean | null;
  mailEnabled?: boolean | null;
  visibility?: string | null;
  groupTypes?: string[] | null;
  resourceProvisioningOptions?: string[] | null;
  deletedDateTime?: string | null;
}

export interface GraphTeam {
  id?: string;
  displayName?: string | null;
  description?: string | null;
  webUrl?: string | null;
  isArchived?: boolean | null;
  visibility?: string | null;
}

export interface GraphServicePrincipal {
  id?: string;
  "@removed"?: GraphRemovedMarker | null;
  displayName?: string | null;
  appId?: string | null;
  servicePrincipalType?: string | null;
  appRoles?: GraphAppRole[] | null;
  deletedDateTime?: string | null;
}

export interface GraphAppRole {
  id?: string;
  displayName?: string | null;
  value?: string | null;
}

export interface GraphDirectoryObject {
  id?: string;
  "@odata.type"?: string;
  displayName?: string | null;
  userPrincipalName?: string | null;
  appId?: string | null;
  servicePrincipalType?: string | null;
}

export interface GraphAppRoleAssignment {
  id?: string;
  principalId?: string;
  principalType?: string | null;
  principalDisplayName?: string | null;
  resourceId?: string;
  resourceDisplayName?: string | null;
  appRoleId?: string | null;
  createdDateTime?: string | null;
}

export interface GraphSite {
  id?: string;
  "@removed"?: GraphRemovedMarker | null;
  name?: string | null;
  displayName?: string | null;
  webUrl?: string | null;
  isPersonalSite?: boolean | null;
  root?: JsonRecord | null;
  siteCollection?: {
    hostname?: string | null;
    dataLocationCode?: string | null;
    root?: JsonRecord | null;
  } | null;
  deletedDateTime?: string | null;
}

export interface GraphDrive {
  id?: string;
  "@removed"?: GraphRemovedMarker | null;
  name?: string | null;
  driveType?: string | null;
  webUrl?: string | null;
  createdDateTime?: string | null;
  lastModifiedDateTime?: string | null;
  owner?: {
    user?: { id?: string; displayName?: string | null } | null;
    group?: { id?: string; displayName?: string | null } | null;
  } | null;
  quota?: {
    state?: string | null;
    total?: number | null;
  } | null;
  sharePointIds?: {
    siteId?: string | null;
    webId?: string | null;
    listId?: string | null;
  } | null;
}

export interface GraphDriveItem {
  id?: string;
  "@removed"?: GraphRemovedMarker | null;
  name?: string | null;
  webUrl?: string | null;
  folder?: { childCount?: number | null } | null;
  file?: { mimeType?: string | null } | null;
  package?: JsonRecord | null;
  deleted?: JsonRecord | null;
  size?: number | null;
  createdDateTime?: string | null;
  lastModifiedDateTime?: string | null;
  parentReference?: {
    driveId?: string | null;
    id?: string | null;
    siteId?: string | null;
    path?: string | null;
  } | null;
}

export interface GraphPermissionIdentity {
  id?: string;
  displayName?: string | null;
  userPrincipalName?: string | null;
  appId?: string | null;
  loginName?: string | null;
}

export interface GraphPermissionIdentitySet {
  user?: GraphPermissionIdentity | null;
  group?: GraphPermissionIdentity | null;
  application?: GraphPermissionIdentity | null;
  siteUser?: GraphPermissionIdentity | null;
}

export interface GraphPermission {
  id?: string;
  "@removed"?: GraphRemovedMarker | null;
  roles?: string[] | null;
  grantedTo?: GraphPermissionIdentitySet | null;
  grantedToV2?: GraphPermissionIdentitySet | null;
  grantedToIdentities?: GraphPermissionIdentitySet[] | null;
  grantedToIdentitiesV2?: GraphPermissionIdentitySet[] | null;
  link?: {
    type?: string | null;
    scope?: string | null;
    preventsDownload?: boolean | null;
  } | null;
  invitation?: {
    email?: string | null;
    signInRequired?: boolean | null;
  } | null;
  inheritedFrom?: {
    driveId?: string | null;
    id?: string | null;
    siteId?: string | null;
    path?: string | null;
  } | null;
  shareId?: string | null;
  hasPassword?: boolean | null;
  expirationDateTime?: string | null;
}

export interface EntraSnapshot {
  subjects: Subject[];
  resources: Resource[];
  relationships: RelationshipTuple[];
  grantsByResource: Map<string, NativeGrant[]>;
  cursor: DiscoveryCursor;
}

export interface GraphRemovedMarker {
  reason?: string | null;
}

export interface GraphDeltaCapableRecord {
  id?: string;
  "@removed"?: GraphRemovedMarker | null;
}

export interface MicrosoftGraphDeltaState {
  token: string;
  capturedAt: string;
  scope: DiscoveryRunWarning["scope"];
}

export interface EntraEntityMaps {
  subjectsByGraphId: Map<string, Subject>;
  subjectPrincipalTypes: Map<string, NativePrincipalType>;
  applicationResourcesByGraphId: Map<string, Resource>;
  m365GroupResourcesByGraphId: Map<string, Resource>;
  teamResourcesByGroupId: Map<string, Resource>;
  appRolesByServicePrincipalId: Map<string, Map<string, GraphAppRole>>;
}

export interface RelationshipCoverage {
  relationships: RelationshipTuple[];
  grantsByResource: Map<string, NativeGrant[]>;
}

export type DriveInventorySource =
  | { kind: "sharepoint"; siteResource: Resource }
  | { kind: "onedrive"; user: GraphUser; ownerSubject?: Subject };

export interface SharePointOneDriveInventoryCoverage {
  resources: Resource[];
  grantTargets: MicrosoftPermissionGrantTarget[];
}

export interface MicrosoftPermissionGrantTarget {
  resource: Resource;
  kind: "sharepoint_site" | "drive" | "drive_item";
  siteId?: string;
  driveId?: string;
  itemId?: string;
}
