# ADR-0001: API-First And CLI-First Foundation

## Status

Accepted

## Decision

Access Kit starts with OpenAPI, JSON Schemas, CLI contracts, docs, fixtures, and validation evidence before runtime service implementation.

## Consequences

Applications integrate through stable APIs. Operators and CI/CD use the CLI. A dashboard can be added later without becoming the source of authorization truth.
