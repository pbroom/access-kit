# Access Kit

Access Kit is the foundation for an ATO-ready ReBAC authorization control plane. The foundation is intentionally API-first and CLI-first: it defines the contracts, domain model, validation evidence, and mock connector boundary before any live Entra ID, Active Directory, SharePoint, AWS, Power Platform, or dashboard work.

## First Milestone

This repository currently delivers:

- TypeScript/pnpm workspace scaffolding with strict type checking.
- OpenAPI contract for the ReBAC control plane.
- JSON Schemas for core domain and evidence objects.
- CLI command contract for operators, CI/CD, and assessors.
- Mock connector interface and deterministic sample implementation.
- Synthetic Entra ID, SharePoint, and AWS-style read-only connector fixtures with no real tenant access.
- Local in-memory API runtime for check, explain, inventory, relationship, read-only connector discovery, discovery run history, native-grant readback, dry-run provisioning jobs, reconciliation, audit, and evidence flows.
- CLI commands that call the API instead of evaluating authorization locally.
- Policy proof-point fixtures for deny/default, relationship allow, deny override, expiration, suspension, idempotency, and drift.
- Architecture, security, ATO evidence, CLI, API, and ADR documentation.
- Generated proof-point validation report in `reports/proof-point-validation.md`.

## Non-Goals

- This is not an identity provider.
- This is not an authentication system.
- This is not a SIEM or ticketing system.
- This is not an AWS IAM, Entra ID, SharePoint, Teams, or Power Platform replacement.
- This is not a UI-first admin portal.
- This does not use an LLM to make authorization decisions.

## Development

Use Node 22 or newer. The repo is pinned for pnpm 10.

```sh
corepack enable
pnpm install
pnpm validate
pnpm evidence:generate
```

`pnpm validate` runs type checking, first-class contract validation, CI workflow validation, and the core/API/CLI test suite. `pnpm ci:check` adds lint, build, and evidence freshness checks for pre-submit confidence.

## Repository Map

- `docs/` - architecture, domain, API, CLI, security, ATO evidence, and outstanding requirements.
- `.github/workflows/` - CI, contract validation, and security checks.
- `adrs/` - architecture decision records for the foundation.
- `openapi/` - ReBAC control-plane OpenAPI contract.
- `schemas/` - JSON Schemas for public domain contracts.
- `packages/core/` - deterministic domain types and proof-point evaluator.
- `packages/api/` - local in-memory HTTP API runtime.
- `packages/api-contracts/` - contract and schema manifest exports.
- `packages/cli/` - CLI command contract and placeholder operator CLI.
- `packages/connectors-mock/` - mock and synthetic provider connectors implementing the adapter boundary.
- `scripts/` - validation and evidence-generation commands.
- `tests/fixtures/` - schema examples and policy proof points.
- `reports/` - generated validation evidence.
