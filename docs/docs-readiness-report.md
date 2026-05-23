# Documentation Readiness Report

## Executive Summary

This branch establishes a repo-native documentation foundation for the Access Kit ReBAC authorization control plane. It preserves existing conventions: flat `docs/*.md` narrative pages, zero-padded ADR filenames under `adrs/`, OpenAPI as the API source of truth, JSON Schemas under `schemas/`, validated schema examples under `tests/fixtures/schema-examples/`, and policy proof points under `tests/fixtures/policy/`.

The work adds distinct documentation where coverage was missing, avoids duplicate schema and ADR sources of truth, and records path-equivalence decisions below.

## Documentation Coverage

| Coverage area | Canonical path |
| --- | --- |
| Start-here overview | `docs/start-here.md`, with root `README.md` as repository overview |
| Concept of operations | `docs/concept-of-operations.md` |
| Glossary | `docs/glossary.md` |
| Non-goals | `docs/non-goals.md`, with summary in `README.md` |
| System context, boundary, data flows, trust boundaries | `docs/system-context-and-boundary.md`, supported by `docs/architecture.md` |
| Domain model | `docs/domain-model.md` |
| API overview, Decision API, API errors, reason codes | `docs/api.md`, `docs/decision-lifecycle.md`, `docs/explain-api.md` |
| CLI overview and commands | `docs/cli.md`, `packages/cli/src/commands.ts` |
| Policy model and testing | `docs/policy-testing-guide.md`, `tests/fixtures/policy/proof-points.json` |
| Connector contract and capability model | `docs/connector-contract.md` |
| Security model and threat model | `docs/security-model.md`, `docs/threat-model.md` |
| Audit logging and tamper evidence | `docs/audit-event-model.md` |
| ATO overview, evidence catalog, OSCAL guidance | `docs/ato-evidence-model.md`, `docs/evidence-catalog.md` |
| Control traceability matrix | `docs/control-traceability-matrix.md` |
| Assessor inspection guide | `docs/assessor-inspection-guide.md` |
| Runbooks | `runbooks/*.md` |
| ADRs | `adrs/0001-*.md` through `adrs/0010-*.md` |
| Schemas | `schemas/*.schema.json` |
| Examples | `tests/fixtures/schema-examples/*.json`, `tests/fixtures/policy/proof-points.json`, `examples/` |

## Flagship Page Coverage

| Flagship page | Canonical path | Status |
| --- | --- | --- |
| Concept of Operations | `docs/concept-of-operations.md` | Added |
| System Context and Boundary | `docs/system-context-and-boundary.md` | Added |
| Domain Model | `docs/domain-model.md` | Enriched |
| Decision Lifecycle | `docs/decision-lifecycle.md` | Added |
| Provisioning Lifecycle | `docs/provisioning-lifecycle.md` | Added |
| Explain API | `docs/explain-api.md` | Added |
| Audit Event Model | `docs/audit-event-model.md` | Added |
| Connector Contract | `docs/connector-contract.md` | Added |
| Drift Detection Model | `docs/drift-detection-model.md` | Added |
| Evidence Catalog | `docs/evidence-catalog.md` | Added |
| Control Traceability Matrix | `docs/control-traceability-matrix.md` | Added |
| Assessor Inspection Guide | `docs/assessor-inspection-guide.md` | Added |
| Threat Model | `docs/threat-model.md` | Added |
| Policy Testing Guide | `docs/policy-testing-guide.md` | Added |
| Emergency Revocation Runbook | `runbooks/emergency-revocation.md` | Added |

## Path Equivalence Decisions

| Requested path | Canonical repo path | Action taken | Rationale |
| --- | --- | --- | --- |
| `docs/start-here.md` or start-here overview | `docs/start-here.md` and `README.md` | Added docs entry point and kept README as repo overview | The README remains a concise repository overview; the docs start page is a navigation guide, not a duplicate authority. |
| `docs/overview.md` | `docs/start-here.md` and `README.md` | Mapped | A separate overview would duplicate the start-here and README content. |
| `docs/conops.md` | `docs/concept-of-operations.md` | Added canonical lower-kebab file | Distinct flagship concept-of-operations coverage did not exist. |
| `docs/system-context.md`, `docs/system-boundary.md`, `docs/data-flows.md`, `docs/trust-boundaries.md` | `docs/system-context-and-boundary.md` and `docs/architecture.md` | Added one consolidated boundary page | These topics are tightly coupled for assessor review; architecture remains the broader canonical architecture page. |
| `docs/domain-model.md` | `docs/domain-model.md` | Enriched | Existing canonical file won. |
| `docs/decision-lifecycle.md` | `docs/decision-lifecycle.md` | Added | Lifecycle coverage is distinct from API notes. |
| `docs/provisioning-lifecycle.md` | `docs/provisioning-lifecycle.md` | Added | Lifecycle coverage is distinct from provisioning schema. |
| `docs/explain-api.md` | `docs/explain-api.md` | Added | Explain is a flagship inspection endpoint and deserves a deep dive. |
| `schemas/explain-response.schema.json` | `schemas/decision.schema.json` | Mapped | `/v1/decision/explain` currently returns `DecisionResult` with path, reason, version, and constraints. |
| `schemas/evidence.schema.json` | `schemas/evidence-export.schema.json` | Mapped | Existing schema defines the evidence export package contract. |
| `schemas/evidence-object.schema.json` | No canonical path yet | Not added | Atomic evidence objects are not a distinct implemented contract yet. |
| `examples/schema/*.json` | `tests/fixtures/schema-examples/*.json` | Reused | Existing fixtures are validated by `pnpm validate:schemas`. |
| `examples/policy-tests.*` | `tests/fixtures/policy/proof-points.json` | Reused | Existing policy proof points are validated by `pnpm validate:policy`. |
| `examples/control-evidence-mapping.*` | `examples/control-evidence-mapping.json`, supported by `tests/fixtures/schema-examples/evidence-export.json` | Added concise standalone example | A standalone mapping helps documentation readers; schema-valid package example remains canonical for full evidence export. |
| `examples/api/*` | `examples/api/*.json` | Added | Request/response examples were not first-class files. |
| `examples/cli/*` | `examples/cli/operator-and-assessor.sh`, supported by `docs/cli.md` | Added | CLI examples existed in docs; a synthetic walkthrough is distinct. |
| `adrs/ADR-0001-api-cli-first.md` | `adrs/0001-api-first-cli-first.md` | Mapped | Existing ADR naming convention wins. |
| `adrs/ADR-0002-deterministic-authorization.md` | `adrs/0002-deterministic-authorization.md` | Mapped | Existing ADR naming convention wins. |
| `docs/runbooks/*.md` | `runbooks/*.md` | Added top-level runbook family | Runbooks are operational artifacts distinct from narrative docs; README documents the location. |
| `docs/docs-readiness-report.md` | `docs/docs-readiness-report.md` | Added | Required readiness artifact had no equivalent. |
| OSCAL artifacts | `docs/ato-evidence-model.md` | Guidance only | OSCAL generation is not implemented; downstream OSCAL should transform canonical evidence export data. |

## Existing Artifacts Reused

- `README.md`
- `docs/architecture.md`
- `docs/api.md`
- `docs/cli.md`
- `docs/security-model.md`
- `docs/ato-evidence-model.md`
- `docs/outstanding-requirements.md`
- `docs/ci.md`
- `adrs/0001-api-first-cli-first.md` through `adrs/0010-fail-behavior.md`
- `openapi/rebac-control-plane.yaml`
- `schemas/*.schema.json`
- `tests/fixtures/schema-examples/*.json`
- `tests/fixtures/policy/proof-points.json`
- `reports/proof-point-validation.md`

## New Artifacts Added

- `docs/start-here.md`
- `docs/non-goals.md`
- `docs/glossary.md`
- `docs/concept-of-operations.md`
- `docs/system-context-and-boundary.md`
- `docs/decision-lifecycle.md`
- `docs/provisioning-lifecycle.md`
- `docs/explain-api.md`
- `docs/audit-event-model.md`
- `docs/connector-contract.md`
- `docs/drift-detection-model.md`
- `docs/evidence-catalog.md`
- `docs/control-traceability-matrix.md`
- `docs/assessor-inspection-guide.md`
- `docs/threat-model.md`
- `docs/policy-testing-guide.md`
- `docs/docs-readiness-report.md`
- `runbooks/emergency-revocation.md`
- `runbooks/policy-rollback.md`
- `runbooks/drift-remediation.md`
- `runbooks/connector-outage.md`
- `runbooks/break-glass-review.md`
- `runbooks/audit-evidence-export.md`
- `runbooks/compromised-connector-credential.md`
- `runbooks/decision-api-outage.md`
- `examples/README.md`
- `examples/api/decision-check.request.json`
- `examples/api/explain.response.json`
- `examples/control-evidence-mapping.json`
- `examples/cli/operator-and-assessor.sh`

## Artifacts Migrated Or Renamed

None. The existing flat docs layout and ADR naming convention were preserved.

## Schemas And Examples Coverage

| Required coverage | Canonical path | Status |
| --- | --- | --- |
| Audit event | `schemas/audit-event.schema.json`, `tests/fixtures/schema-examples/audit-event.json` | Reused |
| Decision | `schemas/decision.schema.json`, `tests/fixtures/schema-examples/decision.json` | Reused |
| Explain response | `schemas/decision.schema.json`, `examples/api/explain.response.json` | Mapped and supplemented |
| Relationship | `schemas/relationship.schema.json`, `tests/fixtures/schema-examples/relationship.json` | Reused |
| Provisioning plan | `schemas/provisioning-plan.schema.json`, `tests/fixtures/schema-examples/provisioning-plan.json` | Reused |
| Drift finding | `schemas/drift-finding.schema.json`, `tests/fixtures/schema-examples/drift-finding.json` | Reused |
| Evidence export | `schemas/evidence-export.schema.json`, `tests/fixtures/schema-examples/evidence-export.json` | Reused |
| Native grants | `schemas/native-grant.schema.json`, `tests/fixtures/schema-examples/native-grant.json` | Reused |
| Synthetic API examples | `examples/api/*.json` | Added |
| Synthetic CLI examples | `examples/cli/operator-and-assessor.sh` | Added |
| Synthetic policy tests | `tests/fixtures/policy/proof-points.json` | Reused |
| Synthetic control/evidence mapping | `examples/control-evidence-mapping.json`, `tests/fixtures/schema-examples/evidence-export.json` | Added/reused |

## Runbook Coverage

| Required runbook | Canonical path | Status |
| --- | --- | --- |
| Emergency revocation | `runbooks/emergency-revocation.md` | Added |
| Policy rollback | `runbooks/policy-rollback.md` | Added |
| Drift remediation | `runbooks/drift-remediation.md` | Added |
| Connector outage | `runbooks/connector-outage.md` | Added |
| Break-glass review | `runbooks/break-glass-review.md` | Added |
| Audit/evidence export | `runbooks/audit-evidence-export.md` | Added |
| Compromised connector credential | `runbooks/compromised-connector-credential.md` | Added |
| Decision API outage | `runbooks/decision-api-outage.md` | Added |

Each runbook includes purpose, trigger, severity, required role, prerequisites, commands or proposed commands, expected output, verification steps, audit events emitted, evidence retained, escalation path, and rollback or compensating action.

## ATO/Control/Evidence Coverage

The documentation connects architecture, control families, implementation behaviors, evidence artifacts, audit logs, schemas, API endpoints, CLI commands, runbooks, and ADRs. It uses ATO-ready, ATO-oriented, ATO-inspectable, and supports ATO evidence language. It does not claim production authorization, FedRAMP status, approved SIEM delivery, WORM storage, or assessor-approved control statements.

## Validation Performed

- `corepack pnpm install` completed with the existing lockfile.
- `git diff --check` passed.
- New standalone JSON examples parsed successfully with Node.
- `corepack pnpm validate:contracts` passed:
  - 13 schemas and 13 schema fixtures validated.
  - 27 required OpenAPI path groups validated.
  - 11 policy proof points validated.
  - CLI contract tests passed.
- `corepack pnpm validate` passed:
  - TypeScript typecheck passed.
  - Contract validation passed.
  - CI workflow validation passed.
  - 5 test files and 106 tests passed.
- `corepack pnpm ci:check` passed:
  - Contract validation, CI workflow validation, typecheck, lint, tests, build, and evidence freshness all passed.
  - `pnpm evidence:check` reported proof-point validation evidence is current.
- Custom runbook section scan passed for all 8 runbooks.
- Custom relative Markdown link scan passed across 35 Markdown files.

## Validation Not Performed And Why

- OpenAPI validation for the new `examples/api/*.json` request/response examples was not performed because the repository does not currently include a standalone example-to-OpenAPI validation script.
- The CLI walkthrough in `examples/cli/operator-and-assessor.sh` was not executed because it requires a running API runtime and is intended as a synthetic documentation walkthrough.

## Known Gaps

- Live Microsoft, AWS, SharePoint, Teams, Power Platform, Dataverse, AD, and Entra ID connector behavior remains planned/draft unless explicitly implemented.
- Persistent graph storage, durable queueing, production WORM audit storage, approved SIEM forwarding, production deployment packaging, and production evidence retention remain future work.
- OSCAL output is guidance only; no OSCAL generator is implemented.
- API examples in `examples/api/` are documentation examples, not currently machine-validated against OpenAPI request schemas.
- CLI example script is a documentation walkthrough and requires a running API.
- Production runbook exercises, post-action reviews, and assessor-approved control statements are deployment-specific.

## Assumptions

- All examples are synthetic.
- Existing schema fixtures remain the canonical schema example location.
- Existing ADR filenames remain canonical.
- Top-level `runbooks/` is acceptable for operational artifacts and is documented in README.
- Current local proof points are implementation evidence for repository behavior, not production authorization evidence.

## Blockers

No documentation-authoring blockers remain. Production ATO blockers are listed in [Outstanding Requirements](outstanding-requirements.md).

## Recommended Next Steps

1. Add OpenAPI `examples:` blocks or a validation script for `examples/api/*.json`.
2. Add a docs link checker if the repository adopts one.
3. Exercise each runbook against a deployed environment and retain evidence.
4. Add OSCAL generation only after deployment-specific control statements and evidence retention are defined.
5. Update the threat model and system boundary for each production deployment.
