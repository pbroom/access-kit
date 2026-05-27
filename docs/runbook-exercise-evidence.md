# Runbook Exercise Evidence

## Purpose

Runbook exercises turn operational procedures into retained, repeatable evidence. This page defines the AK-059 evidence contract for incident response, break-glass, backup and restore, contingency, emergency revocation, SIEM replay, and post-action review rehearsals.

## Scope

The canonical exercise record is `deploy/operations/runbook-exercises/rehearsal.example.json`. It is deployment-scoped to a named staging deployment and tenant boundary, but it uses synthetic data only. It is rehearsed proof, not assessor-approved production evidence.

Production teams can use the same schema for real deployment evidence after replacing the synthetic record with environment-specific artifacts, approved retention, reviewed control statements, and assessor-approved operating evidence.

## Evidence Contract

Runbook exercise records use `schemas/runbook-exercise.schema.json` and must include:

- Deployment scope: environment, deployment ID, tenant boundary, data source, and live-tenant-data flag.
- Classification: `rehearsed_proof`, `assessorApproved: false`, and `productionOperation: false` for local or staging rehearsals; production exercise records must use deployment-specific assessor approval values.
- Redaction: synthetic-data marker, sensitive-data exclusion, and explicit redaction rules.
- Scenario coverage: incident response, break-glass, backup and restore, contingency, emergency revocation, SIEM replay, and post-action review.
- Retention: backend, retained location, retention period, package hash, and immutable-storage marker.
- Validation: commands used to validate the schema, references, and evidence boundaries.

## Retained Example

The retained rehearsal example covers:

| Scenario | Runbook | Evidence focus |
| --- | --- | --- |
| Incident response | [Degraded Mode Operations](../runbooks/degraded-mode-operations.md) | Classification, fail-closed behavior, and incident evidence. |
| Break-glass | [Break-Glass Review](../runbooks/break-glass-review.md) | Emergency approval, expiry, and post-action review. |
| Backup and restore | [Degraded Mode Operations](../runbooks/degraded-mode-operations.md) | Graph, audit, and job restore receipts. |
| Contingency | [Degraded Mode Operations](../runbooks/degraded-mode-operations.md) | Read-only fallback and protected-action freeze. |
| Emergency revocation | [Emergency Revocation](../runbooks/emergency-revocation.md) | Revocation priority under degraded conditions. |
| SIEM replay | [Audit/Evidence Export](../runbooks/audit-evidence-export.md) | Failed delivery, signed window, and replay receipt. |
| Post-action review | [Degraded Mode Operations](../runbooks/degraded-mode-operations.md) | Owner sign-off, residual gaps, and retained validation proof. |

## Validation

Run:

```sh
corepack pnpm validate:schemas
corepack pnpm validate:runbook-exercises
corepack pnpm validate:docs
```

`validate:runbook-exercises` verifies that the retained example and schema fixture match, conform to JSON Schema, cover every required exercise scenario, reference existing runbooks and evidence artifacts, and remain synthetic, redacted, and clearly separate from assessor-approved production operations.

## Security Considerations

- Do not include secrets, tokens, live tenant IDs, provider payloads, production emails, or named people.
- Store role labels, scenario IDs, event IDs, counts, status, hashes, and artifact references instead of raw operational payloads.
- Replace sample `packageHash` values with the SHA-256 digest for the retained package before using a record as retention evidence.
- Keep local and staging examples marked as rehearsed proof until an assessor approves deployment-specific operations evidence.
- Preserve gaps and residual-risk statements instead of silently converting rehearsal evidence into production-readiness claims.
