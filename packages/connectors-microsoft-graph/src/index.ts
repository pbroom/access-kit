import { existsSync, readFileSync } from "node:fs";
import {
  finalizeEvidenceExport,
  sha256,
  verifyAuditChain,
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
  type JsonRecord,
  type NativeGrant,
  type NativePrincipalType,
  type ProvisioningPlan,
  type RelationshipTuple,
  type Resource,
  type Subject
} from "@access-kit/core";

export const MICROSOFT_GRAPH_ENTRA_CONNECTOR_ID = "microsoft-graph-entra-readonly";
export const MICROSOFT_GRAPH_M365_TEAMS_REQUIRED_READ_SCOPES = [
  "TeamSettings.Read.Group"
] as const;
export const MICROSOFT_GRAPH_ENTRA_REQUIRED_READ_SCOPES = [
  "User.Read.All",
  "GroupMember.Read.All",
  "Application.Read.All",
  ...MICROSOFT_GRAPH_M365_TEAMS_REQUIRED_READ_SCOPES
] as const;
export const MICROSOFT_GRAPH_ENTRA_FORBIDDEN_WRITE_SCOPES = [
  "User.ReadWrite.All",
  "Group.ReadWrite.All",
  "GroupMember.ReadWrite.All",
  "Application.ReadWrite.All",
  "AppRoleAssignment.ReadWrite.All",
  "Directory.ReadWrite.All",
  "TeamSettings.ReadWrite.Group"
] as const;

const DEFAULT_BASE_URL = "https://graph.microsoft.com/v1.0";
const DEFAULT_MAX_PAGES = 100;
const DEFAULT_MAX_RETRIES = 2;
const REDACTION_HASH_LENGTH = 16;

export interface MicrosoftGraphCollectionPage<T> {
  value: T[];
  nextLink?: string;
  deltaLink?: string;
  status?: number;
  retryAfterSeconds?: number;
  requestId?: string;
}

export interface MicrosoftGraphRecordResponse<T> {
  value?: T;
  status?: number;
  retryAfterSeconds?: number;
  requestId?: string;
}

export interface MicrosoftGraphReadClient {
  list<T>(pathOrUrl: string, options?: { headers?: Record<string, string> }): Promise<MicrosoftGraphCollectionPage<T>>;
  get<T>(pathOrUrl: string, options?: { headers?: Record<string, string> }): Promise<MicrosoftGraphRecordResponse<T>>;
}

export interface FetchMicrosoftGraphClientOptions {
  accessToken?: string;
  tokenProvider?: () => Promise<string> | string;
  baseUrl?: string;
  fetch?: typeof fetch;
  allowedOrigins?: string[];
}

export class FetchMicrosoftGraphClient implements MicrosoftGraphReadClient {
  readonly #baseUrl: string;
  readonly #allowedOrigins: Set<string>;
  readonly #fetch: typeof fetch;
  readonly #tokenProvider: () => Promise<string> | string;

  constructor(options: FetchMicrosoftGraphClientOptions) {
    const tokenProvider = options.tokenProvider ?? (() => options.accessToken ?? "");
    this.#tokenProvider = tokenProvider;
    this.#baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.#allowedOrigins = new Set([new URL(this.#baseUrl).origin, ...(options.allowedOrigins ?? [])]);
    this.#fetch = options.fetch ?? fetch;
  }

  async list<T>(pathOrUrl: string, options: { headers?: Record<string, string> } = {}): Promise<MicrosoftGraphCollectionPage<T>> {
    const accessToken = await this.#tokenProvider();
    if (!accessToken) {
      return {
        value: [],
        status: 401
      };
    }

    const url = this.#toUrl(pathOrUrl);
    const response = await this.#fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...options.headers
      }
    });
    const body = await readResponseJson(response);
    const value = Array.isArray(body.value) ? body.value as T[] : [];

    return {
      value,
      nextLink: readString(body["@odata.nextLink"]),
      deltaLink: readString(body["@odata.deltaLink"]),
      status: response.status,
      retryAfterSeconds: readRetryAfter(response),
      requestId: response.headers.get("request-id") ?? response.headers.get("client-request-id") ?? undefined
    };
  }

  async get<T>(pathOrUrl: string, options: { headers?: Record<string, string> } = {}): Promise<MicrosoftGraphRecordResponse<T>> {
    const accessToken = await this.#tokenProvider();
    if (!accessToken) {
      return {
        status: 401
      };
    }

    const url = this.#toUrl(pathOrUrl);
    const response = await this.#fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...options.headers
      }
    });
    const body = await readResponseJson(response);

    return {
      value: isJsonRecord(body) ? body as T : undefined,
      status: response.status,
      retryAfterSeconds: readRetryAfter(response),
      requestId: response.headers.get("request-id") ?? response.headers.get("client-request-id") ?? undefined
    };
  }

  #toUrl(pathOrUrl: string): string {
    const url = /^https:\/\//i.test(pathOrUrl)
      ? new URL(pathOrUrl)
      : new URL(`${this.#baseUrl}${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`);

    if (!this.#allowedOrigins.has(url.origin)) {
      throw new Error(`Microsoft Graph pagination URL origin ${url.origin} is not in the approved Graph endpoint allowlist.`);
    }

    return url.toString();
  }
}

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
  sleep?: (milliseconds: number) => Promise<void>;
}

interface MicrosoftGraphConnectorEnv {
  REBAC_MICROSOFT_GRAPH_ENTRA_ID_ENABLED?: string;
  REBAC_MICROSOFT_GRAPH_ENTRA_ENABLED?: string;
  REBAC_MICROSOFT_GRAPH_TENANT_ID?: string;
  REBAC_MICROSOFT_GRAPH_ACCESS_TOKEN?: string;
  REBAC_MICROSOFT_GRAPH_TOKEN_FILE?: string;
  REBAC_MICROSOFT_GRAPH_BASE_URL?: string;
  REBAC_MICROSOFT_GRAPH_SANDBOX_EVIDENCE?: string;
}

interface GraphUser {
  id?: string;
  displayName?: string | null;
  userPrincipalName?: string | null;
  accountEnabled?: boolean | null;
  userType?: string | null;
  externalUserState?: string | null;
  deletedDateTime?: string | null;
}

interface GraphGroup {
  id?: string;
  displayName?: string | null;
  securityEnabled?: boolean | null;
  mailEnabled?: boolean | null;
  visibility?: string | null;
  groupTypes?: string[] | null;
  resourceProvisioningOptions?: string[] | null;
  deletedDateTime?: string | null;
}

interface GraphTeam {
  id?: string;
  displayName?: string | null;
  description?: string | null;
  webUrl?: string | null;
  isArchived?: boolean | null;
  visibility?: string | null;
}

interface GraphServicePrincipal {
  id?: string;
  displayName?: string | null;
  appId?: string | null;
  servicePrincipalType?: string | null;
  appRoles?: GraphAppRole[] | null;
  deletedDateTime?: string | null;
}

interface GraphAppRole {
  id?: string;
  displayName?: string | null;
  value?: string | null;
}

interface GraphDirectoryObject {
  id?: string;
  "@odata.type"?: string;
  displayName?: string | null;
  userPrincipalName?: string | null;
  appId?: string | null;
  servicePrincipalType?: string | null;
}

interface GraphAppRoleAssignment {
  id?: string;
  principalId?: string;
  principalType?: string | null;
  principalDisplayName?: string | null;
  resourceId?: string;
  resourceDisplayName?: string | null;
  appRoleId?: string | null;
  createdDateTime?: string | null;
}

interface EntraSnapshot {
  subjects: Subject[];
  resources: Resource[];
  relationships: RelationshipTuple[];
  grantsByResource: Map<string, NativeGrant[]>;
  cursor: DiscoveryCursor;
}

interface EntraEntityMaps {
  subjectsByGraphId: Map<string, Subject>;
  subjectPrincipalTypes: Map<string, NativePrincipalType>;
  applicationResourcesByGraphId: Map<string, Resource>;
  m365GroupResourcesByGraphId: Map<string, Resource>;
  teamResourcesByGroupId: Map<string, Resource>;
  appRolesByServicePrincipalId: Map<string, Map<string, GraphAppRole>>;
}

interface RelationshipCoverage {
  relationships: RelationshipTuple[];
  grantsByResource: Map<string, NativeGrant[]>;
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
  readonly #sleep: (milliseconds: number) => Promise<void>;
  #snapshot?: EntraSnapshot;
  #warnings: DiscoveryRunWarning[] = [];

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
    this.#sleep = options.sleep ?? sleep;
  }

  async discoverSubjects(): Promise<Subject[]> {
    this.#snapshot = undefined;
    this.#warnings = [];
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
          "User, group membership and ownership, application, and scoped Teams settings read permissions are sufficient for redacted Entra, Microsoft 365 group, Teams coupling, service-principal, and app-role assignment readback without provider writes."
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
    return createDryRunPlan(request, this.id, request.resourceId, this.#now());
  }

  async applyProvisioningChange(plan: ProvisioningPlan): Promise<ProvisioningPlan> {
    return {
      ...plan,
      status: "failed",
      actions: plan.actions.map((action) => ({ ...action, status: "failed" }))
    };
  }

  async verifyProvisioningChange(plan: ProvisioningPlan): Promise<boolean> {
    void plan;
    return false;
  }

  async revokeAccess(nativeGrantId: string): Promise<ProvisioningPlan> {
    return createRevocationPlan(this.id, nativeGrantId, "resource:unknown", this.#now());
  }

  async detectDrift(): Promise<DriftFinding[]> {
    return [];
  }

  async emitEvidence(events: AuditEvent[]): Promise<EvidenceExport> {
    return createEvidence(this.id, events, this.#now());
  }

  async #loadSnapshot(): Promise<EntraSnapshot> {
    if (this.#snapshot) {
      return this.#snapshot;
    }

    this.#warnings = [];
    const users = await this.#readCollection<GraphUser>(
      "/users?$select=id,displayName,userPrincipalName,accountEnabled,userType,externalUserState,deletedDateTime",
      "subjects"
    );
    const groups = await this.#readCollection<GraphGroup>(
      "/groups?$select=id,displayName,securityEnabled,mailEnabled,visibility,groupTypes,resourceProvisioningOptions,deletedDateTime",
      "subjects"
    );
    const servicePrincipals = await this.#readCollection<GraphServicePrincipal>(
      "/servicePrincipals?$select=id,displayName,appId,servicePrincipalType,appRoles,deletedDateTime",
      "resources"
    );
    const maps = this.#buildEntityMaps(users, groups, servicePrincipals);
    const relationshipCoverage = await this.#buildRelationships(groups, maps);
    const grantsByResource = await this.#buildNativeGrants(servicePrincipals, maps);
    for (const [resourceId, grants] of relationshipCoverage.grantsByResource.entries()) {
      grantsByResource.set(resourceId, [...(grantsByResource.get(resourceId) ?? []), ...grants]);
    }
    const cursor = this.#buildCursor();

    this.#snapshot = {
      subjects: [...maps.subjectsByGraphId.values()],
      resources: [
        ...maps.applicationResourcesByGraphId.values(),
        ...maps.m365GroupResourcesByGraphId.values(),
        ...maps.teamResourcesByGroupId.values()
      ],
      relationships: relationshipCoverage.relationships,
      grantsByResource,
      cursor
    };

    return this.#snapshot;
  }

  async #readCollection<T>(path: string, label: DiscoveryRunWarning["scope"]): Promise<T[]> {
    const values: T[] = [];
    let nextPath: string | undefined = path;
    let pageCount = 0;
    let retryCount = 0;

    while (nextPath) {
      if (pageCount >= this.#maxPages) {
        this.#pushWarning({
          code: "GRAPH_PAGE_LIMIT_REACHED",
          message: `Microsoft Graph ${label} pagination reached the configured page limit; remaining pages were skipped.`,
          severity: "warning",
          scope: label,
          retryable: true
        });
        break;
      }

      const page: MicrosoftGraphCollectionPage<T> = await this.#client.list<T>(nextPath, { headers: { ConsistencyLevel: "eventual" } });
      const status = page.status ?? 200;

      if (status === 429) {
        retryCount += 1;
        this.#pushWarning({
          code: "GRAPH_THROTTLE_RETRIED",
          message: "Microsoft Graph throttled readback; retry metadata was captured without retaining raw request identifiers.",
          severity: retryCount > this.#maxRetries ? "warning" : "info",
          scope: label,
          retryable: retryCount <= this.#maxRetries
        });

        if (retryCount <= this.#maxRetries) {
          const retryAfterMilliseconds = retryAfterSecondsToMilliseconds(page.retryAfterSeconds);
          if (retryAfterMilliseconds > 0) {
            await this.#sleep(retryAfterMilliseconds);
          }
          continue;
        }

        break;
      }

      if (status >= 400) {
        this.#pushWarning({
          code: "GRAPH_COLLECTION_SKIPPED",
          message: `Microsoft Graph ${label} readback returned HTTP ${status}; unsupported provider behavior was skipped instead of becoming canonical facts.`,
          severity: "warning",
          scope: label,
          retryable: status >= 500
        });
        break;
      }

      retryCount = 0;
      pageCount += 1;
      values.push(...page.value);

      if (page.nextLink) {
        this.#pushWarning({
          code: "GRAPH_PAGINATION_OBSERVED",
          message: `Microsoft Graph ${label} readback used paginated responses; raw nextLink values were redacted from evidence.`,
          severity: "info",
          scope: label,
          retryable: false
        });
      }

      nextPath = page.nextLink;
    }

    return values;
  }

  async #readRecord<T>(
    path: string,
    label: DiscoveryRunWarning["scope"],
    skipped: Pick<DiscoveryRunWarning, "code" | "message">
  ): Promise<T | undefined> {
    let retryCount = 0;

    while (true) {
      const record = await this.#client.get<T>(path, { headers: { ConsistencyLevel: "eventual" } });
      const status = record.status ?? 200;

      if (status === 429) {
        retryCount += 1;
        this.#pushWarning({
          code: "GRAPH_THROTTLE_RETRIED",
          message: "Microsoft Graph throttled readback; retry metadata was captured without retaining raw request identifiers.",
          severity: retryCount > this.#maxRetries ? "warning" : "info",
          scope: label,
          retryable: retryCount <= this.#maxRetries
        });

        if (retryCount <= this.#maxRetries) {
          const retryAfterMilliseconds = retryAfterSecondsToMilliseconds(record.retryAfterSeconds);
          if (retryAfterMilliseconds > 0) {
            await this.#sleep(retryAfterMilliseconds);
          }
          continue;
        }

        return undefined;
      }

      if (status >= 400) {
        this.#pushWarning({
          code: skipped.code,
          message: skipped.message,
          severity: "warning",
          scope: label,
          retryable: status >= 500
        });
        return undefined;
      }

      return record.value;
    }
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

      const subject = this.#subject(user.id, "user", `Entra user ${redactValue(user.id)}`, {
        graphObjectHash: redactValue(user.id),
        graphType: "user"
      }, {
        tenantId: this.tenantBoundary,
        accountEnabled: user.accountEnabled ?? undefined,
        external: user.userType === "Guest" || Boolean(user.externalUserState),
        redacted: true
      }, user.deletedDateTime ? "deleted" : "active");
      subjectsByGraphId.set(user.id, subject);
      subjectPrincipalTypes.set(user.id, user.userType === "Guest" ? "external_user" : "user");
    }

    for (const group of groups) {
      if (!group.id) {
        this.#warnMissingId("subjects");
        continue;
      }

      subjectsByGraphId.set(group.id, this.#subject(group.id, "group", `Entra group ${redactValue(group.id)}`, {
        graphObjectHash: redactValue(group.id),
        graphType: "group"
      }, {
        tenantId: this.tenantBoundary,
        securityEnabled: group.securityEnabled ?? undefined,
        redacted: true
      }, group.deletedDateTime ? "deleted" : "active"));
      subjectPrincipalTypes.set(group.id, "group");

      if (isM365Group(group)) {
        m365GroupResourcesByGraphId.set(group.id, this.#m365GroupResource(group));
      }
    }

    for (const servicePrincipal of servicePrincipals) {
      if (!servicePrincipal.id) {
        this.#warnMissingId("subjects");
        continue;
      }

      const subject = this.#subject(
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
          redacted: true
        },
        servicePrincipal.deletedDateTime ? "deleted" : "active"
      );
      subjectsByGraphId.set(servicePrincipal.id, subject);
      subjectPrincipalTypes.set(servicePrincipal.id, "service_principal");
      applicationResourcesByGraphId.set(servicePrincipal.id, this.#applicationResource(servicePrincipal));
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
        relationships.push(this.#relationship(
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
          teamResource = this.#teamResource(group, team, m365GroupResource.id);
          maps.teamResourcesByGroupId.set(group.id, teamResource);
          relationships.push(this.#relationship(
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
        } else {
          this.#pushWarning({
            code: "GRAPH_M365_GROUP_WITHOUT_TEAM",
            message: "Microsoft Graph returned a Microsoft 365 group without a Teams backing marker; Teams membership semantics were not inferred for that group.",
            severity: "info",
            scope: "resources",
            retryable: false
          });
        }
      }

      const members = await this.#readCollection<GraphDirectoryObject>(
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
        relationships.push(this.#relationship(
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
          relationships.push(this.#relationship(
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
          this.#addNativeGrant(grantsByResource, this.#nativeGrant(
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
          relationships.push(this.#relationship(
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
          this.#addNativeGrant(grantsByResource, this.#nativeGrant(
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
        relationships.push(this.#relationship(`sp:${graphId}:application`, subject.id, "represents", resource.id));
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
    const owners = await this.#readCollection<GraphDirectoryObject>(
      `/groups/${encodeURIComponent(group.id!)}/owners?$select=id,displayName,userPrincipalName,appId,servicePrincipalType`,
      "relationships"
    );
    this.#pushWarning({
      code: "GRAPH_GROUP_OWNER_SERVICE_PRINCIPAL_VISIBILITY_LIMITED",
      message: "Microsoft Graph group-owner readback can omit service-principal owners in some tenants or rollout states; ownership evidence should treat missing service principals as coverage-limited.",
      severity: "info",
      scope: "relationships",
      retryable: false
    });

    if (owners.length === 0) {
      this.#pushWarning({
        code: "GRAPH_M365_GROUP_OWNER_COVERAGE_EMPTY",
        message: "Microsoft Graph returned no owners for a Microsoft 365 group; ownership coverage was retained as a warning instead of inventing canonical owners.",
        severity: "warning",
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
      relationships.push(this.#relationship(
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
      this.#addNativeGrant(grantsByResource, this.#nativeGrant(
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
        relationships.push(this.#relationship(
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
        this.#addNativeGrant(grantsByResource, this.#nativeGrant(
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
    return this.#readRecord<GraphTeam>(
      `/teams/${encodeURIComponent(group.id!)}?$select=id,displayName,description,webUrl,isArchived,visibility`,
      "resources",
      {
        code: "GRAPH_TEAM_COUPLING_SKIPPED",
        message: "Microsoft Graph reported a Teams-backed group but the team record could not be read; the group marker was retained with coverage warning."
      }
    );
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

      const assignments = await this.#readCollection<GraphAppRoleAssignment>(
        `/servicePrincipals/${encodeURIComponent(servicePrincipal.id)}/appRoleAssignedTo?$select=id,principalId,principalType,principalDisplayName,resourceId,resourceDisplayName,appRoleId,createdDateTime`,
        "native_grants"
      );
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

  #addNativeGrant(grantsByResource: Map<string, NativeGrant[]>, grant: NativeGrant): void {
    grantsByResource.set(grant.targetObjectId, [...(grantsByResource.get(grant.targetObjectId) ?? []), grant]);
  }

  #buildCursor(): DiscoveryCursor {
    return {
      startedFrom: "cursor:microsoft-graph:initial",
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

  #subject(
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
      sourceSystem: this.id,
      lifecycleState,
      identifiers,
      attributes,
      version: "subject:v1",
      createdAt: this.#now(),
      lastSeenAt: this.#now()
    };
  }

  #applicationResource(servicePrincipal: GraphServicePrincipal): Resource {
    const graphId = servicePrincipal.id ?? "unknown";
    return {
      id: `application:entra:${redactValue(graphId)}`,
      type: "application",
      displayName: `Entra application ${redactValue(graphId)}`,
      sourceSystem: this.id,
      ownerId: "user:access-kit-owner",
      dataStewardId: "user:access-kit-steward",
      technicalOwnerId: "user:access-kit-operator",
      classification: "internal",
      lifecycleState: servicePrincipal.deletedDateTime ? "deleted" : "active",
      attributes: {
        tenantId: this.tenantBoundary,
        graphObjectHash: redactValue(graphId),
        appIdHash: servicePrincipal.appId ? redactValue(servicePrincipal.appId) : "unknown",
        servicePrincipalType: servicePrincipal.servicePrincipalType ?? undefined,
        redacted: true
      },
      version: "resource:v1",
      createdAt: this.#now(),
      lastSeenAt: this.#now()
    };
  }

  #m365GroupResource(group: GraphGroup): Resource {
    const graphId = group.id ?? "unknown";
    return {
      id: `workspace:m365-group:${redactValue(graphId)}`,
      type: "workspace",
      displayName: `Microsoft 365 group ${redactValue(graphId)}`,
      sourceSystem: this.id,
      ownerId: "user:access-kit-owner",
      dataStewardId: "user:access-kit-steward",
      technicalOwnerId: "user:access-kit-operator",
      classification: group.visibility === "Private" ? "confidential" : "internal",
      lifecycleState: group.deletedDateTime ? "deleted" : "active",
      attributes: {
        tenantId: this.tenantBoundary,
        graphObjectHash: redactValue(graphId),
        graphType: "microsoft365Group",
        securityEnabled: group.securityEnabled ?? undefined,
        mailEnabled: group.mailEnabled ?? undefined,
        visibility: group.visibility ?? undefined,
        teamBacked: isTeamsBackedGroup(group),
        redacted: true
      },
      version: "resource:v1",
      createdAt: this.#now(),
      lastSeenAt: this.#now()
    };
  }

  #teamResource(group: GraphGroup, team: GraphTeam | undefined, parentId: string): Resource {
    const graphId = team?.id ?? group.id ?? "unknown";
    return {
      id: `team:microsoft-graph:${redactValue(graphId)}`,
      type: "team",
      displayName: `Microsoft Teams team ${redactValue(graphId)}`,
      sourceSystem: this.id,
      ownerId: "user:access-kit-owner",
      dataStewardId: "user:access-kit-steward",
      technicalOwnerId: "user:access-kit-operator",
      classification: (team?.visibility ?? group.visibility) === "Private" ? "confidential" : "internal",
      lifecycleState: group.deletedDateTime ? "deleted" : "active",
      parentId,
      attributes: {
        tenantId: this.tenantBoundary,
        graphObjectHash: redactValue(graphId),
        backingGroupHash: redactValue(group.id ?? "unknown"),
        graphType: "team",
        archived: team?.isArchived ?? undefined,
        visibility: team?.visibility ?? group.visibility ?? undefined,
        couplingSource: team ? "microsoft_graph_team" : "microsoft_graph_group_marker",
        redacted: true
      },
      version: "resource:v1",
      createdAt: this.#now(),
      lastSeenAt: this.#now()
    };
  }

  #nativeGrant(
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
      id: `native-grant:${this.id}:${redactValue(idSeed)}`,
      targetPlatform: this.id,
      targetObjectId: resource.id,
      subjectId: subject.id,
      principalType,
      nativePermission,
      grantType,
      sourceConnectorId: this.id,
      status: "observed",
      observedAt: this.#now(),
      inheritedFromObjectId,
      attributes: {
        tenantId: this.tenantBoundary,
        source,
        ...attributes
      },
      version: "native-grant:v1",
      createdAt: this.#now()
    };
  }

  #relationship(
    idSeed: string,
    subjectId: string,
    relation: string,
    objectId: string,
    attributes: JsonRecord = {}
  ): RelationshipTuple {
    return {
      id: `relationship:${this.id}:${redactValue(idSeed)}`,
      subjectId,
      relation,
      objectId,
      sourceSystem: this.id,
      assertedAt: this.#now(),
      status: "active",
      attributes: {
        tenantId: this.tenantBoundary,
        ...attributes,
        redacted: true
      },
      version: "tuple:v1",
      createdAt: this.#now()
    };
  }

  #baseWarnings(): DiscoveryRunWarning[] {
    return this.#sandboxEvidenceRef
      ? []
      : [
          {
            code: "GRAPH_SANDBOX_EVIDENCE_REQUIRED",
            message: "No live sandbox evidence reference is configured; retain a sandbox run artifact before claiming live-tenant verification.",
            severity: "warning",
            scope: "connector",
            retryable: false
          }
        ];
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

  #pushWarning(warning: DiscoveryRunWarning): void {
    const key = `${warning.code}:${warning.scope}:${warning.message}`;
    if (this.#warnings.some((existing) => `${existing.code}:${existing.scope}:${existing.message}` === key)) {
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

function createTenantBoundary(tenantId: string): string {
  return `microsoft-graph:tenant:${redactValue(tenantId, 20)}`;
}

function redactValue(value: string, length = REDACTION_HASH_LENGTH): string {
  return sha256({ value }).slice(0, length);
}

function subjectPrefix(type: Subject["type"]): string {
  return type === "service_principal" ? "service-principal" : type;
}

function isM365Group(group: GraphGroup): boolean {
  return (group.groupTypes ?? []).includes("Unified");
}

function isTeamsBackedGroup(group: GraphGroup): boolean {
  return (group.resourceProvisioningOptions ?? []).some((option) => option.toLowerCase() === "team");
}

function nativeGrantTypeForPrincipal(principalType: NativePrincipalType): NativeGrant["grantType"] {
  return principalType === "group" ? "group" : "direct";
}

function mapAppRoles(appRoles: GraphAppRole[]): Map<string, GraphAppRole> {
  return new Map(appRoles.flatMap((role) => role.id ? [[role.id, role] as const] : []));
}

function appRolePermission(assignment: GraphAppRoleAssignment, appRoles: Map<string, GraphAppRole>): string {
  const appRoleId = assignment.appRoleId ?? "";
  const role = appRoles.get(appRoleId);
  const label = role?.value ?? role?.displayName;
  return label ? `appRole:${safePermissionLabel(label)}` : `appRole:${redactValue(appRoleId || assignment.id || "unknown")}`;
}

function safePermissionLabel(value: string): string {
  return value.replaceAll(/[^a-z0-9_.:-]+/gi, "-").replaceAll(/^-|-$/g, "") || "unknown";
}

function compactTimestamp(value: string): string {
  return value.replaceAll(/[^0-9a-z]/gi, "").toLowerCase();
}

async function readResponseJson(response: Response): Promise<JsonRecord> {
  try {
    const body: unknown = await response.json();
    return isJsonRecord(body) ? body : {};
  } catch {
    return {};
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readRetryAfter(response: Response): number | undefined {
  const retryAfterHeader = response.headers.get("retry-after");
  if (!retryAfterHeader) {
    return undefined;
  }

  const retryAfter = Number(retryAfterHeader);
  return Number.isFinite(retryAfter) ? retryAfter : undefined;
}

const MAX_RETRY_AFTER_MILLISECONDS = 60_000;

function retryAfterSecondsToMilliseconds(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.min(Math.ceil(value * 1000), MAX_RETRY_AFTER_MILLISECONDS)
    : 0;
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTokenFile(path: string | undefined): string | undefined {
  if (!path || !existsSync(path)) {
    return undefined;
  }

  const value = readFileSync(path, "utf8").trim();
  return value.length > 0 ? value : undefined;
}

function createDryRunPlan(request: DecisionResult, connectorId: string, targetObjectId: string, now: string): ProvisioningPlan {
  return {
    id: `plan:${connectorId}:${request.decisionId}`,
    sourceDecisionId: request.decisionId,
    connectorId,
    subjectId: request.subjectId,
    resourceId: request.resourceId,
    action: request.action,
    mode: "dry_run",
    status: "planned",
    actions: [
      {
        actionId: `action:${connectorId}:${request.decisionId}`,
        operation: request.decision === "allow" ? "grant" : "revoke",
        targetPlatform: connectorId,
        targetObjectId,
        requestedState: { subjectId: request.subjectId, permission: request.action },
        dryRun: true,
        idempotencyKey: `${connectorId}:${request.subjectId}:${request.action}:${request.resourceId}:${request.policyVersion}`,
        status: "planned",
        verification: {
          status: "pending",
          method: "connector.current_access_readback",
          expectedState: { subjectId: request.subjectId, permission: request.action }
        },
        compensation: {
          operation: request.decision === "allow" ? "revoke" : "grant",
          reason: "Reverse provider state if later enforcement does not verify cleanly.",
          status: "planned",
          idempotencyKey: `compensate:${connectorId}:${request.subjectId}:${request.action}:${request.resourceId}:${request.policyVersion}`
        }
      }
    ],
    version: "plan:v1",
    createdAt: now
  };
}

function createRevocationPlan(connectorId: string, nativeGrantId: string, resourceId: string, now: string): ProvisioningPlan {
  return {
    id: `plan:revoke:${connectorId}:${nativeGrantId}`,
    connectorId,
    subjectId: "subject:unknown",
    resourceId,
    action: "revoke",
    mode: "dry_run",
    status: "planned",
    actions: [
      {
        actionId: `action:revoke:${connectorId}:${nativeGrantId}`,
        operation: "revoke",
        targetPlatform: connectorId,
        targetObjectId: resourceId,
        requestedState: { nativeGrantId, status: "revoked" },
        dryRun: true,
        idempotencyKey: `revoke:${connectorId}:${nativeGrantId}`,
        status: "planned",
        verification: {
          status: "pending",
          method: "connector.current_access_readback",
          expectedState: { nativeGrantId, status: "revoked" }
        },
        compensation: {
          operation: "grant",
          reason: "Restore previous native grant if revocation verification fails after enforcement is enabled.",
          status: "planned",
          idempotencyKey: `compensate:${connectorId}:${nativeGrantId}`
        }
      }
    ],
    version: "plan:v1",
    createdAt: now
  };
}

function createEvidence(connectorId: string, events: AuditEvent[], now: string): EvidenceExport {
  const auditIntegrity = verifyAuditChain(events, now);
  const evidencePeriod = deriveEvidencePeriod(events, now);
  return finalizeEvidenceExport({
    exportId: `evidence:${connectorId}`,
    framework: "nist-800-53",
    controls: ["AC-2", "AC-3", "AU-2"],
    periodStart: evidencePeriod.periodStart,
    periodEnd: evidencePeriod.periodEnd,
    generatedAt: now,
    evidenceTypes: ["audit_events", "discovery_runs", "native_grants", "audit_integrity", "control_mappings"],
    sourceEventIds: events.map((event) => event.eventId),
    responsibleRole: "ISSO",
    format: "json",
    auditIntegrity,
    controlMappings: [
      {
        controlId: "AU-2",
        family: "AU",
        status: events.length > 0 ? "implemented" : "partially_implemented",
        implementationSummary: "Microsoft Graph connector evidence includes redacted audit event identifiers emitted by the local control plane.",
        evidenceTypes: ["audit_events"],
        sourceEventIds: events.map((event) => event.eventId),
        gaps: events.length > 0 ? [] : ["No source audit events were provided to the connector evidence hook."]
      }
    ],
    artifacts: [
      {
        name: "microsoft-graph-connector-audit-events",
        type: "audit_events",
        description: "Redacted Microsoft Graph connector audit events prepared for evidence packaging.",
        eventCount: events.length,
        format: "json"
      }
    ],
    conmonMetrics: [
      {
        name: "microsoft_graph_connector_evidence_events",
        value: events.length,
        unit: "count",
        source: connectorId
      }
    ],
    poamItems: [],
    siemExport: {
      format: "jsonl",
      eventCount: events.length,
      schemaVersion: "audit-event:v1",
      includesPayloadHashes: true,
      target: "operator_download"
    },
    systemBoundary: {
      boundaryId: `boundary:${connectorId}`,
      name: `${connectorId} connector evidence boundary`,
      description: "Microsoft Graph Entra read-only connector boundary with redacted sandbox-tenant evidence.",
      environment: "local_proof_point",
      liveTenantData: true,
      components: [
        {
          id: `component:connector:${connectorId}`,
          name: `${connectorId} connector`,
          type: "connector",
          trustZone: "future_production",
          dataClassification: "redacted directory metadata",
          description: "Read-only Microsoft Graph adapter for Entra users, groups, service principals, and app-role assignments."
        }
      ],
      externalSystems: ["microsoft-graph"],
      assumptions: ["Connector evidence redacts tenant identifiers, object identifiers, emails, names, request identifiers, tokens, and cursors."],
      version: "system-boundary:v1"
    },
    dataFlows: [
      {
        id: `data-flow:${connectorId}:evidence`,
        name: `${connectorId} connector evidence emission`,
        source: `component:connector:${connectorId}`,
        destination: "component:api-runtime",
        dataTypes: ["redacted_directory_inventory", "redacted_app_role_assignments", "connector_audit_events"],
        protections: ["read_only_scopes", "redacted_identifiers", "no_provider_writes"],
        liveTenantData: true
      }
    ],
    controlStatements: [
      {
        controlId: "AU-2",
        status: events.length > 0 ? "implemented" : "partially_implemented",
        statement: "Microsoft Graph connector evidence includes redacted audit event identifiers emitted by the local control plane.",
        responsibleRole: "ISSO",
        reviewerRole: "Security Control Assessor",
        reviewedAt: now,
        evidenceTypes: ["audit_events"],
        sourceArtifactNames: ["microsoft-graph-connector-audit-events"],
        gaps: events.length > 0 ? [] : ["No source audit events were provided to the connector evidence hook."]
      }
    ],
    accessReviews: [],
    exceptionRegister: [],
    operationalEvidence: [
      {
        id: `operational:${connectorId}:connector-boundary`,
        type: "configuration_baseline",
        status: "implemented",
        ownerRole: "Connector Owner",
        generatedAt: now,
        summary: "Microsoft Graph Entra read-only connector configuration is represented with redacted local proof-point evidence.",
        evidenceRefs: ["packages/connectors-microsoft-graph/src/index.ts", "docs/connector-contract.md"],
        gaps: ["Retain live sandbox run evidence before claiming environment-specific tenant verification."]
      }
    ]
  });
}

function deriveEvidencePeriod(events: AuditEvent[], now: string): Pick<EvidenceExport, "periodStart" | "periodEnd"> {
  const occurredAt = events.map((event) => event.occurredAt).sort();

  return {
    periodStart: occurredAt.at(0) ?? now,
    periodEnd: occurredAt.at(-1) ?? now
  };
}
