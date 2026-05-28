# Security Model

## Security Posture

Access Kit is a high-value security system because it can approve, deny, provision, revoke, and explain access across many systems. It must be treated as privileged infrastructure even in early milestones.

## Authentication

The local API runtime can require opaque bearer tokens through `REBAC_API_KEYS`. This is a deployment-packaging guardrail for synthetic and pre-production use: `/v1/health` and `/v1/ready` remain public for orchestrator probes, protected API calls require `Authorization: Bearer <token>`, and failed attempts emit `api.authentication_failed` audit evidence at most once per failure reason per one-minute sample window without logging token material or forcing runtime state snapshot writes from the unauthenticated path. The runtime permits no-key mode only on loopback hosts and refuses non-loopback binding without configured keys.

Production authentication is represented by the `AdminAuthorizationDescriptor` readiness contract in `packages/core/src/admin-authorization.ts` and must be delegated to approved identity providers such as Entra ID, AD federation, PIV/CAC-backed flows, IAM Identity Center, mTLS gateways, or agency-approved identity systems. A production-ready descriptor requires MFA, bounded sessions, revocation SLA evidence, an identity-aware gateway or mTLS boundary, external secrets-manager references, and retained evidence references. The default local bearer-token descriptor is reported by `/v1/ready` as a pre-production warning, not as production admin authentication. No local password store should exist except an explicitly approved break-glass design.

## Authorization

Internal administration must be governed by an admin ReBAC policy that is separate from application authorization decisions. Sensitive policy publication, connector configuration changes, break-glass access, enforcement enablement, audit/evidence export, and exception approvals require least privilege, role binding evidence, fast revocation, approval, and audit. The admin authorization readiness contract checks that the admin ReBAC policy is evidenced separately from application policy so production operator power cannot collapse into a single shared bearer token.

## Emergency Administration

Break-glass access is an emergency workflow, not a standing role. Production deployments must require multi-role approval, short-lived elevation, incident-mode notification, retained audit events, and post-action review evidence before claiming admin readiness. The local controlled-enforcement guardrails continue to reject break-glass and incident-mode flags for synthetic enforcement jobs; deployment teams must supply provider-native disablement and session revocation evidence when emergency admin access is used.

## Secrets

Live connector credentials are not part of the default local proof point. The optional Microsoft Graph Entra read-only connector may be enabled for a sandbox tenant with a short-lived token or token file, and the optional AWS read-only access-analysis connector may be enabled with a redacted sandbox fixture or reviewed read-client boundary. Production connector credentials must use managed identities or provider roles where possible, vault-backed secrets where needed, documented rotation, and no secret material in logs, fixtures, reports, or CI variables.

## Read-Only Discovery

Phase 2 connector sync is restricted to `read_only`. It may discover inventory and observed native grants through connector adapters, but it must not apply provider mutations, create native grants, revoke native grants, or treat provider readback as intended access.

The synthetic Entra ID, SharePoint, and AWS-style connectors use synthetic IDs, read scopes, tenant boundaries, subjects, resources, grants, warnings, and cursors. They exist to prove contract shape and security boundaries without secrets, production users, tenant IDs, account IDs, or provider API calls.

The Microsoft Graph sandbox foundation is different: it can call Microsoft Graph when explicitly configured for a sandbox tenant. It maps users, groups, service principals, app-role assignments, Microsoft 365 group and Teams coupling, SharePoint sites, drives, folders, files, and OneDrive inventory into redacted subjects, resources, relationships, and observed native grants where a staged slice supports them. SharePoint and OneDrive hierarchy imports carry inheritance ambiguity markers and `canonicalAccessGranted: false`; missing sandbox evidence, pagination, throttling, limited objects, and unsupported readback behavior are recorded as warnings instead of becoming unqualified canonical facts.

The AWS read-only access-analysis foundation follows the same read-only evidence model for IAM Identity Center assignments, AWS Organizations account boundaries, IAM roles, CloudTrail activity, and Access Analyzer findings. Runtime registration requires explicit AWS sandbox fixture configuration in this repository slice, tombstones are marked instead of dropped, and Access Analyzer findings remain drift evidence for review rather than intended authorization state. AWS activity readback also records EventBridge delivery latency, CloudTrail stale activity windows, partial ordering, retry behavior, and reconciliation confidence so delayed provider evidence cannot be mistaken for exact ordering or intended access.

Connector registrations must pass `pnpm validate:connector-security`. The gate requires explicit identity, consent, tenant-boundary, least-privilege read-scope, pagination, throttling, deletion, coverage-warning, secret-handling, and no-write evidence before future live connector slices can build on the adapter.

Phase 3 provisioning jobs default to `dry_run`. They record skipped provider writes, verification-hook outcomes, compensation intent, and audit events. They must not call live provider write APIs.

Phase 4 controlled enforcement is restricted to the synthetic `mock` connector. It requires a ready connector enforcement-readiness report, an approved change ticket, matching approver, synthetic-only controls, no live provider writes, no break-glass flag, and incident mode set to false. The readiness report records provider boundary, readback capability, provisioning capability, rollback/compensation expectation, incident-mode clearance, break-glass clearance, least-privilege review status, and change-ticket policy. Plan creation requires that the report match the current connector boundary, submitted controls, and approval change-ticket pattern. Synthetic provider read-only connectors cannot enforce even when callers provide approval fields.

## Fail Behavior

- Sensitive resources fail closed when the decision service is unavailable.
- Low-risk cached reads may use short-lived cached decisions only when policy explicitly permits it.
- Provisioning never assumes success and must verify target state after every write.
- Enforcement planning fails closed when the caller omits readiness evidence or presents a blocked, missing, mismatched, or live-write-enabled readiness report.
- Connector outages queue work, mark the connector degraded, and must not silently skip revocations. The production queue adapter keeps emergency revocations reservable even when normal connector work is degraded, records dead-lettered failures for operator replay, and preserves idempotency hashes so duplicate deliveries cannot silently turn into different work.
- Degraded production modes must preserve fail-closed authorization, audit append, and emergency revocation priority. Queue backpressure pauses new grants and non-urgent discovery; audit-forwarder outage creates a high-severity integrity finding until replay succeeds; read-only fallback never authorizes local decisions or live provider writes.
- Revocation and quarantine actions have priority over new grants.

## Audit

Every decision, denial, grant, revoke, policy change, connector action, admin action, drift finding, audit-integrity verification, audit export, and evidence export must emit an audit event. The event model supports hash chaining with `payloadHash` and `previousEventHash`; Phase 5 verifies that chain in the local runtime, exports bounded SIEM-ready JSONL records, and can persist local JSONL proof-point events. The production audit/evidence adapter adds the immutable external audit boundary: append-only event receipts, retention policy metadata, signed audit windows, SIEM delivery and replay records, tamper-evident evidence package receipts, backup/restore metadata, and integrity findings when SIEM delivery fails.

Phase 5 evidence exports include local system-boundary, data-flow, access-review, exception, incident, break-glass, backup/restore, dependency, vulnerability, configuration-baseline, OSCAL fragment, signed package, verifier, and control-to-event trace proof points. These are synthetic evidence contracts for assessor review; production workflows still require deployment-specific approvals, signing keys, retention, recovery testing, and security tooling.

The secure SDLC release evidence manifest keeps SAST, DAST, dependency scanning, SBOM/provenance, fuzzing, tenant-isolation abuse tests, threat-model refresh, vulnerability triage, and NIST SSDF mapping tied to a release reference. It maps evidence to authorization, connector, persistence, cross-tenant isolation, and evidence-abuse mitigations without storing live vulnerability exports, scanner credentials, tenant identifiers, or assessor-approved risk acceptances.

Production graph, connector-state, queue, and audit/evidence adapters reject malformed hash envelopes and secret-bearing records before serving data. Graph and connector-state adapters also enforce tenant boundaries on persisted entities, while the audit adapter preserves event order, rejects unredacted secrets, and surfaces SIEM delivery failures as high-severity integrity findings until replay succeeds. The connector-state adapter remains separate from the durable queue boundary, so storing discovery and reconciliation history does not authorize live writes or imply job-execution readiness. Queue workers still execute through runtime approval and readiness gates before controlled enforcement can complete.

## Privacy

Store only the minimum operational identity and resource metadata needed for authorization, evidence, and reconciliation. Redact tokens, claims, emails, object names, and sensitive classifications from logs unless they are required evidence fields.

## LLM Boundary

LLMs may help draft documentation, summarize evidence, or assist developers. They may not make authorization decisions, approve access, create grants, or replace deterministic policy evaluation.
