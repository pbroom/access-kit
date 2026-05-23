# Emergency Revocation Runbook

## Purpose

Rapidly remove or neutralize unauthorized, expired, compromised, or high-risk access while preserving audit and evidence traceability.

## Audience

Security engineers, platform engineers, ISSOs, incident responders, resource owners, and assessors.

## What This Is

This is the flagship runbook for revocation-first operations in Access Kit. It uses deterministic decisions, provisioning plans, connector readback, drift findings, audit events, and evidence exports.

## What This Is Not

This is not a replacement for identity-provider account disablement, provider-native emergency controls, legal hold procedures, or incident command. Native platforms still enforce local access and may require direct action.

## Trigger

- Unauthorized native grant discovered.
- Compromised subject, service account, connector credential, or group.
- Expired access remains active.
- Legal, incident, or data-owner request to remove access immediately.
- Critical or high drift finding with recommended action `revoke`.

## Severity

Default severity is high. Use critical when sensitive resources, privileged access, active compromise, legal hold, or public exposure is suspected.

## Required Role

Security engineer or incident responder with resource owner or ISSO awareness. Production live providers may require native platform administrator approval.

## Prerequisites

- Canonical subject or grant identifier.
- Target resource or provider object identifier.
- Connector status and latest readback, if available.
- Change or incident reference such as `inc:2026-05-23-001`.
- Access to provider-native emergency controls if Access Kit cannot enforce live revocation.

## Commands Or Proposed Commands

```sh
rebac explain user:alice read document:case-plan
rebac resource native-access document:case-plan --subject user:alice
rebac provision revoke grant:case-plan-read --connector mock
rebac provision apply plan:revoke-case-plan-read --mode dry_run --change-ticket inc:2026-05-23-001
rebac reconcile run --connector mock --dry-run
rebac audit search --subject user:alice --from 2026-05-23
rebac evidence export --framework nist-800-53 --controls AC-2,AC-3,AU-2,IR-4 --from 2026-05-23T00:00:00.000Z --to 2026-05-23T23:59:59.000Z --format json
```

For live providers not implemented by this repository, execute approved provider-native revocation in parallel and retain external evidence.

## Expected Output

- Explain response shows deny, explicit deny, or the path to revoke.
- Native access readback identifies direct, inherited, or group-derived provider grant.
- Provisioning plan records revoke action, idempotency key, verification expectation, and compensation state.
- Dry-run job records skipped provider write in the current local proof point.
- Reconciliation returns no remaining unauthorized access or an open drift finding requiring escalation.

## Verification Steps

1. Run native readback for the resource and subject.
2. Confirm the direct grant is gone or that inherited/group access has been remediated.
3. Run `rebac explain` and confirm deny or approved exception.
4. Run reconciliation and confirm finding closure or documented residual risk.
5. Export audit/evidence for the incident window.

## Audit Events Emitted

- `decision.allowed` or `decision.denied`
- `provisioning.planned`
- `provisioning.job_completed`
- `connector.discovery_completed`
- `drift.finding_opened` or equivalent reconciliation event
- `audit.exported`
- `evidence.generated`

## Evidence Retained

- Decision or explanation response.
- Native grant readback before and after action.
- Provisioning plan and job evidence.
- Reconciliation result and drift finding status.
- Change or incident reference.
- Audit integrity report and evidence export.
- Provider-native revocation receipt, when outside Access Kit.

## Escalation Path

Escalate to incident commander, resource owner, ISSO, and provider platform administrator when critical data, privileged access, connector compromise, failed verification, or live provider outage is involved.

## Rollback Or Compensating Action

Emergency revocation should not be rolled back without resource owner and ISSO approval. If access was removed incorrectly, create a new reviewed grant or exception with expiration, reason, policy version, and audit evidence.

## Security Considerations

- Revocation outranks new grants.
- Expiration and quarantine are first-class controls.
- Do not wait for normal access-review cadence during active compromise.
- Document provider-native emergency action when Access Kit does not yet support live writes.

## Related References

- [Decision Lifecycle](../docs/decision-lifecycle.md)
- [Provisioning Lifecycle](../docs/provisioning-lifecycle.md)
- [Drift Detection Model](../docs/drift-detection-model.md)
- [Audit Event Model](../docs/audit-event-model.md)
- [ADR 0010: Fail behavior](../adrs/0010-fail-behavior.md)
