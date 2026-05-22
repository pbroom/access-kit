# ADR-0005: Append-Only Audit Event Log

## Status

Accepted

## Decision

Audit evidence is represented as append-only events with event ID, type, actor, timestamps, correlation ID, policy and relationship versions, payload hash, and optional previous event hash.

## Consequences

The first milestone defines the event contract. Durable WORM or tamper-evident storage, retention, and SIEM export are later implementation requirements.
