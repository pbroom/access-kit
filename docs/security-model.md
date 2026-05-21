# Security Model

## Security Posture

Access Kit is a high-value security system because it can approve, deny, provision, revoke, and explain access across many systems. It must be treated as privileged infrastructure even in early milestones.

## Authentication

The foundation does not authenticate users. Production authentication should be delegated to approved identity providers such as Entra ID, AD federation, PIV/CAC-backed flows, IAM Identity Center, or agency-approved identity systems. No local password store should exist except an explicitly approved break-glass design.

## Authorization

Internal administration must be governed by the same deterministic ReBAC model. Sensitive policy publication, connector configuration changes, break-glass access, enforcement enablement, and exception approvals require least privilege, approval, and audit.

## Secrets

Live connector credentials are not part of this milestone. Future connector credentials must use managed identities where possible, vault-backed secrets where needed, documented rotation, and no secret material in logs, fixtures, reports, or CI variables.

## Read-Only Discovery

Phase 2 connector sync is restricted to `read_only`. It may discover inventory and observed native grants through connector adapters, but it must not apply provider mutations, create native grants, revoke native grants, or treat provider readback as intended access.

The synthetic Entra ID, SharePoint, and AWS-style connectors use synthetic IDs, read scopes, tenant boundaries, subjects, resources, grants, warnings, and cursors. They exist to prove contract shape and security boundaries without secrets, production users, tenant IDs, account IDs, or provider API calls.

Phase 3 provisioning jobs are restricted to `dry_run`. They record skipped provider writes, verification-hook outcomes, compensation intent, and audit events. They must not call live provider write APIs.

## Fail Behavior

- Sensitive resources fail closed when the decision service is unavailable.
- Low-risk cached reads may use short-lived cached decisions only when policy explicitly permits it.
- Provisioning never assumes success and must verify target state after every write.
- Connector outages queue work, mark the connector degraded, and must not silently skip revocations.
- Revocation and quarantine actions have priority over new grants.

## Audit

Every decision, denial, grant, revoke, policy change, connector action, admin action, drift finding, and evidence export must emit an audit event. The event model supports hash chaining with `payloadHash` and `previousEventHash`; durable tamper-evident storage is a later implementation requirement.

## Privacy

Store only the minimum operational identity and resource metadata needed for authorization, evidence, and reconciliation. Redact tokens, claims, emails, object names, and sensitive classifications from logs unless they are required evidence fields.

## LLM Boundary

LLMs may help draft documentation, summarize evidence, or assist developers. They may not make authorization decisions, approve access, create grants, or replace deterministic policy evaluation.
