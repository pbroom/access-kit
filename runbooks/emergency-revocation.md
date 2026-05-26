# Emergency Revocation Runbook

## Purpose

Rapidly remove or neutralize unauthorized, expired, compromised, or high-risk access while preserving audit and evidence traceability.

## Audience

Security engineers, platform engineers, ISSOs, incident responders, resource owners, and assessors.

## What This Is

This is the flagship runbook for revocation-first operations in Access Kit. It uses deterministic decisions, provisioning plans, connector readback, drift findings, audit events, and evidence exports.

## What This Is Not

This is not a replacement for identity-provider account disablement, provider-native emergency controls, legal hold procedures, or incident command. Native platforms still enforce local access and may require direct action.

## Core Concepts

- Revocation has higher priority than new grants.
- Expiration, quarantine, suspension, and explicit deny are first-class authorization controls.
- Access Kit can plan, verify, reconcile, audit, and evidence revocation, but live provider-native revocation remains outside the current local proof point.
- Native grant readback must be compared to intended access before closure.
- Emergency restoration requires a new approved grant or exception with expiration and audit evidence.

## Concrete Example

An access review finds `user:alice` still has a direct native `read` grant on `document:case-plan` after the intended access expired. The operator checks the explanation, inspects native access, creates a dry-run revocation plan against the mock connector, verifies reconciliation, and exports incident-window evidence. In production, an approved provider administrator would also remove any live native grant directly when Access Kit cannot enforce that provider.

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
- Approved admin identity path, admin ReBAC role, and break-glass approval when emergency operator elevation is required.
- Access to provider-native emergency controls if Access Kit cannot enforce live revocation.

## Commands Or Proposed Commands

```sh
rebac explain user:alice read document:case-plan
rebac resource native-access document:case-plan --subject user:alice
rebac provision revoke native-grant:document:case-plan:alice --connector mock
rebac provision apply plan:revoke:native-grant:document:case-plan:alice --mode dry_run
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
2. If emergency operator elevation was used, confirm the IdP or mTLS gateway session, temporary admin ReBAC role, expiry, and approval evidence.
3. Confirm the direct grant is gone or that inherited/group access has been remediated.
4. Run `rebac explain` and confirm deny or approved exception.
5. Run reconciliation and confirm finding closure or documented residual risk.
6. Confirm incident-mode notifications and post-action review ownership.
7. Export audit/evidence for the incident window.

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
- Admin authorization readiness state, emergency approval, session revocation, temporary role-binding removal, notification delivery, and post-action review when operator elevation was used.
- Audit integrity report and evidence export.
- Provider-native revocation receipt, when outside Access Kit.

## Audit And Evidence Implications

Emergency revocation evidence must preserve the incident or change reference, decision/explanation output, native readback, provisioning plan/job, verification result, drift status, audit export, and evidence export. If live provider-native action is required outside Access Kit, retain that external receipt and record the gap in the evidence package or incident record.

## Related Controls

AC-2, AC-3, AC-6, AU-2, AU-6, CA-7, CM-3, IR-4, IR-5, RA-5, and SI-4 depend on rapid revocation, verification, auditability, and drift closure.

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
