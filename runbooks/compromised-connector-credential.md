# Compromised Connector Credential Runbook

## Purpose

Contain, rotate, and evidence suspected or confirmed compromise of a connector credential or connector identity.

## Trigger

- Secret scanning alert.
- Provider alert for connector identity.
- Unexpected connector activity.
- Credential exposure in logs, commits, tickets, or chat.

## Severity

Critical for live write-capable credentials. High for read-only credentials. Medium for synthetic/local-only proof points.

## Required Role

Security engineer, connector owner, provider platform administrator, and ISSO for high or critical severity.

## Prerequisites

- Connector ID and provider boundary.
- Credential or identity reference.
- Last known connector activity.
- Provider-native revocation/rotation access.
- Approved admin identity path, temporary elevation approval, and secrets-manager access record for the rotation operator.

## Commands Or Proposed Commands

```sh
rebac connector list
rebac connector test mock
rebac discovery runs --connector mock
pnpm validate:connector-security
rebac audit search --from 2026-05-23
rebac evidence export --framework nist-800-53 --controls IA-5,AC-6,AU-6,IR-4 --from 2026-05-23T00:00:00.000Z --to 2026-05-23T23:59:59.000Z --format json
```

For live providers, immediately disable or rotate the provider credential using approved provider-native procedures.

## Expected Output

- Connector inventory identifies affected boundary and capability.
- Audit search shows recent connector activity.
- Evidence export records incident actions and gaps.

## Verification Steps

1. Disable or rotate credential.
2. Confirm the rotation operator used the approved IdP or mTLS gateway path and a least-privilege admin ReBAC role.
3. Confirm old credential no longer works.
4. Confirm new credential has least privilege and is stored through the approved secrets manager.
5. Revoke temporary elevation and record incident notification delivery.
6. Run `pnpm validate:connector-security` to confirm identity, consent, scopes, tenant boundary, secret handling, and no-write defaults still match the reviewed gate.
7. Run connector test.
8. Run discovery or reconciliation if readback integrity may be affected.
9. Review audit events for unauthorized activity and retain post-action review evidence.

## Audit Events Emitted

- `connector.tested`
- `connector.discovery_completed`
- `admin.action`
- `audit.exported`
- `evidence.generated`

## Evidence Retained

- Secret alert or provider alert.
- Rotation or disablement receipt.
- Admin session, role binding, secrets-manager reference, notification, and post-action review evidence.
- Connector test after rotation.
- Activity review.
- Updated least-privilege review.
- Connector security gate output.

## Escalation Path

Escalate critical credential compromise to incident commander, ISSO, provider platform owner, legal/privacy contacts as required, and resource owners for impacted boundaries.

## Rollback Or Compensating Action

Do not restore compromised credentials. If the new credential breaks required readback, pause connector-dependent grants and use provider-native emergency controls until fixed.
