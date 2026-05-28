# Drift Remediation Runbook

## Purpose

Triage, remediate, verify, and evidence drift between intended access and observed native grants.

## Trigger

- `rebac reconcile run` opens a drift finding.
- Connector discovery shows unauthorized, missing, inherited, or stale native access.
- Access review identifies mismatch between business intent and provider state.

## Severity

Use the drift finding severity and lifecycle state. Escalate high and critical findings immediately, and treat `expired_exception` as a new security finding until risk acceptance is renewed or access is revoked.

## Required Role

Security engineer, platform engineer, and resource owner for remediation decision.

## Prerequisites

- Drift finding ID.
- Discovery run and native grant references.
- Intended access reference or policy decision.
- Connector status.
- Owner and assignee.
- Approval evidence, change ticket, and SIEM reference for any remediation workflow.
- Auto-repair policy controls proving approval and connector-readiness requirements are enabled and live provider writes are disabled.

## Commands Or Proposed Commands

```sh
rebac reconcile findings --severity high
rebac reconcile findings --status open --lifecycle-state open
rebac resource native-access document:case-plan --connector mock --subject user:alice
rebac explain user:alice read document:case-plan
rebac provision revoke grant:case-plan-read --connector mock
rebac provision apply plan:revoke-case-plan-read --mode dry_run
rebac reconcile remediate --finding drift:001 --change-ticket chg:drift-001 --ticket chg:drift-001 --siem siem:drift-001 --max-severity high
rebac reconcile run --connector mock --dry-run
```

## Expected Output

- Drift finding shows resource, subject, native access, intended access, severity, lifecycle state, owner, assignee, status, and recommended action.
- Remediation plan records approval, ticket/SIEM hook evidence, dry-run repair action, and auto-repair policy controls.
- Reconciliation after remediation confirms closure or residual finding.

## Verification Steps

1. Compare intended decision to native grant readback.
2. Confirm owner, assignee, change ticket, SIEM reference, and exception expiry when applicable.
3. Approve remediation or risk acceptance.
4. Create dry-run repair evidence and verify it performs no provider write.
5. Verify provider readback.
6. Update finding lifecycle state.
7. Export evidence for the finding lifecycle.

## Audit Events Emitted

- `connector.discovery_completed`
- `drift.detected`
- `reconciliation.completed`
- `drift.remediation_approved`
- `drift.repair_dry_run_planned`
- `provisioning.planned`
- `provisioning.job_completed`
- `drift.finding_closed` or equivalent closure evidence
- `evidence.generated`

## Evidence Retained

- Drift finding.
- Native grant readback.
- Intended access reference.
- Owner and assignee.
- Ticket and SIEM hook evidence.
- Remediation approval.
- Auto-repair policy controls.
- Remediation plan/job.
- Dry-run repair evidence proving no provider write.
- Verification readback.
- Exception approval, if accepted.

## Escalation Path

Escalate high/critical unauthorized native grants to incident response and ISSO. Escalate connector coverage gaps to connector owner.

## Rollback Or Compensating Action

If remediation removes required business access, create a reviewed grant or exception with expiration and re-run reconciliation.
