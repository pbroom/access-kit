# ADR-0009: Connector Identity And Secret Management

## Status

Accepted

## Decision

The first milestone includes no live connector secrets. Future connectors must prefer managed identities, use vault-backed secrets when necessary, rotate credentials, and prevent secrets from entering logs, reports, fixtures, or CI output.

## Consequences

Live connector work is blocked until least-privilege scopes, storage, rotation, and audit requirements are documented.
