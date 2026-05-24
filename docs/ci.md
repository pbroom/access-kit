# CI And Contract Validation

## Required Checks

The repo treats API and evidence contracts as first-class CI gates.

- `pnpm validate:contracts` validates JSON Schemas, OpenAPI paths, policy proof points, and CLI-to-API command mappings.
- `pnpm validate:docs` validates relative Markdown links, required runbook sections, and documentation examples against JSON Schema/OpenAPI contracts.
- `pnpm validate:automation` validates the implementation backlog, PR state labels, steward scripts, automation docs, and CI automation gate.
- `pnpm validate:ci` validates that the GitHub Actions workflow still contains the expected contract, quality, evidence, and security jobs.
- `pnpm validate:packaging` validates the deployable API Dockerfile, runtime healthcheck, non-root container contract, and container CI smoke-test wiring.
- `pnpm validate:release-packaging` validates the GHCR release workflow, publish gates, SBOM/provenance metadata, artifact attestation, and keyless signing wiring.
- `pnpm validate:deployment-manifests` validates the Kubernetes manifests, probe wiring, secret references, restricted runtime security, network policy, and signed-image admission policy example.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` verify TypeScript quality across supported Node versions.
- `pnpm evidence:check` regenerates proof-point evidence in check mode and fails when the committed report no longer matches the normalized generated output.
- `pnpm audit --audit-level high`, Gitleaks, and CodeQL provide initial dependency, secret, and static-analysis coverage.

## GitHub Actions

`.github/workflows/ci.yml` runs:

- Contract validation on Node 22.
- Documentation foundation validation on Node 22.
- Automation contract validation on Node 22.
- Typecheck, lint, tests, and build on Node 22 and Node 24.
- Evidence report freshness on Node 24.
- Container packaging by building the `rebac-api` runtime image and smoke-testing health, readiness, and bearer-token API protection.

`.github/workflows/container-release.yml` runs on `rebac-api-v*` tags or manual dispatch:

- Build the same `runtime` image target with Docker Buildx.
- Publish to GHCR only for release tags or explicit `publish=true` manual dispatches.
- Emit SBOM/provenance metadata, push GitHub artifact attestations, and sign the published digest with keyless cosign.

`deploy/kubernetes/` and `deploy/policies/kyverno/` are validated in the contract-validation job so probe and admission-policy drift fails before review.

`.github/workflows/security.yml` runs:

- Dependency audit on pull requests, pushes, and weekly schedule.
- Secret scanning with full git history.
- CodeQL JavaScript/TypeScript analysis.

`.github/workflows/pr-steward.yml` runs hourly and on demand:

- `pnpm steward:check` to summarize open PR state, labels, checks, and next actions.
- `pnpm backlog:next` to show the next scoped implementation candidate.

## Local Preflight

Use this before submitting stack changes:

```sh
pnpm ci:check
git diff --check
```

`pnpm ci:check` is intentionally stricter than a quick test run. It exercises contract validation, CI workflow validation, type checking, linting, tests, build, and evidence freshness.

## Steward Commands

Use these commands to keep PR-stack state boring and explicit:

```sh
pnpm pr:status
pnpm backlog:batch
pnpm backlog:next
pnpm stack:ready
pnpm security:pass
pnpm labels:sync
```

`pnpm pr:status` and `pnpm stack:ready` require GitHub CLI authentication. `pnpm labels:sync` creates or updates the labels defined in `.github/labels.yml` and never deletes existing labels.
