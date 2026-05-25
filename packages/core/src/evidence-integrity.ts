import { sha256 } from "./audit.js";
import type { EvidenceExport } from "./domain.js";

export type EvidenceExportWithoutIntegrity = Omit<EvidenceExport, "integrityManifest" | "storageReceipt">;

export function attachEvidenceIntegrityManifest(evidence: EvidenceExportWithoutIntegrity): EvidenceExport {
  return {
    ...evidence,
    integrityManifest: {
      packageHash: hashReference(evidence),
      hashAlgorithm: "sha256",
      canonicalization: "stable-json",
      generatedAt: evidence.generatedAt,
      sections: [
        evidenceSectionHash("auditIntegrity", evidence.auditIntegrity),
        evidenceSectionHash("controlMappings", evidence.controlMappings),
        evidenceSectionHash("artifacts", evidence.artifacts),
        evidenceSectionHash("systemBoundary", evidence.systemBoundary),
        evidenceSectionHash("dataFlows", evidence.dataFlows),
        evidenceSectionHash("accessReviews", evidence.accessReviews),
        evidenceSectionHash("exceptionRegister", evidence.exceptionRegister),
        evidenceSectionHash("operationalEvidence", evidence.operationalEvidence),
        evidenceSectionHash("siemExport", evidence.siemExport)
      ],
      verifier: {
        documentationPath: "docs/evidence-integrity-verifier.md",
        summary: "Recompute the stable-json package hash before storageReceipt is added and compare section hashes.",
        verificationSteps: [
          "Remove storageReceipt if present.",
          "Remove integrityManifest from the evidence package.",
          "Canonicalize the remaining package with stable JSON key ordering.",
          "Compute sha256 over the canonical package and compare it with integrityManifest.packageHash.",
          "Canonicalize each named section and compare sha256 values with integrityManifest.sections."
        ]
      },
      version: "evidence-integrity-manifest:v1"
    }
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
