import type {
  EvidenceArtifact,
  EvidenceExportFormat,
  OperationalEvidence
} from "@access-kit/core";

export interface ControlImplementationDefinition {
  summary: string;
  evidenceTypes: string[];
  eventPrefixes: string[];
}

const controlImplementationCatalog: Record<string, ControlImplementationDefinition> = {
  "AC-2": {
    summary: "Account lifecycle evidence is produced through subject inventory, provisioning, revocation, and native-access readback events.",
    evidenceTypes: ["subject_inventory", "provisioning_logs", "native_access_readback"],
    eventPrefixes: ["subject.", "provisioning.", "access.", "connector.current_access_read"]
  },
  "AC-3": {
    summary: "Access enforcement evidence is produced through deterministic decision events, relationship facts, and provisioning records.",
    evidenceTypes: ["decision_logs", "relationship_tuples", "provisioning_logs"],
    eventPrefixes: ["decision.", "relationship.", "provisioning.", "connector.permission_changed"]
  },
  "AC-6": {
    summary: "Least-privilege evidence is produced through connector readiness, approval, and scoped provisioning evidence.",
    evidenceTypes: ["connector_readiness", "approval_records", "provisioning_logs"],
    eventPrefixes: ["connector.enforcement_readiness_checked", "provisioning.approved", "connector.permission_changed"]
  },
  "AU-2": {
    summary: "Auditable events are emitted for decisions, relationship writes, connector actions, provisioning, reconciliation, and evidence generation.",
    evidenceTypes: ["audit_events"],
    eventPrefixes: [""]
  },
  "AU-6": {
    summary: "Audit review evidence includes hash-chain integrity verification and evidence-package generation.",
    evidenceTypes: ["audit_integrity", "evidence_exports"],
    eventPrefixes: ["audit.integrity_verified", "evidence.generated"]
  },
  "CM-3": {
    summary: "Configuration change evidence is produced through policy, relationship, connector, and provisioning change events.",
    evidenceTypes: ["policy_changes", "relationship_tuples", "connector_logs", "provisioning_logs"],
    eventPrefixes: ["policy.", "relationship.", "connector.", "provisioning."]
  },
  "CA-7": {
    summary: "Continuous monitoring evidence is produced through reconciliation, drift findings, ConMon metrics, and evidence exports.",
    evidenceTypes: ["reconciliation_runs", "drift_findings", "conmon_metrics", "evidence_exports"],
    eventPrefixes: ["reconciliation.", "drift.", "evidence.generated"]
  },
  "IR-4": {
    summary: "Incident response evidence is represented through rollback, break-glass, incident-mode, and failed-provisioning records.",
    evidenceTypes: ["incident_records", "rollback_records", "provisioning_logs"],
    eventPrefixes: ["breakglass.", "provisioning.rollback_", "provisioning.failed"]
  }
};

export function getControlImplementationDefinition(controlId: string): ControlImplementationDefinition | undefined {
  return controlImplementationCatalog[controlId];
}

export function buildOperationalEvidence(generatedAt: string): OperationalEvidence[] {
  return [
    {
      id: "operational:break-glass-runbook",
      type: "break_glass",
      status: "implemented",
      ownerRole: "ISSO",
      generatedAt,
      summary: "Local proof-point documents break-glass as a governed exception source and blocks break-glass use in controlled synthetic enforcement.",
      evidenceRefs: ["docs/security-model.md", "packages/api/src/runtime-app.ts"],
      gaps: ["Production break-glass identity, approval, expiry, and post-action review workflow must be integrated with the deployment identity provider."]
    },
    {
      id: "operational:incident-response-runbook",
      type: "incident_response",
      status: "implemented",
      ownerRole: "Incident Commander",
      generatedAt,
      summary: "Incident-mode guardrails block controlled enforcement and evidence exports include IR-4 control mapping hooks for failed provisioning and rollback events.",
      evidenceRefs: ["docs/security-model.md", "docs/ato-evidence-model.md"],
      gaps: ["Production incident ticketing, notification, and post-incident review integrations remain deployment work."]
    },
    {
      id: "operational:backup-restore-proof",
      type: "backup_restore",
      status: "planned",
      ownerRole: "System Owner",
      generatedAt,
      summary: "Evidence package declares backup and restore evidence requirements for future durable graph, audit, and evidence stores.",
      evidenceRefs: ["docs/outstanding-requirements.md"],
      gaps: ["No production database, retention policy, restore test, or recovery time objective exists in the local runtime."]
    },
    {
      id: "operational:contingency-plan",
      type: "contingency",
      status: "planned",
      ownerRole: "System Owner",
      generatedAt,
      summary: "Contingency evidence is represented as package metadata until deployment architecture and storage services are selected.",
      evidenceRefs: ["docs/ato-evidence-model.md"],
      gaps: ["Define deployment-specific contingency plan, alternate processing procedures, and recovery test cadence."]
    },
    {
      id: "operational:sbom",
      type: "sbom",
      status: "implemented",
      ownerRole: "DevSecOps",
      generatedAt,
      summary: "Workspace dependency inventory is represented through package manifests, lockfile, and CI dependency audit evidence.",
      evidenceRefs: ["package.json", "pnpm-lock.yaml", ".github/workflows/security.yml"],
      gaps: ["Generate and archive a formal CycloneDX or SPDX SBOM artifact in release CI."]
    },
    {
      id: "operational:dependency-scan",
      type: "dependency_scan",
      status: "implemented",
      ownerRole: "DevSecOps",
      generatedAt,
      summary: "Security workflow runs dependency audit, secret scan, and CodeQL checks for pull requests.",
      evidenceRefs: [".github/workflows/security.yml", "docs/ci.md"],
      gaps: ["Add release-retained scan artifacts and vulnerability exception workflow."]
    },
    {
      id: "operational:vulnerability-scan",
      type: "vulnerability_scan",
      status: "planned",
      ownerRole: "DevSecOps",
      generatedAt,
      summary: "Static analysis proof points exist in CI, while authenticated DAST and infrastructure vulnerability scanning remain deployment-specific.",
      evidenceRefs: [".github/workflows/security.yml"],
      gaps: ["Add DAST, container/image scans, infrastructure scans, and remediation SLA evidence once deployable packaging exists."]
    },
    {
      id: "operational:configuration-baseline",
      type: "configuration_baseline",
      status: "implemented",
      ownerRole: "Configuration Manager",
      generatedAt,
      summary: "Configuration baseline evidence is represented by strict TypeScript, validated OpenAPI/JSON Schemas, CI workflow validation, and ADRs.",
      evidenceRefs: ["tsconfig.json", "openapi/rebac-control-plane.yaml", "schemas", "adrs"],
      gaps: ["Add deployment IaC baseline, environment hardening checklist, and drift monitoring for production configuration."]
    }
  ];
}

export function buildEvidenceArtifacts(format: EvidenceExportFormat, eventCount: number): EvidenceArtifact[] {
  return [
    {
      name: "audit-events",
      type: "audit_events",
      description: "Time-bounded audit events with payload hashes and previous-event hash references.",
      eventCount,
      format
    },
    {
      name: "control-mapping",
      type: "control_mapping",
      description: "Requested controls mapped to implementation statements, source events, and gaps.",
      format
    },
    {
      name: "poam",
      type: "poam",
      description: "Machine-readable POA&M inputs for incomplete or failed evidence checks.",
      format
    },
    {
      name: "siem-events",
      type: "siem_export",
      description: "JSONL-ready SIEM export metadata for the same audit-event scope.",
      eventCount,
      format: "jsonl"
    },
    {
      name: "system-boundary",
      type: "system_boundary",
      description: "Synthetic local system boundary and component inventory for ATO inspection.",
      format
    },
    {
      name: "data-flows",
      type: "data_flow",
      description: "Synthetic data-flow inventory with protections and live-tenant-data flags.",
      format
    },
    {
      name: "control-statements",
      type: "control_statement",
      description: "Control implementation statements generated from source evidence and gaps.",
      format
    },
    {
      name: "access-reviews",
      type: "access_review",
      description: "Synthetic access review summary for relationship, native-access, and drift evidence.",
      format
    },
    {
      name: "exception-register",
      type: "exception_register",
      description: "Risk exception records derived from drift findings that require review.",
      format
    },
    {
      name: "operational-evidence",
      type: "security_evidence",
      description: "Operational proof points for SBOM, dependency scanning, incident response, contingency, and configuration baseline evidence.",
      format
    }
  ];
}
