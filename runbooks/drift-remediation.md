# Drift Remediation Runbook

## Purpose

Triage, remediate, verify, and evidence drift between intended access and observed native grants.

## Trigger

- `rebac reconcile run` opens a drift finding.
- Connector discovery shows unauthorized, missing, inherited, or stale native access.
- Access review identifies mismatch between business intent and provider state.

## Severity

Use the drift finding severity. Escalate high and critical findings immediately.

## Required Role

Security engineer, platform engineer, and resource owner for remediation decision.

## Prerequisites

- Drift finding ID.
- Discovery run and native grant references.
- Intended access reference or policy decision.
- Connector status.

## Commands Or Proposed Commands

```sh
rebac reconcile findings --severity high
rebac resource native-access document:case-plan --connector mock --subject user:alice
rebac explain user:alice read document:case-plan
rebac provision revoke grant:case-plan-read --connector mock
rebac provision apply plan:revoke-case-plan-read --mode dry_run
rebac reconcile run --connector mock --dry-run
```

## Expected Output

- Drift finding shows resource, subject, native access, intended access, severity, status, and recommended action.
- Remediation plan records revoke, repair, expire, or verify action.
- Reconciliation after remediation confirms closure or residual finding.

## Verification Steps

1. Compare intended decision to native grant readback.
2. Execute approved revoke, repair, exception, or policy update.
3. Verify provider readback.
4. Update finding status.
5. Export evidence for the finding lifecycle.

## Audit Events Emitted

- `connector.discovery_completed`
- `drift.finding_opened`
- `provisioning.planned`
- `provisioning.job_completed`
- `drift.finding_closed` or equivalent closure evidence
- `evidence.generated`

## Evidence Retained

- Drift finding.
- Native grant readback.
- Intended access reference.
- Remediation plan/job.
- Verification readback.
- Exception approval, if accepted.

## Escalation Path

Escalate high/critical unauthorized native grants to incident response and ISSO. Escalate connector coverage gaps to connector owner.

## Rollback Or Compensating Action

If remediation removes required business access, create a reviewed grant or exception with expiration and re-run reconciliation.
