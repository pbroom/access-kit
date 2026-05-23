# Start Here

## Purpose

This page orients developers, platform engineers, security engineers, ISSOs, assessors, resource owners, and product/governance leads to the Access Kit documentation foundation.

Access Kit is an API-first and CLI-first relationship-based authorization control plane. It decides, explains, provisions, verifies, reconciles, audits, and produces evidence for authorization activity. It does not authenticate users, replace native platform enforcement, or use LLMs to make authorization decisions.

## What This Is

Access Kit is a foundation for an ATO-ready ReBAC authorization control plane. The current implementation is a local proof point with deterministic policy decisions, OpenAPI and JSON Schema contracts, a CLI that calls the API, mock and synthetic read-only connectors, dry-run provisioning, synthetic-only controlled enforcement, audit integrity checks, SIEM-ready audit exports, and ATO-oriented evidence exports.

## What This Is Not

Access Kit is not an identity provider, authentication system, SIEM, ticketing system, generic workflow platform, UI-first admin portal, live Microsoft/AWS connector, or production authorization to operate. It supports ATO inspection; it does not claim an ATO.

## First Reading Path

1. Read [Concept of Operations](concept-of-operations.md) for the operating model.
2. Read [System Context and Boundary](system-context-and-boundary.md) to understand what is inside and outside the control plane.
3. Read [Domain Model](domain-model.md) for source-of-truth objects.
4. Read [Decision Lifecycle](decision-lifecycle.md) and [Explain API](explain-api.md) for authorization behavior.
5. Read [Provisioning Lifecycle](provisioning-lifecycle.md), [Connector Contract](connector-contract.md), and [Drift Detection Model](drift-detection-model.md) for operational change control.
6. Read [Audit Event Model](audit-event-model.md), [Evidence Catalog](evidence-catalog.md), [Control Traceability Matrix](control-traceability-matrix.md), and [Assessor Inspection Guide](assessor-inspection-guide.md) for inspection and evidence.
7. Read [Threat Model](threat-model.md), [Security Model](security-model.md), and the [runbooks](../runbooks/emergency-revocation.md) before operating enforcement paths.

## Build And Validate

Use Node 22 or newer and pnpm 10.

```sh
corepack enable
pnpm install
pnpm validate
pnpm ci:check
```

`pnpm validate` runs type checking, contract validation, CI workflow validation, and tests. `pnpm ci:check` adds lint, build, and evidence freshness checks.

## Canonical Sources

| Source | Canonical path | Use |
| --- | --- | --- |
| Public API | `openapi/rebac-control-plane.yaml` | API routes, operation IDs, request and response schemas. |
| Domain contracts | `schemas/*.schema.json` | Portable JSON object contracts. |
| Runtime types | `packages/core/src/domain.ts` | TypeScript implementation types mirroring schema concepts. |
| CLI contract | `packages/cli/src/commands.ts` | CLI command tree and API surface mapping. |
| Policy proof points | `tests/fixtures/policy/proof-points.json` | Deterministic authorization behaviors under test. |
| Schema examples | `tests/fixtures/schema-examples/*.json` | Validated synthetic examples for core objects. |
| Architecture decisions | `adrs/0001-*.md` through `adrs/0010-*.md` | Canonical ADR naming and design decisions. |
| Evidence report | `reports/proof-point-validation.md` | Generated validation proof point. |

## Assumptions

- All examples are synthetic.
- Live tenant identifiers, emails, secrets, access tokens, customer names, production logs, and sensitive architecture details are out of scope.
- Synthetic Entra ID, SharePoint, and AWS-style connectors prove contract shape only.
- Production deployments must replace local proof points with deployment-specific diagrams, retention controls, operational approvals, and assessor-reviewed control statements.
