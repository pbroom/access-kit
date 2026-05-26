# Security Policy

Access Kit is a security-sensitive proof-point control plane. Please report suspected vulnerabilities privately and avoid publishing exploit details before a fix and disclosure plan are ready.

## Supported Versions

| Version | Status | Security support |
| --- | --- | --- |
| `0.1.x` | Proof point | Best-effort security fixes for repository contracts, release packaging, local runtime guardrails, container publication, and documentation claims. |
| Future production-ready releases | Planned | Production support terms will be published before any production-ready claim. |

## Reporting A Vulnerability

Use GitHub private vulnerability reporting for this repository when available:

```text
https://github.com/pbroom/access-kit/security/advisories/new
```

If private vulnerability reporting is unavailable, contact the maintainers through a minimal public issue that asks for a private security contact without sharing exploit details, secrets, tenant identifiers, customer data, or reproduction payloads.

## Disclosure And CVE Path

The maintainers will triage privately, determine severity, prepare a fix branch, run the release validation gates, and publish a patched release when ready. If the vulnerability has impact beyond local proof-point evaluation or affects published artifacts, the disclosure path is:

1. Create or update a GitHub Security Advisory.
2. Request a CVE through GitHub Security Advisories when the issue meets CVE criteria.
3. Publish patched source, container, CLI, SDK, docs, and release manifest artifacts as applicable.
4. Update `CHANGELOG.md`, release notes, affected-version ranges, mitigations, and validation evidence.
5. Disclose publicly after the patched release and advisory are available.

Security advisories must clearly state whether the affected behavior is local proof-point only, deployment-reference only, or production-ready. No advisory should imply FedRAMP authorization, ATO approval, or production incident coverage for the current proof-point release line.

## Release Security Evidence

Release artifacts should retain or link to the evidence required by [Product Release Packaging](docs/release-packaging.md): SBOM, provenance, signature, vulnerability disclosure path, compatibility matrix, changelog, and proof-point versus production-ready labels.

