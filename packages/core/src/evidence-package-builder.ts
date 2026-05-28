import type {
  ControlImplementationStatement,
  EvidenceControlMapping,
  EvidenceControlTraceView,
  EvidenceDeploymentScope,
  EvidenceExport,
  OscalControlImplementation,
  OscalEvidenceArtifacts,
  OscalPoamExport,
  PoamItem
} from "./domain.js";

export type EvidenceExportPackageContent = Omit<EvidenceExport, "integrityManifest" | "storageReceipt" | "signedPackage" | "verifierChecks">;
export type EvidenceExportWithoutIntegrity = EvidenceExportPackageContent;
export type EvidenceExportDraft = Omit<EvidenceExportPackageContent, "poamExport" | "oscal" | "controlTraceViews"> &
  Partial<Pick<EvidenceExportPackageContent, "poamExport" | "oscal" | "controlTraceViews">>;

export const defaultEvidenceSignatureKeyId = "key:local-proof-point-evidence-runtime-ed25519";

export interface EvidencePackageSignatureRef {
  packageId: string;
  keyId: string;
}

export interface EvidencePackageBuilderOptions {
  signatureRef?: Partial<Pick<EvidencePackageSignatureRef, "keyId">>;
}

export function buildEvidencePackageContent(
  draft: EvidenceExportDraft,
  options: EvidencePackageBuilderOptions = {}
): EvidenceExportPackageContent {
  const deploymentScope = buildDeploymentScope(draft);
  const poamExport = draft.poamExport ?? buildPoamExport(draft.exportId, draft.poamItems, draft.controls, draft.generatedAt);
  const oscal = draft.oscal ?? buildOscalArtifacts(draft, deploymentScope, poamExport);
  const signatureRef: EvidencePackageSignatureRef = {
    packageId: signedEvidencePackageId(draft.exportId),
    keyId: options.signatureRef?.keyId ?? defaultEvidenceSignatureKeyId
  };
  const controlTraceViews = draft.controlTraceViews ?? buildControlTraceViews(
    draft.exportId,
    draft.controlMappings,
    draft.controlStatements,
    deploymentScope,
    oscal,
    signatureRef
  );

  return {
    ...draft,
    poamExport,
    oscal,
    controlTraceViews
  };
}

export function buildDeploymentScope(evidence: EvidenceDeploymentScopeInput): EvidenceDeploymentScope {
  const boundary = evidence.systemBoundary;
  return {
    boundaryId: boundary?.boundaryId ?? "boundary:unknown",
    environment: boundary?.environment ?? "local_proof_point",
    liveTenantData: boundary?.liveTenantData ?? false,
    controls: evidence.controls ?? [],
    periodStart: evidence.periodStart ?? "1970-01-01T00:00:00.000Z",
    periodEnd: evidence.periodEnd ?? "1970-01-01T00:00:00.000Z",
    componentIds: boundary?.components.map((component) => component.id) ?? [],
    version: "evidence-deployment-scope:v1"
  };
}

export function buildExpectedDeploymentScope(evidence: Partial<EvidenceExport>): EvidenceDeploymentScope | undefined {
  if (!evidence.systemBoundary || !evidence.periodStart || !evidence.periodEnd || !evidence.systemBoundary.components) {
    return undefined;
  }

  return buildDeploymentScope(evidence);
}

export function buildPoamExport(exportId: string, poamItems: PoamItem[], controls: string[], generatedAt: string): OscalPoamExport {
  return {
    uuid: `oscal-poam:${sanitizeCanonicalId(exportId)}`,
    title: "Access Kit evidence POA&M export",
    generatedAt,
    items: poamItems,
    sourceControlIds: controls,
    version: "oscal-poam-export:v1"
  };
}

export function buildOscalArtifacts(
  evidence: EvidenceExportDraft,
  deploymentScope: EvidenceDeploymentScope,
  poamExport: OscalPoamExport
): OscalEvidenceArtifacts {
  const implementations = buildOscalControlImplementations(evidence.controlMappings, evidence.controlStatements);
  const exportId = sanitizeCanonicalId(evidence.exportId);

  return {
    componentDefinition: {
      uuid: `oscal-component-definition:${exportId}`,
      title: "Access Kit evidence component definition",
      framework: evidence.framework,
      generatedAt: evidence.generatedAt,
      components: evidence.systemBoundary.components,
      implementedRequirements: implementations,
      version: "oscal-component-definition-fragment:v1"
    },
    systemSecurityPlan: {
      uuid: `oscal-ssp:${exportId}`,
      title: "Access Kit evidence SSP fragment",
      systemName: evidence.systemBoundary.name,
      boundaryId: evidence.systemBoundary.boundaryId,
      deploymentScope,
      dataFlows: evidence.dataFlows,
      controlImplementationStatements: implementations,
      version: "oscal-ssp-fragment:v1"
    },
    assessmentResults: {
      uuid: `oscal-assessment-results:${exportId}`,
      title: "Access Kit evidence assessment-results fragment",
      generatedAt: evidence.generatedAt,
      reviewedControls: implementations,
      observations: implementations.map((implementation) => ({
        controlId: implementation.controlId,
        status: implementation.status,
        sourceEventIds: implementation.sourceEventIds,
        gaps: implementation.gaps
      })),
      version: "oscal-assessment-results-fragment:v1"
    },
    planOfActionAndMilestones: poamExport,
    version: "oscal-evidence-artifacts:v1"
  };
}

export function buildControlTraceViews(
  exportId: string,
  mappings: EvidenceControlMapping[],
  statements: ControlImplementationStatement[],
  deploymentScope: EvidenceDeploymentScope,
  oscal: OscalEvidenceArtifacts,
  signatureRef: EvidencePackageSignatureRef
): EvidenceControlTraceView[] {
  return mappings.map((mapping) => {
    const statement = statements.find((candidate) => candidate.controlId === mapping.controlId);
    return {
      traceId: `control-trace:${sanitizeCanonicalId(exportId)}:${sanitizeCanonicalId(mapping.controlId)}`,
      controlId: mapping.controlId,
      status: mapping.status,
      sourceEventIds: mapping.sourceEventIds,
      reviewedStatement: {
        reviewerRole: statement?.reviewerRole ?? "Security Control Assessor",
        reviewedAt: statement?.reviewedAt ?? deploymentScope.periodEnd,
        sourceArtifactNames: statement?.sourceArtifactNames ?? []
      },
      signatureRef,
      deploymentScope,
      oscalRefs: {
        componentDefinitionUuid: oscal.componentDefinition.uuid,
        sspUuid: oscal.systemSecurityPlan.uuid,
        assessmentResultsUuid: oscal.assessmentResults.uuid,
        poamUuid: oscal.planOfActionAndMilestones.uuid
      },
      gaps: mapping.gaps,
      version: "evidence-control-trace-view:v1"
    };
  });
}

export function evidenceControlStatementRef(controlId: string): string {
  return `control-statement:${controlId.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`;
}

export function signedEvidencePackageId(exportId: string): string {
  return `signed-package:${sanitizeCanonicalId(exportId)}`;
}

function buildOscalControlImplementations(
  mappings: EvidenceControlMapping[],
  statements: ControlImplementationStatement[]
): OscalControlImplementation[] {
  return mappings.map((mapping) => {
    const statement = statements.find((candidate) => candidate.controlId === mapping.controlId);
    return {
      controlId: mapping.controlId,
      status: statement?.status ?? mapping.status,
      statement: statement?.statement ?? mapping.implementationSummary,
      responsibleRole: statement?.responsibleRole ?? "ISSO",
      reviewerRole: statement?.reviewerRole ?? "Security Control Assessor",
      reviewedAt: statement?.reviewedAt ?? "1970-01-01T00:00:00.000Z",
      sourceEventIds: mapping.sourceEventIds,
      sourceArtifactNames: statement?.sourceArtifactNames ?? [],
      gaps: statement?.gaps ?? mapping.gaps
    };
  });
}

function sanitizeCanonicalId(value: string): string {
  return value.replaceAll(/[^a-z0-9_:-]/gi, "_").toLowerCase();
}

type EvidenceDeploymentScopeInput = Pick<
  Partial<EvidenceExportPackageContent>,
  "systemBoundary" | "controls" | "periodStart" | "periodEnd"
>;
