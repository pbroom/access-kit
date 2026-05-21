import type {
  AuditEvent,
  ConnectorAdapter,
  DecisionResult,
  DriftFinding,
  EvidenceExport,
  NativeGrant,
  ProvisioningPlan,
  RelationshipTuple,
  Resource,
  Subject
} from "../../core/src/index.js";

const now = "2026-05-21T17:00:00.000Z";

export class MockConnector implements ConnectorAdapter {
  id = "mock";
  mode = "dry_run" as const;
  capabilities = {
    supportsDiscovery: true,
    supportsProvisioning: true,
    supportsReconciliation: true,
    supportsDirectPermissions: true,
    supportsInheritedPermissions: true,
    supportsExternalUsers: true,
    supportsTimeBoundAccess: false
  };

  async discoverSubjects(): Promise<Subject[]> {
    return [
      {
        id: "user:alice",
        type: "user",
        displayName: "Alice Example",
        sourceSystem: "mock",
        lifecycleState: "active",
        identifiers: { employeeId: "E-0001" },
        version: "subject:v1",
        createdAt: now,
        lastSeenAt: now
      }
    ];
  }

  async discoverResources(): Promise<Resource[]> {
    return [
      {
        id: "document:case-plan",
        type: "document",
        displayName: "Case Plan",
        sourceSystem: "mock",
        ownerId: "user:owner",
        dataStewardId: "user:steward",
        technicalOwnerId: "user:tech-owner",
        classification: "internal",
        lifecycleState: "active",
        parentId: "workspace:case",
        version: "resource:v1",
        createdAt: now,
        lastSeenAt: now
      }
    ];
  }

  async discoverRelationships(): Promise<RelationshipTuple[]> {
    return [
      {
        id: "relationship:alice-case-team",
        subjectId: "user:alice",
        relation: "member_of",
        objectId: "group:case-team",
        sourceSystem: "mock",
        assertedAt: now,
        status: "active",
        version: "tuple:v1",
        createdAt: now
      },
      {
        id: "relationship:case-team-workspace",
        subjectId: "group:case-team",
        relation: "contributor_to",
        objectId: "workspace:case",
        sourceSystem: "mock",
        assertedAt: now,
        status: "active",
        version: "tuple:v1",
        createdAt: now
      },
      {
        id: "relationship:workspace-document",
        subjectId: "workspace:case",
        relation: "contains",
        objectId: "document:case-plan",
        sourceSystem: "mock",
        assertedAt: now,
        status: "active",
        version: "tuple:v1",
        createdAt: now
      }
    ];
  }

  async readCurrentAccess(resourceId: string): Promise<NativeGrant[]> {
    return [
      {
        id: `native-grant:${resourceId}:alice`,
        targetPlatform: "mock",
        targetObjectId: resourceId,
        subjectId: "user:alice",
        nativePermission: "read",
        sourceConnectorId: this.id,
        status: "observed",
        observedAt: now,
        version: "native-grant:v1",
        createdAt: now
      }
    ];
  }

  async planProvisioningChange(request: DecisionResult): Promise<ProvisioningPlan> {
    return {
      id: `plan:${request.decisionId}`,
      sourceDecisionId: request.decisionId,
      subjectId: request.subjectId,
      resourceId: request.resourceId,
      action: request.action,
      mode: "dry_run",
      status: "planned",
      actions: [
        {
          actionId: `action:${request.decisionId}`,
          operation: request.decision === "allow" ? "grant" : "revoke",
          targetPlatform: "mock",
          targetObjectId: request.resourceId,
          requestedState: { subjectId: request.subjectId, permission: request.action },
          dryRun: true,
          idempotencyKey: `${request.subjectId}:${request.action}:${request.resourceId}:${request.policyVersion}`
        }
      ],
      version: "plan:v1",
      createdAt: now
    };
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
      subjectId: "user:alice",
      resourceId: "document:case-plan",
      action: "read",
      mode: "dry_run",
      status: "planned",
      actions: [
        {
          actionId: `action:revoke:${nativeGrantId}`,
          operation: "revoke",
          targetPlatform: "mock",
          targetObjectId: "document:case-plan",
          requestedState: { nativeGrantId, status: "revoked" },
          dryRun: true,
          idempotencyKey: `revoke:${nativeGrantId}`
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
        nativeAccess: "owner",
        intendedAccess: "none",
        severity: "high",
        detectedAt: now,
        sourceConnectorId: this.id,
        recommendedAction: "revoke",
        status: "open",
        version: "drift:v1",
        createdAt: now
      }
    ];
  }

  async emitEvidence(events: AuditEvent[]): Promise<EvidenceExport> {
    return {
      exportId: "evidence:mock",
      framework: "nist-800-53",
      controls: ["AC-2", "AC-3", "AU-2"],
      periodStart: "2026-05-01T00:00:00.000Z",
      periodEnd: "2026-05-31T23:59:59.000Z",
      generatedAt: now,
      evidenceTypes: ["audit_events", "decision_logs", "provisioning_plans"],
      sourceEventIds: events.map((event) => event.eventId),
      responsibleRole: "ISSO",
      format: "json"
    };
  }
}
