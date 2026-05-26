import {
  attachEvidenceIntegrityManifest,
  verifyAuditChain,
  type AuditEvent,
  type ConnectorAdapter,
  type ConnectorDiscoveryMetadata,
  type ConnectorHealthCheck,
  type ConnectorSecurityReview,
  type DecisionResult,
  type DiscoveryRunWarning,
  type DriftFinding,
  type EvidenceExport,
  type NativeGrant,
  type ProvisioningPlan,
  type RelationshipTuple,
  type Resource,
  type Subject
} from "@access-kit/core";

const now = "2026-05-21T17:00:00.000Z";

interface SyntheticConnectorSeed {
  id: string;
  provider: string;
  tenantBoundary: string;
  requiredReadScopes: string[];
  forbiddenWriteScopes: string[];
  scopeJustification: string;
  supportsExternalUsers: boolean;
  supportsTimeBoundAccess: boolean;
  subjects: Subject[];
  resources: Resource[];
  relationships: RelationshipTuple[];
  grantsByResource: Record<string, NativeGrant[]>;
  warnings?: DiscoveryRunWarning[];
  cursor?: ConnectorDiscoveryMetadata["cursor"];
  driftFindings?: DriftFinding[];
}

abstract class SyntheticReadOnlyConnector implements ConnectorAdapter {
  mode: ConnectorAdapter["mode"] = "read_only";
  readonly provider: string;
  readonly tenantBoundary: string;
  readonly requiredReadScopes: string[];
  readonly capabilities: ConnectorAdapter["capabilities"];

  constructor(readonly seed: SyntheticConnectorSeed) {
    this.provider = seed.provider;
    this.tenantBoundary = seed.tenantBoundary;
    this.requiredReadScopes = seed.requiredReadScopes;
    this.capabilities = {
      supportsDiscovery: true,
      supportsProvisioning: false,
      supportsReconciliation: true,
      supportsDirectPermissions: true,
      supportsInheritedPermissions: true,
      supportsExternalUsers: seed.supportsExternalUsers,
      supportsTimeBoundAccess: seed.supportsTimeBoundAccess
    };
  }

  get id(): string {
    return this.seed.id;
  }

  async discoverSubjects(): Promise<Subject[]> {
    return this.seed.subjects;
  }

  async discoverResources(): Promise<Resource[]> {
    return this.seed.resources;
  }

  async discoverRelationships(): Promise<RelationshipTuple[]> {
    return this.seed.relationships;
  }

  async readCurrentAccess(resourceId: string): Promise<NativeGrant[]> {
    return this.seed.grantsByResource[resourceId] ?? [];
  }

  async testReadOnlyAccess(): Promise<ConnectorHealthCheck[]> {
    return [
      {
        name: "connector_registered",
        status: "pass",
        message: `${this.id} is registered with synthetic read-only credentials.`
      },
      {
        name: "read_only_mode",
        status: this.mode === "read_only" ? "pass" : "fail",
        message: "Connector must remain in read-only mode during Phase 2."
      },
      ...this.requiredReadScopes.map((scope) => ({
        name: `scope:${scope}`,
        status: "pass" as const,
        message: "Synthetic read scope is present.",
        evidence: {
          provider: this.provider,
          tenantBoundary: this.tenantBoundary,
          synthetic: true
        }
      }))
    ];
  }

  getDiscoveryMetadata(): ConnectorDiscoveryMetadata {
    return {
      provider: this.provider,
      tenantBoundary: this.tenantBoundary,
      requiredReadScopes: this.requiredReadScopes,
      synthetic: true,
      warnings: this.seed.warnings ?? [],
      cursor: this.seed.cursor
    };
  }

  getSecurityReview(): ConnectorSecurityReview {
    return createSyntheticSecurityReview({
      connectorId: this.id,
      provider: this.provider,
      tenantBoundary: this.tenantBoundary,
      requiredReadScopes: this.requiredReadScopes,
      forbiddenWriteScopes: this.seed.forbiddenWriteScopes,
      scopeJustification: this.seed.scopeJustification,
      deletion: this.seed.cursor?.deletedObjectBehavior ?? "unsupported",
      controlledSyntheticOnly: false,
      rollbackRequired: true
    });
  }

  async planProvisioningChange(request: DecisionResult): Promise<ProvisioningPlan> {
    return createDryRunPlan(request, this.id, request.resourceId);
  }

  async applyProvisioningChange(plan: ProvisioningPlan): Promise<ProvisioningPlan> {
    return { ...plan, status: "failed" };
  }

  async verifyProvisioningChange(plan: ProvisioningPlan): Promise<boolean> {
    void plan;
    return false;
  }

  async revokeAccess(nativeGrantId: string): Promise<ProvisioningPlan> {
    return createRevocationPlan(this.id, nativeGrantId, "resource:unknown");
  }

  async detectDrift(): Promise<DriftFinding[]> {
    return this.seed.driftFindings ?? [];
  }

  async emitEvidence(events: AuditEvent[]): Promise<EvidenceExport> {
    return createEvidence(this.id, events);
  }
}

export class MockConnector implements ConnectorAdapter {
  id = "mock";
  mode: ConnectorAdapter["mode"] = "read_only";
  provider = "mock";
  tenantBoundary = "synthetic:local";
  requiredReadScopes = ["synthetic:mock.read"];
  capabilities = {
    supportsDiscovery: true,
    supportsProvisioning: true,
    supportsReconciliation: true,
    supportsDirectPermissions: true,
    supportsInheritedPermissions: true,
    supportsExternalUsers: true,
    supportsTimeBoundAccess: true
  };

  async discoverSubjects(): Promise<Subject[]> {
    return [
      subject("user:alice", "Alice Example", "mock", "user", { employeeId: "E-0001" }),
      subject("group:case-team", "Case Team", "mock", "group", { groupId: "G-CASE" }),
      subject("user:external", "External Reviewer", "mock", "user", { externalId: "EXT-0001" }, { external: true })
    ];
  }

  async discoverResources(): Promise<Resource[]> {
    return [
      resource("workspace:case", "Case Workspace", "workspace", "mock"),
      resource("document:case-plan", "Case Plan", "document", "mock", "workspace:case")
    ];
  }

  async discoverRelationships(): Promise<RelationshipTuple[]> {
    return [
      relationship("mock:alice-case-team", "user:alice", "member_of", "group:case-team", "mock"),
      relationship("mock:case-team-workspace", "group:case-team", "contributor_to", "workspace:case", "mock"),
      relationship("mock:workspace-document", "workspace:case", "contains", "document:case-plan", "mock")
    ];
  }

  async readCurrentAccess(resourceId: string): Promise<NativeGrant[]> {
    if (resourceId === "workspace:case") {
      return [
        nativeGrant(this.id, resourceId, "group:case-team", "group", "read", "direct", {
          attributes: { source: "synthetic_group_assignment" }
        })
      ];
    }

    return [
      nativeGrant(this.id, resourceId, "user:alice", "user", "read", "direct"),
      nativeGrant(this.id, resourceId, "group:case-team", "group", "read", "inherited", {
        inheritedFromObjectId: "workspace:case"
      }),
      nativeGrant(this.id, resourceId, "user:external", "external_user", "read", "direct", {
        expiresAt: "2026-06-21T17:00:00.000Z",
        attributes: { external: true }
      })
    ];
  }

  async testReadOnlyAccess(): Promise<ConnectorHealthCheck[]> {
    return [
      { name: "connector_registered", status: "pass", message: "Mock connector is registered." },
      { name: "read_only_mode", status: "pass", message: "Mock connector starts in read-only mode." },
      { name: "scope:synthetic:mock.read", status: "pass", message: "Synthetic read scope is present." },
      { name: "provisioning_deferred", status: "warn", message: "Mock dry-run planning exists; live enforcement remains disabled." }
    ];
  }

  getDiscoveryMetadata(): ConnectorDiscoveryMetadata {
    return {
      provider: "mock",
      tenantBoundary: "synthetic:local",
      requiredReadScopes: this.requiredReadScopes,
      synthetic: true,
      warnings: [
        {
          code: "MOCK_PERSONAL_DRAFT_SKIPPED",
          message: "A synthetic personal draft was skipped because it is outside the governed resource boundary.",
          severity: "warning",
          scope: "resources",
          retryable: false,
          objectId: "document:personal-draft"
        }
      ],
      cursor: {
        startedFrom: "cursor:mock:previous",
        highWatermark: "cursor:mock:20260521t170000000z",
        deletedObjectBehavior: "mark_deleted"
      }
    };
  }

  getSecurityReview(): ConnectorSecurityReview {
    return createSyntheticSecurityReview({
      connectorId: this.id,
      provider: this.provider,
      tenantBoundary: this.tenantBoundary,
      requiredReadScopes: this.requiredReadScopes,
      forbiddenWriteScopes: ["synthetic:mock.write"],
      scopeJustification: "The mock connector is limited to synthetic local readback and controlled synthetic enforcement proof points.",
      deletion: "mark_deleted",
      controlledSyntheticOnly: true,
      rollbackRequired: true
    });
  }

  async planProvisioningChange(request: DecisionResult): Promise<ProvisioningPlan> {
    return createDryRunPlan(request, this.id, request.resourceId);
  }

  async applyProvisioningChange(plan: ProvisioningPlan): Promise<ProvisioningPlan> {
    return { ...plan, status: "applied" };
  }

  async verifyProvisioningChange(plan: ProvisioningPlan): Promise<boolean> {
    void plan;
    return true;
  }

  async revokeAccess(nativeGrantId: string): Promise<ProvisioningPlan> {
    return {
      id: `plan:revoke:${nativeGrantId}`,
      connectorId: this.id,
      subjectId: "user:alice",
      resourceId: "document:case-plan",
      action: "read",
      mode: "dry_run",
      status: "planned",
      actions: [
        {
          actionId: `action:revoke:${nativeGrantId}`,
          operation: "revoke",
          targetPlatform: this.id,
          targetObjectId: "document:case-plan",
          requestedState: { nativeGrantId, status: "revoked" },
          dryRun: true,
          idempotencyKey: `revoke:${nativeGrantId}`,
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
            idempotencyKey: `compensate:grant:${nativeGrantId}`
          }
        }
      ],
      version: "plan:v1",
      createdAt: now
    };
  }

  async detectDrift(): Promise<DriftFinding[]> {
    return [
      {
        id: "drift:001",
        resourceId: "document:case-plan",
        subjectId: "user:external",
        nativeGrantId: "native-grant:mock:document:case-plan:user:external:read:direct",
        nativeAccess: "read",
        intendedAccess: "none",
        severity: "high",
        lifecycleState: "open",
        ownerId: "role:security-operations",
        assigneeId: "role:security-engineer",
        detectedAt: now,
        sourceConnectorId: this.id,
        recommendedAction: "revoke",
        status: "open",
        scheduledReconciliation: {
          cadence: "manual",
          scheduledAt: now,
          gracePeriodHours: 0,
          overdue: false
        },
        hookEvidence: [],
        remediation: {},
        autoRepairPolicy: {
          enabled: false,
          allowedActions: ["revoke"],
          maxSeverity: "high",
          requireApproval: true,
          requireConnectorReadiness: true,
          liveProviderWrites: false,
          reason: "Mock drift findings require approval before any remediation and never auto-repair live providers."
        },
        version: "drift:v1",
        createdAt: now
      }
    ];
  }

  async emitEvidence(events: AuditEvent[]): Promise<EvidenceExport> {
    return createEvidence(this.id, events);
  }
}

export class SyntheticEntraConnector extends SyntheticReadOnlyConnector {
  constructor() {
    super({
      id: "entra-readonly",
      provider: "entra-id",
      tenantBoundary: "synthetic:entra:tenant",
      requiredReadScopes: ["synthetic:directory.read", "synthetic:appRoleAssignment.read"],
      forbiddenWriteScopes: ["synthetic:directory.write", "synthetic:appRoleAssignment.write"],
      scopeJustification: "Directory and app-role assignment readback are enough to inventory synthetic Entra users, groups, service principals, and app assignments.",
      supportsExternalUsers: true,
      supportsTimeBoundAccess: true,
      subjects: [
        subject("user:entra-analyst", "Synthetic Entra Analyst", "entra-readonly", "user", { objectId: "synthetic-user-001" }),
        subject("group:entra-case-reviewers", "Synthetic Case Reviewers", "entra-readonly", "group", { objectId: "synthetic-group-001" }),
        subject("service-principal:case-api", "Synthetic Case API", "entra-readonly", "service_principal", { appId: "synthetic-app-001" })
      ],
      resources: [resource("application:case-portal", "Case Portal", "application", "entra-readonly")],
      relationships: [
        relationship("entra:analyst-reviewers", "user:entra-analyst", "member_of", "group:entra-case-reviewers", "entra-readonly"),
        relationship("entra:reviewers-portal", "group:entra-case-reviewers", "assigned_to", "application:case-portal", "entra-readonly")
      ],
      grantsByResource: {
        "application:case-portal": [
          nativeGrant("entra-readonly", "application:case-portal", "group:entra-case-reviewers", "group", "appRole:reader", "group", {
            attributes: { assignmentType: "app_role" }
          }),
          nativeGrant("entra-readonly", "application:case-portal", "service-principal:case-api", "service_principal", "appRole:service", "direct")
        ]
      },
      cursor: {
        startedFrom: "cursor:entra:previous",
        next: "cursor:entra:next",
        highWatermark: "cursor:entra:20260521t170000000z",
        deletedObjectBehavior: "mark_deleted"
      }
    });
  }
}

export class SyntheticSharePointConnector extends SyntheticReadOnlyConnector {
  constructor() {
    super({
      id: "sharepoint-readonly",
      provider: "sharepoint",
      tenantBoundary: "synthetic:sharepoint:tenant",
      requiredReadScopes: ["synthetic:sites.read", "synthetic:permissions.read"],
      forbiddenWriteScopes: ["synthetic:sites.write", "synthetic:permissions.write"],
      scopeJustification: "Sites and permissions readback are enough to inventory synthetic SharePoint resources and observed grants.",
      supportsExternalUsers: true,
      supportsTimeBoundAccess: true,
      subjects: [
        subject("group:sp-case-members", "Synthetic SharePoint Case Members", "sharepoint-readonly", "group", { groupId: "synthetic-sp-group" }),
        subject("user:sp-external-reviewer", "Synthetic External Reviewer", "sharepoint-readonly", "user", { externalId: "synthetic-ext-001" }, { external: true })
      ],
      resources: [
        resource("sharepoint-site:case-records", "Case Records Site", "sharepoint_site", "sharepoint-readonly"),
        resource("folder:case-records-evidence", "Evidence Folder", "folder", "sharepoint-readonly", "sharepoint-site:case-records"),
        resource("document:case-records-plan", "Case Records Plan", "document", "sharepoint-readonly", "folder:case-records-evidence")
      ],
      relationships: [
        relationship("sp:site-folder", "sharepoint-site:case-records", "contains", "folder:case-records-evidence", "sharepoint-readonly"),
        relationship("sp:folder-document", "folder:case-records-evidence", "contains", "document:case-records-plan", "sharepoint-readonly")
      ],
      grantsByResource: {
        "sharepoint-site:case-records": [
          nativeGrant("sharepoint-readonly", "sharepoint-site:case-records", "group:sp-case-members", "group", "read", "direct")
        ],
        "folder:case-records-evidence": [
          nativeGrant("sharepoint-readonly", "folder:case-records-evidence", "group:sp-case-members", "group", "read", "inherited", {
            inheritedFromObjectId: "sharepoint-site:case-records"
          })
        ],
        "document:case-records-plan": [
          nativeGrant("sharepoint-readonly", "document:case-records-plan", "group:sp-case-members", "group", "read", "inherited", {
            inheritedFromObjectId: "folder:case-records-evidence"
          }),
          nativeGrant("sharepoint-readonly", "document:case-records-plan", "user:sp-external-reviewer", "external_user", "read", "direct", {
            expiresAt: "2026-05-28T17:00:00.000Z",
            attributes: { external: true, invitationState: "accepted" }
          })
        ]
      },
      warnings: [
        {
          code: "SHAREPOINT_PERSONAL_SITE_SKIPPED",
          message: "Synthetic personal site collection was skipped because it is outside the governed boundary.",
          severity: "warning",
          scope: "resources",
          retryable: false,
          objectId: "sharepoint-site:personal"
        }
      ],
      cursor: {
        startedFrom: "cursor:sharepoint:previous",
        highWatermark: "cursor:sharepoint:20260521t170000000z",
        deletedObjectBehavior: "mark_deleted"
      }
    });
  }
}

export class SyntheticAwsConnector extends SyntheticReadOnlyConnector {
  constructor() {
    super({
      id: "aws-readonly",
      provider: "aws",
      tenantBoundary: "synthetic:aws:organization",
      requiredReadScopes: ["synthetic:iam.read", "synthetic:organizations.read"],
      forbiddenWriteScopes: ["synthetic:iam.write", "synthetic:organizations.write"],
      scopeJustification: "IAM and Organizations readback are enough to inventory synthetic AWS accounts, roles, and assignment evidence.",
      supportsExternalUsers: false,
      supportsTimeBoundAccess: true,
      subjects: [
        subject("service-principal:aws-audit-role", "Synthetic AWS Audit Role", "aws-readonly", "service_principal", { roleId: "synthetic-role-001" }),
        subject("group:aws-case-operators", "Synthetic AWS Case Operators", "aws-readonly", "group", { groupId: "synthetic-aws-group" })
      ],
      resources: [
        resource("aws-account:case-prod", "Case Production Account", "aws_account", "aws-readonly"),
        resource("aws-role:case-readonly", "Case Readonly Role", "aws_role", "aws-readonly", "aws-account:case-prod")
      ],
      relationships: [
        relationship("aws:account-role", "aws-account:case-prod", "contains", "aws-role:case-readonly", "aws-readonly"),
        relationship("aws:operators-role", "group:aws-case-operators", "assumable", "aws-role:case-readonly", "aws-readonly")
      ],
      grantsByResource: {
        "aws-account:case-prod": [],
        "aws-role:case-readonly": [
          nativeGrant("aws-readonly", "aws-role:case-readonly", "group:aws-case-operators", "group", "sts:AssumeRole", "group", {
            expiresAt: "2026-06-21T17:00:00.000Z"
          }),
          nativeGrant("aws-readonly", "aws-role:case-readonly", "service-principal:aws-audit-role", "service_principal", "iam:ReadOnlyAccess", "direct")
        ]
      },
      warnings: [
        {
          code: "AWS_ORGANIZATION_PAGE_RETRIED",
          message: "Synthetic Organizations page was retried before readback completed.",
          severity: "info",
          scope: "connector",
          retryable: true
        }
      ],
      cursor: {
        startedFrom: "cursor:aws:previous",
        next: "cursor:aws:next",
        highWatermark: "cursor:aws:20260521t170000000z",
        deletedObjectBehavior: "unsupported"
      }
    });
  }
}

interface SyntheticSecurityReviewInput {
  connectorId: string;
  provider: string;
  tenantBoundary: string;
  requiredReadScopes: string[];
  forbiddenWriteScopes: string[];
  scopeJustification: string;
  deletion: ConnectorSecurityReview["operations"]["deletion"];
  controlledSyntheticOnly: boolean;
  rollbackRequired: boolean;
}

function createSyntheticSecurityReview(input: SyntheticSecurityReviewInput): ConnectorSecurityReview {
  return {
    connectorId: input.connectorId,
    provider: input.provider,
    tenantBoundary: input.tenantBoundary,
    synthetic: true,
    identity: {
      kind: "synthetic",
      subject: `connector:${input.connectorId}`,
      evidence: ["docs/connector-contract.md", "adrs/0006-connector-plugin-architecture.md"]
    },
    consent: {
      status: "synthetic",
      scopesApproved: input.requiredReadScopes,
      evidence: ["docs/connector-contract.md", "docs/system-context-and-boundary.md"]
    },
    leastPrivilege: {
      requiredReadScopes: input.requiredReadScopes,
      forbiddenWriteScopes: input.forbiddenWriteScopes,
      scopeJustification: input.scopeJustification
    },
    operations: {
      pagination: "required",
      throttling: "required",
      deletion: input.deletion,
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
      controlledSyntheticOnly: input.controlledSyntheticOnly,
      readinessRequired: true,
      rollbackRequired: input.rollbackRequired,
      emergencyRevocationRequired: true,
      monitoringRequired: true
    }
  };
}

function subject(
  id: string,
  displayName: string,
  sourceSystem: string,
  type: Subject["type"],
  identifiers: Record<string, string>,
  attributes?: Subject["attributes"]
): Subject {
  return {
    id,
    type,
    displayName,
    sourceSystem,
    lifecycleState: "active",
    identifiers,
    attributes,
    version: "subject:v1",
    createdAt: now,
    lastSeenAt: now
  };
}

function resource(
  id: string,
  displayName: string,
  type: Resource["type"],
  sourceSystem: string,
  parentId?: string
): Resource {
  return {
    id,
    type,
    displayName,
    sourceSystem,
    ownerId: "user:owner",
    dataStewardId: "user:steward",
    technicalOwnerId: "user:tech-owner",
    classification: "internal",
    lifecycleState: "active",
    parentId,
    version: "resource:v1",
    createdAt: now,
    lastSeenAt: now
  };
}

function relationship(idSuffix: string, subjectId: string, relation: string, objectId: string, sourceSystem: string): RelationshipTuple {
  return {
    id: `relationship:${idSuffix}`,
    subjectId,
    relation,
    objectId,
    sourceSystem,
    assertedAt: now,
    status: "active",
    version: "tuple:v1",
    createdAt: now
  };
}

function nativeGrant(
  sourceConnectorId: string,
  targetObjectId: string,
  subjectId: string,
  principalType: NativeGrant["principalType"],
  nativePermission: string,
  grantType: NativeGrant["grantType"],
  options: Pick<NativeGrant, "inheritedFromObjectId" | "expiresAt" | "attributes"> = {}
): NativeGrant {
  return {
    id: `native-grant:${sourceConnectorId}:${targetObjectId}:${subjectId}:${nativePermission}:${grantType}`.replaceAll(/[^a-z0-9_:-]/gi, "-").toLowerCase(),
    targetPlatform: sourceConnectorId,
    targetObjectId,
    subjectId,
    principalType,
    nativePermission,
    grantType,
    sourceConnectorId,
    status: "observed",
    observedAt: now,
    inheritedFromObjectId: options.inheritedFromObjectId,
    expiresAt: options.expiresAt,
    attributes: options.attributes,
    version: "native-grant:v1",
    createdAt: now
  };
}

function createDryRunPlan(request: DecisionResult, connectorId: string, targetObjectId: string): ProvisioningPlan {
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

function createRevocationPlan(connectorId: string, nativeGrantId: string, resourceId: string): ProvisioningPlan {
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

function createEvidence(connectorId: string, events: AuditEvent[]): EvidenceExport {
  const auditIntegrity = verifyAuditChain(events, now);
  return attachEvidenceIntegrityManifest({
    exportId: `evidence:${connectorId}`,
    framework: "nist-800-53",
    controls: ["AC-2", "AC-3", "AU-2"],
    periodStart: "2026-05-01T00:00:00.000Z",
    periodEnd: "2026-05-31T23:59:59.000Z",
    generatedAt: now,
    evidenceTypes: ["audit_events", "decision_logs", "provisioning_plans", "discovery_runs", "audit_integrity", "control_mappings"],
    sourceEventIds: events.map((event) => event.eventId),
    responsibleRole: "ISSO",
    format: "json",
    auditIntegrity,
    controlMappings: [
      {
        controlId: "AU-2",
        family: "AU",
        status: events.length > 0 ? "implemented" : "partially_implemented",
        implementationSummary: "Connector evidence includes audit event identifiers emitted by the local control plane.",
        evidenceTypes: ["audit_events"],
        sourceEventIds: events.map((event) => event.eventId),
        gaps: events.length > 0 ? [] : ["No source audit events were provided to the connector evidence hook."]
      }
    ],
    artifacts: [
      {
        name: "connector-audit-events",
        type: "audit_events",
        description: "Connector-scoped audit events prepared for evidence packaging.",
        eventCount: events.length,
        format: "json"
      }
    ],
    conmonMetrics: [
      {
        name: "connector_evidence_events",
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
      description: "Synthetic connector evidence boundary for local proof-point packaging.",
      environment: "local_proof_point",
      liveTenantData: false,
      components: [
        {
          id: `component:connector:${connectorId}`,
          name: `${connectorId} connector`,
          type: "connector",
          trustZone: connectorId === "mock" ? "local_runtime" : "synthetic_provider",
          dataClassification: "synthetic",
          description: "Synthetic connector adapter used for local evidence packaging."
        }
      ],
      externalSystems: [connectorId],
      assumptions: ["Connector evidence is synthetic and contains no tenant identifiers or secrets."],
      version: "system-boundary:v1"
    },
    dataFlows: [
      {
        id: `data-flow:${connectorId}:evidence`,
        name: `${connectorId} connector evidence emission`,
        source: `component:connector:${connectorId}`,
        destination: "component:api-runtime",
        dataTypes: ["connector_audit_events"],
        protections: ["synthetic_data_only", "payload_hashes"],
        liveTenantData: false
      }
    ],
    controlStatements: [
      {
        controlId: "AU-2",
        status: events.length > 0 ? "implemented" : "partially_implemented",
        statement: "Connector evidence includes audit event identifiers emitted by the local control plane.",
        responsibleRole: "ISSO",
        reviewerRole: "Security Control Assessor",
        reviewedAt: now,
        evidenceTypes: ["audit_events"],
        sourceArtifactNames: ["connector-audit-events"],
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
        summary: "Synthetic connector configuration is represented as local proof-point evidence.",
        evidenceRefs: ["packages/connectors-mock/src/index.ts"],
        gaps: ["Live connector authorization, consent, and tenant-boundary review remain future production work."]
      }
    ]
  });
}
