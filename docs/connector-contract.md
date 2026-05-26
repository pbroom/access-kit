# Connector Contract

## Purpose

This page documents the connector boundary for discovery, readback, provisioning, verification, reconciliation, readiness, and evidence.

## Audience

Connector developers, platform engineers, security engineers, ISSOs, assessors, and resource owners.

## What This Is

The connector contract defines how Access Kit interacts with provider-specific systems while preserving a portable authorization model. The current repo includes a mock connector and synthetic read-only Entra ID, SharePoint, and AWS-style fixtures that prove contract shape without live tenant access.

## What This Is Not

This is not a claim that live Microsoft, AWS, SharePoint, Teams, Power Platform, Dataverse, or AD connector behavior is implemented. Synthetic connectors do not call provider APIs and must not be treated as production integrations.

## Capability Model

Connectors advertise capabilities such as:

- read-only discovery
- native access readback
- current-access inspection
- dry-run provisioning
- controlled synthetic enforcement
- verification readback
- reconciliation
- rollback or compensation support
- enforcement-readiness checks

The current implementation blocks controlled enforcement for synthetic read-only provider connectors and allows it only for the synthetic `mock` connector under guardrails.

## Required Connector Evidence

| Evidence | Purpose |
| --- | --- |
| Connector ID, provider, and tenant boundary | Establish scope and prevent cross-boundary ambiguity. |
| Required read scopes | Support least-privilege review. |
| Capability flags | Prevent unsupported operations. |
| Discovery run | Prove read-only inventory and native grant readback. |
| Native grants | Preserve observed provider state without converting it to intended access. |
| Connector security review | Gate connector identity, consent, tenant boundary, least-privilege scopes, deletion behavior, coverage warnings, secret handling, and no-write defaults. |
| Enforcement readiness report | Gate controlled enforcement. |
| Verification result | Prove readback after planned action. |
| Drift findings | Record mismatch between intended and observed state. |

## Connector Security Review Gate

Every registered connector must expose a `ConnectorSecurityReview` and pass `pnpm validate:connector-security` before live connector work can proceed. The gate compares runtime registration, discovery metadata, read-only health checks, and enforcement-readiness behavior against the review evidence.

The gate requires:

- stable connector ID, provider, and tenant boundary with no fallback boundary
- explicit synthetic consent evidence or approved live consent evidence
- required read scopes that are non-empty, unique, and separate from forbidden write scopes
- pagination, throttling, deletion semantics, coverage-warning, and native-readback expectations
- secret handling evidence with no synthetic connector secrets
- live provider writes blocked unless a future reviewed live connector slice adds approved readiness, rollback, monitoring, and emergency revocation evidence

The current synthetic provider connectors remain read-only and blocked for enforcement. The `mock` connector may pass controlled synthetic enforcement readiness only with `liveProviderWrites: false`.

## Concrete Example

`rebac connector sync sharepoint-readonly --mode read_only` calls `POST /v1/connectors/{id}/sync`. The connector returns a `DiscoveryRun` with counts, warnings, cursor metadata, read-only evidence, and audit event IDs. Native grants discovered in the run can be inspected with `rebac resource native-access`.

## Security Considerations

- Use read-only scopes until live connector review is complete.
- Treat `pnpm validate:connector-security` as the release gate for connector identity, consent, least privilege, tenant boundary, and no-write defaults.
- Managed identity is preferred for future live connectors; vault-backed secrets require rotation and logging controls.
- Connector warnings must not be suppressed when they affect coverage or deletion semantics.
- Provider readback must not become intended access without policy and approval.
- Live write paths need explicit least-privilege review, rollback, emergency revocation, monitoring, and evidence retention.

## Audit And Evidence Implications

Connector discovery emits `connector.discovery_completed`. Readiness checks emit `connector.enforcement_readiness_checked`. Provisioning and reconciliation emit job and drift events. Evidence exports should include connector inventory, boundary, capabilities, source events, warnings, and gaps.

## Related Controls

AC-2, AC-3, AC-6, AU-2, AU-6, CM-2, CM-3, CA-7, IA-5, SC-7, SI-4, SA-9, and SR controls.

## Related References

- [Provisioning Lifecycle](provisioning-lifecycle.md)
- [Drift Detection Model](drift-detection-model.md)
- [System Context and Boundary](system-context-and-boundary.md)
- `schemas/discovery-run.schema.json`
- `schemas/native-grant.schema.json`
- `schemas/enforcement-readiness.schema.json`
- [ADR 0006: Connector plugin architecture](../adrs/0006-connector-plugin-architecture.md)
- [Compromised Connector Credential Runbook](../runbooks/compromised-connector-credential.md)
