import type {
  JsonRecord,
  NativeGrant,
  NativePrincipalType,
  RelationshipTuple,
  Resource,
  Subject
} from "@access-kit/core";

import type { DriveInventorySource, GraphDrive, GraphDriveItem, GraphGroup, GraphServicePrincipal, GraphSite, GraphTeam } from "./provider-models.js";
import { graphRecordDeleted, isTeamsBackedGroup, redactValue, subjectPrefix, tombstoneAttributes } from "./provider-utils.js";

export interface MicrosoftGraphResourceMapperOptions {
  connectorId: string;
  tenantBoundary: string;
  now: () => string;
}

export class MicrosoftGraphResourceMapper {
  readonly #connectorId: string;
  readonly #tenantBoundary: string;
  readonly #now: () => string;

  constructor(options: MicrosoftGraphResourceMapperOptions) {
    this.#connectorId = options.connectorId;
    this.#tenantBoundary = options.tenantBoundary;
    this.#now = options.now;
  }

  subject(
    graphId: string,
    type: Subject["type"],
    displayName: string,
    identifiers: Record<string, string>,
    attributes: JsonRecord,
    lifecycleState: Subject["lifecycleState"]
  ): Subject {
    return {
      id: `${subjectPrefix(type)}:entra:${redactValue(graphId)}`,
      type,
      displayName,
      sourceSystem: this.#connectorId,
      lifecycleState,
      identifiers,
      attributes,
      version: "subject:v1",
      createdAt: this.#now(),
      lastSeenAt: this.#now()
    };
  }

  applicationResource(servicePrincipal: GraphServicePrincipal): Resource {
    const graphId = servicePrincipal.id ?? "unknown";
    return {
      id: `application:entra:${redactValue(graphId)}`,
      type: "application",
      displayName: `Entra application ${redactValue(graphId)}`,
      sourceSystem: this.#connectorId,
      ownerId: "user:access-kit-owner",
      dataStewardId: "user:access-kit-steward",
      technicalOwnerId: "user:access-kit-operator",
      classification: "internal",
      lifecycleState: graphRecordDeleted(servicePrincipal) ? "deleted" : "active",
      attributes: {
        tenantId: this.#tenantBoundary,
        graphObjectHash: redactValue(graphId),
        appIdHash: servicePrincipal.appId ? redactValue(servicePrincipal.appId) : "unknown",
        servicePrincipalType: servicePrincipal.servicePrincipalType ?? undefined,
        ...tombstoneAttributes(servicePrincipal),
        redacted: true
      },
      version: "resource:v1",
      createdAt: this.#now(),
      lastSeenAt: this.#now()
    };
  }

  m365GroupResource(group: GraphGroup): Resource {
    const graphId = group.id ?? "unknown";
    return {
      id: `workspace:m365-group:${redactValue(graphId)}`,
      type: "workspace",
      displayName: `Microsoft 365 group ${redactValue(graphId)}`,
      sourceSystem: this.#connectorId,
      ownerId: "user:access-kit-owner",
      dataStewardId: "user:access-kit-steward",
      technicalOwnerId: "user:access-kit-operator",
      classification: group.visibility === "Private" ? "confidential" : "internal",
      lifecycleState: graphRecordDeleted(group) ? "deleted" : "active",
      attributes: {
        tenantId: this.#tenantBoundary,
        graphObjectHash: redactValue(graphId),
        graphType: "microsoft365Group",
        securityEnabled: group.securityEnabled ?? undefined,
        mailEnabled: group.mailEnabled ?? undefined,
        visibility: group.visibility ?? undefined,
        teamBacked: isTeamsBackedGroup(group),
        ...tombstoneAttributes(group),
        redacted: true
      },
      version: "resource:v1",
      createdAt: this.#now(),
      lastSeenAt: this.#now()
    };
  }

  sharePointSiteResource(site: GraphSite): Resource {
    const graphId = site.id ?? "unknown";
    const personalSite = Boolean(site.isPersonalSite);
    return {
      id: `sharepoint-site:microsoft-graph:${redactValue(graphId)}`,
      type: "sharepoint_site",
      displayName: `${personalSite ? "OneDrive personal site" : "SharePoint site"} ${redactValue(graphId)}`,
      sourceSystem: this.#connectorId,
      ownerId: "user:access-kit-owner",
      dataStewardId: "user:access-kit-steward",
      technicalOwnerId: "user:access-kit-operator",
      classification: personalSite ? "confidential" : "internal",
      lifecycleState: graphRecordDeleted(site) ? "deleted" : "active",
      attributes: {
        tenantId: this.#tenantBoundary,
        graphObjectHash: redactValue(graphId),
        graphType: "site",
        siteKind: personalSite ? "onedrive_personal_site" : "sharepoint_site",
        hostnameHash: site.siteCollection?.hostname ? redactValue(site.siteCollection.hostname) : undefined,
        dataLocationCode: site.siteCollection?.dataLocationCode ?? undefined,
        rootSite: Boolean(site.root || site.siteCollection?.root),
        webUrlHash: site.webUrl ? redactValue(site.webUrl) : undefined,
        ...tombstoneAttributes(site),
        redacted: true
      },
      version: "resource:v1",
      createdAt: this.#now(),
      lastSeenAt: this.#now()
    };
  }

  driveResource(drive: GraphDrive, source: DriveInventorySource): Resource {
    const graphId = drive.id ?? "unknown";
    const sourceAttributes = source.kind === "sharepoint"
      ? {
          inventorySource: "sharepoint_site",
          inheritedFromObjectId: source.siteResource.id
        }
      : {
          inventorySource: "onedrive_user",
          ownerSubjectId: source.ownerSubject?.id,
          ownerUserHash: source.user.id ? redactValue(source.user.id) : undefined,
          inheritedFromObjectId: source.ownerSubject?.id
        };

    return {
      id: `workspace:microsoft-graph-drive:${redactValue(graphId)}`,
      type: "workspace",
      displayName: `${source.kind === "sharepoint" ? "SharePoint drive" : "OneDrive drive"} ${redactValue(graphId)}`,
      sourceSystem: this.#connectorId,
      ownerId: "user:access-kit-owner",
      dataStewardId: "user:access-kit-steward",
      technicalOwnerId: "user:access-kit-operator",
      classification: source.kind === "onedrive" ? "confidential" : "internal",
      lifecycleState: graphRecordDeleted(drive) ? "deleted" : "active",
      parentId: source.kind === "sharepoint" ? source.siteResource.id : undefined,
      attributes: {
        tenantId: this.#tenantBoundary,
        graphObjectHash: redactValue(graphId),
        graphType: "drive",
        driveType: drive.driveType ?? undefined,
        nameHash: drive.name ? redactValue(drive.name) : undefined,
        webUrlHash: drive.webUrl ? redactValue(drive.webUrl) : undefined,
        quotaState: drive.quota?.state ?? undefined,
        quotaTotalBytes: drive.quota?.total ?? undefined,
        sharePointSiteHash: drive.sharePointIds?.siteId ? redactValue(drive.sharePointIds.siteId) : undefined,
        sharePointWebHash: drive.sharePointIds?.webId ? redactValue(drive.sharePointIds.webId) : undefined,
        sharePointListHash: drive.sharePointIds?.listId ? redactValue(drive.sharePointIds.listId) : undefined,
        ownerUserHash: drive.owner?.user?.id ? redactValue(drive.owner.user.id) : undefined,
        ownerGroupHash: drive.owner?.group?.id ? redactValue(drive.owner.group.id) : undefined,
        inheritanceAmbiguous: true,
        inheritanceMarker: "provider_permissions_deferred_to_native_grant_readback",
        canonicalAccessGranted: false,
        ...sourceAttributes,
        ...tombstoneAttributes(drive),
        redacted: true
      },
      version: "resource:v1",
      createdAt: this.#now(),
      lastSeenAt: this.#now()
    };
  }

  driveItemResource(
    drive: GraphDrive,
    item: GraphDriveItem,
    type: Extract<Resource["type"], "folder" | "document">,
    parentResource: Resource
  ): Resource {
    const graphId = item.id ?? "unknown";
    const isFolder = type === "folder";
    return {
      id: `${isFolder ? "folder" : "document"}:microsoft-graph-drive-item:${redactValue(graphId)}`,
      type,
      displayName: `${isFolder ? "Microsoft Graph folder" : "Microsoft Graph file"} ${redactValue(graphId)}`,
      sourceSystem: this.#connectorId,
      ownerId: "user:access-kit-owner",
      dataStewardId: "user:access-kit-steward",
      technicalOwnerId: "user:access-kit-operator",
      classification: parentResource.classification,
      lifecycleState: graphRecordDeleted(item) ? "deleted" : "active",
      parentId: parentResource.id,
      attributes: {
        tenantId: this.#tenantBoundary,
        graphObjectHash: redactValue(graphId),
        graphType: "driveItem",
        driveHash: drive.id ? redactValue(drive.id) : undefined,
        itemFacet: item.folder ? "folder" : item.package ? "package" : "file",
        nameHash: item.name ? redactValue(item.name) : undefined,
        webUrlHash: item.webUrl ? redactValue(item.webUrl) : undefined,
        mimeType: item.file?.mimeType ?? undefined,
        sizeBytes: item.size ?? undefined,
        folderChildCount: item.folder?.childCount ?? undefined,
        parentReferenceHash: item.parentReference?.id ? redactValue(item.parentReference.id) : undefined,
        parentPathHash: item.parentReference?.path ? redactValue(item.parentReference.path) : undefined,
        inheritedFromObjectId: parentResource.id,
        inheritanceAmbiguous: true,
        inheritanceMarker: "provider_permissions_deferred_to_native_grant_readback",
        canonicalAccessGranted: false,
        ...tombstoneAttributes(item),
        redacted: true
      },
      version: "resource:v1",
      createdAt: this.#now(),
      lastSeenAt: this.#now()
    };
  }

  teamResource(group: GraphGroup, team: GraphTeam | undefined, parentId: string): Resource {
    const graphId = team?.id ?? group.id ?? "unknown";
    return {
      id: `team:microsoft-graph:${redactValue(graphId)}`,
      type: "team",
      displayName: `Microsoft Teams team ${redactValue(graphId)}`,
      sourceSystem: this.#connectorId,
      ownerId: "user:access-kit-owner",
      dataStewardId: "user:access-kit-steward",
      technicalOwnerId: "user:access-kit-operator",
      classification: (team?.visibility ?? group.visibility) === "Private" ? "confidential" : "internal",
      lifecycleState: graphRecordDeleted(group) ? "deleted" : "active",
      parentId,
      attributes: {
        tenantId: this.#tenantBoundary,
        graphObjectHash: redactValue(graphId),
        backingGroupHash: redactValue(group.id ?? "unknown"),
        graphType: "team",
        archived: team?.isArchived ?? undefined,
        visibility: team?.visibility ?? group.visibility ?? undefined,
        couplingSource: team ? "microsoft_graph_team" : "microsoft_graph_group_marker",
        ...tombstoneAttributes(group),
        redacted: true
      },
      version: "resource:v1",
      createdAt: this.#now(),
      lastSeenAt: this.#now()
    };
  }

  nativeGrant(
    idSeed: string,
    resource: Resource,
    subject: Subject,
    principalType: NativePrincipalType,
    nativePermission: string,
    grantType: NativeGrant["grantType"],
    source: string,
    attributes: JsonRecord,
    inheritedFromObjectId?: string
  ): NativeGrant {
    return {
      id: `native-grant:${this.#connectorId}:${redactValue(idSeed)}`,
      targetPlatform: this.#connectorId,
      targetObjectId: resource.id,
      subjectId: subject.id,
      principalType,
      nativePermission,
      grantType,
      sourceConnectorId: this.#connectorId,
      status: "observed",
      observedAt: this.#now(),
      inheritedFromObjectId,
      attributes: {
        tenantId: this.#tenantBoundary,
        source,
        ...attributes,
        redacted: true
      },
      version: "native-grant:v1",
      createdAt: this.#now()
    };
  }

  relationship(
    idSeed: string,
    subjectId: string,
    relation: string,
    objectId: string,
    attributes: JsonRecord = {}
  ): RelationshipTuple {
    return {
      id: `relationship:${this.#connectorId}:${redactValue(idSeed)}`,
      subjectId,
      relation,
      objectId,
      sourceSystem: this.#connectorId,
      assertedAt: this.#now(),
      status: "active",
      attributes: {
        tenantId: this.#tenantBoundary,
        ...attributes,
        redacted: true
      },
      version: "tuple:v1",
      createdAt: this.#now()
    };
  }


}
