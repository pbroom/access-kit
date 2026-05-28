import {
  createReadOnlyDryRunPlan,
  createReadOnlyNoWriteApplyFailure,
  createReadOnlyRevocationPlan,
  type AuditEvent,
  type ConnectorAdapter,
  type ConnectorCapabilities,
  type ConnectorDiscoveryMetadata,
  type ConnectorHealthCheck,
  type ConnectorSecurityReview,
  type DecisionResult,
  type DiscoveryCursor,
  type DiscoveryRunWarning,
  type DriftFinding,
  type EvidenceExport,
  type NativeGrant,
  type NativePrincipalType,
  type ProvisioningPlan,
  type RelationshipTuple,
  type Resource,
  type Subject
} from "@access-kit/core";

import {
  DEFAULT_MAX_DRIVE_ITEM_DEPTH,
  DEFAULT_MAX_PAGES,
  DEFAULT_MAX_RETRIES,
  MICROSOFT_GRAPH_ENTRA_CONNECTOR_ID,
  MICROSOFT_GRAPH_ENTRA_FORBIDDEN_WRITE_SCOPES,
  MICROSOFT_GRAPH_ENTRA_REQUIRED_READ_SCOPES
} from "./constants.js";
import {
  FetchMicrosoftGraphClient,
  sleep,
  type MicrosoftGraphReadClient
} from "./client.js";
import { MicrosoftGraphCollectionReader } from "./collection-reader.js";
import { MicrosoftGraphResourceMapper } from "./resource-mappers.js";
import { createMicrosoftGraphEvidenceExport } from "./evidence.js";
import type {
  DriveInventorySource,
  EntraEntityMaps,
  EntraSnapshot,
  GraphAppRole,
  GraphAppRoleAssignment,
  GraphDirectoryObject,
  GraphDrive,
  GraphDriveItem,
  GraphGroup,
  GraphPermission,
  GraphServicePrincipal,
  GraphSite,
  GraphTeam,
  GraphUser,
  MicrosoftGraphConnectorEnv,
  MicrosoftPermissionGrantTarget,
  RelationshipCoverage,
  SharePointOneDriveInventoryCoverage
} from "./provider-models.js";
import {
  appRolePermission,
  compactTimestamp,
  createTenantBoundary,
  driveItemChildrenPath,
  driveItemResourceType,
  driveRootChildrenPath,
  graphRecordDeleted,
  isDriveItemContainer,
  isGraphServicePrincipalObject,
  isM365Group,
  isSecurityRelevantCoverageWarning,
  isTeamsBackedGroup,
  mapAppRoles,
  nativeGrantTypeForPrincipal,
  nativePermissionPrefix,
  permissionIdentities,
  permissionPathForTarget,
  permissionPrincipalType,
  readTokenFile,
  redactValue,
  safePermissionLabel,
  tombstoneAttributes,
  uniqueResources
} from "./provider-utils.js";

export interface MicrosoftGraphEntraConnectorOptions {
  id?: string;
  client: MicrosoftGraphReadClient;
  tenantId: string;
  tenantBoundary?: string;
  now?: () => string;
  sandboxEvidenceRef?: string;
  credentialHandling?: "managed_identity" | "vault_required";
  maxPages?: number;
  maxRetries?: number;
  maxDriveItemDepth?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export class MicrosoftGraphEntraReadOnlyConnector implements ConnectorAdapter {
  mode: ConnectorAdapter["mode"] = "read_only";
  readonly id: string;
  readonly provider = "microsoft-graph";
  readonly tenantBoundary: string;
  readonly requiredReadScopes = [...MICROSOFT_GRAPH_ENTRA_REQUIRED_READ_SCOPES];
  readonly capabilities: ConnectorCapabilities = {
    supportsDiscovery: true,
    supportsProvisioning: false,
    supportsReconciliation: true,
    supportsDirectPermissions: true,
    supportsInheritedPermissions: false,
    supportsExternalUsers: true,
    supportsTimeBoundAccess: false
  };

  readonly #client: MicrosoftGraphReadClient;
  readonly #tenantId: string;
  readonly #now: () => string;
  readonly #sandboxEvidenceRef?: string;
  readonly #credentialHandling: "managed_identity" | "vault_required";
  readonly #maxPages: number;
  readonly #maxRetries: number;
  readonly #maxDriveItemDepth: number;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  #snapshot?: EntraSnapshot;
  readonly #collectionReader: MicrosoftGraphCollectionReader;
  readonly #resourceMapper: MicrosoftGraphResourceMapper;
  #warnings: DiscoveryRunWarning[] = [];
  #nativeAccessReadbackComplete = true;

  constructor(options: MicrosoftGraphEntraConnectorOptions) {
    this.id = options.id ?? MICROSOFT_GRAPH_ENTRA_CONNECTOR_ID;
    this.#client = options.client;
    this.#tenantId = options.tenantId;
    this.tenantBoundary = options.tenantBoundary ?? createTenantBoundary(options.tenantId);
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#sandboxEvidenceRef = options.sandboxEvidenceRef;
    this.#credentialHandling = options.credentialHandling ?? "vault_required";
    this.#maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
    this.#maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.#maxDriveItemDepth = options.maxDriveItemDepth ?? DEFAULT_MAX_DRIVE_ITEM_DEPTH;
    this.#sleep = options.sleep ?? sleep;
    this.#collectionReader = new MicrosoftGraphCollectionReader({
      client: this.#client,
      maxPages: this.#maxPages,
      maxRetries: this.#maxRetries,
      now: this.#now,
      sleep: this.#sleep,
      pushWarning: (warning) => this.#pushWarning(warning)
    });
    this.#resourceMapper = new MicrosoftGraphResourceMapper({
      connectorId: this.id,
      tenantBoundary: this.tenantBoundary,
      now: this.#now
    });
  }

  async discoverSubjects(): Promise<Subject[]> {
    this.#snapshot = undefined;
    this.#warnings = [];
    this.#nativeAccessReadbackComplete = true;
    return (await this.#loadSnapshot()).subjects;
  }

  async discoverResources(): Promise<Resource[]> {
    return (await this.#loadSnapshot()).resources;
  }

  async discoverRelationships(): Promise<RelationshipTuple[]> {
    return (await this.#loadSnapshot()).relationships;
  }

  async readCurrentAccess(resourceId: string): Promise<NativeGrant[]> {
    return (await this.#loadSnapshot()).grantsByResource.get(resourceId) ?? [];
  }

  async testReadOnlyAccess(): Promise<ConnectorHealthCheck[]> {
    return [
      {
        name: "connector_registered",
        status: "pass",
        message: "Microsoft Graph Entra read-only connector is registered."
      },
      {
        name: "read_only_mode",
        status: this.mode === "read_only" ? "pass" : "fail",
        message: "Microsoft Graph connector must remain read-only."
      },
      {
        name: "tenant_boundary_redacted",
        status: this.tenantBoundary.includes(this.#tenantId) ? "fail" : "pass",
        message: "Tenant boundary must not expose the raw tenant identifier.",
        evidence: {
          tenantBoundary: this.tenantBoundary,
          redacted: true
        }
      },
      {
        name: "sandbox_evidence",
        status: this.#sandboxEvidenceRef ? "pass" : "warn",
        message: this.#sandboxEvidenceRef
          ? "Sandbox evidence reference is configured."
          : "Live sandbox evidence is not configured; discovery will emit a coverage warning.",
        evidence: {
          configured: Boolean(this.#sandboxEvidenceRef)
        }
      },
      ...this.requiredReadScopes.map((scope) => ({
        name: `scope:${scope}`,
        status: "pass" as const,
        message: "Approved Microsoft Graph read scope is part of the least-privilege readback set.",
        evidence: {
          provider: this.provider,
          tenantBoundary: this.tenantBoundary,
          writeScope: false
        }
      }))
    ];
  }

  getDiscoveryMetadata(): ConnectorDiscoveryMetadata {
    return {
      provider: this.provider,
      tenantBoundary: this.tenantBoundary,
      requiredReadScopes: this.requiredReadScopes,
      synthetic: false,
      warnings: [...this.#baseWarnings(), ...this.#warnings],
      nativeAccessReadbackComplete: this.#nativeAccessReadbackComplete,
      cursor: this.#snapshot?.cursor ?? this.#buildPreDiscoveryCursor()
    };
  }

  getSecurityReview(): ConnectorSecurityReview {
    const secretEvidence = [
      "docs/connector-contract.md",
      "docs/security-model.md",
      "adrs/0009-secret-management.md",
      "runbooks/compromised-connector-credential.md"
    ];

    return {
      connectorId: this.id,
      provider: this.provider,
      tenantBoundary: this.tenantBoundary,
      synthetic: false,
      identity: {
        kind: "service_principal",
        subject: `connector:${this.id}:${redactValue(this.#tenantId)}`,
        evidence: ["docs/connector-contract.md", "adrs/0006-connector-plugin-architecture.md"]
      },
      consent: {
        status: "approved",
        scopesApproved: this.requiredReadScopes,
        evidence: ["docs/connector-contract.md", "docs/security-model.md"]
      },
      leastPrivilege: {
        requiredReadScopes: this.requiredReadScopes,
        forbiddenWriteScopes: [...MICROSOFT_GRAPH_ENTRA_FORBIDDEN_WRITE_SCOPES],
        scopeJustification:
          "User, group membership and ownership, application, site, and file read permissions are sufficient for redacted tenant-wide Entra, Microsoft 365 group, SharePoint, OneDrive, service-principal, app-role assignment, and inventory readback without provider writes. TeamSettings.Read.Group is resource-specific consent and only enriches team records when granted for that team."
      },
      operations: {
        pagination: "required",
        throttling: "required",
        deletion: "mark_deleted",
        coverageWarnings: "required",
        nativeAccessReadback: true
      },
      secrets: {
        storesSecrets: false,
        handling: this.#credentialHandling,
        rotation: this.#credentialHandling === "managed_identity" ? "not_applicable" : "required",
        evidence: secretEvidence
      },
      enforcement: {
        liveWritesAllowed: false,
        controlledSyntheticOnly: false,
        readinessRequired: true,
        rollbackRequired: true,
        emergencyRevocationRequired: true,
        monitoringRequired: true
      }
    };
  }

  async planProvisioningChange(request: DecisionResult): Promise<ProvisioningPlan> {
    return createReadOnlyDryRunPlan({
      connectorId: this.id,
      request,
      createdAt: this.#now()
    });
  }

  async applyProvisioningChange(plan: ProvisioningPlan): Promise<ProvisioningPlan> {
    return createReadOnlyNoWriteApplyFailure(plan);
  }

  async verifyProvisioningChange(plan: ProvisioningPlan): Promise<boolean> {
    void plan;
    return false;
  }

  async revokeAccess(nativeGrantId: string): Promise<ProvisioningPlan> {
    return createReadOnlyRevocationPlan({
      connectorId: this.id,
      nativeGrantId,
      resourceId: "resource:unknown",
      createdAt: this.#now()
    });
  }

  async detectDrift(): Promise<DriftFinding[]> {
    await this.#loadSnapshot();
    const detectedAt = this.#now();
    return this.getDiscoveryMetadata()
      .warnings
      .filter(isSecurityRelevantCoverageWarning)
      .map((warning) => ({
        id: `drift:${this.id}:${redactValue(`${warning.code}:${warning.scope}:${warning.objectId ?? "connector"}`, 24)}`,
        resourceId: warning.objectId ?? `connector:${this.id}:${redactValue(this.#tenantId)}`,
        subjectId: `connector:${this.id}`,
        nativeAccess: warning.code,
        intendedAccess: "complete_provider_coverage",
        severity: warning.severity === "error" ? "high" : "medium",
        lifecycleState: "open",
        ownerId: "role:security-operations",
        assigneeId: "role:security-engineer",
        detectedAt,
        sourceConnectorId: this.id,
        recommendedAction: "review",
        status: "open",
        scheduledReconciliation: {
          cadence: "manual",
          scheduledAt: detectedAt,
          gracePeriodHours: 0,
          overdue: false
        },
        hookEvidence: [],
        remediation: {},
        autoRepairPolicy: {
          enabled: false,
          allowedActions: ["review"],
          maxSeverity: warning.severity === "error" ? "high" : "medium",
          requireApproval: true,
          requireConnectorReadiness: true,
          liveProviderWrites: false,
          reason: "Microsoft Graph coverage drift requires provider review and read-only verification before remediation."
        },
        version: "drift-finding:v1",
        createdAt: detectedAt,
        updatedAt: detectedAt
      }));
  }

  async emitEvidence(events: AuditEvent[]): Promise<EvidenceExport> {
    return createMicrosoftGraphEvidenceExport(this.id, events, this.#now());
  }

  async #loadSnapshot(): Promise<EntraSnapshot> {
    if (this.#snapshot) {
      return this.#snapshot;
    }

    this.#warnings = [];
    const startedFrom = this.#collectionReader.buildDeltaCursor() ?? "cursor:microsoft-graph:initial";
    const users = await this.#collectionReader.readCollection<GraphUser>(
      "/users?$select=id,displayName,userPrincipalName,accountEnabled,userType,externalUserState,deletedDateTime",
      "subjects"
    );
    const groups = await this.#collectionReader.readCollection<GraphGroup>(
      "/groups?$select=id,displayName,securityEnabled,mailEnabled,visibility,groupTypes,resourceProvisioningOptions,deletedDateTime",
      "subjects"
    );
    const servicePrincipals = await this.#collectionReader.readCollection<GraphServicePrincipal>(
      "/servicePrincipals?$select=id,displayName,appId,servicePrincipalType,appRoles,deletedDateTime",
      "resources"
    );
    const maps = this.#buildEntityMaps(users, groups, servicePrincipals);
    const relationshipCoverage = await this.#buildRelationships(groups, maps);
    const grantsByResource = await this.#buildNativeGrants(servicePrincipals, maps);
    const sharePointAndOneDriveCoverage = await this.#buildSharePointAndOneDriveInventory(users, maps);
    const sharePointAndOneDriveGrants = await this.#buildSharePointAndOneDriveNativeGrants(
      sharePointAndOneDriveCoverage.grantTargets,
      maps
    );
    for (const [resourceId, grants] of relationshipCoverage.grantsByResource.entries()) {
      grantsByResource.set(resourceId, [...(grantsByResource.get(resourceId) ?? []), ...grants]);
    }
    for (const [resourceId, grants] of sharePointAndOneDriveGrants.entries()) {
      grantsByResource.set(resourceId, [...(grantsByResource.get(resourceId) ?? []), ...grants]);
    }
    const cursor = this.#buildCursor(startedFrom);

    this.#snapshot = {
      subjects: [...maps.subjectsByGraphId.values()],
      resources: uniqueResources([
        ...maps.applicationResourcesByGraphId.values(),
        ...maps.m365GroupResourcesByGraphId.values(),
        ...maps.teamResourcesByGroupId.values(),
        ...sharePointAndOneDriveCoverage.resources
      ]),
      relationships: relationshipCoverage.relationships,
      grantsByResource,
      cursor
    };

    return this.#snapshot;
  }

  #buildEntityMaps(
    users: GraphUser[],
    groups: GraphGroup[],
    servicePrincipals: GraphServicePrincipal[]
  ): EntraEntityMaps {
    const subjectsByGraphId = new Map<string, Subject>();
    const subjectPrincipalTypes = new Map<string, NativePrincipalType>();
    const applicationResourcesByGraphId = new Map<string, Resource>();
    const m365GroupResourcesByGraphId = new Map<string, Resource>();
    const teamResourcesByGroupId = new Map<string, Resource>();
    const appRolesByServicePrincipalId = new Map<string, Map<string, GraphAppRole>>();

    for (const user of users) {
      if (!user.id) {
        this.#warnMissingId("subjects");
        continue;
      }

      const subject = this.#resourceMapper.subject(user.id, "user", `Entra user ${redactValue(user.id)}`, {
        graphObjectHash: redactValue(user.id),
        graphType: "user"
      }, {
        tenantId: this.tenantBoundary,
        accountEnabled: user.accountEnabled ?? undefined,
        external: user.userType === "Guest" || Boolean(user.externalUserState),
        ...tombstoneAttributes(user),
        redacted: true
      }, graphRecordDeleted(user) ? "deleted" : "active");
      subjectsByGraphId.set(user.id, subject);
      subjectPrincipalTypes.set(user.id, user.userType === "Guest" ? "external_user" : "user");
    }

    for (const group of groups) {
      if (!group.id) {
        this.#warnMissingId("subjects");
        continue;
      }

      subjectsByGraphId.set(group.id, this.#resourceMapper.subject(group.id, "group", `Entra group ${redactValue(group.id)}`, {
        graphObjectHash: redactValue(group.id),
        graphType: "group"
      }, {
        tenantId: this.tenantBoundary,
        securityEnabled: group.securityEnabled ?? undefined,
        ...tombstoneAttributes(group),
        redacted: true
      }, graphRecordDeleted(group) ? "deleted" : "active"));
      subjectPrincipalTypes.set(group.id, "group");

      if (isM365Group(group)) {
        m365GroupResourcesByGraphId.set(group.id, this.#resourceMapper.m365GroupResource(group));
      }
    }

    for (const servicePrincipal of servicePrincipals) {
      if (!servicePrincipal.id) {
        this.#warnMissingId("subjects");
        continue;
      }

      const subject = this.#resourceMapper.subject(
        servicePrincipal.id,
        "service_principal",
        `Entra service principal ${redactValue(servicePrincipal.id)}`,
        {
          graphObjectHash: redactValue(servicePrincipal.id),
          appIdHash: servicePrincipal.appId ? redactValue(servicePrincipal.appId) : "unknown",
          graphType: "servicePrincipal"
        },
        {
          tenantId: this.tenantBoundary,
          servicePrincipalType: servicePrincipal.servicePrincipalType ?? undefined,
          ...tombstoneAttributes(servicePrincipal),
          redacted: true
        },
        graphRecordDeleted(servicePrincipal) ? "deleted" : "active"
      );
      subjectsByGraphId.set(servicePrincipal.id, subject);
      subjectPrincipalTypes.set(servicePrincipal.id, "service_principal");
      applicationResourcesByGraphId.set(servicePrincipal.id, this.#resourceMapper.applicationResource(servicePrincipal));
      appRolesByServicePrincipalId.set(servicePrincipal.id, mapAppRoles(servicePrincipal.appRoles ?? []));
    }

    return {
      subjectsByGraphId,
      subjectPrincipalTypes,
      applicationResourcesByGraphId,
      m365GroupResourcesByGraphId,
      teamResourcesByGroupId,
      appRolesByServicePrincipalId
    };
  }

  async #buildRelationships(groups: GraphGroup[], maps: EntraEntityMaps): Promise<RelationshipCoverage> {
    const relationships: RelationshipTuple[] = [];
    const grantsByResource = new Map<string, NativeGrant[]>();

    for (const group of groups) {
      if (!group.id || !maps.subjectsByGraphId.has(group.id)) {
        continue;
      }

      const groupSubject = maps.subjectsByGraphId.get(group.id)!;
      const m365GroupResource = maps.m365GroupResourcesByGraphId.get(group.id);
      let teamResource: Resource | undefined;

      if (m365GroupResource) {
        relationships.push(this.#resourceMapper.relationship(
          `m365-group:${group.id}:workspace`,
          groupSubject.id,
          "m365_group_represents",
          m365GroupResource.id,
          {
            providerSemantics: "microsoft_365_group",
            source: "microsoft_graph_group",
            redacted: true
          }
        ));

        if (isTeamsBackedGroup(group)) {
          const team = await this.#readTeamForGroup(group);
          teamResource = this.#resourceMapper.teamResource(group, team, m365GroupResource.id);
          maps.teamResourcesByGroupId.set(group.id, teamResource);
          relationships.push(this.#resourceMapper.relationship(
            `m365-group:${group.id}:team`,
            m365GroupResource.id,
            "m365_group_backs_team",
            teamResource.id,
            {
              providerSemantics: "m365_group_team_coupling",
              source: team ? "microsoft_graph_team" : "microsoft_graph_group_marker",
              redacted: true
            }
          ));
          this.#pushWarning({
            code: "GRAPH_TEAM_CHANNEL_COVERAGE_UNSUPPORTED",
            message: "Microsoft Graph Teams coupling imported group-backed team membership only; private, shared, and channel-specific access remain unsupported coverage.",
            severity: "warning",
            scope: "native_grants",
            retryable: false
          });
        } else if ((group.resourceProvisioningOptions ?? []).length > 0) {
          this.#pushWarning({
            code: "GRAPH_M365_GROUP_WITHOUT_TEAM",
            message: "Microsoft Graph returned a Microsoft 365 group with non-empty resourceProvisioningOptions but no Teams backing marker; Teams membership semantics were not inferred for that group.",
            severity: "info",
            scope: "resources",
            retryable: false
          });
        }
      }

      const members = await this.#collectionReader.readCollection<GraphDirectoryObject>(
        `/groups/${encodeURIComponent(group.id)}/members?$select=id,displayName,userPrincipalName,appId,servicePrincipalType`,
        "relationships"
      );

      for (const member of members) {
        if (!member.id) {
          this.#warnMissingId("relationships");
          continue;
        }

        const subject = maps.subjectsByGraphId.get(member.id);
        if (!subject) {
          this.#pushWarning({
            code: "GRAPH_LIMITED_MEMBER_SKIPPED",
            message: "Microsoft Graph returned a group member with limited information; the member was skipped instead of becoming an incomplete canonical subject.",
            severity: "warning",
            scope: "relationships",
            retryable: false
          });
          continue;
        }

        const principalType = maps.subjectPrincipalTypes.get(member.id) ?? "unknown";
        relationships.push(this.#resourceMapper.relationship(
          `member:${member.id}:group:${group.id}`,
          subject.id,
          "member_of",
          groupSubject.id,
          {
            membershipType: "direct",
            source: "microsoft_graph_group_members",
            principalType,
            redacted: true
          }
        ));

        if (m365GroupResource) {
          relationships.push(this.#resourceMapper.relationship(
            `m365-member:${member.id}:group:${group.id}`,
            subject.id,
            "m365_group_member",
            m365GroupResource.id,
            {
              providerSemantics: "direct_m365_group_membership",
              source: "microsoft_graph_group_members",
              principalType,
              redacted: true
            }
          ));
          this.#addNativeGrant(grantsByResource, this.#resourceMapper.nativeGrant(
            `m365-member:${member.id}:group:${group.id}`,
            m365GroupResource,
            subject,
            principalType,
            "m365Group:member",
            nativeGrantTypeForPrincipal(principalType),
            "microsoft_graph_group_members",
            {
              groupHash: redactValue(group.id),
              membershipType: "direct",
              redacted: true
            }
          ));
        }

        if (teamResource) {
          relationships.push(this.#resourceMapper.relationship(
            `team-member:${member.id}:group:${group.id}`,
            subject.id,
            "team_member",
            teamResource.id,
            {
              providerSemantics: "team_membership_via_m365_group",
              source: "microsoft_graph_group_members",
              principalType,
              redacted: true
            }
          ));
          this.#addNativeGrant(grantsByResource, this.#resourceMapper.nativeGrant(
            `team-member:${member.id}:group:${group.id}`,
            teamResource,
            subject,
            principalType,
            "team:member",
            nativeGrantTypeForPrincipal(principalType),
            "microsoft_graph_group_members",
            {
              groupHash: redactValue(group.id),
              membershipType: "team_via_m365_group",
              redacted: true
            },
            m365GroupResource?.id
          ));
        }
      }

      if (m365GroupResource) {
        await this.#addM365Owners(group, m365GroupResource, teamResource, maps, relationships, grantsByResource);
      }
    }

    for (const [graphId, resource] of maps.applicationResourcesByGraphId.entries()) {
      const subject = maps.subjectsByGraphId.get(graphId);
      if (subject) {
        relationships.push(this.#resourceMapper.relationship(`sp:${graphId}:application`, subject.id, "represents", resource.id));
      }
    }

    return { relationships, grantsByResource };
  }

  async #addM365Owners(
    group: GraphGroup,
    m365GroupResource: Resource,
    teamResource: Resource | undefined,
    maps: EntraEntityMaps,
    relationships: RelationshipTuple[],
    grantsByResource: Map<string, NativeGrant[]>
  ): Promise<void> {
    const ownerRead = await this.#collectionReader.readCollectionResult<GraphDirectoryObject>(
      `/groups/${encodeURIComponent(group.id!)}/owners?$select=id,displayName,userPrincipalName,appId,servicePrincipalType`,
      "relationships"
    );
    const owners = ownerRead.values;

    if (ownerRead.completed && owners.length === 0) {
      this.#pushWarning({
        code: "GRAPH_M365_GROUP_OWNER_COVERAGE_EMPTY",
        message: "Microsoft Graph returned no owners for a Microsoft 365 group; ownership coverage was retained as a warning instead of inventing canonical owners.",
        severity: "warning",
        scope: "relationships",
        retryable: false
      });
    }

    if (owners.some(isGraphServicePrincipalObject)) {
      this.#pushWarning({
        code: "GRAPH_GROUP_OWNER_SERVICE_PRINCIPAL_VISIBILITY_LIMITED",
        message: "Microsoft Graph returned service-principal group owners; ownership evidence should treat service-principal owner coverage as tenant-rollout dependent.",
        severity: "info",
        scope: "relationships",
        retryable: false
      });
    }

    for (const owner of owners) {
      if (!owner.id) {
        this.#warnMissingId("relationships");
        continue;
      }

      const subject = maps.subjectsByGraphId.get(owner.id);
      if (!subject) {
        this.#pushWarning({
          code: "GRAPH_LIMITED_OWNER_SKIPPED",
          message: "Microsoft Graph returned a group owner outside the imported subject boundary; the owner was skipped instead of becoming an incomplete canonical subject.",
          severity: "warning",
          scope: "relationships",
          retryable: false
        });
        continue;
      }

      const principalType = maps.subjectPrincipalTypes.get(owner.id) ?? "unknown";
      relationships.push(this.#resourceMapper.relationship(
        `m365-owner:${owner.id}:group:${group.id}`,
        subject.id,
        "m365_group_owner",
        m365GroupResource.id,
        {
          providerSemantics: "m365_group_owner",
          source: "microsoft_graph_group_owners",
          principalType,
          redacted: true
        }
      ));
      this.#addNativeGrant(grantsByResource, this.#resourceMapper.nativeGrant(
        `m365-owner:${owner.id}:group:${group.id}`,
        m365GroupResource,
        subject,
        principalType,
        "m365Group:owner",
        nativeGrantTypeForPrincipal(principalType),
        "microsoft_graph_group_owners",
        {
          groupHash: redactValue(group.id!),
          ownershipType: "direct",
          redacted: true
        }
      ));

      if (teamResource) {
        relationships.push(this.#resourceMapper.relationship(
          `team-owner:${owner.id}:group:${group.id}`,
          subject.id,
          "team_owner",
          teamResource.id,
          {
            providerSemantics: "team_owner_via_m365_group",
            source: "microsoft_graph_group_owners",
            principalType,
            redacted: true
          }
        ));
        this.#addNativeGrant(grantsByResource, this.#resourceMapper.nativeGrant(
          `team-owner:${owner.id}:group:${group.id}`,
          teamResource,
          subject,
          principalType,
          "team:owner",
          nativeGrantTypeForPrincipal(principalType),
          "microsoft_graph_group_owners",
          {
            groupHash: redactValue(group.id!),
            ownershipType: "team_via_m365_group",
            redacted: true
          },
          m365GroupResource.id
        ));
      }
    }
  }

  async #readTeamForGroup(group: GraphGroup): Promise<GraphTeam | undefined> {
    return this.#collectionReader.readRecord<GraphTeam>(
      `/teams/${encodeURIComponent(group.id!)}?$select=id,displayName,description,webUrl,isArchived,visibility`,
      "resources",
      {
        code: "GRAPH_TEAM_COUPLING_SKIPPED",
        message: "Microsoft Graph reported a Teams-backed group but the team record could not be read; the group marker was retained with coverage warning."
      }
    );
  }

  async #buildSharePointAndOneDriveInventory(
    users: GraphUser[],
    maps: EntraEntityMaps
  ): Promise<SharePointOneDriveInventoryCoverage> {
    const resources = new Map<string, Resource>();
    const grantTargets: MicrosoftPermissionGrantTarget[] = [];
    const sites = await this.#collectionReader.readCollection<GraphSite>(
      "/sites?$select=id,name,displayName,webUrl,isPersonalSite,root,siteCollection",
      "resources"
    );
    this.#pushWarning({
      code: "GRAPH_SHAREPOINT_SITE_SEARCH_COVERAGE_LIMITED",
      message: "Microsoft Graph SharePoint inventory used the tenant sites collection without a deployment-specific search scope; operators must verify subsite coverage before treating inventory as complete.",
      severity: "warning",
      scope: "resources",
      retryable: false
    });

    if (sites.length === 0) {
      this.#pushWarning({
        code: "GRAPH_SHAREPOINT_SITES_COVERAGE_EMPTY",
        message: "Microsoft Graph returned no SharePoint sites for inventory; site and drive coverage is empty for this run.",
        severity: "info",
        scope: "resources",
        retryable: false
      });
    }

    for (const site of sites) {
      if (!site.id) {
        this.#warnMissingId("resources");
        continue;
      }

      const siteResource = this.#resourceMapper.sharePointSiteResource(site);
      resources.set(siteResource.id, siteResource);
      grantTargets.push({ resource: siteResource, kind: "sharepoint_site", siteId: site.id });
      await this.#addSiteDrives(site, siteResource, resources, grantTargets);
    }

    const enumerableUsers = users.filter(
      (user): user is GraphUser & { id: string } => Boolean(user.id) && !graphRecordDeleted(user)
    );
    if (enumerableUsers.length > 0) {
      this.#pushWarning({
        code: "GRAPH_ONEDRIVE_USER_ENUMERATION_SEQUENTIAL",
        message: "Microsoft Graph OneDrive inventory enumerates user drives per imported user; large tenants should monitor throttling and coverage before treating OneDrive inventory as complete.",
        severity: "info",
        scope: "resources",
        retryable: true
      });
    }

    for (const user of enumerableUsers) {
      await this.#addUserDrives(user, maps.subjectsByGraphId.get(user.id), resources, grantTargets);
    }

    return { resources: [...resources.values()], grantTargets };
  }

  async #addSiteDrives(
    site: GraphSite,
    siteResource: Resource,
    resources: Map<string, Resource>,
    grantTargets: MicrosoftPermissionGrantTarget[]
  ): Promise<void> {
    const drives = await this.#collectionReader.readCollection<GraphDrive>(
      `/sites/${encodeURIComponent(site.id!)}/drives?$select=id,name,driveType,webUrl,createdDateTime,lastModifiedDateTime,owner,quota,sharePointIds`,
      "resources"
    );

    if (drives.length === 0) {
      this.#pushWarning({
        code: "GRAPH_SHAREPOINT_SITE_DRIVES_EMPTY",
        message: "Microsoft Graph returned a SharePoint site without readable drives; document-library inventory may be incomplete.",
        severity: "info",
        scope: "resources",
        retryable: false,
        objectId: siteResource.id
      });
    }

    for (const drive of drives) {
      await this.#addDriveInventory(drive, { kind: "sharepoint", siteResource }, resources, grantTargets);
    }
  }

  async #addUserDrives(
    user: GraphUser,
    ownerSubject: Subject | undefined,
    resources: Map<string, Resource>,
    grantTargets: MicrosoftPermissionGrantTarget[]
  ): Promise<void> {
    const drives = await this.#collectionReader.readCollection<GraphDrive>(
      `/users/${encodeURIComponent(user.id!)}/drives?$select=id,name,driveType,webUrl,createdDateTime,lastModifiedDateTime,owner,quota,sharePointIds`,
      "resources"
    );

    if (drives.length === 0) {
      this.#pushWarning({
        code: "GRAPH_ONEDRIVE_DRIVES_EMPTY",
        message: "Microsoft Graph returned no readable OneDrive drives for at least one imported user; OneDrive coverage may be incomplete.",
        severity: "info",
        scope: "resources",
        retryable: false,
        objectId: ownerSubject?.id
      });
    }

    for (const drive of drives) {
      await this.#addDriveInventory(drive, { kind: "onedrive", user, ownerSubject }, resources, grantTargets);
    }
  }

  async #addDriveInventory(
    drive: GraphDrive,
    source: DriveInventorySource,
    resources: Map<string, Resource>,
    grantTargets: MicrosoftPermissionGrantTarget[]
  ): Promise<void> {
    if (!drive.id) {
      this.#warnMissingId("resources");
      return;
    }

    const driveResource = this.#resourceMapper.driveResource(drive, source);
    if (resources.has(driveResource.id)) {
      this.#pushWarning({
        code: "GRAPH_DRIVE_DUPLICATE_DISCOVERY",
        message: "Microsoft Graph returned the same drive through multiple inventory paths; duplicate drive resources were collapsed by redacted drive id.",
        severity: "info",
        scope: "resources",
        retryable: false,
        objectId: driveResource.id
      });
      return;
    }

    resources.set(driveResource.id, driveResource);
    grantTargets.push({ resource: driveResource, kind: "drive", driveId: drive.id });
    this.#recordInventoryInheritanceWarning(driveResource);
    await this.#addDriveItems(drive, driveRootChildrenPath(drive.id), driveResource, resources, grantTargets, 0);
  }

  async #addDriveItems(
    drive: GraphDrive,
    childrenPath: string,
    parentResource: Resource,
    resources: Map<string, Resource>,
    grantTargets: MicrosoftPermissionGrantTarget[],
    depth: number
  ): Promise<void> {
    if (!drive.id) {
      return;
    }

    if (depth >= this.#maxDriveItemDepth) {
      this.#pushWarning({
        code: "GRAPH_DRIVE_ITEM_DEPTH_LIMIT_REACHED",
        message: "Microsoft Graph drive item traversal reached the configured depth limit; deeper folders were skipped with coverage warning.",
        severity: "warning",
        scope: "resources",
        retryable: true,
        objectId: parentResource.id
      });
      return;
    }

    const items = await this.#collectionReader.readCollection<GraphDriveItem>(childrenPath, "resources");
    for (const item of items) {
      if (!item.id) {
        this.#warnMissingId("resources");
        continue;
      }

      const itemType = driveItemResourceType(item);
      if (!itemType) {
        this.#pushWarning({
          code: "GRAPH_DRIVE_ITEM_UNSUPPORTED_FACET_SKIPPED",
          message: "Microsoft Graph returned a drive item without a folder, package, or file facet; the item was skipped instead of becoming an ambiguous resource.",
          severity: "warning",
          scope: "resources",
          retryable: false,
          objectId: parentResource.id
        });
        continue;
      }

      const resource = this.#resourceMapper.driveItemResource(drive, item, itemType, parentResource);
      if (resources.has(resource.id)) {
        continue;
      }

      resources.set(resource.id, resource);
      grantTargets.push({ resource, kind: "drive_item", driveId: drive.id, itemId: item.id });
      this.#recordInventoryInheritanceWarning(resource);

      if (isDriveItemContainer(item)) {
        await this.#addDriveItems(drive, driveItemChildrenPath(drive.id, item.id), resource, resources, grantTargets, depth + 1);
      }
    }
  }

  async #buildNativeGrants(
    servicePrincipals: GraphServicePrincipal[],
    maps: EntraEntityMaps
  ): Promise<Map<string, NativeGrant[]>> {
    const grantsByResource = new Map<string, NativeGrant[]>();

    for (const servicePrincipal of servicePrincipals) {
      if (!servicePrincipal.id) {
        continue;
      }

      const resource = maps.applicationResourcesByGraphId.get(servicePrincipal.id);
      if (!resource) {
        continue;
      }

      const assignmentRead = await this.#collectionReader.readCollectionResult<GraphAppRoleAssignment>(
        `/servicePrincipals/${encodeURIComponent(servicePrincipal.id)}/appRoleAssignedTo?$select=id,principalId,principalType,principalDisplayName,resourceId,resourceDisplayName,appRoleId,createdDateTime`,
        "native_grants"
      );
      if (!assignmentRead.completed) {
        this.#nativeAccessReadbackComplete = false;
      }
      const assignments = assignmentRead.values;
      const appRoles = maps.appRolesByServicePrincipalId.get(servicePrincipal.id) ?? new Map<string, GraphAppRole>();
      const grants: NativeGrant[] = [];

      for (const assignment of assignments) {
        if (!assignment.id || !assignment.principalId) {
          this.#warnMissingId("native_grants");
          continue;
        }

        const subject = maps.subjectsByGraphId.get(assignment.principalId);
        const principalType = subject ? maps.subjectPrincipalTypes.get(assignment.principalId) ?? "unknown" : "unknown";
        if (!subject) {
          this.#pushWarning({
            code: "GRAPH_APP_ROLE_PRINCIPAL_SKIPPED",
            message: "Microsoft Graph returned an app-role assignment for a principal outside the imported subject boundary; the assignment was skipped.",
            severity: "warning",
            scope: "native_grants",
            retryable: false
          });
          continue;
        }

        grants.push({
          id: `native-grant:${this.id}:${redactValue(assignment.id)}`,
          targetPlatform: this.id,
          targetObjectId: resource.id,
          subjectId: subject.id,
          principalType,
          nativePermission: appRolePermission(assignment, appRoles),
          grantType: principalType === "group" ? "group" : "direct",
          sourceConnectorId: this.id,
          status: "observed",
          observedAt: this.#now(),
          attributes: {
            tenantId: this.tenantBoundary,
            source: "microsoft_graph_app_role_assignment",
            assignmentHash: redactValue(assignment.id),
            principalHash: redactValue(assignment.principalId),
            resourceHash: redactValue(servicePrincipal.id),
            redacted: true
          },
          version: "native-grant:v1",
          createdAt: this.#now()
        });
      }

      grantsByResource.set(resource.id, grants);
    }

    return grantsByResource;
  }

  async #buildSharePointAndOneDriveNativeGrants(
    targets: MicrosoftPermissionGrantTarget[],
    maps: EntraEntityMaps
  ): Promise<Map<string, NativeGrant[]>> {
    const grantsByResource = new Map<string, NativeGrant[]>();

    for (const target of targets) {
      const permissionsPath = permissionPathForTarget(target);
      if (!permissionsPath) {
        this.#pushWarning({
          code: "GRAPH_NATIVE_GRANT_TARGET_UNSUPPORTED",
          message: "Microsoft Graph native grant readback skipped a SharePoint or OneDrive resource whose provider permission path could not be determined.",
          severity: "warning",
          scope: "native_grants",
          retryable: false,
          objectId: target.resource.id
        });
        continue;
      }

      const permissionRead = await this.#collectionReader.readCollectionResult<GraphPermission>(permissionsPath, "native_grants");
      if (!permissionRead.completed) {
        this.#nativeAccessReadbackComplete = false;
      }
      const permissions = permissionRead.values;
      if (permissions.length === 0) {
        this.#pushWarning({
          code: "GRAPH_NATIVE_GRANT_COVERAGE_EMPTY",
          message: "Microsoft Graph returned no native permissions for a SharePoint or OneDrive resource; coverage is recorded without inventing canonical access.",
          severity: "info",
          scope: "native_grants",
          retryable: false,
          objectId: target.resource.id
        });
      }

      for (const permission of permissions) {
        this.#addPermissionNativeGrants(grantsByResource, permission, target, maps);
      }
    }

    return grantsByResource;
  }

  #addPermissionNativeGrants(
    grantsByResource: Map<string, NativeGrant[]>,
    permission: GraphPermission,
    target: MicrosoftPermissionGrantTarget,
    maps: EntraEntityMaps
  ): void {
    if (!permission.id) {
      this.#warnMissingId("native_grants");
      return;
    }

    const roles = (permission.roles ?? []).filter((role) => role.length > 0);
    if (roles.length === 0) {
      this.#pushWarning({
        code: "GRAPH_NATIVE_GRANT_ROLE_UNSUPPORTED",
        message: "Microsoft Graph returned a SharePoint or OneDrive permission without readable roles; the permission was retained as unsupported coverage.",
        severity: "warning",
        scope: "native_grants",
        retryable: false,
        objectId: target.resource.id
      });
      return;
    }

    if (permission.link || permission.invitation || permission.shareId || permission.hasPassword) {
      this.#pushWarning({
        code: "GRAPH_NATIVE_GRANT_LINK_SEMANTICS_UNSUPPORTED",
        message: "Microsoft Graph returned sharing-link or invitation permission semantics; Access Kit records unsupported grant coverage without converting them into relationship facts.",
        severity: "warning",
        scope: "native_grants",
        retryable: false,
        objectId: target.resource.id
      });
    }

    const identities = permissionIdentities(permission);
    if (identities.length === 0) {
      this.#pushWarning({
        code: "GRAPH_NATIVE_GRANT_PRINCIPAL_UNSUPPORTED",
        message: "Microsoft Graph returned a SharePoint or OneDrive permission without a supported principal identity; unsupported grant coverage is visible in evidence.",
        severity: "warning",
        scope: "native_grants",
        retryable: false,
        objectId: target.resource.id
      });
      return;
    }

    for (const identity of identities) {
      if (identity.kind === "siteUser") {
        this.#pushWarning({
          code: "GRAPH_NATIVE_GRANT_SITE_USER_UNSUPPORTED",
          message: "Microsoft Graph returned a SharePoint siteUser principal that cannot be safely linked to an imported Entra subject; the grant was skipped with coverage evidence.",
          severity: "warning",
          scope: "native_grants",
          retryable: false,
          objectId: target.resource.id
        });
        continue;
      }

      if (!identity.id) {
        this.#warnMissingId("native_grants");
        continue;
      }

      const subject = maps.subjectsByGraphId.get(identity.id);
      if (!subject) {
        this.#pushWarning({
          code: "GRAPH_NATIVE_GRANT_PRINCIPAL_SKIPPED",
          message: "Microsoft Graph returned a SharePoint or OneDrive permission for a principal outside the imported subject boundary; the grant was skipped with coverage evidence.",
          severity: "warning",
          scope: "native_grants",
          retryable: false,
          objectId: target.resource.id
        });
        continue;
      }

      const principalType = maps.subjectPrincipalTypes.get(identity.id) ?? permissionPrincipalType(identity.kind);
      for (const role of roles) {
        this.#addNativeGrant(grantsByResource, this.#resourceMapper.nativeGrant(
          `${target.kind}:${target.resource.id}:permission:${permission.id}:principal:${identity.kind}:${identity.id}:role:${role}`,
          target.resource,
          subject,
          principalType,
          `${nativePermissionPrefix(target)}:${safePermissionLabel(role)}`,
          permission.inheritedFrom ? "inherited" : nativeGrantTypeForPrincipal(principalType),
          "microsoft_graph_sharepoint_onedrive_permission",
          {
            permissionHash: redactValue(permission.id),
            principalHash: redactValue(identity.id),
            principalKind: identity.kind,
            resourceKind: target.kind,
            roles: roles.map((candidate) => safePermissionLabel(candidate)),
            inherited: Boolean(permission.inheritedFrom),
            inheritedFromDriveHash: permission.inheritedFrom?.driveId ? redactValue(permission.inheritedFrom.driveId) : undefined,
            inheritedFromItemHash: permission.inheritedFrom?.id ? redactValue(permission.inheritedFrom.id) : undefined,
            linkSemanticsUnsupported: Boolean(permission.link),
            invitationSemanticsUnsupported: Boolean(permission.invitation),
            passwordProtectedShareUnsupported: Boolean(permission.hasPassword),
            redacted: true
          },
          permission.inheritedFrom ? target.resource.parentId : undefined
        ));
      }
    }
  }

  #addNativeGrant(grantsByResource: Map<string, NativeGrant[]>, grant: NativeGrant): void {
    grantsByResource.set(grant.targetObjectId, [...(grantsByResource.get(grant.targetObjectId) ?? []), grant]);
  }

  #buildCursor(startedFrom: string): DiscoveryCursor {
    const deltaCursor = this.#collectionReader.buildDeltaCursor();
    return {
      startedFrom,
      next: deltaCursor,
      highWatermark: `cursor:microsoft-graph:${compactTimestamp(this.#now())}`,
      deletedObjectBehavior: "mark_deleted"
    };
  }

  #buildPreDiscoveryCursor(): DiscoveryCursor {
    return {
      startedFrom: "cursor:microsoft-graph:initial",
      highWatermark: "cursor:microsoft-graph:pre-discovery",
      deletedObjectBehavior: "mark_deleted"
    };
  }


  #baseWarnings(): DiscoveryRunWarning[] {
    const warnings: DiscoveryRunWarning[] = [
      {
        code: "GRAPH_CHANGE_NOTIFICATION_DELIVERY_UNSUPPORTED",
        message: "Microsoft Graph webhook change notifications are not configured; Access Kit relies on redacted delta cursors and treats notification delivery coverage as unsupported.",
        severity: "warning",
        scope: "connector",
        retryable: false
      },
      {
        code: "GRAPH_POWER_PLATFORM_DATAVERSE_ROLE_MAPPING_UNSUPPORTED",
        message: "Power Platform and Dataverse role mappings are outside the staged Microsoft Graph connector; provider-specific role coverage must remain an unsupported warning instead of becoming canonical access.",
        severity: "warning",
        scope: "native_grants",
        retryable: false
      }
    ];

    if (!this.#sandboxEvidenceRef) {
      warnings.unshift({
        code: "GRAPH_SANDBOX_EVIDENCE_REQUIRED",
        message: "No live sandbox evidence reference is configured; retain a sandbox run artifact before claiming live-tenant verification.",
        severity: "warning",
        scope: "connector",
        retryable: false
      });
    }

    return warnings;
  }

  #warnMissingId(scope: DiscoveryRunWarning["scope"]): void {
    this.#pushWarning({
      code: "GRAPH_OBJECT_MISSING_ID_SKIPPED",
      message: "Microsoft Graph returned an object without an id; the object was skipped.",
      severity: "warning",
      scope,
      retryable: false
    });
  }

  #recordInventoryInheritanceWarning(resource: Resource): void {
    this.#pushWarning({
      code: "GRAPH_SHAREPOINT_ONEDRIVE_INHERITANCE_AMBIGUOUS",
      message: "SharePoint and OneDrive inventory recorded inheritance markers only; explicit or broken permissions are deferred to native grant readback and no canonical access was granted from inventory.",
      severity: "warning",
      scope: "resources",
      retryable: false,
      objectId: resource.id
    });
  }

  #pushWarning(warning: DiscoveryRunWarning): void {
    const key = `${warning.code}:${warning.scope}:${warning.objectId ?? ""}:${warning.message}`;
    if (this.#warnings.some((existing) => `${existing.code}:${existing.scope}:${existing.objectId ?? ""}:${existing.message}` === key)) {
      return;
    }

    this.#warnings.push(warning);
  }
}

export function createMicrosoftGraphEntraReadOnlyConnectorFromEnv(
  env: MicrosoftGraphConnectorEnv = process.env
): MicrosoftGraphEntraReadOnlyConnector | undefined {
  const enabled = env.REBAC_MICROSOFT_GRAPH_ENTRA_ID_ENABLED === "true" || env.REBAC_MICROSOFT_GRAPH_ENTRA_ENABLED === "true";
  if (!enabled) {
    return undefined;
  }

  const tenantId = env.REBAC_MICROSOFT_GRAPH_TENANT_ID;
  const accessToken = env.REBAC_MICROSOFT_GRAPH_ACCESS_TOKEN ?? readTokenFile(env.REBAC_MICROSOFT_GRAPH_TOKEN_FILE);
  if (!tenantId || !accessToken) {
    return undefined;
  }

  return new MicrosoftGraphEntraReadOnlyConnector({
    tenantId,
    sandboxEvidenceRef: env.REBAC_MICROSOFT_GRAPH_SANDBOX_EVIDENCE,
    client: new FetchMicrosoftGraphClient({
      accessToken,
      baseUrl: env.REBAC_MICROSOFT_GRAPH_BASE_URL
    })
  });
}
