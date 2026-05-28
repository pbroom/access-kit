export const MICROSOFT_GRAPH_ENTRA_CONNECTOR_ID = "microsoft-graph-entra-readonly";
export const MICROSOFT_GRAPH_M365_TEAMS_RESOURCE_SPECIFIC_READ_SCOPES = [
  "TeamSettings.Read.Group"
] as const;
export const MICROSOFT_GRAPH_SHAREPOINT_ONEDRIVE_REQUIRED_READ_SCOPES = [
  "Files.Read.All",
  "Sites.Read.All"
] as const;
export const MICROSOFT_GRAPH_ENTRA_REQUIRED_READ_SCOPES = [
  "User.Read.All",
  "GroupMember.Read.All",
  "Application.Read.All",
  ...MICROSOFT_GRAPH_SHAREPOINT_ONEDRIVE_REQUIRED_READ_SCOPES
] as const;
export const MICROSOFT_GRAPH_ENTRA_FORBIDDEN_WRITE_SCOPES = [
  "User.ReadWrite.All",
  "Group.ReadWrite.All",
  "GroupMember.ReadWrite.All",
  "Application.ReadWrite.All",
  "AppRoleAssignment.ReadWrite.All",
  "Directory.ReadWrite.All",
  "TeamSettings.ReadWrite.Group",
  "Files.ReadWrite.All",
  "Sites.ReadWrite.All"
] as const;

export const DEFAULT_BASE_URL = "https://graph.microsoft.com/v1.0";
export const DEFAULT_MAX_PAGES = 100;
export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_MAX_DRIVE_ITEM_DEPTH = 8;
export const REDACTION_HASH_LENGTH = 16;
export const DRIVE_ITEM_SELECT = "id,name,webUrl,parentReference,folder,file,package,deleted,size,createdDateTime,lastModifiedDateTime";
export const PERMISSION_SELECT = "id,roles,grantedTo,grantedToV2,grantedToIdentities,grantedToIdentitiesV2,link,invitation,inheritedFrom,shareId,hasPassword,expirationDateTime";
export const DELTA_CURSOR_HASH_LENGTH = 20;

export const SECURITY_RELEVANT_COVERAGE_WARNING_CODES = new Set([
  "GRAPH_CHANGE_NOTIFICATION_DELIVERY_UNSUPPORTED",
  "GRAPH_COLLECTION_SKIPPED",
  "GRAPH_DELTA_TOKEN_MISSING",
  "GRAPH_DELTA_TOKEN_STALE",
  "GRAPH_DELTA_TOMBSTONE_OBSERVED",
  "GRAPH_DRIVE_ITEM_DEPTH_LIMIT_REACHED",
  "GRAPH_INCREMENTAL_SYNC_FULL_RESYNC",
  "GRAPH_NATIVE_GRANT_COVERAGE_EMPTY",
  "GRAPH_NATIVE_GRANT_LINK_SEMANTICS_UNSUPPORTED",
  "GRAPH_NATIVE_GRANT_PRINCIPAL_SKIPPED",
  "GRAPH_NATIVE_GRANT_PRINCIPAL_UNSUPPORTED",
  "GRAPH_NATIVE_GRANT_ROLE_UNSUPPORTED",
  "GRAPH_NATIVE_GRANT_SITE_USER_UNSUPPORTED",
  "GRAPH_NATIVE_GRANT_TARGET_UNSUPPORTED",
  "GRAPH_PAGE_LIMIT_REACHED",
  "GRAPH_POWER_PLATFORM_DATAVERSE_ROLE_MAPPING_UNSUPPORTED",
  "GRAPH_SHAREPOINT_ONEDRIVE_INHERITANCE_AMBIGUOUS",
  "GRAPH_TEAM_CHANNEL_COVERAGE_UNSUPPORTED",
  "GRAPH_THROTTLE_RETRIED"
]);
