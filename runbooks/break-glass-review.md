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
2. Confirm access expired or was revoked.
3. Review actions performed under emergency access.
4. Record post-action review and gaps.
5. Export evidence.

## Audit Events Emitted

- `admin.action`
- `provisioning.planned`
- `provisioning.job_completed`
- `audit.exported`
- `evidence.generated`

## Evidence Retained

- Emergency approval and reason.
- Audit events.
- Provider logs, when applicable.
- Revocation or expiry verification.
- Post-action review notes.

## Escalation Path

Escalate unauthorized, unexplained, or unrevoked emergency access to incident response and ISSO.

## Rollback Or Compensating Action

Do not restore break-glass access automatically. Create a new emergency approval if continued access is required.
