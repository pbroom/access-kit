# Connector Authoring Tutorial

## Purpose

This tutorial turns the connector security gate into an author-facing path for building a new read-only connector. It covers identity setup, consent, least-privilege scopes, pagination, throttling, deletion or tombstone semantics, coverage warnings, sync recovery, and release-gate evidence.

## Audience

Connector developers, platform engineers, security engineers, connector owners, ISSOs, and reviewers.

## What This Is

This is a practical guide for adding a connector that discovers provider inventory and observed native access while preserving Access Kit's proof-point safety model. The connector must start in `read_only` mode, expose discovery metadata and security review evidence, pass `pnpm validate:connector-security`, and keep provider writes out of scope.

## What This Is Not

This is not a guide for live provider writes, production enforcement, tenant-wide authorization, or provider-native administration. A read-only connector can inform decisions, drift findings, and evidence, but observed provider access is not intended access until policy and relationship data explicitly authorize it.

## Authoring Flow

1. Define the provider boundary.
2. Choose the connector identity.
3. Request read-only consent.
4. Implement discovery and native-access readback.
5. Implement cursor, pagination, throttling, deletion, and coverage-warning behavior.
6. Expose discovery metadata and a connector security review.
7. Add synthetic or sandbox tests.
8. Run release gates and retain evidence.

## Provider Boundary

Pick stable identifiers before writing adapter code:

- `connectorId`: stable lower-kebab or lower-colon identifier, such as `aws-readonly`.
- `provider`: provider family or service boundary, such as `aws` or `microsoft-graph`.
- `tenantBoundary`: explicit provider boundary. Do not use `synthetic:unknown` or fallback text.
- `requiredReadScopes`: the minimum read scopes needed for the first slice.
- `sourceSystem`: value used on discovered subjects, resources, relationships, native grants, and warnings.

The boundary must be narrow enough for a reviewer to answer: which provider objects can this connector read, which provider objects can it not read, and what evidence proves that boundary?

## Identity Setup

Use one connector identity per provider boundary.

For synthetic fixtures:

- Use `identity.kind: "synthetic"`.
- Use `consent.status: "synthetic"`.
- Use only `synthetic:*` read scopes.
- Do not require runtime secrets.

For live read-only sandbox connectors:

- Prefer managed identity when the provider supports it.
- Use a service principal, role, or access key only when managed identity is unavailable.
- Store credential references in an approved secrets manager or runtime secret path; never store secret material in connector state, fixtures, docs, logs, warnings, native-grant attributes, or evidence exports.
- Retain identity evidence, such as IaC output, provider app registration, role assignment, sandbox approval, or security review ticket.
- Bind the identity to one tenant or account boundary and fail closed when the boundary is missing or ambiguous.

## Consent And Least Privilege

Consent evidence must match runtime metadata exactly:

- `connector.requiredReadScopes`
- `getDiscoveryMetadata().requiredReadScopes`
- `getSecurityReview().consent.scopesApproved`
- `getSecurityReview().leastPrivilege.requiredReadScopes`

Scopes must be non-empty, unique, read-only, and separate from forbidden write scopes. The security review must explain why each read scope is required and list write scopes that are intentionally excluded.

Use the Microsoft Graph Entra connector as the live-read pattern. It uses `User.Read.All`, `GroupMember.Read.All`, and `Application.Read.All` for users, group membership, service principals, and app-role assignment readback while explicitly excluding write scopes and `Directory.Read.All` for that foundation.

## Adapter Shape

Use `packages/core/src/domain.ts` as the source of truth for the `ConnectorAdapter` contract. The current interface includes discovery, native readback, dry-run or enforcement hooks, drift detection, and evidence emission:

```ts
export interface ConnectorAdapter {
  id: string;
  mode: ConnectorMode;
  capabilities: ConnectorCapabilities;
  provider?: string;
  tenantBoundary?: string;
  requiredReadScopes?: string[];
  discoverSubjects(): Promise<Subject[]>;
  discoverResources(): Promise<Resource[]>;
  discoverRelationships(): Promise<RelationshipTuple[]>;
  readCurrentAccess(resourceId: CanonicalId): Promise<NativeGrant[]>;
  testReadOnlyAccess?(): Promise<ConnectorHealthCheck[]>;
  getDiscoveryMetadata?(): ConnectorDiscoveryMetadata;
  getSecurityReview?(): ConnectorSecurityReview;
  planProvisioningChange(request: DecisionResult): Promise<ProvisioningPlan>;
  applyProvisioningChange(plan: ProvisioningPlan): Promise<ProvisioningPlan>;
  verifyProvisioningChange(plan: ProvisioningPlan): Promise<boolean>;
  revokeAccess(nativeGrantId: CanonicalId): Promise<ProvisioningPlan>;
  detectDrift(): Promise<DriftFinding[]>;
  emitEvidence(events: AuditEvent[]): Promise<EvidenceExport>;
}
```

Provider-style connectors must default to `mode: "read_only"` and must not advertise provisioning support before a separate live-enforcement review. Read-only connectors should still implement dry-run or failed write methods when the interface requires them, but those methods must not call provider write APIs.

## Discovery Metadata

`getDiscoveryMetadata()` is the operator and reviewer view of connector scope:

```ts
getDiscoveryMetadata(): ConnectorDiscoveryMetadata {
  return {
    provider: this.provider,
    tenantBoundary: this.tenantBoundary,
    requiredReadScopes: this.requiredReadScopes,
    synthetic: false,
    warnings: this.warnings,
    cursor: this.cursor
  };
}
```

Metadata must not contain raw tenant IDs, object IDs, user principal names, request IDs, bearer tokens, or raw pagination cursors. Redact or hash provider identifiers before storing them in canonical records or evidence.

## Security Review Evidence

Every runtime connector must expose `getSecurityReview()` and pass `pnpm validate:connector-security`.

The review must include:

- identity kind, subject, and evidence refs
- consent status, approved scopes, and evidence refs
- least-privilege read scopes and forbidden write scopes
- pagination, throttling, deletion, coverage-warning, and native-readback expectations
- secret-handling and rotation expectations
- enforcement restrictions, including `liveWritesAllowed: false`

Example shape:

```ts
getSecurityReview(): ConnectorSecurityReview {
  return {
    connectorId: this.id,
    provider: this.provider,
    tenantBoundary: this.tenantBoundary,
    synthetic: false,
    identity: {
      kind: "managed_identity",
      subject: "connector:provider:tenant-redacted",
      evidence: ["docs/connector-contract.md"]
    },
    consent: {
      status: "approved",
      scopesApproved: this.requiredReadScopes,
      evidence: ["docs/connector-contract.md"]
    },
    leastPrivilege: {
      requiredReadScopes: this.requiredReadScopes,
      forbiddenWriteScopes: ["Provider.Write.All"],
      scopeJustification: "Read scopes support inventory and native-grant readback without provider mutation."
    },
    operations: {
      pagination: "required",
      throttling: "required",
      deletion: "mark_deleted",
      coverageWarnings: "required",
      nativeAccessReadback: true
    },
    secrets: {
      storesSecrets: false,
      handling: "managed_identity",
      rotation: "not_applicable",
      evidence: ["adrs/0009-secret-management.md"]
    },
    enforcement: {
      liveWritesAllowed: false,
      controlledSyntheticOnly: false,
      readinessRequired: true,
      rollbackRequired: true,
      emergencyRevocationRequired: true,
      monitoringRequired: true
    }
  };
}
```

Synthetic connectors use `identity.kind: "synthetic"`, `consent.status: "synthetic"`, `secrets.handling: "none"`, and `secrets.rotation: "not_applicable"`.

## Pagination, Throttling, And Cursors

Provider discovery must be restartable and honest about incomplete reads.

- Preserve a high-watermark, cursor type, or page boundary in redacted form.
- Keep provider pagination URLs on an allowlist before sending credentials.
- Bound page counts in tests so infinite provider loops fail closed.
- Convert provider throttling into warnings with retry metadata that does not expose request IDs or tokens.
- Emit coverage warnings when a page limit, permission gap, provider error, or unsupported object type leaves discovery incomplete.

The Microsoft Graph connector rejects cross-origin pagination URLs before sending bearer tokens and emits throttling warnings without retaining raw request identifiers. Reuse that posture for new live-read connectors.

## Deletion And Tombstones

Choose deletion semantics before the connector is reviewed:

- `mark_deleted`: emit tombstones or deleted-state records when the provider reports removed objects.
- `ignore`: keep prior state and emit a coverage warning when deletion cannot be observed safely.
- `unsupported`: explicitly record that deletion is not supported yet.

Provider discovery connectors must not use `not_applicable` for deletion semantics. If the provider cannot prove deletion state, emit a warning and make the limitation visible in evidence.

## Coverage Warnings

Warnings are security evidence, not noise. Emit a warning when:

- sandbox evidence is missing
- a provider scope is insufficient
- an object type is unsupported
- a page limit or throttling event interrupts discovery
- a tenant or account boundary is ambiguous
- provider deletion or tombstone behavior is incomplete
- native-grant semantics cannot be mapped safely

Warnings should include redacted provider, tenant boundary, scope, reason, and recovery guidance. Do not suppress warnings to make a connector appear complete.

## Sync Recovery

Read-only sync should recover from partial runs without corrupting canonical facts:

- Record discovery run status as `completed_with_warnings` when coverage is incomplete.
- Preserve last successful cursor or high-watermark evidence only after the run reaches a safe checkpoint.
- Keep observed native grants distinct from intended grants and relationships.
- Re-run reconciliation after recovery to expose stale or unauthorized native grants.
- Treat stale state as degraded evidence until a clean readback completes.

If the provider supports delta tokens or change notifications, keep those tokens redacted and fail closed when they expire or point outside the reviewed boundary.

## Connector Implementation Release Gate

Before opening a connector implementation PR, run:

```sh
pnpm validate:connector-security
pnpm exec vitest run tests/connectors
pnpm validate:contracts
pnpm validate:docs
pnpm evidence:check
git diff --check
```

Regenerate proof-point evidence with `pnpm evidence:generate` only when validation inputs, proof-point fixtures, expected counts, or command output changed.

## Docs-Only Release Gate

For docs-only connector guidance, run:

```sh
pnpm validate:docs
pnpm validate:automation
pnpm validate:connector-security
pnpm evidence:check
git diff --check
```

Run `pnpm ci:check` before submitting implementation changes or any docs change that touches generated evidence, examples, contracts, or package scripts.

## PR Evidence Checklist

A connector PR should identify:

- connector ID, provider, and tenant boundary
- identity kind, consent evidence, and read scopes
- least-privilege justification and forbidden write scopes
- pagination, throttling, deletion or tombstone behavior
- coverage-warning behavior and recovery steps
- secret-handling and rotation evidence
- native-access readback semantics
- tests that prove no provider writes are attempted
- `pnpm validate:connector-security` output
- known gaps that must remain warnings or blocked readiness

## Common Failure Modes

| Failure | Result |
| --- | --- |
| Missing `getSecurityReview()` | `pnpm validate:connector-security` fails. |
| Empty or duplicated read scopes | Release gate fails. |
| Required read scopes overlap with forbidden write scopes | Release gate fails. |
| Provider connector advertises provisioning support early | Release gate fails. |
| Deletion is `not_applicable` for provider discovery | Release gate fails. |
| Live-read connector stores secrets in connector state | Release gate fails. |
| Runtime metadata and security review disagree | Release gate fails. |
| Readiness reports live writes as allowed | Release gate fails. |

## Security Considerations

- Keep live writes out of scope until a separate enforcement slice defines approval, rollback, monitoring, emergency revocation, and audit evidence.
- Treat provider readback as observed state only.
- Keep connector secrets out of docs, examples, logs, fixtures, warnings, and evidence.
- Use explicit tenant or account boundaries and fail closed on ambiguity.
- Make incomplete coverage visible through warnings and evidence.

## Audit And Evidence Implications

Connector sync emits `connector.discovery_completed`. Enforcement readiness emits `connector.enforcement_readiness_checked`. Reconciliation can open drift findings when observed native grants differ from intended access. Evidence exports should retain connector identity, consent, scope review, discovery warnings, native-grant readback, and validation command output without exposing provider secrets or raw tenant identifiers.

## Related Controls

AC-2, AC-3, AC-6, AU-2, AU-6, CA-7, CM-3, IA-5, IR-4, RA-5, SA-9, SC-7, SI-4, and SR controls depend on connector identity, least privilege, auditability, and safe recovery.

## Related References

- [Connector Contract](connector-contract.md)
- [Security Model](security-model.md)
- [Drift Detection Model](drift-detection-model.md)
- [CI And Contract Validation](ci.md)
- [Compromised Connector Credential Runbook](../runbooks/compromised-connector-credential.md)
- `scripts/validate-connector-security-gate.ts`
- `tests/automation/connector-security-gate.test.ts`
- `packages/connectors-microsoft-graph/src/index.ts`
