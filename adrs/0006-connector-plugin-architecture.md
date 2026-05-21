# ADR-0006: Connector Adapter Architecture

## Status

Accepted

## Decision

Provider logic must live behind connector adapters. Core authorization code depends on connector capabilities and typed operations, not provider SDKs.

## Consequences

Mock connectors can validate the boundary without credentials. Live Entra ID, SharePoint, AWS, AD, and Power Platform connectors can be added incrementally with explicit capability declarations.
