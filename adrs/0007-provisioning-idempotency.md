# ADR-0007: Provisioning Plans And Idempotency

## Status

Accepted

## Decision

Decisions do not directly mutate target systems. Provisioning must create a plan first, support dry-run, require idempotency keys, apply only approved actions, verify target state, and emit audit evidence.

Phase 3 implements local dry-run jobs only. A dry-run job skips provider writes, records action-level verification expectations, records compensation intent, and returns the same job for repeated submissions with the same idempotency key.

## Consequences

Retries and duplicate events must not create duplicate grants. Failed or partial operations need rollback or compensation records. Controlled enforcement remains blocked until approvals, live connector least-privilege review, verification readback, and rollback runbooks exist.
