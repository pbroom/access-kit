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
4. Mismatches are classified by severity and recommended action.
5. Drift findings are written as security objects and audit events.
6. Operators remediate through revoke, repair, expire, exception, or policy update.
7. Verification readback confirms closure.
8. Evidence export retains finding, action, verification, and residual gaps.

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

## Audit And Evidence Implications

Drift findings support AC, AU, CM, CA, RA, SI, and IR controls. Evidence should include source discovery run, native grant IDs, intended state reference, severity, action, verification, and closure status.

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
