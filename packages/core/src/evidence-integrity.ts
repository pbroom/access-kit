import { sha256 } from "./audit.js";
import type {
  ControlImplementationStatement,
  EvidenceControlTraceView,
  EvidenceDeploymentScope,
  EvidenceControlMapping,
  EvidenceExport,
  EvidenceVerifierCheck,
  EvidenceVerificationReport,
  OscalControlImplementation,
  OscalEvidenceArtifacts,
  OscalPoamExport,
  PoamItem,
  SignedEvidencePackage
} from "./domain.js";

export type EvidenceExportPackageContent = Omit<EvidenceExport, "integrityManifest" | "storageReceipt" | "signedPackage" | "verifierChecks">;
export type EvidenceExportWithoutIntegrity = EvidenceExportPackageContent;
export type EvidenceExportDraft = Omit<EvidenceExportPackageContent, "poamExport" | "oscal" | "controlTraceViews"> &
  Partial<Pick<EvidenceExportPackageContent, "poamExport" | "oscal" | "controlTraceViews">>;
type EvidenceExportWithIntegrity = EvidenceExportPackageContent & Pick<EvidenceExport, "integrityManifest">;
type EvidenceExportWithSignature = EvidenceExportWithIntegrity & Pick<EvidenceExport, "signedPackage">;

const defaultSignatureKeyId = "key:local-proof-point-evidence";
const defaultSignerRole = "ISSO";

export function finalizeEvidenceExport(draft: EvidenceExportDraft): EvidenceExport {
  const deploymentScope = buildDeploymentScope(draft);
  const poamExport = draft.poamExport ?? buildPoamExport(draft.exportId, draft.poamItems, draft.controls, draft.generatedAt);
  const oscal = draft.oscal ?? buildOscalArtifacts(draft, deploymentScope, poamExport);
  const controlTraceViews = draft.controlTraceViews ?? buildControlTraceViews(
    draft.exportId,
    draft.controlMappings,
    draft.controlStatements,
    deploymentScope,
    oscal,
    signedPackageId(draft.exportId)
  );

  return attachEvidenceVerifierChecks(attachSignedEvidencePackage(attachEvidenceIntegrityManifest({
    ...draft,
    poamExport,
    oscal,
    controlTraceViews
  })));
}

export function attachEvidenceIntegrityManifest(evidence: EvidenceExportWithoutIntegrity): EvidenceExportWithIntegrity {
  const canonicalContent = canonicalEvidenceContent(evidence);
  return {
    ...evidence,
    integrityManifest: {
      packageHash: hashReference(canonicalContent),
      hashAlgorithm: "sha256",
      canonicalization: "stable-json",
      generatedAt: evidence.generatedAt,
      sections: [
        evidenceSectionHash("auditIntegrity", evidence.auditIntegrity),
        evidenceSectionHash("controlMappings", evidence.controlMappings),
        evidenceSectionHash("artifacts", evidence.artifacts),
        evidenceSectionHash("conmonMetrics", evidence.conmonMetrics),
        evidenceSectionHash("poamItems", evidence.poamItems),
        evidenceSectionHash("poamExport", evidence.poamExport),
        evidenceSectionHash("siemExport", evidence.siemExport),
        evidenceSectionHash("systemBoundary", evidence.systemBoundary),
        evidenceSectionHash("dataFlows", evidence.dataFlows),
        evidenceSectionHash("controlStatements", evidence.controlStatements),
        evidenceSectionHash("accessReviews", evidence.accessReviews),
        evidenceSectionHash("exceptionRegister", evidence.exceptionRegister),
        evidenceSectionHash("operationalEvidence", evidence.operationalEvidence),
        evidenceSectionHash("oscal", evidence.oscal),
        evidenceSectionHash("controlTraceViews", evidence.controlTraceViews)
      ],
      verifier: {
        documentationPath: "docs/evidence-integrity-verifier.md",
        summary: "Recompute the stable-json package content hash before attestation metadata is added and compare section hashes.",
        verificationSteps: [
          "Remove storageReceipt if present.",
          "Remove integrityManifest from the evidence package.",
          "Remove signedPackage and verifierChecks from the evidence package.",
          "Canonicalize the remaining package content with stable JSON key ordering.",
          "Compute sha256 over the canonical package and compare it with integrityManifest.packageHash.",
          "Canonicalize each named section and compare sha256 values with integrityManifest.sections."
        ]
      },
      version: "evidence-integrity-manifest:v1"
    }
  };
}

export function attachSignedEvidencePackage(evidence: EvidenceExportWithIntegrity): EvidenceExportWithSignature {
  const packageId = signedPackageId(evidence.exportId);
  const keyId = defaultSignatureKeyId;
  const deploymentScope = evidence.oscal.systemSecurityPlan.deploymentScope;
  const reviewedStatementRefs = evidence.controlStatements.map((statement) => controlStatementRef(statement.controlId));
  const controlTraceIds = evidence.controlTraceViews.map((trace) => trace.traceId);
  const unsignedPackage: Omit<SignedEvidencePackage, "signature"> = {
    packageId,
    packageHash: evidence.integrityManifest.packageHash,
    hashAlgorithm: "sha256",
    canonicalization: "stable-json",
    signatureAlgorithm: "sha256-local-proof-signature",
    keyId,
    signedAt: evidence.generatedAt,
    signerRole: defaultSignerRole,
    deploymentScope,
    sourceEventIds: evidence.sourceEventIds,
    reviewedStatementRefs,
    controlTraceIds,
    version: "signed-evidence-package:v1"
  };

  return {
    ...evidence,
    signedPackage: {
      ...unsignedPackage,
      signature: signedPackageSignature(unsignedPackage)
    }
  };
}

export function attachEvidenceVerifierChecks(evidence: EvidenceExportWithSignature): EvidenceExport {
  const report = verifyEvidenceExport({ ...evidence, verifierChecks: [] });
  return {
    ...evidence,
    verifierChecks: report.checks
  };
}

export function canonicalEvidenceContent(evidence: EvidenceExportPackageContent | Partial<EvidenceExport>): EvidenceExportPackageContent {
  const {
    integrityManifest: _integrityManifest,
    signedPackage: _signedPackage,
    verifierChecks: _verifierChecks,
    storageReceipt: _storageReceipt,
    ...content
  } = evidence as Partial<EvidenceExport>;
  void _integrityManifest;
  void _signedPackage;
  void _verifierChecks;
  void _storageReceipt;
  return content as EvidenceExportPackageContent;
}

export function verifyEvidenceExport(value: unknown, verifiedAt?: string): EvidenceVerificationReport {
  if (!isRecord(value)) {
    return {
      status: "failed",
      verifiedAt: verifiedAt ?? new Date().toISOString(),
      checks: [fail("package_shape", "Evidence package must be a JSON object.")],
      version: "evidence-verification-report:v1"
    };
  }

  const evidence = value as Partial<EvidenceExport>;
  const checks: EvidenceVerifierCheck[] = [];
  const reportTime = verifiedAt ?? (typeof evidence.generatedAt === "string" ? evidence.generatedAt : new Date().toISOString());

  checks.push(runCheck("package_hash", "Integrity manifest package hash matches canonical content.", () => {
    const expected = hashReference(canonicalEvidenceContent(evidence));
    const actual = evidence.integrityManifest?.packageHash;
    return actual === expected ? pass("package_hash", "Integrity manifest package hash matches canonical content.") : fail(
      "package_hash",
      "Integrity manifest package hash does not match canonical content.",
      expected,
      actual
    );
  }));

  checks.push(...verifySectionHashes(evidence));
  checks.push(runCheck("signed_package_hash", "Signed package metadata references the integrity manifest hash.", () => {
    const expected = evidence.integrityManifest?.packageHash;
    const actual = evidence.signedPackage?.packageHash;
    return actual === expected ? pass("signed_package_hash", "Signed package metadata references the integrity manifest hash.") : fail(
      "signed_package_hash",
      "Signed package metadata does not reference the integrity manifest hash.",
      expected,
      actual
    );
  }));

  checks.push(runCheck("signed_package_signature", "Signed package proof signature verifies.", () => {
    if (!evidence.signedPackage) {
      return fail("signed_package_signature", "Signed package metadata is missing.");
    }
    const { signature: _signature, ...unsignedPackage } = evidence.signedPackage;
    void _signature;
    const expected = signedPackageSignature(unsignedPackage);
    return evidence.signedPackage.signature === expected ? pass("signed_package_signature", "Signed package proof signature verifies.") : fail(
      "signed_package_signature",
      "Signed package proof signature does not verify.",
      expected,
      evidence.signedPackage.signature
    );
  }));

  checks.push(runCheck("deployment_scope", "Signed deployment scope matches the exported system boundary and period.", () => {
    const expected = buildExpectedDeploymentScope(evidence);
    const actual = evidence.signedPackage?.deploymentScope;
    return stableComparable(actual) === stableComparable(expected) ? pass("deployment_scope", "Signed deployment scope matches the exported system boundary and period.") : fail(
      "deployment_scope",
      "Signed deployment scope does not match the exported system boundary and period.",
      stableComparable(expected),
      stableComparable(actual)
    );
  }));

  checks.push(runCheck("oscal_fragments", "OSCAL component, SSP, assessment-results, and POA&M fragments are present.", () => {
    const oscal = evidence.oscal;
    const present = Boolean(oscal?.componentDefinition && oscal.systemSecurityPlan && oscal.assessmentResults && oscal.planOfActionAndMilestones);
    return present ? pass("oscal_fragments", "OSCAL component, SSP, assessment-results, and POA&M fragments are present.") : fail(
      "oscal_fragments",
      "One or more OSCAL fragments are missing."
    );
  }));

  checks.push(runCheck("poam_export", "POA&M export mirrors evidence POA&M items.", () => {
    const expected = (evidence.poamItems ?? []).map((item) => item.id).sort().join(",");
    const actual = (evidence.poamExport?.items ?? []).map((item) => item.id).sort().join(",");
    return actual === expected ? pass("poam_export", "POA&M export mirrors evidence POA&M items.") : fail(
      "poam_export",
      "POA&M export items do not match evidence POA&M items.",
      expected,
      actual
    );
  }));

  checks.push(runCheck("control_trace_views", "Control trace views link controls to source events, reviewed statements, signatures, and deployment scope.", () => {
    const missing = missingControlTraceIds(evidence);
    return missing.length === 0 ? pass("control_trace_views", "Control trace views link controls to source events, reviewed statements, signatures, and deployment scope.") : fail(
      "control_trace_views",
      "One or more controls are missing a complete trace view.",
      "<none>",
      missing.join(",")
    );
  }));

  return {
    status: checks.every((check) => check.status === "pass") ? "verified" : "failed",
    verifiedAt: reportTime,
    packageHash: evidence.integrityManifest?.packageHash,
    checks,
    version: "evidence-verification-report:v1"
  };
}

function buildDeploymentScope(evidence: EvidenceExportDraft | Partial<EvidenceExport>): EvidenceDeploymentScope {
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

function buildPoamExport(exportId: string, poamItems: PoamItem[], controls: string[], generatedAt: string): OscalPoamExport {
  return {
    uuid: `oscal-poam:${sanitizeCanonicalId(exportId)}`,
    title: "Access Kit evidence POA&M export",
    generatedAt,
    items: poamItems,
    sourceControlIds: controls,
    version: "oscal-poam-export:v1"
  };
}

function buildOscalArtifacts(
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

function buildControlTraceViews(
  exportId: string,
  mappings: EvidenceControlMapping[],
  statements: ControlImplementationStatement[],
  deploymentScope: EvidenceDeploymentScope,
  oscal: OscalEvidenceArtifacts,
  packageId: string
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
      signatureRef: {
        packageId,
        keyId: defaultSignatureKeyId
      },
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

function evidenceSectionHash(name: string, value: unknown): EvidenceExport["integrityManifest"]["sections"][number] {
  return {
    name,
    hash: hashReference(value),
    ...(Array.isArray(value) ? { itemCount: value.length } : {})
  };
}

function hashReference(value: unknown): string {
  return `sha256:${sha256(value)}`;
}

function signedPackageSignature(unsignedPackage: Omit<SignedEvidencePackage, "signature">): string {
  return hashReference(unsignedPackage);
}

function controlStatementRef(controlId: string): string {
  return `control-statement:${controlId.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`;
}

function signedPackageId(exportId: string): string {
  return `signed-package:${sanitizeCanonicalId(exportId)}`;
}

function sanitizeCanonicalId(value: string): string {
  return value.replaceAll(/[^a-z0-9_:-]/gi, "_").toLowerCase();
}

function verifySectionHashes(evidence: Partial<EvidenceExport>): EvidenceVerifierCheck[] {
  const content = canonicalEvidenceContent(evidence);
  const sections = evidence.integrityManifest?.sections ?? [];
  const contentRecord = content as unknown as Record<string, unknown>;

  if (sections.length === 0) {
    return [fail("section_hashes", "Integrity manifest does not contain section hashes.")];
  }

  return sections.map((section) => runCheck(`section_hash:${section.name}`, `Section ${section.name} hash matches canonical content.`, () => {
    if (!(section.name in contentRecord)) {
      return fail(`section_hash:${section.name}`, `Section ${section.name} is not present in the canonical content.`);
    }

    const expected = hashReference(contentRecord[section.name]);
    return section.hash === expected ? pass(`section_hash:${section.name}`, `Section ${section.name} hash matches canonical content.`) : fail(
      `section_hash:${section.name}`,
      `Section ${section.name} hash does not match canonical content.`,
      expected,
      section.hash
    );
  }));
}

function buildExpectedDeploymentScope(evidence: Partial<EvidenceExport>): EvidenceDeploymentScope | undefined {
  const boundary = evidence.systemBoundary;
  if (!boundary || !evidence.periodStart || !evidence.periodEnd) {
    return undefined;
  }

  return {
    boundaryId: boundary.boundaryId,
    environment: boundary.environment,
    liveTenantData: boundary.liveTenantData,
    controls: evidence.controls ?? [],
    periodStart: evidence.periodStart,
    periodEnd: evidence.periodEnd,
    componentIds: boundary.components.map((component) => component.id),
    version: "evidence-deployment-scope:v1"
  };
}

function missingControlTraceIds(evidence: Partial<EvidenceExport>): string[] {
  const traces = new Map((evidence.controlTraceViews ?? []).map((trace) => [trace.controlId, trace]));
  const packageId = evidence.signedPackage?.packageId;
  const keyId = evidence.signedPackage?.keyId;
  const scope = evidence.signedPackage?.deploymentScope;

  return (evidence.controlMappings ?? [])
    .filter((mapping) => !traceIsComplete(traces.get(mapping.controlId), mapping.sourceEventIds, packageId, keyId, scope))
    .map((mapping) => mapping.controlId);
}

function traceIsComplete(
  trace: EvidenceControlTraceView | undefined,
  sourceEventIds: string[],
  packageId: string | undefined,
  keyId: string | undefined,
  deploymentScope: EvidenceDeploymentScope | undefined
): boolean {
  if (!trace || !packageId || !keyId || !deploymentScope) {
    return false;
  }

  return (
    trace.signatureRef.packageId === packageId &&
    trace.signatureRef.keyId === keyId &&
    stableComparable(trace.deploymentScope) === stableComparable(deploymentScope) &&
    stableComparable([...trace.sourceEventIds].sort()) === stableComparable([...sourceEventIds].sort()) &&
    Boolean(trace.reviewedStatement.reviewedAt && trace.reviewedStatement.reviewerRole)
  );
}

function runCheck(name: string, successMessage: string, check: () => EvidenceVerifierCheck): EvidenceVerifierCheck {
  try {
    return check();
  } catch (error) {
    return fail(name, `${successMessage} Verification threw: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function pass(name: string, message: string): EvidenceVerifierCheck {
  return { name, status: "pass", message };
}

function fail(name: string, message: string, expected?: unknown, actual?: unknown): EvidenceVerifierCheck {
  return {
    name,
    status: "fail",
    message,
    ...(expected === undefined ? {} : { expected: String(expected) }),
    ...(actual === undefined ? {} : { actual: String(actual) })
  };
}

function stableComparable(value: unknown): string {
  return JSON.stringify(value, Object.keys(flattenKeys(value)).sort());
}

function flattenKeys(value: unknown, keys: Record<string, true> = {}): Record<string, true> {
  if (Array.isArray(value)) {
    value.forEach((item) => flattenKeys(item, keys));
    return keys;
  }

  if (isRecord(value)) {
    Object.keys(value).forEach((key) => {
      keys[key] = true;
      flattenKeys(value[key], keys);
    });
  }

  return keys;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
