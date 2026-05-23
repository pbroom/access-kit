# Decision API Outage Runbook

## Purpose

Maintain safe authorization behavior when the Decision API is unavailable, degraded, or returning invalid responses.

## Trigger

- `/v1/health` fails.
- Decision latency or error rate exceeds threshold.
- Applications cannot call `check` or `explain`.
- Audit events are not being emitted for decisions.

## Severity

High for sensitive resources or broad application impact. Critical when unauthorized access may be allowed.

## Required Role

Platform engineer, application owner, security engineer, and incident commander for critical outages.

## Prerequisites

- Affected applications and resources.
- Last known policy version and relationship version.
- Application fail-behavior configuration.
- Audit event status.

## Commands Or Proposed Commands

```sh
curl http://127.0.0.1:3000/v1/health
rebac check user:alice read document:case-plan
rebac explain user:alice read document:case-plan
rebac audit search --from 2026-05-23
```

## Expected Output

- Health endpoint returns version and status when API is available.
- Decision commands return deterministic allow or deny responses.
- Audit search shows decision events after recovery.

## Verification Steps

1. Confirm outage scope.
2. Confirm applications fail closed for sensitive resources.
3. Permit cached low-risk reads only when policy explicitly allows it.
4. Restore API and verify health.
5. Run sample `check` and `explain`.
6. Confirm audit events were emitted after recovery.

## Audit Events Emitted

- `decision.allowed` or `decision.denied` after recovery.
- `admin.action` or incident event when implemented.
- `audit.exported`
- `evidence.generated`

## Evidence Retained

- Health check output.
- Incident timeline.
- Application fail-behavior evidence.
- Sample decisions after recovery.
- Audit export for outage window.

## Escalation Path

Escalate to incident response, application owners, resource owners, and ISSO when sensitive resources cannot be safely evaluated.

## Rollback Or Compensating Action

Keep sensitive resources fail-closed until deterministic decisions and audit events are restored. Revoke or quarantine access if stale decisions may have allowed unauthorized access.
