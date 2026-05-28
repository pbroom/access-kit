import { describe, expect, it } from "vitest";
import {
  MICROSOFT_GRAPH_ENTRA_CONNECTOR_ID,
  MicrosoftGraphEntraReadOnlyConnector
} from "../../packages/connectors-microsoft-graph/src/index.js";
import {
  createRebacLocalApp,
  readNativeAccess,
  syncConnector
} from "../../packages/api/src/local-app.js";
import {
  createSharePointOneDriveFixtureClient,
  createSharePointPermissionFixtureClient,
  driveItemSelect,
  noSleep,
  now,
  permissionSelect
} from "./microsoft-graph-fixtures.js";

describe("MicrosoftGraphEntraReadOnlyConnector SharePoint and OneDrive", () => {
  it("imports redacted SharePoint and OneDrive native grants without granting canonical access", async () => {
    const client = createSharePointOneDriveFixtureClient();
    const connector = new MicrosoftGraphEntraReadOnlyConnector({
      client,
      tenantId: "tenant-live-123",
      now: () => now,
      sleep: noSleep,
      sandboxEvidenceRef: "reports/microsoft-graph-sharepoint-onedrive-sandbox-fixture.json"
    });

    const resources = await connector.discoverResources();
    const relationships = await connector.discoverRelationships();
    const metadata = connector.getDiscoveryMetadata();
    const site = resources.find((resource) => resource.type === "sharepoint_site");
    const drives = resources.filter((resource) => resource.type === "workspace" && resource.attributes?.graphType === "drive");
    const folder = resources.find((resource) => resource.type === "folder");
    const documents = resources.filter((resource) => resource.type === "document");
    const siteGrants = await connector.readCurrentAccess(site!.id);
    const driveGrants = await connector.readCurrentAccess(drives[0]!.id);
    const folderGrants = await connector.readCurrentAccess(folder!.id);
    const fileGrants = await connector.readCurrentAccess(documents[1]!.id);
    const oneDriveFileGrants = await connector.readCurrentAccess(documents[2]!.id);
    const serialized = JSON.stringify({
      resources,
      relationships,
      siteGrants,
      driveGrants,
      folderGrants,
      fileGrants,
      oneDriveFileGrants,
      metadata
    });

    expect(site).toEqual(expect.objectContaining({
      type: "sharepoint_site",
      sourceSystem: MICROSOFT_GRAPH_ENTRA_CONNECTOR_ID,
      attributes: expect.objectContaining({
        graphType: "site",
        siteKind: "sharepoint_site",
        redacted: true
      })
    }));
    expect(drives).toHaveLength(2);
    expect(drives).toEqual(expect.arrayContaining([
      expect.objectContaining({
        parentId: site!.id,
        attributes: expect.objectContaining({
          inventorySource: "sharepoint_site",
          inheritanceAmbiguous: true,
          canonicalAccessGranted: false
        })
      }),
      expect.objectContaining({
        attributes: expect.objectContaining({
          inventorySource: "onedrive_user",
          ownerSubjectId: expect.stringMatching(/^user:entra:/),
          inheritanceAmbiguous: true,
          canonicalAccessGranted: false
        })
      })
    ]));
    expect(folder).toEqual(expect.objectContaining({
      parentId: expect.stringMatching(/^workspace:microsoft-graph-drive:/),
      attributes: expect.objectContaining({
        itemFacet: "folder",
        inheritedFromObjectId: expect.stringMatching(/^workspace:microsoft-graph-drive:/),
        inheritanceMarker: "provider_permissions_deferred_to_native_grant_readback",
        canonicalAccessGranted: false
      })
    }));
    expect(documents).toHaveLength(3);
    expect(metadata.warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining([
      "GRAPH_SHAREPOINT_ONEDRIVE_INHERITANCE_AMBIGUOUS",
      "GRAPH_NATIVE_GRANT_LINK_SEMANTICS_UNSUPPORTED"
    ]));
    expect(metadata.warnings
      .filter((warning) => warning.code === "GRAPH_SHAREPOINT_ONEDRIVE_INHERITANCE_AMBIGUOUS")
      .map((warning) => warning.objectId)
    ).toEqual(expect.arrayContaining(resources
      .filter((resource) => resource.attributes?.inheritanceAmbiguous === true)
      .map((resource) => resource.id)));
    const oneDriveEnumerationWarnings = metadata.warnings
      .filter((warning) => warning.code === "GRAPH_ONEDRIVE_USER_ENUMERATION_SEQUENTIAL");
    expect(oneDriveEnumerationWarnings).toHaveLength(1);
    expect(oneDriveEnumerationWarnings[0]).not.toHaveProperty("objectId");
    expect(relationships.map((relationship) => relationship.relation)).not.toEqual(expect.arrayContaining([
      "sharepoint_reader",
      "onedrive_reader",
      "file_reader"
    ]));
    expect(siteGrants).toEqual([
      expect.objectContaining({
        targetObjectId: site!.id,
        nativePermission: "sharePointSite:read",
        principalType: "user",
        grantType: "direct",
        sourceConnectorId: MICROSOFT_GRAPH_ENTRA_CONNECTOR_ID
      })
    ]);
    expect(driveGrants).toEqual(expect.arrayContaining([
      expect.objectContaining({
        targetObjectId: drives[0]!.id,
        nativePermission: "drive:write",
        principalType: "group",
        grantType: "group"
      })
    ]));
    expect(folderGrants).toEqual([
      expect.objectContaining({
        targetObjectId: folder!.id,
        inheritedFromObjectId: drives[0]!.id,
        nativePermission: "driveItem:read",
        grantType: "inherited"
      })
    ]);
    expect(fileGrants).toEqual([
      expect.objectContaining({
        targetObjectId: documents[1]!.id,
        nativePermission: "driveItem:write",
        principalType: "user"
      })
    ]);
    expect(oneDriveFileGrants).toEqual([
      expect.objectContaining({
        nativePermission: "driveItem:read",
        attributes: expect.objectContaining({
          resourceKind: "drive_item",
          redacted: true
        })
      })
    ]);
    expect(client.calls).toEqual(expect.arrayContaining([
      "/sites?$select=id,name,displayName,webUrl,isPersonalSite,root,siteCollection",
      "/sites/raw-site-1/drives?$select=id,name,driveType,webUrl,createdDateTime,lastModifiedDateTime,owner,quota,sharePointIds",
      `/drives/raw-drive-site/root/children?$select=${driveItemSelect}`,
      `/drives/raw-drive-site/items/raw-folder-1/children?$select=${driveItemSelect}`,
      "/users/raw-user-owner/drives?$select=id,name,driveType,webUrl,createdDateTime,lastModifiedDateTime,owner,quota,sharePointIds",
      `/drives/raw-onedrive-1/root/children?$select=${driveItemSelect}`,
      `/sites/raw-site-1/permissions?$select=${permissionSelect}`,
      `/drives/raw-drive-site/root/permissions?$select=${permissionSelect}`,
      `/drives/raw-drive-site/items/raw-folder-1/permissions?$select=${permissionSelect}`,
      `/drives/raw-drive-site/items/raw-file-1/permissions?$select=${permissionSelect}`,
      `/drives/raw-onedrive-1/items/raw-onedrive-file-1/permissions?$select=${permissionSelect}`
    ]));
    expect(serialized).not.toContain("tenant-live-123");
    expect(serialized).not.toContain("raw-site-1");
    expect(serialized).not.toContain("raw-site-perm-1");
    expect(serialized).not.toContain("raw-drive-site");
    expect(serialized).not.toContain("raw-onedrive-1");
    expect(serialized).not.toContain("Case Documents");
    expect(serialized).not.toContain("Sensitive Case Plan.docx");
    expect(serialized).not.toContain("Personal Notes.txt");
    expect(serialized).not.toContain("owner@example.test");
    expect(serialized).not.toContain("contoso.sharepoint.test");
  });

  it("preserves previous SharePoint native grants when permission readback is incomplete", async () => {
    const app = createRebacLocalApp({ now: () => now });
    app.connectors.set(MICROSOFT_GRAPH_ENTRA_CONNECTOR_ID, new MicrosoftGraphEntraReadOnlyConnector({
      client: createSharePointPermissionFixtureClient([
        {
          value: [{
            id: "raw-drive-perm-1",
            roles: ["read"],
            grantedToV2: { user: { id: "raw-user-owner", displayName: "Owner" } }
          }],
          status: 200
        }
      ]),
      tenantId: "tenant-live-123",
      now: () => now,
      sleep: noSleep,
      sandboxEvidenceRef: "reports/microsoft-graph-sharepoint-onedrive-sandbox-fixture.json"
    }));

    await syncConnector(app, MICROSOFT_GRAPH_ENTRA_CONNECTOR_ID, "read_only");
    const drive = app.store.listResources().find((resource) => resource.type === "workspace" && resource.attributes?.graphType === "drive");
    expect(drive).toBeDefined();
    expect(readNativeAccess(app, drive!.id)).toEqual([
      expect.objectContaining({ nativePermission: "drive:read" })
    ]);

    app.connectors.set(MICROSOFT_GRAPH_ENTRA_CONNECTOR_ID, new MicrosoftGraphEntraReadOnlyConnector({
      client: createSharePointPermissionFixtureClient([
        { value: [], status: 503 }
      ]),
      tenantId: "tenant-live-123",
      now: () => now,
      maxRetries: 0,
      sleep: noSleep,
      sandboxEvidenceRef: "reports/microsoft-graph-sharepoint-onedrive-sandbox-fixture.json"
    }));

    const second = await syncConnector(app, MICROSOFT_GRAPH_ENTRA_CONNECTOR_ID, "read_only");
    expect(second.status).toBe("completed_with_warnings");
    expect(second.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "GRAPH_COLLECTION_SKIPPED",
        scope: "native_grants"
      })
    ]));
    expect(readNativeAccess(app, drive!.id)).toEqual([
      expect.objectContaining({ nativePermission: "drive:read" })
    ]);
  });

  it("replaces SharePoint native grants when complete permission readback returns empty coverage", async () => {
    const app = createRebacLocalApp({ now: () => now });
    app.connectors.set(MICROSOFT_GRAPH_ENTRA_CONNECTOR_ID, new MicrosoftGraphEntraReadOnlyConnector({
      client: createSharePointPermissionFixtureClient([
        {
          value: [{
            id: "raw-drive-perm-1",
            roles: ["read"],
            grantedToV2: { user: { id: "raw-user-owner", displayName: "Owner" } }
          }],
          status: 200
        }
      ]),
      tenantId: "tenant-live-123",
      now: () => now,
      sleep: noSleep,
      sandboxEvidenceRef: "reports/microsoft-graph-sharepoint-onedrive-sandbox-fixture.json"
    }));

    await syncConnector(app, MICROSOFT_GRAPH_ENTRA_CONNECTOR_ID, "read_only");
    const drive = app.store.listResources().find((resource) => resource.type === "workspace" && resource.attributes?.graphType === "drive");
    expect(drive).toBeDefined();
    expect(readNativeAccess(app, drive!.id)).toHaveLength(1);

    app.connectors.set(MICROSOFT_GRAPH_ENTRA_CONNECTOR_ID, new MicrosoftGraphEntraReadOnlyConnector({
      client: createSharePointPermissionFixtureClient([
        { value: [], status: 200 }
      ]),
      tenantId: "tenant-live-123",
      now: () => now,
      sleep: noSleep,
      sandboxEvidenceRef: "reports/microsoft-graph-sharepoint-onedrive-sandbox-fixture.json"
    }));

    const second = await syncConnector(app, MICROSOFT_GRAPH_ENTRA_CONNECTOR_ID, "read_only");
    expect(second.status).toBe("completed_with_warnings");
    expect(readNativeAccess(app, drive!.id)).toEqual([]);
  });
});
