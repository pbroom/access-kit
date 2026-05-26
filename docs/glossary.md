# Glossary

## Purpose

This glossary aligns documentation, API contracts, CLI commands, schemas, runbooks, and assessor evidence on shared terms.

## Core Terms

| Term | Definition | Source of truth |
| --- | --- | --- |
| Subject | A person, group, service account, service principal, managed identity, device, or workload. | `schemas/subject.schema.json` |
| Resource | A governed object such as a workspace, document, application, dataset, AWS role, or API. | `schemas/resource.schema.json` |
| Relationship tuple | A versioned business fact connecting a subject to an object through a relation. It is not a permission by itself. | `schemas/relationship.schema.json` |
| Policy model | Versioned authorization rules that interpret relationship facts and request context. | `schemas/policy-model.schema.json`, `packages/core/src/policy-model.ts`, `tests/fixtures/policy/proof-points.json` |
| Decision | A deterministic allow or deny result for subject, action, resource, policy version, and relationship version. | `schemas/decision.schema.json` |
| Explanation | Decision evidence that includes reason code, relationship path, constraints, and versions. The current response shape is the decision schema with relationship path populated. | `schemas/decision.schema.json` |
| Reason code | Stable machine-readable decision rationale such as `ALLOW_VIA_RELATIONSHIP_PATH` or `DENY_DEFAULT_NO_RELATIONSHIP_PATH`. | `packages/core/src/engine.ts` |
| Intended grant | Desired access state created by policy and approvals. | `packages/core/src/domain.ts` |
| Native grant | Observed provider-enforced access from readback, such as a group membership or platform permission. It is not automatically intended access. | `schemas/native-grant.schema.json` |
| Provisioning plan | Auditable plan that translates an allowed request or revocation into connector actions. | `schemas/provisioning-plan.schema.json` |
| Provisioning job | Execution evidence for a plan. Dry-run jobs skip provider writes; synthetic enforcement is limited to the mock connector. | `packages/core/src/domain.ts` |
| Discovery run | Read-only connector inventory and native-access readback evidence. | `schemas/discovery-run.schema.json` |
| Drift finding | Difference between intended access and observed native access. Drift is a security finding. | `schemas/drift-finding.schema.json` |
| Audit event | Append-only record of decisions, policy changes, connector actions, provisioning activity, drift, admin actions, and evidence generation. | `schemas/audit-event.schema.json` |
| Audit integrity report | Hash-chain verification output for append-only audit events. | `schemas/audit-integrity.schema.json` |
| Audit export | Time-bounded SIEM-ready audit event package. | `schemas/audit-export.schema.json` |
| Evidence export | ATO-oriented package manifest containing evidence, mappings, boundary data, operational evidence, and audit integrity. | `schemas/evidence-export.schema.json` |
| Enforcement readiness report | Connector-specific evidence that controlled enforcement preconditions were checked. | `schemas/enforcement-readiness.schema.json` |
| Control mapping | Link from a control ID to implementation summary, evidence types, source event IDs, gaps, and status. | `schemas/evidence-export.schema.json` |

## Authorization Source-Of-Truth Boundaries

Relationship facts are not permissions. Policy rules are not decisions. Decisions are not grants. Intended grants are not native grants. Provisioning actions are not verification. Drift findings are not incidental logs. Audit evidence is not mutable operational state.

## Related References

- [Domain Model](domain-model.md)
- [Decision Lifecycle](decision-lifecycle.md)
- [Provisioning Lifecycle](provisioning-lifecycle.md)
- [Audit Event Model](audit-event-model.md)
- [Evidence Catalog](evidence-catalog.md)
