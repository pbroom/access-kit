# Start Here

Access Kit is an API-first, CLI-first control plane for relationship-based access control (ReBAC). Applications ask it "can this subject take this action on this resource?" and get a deterministic, deny-by-default answer that the API can also explain. Around that decision core it models relationships and policies, plans and dry-runs provisioning, discovers native grants through read-only connectors, detects drift, keeps a hash-chained audit trail, and exports ATO-oriented evidence packages.

The current repository is a local proof point. It proves contract shape, decision behavior, operational flows, and evidence structure against synthetic data. It is not a production authorization service yet.

## What it is not

This is the canonical boundary statement. Other docs assume it rather than repeat it.

Access Kit does not:

- authenticate users, manage sessions, or act as an identity provider
- replace native enforcement in Entra ID, Active Directory, AWS IAM, SharePoint, Teams, Power Platform, or application code
- act as a SIEM, ticketing system, or generic workflow platform
- perform live provider writes; the Microsoft Graph and AWS connectors are read-only and sandbox-staged
- use LLMs to make authorization decisions, approve access, or create or revoke grants
- claim a production ATO or FedRAMP authorization; it produces evidence that supports ATO inspection

Treat these as security controls: letting observed native access stand in for intended access, enabling live writes before connector security review, or feeding LLM output into decisions would break the trust model.

One framing worth keeping in mind: relationships explain access paths, roles describe responsibilities, and attributes constrain context. Access Kit centers on ReBAC but treats roles and attributes as explicit, reviewable policy inputs rather than flattening everything into relationships.

## Try it

Use Node 22 or newer and pnpm 10.

```sh
corepack enable
pnpm install
pnpm validate      # contracts, docs, policy, tests
pnpm ci:check      # adds lint, build, evidence freshness
```

Then follow the [Quickstart](quickstart.md): a five-minute seeded API demo first, and a full evaluation path (policy tests, dry-run provisioning, reconciliation, audit and evidence export) after that.

## Proof point versus production

| Area               | What the repo proves today                                                                                            | What a production deployment must add                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| API runtime        | Local HTTP API with schema-backed contracts, health/readiness probes, bearer-token guarding, deterministic decisions. | Approved deployment boundary, IdP or mTLS gateway, rate limits, monitoring, environment hardening.         |
| PEP integration    | Decision contracts plus TypeScript, Python, and Go starter enforcement points.                                        | A reviewed PEP that fails closed, propagates correlation IDs, and never falls back to local authorization. |
| Connectors         | Mock, synthetic, and staged read-only Microsoft Graph and AWS discovery.                                              | Per-provider security review, least-privilege scopes, live-write readiness, and rollback evidence.         |
| Audit and evidence | Hash-chain integrity checks, SIEM-ready export shape, local ATO-oriented evidence packages.                           | Immutable/WORM audit storage, approved SIEM forwarding, assessor-reviewed control statements.              |
| Persistence        | In-memory and local-file stores, plus an opt-in PostgreSQL backend.                                                   | Durable backends with backup/restore evidence, migration review, and operational monitoring.               |
| Admin access       | Local bearer tokens and a readiness contract describing IdP/mTLS gateway modes.                                       | A deployed identity gateway, separate admin ReBAC policy, secrets manager, and break-glass evidence.       |

## Known gaps

- Live provider writes remain blocked everywhere; the live-enforcement pilot is a gate contract with synthetic evidence, not an enforcement path.
- Environment-specific graph, queue, and WORM audit drivers, SIEM forwarding, and IdP or mTLS gateway deployment are future work; the adapter boundaries exist as contracts.
- OSCAL output is proof-point fragments; production OSCAL packages need deployment-specific review, signing, and assessor approval.
- Runbook exercises against a deployed environment, post-action reviews, and approved control statements are deployment-specific and not in this repo.

## Where things live

| Question                                                | Source                                                                                                                                                                                  |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What are the API routes and schemas?                    | [openapi/rebac-control-plane.yaml](../openapi/rebac-control-plane.yaml), generated [API Reference](api-reference.md), [API notes](api.md)                                               |
| What objects does it model?                             | [Domain Model](domain-model.md), `schemas/*.schema.json`, `packages/core/src/domain.ts`                                                                                                 |
| How do decisions, explain, caching, and PEPs work?      | [Decisions](decisions.md)                                                                                                                                                               |
| How do I run and evaluate it?                           | [Quickstart](quickstart.md)                                                                                                                                                             |
| How does the system fit together?                       | [Architecture](architecture.md), [System Context and Boundary](system-context-and-boundary.md)                                                                                          |
| How do I write or test policy?                          | [Policy Testing Guide](policy-testing-guide.md), `tests/fixtures/policy/proof-points.json`                                                                                              |
| How do connectors work and how do I build one?          | [Connector Contract](connector-contract.md), [Connector Authoring Tutorial](connector-authoring-tutorial.md), `packages/connectors-sample-readonly/`                                    |
| How do provisioning and drift work?                     | [Provisioning Lifecycle](provisioning-lifecycle.md), [Drift Detection Model](drift-detection-model.md)                                                                                  |
| How do I deploy and operate it?                         | [Deployment](deployment.md), [Deployment Runbook](deployment-runbook.md), [HA and Degraded-Mode Operations](ha-degraded-mode-operations.md), [Persistence](persistence.md), `runbooks/` |
| What is the security and threat posture?                | [Security Model](security-model.md)                                                                                                                                                     |
| What evidence exists and which controls does it map to? | [Evidence Catalog](evidence-catalog.md), [Audit Event Model](audit-event-model.md), [ATO Evidence Model](ato-evidence-model.md)                                                         |
| What is the CLI surface?                                | [CLI Contract](cli.md), `packages/cli/src/commands.ts`                                                                                                                                  |
| How are releases packaged and supported?                | [Product Release Packaging](release-packaging.md), [Support Policy](support-policy.md), [Security Policy](../SECURITY.md), [Changelog](../CHANGELOG.md)                                 |
| What was decided and why?                               | `adrs/*.md`                                                                                                                                                                             |
| What work is planned or in flight?                      | [Implementation Backlog](implementation-backlog.md), [Automation](automation.md)                                                                                                        |

## Reading paths

- **Building an integration:** [Quickstart](quickstart.md), then [Decisions](decisions.md) and [Domain Model](domain-model.md), then the PEP starters under `examples/`.
- **Reviewing the architecture:** [Architecture](architecture.md), [System Context and Boundary](system-context-and-boundary.md), [Security Model](security-model.md), then [Deployment](deployment.md).
- **Assessing evidence:** [Evidence Catalog](evidence-catalog.md), [Audit Event Model](audit-event-model.md), [ATO Evidence Model](ato-evidence-model.md), then the runbooks in `runbooks/`.

## Assumptions

All examples are synthetic. Live tenant identifiers, emails, secrets, tokens, customer names, and production logs stay out of fixtures, examples, and local evidence. Production deployments must replace local proof points with deployment-specific diagrams, retention controls, approvals, and assessor-reviewed control statements.
