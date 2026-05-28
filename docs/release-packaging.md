# Product Release Packaging

Access Kit publishes release channels for evaluation, integration planning, and deployment exercises without requiring adopters to clone a moving branch. The current channel is a proof-point distribution. It is not a production authorization service, a FedRAMP authorization package, or an approved agency ATO.

## Release Status

| Item | Current channel | Production-ready claim |
| --- | --- | --- |
| Source and changelog | Versioned tag and [CHANGELOG](../CHANGELOG.md) | No. Source releases are proof-point software until deployment-specific controls are approved. |
| API container image | `rebac-api-v*` tag workflow to GHCR | No. Images include SBOM, provenance, attestation, and signature proof points, but production use still needs environment approval. |
| CLI binary package | `@access-kit/cli` package channel after AK-031 lands | No. CLI packages are operator proof points until production admin authorization is deployed. |
| SDK packages | `@access-kit/api-contracts` and generated contract artifacts | No. SDKs expose contracts and examples, not a production control-plane entitlement. |
| Docs site | Versioned docs rooted at [Start Here](start-here.md) | No. Docs are adoption and assessment aids, not assessor approval. |
| Support and security policies | [Support Policy](support-policy.md) and [Security Policy](../SECURITY.md) | No. Policies define response expectations and disclosure paths; they do not replace customer incident response. |

## Versioning

Release tags use the product version and artifact-specific prefixes:

| Artifact | Tag or package shape | Notes |
| --- | --- | --- |
| Product source release | `access-kit-v<major>.<minor>.<patch>` | Used for source archives, changelog entries, docs snapshots, and release manifests. |
| API container image | `rebac-api-v<major>.<minor>.<patch>` | Triggers `.github/workflows/container-release.yml` and publishes immutable GHCR digest references. |
| CLI package | `@access-kit/cli@<major>.<minor>.<patch>` | Publishes the `rebac` binary wrapper when AK-031 operator packaging is in the stack. |
| SDK package | `@access-kit/api-contracts@<major>.<minor>.<patch>` | Publishes OpenAPI, JSON Schema, generated client metadata, and contract snapshots. |

Patch releases keep the same contract family and may include docs, validation, packaging, dependency, or security fixes. Minor releases may add new API fields, CLI commands, schemas, examples, or compatibility rows. Major releases are reserved for breaking API, schema, CLI, package, or evidence-contract changes.

## Release Manifest

Every product release keeps a machine-readable manifest under `releases/<version>/manifest.json`. The manifest is validated by `pnpm validate:release-packaging` and records:

- source, container, CLI, SDK, and docs-site adoption channels
- release notes and changelog references
- compatibility matrix rows for Node, pnpm, API, CLI, container, docs, Kubernetes, and schema contracts
- SBOM, provenance, signature, vulnerability disclosure, and CVE path requirements
- proof-point versus production-ready labels for each artifact

The canonical example for the current proof-point release is [`releases/v0.1.0/manifest.json`](../releases/v0.1.0/manifest.json).

## Artifact Gates

| Artifact | Required release evidence | Validation owner |
| --- | --- | --- |
| Source archive | Tag, changelog entry, manifest, docs snapshot, dependency audit result | Product release owner |
| API container | GHCR digest, Buildx SBOM, Buildx provenance metadata, GitHub artifact attestation, keyless cosign signature | Platform release owner |
| CLI package | npm provenance, package tarball hash, profile/config docs, JSON output and exit-code validation | Operator experience owner |
| SDK package | npm provenance, generated API reference freshness, schema validation, generated client snapshot | API contracts owner |
| Docs site | versioned docs root, compatibility matrix, proof-point labels, support and security policy links | Docs owner |

Do not promote an artifact when its release notes omit proof-point limitations, when vulnerability disclosure is missing, or when SBOM/provenance/signature evidence is unavailable for an artifact type that supports it.

## Compatibility Matrix

| Component | Supported in this proof point | Notes |
| --- | --- | --- |
| Node.js | 22.x and 24.x in CI | Node 22 is the runtime baseline. |
| pnpm | 10.30.3 | The repo pins pnpm through `packageManager`. |
| API contract | `openapi/rebac-control-plane.yaml` | Backward-compatible additions are allowed in minor releases. |
| CLI | `rebac` command tree | Package publication depends on AK-031 and remains an operator proof point. |
| Container runtime | `rebac-api` on Node 22 | Requires bearer tokens for non-loopback binding. |
| Kubernetes | Reference manifests under `deploy/kubernetes/` | Reference overlays are not production approval. |
| Docs site | Versioned Markdown docs | Docs explain adoption and evidence, not production authorization. |
| Release manifest | `product-release-manifest:v1` | Schema changes require a manifest version bump. |

## Publishing Flow

1. Confirm dependency PRs are merged or explicitly called out as dependency-gated in the release manifest.
2. Run `corepack pnpm ci:check` and `git diff --check`.
3. Update `CHANGELOG.md`, `docs/release-packaging.md`, and `releases/<version>/manifest.json`.
4. Create the product source tag and release notes.
5. Push a `rebac-api-v*` tag for the container workflow and verify the GHCR digest, SBOM, provenance, attestation, and cosign signature.
6. Publish CLI and SDK packages with npm provenance when their package workspaces are release-ready.
7. Publish the versioned docs site snapshot and link the compatibility matrix, support policy, security policy, and release manifest.
8. Record release evidence in the product release notes and retain proof of validation.

## Support And Security

Support windows, channel expectations, and end-of-support handling live in [Support Policy](support-policy.md). Vulnerability reporting, embargo handling, security advisories, and CVE disclosure live in [Security Policy](../SECURITY.md).

Security fixes should include a patched release tag, a changelog entry, updated release notes, and retained validation evidence. A CVE is requested through GitHub Security Advisories when the issue meets the disclosure threshold and the fix is ready to publish.

