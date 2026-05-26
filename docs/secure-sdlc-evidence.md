# Secure SDLC Evidence

This page defines the release-retained secure SDLC evidence package for the local proof point. It is not a production scanner deployment, penetration test, or vulnerability acceptance record. Production releases must replace the example evidence with environment-specific scan outputs, tickets, approvals, and retained artifacts.

## Release Evidence Manifest

The canonical example is `release/security-evidence/ak-044-secure-sdlc.example.json`. `pnpm validate:secure-sdlc` validates that every release package accounts for:

- SAST evidence from CodeQL and build-backed static analysis
- DAST release-gate evidence for deployed environment scanning
- dependency scan evidence
- SBOM and provenance evidence
- malformed input fuzzing evidence
- tenant-isolation abuse-test evidence
- threat-model refresh evidence
- vulnerability triage evidence
- NIST SSDF evidence mapping

Each artifact maps to an owner, retained paths, NIST control families, per-release retention, and mitigation references for authorization, connector, persistence, cross-tenant isolation, and evidence-abuse paths.

## Release Gate

Before a release can claim secure SDLC readiness, the release owner must retain:

1. CI and security workflow URLs for the release commit.
2. dependency audit and secret-scan results.
3. CodeQL or equivalent SAST results.
4. SBOM/provenance and signed-image attestation outputs.
5. fuzzing and tenant-isolation abuse-test results.
6. a threat-model review note for changed trust boundaries.
7. vulnerability triage records for open high or critical findings.
8. DAST output or a deployment-scoped exception explaining why DAST was not runnable.
9. NIST SSDF mapping for the release evidence.
10. mitigation references tying the retained artifacts to the release's authorization, connector, persistence, cross-tenant isolation, and evidence-abuse safeguards.

## Fail-Closed Criteria

The release must stop before promotion when evidence is missing, a high or critical finding lacks triage, DAST is skipped without a deployment-scoped exception, SBOM/provenance is absent, tenant-isolation abuse tests fail, or threat-model changes are not reviewed.

## Scope Boundary

The repository keeps synthetic proof-point evidence and validation gates. It does not store live vulnerability exports, production tenant identifiers, scanner credentials, private SBOM distribution endpoints, or assessor-approved risk acceptances.
