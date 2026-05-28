import {
  finalizeEvidenceExport,
  sha256,
  verifyAuditChain,
  type AuditEvent,
  type CanonicalId,
  type ConnectorAdapter,
  type ConnectorDiscoveryMetadata,
  type ConnectorHealthCheck,
  type ConnectorSecurityReview,
  type DecisionResult,
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

export const SAMPLE_READONLY_CONNECTOR_ID = "sample-readonly";
export const SAMPLE_READONLY_PROVIDER = "sample-provider";
export const SAMPLE_READONLY_TENANT_BOUNDARY = "synthetic:sample:tenant";
export const SAMPLE_READONLY_REQUIRED_READ_SCOPES = ["synthetic:sample.read"] as const;
export const SAMPLE_READONLY_FORBIDDEN_WRITE_SCOPES = ["synthetic:sample.write"] as const;

const sampleNow = "2026-05-26T12:00:00.000Z";
const samplePreviousCursor = "cursor:sample:previous-redacted";
const sampleNextCursor = "cursor:sample:next-redacted";
const sampleHighWatermark = "cursor:sample:20260526t120000000z";
const sampleSecondHighWatermark = "cursor:sample:20260526t121500000z";

export const SAMPLE_APPLICATION_RESOURCE_ID = sampleCanonicalId("application", "provider-app-case-review");
export const SAMPLE_DOCUMENT_RESOURCE_ID = sampleCanonicalId("document", "provider-document-case-plan");

export interface SampleReadOnlyConnectorOptions {
  readonly tenantBoundary?: string;
  readonly now?: () => string;
  readonly maxPages?: number;
  readonly scenarios?: readonly SampleConnectorScenario[];
}

export interface SampleConnectorScenario {
  readonly highWatermark: string;
  readonly subjectPages: readonly SampleProviderPage<SampleSubjectRecord>[];
  readonly resourcePages: readonly SampleProviderPage<SampleResourceRecord>[];
  readonly relationshipPages: readonly SampleProviderPage<SampleRelationshipRecord>[];
  readonly nativeGrantPagesByResource: Readonly<Record<CanonicalId, readonly SampleProviderPage<SampleNativeGrantRecord>[]>>;
}

export interface SampleProviderPage<T> {
  readonly items: readonly T[];
  readonly nextToken?: string;
  readonly retryAfterMs?: number;
}

export interface SampleSubjectRecord {
  readonly rawId: string;
  readonly kind: Extract<Subject["type"], "user" | "group" | "service_principal">;
  readonly safeDisplayName: string;
  readonly rawEmail?: string;
}

export interface SampleResourceRecord {
  readonly rawId: string;
  readonly kind: Extract<Resource["type"], "application" | "document">;
  readonly safeDisplayName: string;
  readonly rawParentId?: string;
  readonly deleted?: boolean;
}

export interface SampleRelationshipRecord {
  readonly rawSubjectId: string;
  readonly subjectKind: SampleEntityKind;
  readonly relation: string;
  readonly rawObjectId: string;
  readonly objectKind: SampleEntityKind;
}

export interface SampleNativeGrantRecord {
  readonly rawGrantId: string;
  readonly rawPrincipalId: string;
  readonly principalKind: Extract<NativePrincipalType, "user" | "group" | "service_principal">;
  readonly permission: string;
  readonly grantType: NativeGrant["grantType"];
  readonly inheritedFromRawResourceId?: string;
  readonly expiresAt?: string;
}

type SampleEntityKind = "user" | "group" | "service_principal" | "application" | "document";
type WarningScope = DiscoveryRunWarning["scope"];

export class SampleReadOnlyConnector implements ConnectorAdapter {
  id = SAMPLE_READONLY_CONNECTOR_ID;
  mode: ConnectorAdapter["mode"] = "read_only";
  provider = SAMPLE_READONLY_PROVIDER;
  tenantBoundary: string;
  requiredReadScopes = [...SAMPLE_READONLY_REQUIRED_READ_SCOPES];
  capabilities: ConnectorAdapter["capabilities"] = {
    supportsDiscovery: true,
    supportsProvisioning: false,
    supportsReconciliation: true,
    supportsDirectPermissions: true,
    supportsInheritedPermissions: true,
    supportsExternalUsers: false,
    supportsTimeBoundAccess: true
  };

  readonly #now: () => string;
  readonly #maxPages: number;
  readonly #scenarios: readonly SampleConnectorScenario[];
  #scenarioIndex = -1;
  #warnings: DiscoveryRunWarning[] = [];
  #warningKeys = new Set<string>();

  constructor(options: SampleReadOnlyConnectorOptions = {}) {
    const tenantBoundary = options.tenantBoundary ?? SAMPLE_READONLY_TENANT_BOUNDARY;
    assertExplicitTenantBoundary(tenantBoundary);
    this.tenantBoundary = tenantBoundary;
    this.#now = options.now ?? (() => sampleNow);
    this.#maxPages = options.maxPages ?? 10;
    const scenarios = options.scenarios ?? [createDefaultSampleScenario()];
    if (scenarios.length === 0) {
      throw new Error("SampleReadOnlyConnector requires at least one scenario.");
    }
    this.#scenarios = scenarios;
  }

  async discoverSubjects(): Promise<Subject[]> {
    // Each subject discovery starts the next synthetic provider snapshot; the
    // remaining discovery calls reuse that active snapshot to model one sync run.
    const scenario = this.#beginNextScenario();
    const records = this.#readPages("subjects", scenario.subjectPages);
    return records.map((record) => ({
      id: sampleCanonicalId(record.kind, record.rawId),
      type: record.kind,
      displayName: record.safeDisplayName,
      sourceSystem: this.id,
      lifecycleState: "active",
      identifiers: {
        sampleHash: sampleHash(record.rawId)
      },
      attributes: {
        templateRecord: true,
        redactedSource: "sample-provider"
      },
      version: "subject:v1",
      createdAt: this.#now(),
      lastSeenAt: this.#now()
    }));
  }

  async discoverResources(): Promise<Resource[]> {
    const scenario = this.#activeScenario();
    const records = this.#readPages("resources", scenario.resourcePages);
    return records.map((record) => {
      const resourceId = sampleCanonicalId(record.kind, record.rawId);
      if (record.deleted) {
        this.#warnOnce({
          code: "SAMPLE_TOMBSTONE_OBSERVED",
          message: "Sample connector observed a deleted provider object and emitted a tombstone record.",
          severity: "warning",
          scope: "resources",
          retryable: false,
          objectId: resourceId
        });
      }

      return {
        id: resourceId,
        type: record.kind,
        displayName: record.safeDisplayName,
        sourceSystem: this.id,
        ownerId: "user:sample-owner",
        dataStewardId: "user:sample-steward",
        technicalOwnerId: "user:sample-tech-owner",
        classification: "internal",
        lifecycleState: record.deleted ? "deleted" : "active",
        parentId: record.rawParentId ? sampleCanonicalId("application", record.rawParentId) : undefined,
        attributes: {
          sampleHash: sampleHash(record.rawId),
          templateRecord: true
        },
        version: "resource:v1",
        createdAt: this.#now(),
        lastSeenAt: this.#now()
      } satisfies Resource;
    });
  }

  async discoverRelationships(): Promise<RelationshipTuple[]> {
    const scenario = this.#activeScenario();
    const records = this.#readPages("relationships", scenario.relationshipPages);
    return records.map((record) => ({
      id: `relationship:sample:${sampleHash(`${record.rawSubjectId}:${record.relation}:${record.rawObjectId}`)}`,
      subjectId: sampleEntityId(record.subjectKind, record.rawSubjectId),
      relation: record.relation,
      objectId: sampleEntityId(record.objectKind, record.rawObjectId),
      sourceSystem: this.id,
      assertedAt: this.#now(),
      status: "active",
      attributes: {
        templateRecord: true
      },
      version: "tuple:v1",
      createdAt: this.#now()
    }));
  }

  async readCurrentAccess(resourceId: CanonicalId): Promise<NativeGrant[]> {
    const scenario = this.#activeScenario();
    const pages = scenario.nativeGrantPagesByResource[resourceId] ?? [];
    const records = this.#readPages("native_grants", pages);
    return records.map((record) => ({
      id: `native-grant:sample:${sampleHash(record.rawGrantId)}`,
      targetPlatform: this.id,
      targetObjectId: resourceId,
      subjectId: sampleEntityId(record.principalKind, record.rawPrincipalId),
      principalType: record.principalKind,
      nativePermission: record.permission,
      grantType: record.grantType,
      sourceConnectorId: this.id,
      status: "observed",
      observedAt: this.#now(),
      inheritedFromObjectId: record.inheritedFromRawResourceId
        ? sampleCanonicalId("application", record.inheritedFromRawResourceId)
        : undefined,
      expiresAt: record.expiresAt,
      attributes: {
        sampleGrantHash: sampleHash(record.rawGrantId),
        redacted: true
      },
      version: "native-grant:v1",
      createdAt: this.#now()
    }));
  }

  async testReadOnlyAccess(): Promise<ConnectorHealthCheck[]> {
    return [
      {
        name: "connector_registered",
        status: "pass",
        message: "Sample read-only connector template is registered for local tests."
      },
      {
        name: "read_only_mode",
        status: this.mode === "read_only" ? "pass" : "fail",
        message: "Sample connector must remain in read-only mode."
      },
      ...this.requiredReadScopes.map((scope) => ({
        name: `scope:${scope}`,
        status: "pass" as const,
        message: "Synthetic sample read scope is present.",
        evidence: {
          provider: this.provider,
          tenantBoundary: this.tenantBoundary,
          synthetic: true
        }
      }))
    ];
  }

  getDiscoveryMetadata(): ConnectorDiscoveryMetadata {
    const scenario = this.#metadataScenario();
    return {
      provider: this.provider,
      tenantBoundary: this.tenantBoundary,
      requiredReadScopes: this.requiredReadScopes,
      synthetic: true,
      warnings: [...this.#warnings],
      cursor: {
        startedFrom: samplePreviousCursor,
        next: sampleNextCursor,
        highWatermark: scenario.highWatermark,
        deletedObjectBehavior: "mark_deleted"
      }
    };
  }

  getSecurityReview(): ConnectorSecurityReview {
    return {
      connectorId: this.id,
      provider: this.provider,
      tenantBoundary: this.tenantBoundary,
      synthetic: true,
      identity: {
        kind: "synthetic",
        subject: `connector:${this.id}`,
        evidence: ["docs/connector-authoring-tutorial.md", "examples/connectors/sample-readonly-template.md"]
      },
      consent: {
        status: "synthetic",
        scopesApproved: this.requiredReadScopes,
        evidence: ["docs/connector-contract.md", "examples/connectors/sample-readonly-template.md"]
      },
      leastPrivilege: {
        requiredReadScopes: this.requiredReadScopes,
        forbiddenWriteScopes: [...SAMPLE_READONLY_FORBIDDEN_WRITE_SCOPES],
        scopeJustification: "The sample connector reads synthetic inventory and native grants without provider mutation."
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
        handling: "none",
        rotation: "not_applicable",
        evidence: ["adrs/0009-secret-management.md", "runbooks/compromised-connector-credential.md"]
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
    return createDryRunPlan(this.id, request, request.resourceId, this.#now());
  }

  async applyProvisioningChange(plan: ProvisioningPlan): Promise<ProvisioningPlan> {
    return {
      ...plan,
      status: "failed",
      actions: plan.actions.map((action) => ({
        ...action,
        status: "failed",
        verification: {
          ...action.verification,
          status: "failed",
          checkedAt: this.#now(),
          message: "Sample connector template does not execute provider writes."
        }
      }))
    };
  }

  async verifyProvisioningChange(plan: ProvisioningPlan): Promise<boolean> {
    void plan;
    return false;
  }

  async revokeAccess(nativeGrantId: CanonicalId): Promise<ProvisioningPlan> {
    return createRevocationPlan(this.id, nativeGrantId, this.#resourceIdForNativeGrant(nativeGrantId), this.#now());
  }

  async detectDrift(): Promise<DriftFinding[]> {
    return [];
  }

  async emitEvidence(events: AuditEvent[]): Promise<EvidenceExport> {
    const generatedAt = this.#now();
    const evidencePeriod = deriveEvidencePeriod(events, generatedAt);
    const auditIntegrity = verifyAuditChain(events, generatedAt);
    return finalizeEvidenceExport({
      exportId: `evidence:${this.id}`,
      framework: "nist-800-53",
      controls: ["AC-2", "AC-3", "AC-6", "AU-2"],
      periodStart: evidencePeriod.periodStart,
      periodEnd: evidencePeriod.periodEnd,
      generatedAt,
      evidenceTypes: ["connector_template", "discovery_runs", "native_grants", "audit_events"],
      sourceEventIds: events.map((event) => event.eventId),
      responsibleRole: "Connector Owner",
      format: "json",
      auditIntegrity,
      controlMappings: [
        {
          controlId: "AC-6",
          family: "AC",
          status: "implemented",
          implementationSummary: "Sample connector template demonstrates least-privilege read scopes and no provider writes.",
          evidenceTypes: ["connector_template"],
          sourceEventIds: events.map((event) => event.eventId),
          gaps: ["Live provider access requires a connector-specific security review."]
        }
      ],
      artifacts: [
        {
          name: "sample-readonly-template",
          type: "configuration_baseline",
          description: "Copyable read-only connector template with redacted synthetic fixtures.",
          eventCount: events.length,
          format: "json"
        }
      ],
      conmonMetrics: [
        {
          name: "sample_connector_events",
          value: events.length,
          unit: "count",
          source: this.id
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
        boundaryId: `boundary:${this.id}`,
        name: "Sample read-only connector template boundary",
        description: "Synthetic connector template boundary for local authoring and tests.",
        environment: "local_proof_point",
        liveTenantData: false,
        components: [
          {
            id: `component:connector:${this.id}`,
            name: "Sample read-only connector template",
            type: "connector",
            trustZone: "synthetic_provider",
            dataClassification: "synthetic",
            description: "Sample connector template that contains no live tenant data or provider secrets."
          }
        ],
        externalSystems: [this.provider],
        assumptions: ["All sample records are synthetic and raw provider identifiers are redacted before evidence export."],
        version: "system-boundary:v1"
      },
      dataFlows: [
        {
          id: `data-flow:${this.id}:readback`,
          name: "Sample connector read-only discovery",
          source: `component:connector:${this.id}`,
          destination: "component:api-runtime",
          dataTypes: ["synthetic_subjects", "synthetic_resources", "synthetic_native_grants"],
          protections: ["read_only", "redacted_identifiers", "synthetic_data_only"],
          liveTenantData: false
        }
      ],
      controlStatements: [
        {
          controlId: "AC-6",
          status: "implemented",
          statement: "The sample connector template defaults to least-privilege read-only behavior.",
          responsibleRole: "Connector Owner",
          reviewerRole: "Security Engineer",
          reviewedAt: this.#now(),
          evidenceTypes: ["connector_template"],
          sourceArtifactNames: ["sample-readonly-template"],
          gaps: ["Provider-specific access requires a separate review."]
        }
      ],
      accessReviews: [],
      exceptionRegister: [],
      operationalEvidence: [
        {
          id: `operational:${this.id}:template`,
          type: "configuration_baseline",
          status: "implemented",
          ownerRole: "Connector Owner",
          generatedAt: this.#now(),
          summary: "Sample connector template demonstrates read-only discovery, tombstones, warnings, and failed write hooks.",
          evidenceRefs: ["packages/connectors-sample-readonly/src/index.ts", "tests/connectors/sample-readonly.test.ts"],
          gaps: ["Replace synthetic fixtures with provider-specific least-privilege review before live connector access."]
        }
      ]
    });
  }

  #beginNextScenario(): SampleConnectorScenario {
    this.#scenarioIndex = Math.min(this.#scenarioIndex + 1, this.#scenarios.length - 1);
    this.#warnings = [];
    this.#warningKeys = new Set<string>();
    return this.#scenarios[this.#scenarioIndex]!;
  }

  #activeScenario(): SampleConnectorScenario {
    if (this.#scenarioIndex < 0) {
      return this.#beginNextScenario();
    }

    return this.#scenarios[this.#scenarioIndex]!;
  }

  #metadataScenario(): SampleConnectorScenario {
    return this.#scenarios[Math.max(this.#scenarioIndex, 0)]!;
  }

  #resourceIdForNativeGrant(nativeGrantId: CanonicalId): CanonicalId {
    const scenario = this.#activeScenario();

    for (const [resourceId, pages] of Object.entries(scenario.nativeGrantPagesByResource)) {
      for (const page of pages) {
        if (page.items.some((record) => `native-grant:sample:${sampleHash(record.rawGrantId)}` === nativeGrantId)) {
          return resourceId as CanonicalId;
        }
      }
    }

    throw new Error(`SampleReadOnlyConnector cannot resolve resource for native grant ${nativeGrantId}.`);
  }

  #readPages<T>(scope: WarningScope, pages: readonly SampleProviderPage<T>[]): T[] {
    const items: T[] = [];

    pages.slice(0, this.#maxPages).forEach((page, index) => {
      items.push(...page.items);

      if (page.nextToken) {
        this.#warnOnce({
          code: "SAMPLE_PAGINATION_OBSERVED",
          message: "Sample connector followed a provider page boundary and stored only redacted cursor metadata.",
          severity: "info",
          scope,
          retryable: false
        });
      }

      if (page.retryAfterMs !== undefined) {
        this.#warnOnce({
          code: "SAMPLE_THROTTLE_RETRIED",
          message: "Sample connector retried throttled readback without retaining request IDs or tokens.",
          severity: "warning",
          scope,
          retryable: true
        });
      }

      if (index === this.#maxPages - 1 && pages.length > this.#maxPages) {
        this.#warnOnce({
          code: "SAMPLE_PAGE_LIMIT_REACHED",
          message: "Sample connector stopped at the configured page limit and surfaced incomplete coverage.",
          severity: "warning",
          scope,
          retryable: true
        });
      }
    });

    return items;
  }

  #warnOnce(warning: DiscoveryRunWarning): void {
    const key = `${warning.code}:${warning.scope}:${warning.objectId ?? ""}`;
    if (this.#warningKeys.has(key)) {
      return;
    }

    this.#warningKeys.add(key);
    this.#warnings.push(warning);
  }
}

export function createSampleReadOnlyConnectorFromEnv(env: NodeJS.ProcessEnv = process.env): SampleReadOnlyConnector | undefined {
  if (env.REBAC_SAMPLE_READONLY_ENABLED !== "true") {
    return undefined;
  }

  const tenantBoundary = env.REBAC_SAMPLE_READONLY_TENANT_BOUNDARY;
  if (!tenantBoundary || !isExplicitTenantBoundary(tenantBoundary)) {
    return undefined;
  }

  return new SampleReadOnlyConnector({ tenantBoundary });
}

export function createDefaultSampleScenario(): SampleConnectorScenario {
  return {
    highWatermark: sampleHighWatermark,
    subjectPages: [
      {
        items: [
          {
            rawId: "provider-user-alice",
            kind: "user",
            safeDisplayName: "Sample Analyst",
            rawEmail: "alice@example.test"
          },
          {
            rawId: "provider-group-reviewers",
            kind: "group",
            safeDisplayName: "Sample Reviewers"
          }
        ],
        nextToken: "raw-subject-cursor-page-2"
      },
      {
        items: [
          {
            rawId: "provider-service-case-api",
            kind: "service_principal",
            safeDisplayName: "Sample Case API"
          }
        ],
        retryAfterMs: 250
      }
    ],
    resourcePages: [
      {
        items: [
          {
            rawId: "provider-app-case-review",
            kind: "application",
            safeDisplayName: "Sample Case Review App"
          },
          {
            rawId: "provider-document-case-plan",
            kind: "document",
            safeDisplayName: "Sample Case Plan",
            rawParentId: "provider-app-case-review"
          }
        ],
        nextToken: "raw-resource-cursor-page-2"
      },
      {
        items: [
          {
            rawId: "provider-document-old-plan",
            kind: "document",
            safeDisplayName: "Deleted Sample Plan",
            rawParentId: "provider-app-case-review",
            deleted: true
          }
        ]
      }
    ],
    relationshipPages: [
      {
        items: [
          {
            rawSubjectId: "provider-user-alice",
            subjectKind: "user",
            relation: "member_of",
            rawObjectId: "provider-group-reviewers",
            objectKind: "group"
          },
          {
            rawSubjectId: "provider-group-reviewers",
            subjectKind: "group",
            relation: "assigned_to",
            rawObjectId: "provider-app-case-review",
            objectKind: "application"
          },
          {
            rawSubjectId: "provider-app-case-review",
            subjectKind: "application",
            relation: "contains",
            rawObjectId: "provider-document-case-plan",
            objectKind: "document"
          }
        ]
      }
    ],
    nativeGrantPagesByResource: {
      [SAMPLE_APPLICATION_RESOURCE_ID]: [
        {
          items: [
            {
              rawGrantId: "provider-grant-reviewers-app-read",
              rawPrincipalId: "provider-group-reviewers",
              principalKind: "group",
              permission: "sample.app.read",
              grantType: "group"
            }
          ],
          nextToken: "raw-grant-cursor-page-2"
        },
        {
          items: [
            {
              rawGrantId: "provider-grant-service-app-read",
              rawPrincipalId: "provider-service-case-api",
              principalKind: "service_principal",
              permission: "sample.app.read",
              grantType: "direct",
              expiresAt: "2026-06-26T12:00:00.000Z"
            }
          ],
          retryAfterMs: 250
        }
      ],
      [SAMPLE_DOCUMENT_RESOURCE_ID]: [
        {
          items: [
            {
              rawGrantId: "provider-grant-reviewers-document-read",
              rawPrincipalId: "provider-group-reviewers",
              principalKind: "group",
              permission: "sample.document.read",
              grantType: "inherited",
              inheritedFromRawResourceId: "provider-app-case-review"
            }
          ]
        }
      ]
    }
  };
}

export function createSampleScenarioWithoutServiceGrant(): SampleConnectorScenario {
  const defaultScenario = createDefaultSampleScenario();
  return {
    ...defaultScenario,
    highWatermark: sampleSecondHighWatermark,
    nativeGrantPagesByResource: {
      ...defaultScenario.nativeGrantPagesByResource,
      [SAMPLE_APPLICATION_RESOURCE_ID]: [
        {
          items: [
            {
              rawGrantId: "provider-grant-reviewers-app-read",
              rawPrincipalId: "provider-group-reviewers",
              principalKind: "group",
              permission: "sample.app.read",
              grantType: "group"
            }
          ]
        }
      ]
    }
  };
}

function createDryRunPlan(
  connectorId: string,
  request: DecisionResult,
  targetObjectId: CanonicalId,
  createdAt: string
): ProvisioningPlan {
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
          reason: "Reverse provider state if a copied connector later enables enforcement and verification fails.",
          status: "planned",
          idempotencyKey: `compensate:${connectorId}:${request.subjectId}:${request.action}:${request.resourceId}:${request.policyVersion}`
        }
      }
    ],
    version: "plan:v1",
    createdAt
  };
}

function createRevocationPlan(
  connectorId: string,
  nativeGrantId: CanonicalId,
  resourceId: CanonicalId,
  createdAt: string
): ProvisioningPlan {
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
    createdAt
  };
}

function deriveEvidencePeriod(events: AuditEvent[], now: string): Pick<EvidenceExport, "periodStart" | "periodEnd"> {
  const occurredAt = events.map((event) => event.occurredAt).sort();

  return {
    periodStart: occurredAt.at(0) ?? now,
    periodEnd: occurredAt.at(-1) ?? now
  };
}

function sampleEntityId(kind: SampleEntityKind, rawId: string): CanonicalId {
  return sampleCanonicalId(kind, rawId);
}

function sampleCanonicalId(prefix: string, rawId: string): CanonicalId {
  return `${prefix}:sample:${sampleHash(rawId)}`;
}

function sampleHash(value: string): string {
  return sha256({ sampleConnectorValue: value }).slice(0, 16);
}

function assertExplicitTenantBoundary(tenantBoundary: string): void {
  if (!isExplicitTenantBoundary(tenantBoundary)) {
    throw new Error("Sample connector requires an explicit tenant boundary before it can be instantiated.");
  }
}

function isExplicitTenantBoundary(tenantBoundary: string): boolean {
  return tenantBoundary.trim().length > 0 && tenantBoundary !== "synthetic:unknown";
}
