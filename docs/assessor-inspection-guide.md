# Assessor Inspection Guide

## Purpose

This guide gives assessors and ISSOs a concrete inspection path through the Access Kit repository and local proof-point evidence.

## Audience

Assessors, ISSOs, security engineers, platform engineers, governance leads, and evidence owners.

## What This Is

This is an inspection guide for the repository and local proof point. It connects architecture, controls, implementation behavior, evidence, logs, schemas, APIs, CLI commands, runbooks, and control mappings.

## What This Is Not

This is not an authorization package, authorization decision, production SSP, or independent assessment report.

## Inspection Path

1. Confirm scope in [Start Here](start-here.md), [Non-Goals](non-goals.md), and [System Context and Boundary](system-context-and-boundary.md).
2. Review architecture and invariants in [Architecture](architecture.md).
3. Review object contracts in [Domain Model](domain-model.md) and `schemas/*.schema.json`.
4. Review API coverage in [API Contract Notes](api.md) and `openapi/rebac-control-plane.yaml`.
5. Review CLI-to-API behavior in [CLI Contract](cli.md) and `packages/cli/src/commands.ts`.
6. Review deterministic authorization in [Decision Lifecycle](decision-lifecycle.md), [Explain API](explain-api.md), and `tests/fixtures/policy/proof-points.json`.
7. Review connector, provisioning, drift, and runbook coverage.
8. Review audit integrity and evidence export coverage.
9. Run validation commands or inspect `reports/proof-point-validation.md`.
10. Compare known gaps in [Outstanding Requirements](outstanding-requirements.md) and [Docs Readiness Report](docs-readiness-report.md).

## Concrete Sampling Scenario

Sample an allowed decision:

1. Open `tests/fixtures/schema-examples/decision.json`.
2. Verify reason code, policy version, relationship version, and relationship path.
3. Open `packages/core/src/engine.ts` and confirm deny-by-default and explicit-deny precedence.
4. Open `tests/fixtures/policy/proof-points.json` and confirm allow and deny proof points.
5. Open `schemas/audit-event.schema.json` and confirm decision events carry trace fields.
6. Open `tests/fixtures/schema-examples/evidence-export.json` and confirm control mapping and source event linkage.

## Security Considerations

- Treat all examples as synthetic.
- Do not infer live connector behavior from synthetic provider fixtures.
- Do not treat local file-backed evidence receipts as production immutability.
- Ask for deployment-specific diagrams, IdP configuration, SIEM forwarding, WORM retention, and connector security review before production authorization.

## Audit And Evidence Implications

Inspection should preserve traceability from control statement to evidence type, source event, schema, API, CLI command, test, runbook, and known gap.

## Related Controls

This guide supports CA assessment, AU audit review, AC enforcement review, CM configuration review, and IR procedure review.

## Related References

- [Control Traceability Matrix](control-traceability-matrix.md)
- [Evidence Catalog](evidence-catalog.md)
- [Docs Readiness Report](docs-readiness-report.md)
- [CI](ci.md)
- `reports/proof-point-validation.md`
