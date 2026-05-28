import {
  createReadOnlyConnectorEvidenceExport,
  readOnlyConnectorSourceEventIds,
  type AuditEvent,
  type EvidenceExport
} from "@access-kit/core";

export function createMicrosoftGraphEvidenceExport(connectorId: string, events: AuditEvent[], now: string): EvidenceExport {
  const sourceEventIds = readOnlyConnectorSourceEventIds(events);

  return createReadOnlyConnectorEvidenceExport({
    events,
    sourceEventIds,
    generatedAt: now,
    draft: {
      exportId: `evidence:${connectorId}`,
      framework: "nist-800-53",
      controls: ["AC-2", "AC-3", "AU-2"],
      evidenceTypes: ["audit_events", "discovery_runs", "native_grants", "audit_integrity", "control_mappings"],
      responsibleRole: "ISSO",
      format: "json",
      controlMappings: [
        {
          controlId: "AU-2",
          family: "AU",
          status: events.length > 0 ? "implemented" : "partially_implemented",
          implementationSummary: "Microsoft Graph connector evidence includes redacted audit event identifiers emitted by the local control plane.",
          evidenceTypes: ["audit_events"],
          sourceEventIds,
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
            dataClassification: "redacted directory and collaboration metadata",
            description: "Read-only Microsoft Graph adapter for Entra users, groups, service principals, app-role assignments, M365/Teams coupling, SharePoint, and OneDrive inventory."
          }
        ],
        externalSystems: ["microsoft-graph"],
        assumptions: ["Connector evidence redacts tenant identifiers, object identifiers, emails, names, URLs, paths, request identifiers, tokens, and cursors."],
        version: "system-boundary:v1"
      },
      dataFlows: [
        {
          id: `data-flow:${connectorId}:evidence`,
          name: `${connectorId} connector evidence emission`,
          source: `component:connector:${connectorId}`,
          destination: "component:api-runtime",
          dataTypes: ["redacted_directory_inventory", "redacted_collaboration_inventory", "redacted_app_role_assignments", "connector_audit_events"],
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
    }
  });
}
