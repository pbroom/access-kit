# Product Positioning And Adoption Guide

## Purpose

This guide explains how to evaluate Access Kit without overstating what the repository can safely prove today. It is for teams deciding whether Access Kit fits their authorization governance problem, how to run the local proof point, and what evidence is still required before any production deployment claim.

## Audience

Product and governance leads, application developers, platform engineers, security engineers, operators, ISSOs, and assessors.

## What Access Kit Is

Access Kit is an API-first and CLI-first foundation for a relationship-based authorization control plane. It models subjects, resources, relationship facts, policies, decisions, provisioning plans, drift findings, audit events, and evidence exports so teams can inspect authorization behavior as a governed system instead of scattered application code.

The current repository is a local proof point. It proves contract shape, deterministic decision behavior, local API and CLI flows, synthetic connector boundaries, dry-run provisioning, audit integrity, and ATO-oriented evidence package structure. It is useful for developer evaluation, control-plane design review, policy-model experimentation, and assessor-oriented traceability exercises.

## What Access Kit Is Not

Access Kit is not:

- a production authorization service ready for live tenant traffic
- an identity provider, authentication system, or local password store
- a replacement for Entra ID, Active Directory, AWS IAM, SharePoint permissions, Teams membership, Power Platform security roles, Dataverse roles, IAM Identity Center, or application-specific enforcement
- a SIEM, ticketing system, workflow platform, or incident-management system
- a FedRAMP-authorized package, production SSP, ATO, or replacement for an ATO process
- a live-provider enforcement engine for Microsoft, AWS, SharePoint, AD, or Power Platform writes
- an LLM decision engine

The repository supports ATO-oriented inspection. It does not create an ATO, prove FedRAMP approval, certify a deployment boundary, or replace assessor-reviewed evidence.

## When To Use It

Use Access Kit when the problem is authorization governance across applications, resources, and providers:

| Use case | Why it fits |
| --- | --- |
| Local developer evaluation | The quickstart and evaluation path show check, explain, policy tests, dry-run provisioning, reconciliation, audit export, and evidence export against synthetic data. |
| Relationship-based authorization design | The domain model and policy proof points make users, resources, groups, ownership, access paths, explicit deny, and tenant boundaries reviewable. |
| Control-plane architecture review | The API, CLI, connector, audit, persistence, and evidence contracts separate policy decisions from authentication and native provider enforcement. |
| Assessor-oriented traceability | Evidence exports, audit events, control mappings, runbooks, and known gaps give reviewers a concrete path through implementation claims. |
| Safe connector planning | Synthetic and read-only connector boundaries let teams discuss native grant readback, drift, and provisioning risks before live writes. |

## When Not To Use It

Do not use Access Kit as the production enforcement path until deployment-specific controls are implemented, reviewed, and evidenced. Do not put live tenant identifiers, production users, provider secrets, or customer data into examples, fixtures, logs, or local proof-point exports.

Access Kit is also the wrong tool when the problem is primary authentication, session management, SIEM correlation and alerting, ticket queue ownership, generic workflow automation, endpoint detection, or provider-native permission administration without an authorization policy record.

## Proof Point Versus Production Readiness

| Topic | Current proof point | Required before production claims |
| --- | --- | --- |
| API runtime | Local HTTP API with schema-backed contracts, health/readiness probes, bearer-token guardrails, and deterministic authorization responses. | Approved deployment boundary, production identity gateway or mTLS path, request-scoped actor binding, rate limits, monitored operations, and environment-specific hardening. |
| CLI | Operator and assessor command surface that calls the API and does not evaluate authorization locally. | Packaged distribution, profile handling, token storage guidance, retained operator evidence, and deployment-specific approval workflows. |
| PEP integration | API and decision contracts suitable for first middleware/client evaluation patterns. | A reviewed PEP implementation that fails closed, propagates correlation IDs, avoids local fallback authorization, and redacts sensitive explain details. |
| Connectors | Mock and synthetic connectors, read-only discovery boundaries, dry-run provisioning, and synthetic-only enforcement proof points. | Provider-specific security review, least-privilege scopes, sandbox evidence, live-write readiness, rollback evidence, and approval gates for each provider. |
| Audit and evidence | Hash-chain audit checks, bounded SIEM-ready export shape, and local ATO-oriented evidence packages. | Selected immutable or WORM audit storage, approved SIEM forwarding, retained delivery/replay evidence, reviewed control statements, and deployment-specific evidence vault controls. |
| Persistence and jobs | Local proof-point stores plus production-shaped graph, audit, job, and queue contracts. | Durable backends, transactional behavior where needed, backup/restore evidence, migration review, and operational monitoring. |

## ReBAC, RBAC, And ABAC Framing

Access Kit is centered on ReBAC because many authorization questions depend on relationships: who owns a case, who belongs to a group, what project contains a document, which tenant boundary applies, and which native grant was observed. ReBAC makes those paths explainable and auditable.

RBAC still matters. Operator roles, administrative responsibilities, break-glass duties, and coarse application roles can remain role-based inputs. Access Kit should not flatten every role into a relationship when a role is the correct governance object.

ABAC also still matters. Attributes such as classification, subject status, environment, ticket references, and incident mode can constrain a decision. Access Kit should treat attributes as explicit policy inputs with auditability, not as hidden application-side shortcuts.

The adoption question is not "ReBAC or RBAC or ABAC." The safer framing is: relationships explain access paths, roles describe responsibilities, and attributes constrain context. Production policy should make all three reviewable and testable.

## Integration Patterns

| Pattern | Use it for | Boundary |
| --- | --- | --- |
| Direct API check | Applications or middleware ask whether a subject can act on a resource. | The caller still owns authentication, session handling, and protected-route fail behavior. |
| Policy enforcement point | A middleware, gateway, or service wrapper calls the Decision API before protected actions. | The PEP must fail closed for protected resources and must not substitute local authorization when Access Kit is unavailable. |
| Operator CLI | Operators inspect readiness, run dry-run provisioning, reconcile drift, export audit windows, and produce evidence. | The CLI is not an authorization engine and must not store or print token material. |
| Connector discovery | Read-only connector adapters discover inventory and observed native grants. | Observed native access is evidence, not intended policy. Live writes require separate readiness gates. |
| Evidence export | Operators or assessors export bounded proof-point evidence and trace controls to source events. | Local evidence supports inspection and planning; it is not a production ATO package by itself. |

## Plain-Language Security Model

Access Kit should be treated as privileged infrastructure because it can explain, approve, deny, plan, and audit access. The local proof point is intentionally conservative:

- decisions are deterministic and deny by default
- the CLI calls the API instead of making local authorization decisions
- live connector credentials are not part of default evaluation
- provisioning starts as dry run
- synthetic-only enforcement cannot enable live provider writes
- evidence and audit examples must stay synthetic
- LLMs may help draft or summarize but must not decide access

Production adoption must add approved identity, admin authorization, secrets management, durable storage, queue operations, monitoring, incident procedures, immutable audit retention, SIEM forwarding, and assessor-reviewed evidence.

## Buyer Evaluation Checklist

- The target problem is authorization governance, not authentication, SIEM, ticketing, or generic workflow.
- Stakeholders accept that the current repository is a proof point and not a production authorization service.
- The deployment plan names the identity provider or mTLS gateway, durable stores, queue backend, SIEM forwarder, secrets manager, and evidence repository.
- The team can keep production tenant data, secrets, tokens, and customer identifiers out of local proof-point artifacts.
- The roadmap includes provider-specific connector security review before live writes.
- Procurement, compliance, and security reviewers understand that ATO and FedRAMP status must come from deployment-specific assessment, not this repository alone.

## Developer Evaluation Checklist

- Run the [Five-Minute Quickstart](five-minute-quickstart.md) and confirm allow plus deny-by-default behavior.
- Run the [Developer Evaluation Path](developer-evaluation-path.md) and inspect policy tests, dry-run provisioning, reconciliation, audit export, and evidence export.
- Read the [Decision Lifecycle](decision-lifecycle.md), [Explain API](explain-api.md), and policy proof points before building a PEP.
- Verify that application authentication remains outside Access Kit and that subject identifiers are mapped safely at the boundary.
- Design protected-route failure behavior before integration; sensitive resources should fail closed.
- Preserve correlation IDs, decision IDs, reason codes, and redacted explain traces for operator and assessor review.
- Keep examples synthetic and do not introduce production secrets or tenant identifiers into fixtures.

## Assessor Evaluation Checklist

- Confirm scope in [Start Here](start-here.md), [Non-Goals](non-goals.md), and [System Context and Boundary](system-context-and-boundary.md).
- Use the [Assessor Inspection Guide](assessor-inspection-guide.md) to trace claims to docs, schemas, tests, runbooks, and evidence.
- Review [Security Model](security-model.md) for authentication, admin authorization, connector, audit, and LLM boundaries.
- Review [Evidence Catalog](evidence-catalog.md) and [Control Traceability Matrix](control-traceability-matrix.md) for proof-point evidence coverage and remaining gaps.
- Treat local bearer tokens, local files, synthetic connectors, and generated examples as proof-point artifacts only.
- Ask for deployment-specific IdP or mTLS configuration, admin ReBAC role bindings, secrets-manager references, WORM or immutable audit retention, SIEM delivery evidence, backup/restore exercises, and approved control statements before production authorization.

## Adoption Path

1. Orient on this guide, [Start Here](start-here.md), and [Non-Goals](non-goals.md).
2. Run the [Five-Minute Quickstart](five-minute-quickstart.md) with synthetic data.
3. Run the [Developer Evaluation Path](developer-evaluation-path.md) and review generated local evidence.
4. Choose an integration pattern and document failure behavior, audit fields, and protected resources.
5. Run a sandbox PEP or CLI/operator evaluation without production tenant data.
6. Complete provider, identity, persistence, queue, audit, SIEM, secrets, runbook, and evidence readiness before any production claim.

## Security Considerations

Positioning is part of the security boundary. Overclaiming proof-point artifacts as production readiness can cause unsafe deployment decisions, assessor confusion, and misplaced trust in local controls.

## Audit And Evidence Implications

Adoption evidence should record the exact repository version, validation commands, synthetic data boundary, integration pattern under evaluation, known gaps, and deployment controls that remain external. Evidence should say what was proved and what was not proved.

## Related References

- [Start Here](start-here.md)
- [Non-Goals](non-goals.md)
- [System Context and Boundary](system-context-and-boundary.md)
- [Security Model](security-model.md)
- [Developer Evaluation Path](developer-evaluation-path.md)
- [Assessor Inspection Guide](assessor-inspection-guide.md)
