# Connector Contract

## Purpose

This page documents the connector boundary for discovery, readback, provisioning, verification, reconciliation, readiness, and evidence.

## Audience

Connector developers, platform engineers, security engineers, ISSOs, assessors, and resource owners.

## What This Is

The connector contract defines how Access Kit interacts with provider-specific systems while preserving a portable authorization model. The current repo includes a mock connector, synthetic read-only Entra ID, SharePoint, and AWS-style fixtures that prove contract shape without live tenant access, plus optional Microsoft Graph Entra and AWS read-only foundations for sandbox evidence.

## What This Is Not

This is not a claim that SharePoint, Teams, Power Platform, Dataverse, or AD live connector behavior is implemented. Synthetic connectors do not call provider APIs and must not be treated as production integrations. The Microsoft Graph and AWS connector foundations are opt-in and read-only, and must retain sandbox-run evidence before anyone claims live-tenant or live-account verification.

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

Authors adding a new read-only connector should start with the [Connector Authoring Tutorial](connector-authoring-tutorial.md). It turns this gate into a step-by-step path for identity setup, consent, least-privilege scopes, pagination, throttling, tombstones, coverage warnings, sync recovery, and release evidence.

## Microsoft Graph Entra Read-Only Foundation

`@access-kit/connectors-microsoft-graph` exports `MicrosoftGraphEntraReadOnlyConnector`, an injectable Microsoft Graph adapter for Entra users, groups, service principals, and app-role assignments. It is registered by the API runtime only when sandbox configuration is present:

- `REBAC_MICROSOFT_GRAPH_ENTRA_ID_ENABLED=true`
- `REBAC_MICROSOFT_GRAPH_TENANT_ID`
- `REBAC_MICROSOFT_GRAPH_ACCESS_TOKEN` or `REBAC_MICROSOFT_GRAPH_TOKEN_FILE`
- `REBAC_MICROSOFT_GRAPH_SANDBOX_EVIDENCE`, recommended for retained sandbox evidence

The connector uses `User.Read.All`, `GroupMember.Read.All`, and `Application.Read.All` as the approved aggregate read-only application scope set for this foundation. Microsoft documents `User.Read.All` as the least-privilege application permission for listing users, `GroupMember.Read.All` as the least-privilege application permission for group-member readback, and `Application.Read.All` as the least-privilege application permission for service-principal and app-role-assignment readback. The aggregate set intentionally avoids write scopes and `Directory.Read.All`, but it is still reviewed as a tenant-wide sandbox permission set:

- [List users](https://learn.microsoft.com/en-us/graph/api/user-list?view=graph-rest-1.0)
- [List groups](https://learn.microsoft.com/graph/api/group-list?view=graph-rest-1.0)
- [List group members](https://learn.microsoft.com/en-us/graph/api/group-list-members?view=graph-rest-1.0)
- [List service principals](https://learn.microsoft.com/en-us/graph/api/serviceprincipal-list?view=graph-rest-1.0)
- [List appRoleAssignments granted for a service principal](https://learn.microsoft.com/en-us/graph/api/serviceprincipal-list-approleassignedto?view=graph-rest-1.0)

Discovery maps provider objects into redacted Access Kit records. Tenant IDs, Graph object IDs, user principal names, display names, request IDs, bearer tokens, and raw pagination cursors are not stored in canonical IDs, warnings, native-grant attributes, or evidence. Pagination and throttling are captured as warnings, and missing sandbox evidence emits `GRAPH_SANDBOX_EVIDENCE_REQUIRED` instead of silently claiming live coverage.

The connector does not implement Graph writes. Provisioning hooks return dry-run plans or failed write attempts, enforcement readiness remains blocked for this provider, and `pnpm validate:connector-security` verifies that live provider writes stay disabled.

## AWS Read-Only Access-Analysis Foundation

`@access-kit/connectors-aws` exports `AwsReadOnlyAccessAnalysisConnector`, an injectable AWS adapter for IAM Identity Center assignments, AWS Organizations account boundaries, IAM roles, CloudTrail activity readback, and Access Analyzer-informed drift findings. It is registered by the API runtime only when sandbox fixture configuration is present:

- `REBAC_AWS_READONLY_ACCESS_ANALYSIS_ENABLED=true`
- `REBAC_AWS_ORGANIZATION_ID`
- `REBAC_AWS_READONLY_FIXTURE_FILE`
- `REBAC_AWS_SANDBOX_EVIDENCE`, recommended for retained sandbox evidence

The connector declares least-privilege read scopes for Organizations, IAM Identity Center assignment readback, IAM role readback, CloudTrail lookup, and Access Analyzer findings. It explicitly excludes broad provider mutation through write-scope families such as `iam:Write`, `sso:Write`, `organizations:Write`, `cloudtrail:Write`, and `access-analyzer:Write`.

Discovery maps AWS observations into redacted Access Kit records. Organization IDs, account IDs, account emails, ARNs, Identity Center principal IDs, CloudTrail event IDs, request IDs, tokens, and raw pagination cursors are not stored in canonical IDs, warnings, native-grant attributes, or evidence. IAM Identity Center assignments become observed native grants, CloudTrail events annotate activity recency without becoming intended access, suspended or deleted objects become tombstones, and Access Analyzer findings become reconciliation drift findings for review.

The connector does not implement AWS writes. Provisioning hooks return dry-run plans or failed write attempts, enforcement readiness remains blocked for this provider, and `pnpm validate:connector-security` verifies that live provider writes stay disabled.

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
- [Connector Authoring Tutorial](connector-authoring-tutorial.md)
- [Sample Read-Only Connector Template](../examples/connectors/sample-readonly-template.md)
- [Drift Detection Model](drift-detection-model.md)
- [System Context and Boundary](system-context-and-boundary.md)
- `schemas/discovery-run.schema.json`
- `schemas/native-grant.schema.json`
- `schemas/enforcement-readiness.schema.json`
- [ADR 0006: Connector plugin architecture](../adrs/0006-connector-plugin-architecture.md)
- [Compromised Connector Credential Runbook](../runbooks/compromised-connector-credential.md)
