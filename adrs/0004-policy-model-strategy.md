# ADR-0004: Policy Model Strategy

## Status

Accepted for milestone contracts

## Decision

Policy models are versioned and must publish only after validation and mandatory proof-point tests. The policy language implementation is deferred.

## Consequences

The first milestone proves policy behavior with deterministic fixtures. Later work may choose a Zanzibar/OpenFGA-style model, a custom DSL, or an embedded policy engine if it preserves the published decision contract.
