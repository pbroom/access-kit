# Changelog

All notable Access Kit release-channel changes are recorded here. The current project state is a proof-point distribution and does not claim production authorization readiness.

## 0.1.0 Proof-Point Release

Initial product release packaging contract for stable adoption channels:

- source release notes and manifest shape for versioned product releases
- `rebac-api` container release workflow with GHCR publishing gates, SBOM, provenance metadata, GitHub artifact attestation, and keyless cosign signing
- SDK package channel for `@access-kit/api-contracts` contract consumers
- CLI binary package channel for `@access-kit/cli`, dependency-gated on AK-031 operator distribution work
- versioned docs-site entry points, compatibility matrix, support policy, security policy, and CVE disclosure path
- explicit proof-point labels for all artifacts and production-ready disclaimers for deployment use

### Container Image Release Notes

The `rebac-api-v0.1.0` container channel packages the local API runtime for deployment exercises. Published image digests must be verified with cosign and GitHub artifact attestations before promotion. The image remains a proof point until deployment-specific IdP or mTLS authentication, admin authorization, secrets management, audit retention, SIEM delivery, backup and restore, and assessor-reviewed controls are supplied.
