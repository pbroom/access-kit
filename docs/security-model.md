# Security Model

## Security Posture

Access Kit is a high-value security system because it can approve, deny, provision, revoke, and explain access across many systems. It must be treated as privileged infrastructure even in early milestones.

## Authentication

The local API runtime can require opaque bearer tokens through `REBAC_API_KEYS`. This is a deployment-packaging guardrail for synthetic and pre-production use: `/v1/health` and `/v1/ready` remain public for orchestrator probes, protected API calls require `Authorization: Bearer <token>`, and failed attempts emit `api.authentication_failed` audit evidence without logging token material. Production authentication should still be delegated to approved identity providers such as Entra ID, AD federation, PIV/CAC-backed flows, IAM Identity Center, mTLS gateways, or agency-approved identity systems. No local password store should exist except an explicitly approved break-glass design.

## Authorization

Internal administration must be governed by the same deterministic ReBAC model. Sensitive policy publication, connector configuration changes, break-glass access, enforcement enablement, and exception approvals require least privilege, approval, and audit.

## Secrets

Live connector credentials are not part of this milestone. Future connector credentials must use managed identities where possible, vault-backed secrets where needed, documented rotation, and no secret material in logs, fixtures, reports, or CI variables.

## Read-Only Discovery

Phase 2 connector sync is restricted to `read_only`. It may discover inventory and observed native grants through connector adapters, but it must not apply provider mutations, create native grants, revoke native grants, or treat provider readback as intended access.

The synthetic Entra ID, SharePoint, and AWS-style connectors use synthetic IDs, read scopes, tenant boundaries, subjects, resources, grants, warnings, and cursors. They exist to prove contract shape and security boundaries without secrets, production users, tenant IDs, account IDs, or provider API calls.

Phase 3 provisioning jobs default to `dry_run`. They record skipped provider writes, verification-hook outcomes, compensation intent, and audit events. They must not call live provider write APIs.

Phase 4 controlled enforcement is restricted to the synthetic `mock` connector. It requires a ready connector enforcement-readiness report, an approved change ticket, matching approver, synthetic-only controls, no live provider writes, no break-glass flag, and incident mode set to false. The readiness report records provider boundary, readback capability, provisioning capability, rollback/compensation expectation, incident-mode clearance, break-glass clearance, least-privilege review status, and change-ticket policy. Plan creation requires that the report match the current connector boundary, submitted controls, and approval change-ticket pattern. Synthetic provider read-only connectors cannot enforce even when callers provide approval fields.

## Fail Behavior

- Sensitive resources fail closed when the decision service is unavailable.
- Low-risk cached reads may use short-lived cached decisions only when policy explicitly permits it.
- Provisioning never assumes success and must verify target state after every write.
- Enforcement planning fails closed when the caller omits readiness evidence or presents a blocked, missing, mismatched, or live-write-enabled readiness report.
- Connector outages queue work, mark the connector degraded, and must not silently skip revocations.
- Revocation and quarantine actions have priority over new grants.

## Audit

Every decision, denial, grant, revoke, policy change, connector action, admin action, drift finding, audit-integrity verification, audit export, and evidence export must emit an audit event. The event model supports hash chaining with `payloadHash` and `previousEventHash`; Phase 5 verifies that chain in the local runtime, exports bounded SIEM-ready JSONL records, and can persist local JSONL proof-point events, while durable tamper-evident storage and approved SIEM forwarding remain later implementation requirements.

Phase 5 evidence exports include local system-boundary, data-flow, access-review, exception, incident, break-glass, backup/restore, dependency, vulnerability, and configuration-baseline proof points. These are synthetic evidence contracts for assessor review; production workflows still require deployment-specific approvals, retention, recovery testing, and security tooling.

## Privacy

Store only the minimum operational identity and resource metadata needed for authorization, evidence, and reconciliation. Redact tokens, claims, emails, object names, and sensitive classifications from logs unless they are required evidence fields.

## LLM Boundary

LLMs may help draft documentation, summarize evidence, or assist developers. They may not make authorization decisions, approve access, create grants, or replace deterministic policy evaluation.
