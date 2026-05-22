# ADR-0007: Provisioning Plans And Idempotency

## Status

Accepted

## Decision

Decisions do not directly mutate target systems. Provisioning must create a plan first, support dry-run, require idempotency keys, apply only approved actions, verify target state, and emit audit evidence.

## Consequences

Retries and duplicate events must not create duplicate grants. Failed or partial operations need rollback or compensation records.
