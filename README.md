# Access Kit

Access Kit is an API-first and CLI-first foundation for an ATO-ready relationship-based authorization control plane. It defines the public contracts, deterministic decision behavior, operator CLI surface, connector boundary, audit trail, and evidence package shape before any production live-provider writes, Active Directory or Power Platform enforcement, or dashboard work. Staged read-only Microsoft Graph and AWS discovery foundations are present as sandbox proof points.

The current repository is a local proof point. It is built for contract validation, runtime behavior checks, assessor inspection, and implementation planning. It is not a production authorization service yet.

Start with the [Product Positioning And Adoption Guide](docs/product-positioning-adoption-guide.md) when deciding whether Access Kit fits an adoption path. It separates fit, non-goals, proof-point evidence, production-readiness gaps, and buyer, developer, and assessor evaluation checklists.

## What It Does

- Evaluates ReBAC `check`, `explain`, and batch decision requests with deterministic deny-by-default behavior.
- Exposes an OpenAPI-shaped local API runtime plus a `rebac-api` service entrypoint.
- Provides a `rebac` CLI command tree that calls the API instead of evaluating authorization locally.
- Models subjects, resources, relationships, policies, provisioning plans, reconciliation findings, audit records, evidence exports, and connector state.
- Includes mock and synthetic read-only connector fixtures plus optional Microsoft Graph and AWS read-only connector foundations for sandbox evidence without provider writes.
- Supports dry-run provisioning and synthetic-only controlled enforcement through explicit readiness, approval, incident-mode, rollback, and break-glass guardrails.
- Produces validation evidence, audit-integrity checks, SIEM-ready audit export shapes, and local ATO evidence package flows.
- Tracks implementation slices in a durable backlog and includes steward scripts for PR status, stack readiness, labels, and next-slice selection.

## What It Is Not

- It is not an identity provider or authentication system.
- It is not a SIEM, ticketing system, or generic workflow platform.
- It is not an AWS IAM, Entra ID, Active Directory, SharePoint, Teams, or Power Platform replacement.
- It is not a UI-first admin portal.
- It does not use an LLM to make authorization decisions.
- It does not claim a production ATO.

## Quickstart

Use Node 22 or newer. The repo is pinned for pnpm 10.

```sh
corepack enable
pnpm install
pnpm validate
```

For pre-submit confidence, run the full CI-equivalent gate:

```sh
pnpm ci:check
```

`pnpm validate` runs type checking, contract and sample-policy validation, automation and CI workflow validation, packaging/release packaging validation, deployment manifest validation, persistence deployment evidence validation, runbook exercise validation, secure SDLC release evidence validation, live-enforcement pilot validation, PEP conformance, sample app validation, and the test suite.

`pnpm ci:check` adds docs validation, lint, build, and evidence freshness checks.

For the shortest runnable API path, start the compose quickstart and run the seeded demo:

```sh
docker compose -f docker-compose.quickstart.yml up --build -d
pnpm quickstart:demo
```

The flow uses the synthetic demo seed harness, calls `check` and `explain`, and shows both allow and deny-by-default results. See [`docs/five-minute-quickstart.md`](docs/five-minute-quickstart.md).

For the full local evaluation path, keep the same API running and execute:

```sh
pnpm evaluation:demo
```

The evaluation runner adds policy validation and tests, all evaluation check and explain presets, dry-run provisioning, reconciliation, audit export, and evidence export. See [`docs/developer-evaluation-path.md`](docs/developer-evaluation-path.md).

## Run The Local API

For local development, run the API directly from TypeScript:

```sh
pnpm exec tsx packages/api/src/bin.ts
```

The API listens on `127.0.0.1:3000` by default. Useful environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `REBAC_API_HOST` | `127.0.0.1` | Bind host. Non-loopback hosts require bearer tokens. |
| `REBAC_API_PORT` | `3000` | Bind port. |
| `REBAC_API_ACTOR` | `service:api` | Default actor for service-emitted audit events when bearer tokens are unlabeled or auth is disabled on loopback. |
| `REBAC_API_KEYS` | unset | Comma-separated bearer tokens for `/v1` routes except health and readiness. Optional `label:token` entries record audit events as `api-key:<label>`. |
| `REBAC_STATE_PATH` | unset | Optional JSON runtime state snapshot path. |
| `REBAC_EVIDENCE_ROOT` | unset | Optional local persistence root for audit records and evidence packages. |

Public probes:

```sh
curl http://127.0.0.1:3000/v1/health
curl http://127.0.0.1:3000/v1/ready
```

When `REBAC_API_KEYS` is set, call protected routes with `Authorization: Bearer <token>`. Entries may use optional labels as `label:token`; labeled tokens record audit events under `api-key:<label>` while unlabeled tokens use `REBAC_API_ACTOR`. Because the first colon opts an entry into labeled parsing, deployments upgrading with existing opaque tokens that contain `:` must rotate those tokens to colon-free values first. The runtime refuses to bind beyond loopback without keys, audits failed authentication attempts, and excludes token material from logs.

## Run The CLI

Point the CLI at a running API with `--api-url` or `REBAC_API_URL`:

```sh
REBAC_API_URL=http://127.0.0.1:3000 pnpm exec tsx packages/cli/src/bin.ts check user:123 read document:case-plan
REBAC_API_URL=http://127.0.0.1:3000 pnpm exec tsx packages/cli/src/bin.ts explain user:123 read document:case-plan
REBAC_API_URL=http://127.0.0.1:3000 pnpm exec tsx packages/cli/src/bin.ts connector list
```

The CLI is an operator wrapper over the API contract. Authorization logic belongs in the API/core engine, not in the CLI.

## Evidence And Validation

Generate or check the proof-point validation report:

```sh
pnpm evidence:generate
pnpm evidence:check
```

The generated report lives at `reports/proof-point-validation.md`. Regenerate it when validation inputs, proof-point fixtures, or expected counts change.

Useful steward and stack commands:

```sh
pnpm pr:status
pnpm backlog:batch
pnpm backlog:next
pnpm stack:ready
pnpm security:pass
pnpm pr:stack
```

`pnpm pr:stack` wraps `gt submit --stack`. Run it from a clean worktree after preflight mergeability against `origin/main`.

## Repository Map

| Path | Purpose |
| --- | --- |
| `docs/start-here.md` | Documentation entry point and reading path. |
| `docs/product-positioning-adoption-guide.md` | Product positioning, adoption fit, non-goals, integration patterns, and evaluation checklists. |
| `docs/five-minute-quickstart.md` | Docker Compose quickstart for the local API and seeded demo decisions. |
| `docs/developer-evaluation-path.md` | Full local 30-minute evaluation path over policy tests, dry-run provisioning, reconciliation, audit export, and evidence export. |
| `docs/implementation-backlog.md` | Durable slice backlog for Codex and human coordination. |
| `docs/automation.md` | PR steward, next-slice, labels, and merge-readiness operating loop. |
| `docs/` | Concept of operations, boundary, architecture, domain, API reference and notes, CLI, persistence, decision and cache semantics, demo seed harness, PEP conformance, sample SaaS and internal admin apps, provisioning, connector contract and authoring, drift, HA/degraded-mode operations, deployment, production reference architecture, runbook exercise evidence, secure SDLC evidence, security, threat, ATO evidence, controls, assessor guidance, and readiness reporting. |
| `runbooks/` | Emergency revocation, rollback, drift, outage, break-glass, export, credential, and decision API outage procedures. |
| `examples/` | Synthetic API collections, CLI examples, TypeScript/Python/Go PEP starters, sample SaaS and internal admin apps, sample policy repository, connector template, and control/evidence mapping examples. |
| `.github/workflows/` | CI, contract validation, and security checks. |
| `deploy/` | Reference Kubernetes deployment manifests, production-reference overlays, persistence evidence, and admission-policy examples. |
| `adrs/` | Architecture decision records for the foundation. |
| `openapi/` | ReBAC control-plane OpenAPI contract. |
| `schemas/` | JSON Schemas for public domain contracts. |
| `packages/core/` | Deterministic domain types, proof-point evaluator, and repository contracts. |
| `packages/api/` | HTTP API runtime, persistence wiring, readiness checks, and `rebac-api` service entrypoint. |
| `packages/api-contracts/` | Contract and schema manifest exports. |
| `packages/typescript-client/` | TypeScript client and Express-style PEP helper for application integration examples. |
| `packages/cli/` | CLI command contract and operator CLI implementation. |
| `packages/connectors-aws/` | Optional AWS read-only access-analysis connector for IAM Identity Center assignments, AWS accounts/roles, CloudTrail activity, and Access Analyzer findings. |
| `packages/connectors-microsoft-graph/` | Optional Microsoft Graph Entra read-only connector for sandbox user, group, service-principal, and app-role readback. |
| `packages/connectors-mock/` | Mock and synthetic provider connectors implementing the adapter boundary. |
| `packages/connectors-sample-readonly/` | Copyable sample read-only connector template with redacted fixtures and contract tests. |
| `scripts/` | Validation, evidence-generation, steward, and stack-readiness commands. |
| `tests/fixtures/` | Schema examples and policy proof points. |
| `reports/` | Generated validation evidence. |

## Canonical Sources

| Source | Canonical path |
| --- | --- |
| Documentation entry point | [`docs/start-here.md`](docs/start-here.md) |
| Product positioning and adoption guide | [`docs/product-positioning-adoption-guide.md`](docs/product-positioning-adoption-guide.md) |
| Five-minute quickstart | [`docs/five-minute-quickstart.md`](docs/five-minute-quickstart.md) |
| Developer evaluation path | [`docs/developer-evaluation-path.md`](docs/developer-evaluation-path.md) |
| Public API | [`openapi/rebac-control-plane.yaml`](openapi/rebac-control-plane.yaml) |
| API notes | [`docs/api.md`](docs/api.md) |
| CLI contract | [`docs/cli.md`](docs/cli.md) |
| PEP conformance | [`docs/pep-conformance.md`](docs/pep-conformance.md) |
| Domain model | [`docs/domain-model.md`](docs/domain-model.md) |
| Connector contract | [`docs/connector-contract.md`](docs/connector-contract.md) |
| Connector authoring tutorial | [`docs/connector-authoring-tutorial.md`](docs/connector-authoring-tutorial.md) |
| Sample connector template | [`examples/connectors/sample-readonly-template.md`](examples/connectors/sample-readonly-template.md) and [`packages/connectors-sample-readonly/`](packages/connectors-sample-readonly/) |
| Production reference architecture | [`docs/production-reference-architecture.md`](docs/production-reference-architecture.md) |
| Security model | [`docs/security-model.md`](docs/security-model.md) |
| Threat model | [`docs/threat-model.md`](docs/threat-model.md) |
| Product release packaging | [`docs/release-packaging.md`](docs/release-packaging.md) |
| Support policy | [`docs/support-policy.md`](docs/support-policy.md) |
| Security policy | [`SECURITY.md`](SECURITY.md) |
| Changelog | [`CHANGELOG.md`](CHANGELOG.md) |
| Evidence catalog | [`docs/evidence-catalog.md`](docs/evidence-catalog.md) |
| Assessor inspection guide | [`docs/assessor-inspection-guide.md`](docs/assessor-inspection-guide.md) |
| Implementation backlog | [`docs/implementation-backlog.md`](docs/implementation-backlog.md) |

## First Reading Path

1. Start with [`docs/start-here.md`](docs/start-here.md).
2. Read [`docs/concept-of-operations.md`](docs/concept-of-operations.md) and [`docs/system-context-and-boundary.md`](docs/system-context-and-boundary.md) for operating scope.
3. Read [`docs/domain-model.md`](docs/domain-model.md), [`docs/decision-lifecycle.md`](docs/decision-lifecycle.md), [`docs/explain-api.md`](docs/explain-api.md), and [`docs/pep-conformance.md`](docs/pep-conformance.md) for authorization behavior and enforcement expectations.
4. Read [`docs/provisioning-lifecycle.md`](docs/provisioning-lifecycle.md), [`docs/connector-contract.md`](docs/connector-contract.md), [`docs/connector-authoring-tutorial.md`](docs/connector-authoring-tutorial.md), and [`docs/drift-detection-model.md`](docs/drift-detection-model.md) for operational change control.
5. Read [`docs/audit-event-model.md`](docs/audit-event-model.md), [`docs/evidence-catalog.md`](docs/evidence-catalog.md), [`docs/control-traceability-matrix.md`](docs/control-traceability-matrix.md), and [`docs/assessor-inspection-guide.md`](docs/assessor-inspection-guide.md) for inspection and evidence.
6. Read [`docs/security-model.md`](docs/security-model.md), [`docs/threat-model.md`](docs/threat-model.md), and the runbooks before operating enforcement paths.
