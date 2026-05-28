import { auditPayloadHash, type AuditEvent } from "../../packages/core/src/index.js";
import type {
  MicrosoftGraphCollectionPage,
  MicrosoftGraphReadClient,
  MicrosoftGraphRecordResponse
} from "../../packages/connectors-microsoft-graph/src/index.js";

export const now = "2026-05-26T12:00:00.000Z";
export const noSleep = async (): Promise<void> => {};
export const driveItemSelect = "id,name,webUrl,parentReference,folder,file,package,deleted,size,createdDateTime,lastModifiedDateTime";
export const permissionSelect = "id,roles,grantedTo,grantedToV2,grantedToIdentities,grantedToIdentitiesV2,link,invitation,inheritedFrom,shareId,hasPassword,expirationDateTime";

export class FixtureGraphClient implements MicrosoftGraphReadClient {
  readonly calls: string[] = [];
  readonly requests: Array<{ path: string; headers?: Record<string, string> }> = [];
  readonly #pages: Map<string, Array<MicrosoftGraphCollectionPage<unknown>>>;
  readonly #records: Map<string, Array<MicrosoftGraphRecordResponse<unknown>>>;
  readonly #missingListStatus: number;
  readonly #missingRecordStatus: number;
  readonly #strictMissingPaths: boolean;

  constructor(
    pages: Record<string, Array<MicrosoftGraphCollectionPage<unknown>>>,
    records: Record<string, Array<MicrosoftGraphRecordResponse<unknown>>> = {},
    options: { missingListStatus?: number; missingRecordStatus?: number; strictMissingPaths?: boolean } = {}
  ) {
    this.#pages = new Map(Object.entries(pages));
    this.#records = new Map(Object.entries(records));
    this.#missingListStatus = options.missingListStatus ?? 404;
    this.#missingRecordStatus = options.missingRecordStatus ?? 404;
    this.#strictMissingPaths = options.strictMissingPaths ?? false;
  }

  async list<T>(pathOrUrl: string, options?: { headers?: Record<string, string> }): Promise<MicrosoftGraphCollectionPage<T>> {
    this.calls.push(pathOrUrl);
    this.requests.push({ path: pathOrUrl, headers: options?.headers });
    const pages = this.#pages.get(pathOrUrl);
    if (!pages || pages.length === 0) {
      if (this.#strictMissingPaths) {
        throw new Error(`No fixture page for ${pathOrUrl}`);
      }
      return { value: [], status: this.#missingListStatus };
    }

    return pages.shift() as MicrosoftGraphCollectionPage<T>;
  }

  async get<T>(pathOrUrl: string, options?: { headers?: Record<string, string> }): Promise<MicrosoftGraphRecordResponse<T>> {
    this.calls.push(pathOrUrl);
    this.requests.push({ path: pathOrUrl, headers: options?.headers });
    const records = this.#records.get(pathOrUrl);
    if (!records || records.length === 0) {
      if (this.#strictMissingPaths) {
        throw new Error(`No fixture record for ${pathOrUrl}`);
      }
      return { status: this.#missingRecordStatus };
    }

    return records.shift() as MicrosoftGraphRecordResponse<T>;
  }
}


export function createFixtureClient(): FixtureGraphClient {
  return new FixtureGraphClient({
    "/users?$select=id,displayName,userPrincipalName,accountEnabled,userType,externalUserState,deletedDateTime": [
      {
        value: [
          {
            id: "raw-user-1",
            displayName: "Alice Example",
            userPrincipalName: "alice@example.test",
            accountEnabled: true,
            userType: "Member"
          }
        ],
        nextLink: "/users?page=2",
        status: 200
      }
    ],
    "/users?page=2": [
      {
        value: [
          {
            id: "raw-user-2",
            displayName: "External Reviewer",
            userPrincipalName: "external@example.test",
            accountEnabled: true,
            userType: "Guest",
            externalUserState: "Accepted"
          }
        ],
        status: 200
      }
    ],
    "/groups?$select=id,displayName,securityEnabled,mailEnabled,visibility,groupTypes,resourceProvisioningOptions,deletedDateTime": [
      {
        value: [
          {
            id: "raw-group-1",
            displayName: "Case Reviewers",
            securityEnabled: true,
            groupTypes: []
          }
        ],
        status: 200
      }
    ],
    "/servicePrincipals?$select=id,displayName,appId,servicePrincipalType,appRoles,deletedDateTime": [
      {
        value: [
          {
            id: "raw-sp-1",
            displayName: "Case Portal",
            appId: "raw-app-id",
            servicePrincipalType: "Application",
            appRoles: [{ id: "raw-role-reader", displayName: "Reader", value: "Reader" }]
          }
        ],
        status: 200
      }
    ],
    "/groups/raw-group-1/members?$select=id,displayName,userPrincipalName,appId,servicePrincipalType": [
      {
        value: [
          { id: "raw-user-1", "@odata.type": "#microsoft.graph.user", displayName: "Alice Example" },
          { id: "raw-sp-1", "@odata.type": "#microsoft.graph.servicePrincipal", displayName: "Case Portal" }
        ],
        status: 200
      }
    ],
    "/servicePrincipals/raw-sp-1/appRoleAssignedTo?$select=id,principalId,principalType,principalDisplayName,resourceId,resourceDisplayName,appRoleId,createdDateTime": [
      { value: [], status: 429, retryAfterSeconds: 1 },
      {
        value: [
          {
            id: "raw-assignment-1",
            principalId: "raw-group-1",
            principalType: "Group",
            principalDisplayName: "Case Reviewers",
            resourceId: "raw-sp-1",
            resourceDisplayName: "Case Portal",
            appRoleId: "raw-role-reader",
            createdDateTime: "2026-05-26T11:59:00.000Z"
          }
        ],
        status: 200
      }
    ],
    ...createEmptySharePointOneDriveInventory(["raw-user-1", "raw-user-2"])
  });
}

export function createM365TeamsFixtureClient(ownerObjects: Array<Record<string, unknown>> = [
  { id: "raw-user-owner", "@odata.type": "#microsoft.graph.user", displayName: "Owner Example" },
  { id: "raw-sp-bot", "@odata.type": "#microsoft.graph.servicePrincipal", displayName: "Automation Bot" }
], ownerPage: MicrosoftGraphCollectionPage<unknown> = {
  value: ownerObjects,
  status: 200
}): FixtureGraphClient {
  return new FixtureGraphClient({
    "/users?$select=id,displayName,userPrincipalName,accountEnabled,userType,externalUserState,deletedDateTime": [
      {
        value: [
          {
            id: "raw-user-owner",
            displayName: "Owner Example",
            userPrincipalName: "owner@example.test",
            accountEnabled: true,
            userType: "Member"
          },
          {
            id: "raw-user-member",
            displayName: "Member Example",
            userPrincipalName: "member@example.test",
            accountEnabled: true,
            userType: "Member"
          }
        ],
        status: 200
      }
    ],
    "/groups?$select=id,displayName,securityEnabled,mailEnabled,visibility,groupTypes,resourceProvisioningOptions,deletedDateTime": [
      {
        value: [
          {
            id: "raw-m365-group-1",
            displayName: "M365 Collaboration",
            securityEnabled: true,
            mailEnabled: true,
            visibility: "Private",
            groupTypes: ["Unified"],
            resourceProvisioningOptions: ["Team"]
          }
        ],
        status: 200
      }
    ],
    "/servicePrincipals?$select=id,displayName,appId,servicePrincipalType,appRoles,deletedDateTime": [
      {
        value: [
          {
            id: "raw-sp-bot",
            displayName: "Automation Bot",
            appId: "raw-sp-app",
            servicePrincipalType: "Application",
            appRoles: []
          }
        ],
        status: 200
      }
    ],
    "/groups/raw-m365-group-1/members?$select=id,displayName,userPrincipalName,appId,servicePrincipalType": [
      {
        value: [
          { id: "raw-user-member", "@odata.type": "#microsoft.graph.user", displayName: "Member Example" },
          { id: "raw-sp-bot", "@odata.type": "#microsoft.graph.servicePrincipal", displayName: "Automation Bot" }
        ],
        status: 200
      }
    ],
    "/groups/raw-m365-group-1/owners?$select=id,displayName,userPrincipalName,appId,servicePrincipalType": [
      ownerPage
    ],
    "/servicePrincipals/raw-sp-bot/appRoleAssignedTo?$select=id,principalId,principalType,principalDisplayName,resourceId,resourceDisplayName,appRoleId,createdDateTime": [
      { value: [], status: 200 }
    ],
    ...createEmptySharePointOneDriveInventory(["raw-user-owner", "raw-user-member"])
  }, {
    "/teams/raw-m365-group-1?$select=id,displayName,description,webUrl,isArchived,visibility": [
      {
        value: {
          id: "raw-m365-group-1",
          displayName: "Case Team",
          description: "Sensitive case collaboration",
          webUrl: "https://teams.example.test/raw-m365-group-1",
          isArchived: false,
          visibility: "Private"
        },
        status: 200
      }
    ]
  });
}

export function createSharePointOneDriveFixtureClient(): FixtureGraphClient {
  return new FixtureGraphClient({
    "/users?$select=id,displayName,userPrincipalName,accountEnabled,userType,externalUserState,deletedDateTime": [
      {
        value: [
          {
            id: "raw-user-owner",
            displayName: "Owner Example",
            userPrincipalName: "owner@example.test",
            accountEnabled: true,
            userType: "Member"
          }
        ],
        status: 200
      }
    ],
    "/groups?$select=id,displayName,securityEnabled,mailEnabled,visibility,groupTypes,resourceProvisioningOptions,deletedDateTime": [
      {
        value: [
          {
            id: "raw-group-sharepoint",
            displayName: "SharePoint Reviewers",
            securityEnabled: true,
            mailEnabled: true,
            visibility: "Private",
            groupTypes: []
          }
        ],
        status: 200
      }
    ],
    "/servicePrincipals?$select=id,displayName,appId,servicePrincipalType,appRoles,deletedDateTime": [
      { value: [], status: 200 }
    ],
    "/groups/raw-group-sharepoint/members?$select=id,displayName,userPrincipalName,appId,servicePrincipalType": [
      { value: [], status: 200 }
    ],
    "/sites?$select=id,name,displayName,webUrl,isPersonalSite,root,siteCollection": [
      {
        value: [
          {
            id: "raw-site-1",
            name: "Case Site",
            displayName: "Case Site",
            webUrl: "https://contoso.sharepoint.test/sites/cases",
            isPersonalSite: false,
            root: {},
            siteCollection: {
              hostname: "contoso.sharepoint.test",
              dataLocationCode: "NAM",
              root: {}
            }
          }
        ],
        status: 200
      }
    ],
    "/sites/raw-site-1/drives?$select=id,name,driveType,webUrl,createdDateTime,lastModifiedDateTime,owner,quota,sharePointIds": [
      {
        value: [
          {
            id: "raw-drive-site",
            name: "Case Documents",
            driveType: "documentLibrary",
            webUrl: "https://contoso.sharepoint.test/sites/cases/Shared%20Documents",
            owner: { group: { id: "raw-group-sharepoint" } },
            quota: { state: "normal", total: 1000 },
            sharePointIds: { siteId: "raw-site-1", webId: "raw-web-1", listId: "raw-list-1" }
          }
        ],
        status: 200
      }
    ],
    [`/drives/raw-drive-site/root/children?$select=${driveItemSelect}`]: [
      {
        value: [
          {
            id: "raw-folder-1",
            name: "Case Folder",
            webUrl: "https://contoso.sharepoint.test/sites/cases/Shared%20Documents/Case%20Folder",
            folder: { childCount: 1 },
            parentReference: { driveId: "raw-drive-site", id: "root", siteId: "raw-site-1", path: "/drive/root:" }
          },
          {
            id: "raw-file-1",
            name: "Sensitive Case Plan.docx",
            webUrl: "https://contoso.sharepoint.test/sites/cases/Shared%20Documents/Sensitive%20Case%20Plan.docx",
            file: { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
            size: 42,
            parentReference: { driveId: "raw-drive-site", id: "root", siteId: "raw-site-1", path: "/drive/root:" }
          }
        ],
        status: 200
      }
    ],
    [`/drives/raw-drive-site/items/raw-folder-1/children?$select=${driveItemSelect}`]: [
      {
        value: [
          {
            id: "raw-file-2",
            name: "Nested Evidence.pdf",
            webUrl: "https://contoso.sharepoint.test/sites/cases/Shared%20Documents/Case%20Folder/Nested%20Evidence.pdf",
            file: { mimeType: "application/pdf" },
            size: 7,
            parentReference: { driveId: "raw-drive-site", id: "raw-folder-1", siteId: "raw-site-1", path: "/drive/root:/Case Folder" }
          }
        ],
        status: 200
      }
    ],
    "/users/raw-user-owner/drives?$select=id,name,driveType,webUrl,createdDateTime,lastModifiedDateTime,owner,quota,sharePointIds": [
      {
        value: [
          {
            id: "raw-onedrive-1",
            name: "Owner OneDrive",
            driveType: "business",
            webUrl: "https://contoso-my.sharepoint.test/personal/owner",
            owner: { user: { id: "raw-user-owner", displayName: "Owner Example" } },
            quota: { state: "normal", total: 500 }
          }
        ],
        status: 200
      }
    ],
    [`/drives/raw-onedrive-1/root/children?$select=${driveItemSelect}`]: [
      {
        value: [
          {
            id: "raw-onedrive-file-1",
            name: "Personal Notes.txt",
            webUrl: "https://contoso-my.sharepoint.test/personal/owner/Documents/Personal%20Notes.txt",
            file: { mimeType: "text/plain" },
            size: 5,
            parentReference: { driveId: "raw-onedrive-1", id: "root", path: "/drive/root:" }
          }
        ],
        status: 200
      }
    ],
    [`/sites/raw-site-1/permissions?$select=${permissionSelect}`]: [
      {
        value: [
          {
            id: "raw-site-perm-1",
            roles: ["read"],
            grantedToV2: { user: { id: "raw-user-owner", displayName: "Owner Example" } }
          },
          {
            id: "raw-site-link-1",
            roles: ["read"],
            link: { type: "view", scope: "anonymous" }
          }
        ],
        status: 200
      }
    ],
    [`/drives/raw-drive-site/root/permissions?$select=${permissionSelect}`]: [
      {
        value: [
          {
            id: "raw-drive-perm-1",
            roles: ["write"],
            grantedToIdentitiesV2: [
              { group: { id: "raw-group-sharepoint", displayName: "SharePoint Reviewers" } }
            ]
          }
        ],
        status: 200
      }
    ],
    [`/drives/raw-drive-site/items/raw-folder-1/permissions?$select=${permissionSelect}`]: [
      {
        value: [
          {
            id: "raw-folder-perm-1",
            roles: ["read"],
            inheritedFrom: { driveId: "raw-drive-site", id: "root" },
            grantedToV2: { user: { id: "raw-user-owner", displayName: "Owner Example" } }
          }
        ],
        status: 200
      }
    ],
    [`/drives/raw-drive-site/items/raw-file-1/permissions?$select=${permissionSelect}`]: [
      {
        value: [
          {
            id: "raw-file-perm-1",
            roles: ["write"],
            grantedToV2: { user: { id: "raw-user-owner", displayName: "Owner Example" } }
          }
        ],
        status: 200
      }
    ],
    [`/drives/raw-drive-site/items/raw-file-2/permissions?$select=${permissionSelect}`]: [
      { value: [], status: 200 }
    ],
    [`/drives/raw-onedrive-1/root/permissions?$select=${permissionSelect}`]: [
      {
        value: [
          {
            id: "raw-onedrive-root-perm-1",
            roles: ["owner"],
            grantedToV2: { user: { id: "raw-user-owner", displayName: "Owner Example" } }
          }
        ],
        status: 200
      }
    ],
    [`/drives/raw-onedrive-1/items/raw-onedrive-file-1/permissions?$select=${permissionSelect}`]: [
      {
        value: [
          {
            id: "raw-onedrive-file-perm-1",
            roles: ["read"],
            grantedToV2: { user: { id: "raw-user-owner", displayName: "Owner Example" } }
          }
        ],
        status: 200
      }
    ]
  });
}

export function createSharePointPermissionFixtureClient(
  drivePermissionPages: Array<MicrosoftGraphCollectionPage<unknown>>
): FixtureGraphClient {
  return new FixtureGraphClient({
    "/users?$select=id,displayName,userPrincipalName,accountEnabled,userType,externalUserState,deletedDateTime": [
      { value: [{ id: "raw-user-owner", displayName: "Owner", accountEnabled: true, userType: "Member" }], status: 200 }
    ],
    "/groups?$select=id,displayName,securityEnabled,mailEnabled,visibility,groupTypes,resourceProvisioningOptions,deletedDateTime": [
      { value: [], status: 200 }
    ],
    "/servicePrincipals?$select=id,displayName,appId,servicePrincipalType,appRoles,deletedDateTime": [
      { value: [], status: 200 }
    ],
    "/sites?$select=id,name,displayName,webUrl,isPersonalSite,root,siteCollection": [
      { value: [{ id: "raw-site-1", displayName: "Validation Site", isPersonalSite: false }], status: 200 }
    ],
    "/sites/raw-site-1/drives?$select=id,name,driveType,webUrl,createdDateTime,lastModifiedDateTime,owner,quota,sharePointIds": [
      { value: [{ id: "raw-drive-site", name: "Documents", driveType: "documentLibrary" }], status: 200 }
    ],
    [`/drives/raw-drive-site/root/children?$select=${driveItemSelect}`]: [
      { value: [], status: 200 }
    ],
    "/users/raw-user-owner/drives?$select=id,name,driveType,webUrl,createdDateTime,lastModifiedDateTime,owner,quota,sharePointIds": [
      { value: [], status: 200 }
    ],
    [`/sites/raw-site-1/permissions?$select=${permissionSelect}`]: [
      { value: [], status: 200 }
    ],
    [`/drives/raw-drive-site/root/permissions?$select=${permissionSelect}`]: drivePermissionPages
  });
}

export function createDeltaFixtureClient(): FixtureGraphClient {
  return new FixtureGraphClient({
    "/users?$select=id,displayName,userPrincipalName,accountEnabled,userType,externalUserState,deletedDateTime": [
      {
        value: [
          {
            id: "raw-user-1",
            displayName: "Alice Example",
            userPrincipalName: "alice@example.test",
            accountEnabled: true,
            userType: "Member"
          },
          {
            id: "raw-user-removed",
            displayName: "Departing Example",
            userPrincipalName: "departing@example.test",
            accountEnabled: true,
            userType: "Member"
          }
        ],
        status: 200,
        deltaLink: "/users/delta?$deltatoken=raw-user-delta-1"
      }
    ],
    "/users/delta?$deltatoken=raw-user-delta-1": [
      {
        value: [
          {
            id: "raw-user-removed",
            "@removed": { reason: "deleted" }
          }
        ],
        status: 200,
        deltaLink: "/users/delta?$deltatoken=raw-user-delta-2"
      }
    ],
    "/groups?$select=id,displayName,securityEnabled,mailEnabled,visibility,groupTypes,resourceProvisioningOptions,deletedDateTime": repeatedEmptyPages(2),
    "/servicePrincipals?$select=id,displayName,appId,servicePrincipalType,appRoles,deletedDateTime": repeatedEmptyPages(2),
    "/sites?$select=id,name,displayName,webUrl,isPersonalSite,root,siteCollection": repeatedEmptyPages(2),
    "/users/raw-user-1/drives?$select=id,name,driveType,webUrl,createdDateTime,lastModifiedDateTime,owner,quota,sharePointIds": repeatedEmptyPages(2),
    "/users/raw-user-removed/drives?$select=id,name,driveType,webUrl,createdDateTime,lastModifiedDateTime,owner,quota,sharePointIds": repeatedEmptyPages(1)
  });
}

export function createStaleDeltaFixtureClient(): FixtureGraphClient {
  return new FixtureGraphClient({
    "/users?$select=id,displayName,userPrincipalName,accountEnabled,userType,externalUserState,deletedDateTime": [
      {
        value: [
          {
            id: "raw-user-1",
            displayName: "Alice Example",
            userPrincipalName: "alice@example.test",
            accountEnabled: true,
            userType: "Member"
          }
        ],
        status: 200,
        deltaLink: "/users/delta?$deltatoken=raw-user-delta-stale-token"
      },
      {
        value: [
          {
            id: "raw-user-2",
            displayName: "Recovered Example",
            userPrincipalName: "recovered@example.test",
            accountEnabled: true,
            userType: "Member"
          }
        ],
        status: 200,
        deltaLink: "/users/delta?$deltatoken=raw-user-delta-recovered-token"
      }
    ],
    "/users/delta?$deltatoken=raw-user-delta-stale-token": [
      { value: [], status: 410 }
    ],
    "/groups?$select=id,displayName,securityEnabled,mailEnabled,visibility,groupTypes,resourceProvisioningOptions,deletedDateTime": repeatedEmptyPages(2),
    "/servicePrincipals?$select=id,displayName,appId,servicePrincipalType,appRoles,deletedDateTime": repeatedEmptyPages(2),
    "/sites?$select=id,name,displayName,webUrl,isPersonalSite,root,siteCollection": repeatedEmptyPages(2),
    "/users/raw-user-1/drives?$select=id,name,driveType,webUrl,createdDateTime,lastModifiedDateTime,owner,quota,sharePointIds": repeatedEmptyPages(1),
    "/users/raw-user-2/drives?$select=id,name,driveType,webUrl,createdDateTime,lastModifiedDateTime,owner,quota,sharePointIds": repeatedEmptyPages(1)
  });
}

export function createEmptySharePointOneDriveInventory(userIds: string[], runs = 1): Record<string, Array<MicrosoftGraphCollectionPage<unknown>>> {
  return {
    "/sites?$select=id,name,displayName,webUrl,isPersonalSite,root,siteCollection": repeatedEmptyPages(runs),
    ...Object.fromEntries(userIds.map((userId) => [
      `/users/${userId}/drives?$select=id,name,driveType,webUrl,createdDateTime,lastModifiedDateTime,owner,quota,sharePointIds`,
      repeatedEmptyPages(runs)
    ]))
  };
}

export function repeatedEmptyPages(count: number): Array<MicrosoftGraphCollectionPage<unknown>> {
  return Array.from({ length: count }, () => ({ value: [], status: 200 }));
}

export function createAuditEvent(eventId: string, occurredAt: string): AuditEvent {
  return {
    eventId,
    eventType: "connector.discovery",
    occurredAt,
    actor: "connector:microsoft-graph-entra-readonly",
    correlationId: `corr:${eventId}`,
    payloadHash: auditPayloadHash({}),
    payload: {}
  };
}

export function createTwoSyncFixtureClient(): FixtureGraphClient {
  return new FixtureGraphClient({
    "/users?$select=id,displayName,userPrincipalName,accountEnabled,userType,externalUserState,deletedDateTime": [
      { value: [{ id: "raw-user-1", displayName: "Alice Example", accountEnabled: true, userType: "Member" }], status: 200 },
      { value: [{ id: "raw-user-1", displayName: "Alice Example", accountEnabled: true, userType: "Member" }], status: 200 }
    ],
    "/groups?$select=id,displayName,securityEnabled,mailEnabled,visibility,groupTypes,resourceProvisioningOptions,deletedDateTime": [
      { value: [{ id: "raw-group-1", displayName: "Case Reviewers", securityEnabled: true, groupTypes: [] }], status: 200 },
      { value: [{ id: "raw-group-1", displayName: "Case Reviewers", securityEnabled: true, groupTypes: [] }], status: 200 }
    ],
    "/servicePrincipals?$select=id,displayName,appId,servicePrincipalType,appRoles,deletedDateTime": [
      {
        value: [{
          id: "raw-sp-1",
          displayName: "Case Portal",
          appId: "raw-app-id",
          servicePrincipalType: "Application",
          appRoles: [{ id: "raw-role-reader", displayName: "Reader", value: "Reader" }]
        }],
        status: 200
      },
      {
        value: [{
          id: "raw-sp-1",
          displayName: "Case Portal",
          appId: "raw-app-id",
          servicePrincipalType: "Application",
          appRoles: [{ id: "raw-role-reader", displayName: "Reader", value: "Reader" }]
        }],
        status: 200
      }
    ],
    "/groups/raw-group-1/members?$select=id,displayName,userPrincipalName,appId,servicePrincipalType": [
      { value: [{ id: "raw-user-1", "@odata.type": "#microsoft.graph.user", displayName: "Alice Example" }], status: 200 },
      { value: [{ id: "raw-user-1", "@odata.type": "#microsoft.graph.user", displayName: "Alice Example" }], status: 200 }
    ],
    "/servicePrincipals/raw-sp-1/appRoleAssignedTo?$select=id,principalId,principalType,principalDisplayName,resourceId,resourceDisplayName,appRoleId,createdDateTime": [
      {
        value: [{
          id: "raw-assignment-1",
          principalId: "raw-group-1",
          principalType: "Group",
          resourceId: "raw-sp-1",
          appRoleId: "raw-role-reader"
        }],
        status: 200
      },
      { value: [], status: 200 }
    ],
    ...createEmptySharePointOneDriveInventory(["raw-user-1"], 2)
  });
}

export function createPartialSecondSyncFixtureClient(): FixtureGraphClient {
  return new FixtureGraphClient({
    "/users?$select=id,displayName,userPrincipalName,accountEnabled,userType,externalUserState,deletedDateTime": [
      { value: [{ id: "raw-user-1", displayName: "Alice Example", accountEnabled: true, userType: "Member" }], status: 200 },
      { value: [{ id: "raw-user-1", displayName: "Alice Example", accountEnabled: true, userType: "Member" }], status: 200 }
    ],
    "/groups?$select=id,displayName,securityEnabled,mailEnabled,visibility,groupTypes,resourceProvisioningOptions,deletedDateTime": [
      { value: [{ id: "raw-group-1", displayName: "Case Reviewers", securityEnabled: true, groupTypes: [] }], status: 200 },
      { value: [{ id: "raw-group-1", displayName: "Case Reviewers", securityEnabled: true, groupTypes: [] }], status: 200 }
    ],
    "/servicePrincipals?$select=id,displayName,appId,servicePrincipalType,appRoles,deletedDateTime": [
      {
        value: [{
          id: "raw-sp-1",
          displayName: "Case Portal",
          appId: "raw-app-id",
          servicePrincipalType: "Application",
          appRoles: [{ id: "raw-role-reader", displayName: "Reader", value: "Reader" }]
        }],
        status: 200
      },
      {
        value: [{
          id: "raw-sp-1",
          displayName: "Case Portal",
          appId: "raw-app-id",
          servicePrincipalType: "Application",
          appRoles: [{ id: "raw-role-reader", displayName: "Reader", value: "Reader" }]
        }],
        status: 200
      }
    ],
    "/groups/raw-group-1/members?$select=id,displayName,userPrincipalName,appId,servicePrincipalType": [
      { value: [{ id: "raw-user-1", "@odata.type": "#microsoft.graph.user", displayName: "Alice Example" }], status: 200 },
      { value: [{ id: "raw-user-1", "@odata.type": "#microsoft.graph.user", displayName: "Alice Example" }], status: 200 }
    ],
    "/servicePrincipals/raw-sp-1/appRoleAssignedTo?$select=id,principalId,principalType,principalDisplayName,resourceId,resourceDisplayName,appRoleId,createdDateTime": [
      {
        value: [{
          id: "raw-assignment-1",
          principalId: "raw-group-1",
          principalType: "Group",
          resourceId: "raw-sp-1",
          appRoleId: "raw-role-reader"
        }],
        status: 200
      },
      { value: [], status: 503 }
    ],
    ...createEmptySharePointOneDriveInventory(["raw-user-1"], 2)
  });
}
