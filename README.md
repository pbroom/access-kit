# Access Kit

Access Kit is an API-first and CLI-first foundation for an ATO-ready relationship-based authorization control plane. It defines the public contracts, deterministic decision behavior, operator CLI surface, connector boundary, audit trail, and evidence package shape before any production live-provider writes or dashboard work.

The current repository is a local proof point built for contract validation, runtime behavior checks, assessor inspection, and implementation planning. It is not a production authorization service yet. [`docs/start-here.md`](docs/start-here.md) is the documentation front door: what Access Kit is and is not, the proof-point-versus-production boundary, known gaps, and reading paths.

## What It Does

- Evaluates ReBAC `check`, `explain`, and batch decision requests with deterministic deny-by-default behavior.
- Exposes an OpenAPI-shaped local API runtime plus a `rebac-api` service entrypoint, and a `rebac` CLI that calls the API instead of evaluating authorization locally.
- Models subjects, resources, relationships, policies, provisioning plans, reconciliation findings, audit records, evidence exports, and connector state.
- Includes mock and synthetic read-only connector fixtures plus optional Microsoft Graph and AWS read-only connector foundations for sandbox evidence without provider writes.
- Supports dry-run provisioning and synthetic-only controlled enforcement behind readiness, approval, incident-mode, rollback, and break-glass guardrails.
- Produces validation evidence, audit-integrity checks, SIEM-ready audit export shapes, and local ATO evidence package flows.

It is not an identity provider, SIEM, ticketing system, provider replacement, or UI-first admin portal; it does not use LLMs for authorization decisions; and it does not claim a production ATO. The full boundary statement lives in [`docs/start-here.md`](docs/start-here.md).

## Quickstart

Use Node 22 or newer. The repo is pinned for pnpm 10.

```sh
corepack enable
pnpm install
pnpm validate      # typecheck, contracts, docs, policy, packaging gates, tests
pnpm ci:check      # adds lint, build, and evidence freshness
```

For the shortest runnable API path, start the compose quickstart and run the seeded demo:

```sh
docker compose -f docker-compose.quickstart.yml up --build -d
pnpm quickstart:demo     # allow + deny-by-default decisions against seeded data
pnpm evaluation:demo     # full 30-minute path: policy tests, provisioning, reconciliation, evidence
```

Both runners and their expected output are documented in [`docs/quickstart.md`](docs/quickstart.md).

## Run The Local API

```sh
pnpm exec tsx packages/api/src/bin.ts
```

The API listens on `127.0.0.1:3000` by default. Useful environment variables:

| Variable                           | Default       | Purpose                                                                                                                                              |
| ---------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REBAC_API_HOST`                   | `127.0.0.1`   | Bind host. Non-loopback hosts require bearer tokens.                                                                                                 |
| `REBAC_API_PORT`                   | `3000`        | Bind port.                                                                                                                                           |
| `REBAC_API_ACTOR`                  | `service:api` | Default actor for service-emitted audit events.                                                                                                      |
| `REBAC_API_KEYS`                   | unset         | Comma-separated bearer tokens for `/v1` routes except health and readiness. Optional `label:token` entries record audit events as `api-key:<label>`. |
| `REBAC_STATE_PATH`                 | unset         | Optional JSON runtime state snapshot path.                                                                                                           |
| `REBAC_EVIDENCE_ROOT`              | unset         | Optional local persistence root for audit records and evidence packages.                                                                             |
| `REBAC_DATABASE_URL`               | unset         | Optional PostgreSQL connection URL; selects the `@access-kit/persistence-postgres` backend instead of local files.                                   |
| `REBAC_DATABASE_TENANT_BOUNDARY`   | unset         | Tenant boundary for the PostgreSQL backend. Required with `REBAC_DATABASE_URL`.                                                                      |
| `REBAC_DATABASE_AUDIT_SIGNING_KEY` | unset         | Audit-window signing key (32+ characters). Required with `REBAC_DATABASE_URL`.                                                                       |

`/v1/health` and `/v1/ready` are public probes. When `REBAC_API_KEYS` is set, call protected routes with `Authorization: Bearer <token>`; the runtime refuses to bind beyond loopback without keys, audits failed authentication, and keeps token material out of logs. Full auth semantics are in [`docs/api.md`](docs/api.md).

## Run The CLI

Point the CLI at a running API with `--api-url` or `REBAC_API_URL`:

```sh
REBAC_API_URL=http://127.0.0.1:3000 pnpm exec tsx packages/cli/src/bin.ts check user:123 read document:case-plan
REBAC_API_URL=http://127.0.0.1:3000 pnpm exec tsx packages/cli/src/bin.ts explain user:123 read document:case-plan
```

The CLI is an operator wrapper over the API contract; authorization logic stays in the API/core engine. See [`docs/cli.md`](docs/cli.md).

## Evidence, Validation, And Stewardship

```sh
pnpm evidence:generate   # regenerate reports/proof-point-validation.md
pnpm evidence:check      # verify the committed report is fresh
pnpm backlog:batch       # next parallel-safe implementation batch
pnpm pr:status           # open PR state, labels, CI rollups
```

The slice backlog lives in [`docs/implementation-backlog.md`](docs/implementation-backlog.md); the steward loop is documented in [`docs/automation.md`](docs/automation.md).

## Repository Map

| Path                                                                   | Purpose                                                                                                                                                            |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`docs/start-here.md`](docs/start-here.md)                             | Documentation front door: boundary, status, gaps, and a where-things-live index for every doc.                                                                     |
| [`docs/quickstart.md`](docs/quickstart.md)                             | Compose quickstart, evaluation path, demo seed harness, policy playground, and example apps.                                                                       |
| `docs/`                                                                | Architecture, boundary, domain model, decisions, API and CLI notes, connectors, provisioning, drift, deployment, operations, security, and evidence documentation. |
| `runbooks/`                                                            | Emergency revocation, rollback, drift, outage, break-glass, export, credential, and degraded-mode procedures.                                                      |
| `examples/`                                                            | Synthetic API collections, CLI examples, TypeScript/Python/Go PEP starters, sample SaaS and internal admin apps, sample policy repository, and connector template. |
| `adrs/`                                                                | Architecture decision records.                                                                                                                                     |
| [`openapi/rebac-control-plane.yaml`](openapi/rebac-control-plane.yaml) | Public API source of truth.                                                                                                                                        |
| `schemas/`                                                             | JSON Schemas for public domain contracts.                                                                                                                          |
| `packages/core/`                                                       | Deterministic domain types, decision engine, and repository contracts.                                                                                             |
| `packages/api/`                                                        | HTTP API runtime, persistence wiring, readiness checks, and `rebac-api` entrypoint.                                                                                |
| `packages/api-contracts/`                                              | Contract snapshot and generated client artifacts.                                                                                                                  |
| `packages/typescript-client/`                                          | TypeScript client and Express-style PEP helper.                                                                                                                    |
| `packages/cli/`                                                        | CLI command contract and operator CLI implementation.                                                                                                              |
| `packages/connectors-*`                                                | Mock/synthetic connectors, optional Microsoft Graph and AWS read-only connectors, and the copyable sample template.                                                |
| `packages/persistence-postgres/`                                       | Opt-in PostgreSQL persistence backend.                                                                                                                             |
| `deploy/`                                                              | Reference Kubernetes manifests, production-reference overlay, persistence and pilot evidence, admission-policy examples.                                           |
| `scripts/`                                                             | Validation, evidence-generation, steward, and stack-readiness commands.                                                                                            |
| `tests/fixtures/`                                                      | Schema examples and policy proof points.                                                                                                                           |
| `reports/`                                                             | Generated validation evidence.                                                                                                                                     |

Release channels, versioning, and support expectations live in [`docs/release-packaging.md`](docs/release-packaging.md), [`docs/support-policy.md`](docs/support-policy.md), [`SECURITY.md`](SECURITY.md), and [`CHANGELOG.md`](CHANGELOG.md).
