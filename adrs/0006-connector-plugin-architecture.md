# ADR-0006: Connector Adapter Architecture

## Status

Accepted

## Decision

Provider logic must live behind connector adapters. Core authorization code depends on connector capabilities and typed operations, not provider SDKs.

Phase 2 connector sync is read-only and returns a `DiscoveryRun`. The connector boundary may discover subjects, resources, relationship tuples, and observed native grants, but native grants remain readback evidence until later provisioning phases create intended changes.

## Consequences

Mock connectors can validate the boundary without credentials. Live Entra ID, SharePoint, AWS, AD, and Power Platform connectors can be added incrementally with explicit capability declarations.
