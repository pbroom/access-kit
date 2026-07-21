import {
  buildAccessReviewGovernance,
  finalizeEvidenceExport,
  sourceEventIdsForAccessReview,
  stableStringify,
  verifyEvidenceExport,
  type AccessReviewCampaign,
  type AccessReviewEvidence,
  type AccessReviewGovernanceRecords,
  type AuditEvent,
  type AuditEventExport,
  type AuditEventExportTarget,
  type AuditIntegrityReport,
  type ConMonMetric,
  type ControlImplementationStatement,
  type DataFlowEvidence,
  type EvidenceArtifact,
  type EvidenceControlMapping,
  type EvidenceExport,
  type EvidenceExportFormat,
  type EvidenceFramework,
  type EvidenceVerificationReport,
  type ExceptionRecord,
  type ExceptionRequest,
  type GovernanceFinding,
  type PoamItem,
  type SystemBoundaryEvidence
} from "@access-kit/core";
import type { RebacLocalApp } from "./runtime-app.js";
import {
  buildEvidenceArtifacts,
  buildOperationalEvidence,
  getControlImplementationDefinition
} from "./runtime-evidence.js";
import { asJsonRecord, compactTimestamp } from "./runtime-shared.js";
import {
  authoritativeAuditEvents,
  commitRuntimePersistence,
  persistJobAccessReviewCampaign,
  persistJobExceptionRequest,
  persistJobGovernanceFinding,
  recordAudit,
  verifyRuntimeAuditIntegrity,
  writeEvidenceExport
} from "./runtime-state.js";

export interface EvidenceExportOptions {
  framework?: EvidenceFramework;
  periodStart?: string;
  periodEnd?: string;
}

export interface AuditEventExportOptions {
  periodStart?: string;
  periodEnd?: string;
  target?: AuditEventExportTarget;
}

export function exportEvidence(app: RebacLocalApp, controls: string[], format: EvidenceExport["format"]): EvidenceExport {
  return exportEvidencePackage(app, controls, format, {});
}

export function exportAuditEvents(app: RebacLocalApp, options: AuditEventExportOptions = {}): AuditEventExport {
  const generatedAt = app.now();
  const allEvents = authoritativeAuditEvents(app);
  const periodStart = options.periodStart ?? allEvents
    .map((event) => event.occurredAt)
    .sort()
    .at(0) ?? generatedAt;
  const periodEnd = options.periodEnd ?? generatedAt;
  const events = allEvents.filter((event) => event.occurredAt >= periodStart && event.occurredAt <= periodEnd);
  const auditIntegrity = verifyRuntimeAuditIntegrity(app, generatedAt);
  const exportMetadata: AuditEventExport = {
    exportId: `audit-export:${compactTimestamp(generatedAt)}`,
    generatedAt,
    periodStart,
    periodEnd,
    format: "jsonl",
    target: options.target ?? "operator_download",
    schemaVersion: "audit-event:v1",
    includesPayloadHashes: true,
    exportedEventCount: events.length,
    sourceEventIds: events.map((event) => event.eventId),
    records: events.map((event) => stableStringify(event)),
    auditIntegrity,
    version: "audit-event-export:v1"
  };

  recordAudit(app, {
    eventType: "audit.exported",
    actor: app.actor,
    correlationId: `corr:${exportMetadata.exportId}`,
    payload: asJsonRecord({
      exportId: exportMetadata.exportId,
      periodStart: exportMetadata.periodStart,
      periodEnd: exportMetadata.periodEnd,
      format: exportMetadata.format,
      target: exportMetadata.target,
      exportedEventCount: exportMetadata.exportedEventCount,
      sourceEventIds: exportMetadata.sourceEventIds,
      auditIntegrityStatus: exportMetadata.auditIntegrity.status,
      version: exportMetadata.version
    })
  });

  return exportMetadata;
}

export function exportEvidencePackage(
  app: RebacLocalApp,
  controls: string[],
  format: EvidenceExportFormat,
  options: EvidenceExportOptions = {}
): EvidenceExport {
  const generatedAt = app.now();
  const allEvents = app.store.listAuditEvents();
  const periodStart = options.periodStart ?? allEvents
    .map((event) => event.occurredAt)
    .sort()
    .at(0) ?? generatedAt;
  const periodEnd = options.periodEnd ?? generatedAt;
  const events = allEvents.filter((event) => event.occurredAt >= periodStart && event.occurredAt <= periodEnd);
  const auditIntegrity = verifyRuntimeAuditIntegrity(app, generatedAt);
  const controlMappings = buildControlMappings(controls, events);
  const governanceRecords = materializeAccessReviewGovernance(app, events, generatedAt);
  const conmonMetrics = buildConMonMetrics(app, events, auditIntegrity, governanceRecords);
  const poamItems = buildPoamItems(controlMappings, auditIntegrity, generatedAt, governanceRecords.findings);
  const systemBoundary = buildSystemBoundary(app);
  const dataFlows = buildDataFlows(app);
  const accessReviews = buildAccessReviews(governanceRecords.campaigns, generatedAt);
  const exceptionRegister = buildExceptionRegister(governanceRecords.exceptionRequests);
  const operationalEvidence = buildOperationalEvidence(generatedAt);
  const artifacts = buildEvidenceArtifacts(format, events.length);
  const exportId = `evidence:${generatedAt.replaceAll(/[^0-9a-z]/gi, "").toLowerCase()}`;
  const controlStatements = buildControlStatements(controlMappings, artifacts, generatedAt);
  const exportMetadata = finalizeEvidenceExport({
    exportId,
    framework: options.framework ?? "nist-800-53",
    controls,
    periodStart,
    periodEnd,
    generatedAt,
    evidenceTypes: [
      "audit_events",
      "decision_logs",
      "provisioning_plans",
      "drift_findings",
      "audit_integrity",
      "control_mappings",
      "conmon_metrics",
      "poam_items",
      "siem_export",
      "system_boundary",
      "data_flows",
      "control_statements",
      "access_reviews",
      "exception_register",
      "operational_evidence",
      "oscal_component_definition",
      "oscal_ssp",
      "oscal_assessment_results",
      "poam_export",
      "signed_evidence_package",
      "control_trace_views",
      "verifier_checks"
    ],
    sourceEventIds: events.map((event) => event.eventId),
    responsibleRole: "ISSO",
    format,
    auditIntegrity,
    controlMappings,
    artifacts,
    conmonMetrics,
    poamItems,
    siemExport: {
      format: "jsonl",
      eventCount: events.length,
      schemaVersion: "audit-event:v1",
      includesPayloadHashes: true,
      target: "operator_download"
    },
    systemBoundary,
    dataFlows,
    controlStatements,
    accessReviews,
    exceptionRegister,
    operationalEvidence
  });

  const evidenceEvent = recordAudit(app, {
    eventType: "evidence.generated",
    actor: app.actor,
    correlationId: `corr:${exportMetadata.exportId}`,
    payload: asJsonRecord(exportMetadata)
  }, { persistState: false });

  const storageReceipt = writeEvidenceExport(
    app.evidenceRepository,
    exportMetadata,
    evidenceEvent.occurredAt,
    app.persistenceDegradations
  );
  commitRuntimePersistence(app, evidenceEvent.occurredAt, []);
  return storageReceipt ? { ...exportMetadata, storageReceipt } : exportMetadata;
}

export function verifyEvidencePackage(
  app: RebacLocalApp,
  evidencePackage: unknown,
  options: { idempotencyKey: string }
): EvidenceVerificationReport {
  const report = verifyEvidenceExport(evidencePackage, app.now());
  recordAudit(app, {
    eventType: "evidence.verified",
    actor: app.actor,
    correlationId: `corr:evidence-verify:${compactTimestamp(report.verifiedAt)}`,
    payload: asJsonRecord({
      status: report.status,
      packageHash: report.packageHash,
      verifiedAt: report.verifiedAt,
      idempotencyKey: options.idempotencyKey,
      checkCount: report.checks.length,
      failedChecks: report.checks
        .filter((check) => check.status !== "pass")
        .map((check) => check.name)
    })
  });
  return report;
}

export function verifyAuditIntegrity(app: RebacLocalApp): AuditIntegrityReport {
  const verifiedAt = app.now();
  const report = verifyRuntimeAuditIntegrity(app, verifiedAt);
  const auditEvent = recordAudit(app, {
    eventType: "audit.integrity_verified",
    actor: app.actor,
    correlationId: `corr:audit-integrity:${compactTimestamp(report.verifiedAt)}`,
    payload: asJsonRecord(report)
  });

  return {
    ...report,
    auditEventId: auditEvent.eventId
  };
}

function buildControlMappings(
  controls: string[],
  events: AuditEvent[]
): EvidenceControlMapping[] {
  return controls.map((controlId) => {
    const definition = getControlImplementationDefinition(controlId);

    if (!definition) {
      return {
        controlId,
        family: controlFamily(controlId),
        status: "planned",
        implementationSummary: "Control mapping is not yet defined for this local proof-point package.",
        evidenceTypes: [],
        sourceEventIds: [],
        gaps: ["Define implementation statement and source evidence selectors for this control."]
      };
    }

    const sourceEventIds = events
      .filter((event) => matchesAnyPrefix(event.eventType, definition.eventPrefixes))
      .map((event) => event.eventId);
    const status = sourceEventIds.length > 0 ? "implemented" : "partially_implemented";

    return {
      controlId,
      family: controlFamily(controlId),
      status,
      implementationSummary: definition.summary,
      evidenceTypes: definition.evidenceTypes,
      sourceEventIds,
      gaps: status === "implemented" ? [] : ["No matching audit events were observed for this control in the selected evidence period."]
    };
  });
}

function materializeAccessReviewGovernance(
  app: RebacLocalApp,
  events: AuditEvent[],
  generatedAt: string
): AccessReviewGovernanceRecords {
  const governanceRecords = buildAccessReviewGovernance({
    generatedAt,
    subjectCount: app.store.listSubjects().length,
    resourceCount: app.store.listResources().length,
    sourceEventIds: sourceEventIdsForAccessReview(events),
    driftFindings: app.store.listDriftFindings(),
    existingCampaigns: app.store.listAccessReviewCampaigns(),
    existingFindings: app.store.listGovernanceFindings(),
    existingExceptionRequests: app.store.listExceptionRequests()
  });

  for (const campaign of governanceRecords.campaigns) {
    app.store.upsertAccessReviewCampaign(campaign);
    persistJobAccessReviewCampaign(app, campaign, generatedAt);
  }
  for (const finding of governanceRecords.findings) {
    app.store.upsertGovernanceFinding(finding);
    persistJobGovernanceFinding(app, finding, generatedAt);
  }
  for (const request of governanceRecords.exceptionRequests) {
    app.store.upsertExceptionRequest(request);
    persistJobExceptionRequest(app, request, generatedAt);
  }

  return governanceRecords;
}

function buildConMonMetrics(
  app: RebacLocalApp,
  events: AuditEvent[],
  auditIntegrity: AuditIntegrityReport,
  governanceRecords: AccessReviewGovernanceRecords
): ConMonMetric[] {
  const driftFindings = app.store.listDriftFindings();
  const openGovernanceFindings = governanceRecords.findings.filter((finding) => finding.status !== "remediated");
  const openExceptionRequests = governanceRecords.exceptionRequests.filter((request) => !["expired", "revoked", "remediated"].includes(request.status));
  const pendingOwnerApprovals = [
    ...governanceRecords.campaigns,
    ...governanceRecords.exceptionRequests
  ].filter((record) => record.ownerApprovals.some((approval) => approval.decision === "pending")).length;

  return [
    { name: "audit_events_in_period", value: events.length, unit: "count", source: "audit_log" },
    { name: "audit_chain_verified", value: auditIntegrity.status === "verified" ? 1 : 0, unit: "boolean", source: "audit_integrity" },
    { name: "audit_integrity_findings", value: auditIntegrity.findings.length, unit: "count", source: "audit_integrity" },
    { name: "allowed_decisions", value: countEvents(events, "decision.allowed"), unit: "count", source: "audit_log" },
    { name: "denied_decisions", value: countEvents(events, "decision.denied"), unit: "count", source: "audit_log" },
    { name: "provisioning_jobs", value: app.store.listProvisioningJobs().length, unit: "count", source: "provisioning_store" },
    { name: "open_drift_findings", value: driftFindings.filter((finding) => finding.status === "open").length, unit: "count", source: "drift_store" },
    {
      name: "high_or_critical_drift_findings",
      value: driftFindings.filter((finding) => finding.severity === "high" || finding.severity === "critical").length,
      unit: "count",
      source: "drift_store"
    },
    {
      name: "enforcement_readiness_reports",
      value: app.store.listEnforcementReadinessReports().length,
      unit: "count",
      source: "connector_readiness_store"
    },
    {
      name: "access_review_campaigns",
      value: governanceRecords.campaigns.length,
      unit: "count",
      source: "governance_store"
    },
    {
      name: "open_governance_findings",
      value: openGovernanceFindings.length,
      unit: "count",
      source: "governance_store"
    },
    {
      name: "open_exception_requests",
      value: openExceptionRequests.length,
      unit: "count",
      source: "governance_store"
    },
    {
      name: "expired_exception_requests",
      value: governanceRecords.exceptionRequests.filter((request) => request.status === "expired").length,
      unit: "count",
      source: "governance_store"
    },
    {
      name: "pending_owner_approvals",
      value: pendingOwnerApprovals,
      unit: "count",
      source: "governance_store"
    },
    {
      name: "pending_risk_acceptances",
      value: governanceRecords.exceptionRequests.filter((request) => request.riskAcceptance.status === "pending").length,
      unit: "count",
      source: "governance_store"
    },
    {
      name: "overdue_remediation_items",
      value: governanceRecords.findings.filter((finding) => finding.remediation.status === "overdue").length,
      unit: "count",
      source: "governance_store"
    }
  ];
}

function buildPoamItems(
  mappings: EvidenceControlMapping[],
  auditIntegrity: AuditIntegrityReport,
  generatedAt: string,
  governanceFindings: GovernanceFinding[]
): PoamItem[] {
  const plannedCompletion = addDays(generatedAt, 30);
  const items: PoamItem[] = [];

  if (auditIntegrity.status !== "verified") {
    items.push({
      id: "poam:audit-integrity",
      controlId: "AU-6",
      weakness: "Audit hash-chain verification reported one or more findings.",
      status: "open",
      ownerRole: "ISSO",
      plannedCompletion,
      source: "audit_integrity"
    });
  }

  mappings
    .filter((mapping) => mapping.status !== "implemented")
    .forEach((mapping) => {
      items.push({
        id: buildPoamControlId(mapping.controlId),
        controlId: mapping.controlId,
        weakness: mapping.gaps.at(0) ?? "Control implementation evidence is incomplete.",
        status: "planned",
        ownerRole: "ISSO",
        plannedCompletion,
        source: "control_mapping"
      });
    });

  governanceFindings
    .filter((finding) => finding.status !== "remediated")
    .forEach((finding) => {
      items.push({
        id: finding.remediation.poamItemId,
        controlId: finding.controlId,
        weakness: finding.weakness,
        status: finding.remediation.status === "planned" || finding.remediation.status === "in_progress"
            ? "planned"
            : "open",
        ownerRole: finding.remediation.ownerRole,
        plannedCompletion: finding.remediation.dueAt,
        source: "governance_findings"
      });
    });

  return items;
}

function buildPoamControlId(controlId: string): string {
  const slug = controlId.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "");
  return `poam:${slug || "control"}`;
}

function buildSystemBoundary(app: RebacLocalApp): SystemBoundaryEvidence {
  const connectorComponents = [...app.connectors.values()].map((connector) => ({
    id: connectorComponentId(connector.id),
    name: `${connector.id} connector`,
    type: "connector" as const,
    trustZone: connector.provider === "mock" ? "local_runtime" as const : "synthetic_provider" as const,
    dataClassification: "synthetic",
    description: `${connector.provider ?? connector.id} adapter boundary for discovery, readback, reconciliation, and proof-point evidence.`
  }));

  return {
    boundaryId: "boundary:local-rebac-control-plane",
    name: "Local ReBAC control plane proof-point boundary",
    description: "Synthetic local runtime boundary used to prove ATO evidence package shape without live tenant data, secrets, or provider writes.",
    environment: "local_proof_point",
    liveTenantData: false,
    components: [
      {
        id: "component:operator-cli",
        name: "rebac CLI",
        type: "operator",
        trustZone: "operator_boundary",
        dataClassification: "synthetic",
        description: "Operator and assessor command surface that wraps the API contract."
      },
      {
        id: "component:api-runtime",
        name: "Local API runtime",
        type: "control_plane",
        trustZone: "local_runtime",
        dataClassification: "synthetic",
        description: "HTTP API runtime for decisions, provisioning, audit, reconciliation, and evidence export."
      },
      {
        id: "component:rebac-engine",
        name: "Deterministic ReBAC engine",
        type: "control_plane",
        trustZone: "local_runtime",
        dataClassification: "synthetic",
        description: "Non-LLM authorization engine for deterministic check and explain decisions."
      },
      {
        id: "component:local-store",
        name: "Restartable proof-point store",
        type: "data_store",
        trustZone: "local_runtime",
        dataClassification: "synthetic",
        description: "Local proof-point store for subjects, resources, relationships, native grants, jobs, findings, audit events, and optional JSON state snapshots."
      },
      {
        id: "component:local-evidence-repository",
        name: "Local file evidence repository",
        type: "data_store",
        trustZone: "local_runtime",
        dataClassification: "synthetic",
        description: "Optional JSONL/JSON proof-point repository for audit events and evidence packages; not production WORM storage."
      },
      ...connectorComponents
    ],
    externalSystems: [...new Set([...app.connectors.values()].map((connector) => connector.provider ?? connector.id))],
    assumptions: [
      "All examples are synthetic and must not include real tenant identifiers, secrets, production users, or sensitive records.",
      "Authorization decisions are deterministic and never made by an LLM.",
      "Live connector writes remain out of scope for this local Phase 5 package."
    ],
    version: "system-boundary:v1"
  };
}

function buildDataFlows(app: RebacLocalApp): DataFlowEvidence[] {
  const connectorFlows = [...app.connectors.values()].map((connector): DataFlowEvidence => ({
    id: `data-flow:api-connector:${sanitizeCanonicalId(connector.id)}`,
    name: `API to ${connector.id} connector`,
    source: "component:api-runtime",
    destination: connectorComponentId(connector.id),
    dataTypes: [
      "discovery_requests",
      "readback_requests",
      ...(connector.capabilities.supportsProvisioning ? ["dry_run_or_synthetic_enforcement_requests"] : []),
      ...(connector.capabilities.supportsReconciliation ? ["reconciliation_findings"] : [])
    ],
    protections: [
      "connector_boundary",
      connector.mode === "read_only" ? "read_only_synthetic_providers" : "controlled_enforcement_guardrails",
      connector.provider === "mock" ? "controlled_enforcement_guardrails" : "synthetic_provider_boundary"
    ],
    liveTenantData: false
  }));

  return [
    {
      id: "data-flow:cli-api",
      name: "Operator CLI to API",
      source: "component:operator-cli",
      destination: "component:api-runtime",
      dataTypes: ["operator_requests", "synthetic_subject_ids", "synthetic_resource_ids"],
      protections: ["api_contract_validation", "idempotency_keys_for_writes", "audit_event_emission"],
      liveTenantData: false
    },
    {
      id: "data-flow:api-engine",
      name: "API to deterministic ReBAC engine",
      source: "component:api-runtime",
      destination: "component:rebac-engine",
      dataTypes: ["decision_requests", "relationship_tuples", "policy_versions"],
      protections: ["deny_by_default", "versioned_decisions", "explainable_paths"],
      liveTenantData: false
    },
    {
      id: "data-flow:api-store",
      name: "API to local proof-point store",
      source: "component:api-runtime",
      destination: "component:local-store",
      dataTypes: ["inventory", "native_grants", "provisioning_jobs", "audit_events", "drift_findings"],
      protections: ["synthetic_data_only", "hash_chained_audit_events", "state_snapshot_hashes", "separate_intended_and_native_access"],
      liveTenantData: false
    },
    ...connectorFlows,
    {
      id: "data-flow:evidence-repository",
      name: "API to local evidence repository",
      source: "component:api-runtime",
      destination: "component:local-evidence-repository",
      dataTypes: ["audit_jsonl", "evidence_package_json", "storage_receipts"],
      protections: ["payload_hashes", "storage_receipts", "explicit_non_worm_flag"],
      liveTenantData: false
    }
  ];
}

function buildControlStatements(
  mappings: EvidenceControlMapping[],
  artifacts: EvidenceArtifact[],
  generatedAt: string
): ControlImplementationStatement[] {
  return mappings.map((mapping) => ({
    controlId: mapping.controlId,
    status: mapping.status,
    statement: `${mapping.implementationSummary} This statement is generated from the local synthetic Phase 5 proof-point package and requires assessor review before production use.`,
    responsibleRole: "ISSO",
    reviewerRole: "Security Control Assessor",
    reviewedAt: generatedAt,
    evidenceTypes: mapping.evidenceTypes,
    sourceArtifactNames: artifacts
      .filter((artifact) => artifactSupportsMapping(artifact, mapping))
      .map((artifact) => artifact.name),
    gaps: mapping.gaps
  }));
}

function artifactSupportsMapping(artifact: EvidenceArtifact, mapping: EvidenceControlMapping): boolean {
  if (artifact.type === "control_mapping") {
    return true;
  }

  return mapping.evidenceTypes.some((evidenceType) => artifact.name.includes(evidenceType.replaceAll("_", "-")));
}

function buildAccessReviews(campaigns: AccessReviewCampaign[], reviewedAt: string): AccessReviewEvidence[] {
  return campaigns.map((campaign) => ({
    reviewId: campaign.id,
    campaignId: campaign.id,
    scope: campaign.scope,
    ownerRole: campaign.ownerRole,
    reviewerRole: campaign.reviewerRole,
    status: campaign.status === "completed" ? "completed" : "planned",
    reviewedAt: campaign.completedAt ?? reviewedAt,
    dueAt: campaign.dueAt,
    completedAt: campaign.completedAt,
    subjectCount: campaign.subjectCount,
    resourceCount: campaign.resourceCount,
    findingCount: campaign.findingIds.length,
    exceptionCount: campaign.exceptionRequestIds.length,
    findingIds: campaign.findingIds,
    exceptionRequestIds: campaign.exceptionRequestIds,
    remediationItemIds: campaign.remediationItemIds,
    ownerApprovals: campaign.ownerApprovals,
    sourceEventIds: campaign.sourceEventIds,
    version: "access-review:v2"
  }));
}

function buildExceptionRegister(exceptionRequests: ExceptionRequest[]): ExceptionRecord[] {
  return exceptionRequests.map((request) => ({
    id: request.id,
    subjectId: request.subjectId,
    resourceId: request.resourceId,
    action: request.action,
    reason: request.justification,
    status: exceptionRecordStatus(request.status),
    requestStatus: request.status,
    requesterRole: request.requesterRole,
    ownerRole: request.ownerRole,
    approverRole: "Authorizing Official",
    requestedAt: request.requestedAt,
    expiresAt: request.expiresAt,
    reviewRequiredAt: request.reviewRequiredAt,
    ownerApprovals: request.ownerApprovals,
    riskAcceptance: request.riskAcceptance,
    remediation: request.remediation,
    source: request.source,
    findingId: request.findingId,
    sourceFindingId: request.sourceFindingId,
    controlIds: request.controlIds,
    evidenceRefs: request.evidenceRefs,
    version: "exception-record:v2"
  }));
}

function exceptionRecordStatus(status: ExceptionRequest["status"]): ExceptionRecord["status"] {
  if (status === "risk_accepted" || status === "owner_approved") {
    return "approved";
  }
  if (status === "expired") {
    return "expired";
  }
  if (status === "revoked") {
    return "revoked";
  }
  if (status === "remediated") {
    return "remediated";
  }

  return "open";
}

function controlFamily(controlId: string): string {
  return controlId.split("-").at(0) ?? "custom";
}

function matchesAnyPrefix(value: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => value.startsWith(prefix));
}

function countEvents(events: AuditEvent[], eventType: string): number {
  return events.filter((event) => event.eventType === eventType).length;
}

function addDays(timestamp: string, days: number): string {
  const date = new Date(timestamp);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function sanitizeCanonicalId(value: string): string {
  return value.replaceAll(/[^a-z0-9_:-]/gi, "_").toLowerCase();
}

function connectorComponentId(connectorId: string): string {
  return `component:connector:${sanitizeCanonicalId(connectorId)}`;
}
