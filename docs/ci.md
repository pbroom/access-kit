# CI And Contract Validation

## Required Checks

The repo treats API and evidence contracts as first-class CI gates. Automation-specific validation reads `scripts/lib/automation-contract.ts`, the typed manifest that defines package-script expectations, CI job command expectations, steward label policy, stack readiness rules, and proof-point evidence command ordering.

- `pnpm validate:contracts` validates JSON Schemas, OpenAPI paths, API examples, contract snapshots, generated client metadata, policy model validation, policy proof points, connector security gates, and CLI-to-API command mappings.
- `pnpm validate:connector-security` validates connector identity, consent, tenant boundaries, least-privilege read scopes, pagination, throttling, deletion semantics, coverage-warning requirements, secret handling, and no-write defaults, including approved live-read Microsoft Graph and AWS scopes when optional sandbox connectors are registered.
- `pnpm validate:docs` validates relative Markdown links, required runbook sections, documentation examples against JSON Schema/OpenAPI contracts, and generated API reference freshness.
- `pnpm validate:automation` validates the implementation backlog, PR state labels, steward scripts, automation docs, and CI automation gate.
- `pnpm validate:ci` validates that the GitHub Actions workflow still contains the expected contract, quality, evidence, and security jobs.
- `pnpm validate:packaging` validates the deployable API Dockerfile, runtime healthcheck, non-root container contract, and container CI smoke-test wiring.
- `pnpm validate:release-packaging` validates the GHCR release workflow, publish gates, SBOM/provenance metadata, artifact attestation, and keyless signing wiring.
- `pnpm validate:deployment-manifests` validates the Kubernetes manifests, probe wiring, secret references, restricted runtime security, network policy, and signed-image admission policy example.
- `pnpm validate:persistence-deployment` validates the schema-backed synthetic production persistence manifest, retained readiness report artifact, external backend readiness, IaC output references, release approval, backup/restore, operator controls, and blocked local proof-point manifests.
- `pnpm validate:secure-sdlc` validates release-retained SAST, DAST, dependency scan, SBOM, fuzzing, tenant-isolation abuse, threat-model, vulnerability triage, and NIST SSDF evidence.
- `pnpm validate:live-enforcement-pilot` validates the schema-backed controlled live enforcement pilot manifest, retained readiness report artifact, read-only confidence evidence, least-privilege write-scope review, approval workflow, degraded-runtime blocking, verification and rollback hooks, emergency revocation runbooks, and release gate.
- `pnpm test:core` includes shared repository conformance coverage for in-memory proof-point repositories, local JSON graph/job stores, and the production graph, connector-state, and queue adapters.
- `pnpm exec vitest run tests/connectors` covers connector package behavior, including Microsoft Graph Entra, app-role mapping, guest and external users, Microsoft 365/Teams coupling, SharePoint and OneDrive inventory, native grant readback, Graph change-notification and Power Platform/Dataverse unsupported-coverage warnings, delta cursor redaction, tombstones, stale-delta recovery, drift findings, AWS read-only inventory, AWS EventBridge and CloudTrail latency confidence, and the sample read-only connector template with fixture-backed pagination, throttling, redaction, no-write behavior, stale-grant replacement, security-gate behavior, and optional runtime registration.
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

`deploy/kubernetes/`, `deploy/policies/kyverno/`, `deploy/persistence/`, and `deploy/live-enforcement-pilot/` are validated in the contract-validation job so probe, admission-policy, persistence deployment evidence, and live-pilot gate drift fails before review.

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
pnpm automation:doctor
pnpm labels:sync
```

`pnpm pr:status`, `pnpm stack:ready`, and `pnpm automation:doctor` require GitHub CLI authentication and network access. `pnpm labels:sync` creates or updates the labels defined in `scripts/lib/automation-contract.ts` and never deletes existing labels.
