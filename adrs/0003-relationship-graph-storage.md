# ADR-0003: Relationship Graph Storage Strategy

## Status

Accepted for milestone contracts

## Decision

Relationships are modeled as versioned tuples with canonical subject ID, relation, object ID, source system, assertion time, expiration, status, and attributes. The storage implementation is deferred.

## Consequences

The domain model can support graph databases, relational tuple stores, or hybrid implementations later. The public contract stays stable while the storage choice is evaluated.
