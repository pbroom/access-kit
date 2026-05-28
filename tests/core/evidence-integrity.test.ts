import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildEvidencePackageContent,
  createEd25519EvidenceSigner,
  finalizeEvidenceExport,
  verifyEvidenceExport,
  type EvidenceExportDraft,
  type TrustedEvidenceSigningKeyRegistry
} from "../../packages/core/src/index.js";

const TEST_NOW = "2026-05-21T00:00:00.000Z";

describe("evidence integrity package construction", () => {
  it("builds OSCAL, POA&M, deployment scope, and control traces before integrity metadata", () => {
    const packageContent = buildEvidencePackageContent(buildEvidenceDraft(), {
      signatureRef: {
        packageId: "signed-package:test-evidence",
        keyId: "key:test-evidence"
      }
    });

    expect("integrityManifest" in packageContent).toBe(false);
    expect("signedPackage" in packageContent).toBe(false);
    expect(packageContent.poamExport).toMatchObject({
      uuid: "oscal-poam:evidence:test",
      version: "oscal-poam-export:v1"
    });
    expect(packageContent.oscal.systemSecurityPlan.deploymentScope).toMatchObject({
      boundaryId: "boundary:test",
      controls: ["AC-3"],
      componentIds: ["component:api"]
    });
    expect(packageContent.controlTraceViews).toEqual([
      expect.objectContaining({
        controlId: "AC-3",
        signatureRef: {
          packageId: "signed-package:test-evidence",
          keyId: "key:test-evidence"
        }
      })
    ]);
  });

  it("finalizes evidence with an injected signer and trusted-key registry", () => {
    const keyPair = generateKeyPairSync("ed25519");
    const signer = createEd25519EvidenceSigner({
      keyId: "key:test-evidence-ed25519",
      privateKey: keyPair.privateKey,
      signerRole: "Test Evidence Signer"
    });
    const trustedKeys: TrustedEvidenceSigningKeyRegistry = {
      [signer.keyId]: {
        algorithm: signer.signatureAlgorithm,
        publicKey: keyPair.publicKey
      }
    };

    const evidence = finalizeEvidenceExport(buildEvidenceDraft(), { signer, trustedKeys });

    expect(evidence.signedPackage).toMatchObject({
      keyId: signer.keyId,
      signerRole: "Test Evidence Signer",
      signatureAlgorithm: "ed25519-local-proof-signature"
    });
    expect(evidence.controlTraceViews[0]?.signatureRef).toEqual({
      packageId: evidence.signedPackage.packageId,
      keyId: signer.keyId
    });
    expect(evidence.verifierChecks.every((check) => check.status === "pass")).toBe(true);
    expect(verifyEvidenceExport(evidence, { trustedKeys })).toMatchObject({
      status: "verified",
      packageHash: evidence.integrityManifest.packageHash
    });
  });
});

function buildEvidenceDraft(): EvidenceExportDraft {
  return {
    exportId: "evidence:test",
    framework: "nist-800-53",
    controls: ["AC-3"],
    periodStart: TEST_NOW,
    periodEnd: TEST_NOW,
    generatedAt: TEST_NOW,
    evidenceTypes: ["decision_logs"],
    sourceEventIds: ["audit:event:1"],
    responsibleRole: "ISSO",
    format: "json",
    auditIntegrity: {
      status: "verified",
      eventCount: 1,
      verifiedAt: TEST_NOW,
      firstEventId: "audit:event:1",
      lastEventId: "audit:event:1",
      findings: [],
      version: "audit-integrity-report:v1"
    },
    controlMappings: [
      {
        controlId: "AC-3",
        family: "AC",
        status: "implemented",
        implementationSummary: "Access enforcement decisions are captured as evidence.",
        evidenceTypes: ["decision_logs"],
        sourceEventIds: ["audit:event:1"],
        gaps: []
      }
    ],
    artifacts: [
      {
        name: "control-mapping",
        type: "control_mapping",
        description: "Control mapping evidence",
        format: "json"
      }
    ],
    conmonMetrics: [],
    poamItems: [],
    siemExport: {
      format: "jsonl",
      eventCount: 1,
      schemaVersion: "audit-event:v1",
      includesPayloadHashes: true,
      target: "operator_download"
    },
    systemBoundary: {
      boundaryId: "boundary:test",
      name: "Test boundary",
      description: "Synthetic test boundary",
      environment: "local_proof_point",
      liveTenantData: false,
      components: [
        {
          id: "component:api",
          name: "API",
          type: "control_plane",
          trustZone: "local_runtime",
          dataClassification: "synthetic",
          description: "Synthetic API component"
        }
      ],
      externalSystems: [],
      assumptions: [],
      version: "system-boundary:v1"
    },
    dataFlows: [
      {
        id: "data-flow:api",
        name: "API audit flow",
        source: "component:api",
        destination: "component:api",
        dataTypes: ["audit_events"],
        protections: ["hashing"],
        liveTenantData: false
      }
    ],
    controlStatements: [
      {
        controlId: "AC-3",
        status: "implemented",
        statement: "Access enforcement decisions are reviewed as evidence.",
        responsibleRole: "ISSO",
        reviewerRole: "Security Control Assessor",
        reviewedAt: TEST_NOW,
        evidenceTypes: ["decision_logs"],
        sourceArtifactNames: ["control-mapping"],
        gaps: []
      }
    ],
    accessReviews: [],
    exceptionRegister: [],
    operationalEvidence: []
  };
}
