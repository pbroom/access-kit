# Access Review And Exception Governance

## Purpose

Run durable access-review campaigns, exception requests, risk acceptance, expiry, remediation tracking, owner approvals, ConMon metrics, and POA&M-ready finding evidence without treating local proof-point records as production authorization.

## Trigger

- A scheduled access review is due.
- Reconciliation creates a drift finding that requires revoke, repair, review, or exception handling.
- An exception request is nearing review, expiry, or remediation due date.
- An assessor asks for residual-risk, owner-approval, ConMon, or POA&M evidence.

## Severity

High for privileged or sensitive-resource findings, critical for expired exceptions on critical resources, and medium for routine review campaigns with no overdue remediation.

## Required Role

Security engineer, data steward, resource owner, ISSO, and Authorizing Official for accepted residual risk.

## Prerequisites

- Durable graph, job, audit, and admin authorization controls are configured for the target environment.
- Reconciliation findings, source audit events, and evidence exports are retained.
- Resource owners and approvers are known for the reviewed scope.
- Exception handling does not grant access by itself; it only records residual-risk governance.

## Commands Or Proposed Commands

```sh
rebac connector sync mock --mode read_only
rebac reconcile run --connector mock --dry-run
rebac evidence export --controls CA-7,RA-5 --format json
```

Future production operators should use equivalent scheduled campaign, exception approval, risk acceptance, and remediation commands once those APIs are backed by selected ticketing and GRC systems.

## Expected Output

- `accessReviews` contains a stable campaign ID, owner role, due date, owner approvals, finding IDs, exception request IDs, and remediation item IDs.
- `exceptionRegister` contains request status, owner approvals, risk acceptance state, expiry, review date, remediation tracking, source finding ID, controls, and evidence references.
- `conmonMetrics` contains governance counters for campaigns, open findings, open and expired exception requests, pending approvals, pending risk acceptances, and overdue remediation.
- `poamItems` contains governance findings with stable POA&M IDs, owners, due dates, weakness text, and status.

## Verification Steps

1. Confirm the evidence export validates against `schemas/evidence-export.schema.json`.
2. Confirm governance records persist through the job repository or runtime state repository and survive restart.
3. Confirm expired exception requests do not change authorization decisions or silently allow access.
4. Confirm overdue remediation appears in ConMon metrics and POA&M items.
5. Confirm owner approval and risk acceptance evidence contains roles and retained references, not secrets or live tenant identifiers.

## Audit Events Emitted

- `connector.discovery_completed`
- `reconciliation.completed`
- `audit.integrity_verified`
- `evidence.generated`

## Evidence Retained

- Evidence export package with `accessReviews`, `exceptionRegister`, `conmonMetrics`, and `poamItems`.
- Drift findings and reconciliation runs in the job repository.
- Audit events and evidence storage receipts.
- Linked approval, risk acceptance, ticket, or GRC references when production integrations exist.

## Escalation Path

Escalate expired high or critical exceptions to the ISSO, Authorizing Official, incident response lead, and resource owner. Escalate missing owner approval or missing risk acceptance before evidence is used for assessor review.

## Rollback Or Compensating Action

Rollback is remediation, revocation, or a superseding reviewed exception with a new expiry. If governance evidence was generated with incorrect scope or owner data, regenerate the campaign evidence after correcting the source records and retain the superseded package for audit traceability.
