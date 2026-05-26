# Break-Glass Review Runbook

## Purpose

Review emergency access use, confirm it was justified, revoke residual access, and retain evidence.

## Trigger

- Break-glass account or emergency access path is used.
- Incident mode is enabled.
- Emergency exception is approved.

## Severity

High by default because emergency access bypasses normal least-privilege workflows.

## Required Role

Security engineer, ISSO, resource owner, and identity/platform administrator.

## Prerequisites

- Break-glass event reference.
- Subject, resource, reason, approval, and expiry.
- IdP or mTLS gateway session identifier, admin ReBAC role, and emergency elevation ticket.
- Evidence that normal admin role assignment was insufficient or unavailable.
- Provider-native logs when outside Access Kit.

## Commands Or Proposed Commands

```sh
rebac audit search --subject user:break-glass --from 2026-05-23
rebac resource native-access document:case-plan --subject user:break-glass
rebac provision revoke grant:break-glass-case-plan --connector mock
rebac evidence export --framework nist-800-53 --controls AC-2,AC-3,AU-6,IR-4 --from 2026-05-23T00:00:00.000Z --to 2026-05-23T23:59:59.000Z --format json
```

## Expected Output

- Audit search shows emergency activity and correlation IDs.
- Native access readback shows whether access remains.
- Revocation plan/job records removal or provider-native action is attached as evidence.

## Verification Steps

1. Confirm emergency access reason and approval.
2. Confirm the emergency actor was authenticated through the approved IdP or mTLS gateway and mapped to a temporary admin ReBAC role.
3. Confirm access expired, IdP sessions were revoked, temporary role bindings were removed, and provider-native emergency access was disabled.
4. Confirm incident-mode notifications reached the reviewed SIEM, ticketing, paging, or incident-command channels.
5. Review actions performed under emergency access.
6. Record post-action review, residual gaps, and any POA&M item.
7. Export evidence.

## Audit Events Emitted

- `admin.action`
- `provisioning.planned`
- `provisioning.job_completed`
- `audit.exported`
- `evidence.generated`

## Evidence Retained

- Emergency approval and reason.
- Admin identity, gateway or certificate evidence, temporary role-binding evidence, and expiry.
- Incident-mode notification delivery record.
- Audit events.
- Provider logs, when applicable.
- Revocation or expiry verification.
- Post-action review notes.

## Escalation Path

Escalate unauthorized, unexplained, or unrevoked emergency access to incident response and ISSO.

## Rollback Or Compensating Action

Do not restore break-glass access automatically. Create a new emergency approval if continued access is required.
