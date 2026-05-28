import { existsSync } from "node:fs";
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
  type DiscoveryRunWarning,
  type DriftFinding,
  type EvidenceExport,
  type JsonRecord,
  type NativeGrant,
  type ProvisioningPlan,
  type RelationshipTuple,
  type Resource,
  type Subject
} from "@access-kit/core";
import {
  addAwsAccessAnalyzerSubjects,
  addAwsAssignmentSubjects,
  buildAwsCursor,
  buildAwsEntityMaps,
  buildAwsPreDiscoveryCursor,
  buildAwsRelationships,
  createAwsOrganizationBoundary,
  pushAwsMissingIdWarning,
  type AwsDiscoveryContext
} from "./discovery.js";
import { buildAwsDriftFindings } from "./drift-findings.js";
import { createAwsEvidence } from "./evidence.js";
import {
  DEFAULT_ACCESS_ANALYZER_STALE_FINDING_WINDOW_MINUTES,
  DEFAULT_CLOUDTRAIL_STALE_ACTIVITY_WINDOW_MINUTES,
  DEFAULT_EVENTBRIDGE_LATENCY_WINDOW_MINUTES,
  pushAwsLatencyWarnings
} from "./latency-confidence.js";
import { buildAwsNativeGrants } from "./native-grants.js";
import {
  AWS_READONLY_ACCESS_ANALYSIS_CONNECTOR_ID,
  AWS_READONLY_ACCESS_ANALYSIS_FORBIDDEN_WRITE_SCOPES,
  AWS_READONLY_ACCESS_ANALYSIS_REQUIRED_READ_SCOPES,
  DEFAULT_MAX_PAGES,
  DEFAULT_MAX_RETRIES,
  JsonAwsReadClient,
  readJsonFixture,
  retryAfterSecondsToMilliseconds,
  sleep,
  type AwsCollectionRead,
  type AwsReadClient,
  type AwsReadCollectionPage,
  type AwsReadOperation
} from "./operations.js";
import type {
  AwsAccessAnalyzerFinding,
  AwsAccount,
  AwsAccountAssignment,
  AwsCloudTrailEvent,
  AwsConnectorEnv,
  AwsLatencyWindows,
  AwsOrganization,
  AwsPermissionSet,
  AwsRole,
  AwsSnapshot
} from "./provider-models.js";
import { positiveNumberOrDefault, redactValue, warningSeverityRank } from "./provider-utils.js";

export {
  AWS_READONLY_ACCESS_ANALYSIS_CONNECTOR_ID,
  AWS_READONLY_ACCESS_ANALYSIS_FORBIDDEN_WRITE_SCOPES,
  AWS_READONLY_ACCESS_ANALYSIS_REQUIRED_READ_SCOPES,
  AWS_READ_OPERATION_DESCRIPTORS,
  JsonAwsReadClient,
  awsReadClientKey,
  type AwsReadClient,
  type AwsReadClientPages,
  type AwsReadCollectionPage,
  type AwsReadOperation,
  type AwsReadOperationDescriptor
} from "./operations.js";

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
      cursor: this.#snapshot?.cursor ?? buildAwsPreDiscoveryCursor()
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
    return createAwsEvidence(this.id, events, this.#now(), this.#latencyWindows);
  }

  async #loadSnapshot(): Promise<AwsSnapshot> {
    if (this.#snapshot) {
      return this.#snapshot;
    }

    this.#warnings = [];
    this.#nativeAccessReadbackComplete = true;
    const context = this.#discoveryContext();
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

    const maps = buildAwsEntityMaps(
      organization,
      accounts,
      permissionSets,
      roles,
      cloudTrailEvents,
      this.#latencyWindows,
      context
    );
    pushAwsLatencyWarnings(maps.latencyModel, context.pushWarning);
    addAwsAssignmentSubjects(assignments, maps, context);
    addAwsAccessAnalyzerSubjects(analyzerFindings, maps, context);

    const relationships = buildAwsRelationships(accounts, permissionSets, roles, assignments, maps, context);
    const grantsByResource = buildAwsNativeGrants(assignments, maps, {
      connectorId: this.id,
      tenantBoundary: this.tenantBoundary,
      now: () => this.#now(),
      latencyWindows: this.#latencyWindows,
      pushWarning: (warning) => this.#pushWarning(warning)
    });
    const findings = buildAwsDriftFindings(analyzerFindings, maps, {
      connectorId: this.id,
      now: () => this.#now(),
      latencyWindows: this.#latencyWindows,
      pushWarning: (warning) => this.#pushWarning(warning)
    });
    const cursor = buildAwsCursor(this.#now());

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
        pushAwsMissingIdWarning("resources", (warning) => this.#pushWarning(warning));
        continue;
      }

      for (const permissionSet of permissionSets) {
        if (!permissionSet.arn) {
          pushAwsMissingIdWarning("resources", (warning) => this.#pushWarning(warning));
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

  #discoveryContext(): AwsDiscoveryContext {
    return {
      connectorId: this.id,
      tenantBoundary: this.tenantBoundary,
      organizationId: this.#organizationId,
      now: () => this.#now(),
      pushWarning: (warning) => this.#pushWarning(warning)
    };
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
