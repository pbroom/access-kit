# Support Policy

Access Kit support is organized around versioned proof-point releases and future production-ready releases. The current `0.1.x` line is a proof-point channel for evaluation, integration planning, and evidence inspection. It is not production authorization support.

## Supported Channels

| Channel | Scope | Support expectation |
| --- | --- | --- |
| `0.1.x` proof point | Local API, CLI, contract schemas, container workflow, docs, and synthetic evidence examples | Best-effort fixes for validation, packaging, documentation, and security issues. |
| Future minor proof points | Additional connectors, deployment overlays, governance evidence, and SDK/CLI surfaces | Best-effort compatibility across the documented matrix. |
| Future production-ready release | Deployment-specific controls after security, operations, and assessor review | Defined separately with customer incident, patch, and end-of-support terms. |

Proof-point releases may receive patches for broken validation, incorrect release metadata, dependency vulnerabilities, documentation errors, and package or container publication problems. They do not include service-level objectives, emergency production incident response, live-tenant remediation, or assessor approval.

## Compatibility Promise

Within a supported proof-point minor line:

- JSON Schema, OpenAPI, release manifest, and CLI output changes should be backward-compatible.
- Breaking changes require a minor or major release note and migration guidance.
- Container tags are convenience pointers; deployments must use signed immutable digests.
- Docs must continue to label proof-point evidence separately from production-ready controls.

## End Of Support

The latest proof-point minor release is supported until the next minor proof-point release has a documented migration path. Deprecated artifacts remain visible in the changelog and release manifest, but they should not be used for new evaluations after a replacement line is published.

## Requesting Help

Use GitHub issues for non-sensitive bugs, docs errors, release packaging drift, and compatibility questions. Do not include secrets, tenant IDs, live provider identifiers, customer names, tokens, or exploit details in public issues.

For suspected vulnerabilities, follow the private disclosure process in [Security Policy](../SECURITY.md).
