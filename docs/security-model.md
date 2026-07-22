# Security Model

Access Kit can approve, deny, provision, revoke, and explain access across many systems, so it must be treated as privileged infrastructure even in early milestones. This page covers how the control plane authenticates and authorizes its own operation, how it fails, what it audits, and the threat model behind those choices.

## Authentication

The local API runtime can require opaque bearer tokens through `REBAC_API_KEYS`. This is a deployment-packaging guardrail for synthetic and pre-production use: `/v1/health` and `/v1/ready` remain public for orchestrator probes, protected API calls require `Authorization: Bearer <token>`, and failed attempts emit `api.authentication_failed` audit evidence at most once per failure reason per one-minute sample window without logging token material. No-key mode is permitted only on loopback hosts; the runtime refuses non-loopback binding without configured keys.

Production authentication is represented by the `AdminAuthorizationDescriptor` readiness contract in `packages/core/src/admin-authorization.ts` and must be delegated to approved identity providers (Entra ID, AD federation, PIV/CAC flows, IAM Identity Center, mTLS gateways, or agency-approved systems). A production-ready descriptor requires MFA, bounded sessions, revocation SLA evidence, an identity-aware gateway or mTLS boundary, external secrets-manager references, and retained evidence references. The default local bearer-token descriptor is reported by `/v1/ready` as a pre-production warning, not production admin authentication. No local password store should exist except an explicitly approved break-glass design.

## Authorization And Emergency Administration

Internal administration is governed by an admin ReBAC policy separate from application authorization. Sensitive operations — policy publication, connector configuration, break-glass access, enforcement enablement, audit/evidence export, exception approvals — require least privilege, role-binding evidence, fast revocation, approval, and audit. The readiness contract checks that the admin policy is evidenced separately from application policy so operator power cannot collapse into a single shared bearer token.

Break-glass access is an emergency workflow, not a standing role: multi-role approval, short-lived elevation, incident-mode notification, retained audit events, and post-action review evidence are required before claiming admin readiness. The local controlled-enforcement guardrails reject break-glass and incident-mode flags for synthetic enforcement jobs.

## Secrets

Live connector credentials are not part of the default local proof point. The optional Microsoft Graph and AWS read-only connectors may be enabled against sandboxes with short-lived tokens or redacted fixtures. Production connector credentials must use managed identities or provider roles where possible, vault-backed secrets where needed, documented rotation, and no secret material in logs, fixtures, reports, or CI variables.

## Read-Only Discovery And Enforcement Gates

Connector sync is restricted to `read_only`: it discovers inventory and observed native grants but never applies provider mutations or treats readback as intended access. The synthetic Entra ID, SharePoint, and AWS-style connectors prove contract shape without credentials. The Microsoft Graph and AWS sandbox foundations can read real sandbox tenants when explicitly configured, storing redacted subjects, resources, relationships, and native grants; pagination limits, throttling, stale cursors, delta tombstones, inheritance ambiguity, and coverage gaps are recorded as warnings and drift findings instead of becoming unqualified canonical facts. See the [Connector Contract](connector-contract.md) for details. All connector registrations must pass `pnpm validate:connector-security`, which requires identity, consent, tenant-boundary, least-privilege scope, pagination, throttling, deletion, coverage-warning, secret-handling, and no-write evidence. Raw provider cursors, including delta tokens, stay out of stored evidence.

Provisioning jobs default to `dry_run` — skipped writes, verification hooks, compensation intent, audit events. Controlled enforcement is restricted to the synthetic `mock` connector and requires a ready enforcement-readiness report, an approved change ticket, matching approver, synthetic-only controls, no break-glass flag, and incident mode false. Synthetic read-only connectors cannot enforce even with approval fields supplied.

The first controlled live enforcement pilot is a separate release gate, not a connector capability: `deploy/live-enforcement-pilot/manifest.example.json` limits the candidate to one Microsoft Graph direct-grant revocation per approved change, gated on fresh read-only confidence, least-privilege write-scope review, two-role approval, durable queue and immutable audit readiness, degraded-runtime blocking, dry-run-first verification, rollback hooks, emergency revocation runbooks, and retained release approval.

## Fail Behavior

- Sensitive resources fail closed when the decision service is unavailable; low-risk cached reads are allowed only where policy explicitly permits (see [Decisions](decisions.md)).
- Provisioning never assumes success; target state is verified after every write.
- Enforcement planning fails closed when readiness evidence is missing, blocked, mismatched, or live-write-enabled; pilot gates fail closed on stale confidence, missing approval, degraded health, or absent rollback hooks.
- Connector outages queue work and mark the connector degraded without silently skipping revocations. The queue keeps emergency revocations reservable during degradation, dead-letters failures for operator replay, and preserves idempotency hashes.
- Degraded modes preserve fail-closed authorization, audit append, and emergency revocation priority; see [HA and Degraded-Mode Operations](ha-degraded-mode-operations.md).
- Revocation and quarantine have priority over new grants.

## Audit

Every decision, grant, revoke, policy change, connector action, admin action, drift finding, integrity verification, and export emits an audit event. Events hash-chain through `payloadHash` and `previousEventHash`; the runtime verifies the chain, exports bounded SIEM-ready JSONL, and can persist local proof-point events. The production audit/evidence adapter adds the immutable external boundary: append-only receipts, retention metadata, signed windows, SIEM delivery and replay records, tamper-evident package receipts, and integrity findings when delivery fails. Production adapters reject malformed hash envelopes and secret-bearing records before serving data, and graph/connector-state adapters enforce tenant boundaries on persisted entities.

The secure SDLC release manifest ties SAST, DAST, dependency scanning, SBOM/provenance, fuzzing, tenant-isolation abuse tests, threat-model refresh, vulnerability triage, and NIST SSDF mapping to a release reference; see [Secure SDLC Evidence](secure-sdlc-evidence.md).

## Privacy

Store only the minimum identity and resource metadata needed for authorization, evidence, and reconciliation. Redact tokens, claims, emails, object names, and sensitive classifications from logs unless they are required evidence fields.

## LLM Boundary

LLMs may help draft documentation, summarize evidence, or assist developers. They may not make authorization decisions, approve access, create grants, or replace deterministic policy evaluation.

## Threat Model

This is a repository-grounded threat model for the local proof point and planned production direction — not a penetration test report or final risk acceptance. Production deployments must update it with actual hosts, identity providers, connectors, data stores, and monitoring.

**Assets:** canonical subject and resource records; relationship tuples and policy versions; decision and explanation responses; intended grants and provisioning plans; native grant readback; connector credentials and scopes; admin identity claims and emergency approvals; drift findings; audit events, hashes, and exports; evidence packages and control mappings.

**Attacker capabilities:** forged or excessive decision/provisioning requests; deny-by-default bypass through malformed relationships; abuse of stale or overprivileged connector credentials; hiding unauthorized native grants by disrupting readback; tampering with audit events or evidence; reusing a local bearer token, forged gateway header, stale group claim, or overbroad admin role; abusing break-glass workflows without approval or review; exfiltrating relationship structure through explanations; passing off proof-point evidence as production authorization.

| Abuse path                   | Mitigation in current foundation                                                                                                                                                                                         | Remaining production work                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Decision bypass              | Deterministic engine, deny by default, explicit deny precedence, policy proof points.                                                                                                                                    | Deployed API authentication, rate limits, authorization for admin APIs.                                                                 |
| Admin control-plane takeover | Local bearer tokens marked proof-point-only; the admin descriptor checks IdP/mTLS gateway, MFA, revocation, admin ReBAC separation, secrets-manager references, break-glass approval, notification, and review evidence. | Environment-specific gateway deployment, trusted header provenance, request-scoped actor binding, retained session revocation evidence. |
| Relationship poisoning       | Versioned tuples, audit events, idempotent writes.                                                                                                                                                                       | Approval workflow, durable storage, source integrity checks.                                                                            |
| Overprivileged connector     | Read-only synthetic connectors, connector security review gate, readiness gates.                                                                                                                                         | Managed identity/vault, rotation, live-provider consent evidence, monitoring.                                                           |
| Silent drift                 | Drift findings and reconciliation endpoints.                                                                                                                                                                             | Durable reconciliation schedule and alerting.                                                                                           |
| Audit tampering              | Payload hashes and hash-chain integrity report.                                                                                                                                                                          | WORM or tamper-evident storage and retention.                                                                                           |
| Evidence overclaiming        | Docs mark proof-point versus production gaps.                                                                                                                                                                            | Assessor-reviewed statements and deployment-specific evidence.                                                                          |
| Secure SDLC evidence gaps    | Release evidence validation requires retained scan, fuzzing, abuse-test, and triage records mapped to mitigations.                                                                                                       | Deployment-specific scanner exports, DAST reports, triage tickets, approved risk acceptances.                                           |

A concrete path: if an attacker adds a native provider grant outside Access Kit, discovery records the native grant, reconciliation creates a drift finding, audit captures the finding, and the [drift remediation runbook](../runbooks/drift-remediation.md) guides revoke or exception handling.

Decision and explanation APIs are sensitive because they reveal authorization structure; evidence export access should be restricted for the same reason. Threat mitigations are evidenced by tests, ADRs, audit events, runbooks, validation reports, and control mappings; residual risks carry into POA&M inputs.

## Related References

- [System Context and Boundary](system-context-and-boundary.md)
- [Connector Contract](connector-contract.md)
- [Drift Detection Model](drift-detection-model.md)
- [ADR 0009: Secret management](../adrs/0009-secret-management.md)
- [ADR 0010: Fail behavior](../adrs/0010-fail-behavior.md)
