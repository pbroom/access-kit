# Drift Detection Model

## Purpose

This page explains how Access Kit treats drift between intended grants and observed native grants as a first-class security finding.

## Audience

Security engineers, platform engineers, ISSOs, assessors, resource owners, and incident responders.

## What This Is

Drift detection compares the intended authorization state produced by policy, approvals, and provisioning plans with native access observed through connector readback. A mismatch becomes a `DriftFinding`.

## What This Is Not

Drift is not just a connector warning, SIEM alert, or helpdesk ticket. It is an authorization control-plane object that requires triage, remediation, evidence, and closure.

## Drift Lifecycle

1. Discovery records observed native grants.
2. Intended access is derived from decisions, approvals, plans, and managed grants.
3. Reconciliation compares intended and observed state.
4. Scheduled reconciliation records whether the run was manual or scheduled, the cadence, window, next run, grace period, and overdue flag.
5. Mismatches are classified by severity, owner, assignee, lifecycle state, and recommended action.
6. Drift findings are written as security objects and audit events.
7. Ticket and SIEM hook evidence links the finding to operator and monitoring workflows.
8. Operators approve remediation before any dry-run repair plan is created.
9. Auto-repair policy controls remain explicit: approval and connector readiness are required, live provider writes stay disabled, and allowed actions plus maximum severity are recorded with the finding.
10. Verification readback confirms closure.
11. Evidence export retains finding, action, verification, exception expiry, and residual gaps.

## Lifecycle States

| State | Meaning | Next action |
| --- | --- | --- |
| `open` | Reconciliation detected drift and no operator has triaged it yet. | Assign owner and assignee, link ticket/SIEM evidence, and choose revoke, repair, exception, or review. |
| `triaged` | Owner has reviewed the finding and confirmed the remediation path. | Capture approval or risk-acceptance evidence. |
| `accepted` | Risk was accepted for a bounded exception window. | Track `exceptionExpiresAt` and re-open if the exception expires. |
| `remediation_pending` | Remediation is approved but no repair plan has been generated. | Create a dry-run repair plan. |
| `repairing` | A dry-run repair plan exists and is awaiting verification or execution in a later approved workflow. | Review dry-run evidence and provider readback. |
| `resolved` | Readback confirms intended and native access align. | Retain closure evidence. |
| `expired_exception` | A previously accepted exception passed its expiry. | Escalate as an open security finding and revoke or re-approve. |

## Common Drift Types

| Type | Example | Recommended action |
| --- | --- | --- |
| Unauthorized native grant | Provider shows access with no intended grant. | Revoke or quarantine. |
| Missing native grant | Intended access exists but provider lacks it. | Repair after approval. |
| Expired access still active | Native access remains after expiration. | Emergency revoke if sensitive. |
| Inherited access surprise | Group-derived or inherited provider access exceeds intended path. | Review group/resource inheritance and update policy or provider state. |
| Connector coverage gap | Connector warning prevents complete readback. | Treat as degraded evidence and escalate. |

## Concrete Example

`user:alice` no longer has an intended read grant for `document:case-plan`, but discovery sees a direct native grant from `mock`. Reconciliation returns a high-severity `DriftFinding` with recommended action `revoke`. The operator runs the drift remediation runbook, creates a revocation plan, verifies readback, and records closure evidence.

## Security Considerations

- High and critical drift should favor revoke or quarantine before new grants.
- A connector outage can hide drift and should be tracked as degraded evidence.
- Native grants may be direct, inherited, or group-derived; remediation must avoid breaking unrelated access without review.
- Exceptions need owner approval, expiry, and evidence.
- Auto-repair policy cannot permit live provider writes in the local proof point. Dry-run repair evidence may be generated only after approval and connector-readiness controls are recorded.
- Ticket and SIEM hook evidence should use synthetic or redacted identifiers in local proof-point artifacts.

## Audit And Evidence Implications

Drift findings support AC, AU, CM, CA, RA, SI, and IR controls. Evidence should include source discovery run, native grant IDs, intended state reference, severity, lifecycle state, owner, assignee, ticket/SIEM hook evidence, action, approval, dry-run repair plan, exception expiry, verification, and closure status.

## Related Controls

AC-2, AC-3, AC-6, AU-6, CM-3, CM-6, CA-7, RA-5, SI-4, and IR-4.

## Related References

- [Connector Contract](connector-contract.md)
- [Provisioning Lifecycle](provisioning-lifecycle.md)
- [Drift Remediation Runbook](../runbooks/drift-remediation.md)
- `schemas/drift-finding.schema.json`
- `tests/fixtures/schema-examples/drift-finding.json`
- `POST /v1/reconciliation/run`
- `GET /v1/reconciliation/findings`
