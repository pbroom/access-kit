# Concept of Operations

## Purpose

This page describes how Access Kit operates as an API-first and CLI-first ReBAC authorization control plane from request intake through decision, provisioning, verification, reconciliation, audit, and evidence.

## Audience

Application developers, platform engineers, security engineers, ISSOs, assessors, resource owners, and product/governance leads.

## What This Is

Access Kit provides a governed authorization control plane. It uses canonical subjects, resources, relationship tuples, policy versions, and request context to compute deterministic decisions. It can explain those decisions, create provisioning plans, execute dry-run or synthetic mock-only controlled enforcement, verify connector readback, detect drift, record audit events, and export ATO-oriented evidence.

## What This Is Not

Access Kit does not authenticate users, operate an identity provider, replace native platform enforcement, claim production ATO status, or make decisions with LLMs. It does not currently perform live provider writes for Microsoft, AWS, SharePoint, AD, Teams, Power Platform, or Dataverse.

## Operating Model

1. Identity and resource information is normalized into canonical subjects and resources.
2. Relationship facts are asserted, imported, or discovered.
3. Policy proof points and versions define how relationships map to actions.
4. Applications or operators call the Decision API.
5. `check` returns a fast allow or deny response.
6. `explain` returns decision evidence, including reason code and relationship path.
7. Provisioning creates an auditable plan instead of mutating providers directly.
8. Dry-run jobs skip provider writes and record verification and compensation intent.
9. Synthetic controlled enforcement is available only for the mock connector and only with readiness evidence, approval, and guardrails.
10. Discovery and reconciliation compare observed native grants to intended access.
11. Drift findings, decisions, connector actions, audit exports, and evidence exports emit audit events.
12. Evidence exports assemble audit, control, boundary, data-flow, access-review, exception, ConMon, POA&M, OSCAL, signed package, verifier, control trace, operational, and SIEM metadata.
13. Runtime readiness reports whether admin access is still local bearer-token proof-point mode or is described by an evidenced IdP or mTLS gateway, separate admin ReBAC policy, secrets-manager references, break-glass approval, incident-mode notifications, and post-action review evidence.
14. Production operations monitor degraded-mode signals for API, graph, queue, audit, SIEM, connector, and admin boundaries, then fail closed, preserve evidence, and prioritize emergency revocation until recovery criteria are met.

## Core Concepts

- Deny by default is mandatory.
- Authorization decisions are deterministic and reproducible.
- Every decision should be traceable to a policy version, relationship version, reason code, and correlation ID.
- Provisioning follows plan, dry-run, apply, verify, audit, and reconcile.
- Drift is a first-class security finding.
- Revocation and expiration are first-class behaviors.
- Admin authorization is a separate control-plane concern from application authorization.
- Audit integrity and evidence export are part of normal operations, not end-of-project paperwork.

## Concrete Example

`user:alice` asks to read `document:case-plan`.

The API evaluates `user:alice member_of group:case-team`, `group:case-team contributor_to workspace:case`, and `workspace:case contains document:case-plan`. For `read`, `contributor_to` is an allow relation and `contains` carries the grant to the document. The decision returns `allow` with `ALLOW_VIA_RELATIONSHIP_PATH`.

If a direct deny tuple is added, the same request returns `deny` with `DENY_EXPLICIT_OVERRIDE`. If the relationship path expires, the request returns `DENY_DEFAULT_NO_RELATIONSHIP_PATH`.

## Security Considerations

- Do not treat observed native grants as intended grants.
- Do not enable live provider writes until connector identity, least privilege, rollback, emergency revocation, and operational runbooks are reviewed.
- Do not treat a shared bearer token as production admin authorization; require IdP or mTLS identity, admin ReBAC, revocation, audit, and emergency-workflow evidence.
- Do not use LLM output as an authorization input unless it has been converted into deterministic, reviewed policy or relationship data through approved governance.
- Use idempotency keys for write operations and keep revocations higher priority than grants.
- Treat queue backpressure, audit-forwarder outage, stale connector readback, and degraded admin readiness as security-relevant conditions with explicit recovery evidence.

## Audit And Evidence Implications

The operating model emits audit evidence for decisions, relationship writes, connector discovery, readiness checks, provisioning jobs, reconciliation, audit integrity verification, audit exports, evidence exports, and evidence verification. Admin operations must additionally retain IdP or mTLS identity evidence, approval records, break-glass expiry, incident notifications, and post-action review evidence before a production deployment can claim admin readiness. Evidence packages should connect those events to control mappings, reviewed implementation statements, signed package metadata, OSCAL fragments, and deployment-specific scope without claiming production authorization.

## Related Controls

| Control area | Access Kit support |
| --- | --- |
| AC | Deterministic decisions, deny by default, least privilege evidence, revocation paths. |
| AU | Append-only audit events, integrity reports, SIEM-ready export metadata. |
| CM | Versioned policy, relationship, connector, and control-plane evidence. |
| CA | Evidence packages, validation reports, continuous monitoring metrics. |
| IR | Emergency revocation, incident-mode gates, post-action review evidence. |

## Related References

- [Architecture](architecture.md)
- [Decision Lifecycle](decision-lifecycle.md)
- [Provisioning Lifecycle](provisioning-lifecycle.md)
- [Drift Detection Model](drift-detection-model.md)
- [Evidence Catalog](evidence-catalog.md)
- [OpenAPI contract](../openapi/rebac-control-plane.yaml)
- [CLI Contract](cli.md)
- [ADR 0001: API-first and CLI-first](../adrs/0001-api-first-cli-first.md)
