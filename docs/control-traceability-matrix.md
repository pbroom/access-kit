# Control Traceability Matrix

## Purpose

This page maps ATO-oriented control families to Access Kit behaviors, contracts, evidence, runbooks, and known gaps.

## Audience

ISSOs, assessors, security engineers, platform engineers, governance leads, and control owners.

## What This Is

The matrix is a documentation foundation for tracing controls to implementation and evidence. It uses NIST/FedRAMP-relevant family labels but does not claim formal authorization.

## What This Is Not

This is not an approved SSP, FedRAMP package, control inheritance statement, or final assessor determination.

## Matrix

| Control area | Implemented or proof-point behavior | Evidence references | Known gaps |
| --- | --- | --- | --- |
| AC-2 Account Management | Canonical subjects, lifecycle state, access review evidence, revocation-first runbooks. | `schemas/subject.schema.json`, `schemas/evidence-export.schema.json`, [Emergency Revocation Runbook](../runbooks/emergency-revocation.md) | Production identity source integration and durable access campaigns. |
| AC-3 Access Enforcement | Deterministic decisions, deny by default, reason codes, policy/relationship versions. | [Decision Lifecycle](decision-lifecycle.md), `schemas/decision.schema.json`, audit events | Production PDP deployment and application integration evidence. |
| AC-6 Least Privilege | Connector capability model, read-only discovery, synthetic enforcement gates, and admin authorization readiness for separate admin ReBAC roles. | [Connector Contract](connector-contract.md), `schemas/enforcement-readiness.schema.json`, `packages/core/src/admin-authorization.ts` | Live connector least-privilege reviews and deployed admin role-binding evidence. |
| AU-2/AU-3 Audit Events | Append-only audit event schema, event coverage, immutable production audit receipts, and retention metadata. | [Audit Event Model](audit-event-model.md), `schemas/audit-event.schema.json`, `tests/core/production-audit.test.ts` | Environment-specific WORM driver and retained deployment approvals. |
| AU-6 Audit Review | Audit integrity, signed audit windows, SIEM-ready export metadata, delivery failure findings, replay receipts, and degraded audit-forwarder recovery evidence. | `schemas/audit-integrity.schema.json`, `schemas/audit-export.schema.json`, [HA And Degraded-Mode Operations](ha-degraded-mode-operations.md), `tests/core/production-audit.test.ts` | Approved SIEM forwarding deployment and alert playbooks. |
| CM-3 Configuration Change | ADRs, policy versions, connector readiness, idempotent provisioning. | `adrs/`, [Provisioning Lifecycle](provisioning-lifecycle.md) | Production change-management integration. |
| CA-7 Continuous Monitoring | ConMon metrics in evidence export and validation evidence. | `reports/proof-point-validation.md`, [Evidence Catalog](evidence-catalog.md) | Deployed metrics pipeline and retained scan artifacts. |
| IA | Authentication boundary is documented and the admin authorization contract requires IdP or mTLS gateway, MFA, session TTL, revocation SLA, and evidence references before production readiness. | [System Context and Boundary](system-context-and-boundary.md), [Security Model](security-model.md), `tests/core/admin-authorization.test.ts` | Production IdP or mTLS gateway configuration evidence and request-scoped actor binding. |
| IR | Emergency revocation, connector outage, compromised credential, decision API outage, degraded-mode response, break-glass approval, incident notification, and post-action review runbooks. | `runbooks/*.md`, [Degraded Mode Operations Runbook](../runbooks/degraded-mode-operations.md), `tests/core/admin-authorization.test.ts` | Exercised incident records and retained post-action reviews. |
| RA/SI | Drift findings and reconciliation treat unauthorized access as a security finding. | [Drift Detection Model](drift-detection-model.md), `schemas/drift-finding.schema.json` | Production vulnerability and monitoring integrations. |
| SC | Boundary, data flows, API-first contract, and future encryption/key management expectations. | [System Context and Boundary](system-context-and-boundary.md), [Security Model](security-model.md) | Deployment-specific encryption and network controls. |
| SA/SR | ADRs, CI validation, dependency/security workflow notes. | [CI](ci.md), `.github/workflows/security.yml` | Release-retained SBOM and supply-chain evidence. |
| PT | Data minimization and synthetic examples. | [Security Model](security-model.md), [Non-Goals](non-goals.md) | Deployment privacy impact analysis. |

## Concrete Example

For AC-3, an assessor can trace from a decision audit event to `schemas/decision.schema.json`, `packages/core/src/engine.ts`, the OpenAPI endpoint, proof-point tests, the explain response, and control mapping in an evidence export.

## Security Considerations

Control mappings must be honest about proof-point versus production status. Planned controls should remain marked as planned or partially implemented until deployment evidence exists.

## Audit And Evidence Implications

Evidence exports should include control mappings with source event IDs, implementation summaries, gaps, and status. Control statements require review before production use.

## Related References

- [Evidence Catalog](evidence-catalog.md)
- [Assessor Inspection Guide](assessor-inspection-guide.md)
- [ATO Evidence Model](ato-evidence-model.md)
- `schemas/evidence-export.schema.json`
- `tests/fixtures/schema-examples/evidence-export.json`
