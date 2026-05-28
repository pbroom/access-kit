# Start Here

## Purpose

This page orients developers, platform engineers, security engineers, ISSOs, assessors, resource owners, and product/governance leads to the Access Kit documentation foundation.

Access Kit is an API-first and CLI-first relationship-based authorization control plane. It decides, explains, provisions, verifies, reconciles, audits, and produces evidence for authorization activity. It does not authenticate users, replace native platform enforcement, or use LLMs to make authorization decisions.

## What This Is

Access Kit is a foundation for an ATO-ready ReBAC authorization control plane. The current implementation is a local proof point with deterministic policy decisions, OpenAPI and JSON Schema contracts, a CLI that calls the API, mock and synthetic read-only connectors, dry-run provisioning, synthetic-only controlled enforcement, audit integrity checks, SIEM-ready audit exports, and ATO-oriented evidence exports.

## What This Is Not

Access Kit is not an identity provider, authentication system, SIEM, ticketing system, generic workflow platform, UI-first admin portal, live Microsoft/AWS connector, or production authorization to operate. It supports ATO inspection; it does not claim an ATO.

## First Reading Path

1. Run [Five-Minute Quickstart](five-minute-quickstart.md) for the shortest local API path.
2. Run [Developer Evaluation Path](developer-evaluation-path.md) for the full local policy, provisioning, reconciliation, audit, and evidence walkthrough.
3. Read [Concept of Operations](concept-of-operations.md) for the operating model.
4. Read [System Context and Boundary](system-context-and-boundary.md) to understand what is inside and outside the control plane.
5. Read [Domain Model](domain-model.md) for source-of-truth objects.
6. Read [Decision Lifecycle](decision-lifecycle.md) and [Explain API](explain-api.md) for authorization behavior.
7. Read [Decision Cache Semantics](decision-cache-semantics.md) before allowing PEPs to reuse decisions.
8. Read [Provisioning Lifecycle](provisioning-lifecycle.md), [Connector Contract](connector-contract.md), [Connector Authoring Tutorial](connector-authoring-tutorial.md), and [Drift Detection Model](drift-detection-model.md) for operational change control.
9. Read [Audit Event Model](audit-event-model.md), [Evidence Catalog](evidence-catalog.md), [Control Traceability Matrix](control-traceability-matrix.md), and [Assessor Inspection Guide](assessor-inspection-guide.md) for inspection and evidence.
10. Read [Product Release Packaging](release-packaging.md), [Support Policy](support-policy.md), and [Security Policy](../SECURITY.md) before adopting a versioned release channel.
11. Read [Threat Model](threat-model.md), [Security Model](security-model.md), and the [Emergency Revocation Runbook](../runbooks/emergency-revocation.md), along with the other runbooks in `runbooks/`, before operating enforcement paths.

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
| Five-minute quickstart | `docker-compose.quickstart.yml`, `scripts/quickstart-demo.ts`, [Five-Minute Quickstart](five-minute-quickstart.md) | Shortest local API flow using synthetic demo seed data and check/explain decisions. |
| Developer evaluation path | `scripts/evaluation-demo.ts`, [Developer Evaluation Path](developer-evaluation-path.md) | Full local 30-minute path covering policy tests, dry-run provisioning, reconciliation, audit export, and evidence export. |
| Public API | `openapi/rebac-control-plane.yaml` | API routes, operation IDs, request and response schemas. |
| API reference | `docs/api-reference.md` | Generated reference for auth, idempotency, parameters, responses, and example artifacts. |
| Domain contracts | `schemas/*.schema.json` | Portable JSON object contracts. |
| Runtime types | `packages/core/src/domain.ts` | TypeScript implementation types mirroring schema concepts. |
| CLI contract | `packages/cli/src/commands.ts` | CLI command tree and API surface mapping. |
| Connector contract | `docs/connector-contract.md` | Connector capability model, security review gate, and live-read boundary. |
| Connector authoring tutorial | `docs/connector-authoring-tutorial.md` | Safe read-only connector authoring flow and release-gate evidence. |
| Sample connector template | `examples/connectors/sample-readonly-template.md`, `packages/connectors-sample-readonly/` | Copyable read-only connector implementation with synthetic fixtures and tests. |
| Production reference architecture | `docs/production-reference-architecture.md`, `deploy/overlays/production-reference/` | Local-to-production deployment map, Kubernetes overlay shape, RTO/RPO evidence, and external-control boundaries. |
| HA and degraded-mode operations | `docs/ha-degraded-mode-operations.md`, `runbooks/degraded-mode-operations.md` | Fail-closed resilience, queue backpressure, audit-forwarder outage, read-only fallback, health signals, and recovery criteria. |
| Demo seed harness | `packages/core/src/demo-seed.ts`, `examples/demo-seed-harness.json`, [Demo Seed Harness](demo-seed-harness.md) | Synthetic local subjects, resources, relationships, policy fixture, decision presets, and evidence labels for quickstart and evaluation paths. |
| Policy model | `schemas/policy-model.schema.json`, `packages/core/src/policy-model.ts` | Versioned model shape and deterministic validation rules. |
| Policy proof points | `tests/fixtures/policy/proof-points.json` | Deterministic authorization behaviors under test. |
| Decision cache semantics | `docs/decision-cache-semantics.md`, `packages/core/src/decision-runtime.ts` | PEP cache key, TTL, invalidation, fail-closed, and auditability contract. |
| Schema examples | `tests/fixtures/schema-examples/*.json` | Validated synthetic examples for core objects, including the policy model example. |
| Architecture decisions | `adrs/0001-*.md` through `adrs/0010-*.md` | Canonical ADR naming and design decisions. |
| Evidence report | `reports/proof-point-validation.md` | Generated validation proof point. |
| Secure SDLC evidence | `release/security-evidence/ak-044-secure-sdlc.example.json`, `docs/secure-sdlc-evidence.md` | Release-retained security evidence and validation gate. |
| Product release manifest | `releases/v0.1.0/manifest.json`, [Product Release Packaging](release-packaging.md), [Support Policy](support-policy.md), [Security Policy](../SECURITY.md), [Changelog](../CHANGELOG.md) | Versioned source, container, CLI, SDK, docs-site, support, security, compatibility, SBOM, provenance, signature, and disclosure channel contract. |

## Assumptions

- All examples are synthetic.
- Live tenant identifiers, emails, secrets, access tokens, customer names, production logs, and sensitive architecture details are out of scope.
- Synthetic Entra ID, SharePoint, and AWS-style connectors prove contract shape only; the optional Microsoft Graph sandbox connector now stages live read-only Entra, M365/Teams, SharePoint, and OneDrive inventory with redacted evidence and coverage warnings.
- Production deployments must replace local proof points with deployment-specific diagrams, retention controls, operational approvals, and assessor-reviewed control statements.
