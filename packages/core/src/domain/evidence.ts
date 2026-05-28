import type { AccessReviewEvidence, ExceptionRecord } from "./governance.js";
import type { CanonicalId, IsoDateTime, JsonRecord } from "./shared.js";

export type EvidenceFramework = "nist-800-53" | "fedramp-rev5" | "custom";
export type EvidenceExportFormat = "json" | "zip" | "markdown";
export type ControlImplementationStatus = "implemented" | "partially_implemented" | "planned";
export type AuditIntegrityStatus = "verified" | "failed";

export interface AuditEvent {
  eventId: CanonicalId;
  eventType: string;
  occurredAt: IsoDateTime;
  actor: CanonicalId;
  subjectId?: CanonicalId;
  resourceId?: CanonicalId;
  correlationId: CanonicalId;
  policyVersion?: string;
  relationshipVersion?: string;
  payloadHash: string;
  previousEventHash?: string;
  payload: JsonRecord;
}

export interface PersistenceDegradationReceipt {
  component: "audit" | "evidence" | "graph" | "job" | "state";
  operation: string;
  occurredAt: IsoDateTime | "startup";
  message: string;
  version: "persistence-degradation:v1";
}

export interface AuditIntegrityFinding {
  code: string;
  message: string;
  severity: "low" | "medium" | "high" | "critical";
  eventId?: CanonicalId;
  expected?: string;
  actual?: string;
}

export interface AuditIntegrityReport {
  status: AuditIntegrityStatus;
  eventCount: number;
  verifiedAt: IsoDateTime;
  firstEventId?: CanonicalId;
  lastEventId?: CanonicalId;
  firstEventHash?: string;
  lastEventHash?: string;
  findings: AuditIntegrityFinding[];
  auditEventId?: CanonicalId;
  version: string;
}

export interface EvidenceControlMapping {
  controlId: string;
  family: string;
  status: ControlImplementationStatus;
  implementationSummary: string;
  evidenceTypes: string[];
  sourceEventIds: CanonicalId[];
  gaps: string[];
}

export type EvidenceArtifactType =
  | "audit_events"
  | "decision_logs"
  | "provisioning_logs"
  | "drift_findings"
  | "control_mapping"
  | "siem_export"
  | "poam"
  | "poam_export"
  | "conmon"
  | "system_boundary"
  | "data_flow"
  | "control_statement"
  | "access_review"
  | "exception_register"
  | "security_evidence"
  | "oscal_component_definition"
  | "oscal_ssp"
  | "oscal_assessment_results"
  | "signed_evidence_package"
  | "control_trace"
  | "incident_response"
  | "contingency_plan"
  | "configuration_baseline";

export interface EvidenceArtifact {
  name: string;
  type: EvidenceArtifactType;
  description: string;
  eventCount?: number;
  format: EvidenceExportFormat | "jsonl";
}

export interface EvidenceSectionHash {
  name: string;
  hash: string;
  itemCount?: number;
}

export interface EvidenceVerifierDocumentation {
  documentationPath: string;
  summary: string;
  verificationSteps: string[];
}

export interface EvidenceIntegrityManifest {
  packageHash: string;
  hashAlgorithm: "sha256";
  canonicalization: "stable-json";
  generatedAt: IsoDateTime;
  sections: EvidenceSectionHash[];
  verifier: EvidenceVerifierDocumentation;
  version: "evidence-integrity-manifest:v1";
}

export interface ConMonMetric {
  name: string;
  value: number;
  unit: "count" | "boolean";
  source: string;
}

export interface PoamItem {
  id: CanonicalId;
  controlId: string;
  weakness: string;
  status: "open" | "planned" | "mitigated";
  ownerRole: string;
  plannedCompletion: IsoDateTime;
  source: string;
}

export interface EvidenceDeploymentScope {
  boundaryId: CanonicalId;
  environment: SystemBoundaryEvidence["environment"];
  liveTenantData: boolean;
  controls: string[];
  periodStart: IsoDateTime;
  periodEnd: IsoDateTime;
  componentIds: CanonicalId[];
  version: "evidence-deployment-scope:v1";
}

export interface OscalControlImplementation {
  controlId: string;
  status: ControlImplementationStatus;
  statement: string;
  responsibleRole: string;
  reviewerRole: string;
  reviewedAt: IsoDateTime;
  sourceEventIds: CanonicalId[];
  sourceArtifactNames: string[];
  gaps: string[];
}

export interface OscalComponentDefinitionFragment {
  uuid: CanonicalId;
  title: string;
  framework: EvidenceFramework;
  generatedAt: IsoDateTime;
  components: BoundaryComponent[];
  implementedRequirements: OscalControlImplementation[];
  version: "oscal-component-definition-fragment:v1";
}

export interface OscalSspFragment {
  uuid: CanonicalId;
  title: string;
  systemName: string;
  boundaryId: CanonicalId;
  deploymentScope: EvidenceDeploymentScope;
  dataFlows: DataFlowEvidence[];
  controlImplementationStatements: OscalControlImplementation[];
  version: "oscal-ssp-fragment:v1";
}

export interface OscalAssessmentResultsFragment {
  uuid: CanonicalId;
  title: string;
  generatedAt: IsoDateTime;
  reviewedControls: OscalControlImplementation[];
  observations: Array<{
    controlId: string;
    status: ControlImplementationStatus;
    sourceEventIds: CanonicalId[];
    gaps: string[];
  }>;
  version: "oscal-assessment-results-fragment:v1";
}

export interface OscalPoamExport {
  uuid: CanonicalId;
  title: string;
  generatedAt: IsoDateTime;
  items: PoamItem[];
  sourceControlIds: string[];
  version: "oscal-poam-export:v1";
}

export interface OscalEvidenceArtifacts {
  componentDefinition: OscalComponentDefinitionFragment;
  systemSecurityPlan: OscalSspFragment;
  assessmentResults: OscalAssessmentResultsFragment;
  planOfActionAndMilestones: OscalPoamExport;
  version: "oscal-evidence-artifacts:v1";
}

export interface SignedEvidencePackage {
  packageId: CanonicalId;
  packageHash: string;
  hashAlgorithm: "sha256";
  canonicalization: "stable-json";
  signatureAlgorithm: "ed25519-local-proof-signature";
  keyId: CanonicalId;
  signedAt: IsoDateTime;
  signerRole: string;
  signature: string;
  deploymentScope: EvidenceDeploymentScope;
  sourceEventIds: CanonicalId[];
  reviewedStatementRefs: CanonicalId[];
  controlTraceIds: CanonicalId[];
  version: "signed-evidence-package:v1";
}

export interface EvidenceVerifierCheck {
  name: string;
  status: "pass" | "fail";
  message: string;
  expected?: string;
  actual?: string;
}

export interface EvidenceVerificationReport {
  status: "verified" | "failed";
  verifiedAt: IsoDateTime;
  packageHash?: string;
  checks: EvidenceVerifierCheck[];
  version: "evidence-verification-report:v1";
}

export interface EvidenceControlTraceView {
  traceId: CanonicalId;
  controlId: string;
  status: ControlImplementationStatus;
  sourceEventIds: CanonicalId[];
  reviewedStatement: {
    reviewerRole: string;
    reviewedAt: IsoDateTime;
    sourceArtifactNames: string[];
  };
  signatureRef: {
    packageId: CanonicalId;
    keyId: CanonicalId;
  };
  deploymentScope: EvidenceDeploymentScope;
  oscalRefs: {
    componentDefinitionUuid: CanonicalId;
    sspUuid: CanonicalId;
    assessmentResultsUuid: CanonicalId;
    poamUuid: CanonicalId;
  };
  gaps: string[];
  version: "evidence-control-trace-view:v1";
}

export interface BoundaryComponent {
  id: CanonicalId;
  name: string;
  type: "control_plane" | "connector" | "data_store" | "operator" | "external_system";
  trustZone: "local_runtime" | "synthetic_provider" | "operator_boundary" | "future_production";
  dataClassification: string;
  description: string;
}

export interface SystemBoundaryEvidence {
  boundaryId: CanonicalId;
  name: string;
  description: string;
  environment: "local_proof_point" | "production";
  liveTenantData: boolean;
  components: BoundaryComponent[];
  externalSystems: string[];
  assumptions: string[];
  version: string;
}

export interface DataFlowEvidence {
  id: CanonicalId;
  name: string;
  source: CanonicalId;
  destination: CanonicalId;
  dataTypes: string[];
  protections: string[];
  liveTenantData: boolean;
}

export interface ControlImplementationStatement {
  controlId: string;
  status: ControlImplementationStatus;
  statement: string;
  responsibleRole: string;
  reviewerRole: string;
  reviewedAt: IsoDateTime;
  evidenceTypes: string[];
  sourceArtifactNames: string[];
  gaps: string[];
}

export interface OperationalEvidence {
  id: CanonicalId;
  type: "break_glass" | "incident_response" | "backup_restore" | "contingency" | "sbom" | "dependency_scan" | "vulnerability_scan" | "configuration_baseline";
  status: "implemented" | "planned" | "blocked";
  ownerRole: string;
  generatedAt: IsoDateTime;
  summary: string;
  evidenceRefs: string[];
  gaps: string[];
}

export type AuditEventExportTarget = "operator_download" | "siem_forwarder";

export interface SiemExportMetadata {
  format: "jsonl";
  eventCount: number;
  schemaVersion: string;
  includesPayloadHashes: boolean;
  target: AuditEventExportTarget;
}

export interface AuditEventExport {
  exportId: CanonicalId;
  generatedAt: IsoDateTime;
  periodStart: IsoDateTime;
  periodEnd: IsoDateTime;
  format: "jsonl";
  target: AuditEventExportTarget;
  schemaVersion: string;
  includesPayloadHashes: boolean;
  exportedEventCount: number;
  sourceEventIds: CanonicalId[];
  records: string[];
  auditIntegrity: AuditIntegrityReport;
  version: string;
}

export interface AuditStorageReceipt {
  eventId: CanonicalId;
  sequence: number;
  eventHash: string;
  previousEventHash?: string;
  storedAt: IsoDateTime;
  backend: "memory" | "local_file" | "external";
  location: string;
  immutable: boolean;
  version: string;
}

export interface EvidenceStorageReceipt {
  exportId: CanonicalId;
  packageHash: string;
  storedAt: IsoDateTime;
  backend: "memory" | "local_file" | "external";
  location: string;
  immutable: boolean;
  version: string;
}

export interface EvidenceExport {
  exportId: CanonicalId;
  framework: EvidenceFramework;
  controls: string[];
  periodStart: IsoDateTime;
  periodEnd: IsoDateTime;
  generatedAt: IsoDateTime;
  evidenceTypes: string[];
  sourceEventIds: CanonicalId[];
  responsibleRole: string;
  format: EvidenceExportFormat;
  auditIntegrity: AuditIntegrityReport;
  integrityManifest: EvidenceIntegrityManifest;
  controlMappings: EvidenceControlMapping[];
  artifacts: EvidenceArtifact[];
  conmonMetrics: ConMonMetric[];
  poamItems: PoamItem[];
  poamExport: OscalPoamExport;
  siemExport: SiemExportMetadata;
  systemBoundary: SystemBoundaryEvidence;
  dataFlows: DataFlowEvidence[];
  controlStatements: ControlImplementationStatement[];
  accessReviews: AccessReviewEvidence[];
  exceptionRegister: ExceptionRecord[];
  operationalEvidence: OperationalEvidence[];
  oscal: OscalEvidenceArtifacts;
  signedPackage: SignedEvidencePackage;
  verifierChecks: EvidenceVerifierCheck[];
  controlTraceViews: EvidenceControlTraceView[];
  storageReceipt?: EvidenceStorageReceipt;
}
