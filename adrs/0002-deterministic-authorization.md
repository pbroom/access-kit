# ADR-0002: Deterministic Authorization Only

## Status

Accepted

## Decision

Authorization decisions must be deterministic, reproducible, explainable, versioned, and testable. LLMs may not make authorization decisions.

## Consequences

Every decision must include reason code, policy version, relationship tuple version, relationship path, and context. LLM usage is limited to developer assistance, documentation, and non-authoritative summaries.
