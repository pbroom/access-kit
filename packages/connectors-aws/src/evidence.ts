import {
  createReadOnlyConnectorEvidenceExport,
  readOnlyConnectorSourceEventIds,
  type AuditEvent,
  type EvidenceExport
} from "@access-kit/core";
import type { AwsLatencyWindows } from "./provider-models.js";

export function createAwsEvidence(
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
