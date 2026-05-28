import { createPublicKey, generateKeyPairSync, sign as signPayload, verify as verifyPayload } from "node:crypto";
import { sha256, stableStringify } from "./audit.js";
import {
  buildEvidencePackageContent,
  buildExpectedDeploymentScope,
  defaultEvidenceSignatureKeyId,
  evidenceControlStatementRef,
  signedEvidencePackageId,
  type EvidenceExportDraft,
  type EvidenceExportPackageContent,
  type EvidenceExportWithoutIntegrity
} from "./evidence-package-builder.js";
import type {
  EvidenceControlTraceView,
  EvidenceDeploymentScope,
  EvidenceExport,
  EvidenceVerifierCheck,
  EvidenceVerificationReport,
  SignedEvidencePackage
} from "./domain.js";

export type {
  EvidenceExportDraft,
  EvidenceExportPackageContent,
  EvidenceExportWithoutIntegrity
} from "./evidence-package-builder.js";

type EvidenceExportWithIntegrity = EvidenceExportPackageContent & Pick<EvidenceExport, "integrityManifest">;
type EvidenceExportWithSignature = EvidenceExportWithIntegrity & Pick<EvidenceExport, "signedPackage">;
type EvidencePrivateSigningKey = Parameters<typeof signPayload>[2];
type EvidencePublicVerificationKey = Parameters<typeof verifyPayload>[2];

export interface EvidenceSigner {
  keyId: SignedEvidencePackage["keyId"];
  signatureAlgorithm: SignedEvidencePackage["signatureAlgorithm"];
  signerRole: string;
  sign(unsignedPackage: Omit<SignedEvidencePackage, "signature">): string;
}

export interface TrustedEvidenceSigningKey {
  algorithm: SignedEvidencePackage["signatureAlgorithm"];
  publicKey: EvidencePublicVerificationKey;
}

export type TrustedEvidenceSigningKeyRegistry = Readonly<Record<string, TrustedEvidenceSigningKey>>;

export interface EvidenceSigningOptions {
  signer?: EvidenceSigner;
}

export interface EvidenceVerificationOptions {
  trustedKeys?: TrustedEvidenceSigningKeyRegistry;
  verifiedAt?: string;
}

export interface EvidenceIntegrityOptions extends EvidenceSigningOptions, EvidenceVerificationOptions {}

export const checkedInFixtureSignatureKeyId = "key:local-proof-point-evidence-ed25519";
export const defaultSignatureAlgorithm = "ed25519-local-proof-signature";
export const defaultSignerRole = "ISSO";
const runtimeEvidenceSigningKey = generateKeyPairSync("ed25519");
export const defaultEvidenceSigner = createEd25519EvidenceSigner({
  keyId: defaultEvidenceSignatureKeyId,
  privateKey: runtimeEvidenceSigningKey.privateKey
});
export const defaultTrustedEvidenceSigningKeys: TrustedEvidenceSigningKeyRegistry = Object.freeze({
  [defaultEvidenceSignatureKeyId]: {
    algorithm: defaultSignatureAlgorithm,
    publicKey: runtimeEvidenceSigningKey.publicKey
  },
  [checkedInFixtureSignatureKeyId]: {
    algorithm: defaultSignatureAlgorithm,
    publicKey: [
      "-----BEGIN PUBLIC KEY-----",
      "MCowBQYDK2VwAyEAJ7SpvBRUTsRbE+kFLruIT17vej9Z3ofIBMV8ODHGarI=",
      "-----END PUBLIC KEY-----"
    ].join("\n")
  }
});

export function createEd25519EvidenceSigner(options: {
  keyId: SignedEvidencePackage["keyId"];
  privateKey: EvidencePrivateSigningKey;
  signerRole?: string;
  signatureAlgorithm?: SignedEvidencePackage["signatureAlgorithm"];
}): EvidenceSigner {
  const signatureAlgorithm = options.signatureAlgorithm ?? defaultSignatureAlgorithm;
  return {
    keyId: options.keyId,
    signatureAlgorithm,
    signerRole: options.signerRole ?? defaultSignerRole,
    sign(unsignedPackage) {
      const signature = signPayload(
        null,
        Buffer.from(stableStringify(unsignedPackage)),
        options.privateKey
      );
      return `${signatureAlgorithm}:${signature.toString("base64url")}`;
    }
  };
}

function resolveEvidenceSigner(options: EvidenceSigningOptions): EvidenceSigner {
  return options.signer ?? defaultEvidenceSigner;
}

function resolveEvidenceVerificationOptions(options?: string | EvidenceVerificationOptions): {
  trustedKeys: TrustedEvidenceSigningKeyRegistry;
  verifiedAt?: string;
} {
  if (typeof options === "string") {
    return {
      trustedKeys: defaultTrustedEvidenceSigningKeys,
      verifiedAt: options
    };
  }

  return {
    trustedKeys: options?.trustedKeys ?? defaultTrustedEvidenceSigningKeys,
    verifiedAt: options?.verifiedAt
  };
}

export function finalizeEvidenceExport(draft: EvidenceExportDraft, options: EvidenceIntegrityOptions = {}): EvidenceExport {
  const signer = resolveEvidenceSigner(options);
  assertTrustedKeysCoverCustomSigner(signer, options);
  const content = buildEvidencePackageContent(draft, {
    signatureRef: {
      keyId: signer.keyId
    }
  });

  const evidenceWithIntegrity = attachEvidenceIntegrityManifest(content);
  const signedEvidence = attachSignedEvidencePackage(evidenceWithIntegrity, { signer });

  return attachEvidenceVerifierChecks(signedEvidence, options);
}

function assertTrustedKeysCoverCustomSigner(signer: EvidenceSigner, options: EvidenceIntegrityOptions): void {
  if (options.signer && !options.trustedKeys?.[signer.keyId]) {
    throw new Error(`Evidence trustedKeys must include custom signer key ${signer.keyId} before verifier checks can be embedded.`);
  }
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
          "Canonicalize each named section and compare sha256 values with integrityManifest.sections.",
          "Verify signedPackage.signature over the signed metadata using the trusted public key for signedPackage.keyId."
        ]
      },
      version: "evidence-integrity-manifest:v1"
    }
  };
}

export function attachSignedEvidencePackage(
  evidence: EvidenceExportWithIntegrity,
  options: EvidenceSigningOptions = {}
): EvidenceExportWithSignature {
  const signer = resolveEvidenceSigner(options);
  const packageId = signedEvidencePackageId(evidence.exportId);
  const keyId = signer.keyId;
  const deploymentScope = evidence.oscal.systemSecurityPlan.deploymentScope;
  const reviewedStatementRefs = evidence.controlStatements.map((statement) => evidenceControlStatementRef(statement.controlId));
  const controlTraceIds = evidence.controlTraceViews.map((trace) => trace.traceId);
  const unsignedPackage: Omit<SignedEvidencePackage, "signature"> = {
    packageId,
    packageHash: evidence.integrityManifest.packageHash,
    hashAlgorithm: "sha256",
    canonicalization: "stable-json",
    signatureAlgorithm: signer.signatureAlgorithm,
    keyId,
    signedAt: evidence.generatedAt,
    signerRole: signer.signerRole,
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
      signature: signer.sign(unsignedPackage)
    }
  };
}

export function attachEvidenceVerifierChecks(
  evidence: EvidenceExportWithSignature,
  options: EvidenceVerificationOptions = {}
): EvidenceExport {
  const report = verifyEvidenceExport({ ...evidence, verifierChecks: [] }, options);
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

export function verifyEvidenceExport(value: unknown, verifiedAt?: string): EvidenceVerificationReport;
export function verifyEvidenceExport(value: unknown, options?: EvidenceVerificationOptions): EvidenceVerificationReport;
export function verifyEvidenceExport(value: unknown, verifiedAtOrOptions?: string | EvidenceVerificationOptions): EvidenceVerificationReport {
  const verificationOptions = resolveEvidenceVerificationOptions(verifiedAtOrOptions);

  if (!isRecord(value)) {
    return {
      status: "failed",
      verifiedAt: verificationOptions.verifiedAt ?? new Date().toISOString(),
      checks: [fail("package_shape", "Evidence package must be a JSON object.")],
      version: "evidence-verification-report:v1"
    };
  }

  const evidence = value as Partial<EvidenceExport>;
  const checks: EvidenceVerifierCheck[] = [];
  const reportTime = verificationOptions.verifiedAt ?? (typeof evidence.generatedAt === "string" ? evidence.generatedAt : new Date().toISOString());

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
    const trustedKey = verificationOptions.trustedKeys[evidence.signedPackage.keyId];

    if (!trustedKey) {
      return fail(
        "signed_package_signature",
        "Signed package key is not trusted by this verifier.",
        Object.keys(verificationOptions.trustedKeys).join(","),
        evidence.signedPackage.keyId
      );
    }

    if (trustedKey.algorithm !== evidence.signedPackage.signatureAlgorithm) {
      return fail(
        "signed_package_signature",
        "Signed package algorithm does not match the trusted key.",
        trustedKey.algorithm,
        evidence.signedPackage.signatureAlgorithm
      );
    }

    return verifySignedPackageSignature(evidence.signedPackage, trustedKey.publicKey)
      ? pass("signed_package_signature", "Signed package proof signature verifies with a trusted key.")
      : fail(
          "signed_package_signature",
          "Signed package proof signature does not verify with a trusted key.",
          `${trustedKey.algorithm}:<trusted-signature>`,
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

function verifySignedPackageSignature(signedPackage: SignedEvidencePackage, publicKey: Parameters<typeof verifyPayload>[2]): boolean {
  const { signature, ...unsignedPackage } = signedPackage;
  const signaturePrefix = `${signedPackage.signatureAlgorithm}:`;

  if (!signature.startsWith(signaturePrefix)) {
    return false;
  }

  try {
    return verifyPayload(
      null,
      Buffer.from(stableStringify(unsignedPackage)),
      typeof publicKey === "string" ? createPublicKey(publicKey) : publicKey,
      Buffer.from(signature.slice(signaturePrefix.length), "base64url")
    );
  } catch {
    return false;
  }
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
