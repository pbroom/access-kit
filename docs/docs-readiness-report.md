# Documentation Readiness Report

## Executive Summary

This branch establishes a repo-native documentation foundation for the Access Kit ReBAC authorization control plane. It preserves existing conventions: flat `docs/*.md` narrative pages, zero-padded ADR filenames under `adrs/`, OpenAPI as the API source of truth, JSON Schemas under `schemas/`, validated schema examples under `tests/fixtures/schema-examples/`, and policy proof points under `tests/fixtures/policy/`.

The work adds distinct documentation where coverage was missing, avoids duplicate schema and ADR sources of truth, and records path-equivalence decisions below.

## Goal Completion Status

The documentation goal is complete for the repository foundation after this follow-up hardening: documentation links, runbook structure, API examples, CLI walkthrough coverage, schemas, OpenAPI, policy proof points, tests, build, and evidence freshness are all validated by repeatable repo commands. Production ATO authorization, live provider connectors, durable WORM storage, approved SIEM forwarding, OSCAL generation, and deployment-specific runbook exercise records remain explicitly out of scope for this documentation goal and are tracked as production/runtime gaps.

## Documentation Coverage

| Coverage area | Canonical path |
| --- | --- |
| Start-here overview | `docs/start-here.md`, with root `README.md` as repository overview |
| Concept of operations | `docs/concept-of-operations.md` |
| Glossary | `docs/glossary.md` |
| Non-goals | `docs/non-goals.md`, with summary in `README.md` |
| System context, boundary, data flows, trust boundaries | `docs/system-context-and-boundary.md`, supported by `docs/architecture.md` |
| Production reference architecture and overlays | `docs/production-reference-architecture.md`, `deploy/overlays/production-reference/` |
| Domain model | `docs/domain-model.md` |
| API overview, Decision API, API errors, reason codes | `docs/api.md`, `docs/decision-lifecycle.md`, `docs/explain-api.md` |
| CLI overview and commands | `docs/cli.md`, `packages/cli/src/commands.ts` |
| Policy model and testing | `docs/policy-testing-guide.md`, `tests/fixtures/policy/proof-points.json` |
| Connector contract, capability model, authoring guidance, and sample template | `docs/connector-contract.md`, `docs/connector-authoring-tutorial.md`, `examples/connectors/sample-readonly-template.md`, `packages/connectors-sample-readonly/` |
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
| Connector Authoring Tutorial | `docs/connector-authoring-tutorial.md` | Added |
| Sample Read-Only Connector Template | `examples/connectors/sample-readonly-template.md`, `packages/connectors-sample-readonly/` | Added |
| Drift Detection Model | `docs/drift-detection-model.md` | Added |
| Evidence Catalog | `docs/evidence-catalog.md` | Added |
| Control Traceability Matrix | `docs/control-traceability-matrix.md` | Added |
| Assessor Inspection Guide | `docs/assessor-inspection-guide.md` | Added |
| Threat Model | `docs/threat-model.md` | Added |
| Policy Testing Guide | `docs/policy-testing-guide.md` | Added |
| Production Reference Architecture | `docs/production-reference-architecture.md`, `deploy/overlays/production-reference/` | Added |
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
| `examples/control-evidence-mapping.*` | `examples/control-evidence-mapping.json`, supported by `tests/fixtures/schema-examples/evidence-export.json` | Added and validated | A standalone mapping helps documentation readers; schema-valid package example remains canonical for full evidence export. |
| `examples/api/*` | `examples/api/*.json` | Added and validated | Request/response examples are first-class docs examples and now validate against schema/OpenAPI contracts. |
| `examples/cli/*` | `examples/cli/operator-and-assessor.sh`, supported by `docs/cli.md` and `tests/cli/docs-examples.test.ts` | Added and smoke-tested | CLI examples existed in docs; a synthetic walkthrough is distinct and now covered by local API smoke tests. |
| `adrs/ADR-0001-api-cli-first.md` | `adrs/0001-api-first-cli-first.md` | Mapped | Existing ADR naming convention wins. |
| `adrs/ADR-0002-deterministic-authorization.md` | `adrs/0002-deterministic-authorization.md` | Mapped | Existing ADR naming convention wins. |
| `docs/runbooks/*.md` | `runbooks/*.md` | Added top-level runbook family | Runbooks are operational artifacts distinct from narrative docs; README documents the location. |
| `docs/docs-readiness-report.md` | `docs/docs-readiness-report.md` | Added | Required readiness artifact had no equivalent. |
| `docs/connector-authoring-tutorial.md` | `docs/connector-authoring-tutorial.md` | Added | Author-facing connector guidance is distinct from the connector contract and sample connector template. |
| OSCAL artifacts | `docs/ato-evidence-model.md`, `schemas/evidence-export.schema.json` | Implemented proof-point fragments | Evidence export now includes OSCAL component-definition, SSP, assessment-results, POA&M fragments, signed package metadata, verifier checks, and control-to-event traces generated from canonical evidence data. |

## Existing Artifacts Reused

- `README.md`
- `docs/architecture.md`
- `docs/api.md`
- `docs/cli.md`
- `docs/security-model.md`
- `docs/ato-evidence-model.md`
- `docs/implementation-backlog.md`
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
- `docs/connector-authoring-tutorial.md`
- `examples/connectors/sample-readonly-template.md`
- `packages/connectors-sample-readonly/`
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
| Synthetic API examples | `examples/api/*.json` | Added and validated |
| Synthetic CLI examples | `examples/cli/operator-and-assessor.sh`, `tests/cli/docs-examples.test.ts` | Added and smoke-tested |
| Synthetic policy tests | `tests/fixtures/policy/proof-points.json` | Reused |
| Synthetic control/evidence mapping | `examples/control-evidence-mapping.json`, `tests/fixtures/schema-examples/evidence-export.json` | Added/reused and validated |

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

- AK-051 sample connector template validation passed:
  - `corepack pnpm install --frozen-lockfile` confirmed the new workspace package is lockfile-clean.
  - `corepack pnpm exec vitest run tests/connectors/sample-readonly.test.ts` passed 4 focused sample connector tests.
  - `corepack pnpm exec vitest run tests/connectors` passed 11 connector package tests across Microsoft Graph and the sample template.
  - `corepack pnpm validate:docs` validated 192 relative Markdown links across 43 files, runbook sections, documentation examples, and API reference freshness.
  - `corepack pnpm validate:automation` validated backlog state, scripts, labels, docs, and CI automation contracts.
  - `corepack pnpm validate:connector-security` validated security gates for the 4 runtime connectors.
  - `corepack pnpm evidence:generate` refreshed proof-point validation evidence for the expanded connector test surface.
  - `corepack pnpm evidence:check` confirmed proof-point validation evidence is current.
  - `git diff --check` passed.
  - `corepack pnpm ci:check` passed after the template, tests, docs, lockfile, and evidence updates.
- AK-041 production reference architecture validation passed:
  - `corepack pnpm validate:docs` validated 197 relative Markdown links across 43 files, including the new production reference architecture links, overlay README, runbook sections, documentation examples, and API reference freshness.
  - `corepack pnpm validate:deployment-manifests` validated the base Kubernetes manifest contract that the production-reference overlay composes.
  - `corepack pnpm validate:persistence-deployment` validated production persistence evidence manifests referenced by the architecture.
  - `corepack pnpm validate:automation` validated the AK-041 backlog status update.
  - `corepack pnpm ci:check` passed after the reference architecture and overlay updates.
- AK-050 connector authoring update validation passed:
  - `corepack pnpm validate:docs` validated 187 relative Markdown links across 42 files, runbook sections, documentation examples, and API reference freshness.
  - `corepack pnpm validate:automation` validated backlog state, scripts, labels, docs, and CI automation contracts.
  - `corepack pnpm validate:connector-security` validated security gates for the 4 registered connectors.
  - `corepack pnpm evidence:check` confirmed proof-point validation evidence is current.
  - `git diff --check` passed.
  - `corepack pnpm ci:check` passed after the tutorial and navigation updates.
- `corepack pnpm install` completed with the existing lockfile.
- `git diff --check` passed.
- New standalone JSON examples parsed successfully with Node.
- `corepack pnpm validate:docs` passed:
  - Relative Markdown links were validated across README, docs, runbooks, and examples.
  - All 8 runbooks were checked for the 12 required runbook sections.
  - Documentation examples were validated against JSON Schema, OpenAPI request schema, or the local control/evidence mapping example contract.
- `corepack pnpm validate:contracts` passed:
  - 13 schemas and 13 schema fixtures validated.
  - 27 required OpenAPI path groups validated.
  - `examples/api/decision-check.request.json` and `examples/api/explain.response.json` validated against their OpenAPI request/response schemas.
  - 11 policy proof points validated.
  - CLI contract tests passed.
- `corepack pnpm test:cli` passed with the synthetic docs walkthrough covered by `tests/cli/docs-examples.test.ts`.
- `corepack pnpm validate` passed:
  - TypeScript typecheck passed.
  - Contract validation passed.
  - CI workflow validation passed.
  - 6 test files and 107 tests passed.
- `corepack pnpm ci:check` passed:
  - Contract validation, docs validation, CI workflow validation, typecheck, lint, tests, build, and evidence freshness all passed.
  - `pnpm evidence:check` reported proof-point validation evidence is current.
- Custom runbook section scan passed for all 8 runbooks.
- Custom relative Markdown link scan passed across 35 Markdown files.

## Validation Not Performed And Why

- Provider-native emergency actions in runbooks were not executed because live Microsoft, AWS, SharePoint, Teams, Power Platform, Dataverse, AD, and Entra ID connector writes are outside the current repository implementation.
- Deployment-specific runbook exercises, IdP or mTLS gateway smoke tests, admin session revocation, post-action reviews, and assessor approvals were not performed because they require a deployed target environment.

## Known Gaps

- Live Microsoft, AWS, SharePoint, Teams, Power Platform, Dataverse, AD, and Entra ID connector behavior remains planned/draft unless explicitly implemented.
- Environment-specific graph storage drivers, managed queue workers, selected WORM or immutable-ledger audit drivers, approved SIEM forwarding deployment, IdP or mTLS gateway deployment, admin ReBAC role-binding evidence, and production evidence retention remain future work. The production audit/evidence adapter and admin authorization readiness boundaries are implemented as contract proof points, not as approved deployments.
- OSCAL output is implemented as proof-point evidence fragments; production OSCAL packages still require deployment-specific review, signing keys, retention, and assessor approval.
- Production runbook exercises, post-action reviews, and assessor-approved control statements are deployment-specific and out of scope for the local documentation foundation.

## Assumptions

- All examples are synthetic.
- Existing schema fixtures remain the canonical schema example location.
- Existing ADR filenames remain canonical.
- Top-level `runbooks/` is acceptable for operational artifacts and is documented in README.
- Current local proof points are implementation evidence for repository behavior, not production authorization evidence. Local bearer-token admin readiness is explicitly non-production.

## Blockers

No documentation-goal blockers remain. Production ATO/runtime blockers are out of scope for this documentation goal and are tracked in the [Implementation Backlog](implementation-backlog.md).

## Recommended Next Steps

1. Exercise each runbook against a deployed environment and retain evidence.
2. Add OpenAPI `examples:` blocks if generated API reference output is introduced.
3. Add OSCAL generation only after deployment-specific control statements and evidence retention are defined.
4. Update the threat model and system boundary for each production deployment.
5. Replace local proof-point evidence with deployment-specific assessor-reviewed artifacts during production ATO preparation.
