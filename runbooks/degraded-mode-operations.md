# Degraded Mode Operations Runbook

## Purpose

Respond when Access Kit enters a degraded production operating state while preserving fail-closed authorization, audit evidence, and emergency revocation priority.

## Trigger

- `/v1/health` or `/v1/ready` fails or reports blocked production controls.
- Queue depth, oldest job age, expired leases, retry rate, or dead-letter count exceeds the environment threshold.
- Audit append, signed-window generation, evidence receipt, SIEM delivery, or SIEM replay fails.
- Connector readback is stale, partial, degraded, or unavailable.
- Admin authorization readiness is missing, expired, or degraded.

## Severity

High when protected authorization, audit retention, connector readback, or emergency revocation is affected. Critical when sensitive resources may be incorrectly allowed, provider writes cannot be audited, or emergency revocation cannot be reserved.

## Required Role

Platform engineer, security engineer, incident commander for critical events, connector owner for provider degradation, and ISSO or assessor liaison when retained evidence or control statements are affected.

## Prerequisites

- Affected component, connector, or provider boundary.
- Current `/v1/health` and `/v1/ready` output.
- Queue depth, oldest job age, dead-letter count, and emergency revocation age.
- Audit signed-window, SIEM delivery, and replay status.
- Admin authorization readiness and break-glass approval path.
- Incident or change reference.

## Commands Or Proposed Commands

```sh
curl --fail --silent --show-error http://127.0.0.1:3000/v1/health
curl --fail --silent --show-error http://127.0.0.1:3000/v1/ready
rebac connector list
rebac discovery runs --status failed
rebac reconcile run --connector mock --dry-run
rebac audit integrity --from 2026-05-26T00:00:00.000Z
rebac audit export --from 2026-05-26T00:00:00.000Z --to 2026-05-26T23:59:59.000Z --format jsonl
rebac evidence export --framework nist-800-53 --controls AC-3,AU-6,IR-4,SI-4 --from 2026-05-26T00:00:00.000Z --to 2026-05-26T23:59:59.000Z --format json
```

## Expected Output

- Health and readiness identify the degraded component.
- Queue evidence shows whether emergency revocation remains prioritized.
- Connector evidence identifies stale cursors, coverage warnings, or readback failures.
- Audit integrity and export evidence retain the degraded window or identify replay requirements.
- Evidence export captures the incident, control mappings, findings, and residual gaps.

## Verification Steps

1. Classify the degraded mode using [HA And Degraded-Mode Operations](../docs/ha-degraded-mode-operations.md).
2. Freeze blocked actions for that mode before attempting recovery.
3. Confirm protected authorization paths fail closed when current graph, audit, admin, or connector evidence is unavailable.
4. Confirm emergency revocation jobs can still be reserved ahead of lower-priority work.
5. Preserve local signed audit windows before restarting audit or SIEM components.
6. Replay dead-lettered or failed queue jobs only after idempotency and connector health are verified.
7. Run sample decisions after recovery and compare policy, relationship, and decision versions.
8. Retain post-action review evidence and assign owners for residual dead letters, SIEM replay, connector warnings, or exceptions.

## Audit Events Emitted

- `decision.allowed` or `decision.denied` after recovery
- `connector.discovery_completed` or failed discovery evidence
- `drift.finding_opened`
- `audit.exported`
- `evidence.generated`
- admin action or incident event when implemented

## Evidence Retained

- Health and readiness output before, during, and after the degraded window.
- Queue depth, retry, dead-letter, replay, and emergency revocation priority observations.
- Audit signed-window verification, failed SIEM delivery finding, and replay receipt.
- Connector health, cursor age, coverage warnings, and reconciliation output.
- Backup/restore evidence for recovered stores.
- Admin authorization, break-glass, notification, session expiry, and post-action review evidence when emergency administration was used.
- Runbook exercise record conforming to `schemas/runbook-exercise.schema.json` when the scenario is rehearsed for incident response, contingency, emergency revocation, SIEM replay, backup/restore, or post-action review evidence.

## Escalation Path

Escalate to incident response, resource owners, connector platform owners, SIEM owner, ISSO, and provider administrators when protected authorization cannot be evaluated, audit evidence cannot be retained, emergency revocation is blocked, or live provider state cannot be verified.

## Rollback Or Compensating Action

Keep protected resources fail-closed until deterministic decisions, audit append, and required readback recover. Use provider-native emergency revocation when Access Kit cannot verify high-risk access. Keep normal grant creation, live enforcement, and drift closure paused until queue, audit, connector, and admin evidence meet the recovery criteria.
