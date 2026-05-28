import { existsSync, readFileSync } from "node:fs";
import {
  createReadOnlyConnectorEvidenceExport,
  createReadOnlyDryRunPlan,
  createReadOnlyNoWriteApplyFailure,
  createReadOnlyRevocationPlan,
  readOnlyConnectorSourceEventIds,
  sha256,
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

export const AWS_READONLY_ACCESS_ANALYSIS_CONNECTOR_ID = "aws-readonly-access-analysis";
export const AWS_READONLY_ACCESS_ANALYSIS_REQUIRED_READ_SCOPES = [
  "organizations:DescribeOrganization",
  "organizations:ListAccounts",
  "sso:ListPermissionSets",
  "sso:DescribePermissionSet",
  "sso:ListAccountAssignments",
  "iam:ListRoles",
  "cloudtrail:LookupEvents",
  "access-analyzer:ListFindings"
] as const;
export const AWS_READONLY_ACCESS_ANALYSIS_FORBIDDEN_WRITE_SCOPES = [
  "organizations:Write",
  "sso:Write",
  "identitystore:Write",
  "iam:Write",
  "cloudtrail:Write",
  "access-analyzer:Write"
] as const;

const DEFAULT_MAX_PAGES = 100;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_EVENTBRIDGE_LATENCY_WINDOW_MINUTES = 5;
const DEFAULT_CLOUDTRAIL_STALE_ACTIVITY_WINDOW_MINUTES = 60;
const DEFAULT_ACCESS_ANALYZER_STALE_FINDING_WINDOW_MINUTES = 60;
const REDACTION_HASH_LENGTH = 16;
const MILLISECONDS_PER_MINUTE = 60_000;

export type AwsReadOperation =
  | "organizations.describeOrganization"
  | "organizations.listAccounts"
  | "ssoAdmin.listPermissionSets"
  | "ssoAdmin.describePermissionSet"
  | "ssoAdmin.listAccountAssignments"
  | "iam.listRoles"
  | "cloudTrail.lookupEvents"
  | "accessAnalyzer.listFindings";

export interface AwsReadCollectionPage<T> {
  value: T[];
  nextToken?: string;
  status?: number;
  retryAfterSeconds?: number;
  requestId?: string;
}

export interface AwsReadClient {
  list<T>(operation: AwsReadOperation, input?: JsonRecord): Promise<AwsReadCollectionPage<T>>;
}

interface AwsCollectionRead<T> {
  values: T[];
  completed: boolean;
}

export type AwsReadClientPages = Record<string, Array<AwsReadCollectionPage<unknown>>>;

export class JsonAwsReadClient implements AwsReadClient {
  readonly calls: Array<{ operation: AwsReadOperation; input?: JsonRecord }> = [];
  readonly #pages: Map<string, Array<AwsReadCollectionPage<unknown>>>;

  constructor(pages: AwsReadClientPages | { pages: AwsReadClientPages }) {
    const source = "pages" in pages ? pages.pages : pages;
    this.#pages = new Map(Object.entries(source).map(([key, value]) => [key, [...value]]));
  }

  async list<T>(operation: AwsReadOperation, input: JsonRecord = {}): Promise<AwsReadCollectionPage<T>> {
    this.calls.push({ operation, input });
    const directKey = awsReadClientKey(operation, input);
    const pages = this.#pages.get(directKey) ?? this.#pages.get(operation);

    if (!pages || pages.length === 0) {
      throw new Error(`No AWS read fixture page for ${directKey}`);
    }

    return pages.shift() as AwsReadCollectionPage<T>;
  }
}

export interface AwsReadOnlyAccessAnalysisConnectorOptions {
  id?: string;
  client: AwsReadClient;
  organizationId: string;
  tenantBoundary?: string;
  now?: () => string;
  sandboxEvidenceRef?: string;
  credentialHandling?: "managed_identity" | "vault_required";
  maxPages?: number;
  maxRetries?: number;
  eventBridgeLatencyWindowMinutes?: number;
  cloudTrailStaleActivityWindowMinutes?: number;
  accessAnalyzerStaleFindingWindowMinutes?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

interface AwsConnectorEnv {
  REBAC_AWS_READONLY_ACCESS_ANALYSIS_ENABLED?: string;
  REBAC_AWS_READONLY_ENABLED?: string;
  REBAC_AWS_ORGANIZATION_ID?: string;
  REBAC_AWS_READONLY_FIXTURE_FILE?: string;
  REBAC_AWS_SANDBOX_EVIDENCE?: string;
}

interface AwsOrganization {
  id?: string;
  arn?: string;
  masterAccountId?: string;
  managementAccountId?: string;
  featureSet?: string;
}

interface AwsAccount {
  id?: string;
  arn?: string;
  name?: string;
  email?: string;
  status?: string;
  joinedTimestamp?: string;
  deletedDateTime?: string;
}

interface AwsPermissionSet {
  arn?: string;
  name?: string;
  description?: string;
  sessionDuration?: string;
  relayState?: string;
  createdDate?: string;
  deletedDateTime?: string;
}

interface AwsAccountAssignment {
  accountId?: string;
  permissionSetArn?: string;
  principalId?: string;
  principalType?: string;
  createdDate?: string;
  deletedDateTime?: string;
  status?: string;
}

interface AwsRole {
  arn?: string;
  roleName?: string;
  roleId?: string;
  accountId?: string;
  path?: string;
  maxSessionDuration?: number;
  createDate?: string;
  deletedDateTime?: string;
}

interface AwsCloudTrailResource {
  resourceName?: string;
  resourceType?: string;
}

interface AwsCloudTrailEvent {
  eventId?: string;
  eventTime?: string;
  eventName?: string;
  username?: string;
  recipientAccountId?: string;
  readOnly?: boolean | string;
  resources?: AwsCloudTrailResource[];
  errorCode?: string;
  eventBridgeDeliveredAt?: string;
  eventBridgeAttemptCount?: number;
  eventBridgeRetryState?: string;
}

interface AwsAccessAnalyzerFinding {
  id?: string;
  analyzerArn?: string;
  resource?: string;
  resourceType?: string;
  principal?: string | Record<string, string>;
  action?: string[];
  status?: string;
  findingType?: string;
  isPublic?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

interface AwsSnapshot {
  subjects: Subject[];
  resources: Resource[];
  relationships: RelationshipTuple[];
  grantsByResource: Map<string, NativeGrant[]>;
  findings: DriftFinding[];
  cursor: DiscoveryCursor;
  latencyModel: AwsLatencyModel;
}

interface AwsEntityMaps {
  organizationResource: Resource;
  accountsById: Map<string, Resource>;
  permissionSetsByArn: Map<string, Resource>;
  permissionSetMetadataByArn: Map<string, AwsPermissionSet>;
  rolesByArn: Map<string, Resource>;
  subjectsByPrincipalKey: Map<string, Subject>;
  principalTypesBySubjectId: Map<string, NativePrincipalType>;
  resourcesByRawKey: Map<string, Resource>;
  latestActivityByRawKey: Map<string, AwsActivity>;
  latencyModel: AwsLatencyModel;
}

type AwsReconciliationConfidenceLevel = "high" | "medium" | "low";

interface AwsLatencyWindows {
  eventBridgeLatencyWindowMinutes: number;
  cloudTrailStaleActivityWindowMinutes: number;
  accessAnalyzerStaleFindingWindowMinutes: number;
}

interface AwsActivityIndex {
  activityByRawKey: Map<string, AwsActivity>;
  latencyModel: AwsLatencyModel;
}

interface AwsLatencyModel {
  windows: AwsLatencyWindows;
  observedAt: string;
  eventBridge: {
    observed: boolean;
    maxLatencyMinutes?: number;
    retryObserved: boolean;
    latencyWindowExceeded: boolean;
    partialOrderingObserved: boolean;
    redacted: true;
  };
  cloudTrail: {
    latestEventAt?: string;
    maxActivityAgeMinutes?: number;
    staleActivityObserved: boolean;
    redacted: true;
  };
}

interface AwsActivity {
  eventHash: string;
  eventName: string;
  eventTime: string;
  readOnly: boolean;
  cloudTrailActivityAgeMinutes?: number;
  eventBridgeDeliveredAt?: string;
  eventBridgeLatencyMinutes?: number;
  eventBridgeAttempts?: number;
  eventBridgeRetryState?: string;
  staleActivity: boolean;
  staleWindowMinutes: number;
  partialOrderingObserved: boolean;
  reconciliationConfidence: AwsReconciliationConfidenceLevel;
  confidenceReasons: string[];
}

interface AwsReconciliationConfidence {
  level: AwsReconciliationConfidenceLevel;
  reasons: string[];
  staleFindingWindowMinutes: number;
  staleActivityWindowMinutes: number;
}

export class AwsReadOnlyAccessAnalysisConnector implements ConnectorAdapter {
  mode: ConnectorAdapter["mode"] = "read_only";
  readonly id: string;
  readonly provider = "aws";
  readonly tenantBoundary: string;
  readonly requiredReadScopes = [...AWS_READONLY_ACCESS_ANALYSIS_REQUIRED_READ_SCOPES];
  readonly capabilities: ConnectorCapabilities = {
    supportsDiscovery: true,
    supportsProvisioning: false,
    supportsReconciliation: true,
    supportsDirectPermissions: true,
    supportsInheritedPermissions: true,
    supportsExternalUsers: true,
    supportsTimeBoundAccess: true
  };

  readonly #client: AwsReadClient;
  readonly #organizationId: string;
  readonly #now: () => string;
  readonly #sandboxEvidenceRef?: string;
  readonly #credentialHandling: "managed_identity" | "vault_required";
  readonly #maxPages: number;
  readonly #maxRetries: number;
  readonly #latencyWindows: AwsLatencyWindows;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  #snapshot?: AwsSnapshot;
  #warnings: DiscoveryRunWarning[] = [];
  #nativeAccessReadbackComplete = true;

  constructor(options: AwsReadOnlyAccessAnalysisConnectorOptions) {
    this.id = options.id ?? AWS_READONLY_ACCESS_ANALYSIS_CONNECTOR_ID;
    this.#client = options.client;
    this.#organizationId = options.organizationId;
    this.tenantBoundary = options.tenantBoundary ?? createAwsOrganizationBoundary(options.organizationId);
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#sandboxEvidenceRef = options.sandboxEvidenceRef;
    this.#credentialHandling = options.credentialHandling ?? "vault_required";
    this.#maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
    this.#maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.#latencyWindows = {
      eventBridgeLatencyWindowMinutes: positiveNumberOrDefault(
        options.eventBridgeLatencyWindowMinutes,
        DEFAULT_EVENTBRIDGE_LATENCY_WINDOW_MINUTES
      ),
      cloudTrailStaleActivityWindowMinutes: positiveNumberOrDefault(
        options.cloudTrailStaleActivityWindowMinutes,
        DEFAULT_CLOUDTRAIL_STALE_ACTIVITY_WINDOW_MINUTES
      ),
      accessAnalyzerStaleFindingWindowMinutes: positiveNumberOrDefault(
        options.accessAnalyzerStaleFindingWindowMinutes,
        DEFAULT_ACCESS_ANALYZER_STALE_FINDING_WINDOW_MINUTES
      )
    };
    this.#sleep = options.sleep ?? sleep;
  }

  async discoverSubjects(): Promise<Subject[]> {
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
        message: "AWS read-only access-analysis connector is registered."
      },
      {
        name: "read_only_mode",
        status: this.mode === "read_only" ? "pass" : "fail",
        message: "AWS connector must remain read-only."
      },
      {
        name: "organization_boundary_redacted",
        status: this.tenantBoundary.includes(this.#organizationId) ? "fail" : "pass",
        message: "Organization boundary must not expose the raw AWS Organizations identifier.",
        evidence: {
          tenantBoundary: this.tenantBoundary,
          redacted: true
        }
      },
      {
        name: "sandbox_evidence",
        status: this.#sandboxEvidenceRef ? "pass" : "warn",
        message: this.#sandboxEvidenceRef
          ? "AWS sandbox evidence reference is configured."
          : "AWS sandbox evidence is not configured; discovery will emit a coverage warning.",
        evidence: {
          configured: Boolean(this.#sandboxEvidenceRef)
        }
      },
      {
        name: "latency_and_stale_windows",
        status: "pass",
        message: "AWS EventBridge, CloudTrail, and Access Analyzer latency windows are explicit in connector evidence.",
        evidence: {
          ...this.#latencyWindows,
          redacted: true
        }
      },
      ...this.requiredReadScopes.map((scope) => ({
        name: `scope:${scope}`,
        status: "pass" as const,
        message: "Approved AWS read scope is part of the least-privilege access-analysis readback set.",
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
        kind: "role",
        subject: `connector:${this.id}:${redactValue(this.#organizationId)}`,
        evidence: ["docs/connector-contract.md", "adrs/0006-connector-plugin-architecture.md"]
      },
      consent: {
        status: "approved",
        scopesApproved: this.requiredReadScopes,
        evidence: ["docs/connector-contract.md", "docs/security-model.md"]
      },
      leastPrivilege: {
        requiredReadScopes: this.requiredReadScopes,
        forbiddenWriteScopes: [...AWS_READONLY_ACCESS_ANALYSIS_FORBIDDEN_WRITE_SCOPES],
        scopeJustification:
          "AWS Organizations, IAM Identity Center, IAM role, CloudTrail lookup, and Access Analyzer read scopes are sufficient for redacted account, role, assignment, activity, and access-analysis readback without provider writes."
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
    return (await this.#loadSnapshot()).findings;
  }

  async emitEvidence(events: AuditEvent[]): Promise<EvidenceExport> {
    return createEvidence(this.id, events, this.#now(), this.#latencyWindows);
  }

  async #loadSnapshot(): Promise<AwsSnapshot> {
    if (this.#snapshot) {
      return this.#snapshot;
    }

    this.#warnings = [];
    this.#nativeAccessReadbackComplete = true;
    const organization = (await this.#readCollection<AwsOrganization>(
      "organizations.describeOrganization",
      {},
      "resources"
    )).at(0) ?? { id: this.#organizationId };
    const accounts = await this.#readCollection<AwsAccount>("organizations.listAccounts", {}, "resources");
    const permissionSets = await this.#readCollection<AwsPermissionSet>("ssoAdmin.listPermissionSets", {}, "resources");
    const roles = await this.#readCollection<AwsRole>("iam.listRoles", {}, "resources");
    const cloudTrailEvents = await this.#readCollection<AwsCloudTrailEvent>("cloudTrail.lookupEvents", {}, "native_grants");
    const analyzerFindings = await this.#readCollection<AwsAccessAnalyzerFinding>("accessAnalyzer.listFindings", {}, "native_grants");
    const assignments = await this.#readAssignments(accounts, permissionSets);

    if (cloudTrailEvents.length === 0) {
      this.#pushWarning({
        code: "AWS_CLOUDTRAIL_ACTIVITY_EMPTY",
        message: "CloudTrail lookup returned no activity events; current-access readback remains valid but activity recency is unknown.",
        severity: "warning",
        scope: "native_grants",
        retryable: true
      });
    }

    const maps = this.#buildEntityMaps(organization, accounts, permissionSets, roles, cloudTrailEvents);
    this.#pushLatencyWarnings(maps.latencyModel);
    this.#addAssignmentSubjects(assignments, maps);
    this.#addAccessAnalyzerSubjects(analyzerFindings, maps);

    const relationships = this.#buildRelationships(accounts, permissionSets, roles, assignments, maps);
    const grantsByResource = this.#buildNativeGrants(assignments, maps);
    const findings = this.#buildDriftFindings(analyzerFindings, maps);
    const cursor = this.#buildCursor();

    this.#snapshot = {
      subjects: [...maps.subjectsByPrincipalKey.values()],
      resources: [
        maps.organizationResource,
        ...maps.accountsById.values(),
        ...maps.permissionSetsByArn.values(),
        ...maps.rolesByArn.values()
      ],
      relationships,
      grantsByResource,
      findings,
      cursor,
      latencyModel: maps.latencyModel
    };

    return this.#snapshot;
  }

  async #readAssignments(accounts: AwsAccount[], permissionSets: AwsPermissionSet[]): Promise<AwsAccountAssignment[]> {
    const assignments: AwsAccountAssignment[] = [];

    for (const account of accounts) {
      if (!account.id) {
        this.#warnMissingId("resources");
        continue;
      }

      for (const permissionSet of permissionSets) {
        if (!permissionSet.arn) {
          this.#warnMissingId("resources");
          continue;
        }

        assignments.push(...await this.#readCollection<AwsAccountAssignment>(
          "ssoAdmin.listAccountAssignments",
          {
            accountId: account.id,
            permissionSetArn: permissionSet.arn
          },
          "native_grants"
        ));
      }
    }

    return assignments;
  }

  async #readCollection<T>(
    operation: AwsReadOperation,
    input: JsonRecord,
    scope: DiscoveryRunWarning["scope"]
  ): Promise<T[]> {
    const read = await this.#readCollectionResult<T>(operation, input, scope);
    if (scope === "native_grants" && !read.completed) {
      this.#nativeAccessReadbackComplete = false;
    }

    return read.values;
  }

  async #readCollectionResult<T>(
    operation: AwsReadOperation,
    input: JsonRecord,
    scope: DiscoveryRunWarning["scope"]
  ): Promise<AwsCollectionRead<T>> {
    const values: T[] = [];
    let nextInput: JsonRecord | undefined = input;
    let pageCount = 0;
    let retryCount = 0;
    let completed = true;

    while (nextInput) {
      if (pageCount >= this.#maxPages) {
        completed = false;
        this.#pushWarning({
          code: "AWS_PAGE_LIMIT_REACHED",
          message: `AWS ${operation} pagination reached the configured page limit; remaining pages were skipped.`,
          severity: "warning",
          scope,
          retryable: true
        });
        break;
      }

      const page: AwsReadCollectionPage<T> = await this.#client.list<T>(operation, nextInput);
      const status = page.status ?? 200;

      if (status === 429 || status === 503) {
        retryCount += 1;
        this.#pushWarning({
          code: "AWS_THROTTLE_RETRIED",
          message: "AWS readback was throttled; retry metadata was captured without retaining raw request identifiers.",
          severity: retryCount > this.#maxRetries ? "warning" : "info",
          scope,
          retryable: retryCount <= this.#maxRetries
        });

        if (retryCount <= this.#maxRetries) {
          const retryAfterMilliseconds = retryAfterSecondsToMilliseconds(page.retryAfterSeconds);
          if (retryAfterMilliseconds > 0) {
            await this.#sleep(retryAfterMilliseconds);
          }
          continue;
        }

        completed = false;
        break;
      }

      if (status >= 400) {
        completed = false;
        this.#pushWarning({
          code: "AWS_COLLECTION_SKIPPED",
          message: `AWS ${operation} readback returned HTTP ${status}; unsupported provider behavior was skipped instead of becoming canonical facts.`,
          severity: "warning",
          scope,
          retryable: status >= 500
        });
        break;
      }

      retryCount = 0;
      pageCount += 1;
      values.push(...page.value);

      if (page.nextToken) {
        this.#pushWarning({
          code: "AWS_PAGINATION_OBSERVED",
          message: `AWS ${operation} readback used paginated responses; raw nextToken values were redacted from evidence.`,
          severity: "info",
          scope,
          retryable: false
        });
        nextInput = { ...input, nextToken: page.nextToken };
      } else {
        nextInput = undefined;
      }
    }

    return { values, completed };
  }

  #buildEntityMaps(
    organization: AwsOrganization,
    accounts: AwsAccount[],
    permissionSets: AwsPermissionSet[],
    roles: AwsRole[],
    cloudTrailEvents: AwsCloudTrailEvent[]
  ): AwsEntityMaps {
    const organizationRawId = organization.id ?? this.#organizationId;
    const organizationResource = this.#organizationResource(organizationRawId, organization);
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
    const activityIndex = buildActivityIndex(cloudTrailEvents, this.#now(), this.#latencyWindows);
    const latestActivityByRawKey = activityIndex.activityByRawKey;

    for (const account of accounts) {
      if (!account.id) {
        this.#warnMissingId("resources");
        continue;
      }

      const resource = this.#accountResource(account);
      accountsById.set(account.id, resource);
      resourcesByRawKey.set(account.id, resource);
      for (const [key, value] of rawKeyEntry(account.arn, resource)) {
        resourcesByRawKey.set(key, value);
      }
      if (account.deletedDateTime || account.status === "SUSPENDED") {
        this.#warnTombstone("resources");
      }
    }

    for (const permissionSet of permissionSets) {
      if (!permissionSet.arn) {
        this.#warnMissingId("resources");
        continue;
      }

      const resource = this.#permissionSetResource(permissionSet, organizationResource.id);
      permissionSetsByArn.set(permissionSet.arn, resource);
      permissionSetMetadataByArn.set(permissionSet.arn, permissionSet);
      resourcesByRawKey.set(permissionSet.arn, resource);
      if (permissionSet.deletedDateTime) {
        this.#warnTombstone("resources");
      }
    }

    for (const role of roles) {
      if (!role.arn) {
        this.#warnMissingId("resources");
        continue;
      }

      const parentId = role.accountId ? accountsById.get(role.accountId)?.id : undefined;
      const resource = this.#roleResource(role, parentId);
      rolesByArn.set(role.arn, resource);
      resourcesByRawKey.set(role.arn, resource);
      for (const [key, value] of rawKeyEntry(role.roleId, resource)) {
        resourcesByRawKey.set(key, value);
      }
      if (role.deletedDateTime) {
        this.#warnTombstone("resources");
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

  #addAssignmentSubjects(assignments: AwsAccountAssignment[], maps: AwsEntityMaps): void {
    for (const assignment of assignments) {
      if (!assignment.principalId) {
        this.#warnMissingId("native_grants");
        continue;
      }

      const subject = this.#subjectForPrincipal(assignment.principalId, assignment.principalType);
      maps.subjectsByPrincipalKey.set(assignment.principalId, subject);
      maps.principalTypesBySubjectId.set(subject.id, nativePrincipalType(assignment.principalType));
      if (isDeletedAssignment(assignment)) {
        this.#warnTombstone("native_grants");
      }
    }
  }

  #addAccessAnalyzerSubjects(findings: AwsAccessAnalyzerFinding[], maps: AwsEntityMaps): void {
    for (const finding of findings) {
      const principalKey = accessAnalyzerPrincipalKey(finding.principal);
      if (!principalKey || maps.subjectsByPrincipalKey.has(principalKey)) {
        continue;
      }

      const subject = this.#subjectForAnalyzerPrincipal(principalKey);
      maps.subjectsByPrincipalKey.set(principalKey, subject);
      maps.principalTypesBySubjectId.set(subject.id, "service_account");
    }
  }

  #buildRelationships(
    accounts: AwsAccount[],
    permissionSets: AwsPermissionSet[],
    roles: AwsRole[],
    assignments: AwsAccountAssignment[],
    maps: AwsEntityMaps
  ): RelationshipTuple[] {
    const relationships: RelationshipTuple[] = [];

    for (const account of accounts) {
      if (!account.id) {
        continue;
      }

      const accountResource = maps.accountsById.get(account.id);
      if (accountResource) {
        relationships.push(this.#relationship(
          `org:${this.#organizationId}:account:${account.id}`,
          maps.organizationResource.id,
          "contains",
          accountResource.id,
          account.deletedDateTime || account.status === "SUSPENDED" ? "deleted" : "active"
        ));
      }
    }

    for (const permissionSet of permissionSets) {
      if (!permissionSet.arn) {
        continue;
      }

      const permissionSetResource = maps.permissionSetsByArn.get(permissionSet.arn);
      if (permissionSetResource) {
        relationships.push(this.#relationship(
          `org:${this.#organizationId}:permission-set:${permissionSet.arn}`,
          maps.organizationResource.id,
          "defines_permission_set",
          permissionSetResource.id,
          permissionSet.deletedDateTime ? "deleted" : "active"
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
        relationships.push(this.#relationship(
          `account:${role.accountId}:role:${role.arn}`,
          accountResource.id,
          "contains",
          roleResource.id,
          role.deletedDateTime ? "deleted" : "active"
        ));
      }
    }

    for (const assignment of assignments) {
      const subject = assignment.principalId ? maps.subjectsByPrincipalKey.get(assignment.principalId) : undefined;
      const accountResource = assignment.accountId ? maps.accountsById.get(assignment.accountId) : undefined;
      const permissionSetResource = assignment.permissionSetArn ? maps.permissionSetsByArn.get(assignment.permissionSetArn) : undefined;
      const status = isDeletedAssignment(assignment) ? "deleted" : "active";

      if (subject && accountResource) {
        relationships.push(this.#relationship(
          `assignment:${assignment.accountId}:${assignment.permissionSetArn}:${assignment.principalId}:account`,
          subject.id,
          "assigned_account_access",
          accountResource.id,
          status
        ));
      }

      if (subject && permissionSetResource) {
        relationships.push(this.#relationship(
          `assignment:${assignment.accountId}:${assignment.permissionSetArn}:${assignment.principalId}:permission-set`,
          subject.id,
          "assigned_permission_set",
          permissionSetResource.id,
          status
        ));
      }
    }

    return relationships;
  }

  #buildNativeGrants(assignments: AwsAccountAssignment[], maps: AwsEntityMaps): Map<string, NativeGrant[]> {
    const grantsByResource = new Map<string, NativeGrant[]>();

    for (const assignment of assignments) {
      if (!assignment.accountId || !assignment.permissionSetArn || !assignment.principalId) {
        this.#warnMissingId("native_grants");
        continue;
      }

      const accountResource = maps.accountsById.get(assignment.accountId);
      const permissionSetResource = maps.permissionSetsByArn.get(assignment.permissionSetArn);
      const permissionSet = maps.permissionSetMetadataByArn.get(assignment.permissionSetArn);
      const subject = maps.subjectsByPrincipalKey.get(assignment.principalId);
      if (!accountResource || !permissionSetResource || !subject) {
        this.#pushWarning({
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
        id: `native-grant:${this.id}:${redactValue(`${assignment.accountId}:${assignment.permissionSetArn}:${assignment.principalId}`)}`,
        targetPlatform: this.id,
        targetObjectId: accountResource.id,
        subjectId: subject.id,
        principalType: maps.principalTypesBySubjectId.get(subject.id) ?? "unknown",
        nativePermission: `sso:${safePermissionLabel(permissionSet?.name ?? permissionSetResource.id)}`,
        grantType: assignment.principalType === "GROUP" ? "group" : "direct",
        sourceConnectorId: this.id,
        status: isDeletedAssignment(assignment) ? "revoked" : "observed",
        observedAt: this.#now(),
        expiresAt: undefined,
        attributes: {
          organizationBoundary: this.tenantBoundary,
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
            staleWindowMinutes: this.#latencyWindows.cloudTrailStaleActivityWindowMinutes,
            reconciliationConfidence: "low",
            confidenceReasons: ["no_cloudtrail_activity"],
            redacted: true
          },
          reconciliationConfidence: activity?.reconciliationConfidence ?? "low",
          staleActivityWindowMinutes: this.#latencyWindows.cloudTrailStaleActivityWindowMinutes,
          eventBridgeLatencyWindowMinutes: this.#latencyWindows.eventBridgeLatencyWindowMinutes,
          redacted: true
        },
        version: "native-grant:v1",
        createdAt: this.#now()
      };

      grantsByResource.set(accountResource.id, [...grantsByResource.get(accountResource.id) ?? [], grant]);
    }

    return grantsByResource;
  }

  #buildDriftFindings(findings: AwsAccessAnalyzerFinding[], maps: AwsEntityMaps): DriftFinding[] {
    const driftFindings: DriftFinding[] = [];

    for (const finding of findings) {
      if (!finding.id || finding.status === "ARCHIVED" || finding.status === "RESOLVED") {
        continue;
      }

      const resource = resolveFindingResource(finding, maps);
      const principalKey = accessAnalyzerPrincipalKey(finding.principal);
      const subject = principalKey ? maps.subjectsByPrincipalKey.get(principalKey) : undefined;
      if (!resource || !subject) {
        this.#pushWarning({
          code: "AWS_ACCESS_ANALYZER_FINDING_SKIPPED",
          message: "Access Analyzer returned a finding outside the imported resource or principal boundary; the finding was retained as a coverage warning instead of a canonical drift fact.",
          severity: "warning",
          scope: "native_grants",
          retryable: false
        });
        continue;
      }

      const detectedAt = finding.updatedAt ?? finding.createdAt ?? this.#now();
      const confidence = accessAnalyzerReconciliationConfidence(finding, maps, this.#now(), this.#latencyWindows);
      const severity = accessAnalyzerSeverity(finding, confidence);
      const recommendedAction = finding.isPublic ? "revoke" : "review";
      if (confidence.level !== "high") {
        this.#pushWarning({
          code: "AWS_RECONCILIATION_CONFIDENCE_DEGRADED",
          message: `AWS access-analysis reconciliation confidence is ${confidence.level}; stale activity window ${confidence.staleActivityWindowMinutes}m, stale finding window ${confidence.staleFindingWindowMinutes}m, reasons: ${confidence.reasons.join(", ")}.`,
          severity: confidence.level === "low" ? "warning" : "info",
          scope: "native_grants",
          retryable: true
        });
      }

      driftFindings.push({
        id: `drift:${this.id}:${redactValue(finding.id)}`,
        resourceId: resource.id,
        subjectId: subject.id,
        nativeAccess: accessAnalyzerNativeAccess(finding, confidence),
        intendedAccess: `no-approved-rebac-intent; reconciliation_confidence=${confidence.level}; stale_activity_window=${confidence.staleActivityWindowMinutes}m; stale_finding_window=${confidence.staleFindingWindowMinutes}m`,
        severity,
        lifecycleState: "open",
        ownerId: "role:security-operations",
        assigneeId: "role:security-engineer",
        detectedAt,
        sourceConnectorId: this.id,
        recommendedAction,
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
          allowedActions: [recommendedAction],
          maxSeverity: severity,
          requireApproval: true,
          requireConnectorReadiness: true,
          liveProviderWrites: false,
          reason: "AWS Access Analyzer drift findings require approval and read-only verification before any remediation plan."
        },
        version: "drift-finding:v1",
        createdAt: this.#now()
      });
    }

    if (driftFindings.length > 0) {
      this.#pushWarning({
        code: "AWS_ACCESS_ANALYZER_FINDINGS_OBSERVED",
        message: "Access Analyzer reported active findings; reconciliation exposes them as reviewable drift findings without mutating AWS.",
        severity: "warning",
        scope: "native_grants",
        retryable: false
      });
    }

    return driftFindings;
  }

  #organizationResource(organizationId: string, organization: AwsOrganization): Resource {
    return {
      id: `organization:aws:${redactValue(organizationId)}`,
      type: "organization",
      displayName: `AWS organization ${redactValue(organizationId)}`,
      sourceSystem: this.id,
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
      createdAt: this.#now(),
      lastSeenAt: this.#now()
    };
  }

  #accountResource(account: AwsAccount): Resource {
    const rawId = account.id ?? "unknown";
    return {
      id: `aws-account:${redactValue(rawId)}`,
      type: "aws_account",
      displayName: `AWS account ${redactValue(rawId)}`,
      sourceSystem: this.id,
      ownerId: "user:access-kit-owner",
      dataStewardId: "user:access-kit-steward",
      technicalOwnerId: "user:access-kit-operator",
      classification: "internal",
      lifecycleState: account.deletedDateTime ? "deleted" : account.status === "SUSPENDED" ? "suspended" : "active",
      parentId: `organization:aws:${redactValue(this.#organizationId)}`,
      attributes: {
        organizationBoundary: this.tenantBoundary,
        accountHash: redactValue(rawId),
        arnHash: account.arn ? redactValue(account.arn) : undefined,
        emailHash: account.email ? redactValue(account.email) : undefined,
        status: account.status,
        joinedTimestamp: account.joinedTimestamp,
        redacted: true
      },
      version: "resource:v1",
      createdAt: this.#now(),
      lastSeenAt: this.#now()
    };
  }

  #permissionSetResource(permissionSet: AwsPermissionSet, parentId: string): Resource {
    const rawArn = permissionSet.arn ?? "unknown";
    return {
      id: `aws-role:permission-set:${redactValue(rawArn)}`,
      type: "aws_role",
      displayName: `AWS IAM Identity Center permission set ${redactValue(rawArn)}`,
      sourceSystem: this.id,
      ownerId: "user:access-kit-owner",
      dataStewardId: "user:access-kit-steward",
      technicalOwnerId: "user:access-kit-operator",
      classification: "internal",
      lifecycleState: permissionSet.deletedDateTime ? "deleted" : "active",
      parentId,
      attributes: {
        organizationBoundary: this.tenantBoundary,
        permissionSetHash: redactValue(rawArn),
        nameHash: permissionSet.name ? redactValue(permissionSet.name) : undefined,
        sessionDuration: permissionSet.sessionDuration,
        redacted: true
      },
      version: "resource:v1",
      createdAt: this.#now(),
      lastSeenAt: this.#now()
    };
  }

  #roleResource(role: AwsRole, parentId: string | undefined): Resource {
    const rawArn = role.arn ?? role.roleId ?? role.roleName ?? "unknown";
    return {
      id: `aws-role:${redactValue(rawArn)}`,
      type: "aws_role",
      displayName: `AWS IAM role ${redactValue(rawArn)}`,
      sourceSystem: this.id,
      ownerId: "user:access-kit-owner",
      dataStewardId: "user:access-kit-steward",
      technicalOwnerId: "user:access-kit-operator",
      classification: "internal",
      lifecycleState: role.deletedDateTime ? "deleted" : "active",
      parentId,
      attributes: {
        organizationBoundary: this.tenantBoundary,
        arnHash: role.arn ? redactValue(role.arn) : undefined,
        roleIdHash: role.roleId ? redactValue(role.roleId) : undefined,
        roleNameHash: role.roleName ? redactValue(role.roleName) : undefined,
        pathHash: role.path ? redactValue(role.path) : undefined,
        maxSessionDuration: role.maxSessionDuration,
        redacted: true
      },
      version: "resource:v1",
      createdAt: this.#now(),
      lastSeenAt: this.#now()
    };
  }

  #subjectForPrincipal(principalId: string, principalType: string | undefined): Subject {
    const type = subjectType(principalType);
    return {
      id: `${subjectPrefix(type)}:aws-identity-center:${redactValue(principalId)}`,
      type,
      displayName: `AWS Identity Center ${type.replace("_", " ")} ${redactValue(principalId)}`,
      sourceSystem: this.id,
      lifecycleState: "active",
      identifiers: {
        principalHash: redactValue(principalId)
      },
      attributes: {
        organizationBoundary: this.tenantBoundary,
        principalType: principalType ?? "UNKNOWN",
        redacted: true
      },
      version: "subject:v1",
      createdAt: this.#now(),
      lastSeenAt: this.#now()
    };
  }

  #subjectForAnalyzerPrincipal(principalKey: string): Subject {
    return {
      id: `service-account:aws-external:${redactValue(principalKey)}`,
      type: "service_account",
      displayName: `AWS external principal ${redactValue(principalKey)}`,
      sourceSystem: this.id,
      lifecycleState: "active",
      identifiers: {
        principalHash: redactValue(principalKey)
      },
      attributes: {
        organizationBoundary: this.tenantBoundary,
        source: "access_analyzer",
        external: true,
        redacted: true
      },
      version: "subject:v1",
      createdAt: this.#now(),
      lastSeenAt: this.#now()
    };
  }

  #relationship(
    idSeed: string,
    subjectId: string,
    relation: string,
    objectId: string,
    status: RelationshipTuple["status"] = "active"
  ): RelationshipTuple {
    return {
      id: `relationship:${this.id}:${redactValue(idSeed)}`,
      subjectId,
      relation,
      objectId,
      sourceSystem: this.id,
      assertedAt: this.#now(),
      status,
      attributes: {
        organizationBoundary: this.tenantBoundary,
        redacted: true
      },
      version: "tuple:v1",
      createdAt: this.#now()
    };
  }

  #buildCursor(): DiscoveryCursor {
    return {
      startedFrom: "cursor:aws:initial",
      highWatermark: `cursor:aws:${compactTimestamp(this.#now())}`,
      deletedObjectBehavior: "mark_deleted"
    };
  }

  #buildPreDiscoveryCursor(): DiscoveryCursor {
    return {
      startedFrom: "cursor:aws:initial",
      highWatermark: "cursor:aws:pre-discovery",
      deletedObjectBehavior: "mark_deleted"
    };
  }

  #baseWarnings(): DiscoveryRunWarning[] {
    return this.#sandboxEvidenceRef
      ? []
      : [
          {
            code: "AWS_SANDBOX_EVIDENCE_REQUIRED",
            message: "No AWS sandbox evidence reference is configured; retain a sandbox run artifact before claiming live-account verification.",
            severity: "warning",
            scope: "connector",
            retryable: false
          }
        ];
  }

  #warnMissingId(scope: DiscoveryRunWarning["scope"]): void {
    this.#pushWarning({
      code: "AWS_OBJECT_MISSING_ID_SKIPPED",
      message: "AWS readback returned an object without the required identifier; the object was skipped.",
      severity: "warning",
      scope,
      retryable: false
    });
  }

  #warnTombstone(scope: DiscoveryRunWarning["scope"]): void {
    this.#pushWarning({
      code: "AWS_TOMBSTONE_MARKED",
      message: "AWS readback included a deleted or suspended object; the connector marked it as deleted instead of dropping evidence.",
      severity: "info",
      scope,
      retryable: false
    });
  }

  #pushLatencyWarnings(latencyModel: AwsLatencyModel): void {
    this.#pushWarning({
      code: "AWS_ASYNC_ACTIVITY_WINDOWS_MODELED",
      message: `AWS readback models EventBridge delivery latency (${latencyModel.windows.eventBridgeLatencyWindowMinutes}m), CloudTrail stale activity (${latencyModel.windows.cloudTrailStaleActivityWindowMinutes}m), and Access Analyzer stale finding (${latencyModel.windows.accessAnalyzerStaleFindingWindowMinutes}m) windows before treating access-analysis evidence as high confidence.`,
      severity: "info",
      scope: "native_grants",
      retryable: false
    });

    if (latencyModel.eventBridge.latencyWindowExceeded) {
      this.#pushWarning({
        code: "AWS_EVENTBRIDGE_LATENCY_WINDOW_EXCEEDED",
        message: `EventBridge delivery lag exceeded the ${latencyModel.windows.eventBridgeLatencyWindowMinutes}m evidence window; reconciliation confidence is reduced until a later readback confirms ordering.`,
        severity: "warning",
        scope: "native_grants",
        retryable: true
      });
    }

    if (latencyModel.eventBridge.retryObserved) {
      this.#pushWarning({
        code: "AWS_EVENTBRIDGE_RETRY_OBSERVED",
        message: "EventBridge delivery metadata showed retry behavior; retry evidence is retained as redacted activity metadata instead of canonical access intent.",
        severity: "info",
        scope: "native_grants",
        retryable: true
      });
    }

    if (latencyModel.eventBridge.partialOrderingObserved) {
      this.#pushWarning({
        code: "AWS_EVENT_PARTIAL_ORDERING_OBSERVED",
        message: "CloudTrail event time and EventBridge delivery time are partially ordered; operators should treat per-grant activity recency as evidence with ordering uncertainty.",
        severity: "warning",
        scope: "native_grants",
        retryable: true
      });
    }

    if (latencyModel.cloudTrail.staleActivityObserved) {
      this.#pushWarning({
        code: "AWS_CLOUDTRAIL_ACTIVITY_STALE",
        message: `CloudTrail activity exceeded the ${latencyModel.windows.cloudTrailStaleActivityWindowMinutes}m stale window; current-access readback remains authoritative but activity evidence is low confidence.`,
        severity: "warning",
        scope: "native_grants",
        retryable: true
      });
    }
  }

  #pushWarning(warning: DiscoveryRunWarning): void {
    const key = `${warning.code}:${warning.scope}:${warning.message}`;
    const existingIndex = this.#warnings.findIndex((existing) => `${existing.code}:${existing.scope}:${existing.message}` === key);
    if (existingIndex >= 0) {
      const existing = this.#warnings[existingIndex]!;
      if (
        warningSeverityRank(warning.severity) > warningSeverityRank(existing.severity)
        || (existing.retryable && !warning.retryable)
      ) {
        this.#warnings[existingIndex] = { ...existing, ...warning };
      }
      return;
    }

    this.#warnings.push(warning);
  }
}

export function createAwsReadOnlyAccessAnalysisConnectorFromEnv(
  env: AwsConnectorEnv = process.env
): AwsReadOnlyAccessAnalysisConnector | undefined {
  const enabled = env.REBAC_AWS_READONLY_ACCESS_ANALYSIS_ENABLED === "true" || env.REBAC_AWS_READONLY_ENABLED === "true";
  if (!enabled) {
    return undefined;
  }

  const organizationId = env.REBAC_AWS_ORGANIZATION_ID;
  const fixturePath = env.REBAC_AWS_READONLY_FIXTURE_FILE;
  if (!organizationId || !fixturePath || !existsSync(fixturePath)) {
    return undefined;
  }

  return new AwsReadOnlyAccessAnalysisConnector({
    organizationId,
    sandboxEvidenceRef: env.REBAC_AWS_SANDBOX_EVIDENCE,
    client: new JsonAwsReadClient(readJsonFixture(fixturePath))
  });
}

export function awsReadClientKey(operation: AwsReadOperation, input: JsonRecord = {}): string {
  const stableInput = stableJson(input);
  return stableInput === "{}" ? operation : `${operation}:${stableInput}`;
}

function createAwsOrganizationBoundary(organizationId: string): string {
  return `aws:organization:${redactValue(organizationId, 20)}`;
}

function redactValue(value: string, length = REDACTION_HASH_LENGTH): string {
  return sha256({ value }).slice(0, length);
}

function rawKeyEntry(key: string | undefined, resource: Resource): Array<[string, Resource]> {
  return key ? [[key, resource]] : [];
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

function isDeletedAssignment(assignment: AwsAccountAssignment): boolean {
  return Boolean(assignment.deletedDateTime) || assignment.status === "DELETED";
}

function buildActivityIndex(
  events: AwsCloudTrailEvent[],
  now: string,
  windows: AwsLatencyWindows
): AwsActivityIndex {
  const activityByRawKey = new Map<string, AwsActivity>();
  const activities: AwsActivity[] = [];
  const partialOrderingObserved = hasPartialOrdering(events);

  for (const event of events) {
    if (!event.eventTime) {
      continue;
    }

    const eventHash = redactValue(event.eventId ?? `${event.eventName}:${event.eventTime}`);
    const cloudTrailActivityAgeMinutes = minutesBetween(event.eventTime, now);
    const eventBridgeLatencyMinutes = event.eventBridgeDeliveredAt
      ? minutesBetween(event.eventTime, event.eventBridgeDeliveredAt)
      : undefined;
    const eventBridgeDeliveryPrecedesEvent = eventBridgeLatencyMinutes !== undefined && eventBridgeLatencyMinutes < 0;
    const eventBridgeAttempts = positiveIntegerOrUndefined(event.eventBridgeAttemptCount);
    const eventBridgeRetryState = event.eventBridgeRetryState
      ? safePermissionLabel(event.eventBridgeRetryState)
      : undefined;
    const retryObserved = Boolean(eventBridgeRetryState?.toLowerCase().includes("retry")) || (eventBridgeAttempts ?? 1) > 1;
    const staleActivity = cloudTrailActivityAgeMinutes === undefined
      ? true
      : cloudTrailActivityAgeMinutes > windows.cloudTrailStaleActivityWindowMinutes;
    const latencyWindowExceeded = eventBridgeLatencyMinutes === undefined
      ? false
      : eventBridgeLatencyMinutes > windows.eventBridgeLatencyWindowMinutes;
    const confidenceReasons = [
      ...(staleActivity ? ["cloudtrail_activity_stale"] : []),
      ...(latencyWindowExceeded ? ["eventbridge_latency_window_exceeded"] : []),
      ...(eventBridgeDeliveryPrecedesEvent ? ["eventbridge_delivery_precedes_event"] : []),
      ...(retryObserved ? ["eventbridge_retry_observed"] : []),
      ...(partialOrderingObserved ? ["partial_ordering_observed"] : [])
    ];
    const activity: AwsActivity = {
      eventHash,
      eventName: event.eventName ?? "unknown",
      eventTime: event.eventTime,
      readOnly: event.readOnly === true || event.readOnly === "true",
      cloudTrailActivityAgeMinutes,
      eventBridgeDeliveredAt: event.eventBridgeDeliveredAt,
      eventBridgeLatencyMinutes,
      eventBridgeAttempts,
      eventBridgeRetryState,
      staleActivity,
      staleWindowMinutes: windows.cloudTrailStaleActivityWindowMinutes,
      partialOrderingObserved,
      reconciliationConfidence: confidenceLevelForReasons(confidenceReasons),
      confidenceReasons
    };
    const rawKeys = new Set<string>();
    activities.push(activity);

    if (event.recipientAccountId) {
      rawKeys.add(event.recipientAccountId);
    }

    for (const resource of event.resources ?? []) {
      if (resource.resourceName) {
        rawKeys.add(resource.resourceName);
      }
    }

    for (const rawKey of rawKeys) {
      const current = activityByRawKey.get(rawKey);
      if (!current || current.eventTime < activity.eventTime) {
        activityByRawKey.set(rawKey, activity);
      }
    }
  }

  return {
    activityByRawKey,
    latencyModel: {
      windows,
      observedAt: now,
      eventBridge: {
        observed: activities.some((activity) => Boolean(activity.eventBridgeDeliveredAt)),
        maxLatencyMinutes: maxDefined(activities.map((activity) => activity.eventBridgeLatencyMinutes)),
        retryObserved: activities.some((activity) => activity.confidenceReasons.includes("eventbridge_retry_observed")),
        latencyWindowExceeded: activities.some((activity) => activity.confidenceReasons.includes("eventbridge_latency_window_exceeded")),
        partialOrderingObserved,
        redacted: true
      },
      cloudTrail: {
        latestEventAt: activities.map((activity) => activity.eventTime).sort().at(-1),
        maxActivityAgeMinutes: maxDefined(activities.map((activity) => activity.cloudTrailActivityAgeMinutes)),
        staleActivityObserved: activities.some((activity) => activity.staleActivity),
        redacted: true
      }
    }
  };
}

function latestActivityForAssignment(assignment: AwsAccountAssignment, maps: AwsEntityMaps): AwsActivity | undefined {
  return [
    assignment.permissionSetArn,
    assignment.accountId
  ].flatMap((key) => key ? [maps.latestActivityByRawKey.get(key)] : [])
    .filter((activity): activity is AwsActivity => Boolean(activity))
    .sort((a, b) => b.eventTime.localeCompare(a.eventTime))
    .at(0);
}

function latestActivityForFinding(finding: AwsAccessAnalyzerFinding, maps: AwsEntityMaps): AwsActivity | undefined {
  return [
    finding.resource
  ].flatMap((key) => key ? [maps.latestActivityByRawKey.get(key)] : [])
    .filter((activity): activity is AwsActivity => Boolean(activity))
    .sort((a, b) => b.eventTime.localeCompare(a.eventTime))
    .at(0);
}

function accessAnalyzerPrincipalKey(principal: AwsAccessAnalyzerFinding["principal"]): string | undefined {
  if (typeof principal === "string") {
    return principal;
  }

  if (!principal) {
    return undefined;
  }

  return principal.AWS ?? principal.Federated ?? principal.Service ?? Object.values(principal).at(0);
}

function resolveFindingResource(finding: AwsAccessAnalyzerFinding, maps: AwsEntityMaps): Resource | undefined {
  if (finding.resource) {
    const direct = maps.resourcesByRawKey.get(finding.resource);
    if (direct) {
      return direct;
    }
  }

  return undefined;
}

function accessAnalyzerNativeAccess(
  finding: AwsAccessAnalyzerFinding,
  confidence: AwsReconciliationConfidence
): string {
  const actions = (finding.action ?? []).map(safePermissionLabel).filter((action) => action.length > 0);
  const type = finding.findingType ? safePermissionLabel(finding.findingType) : "access-analyzer";
  const nativeAccess = actions.length > 0 ? `${type}:${actions.join(",")}` : type;
  return `${nativeAccess}; reconciliation_confidence=${confidence.level}; stale_activity_window=${confidence.staleActivityWindowMinutes}m; stale_finding_window=${confidence.staleFindingWindowMinutes}m`;
}

function accessAnalyzerSeverity(
  finding: AwsAccessAnalyzerFinding,
  confidence: AwsReconciliationConfidence
): DriftFinding["severity"] {
  if (finding.isPublic) {
    return "critical";
  }

  if (finding.findingType === "ExternalAccess" || finding.principal) {
    return confidence.level === "low" ? "critical" : "high";
  }

  return confidence.level === "low" ? "high" : "medium";
}

function accessAnalyzerReconciliationConfidence(
  finding: AwsAccessAnalyzerFinding,
  maps: AwsEntityMaps,
  now: string,
  windows: AwsLatencyWindows
): AwsReconciliationConfidence {
  const findingTimestamp = finding.updatedAt ?? finding.createdAt;
  const findingAgeMinutes = findingTimestamp ? minutesBetween(findingTimestamp, now) : undefined;
  const activity = latestActivityForFinding(finding, maps);
  const reasons = [
    ...(findingAgeMinutes === undefined ? ["access_analyzer_timestamp_missing"] : []),
    ...(findingAgeMinutes !== undefined && findingAgeMinutes > windows.accessAnalyzerStaleFindingWindowMinutes
      ? ["access_analyzer_finding_stale"]
      : []),
    ...(activity ? activity.confidenceReasons : ["cloudtrail_activity_missing"]),
    ...(maps.latencyModel.eventBridge.partialOrderingObserved ? ["partial_ordering_observed"] : [])
  ];
  const uniqueReasons = [...new Set(reasons)];

  return {
    level: confidenceLevelForReasons(uniqueReasons),
    reasons: uniqueReasons.length > 0 ? uniqueReasons : ["within_latency_windows"],
    staleFindingWindowMinutes: windows.accessAnalyzerStaleFindingWindowMinutes,
    staleActivityWindowMinutes: windows.cloudTrailStaleActivityWindowMinutes
  };
}

function safePermissionLabel(value: string): string {
  return value.replaceAll(/[^a-z0-9_.:,-]+/gi, "-").replaceAll(/^-|-$/g, "") || "unknown";
}

function confidenceLevelForReasons(reasons: string[]): AwsReconciliationConfidenceLevel {
  if (reasons.some((reason) => (
    reason.includes("stale") ||
    reason.includes("missing") ||
    reason.includes("failed") ||
    reason.includes("precedes")
  ))) {
    return "low";
  }

  return reasons.length > 0 ? "medium" : "high";
}

function hasPartialOrdering(events: AwsCloudTrailEvent[]): boolean {
  const deliveredEvents = events
    .filter((event): event is AwsCloudTrailEvent & { eventTime: string; eventBridgeDeliveredAt: string } =>
      Boolean(event.eventTime && event.eventBridgeDeliveredAt));

  return deliveredEvents.some((event, index) =>
    deliveredEvents.slice(index + 1).some((candidate) => {
      const eventTimeOrder = event.eventTime.localeCompare(candidate.eventTime);
      const deliveryOrder = event.eventBridgeDeliveredAt.localeCompare(candidate.eventBridgeDeliveredAt);
      return eventTimeOrder !== 0 && deliveryOrder !== 0 && Math.sign(eventTimeOrder) !== Math.sign(deliveryOrder);
    }));
}

function minutesBetween(start: string, end: string): number | undefined {
  const startMilliseconds = Date.parse(start);
  const endMilliseconds = Date.parse(end);
  if (!Number.isFinite(startMilliseconds) || !Number.isFinite(endMilliseconds)) {
    return undefined;
  }

  return Math.round(((endMilliseconds - startMilliseconds) / MILLISECONDS_PER_MINUTE) * 100) / 100;
}

function maxDefined(values: Array<number | undefined>): number | undefined {
  const defined = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return defined.length > 0 ? Math.max(...defined) : undefined;
}

function positiveIntegerOrUndefined(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function positiveNumberOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function compactTimestamp(value: string): string {
  return value.replaceAll(/[^0-9a-z]/gi, "").toLowerCase();
}

const MAX_RETRY_AFTER_MILLISECONDS = 60_000;

function retryAfterSecondsToMilliseconds(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.min(Math.ceil(value * 1000), MAX_RETRY_AFTER_MILLISECONDS)
    : 0;
}

function warningSeverityRank(severity: DiscoveryRunWarning["severity"]): number {
  return severity === "warning" ? 1 : 0;
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function readJsonFixture(path: string): AwsReadClientPages {
  const body: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (isJsonRecord(body) && isJsonRecord(body.pages)) {
    return body.pages as AwsReadClientPages;
  }

  if (isJsonRecord(body)) {
    return body as AwsReadClientPages;
  }

  return {};
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }

  if (isJsonRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function createEvidence(
  connectorId: string,
  events: AuditEvent[],
  now: string,
  latencyWindows: AwsLatencyWindows
): EvidenceExport {
  const sourceEventIds = readOnlyConnectorSourceEventIds(events);

  return createReadOnlyConnectorEvidenceExport({
    events,
    sourceEventIds,
    generatedAt: now,
    draft: {
      exportId: `evidence:${connectorId}`,
      framework: "nist-800-53",
      controls: ["AC-2", "AC-3", "AC-6", "AU-2"],
      evidenceTypes: ["audit_events", "discovery_runs", "native_grants", "drift_findings", "connector_latency_model", "audit_integrity", "control_mappings"],
      responsibleRole: "ISSO",
      format: "json",
      controlMappings: [
        {
          controlId: "AC-6",
          family: "AC",
          status: events.length > 0 ? "implemented" : "partially_implemented",
          implementationSummary: `AWS connector evidence includes redacted read-only account, role, assignment, CloudTrail, EventBridge latency, and Access Analyzer observations with ${latencyWindows.cloudTrailStaleActivityWindowMinutes}m CloudTrail and ${latencyWindows.accessAnalyzerStaleFindingWindowMinutes}m Access Analyzer stale windows.`,
          evidenceTypes: ["audit_events", "native_grants", "drift_findings", "connector_latency_model"],
          sourceEventIds,
          gaps: events.length > 0 ? [] : ["No source audit events were provided to the AWS connector evidence hook."]
        }
      ],
      artifacts: [
        {
          name: "aws-readonly-access-analysis-audit-events",
          type: "audit_events",
          description: "Redacted AWS read-only access-analysis connector audit events prepared for evidence packaging.",
          eventCount: events.length,
          format: "json"
        },
        {
          name: "aws-eventbridge-cloudtrail-latency-model",
          type: "security_evidence",
          description: `EventBridge delivery latency ${latencyWindows.eventBridgeLatencyWindowMinutes}m, CloudTrail stale activity ${latencyWindows.cloudTrailStaleActivityWindowMinutes}m, and Access Analyzer stale finding ${latencyWindows.accessAnalyzerStaleFindingWindowMinutes}m windows used for AWS reconciliation confidence.`,
          format: "json"
        }
      ],
      conmonMetrics: [
        {
          name: "aws_readonly_access_analysis_evidence_events",
          value: events.length,
          unit: "count",
          source: connectorId
        }
      ],
      poamItems: [],
      systemBoundary: {
        boundaryId: `boundary:${connectorId}`,
        name: `${connectorId} connector evidence boundary`,
        description: "AWS read-only connector boundary with redacted account, role, assignment, activity, and Access Analyzer evidence.",
        environment: "local_proof_point",
        liveTenantData: true,
        components: [
          {
            id: `component:connector:${connectorId}`,
            name: `${connectorId} connector`,
            type: "connector",
            trustZone: "future_production",
            dataClassification: "redacted AWS access metadata",
            description: "Read-only AWS adapter for IAM Identity Center assignments, AWS accounts, IAM roles, CloudTrail activity, and Access Analyzer findings."
          }
        ],
        externalSystems: ["aws-organizations", "aws-iam-identity-center", "aws-iam", "aws-cloudtrail", "aws-access-analyzer"],
        assumptions: [
          "Connector evidence redacts organization identifiers, account IDs, ARNs, principal IDs, CloudTrail event IDs, request IDs, tokens, and cursors.",
          `AWS activity evidence is partially ordered and uses EventBridge delivery latency ${latencyWindows.eventBridgeLatencyWindowMinutes}m, CloudTrail stale activity ${latencyWindows.cloudTrailStaleActivityWindowMinutes}m, and Access Analyzer stale finding ${latencyWindows.accessAnalyzerStaleFindingWindowMinutes}m confidence windows.`
        ],
        version: "system-boundary:v1"
      },
      dataFlows: [
        {
          id: `data-flow:${connectorId}:evidence`,
          name: `${connectorId} connector evidence emission`,
          source: `component:connector:${connectorId}`,
          destination: "component:api-runtime",
          dataTypes: ["redacted_aws_inventory", "redacted_identity_center_assignments", "redacted_cloudtrail_activity", "redacted_eventbridge_delivery_metadata", "redacted_access_analyzer_findings"],
          protections: ["read_only_scopes", "redacted_identifiers", "latency_confidence_windows", "no_provider_writes"],
          liveTenantData: true
        }
      ],
      controlStatements: [
        {
          controlId: "AC-6",
          status: events.length > 0 ? "implemented" : "partially_implemented",
          statement: `AWS access-analysis connector evidence includes redacted read-only discovery, drift observations, EventBridge retry or latency indicators, CloudTrail stale activity windows, and reconciliation confidence emitted by the local control plane.`,
          responsibleRole: "ISSO",
          reviewerRole: "Security Control Assessor",
          reviewedAt: now,
          evidenceTypes: ["audit_events", "native_grants", "drift_findings", "connector_latency_model"],
          sourceArtifactNames: ["aws-readonly-access-analysis-audit-events", "aws-eventbridge-cloudtrail-latency-model"],
          gaps: events.length > 0 ? [] : ["No source audit events were provided to the AWS connector evidence hook."]
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
          summary: "AWS read-only access-analysis connector configuration is represented with redacted local proof-point evidence.",
          evidenceRefs: ["packages/connectors-aws/src/index.ts", "docs/connector-contract.md"],
          gaps: ["Retain AWS sandbox run evidence before claiming environment-specific account verification."]
        },
        {
          id: `operational:${connectorId}:latency-confidence`,
          type: "configuration_baseline",
          status: "implemented",
          ownerRole: "Connector Owner",
          generatedAt: now,
          summary: `AWS EventBridge latency, CloudTrail stale activity, partial ordering, retry behavior, and Access Analyzer confidence windows are explicit operator evidence: EventBridge ${latencyWindows.eventBridgeLatencyWindowMinutes}m, CloudTrail ${latencyWindows.cloudTrailStaleActivityWindowMinutes}m, Access Analyzer ${latencyWindows.accessAnalyzerStaleFindingWindowMinutes}m.`,
          evidenceRefs: ["packages/connectors-aws/src/index.ts", "docs/drift-detection-model.md"],
          gaps: []
        }
      ]
    }
  });
}
