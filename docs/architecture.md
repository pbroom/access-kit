# Architecture

This page answers: what are the layers of the control plane, how does a request flow through them, and what invariants hold everywhere? For what sits inside versus outside the boundary, see [System Context and Boundary](system-context-and-boundary.md).

## Layers

1. **Domain model**: canonical subjects, resources, relationship tuples, decisions, grants, native grants, provisioning actions, drift findings, audit events, and evidence exports.
2. **Policy Decision Point**: deterministic `check`, `explain`, and `batch-check` decisions.
3. **Policy Information Point**: normalized identity, resource, relationship, classification, and context data.
4. **Policy Administration Point**: policy validation, approval, publishing, rollback, and mandatory policy tests.
5. **Provisioning orchestrator**: plan, dry-run, apply, verify, revoke, repair, and rollback flows.
6. **Connector adapters**: provider-specific discovery, current-access readback, provisioning, reconciliation, and evidence emission behind a typed interface.
7. **Audit and evidence plane**: append-only events, hash-chain integrity reports, SIEM-ready JSONL exports, control mappings, and evidence export contracts.
8. **CLI**: operator, CI/CD, and assessor surface that wraps the API. It contains no authorization logic.

## Data flow

```mermaid
flowchart LR
  sources["Identity and resource sources"] --> ingest["Connector adapters"]
  ingest --> graph["Canonical registries and relationship graph"]
  graph --> pdp["Decision API"]
  pdp --> readiness["Connector enforcement-readiness report"]
  readiness --> plan["Provisioning plan"]
  plan --> connector["Connector dry-run or enforcement"]
  connector --> verify["Readback verification"]
  verify --> audit["Append-only audit event"]
  audit --> integrity["Audit integrity report"]
  integrity --> evidence["ATO evidence export"]
  connector --> drift["Drift finding"]
  drift --> audit
```

A concrete decision: `user:alice` asks to read `document:case-plan`. The engine evaluates `user:alice member_of group:case-team`, `group:case-team contributor_to workspace:case`, and `workspace:case contains document:case-plan`; for `read`, `contributor_to` is an allow relation and `contains` carries the grant to the document, so the decision is `allow` with `ALLOW_VIA_RELATIONSHIP_PATH`. Adding a direct deny tuple flips the same request to `DENY_EXPLICIT_OVERRIDE`; if the path expires, it returns `DENY_DEFAULT_NO_RELATIONSHIP_PATH`.

## Sources of truth

- [openapi/rebac-control-plane.yaml](../openapi/rebac-control-plane.yaml) is the public API contract.
- `schemas/*.schema.json` define portable object contracts; `packages/core/src/domain.ts` mirrors them in TypeScript.
- `packages/cli/src/commands.ts` maps operator commands to API operations.
- `tests/fixtures/policy/proof-points.json` pins required policy behaviors before any live write path can be enabled.

## Invariants

- Authorization is deterministic, reproducible, explainable, versioned, and testable. LLMs may not make authorization decisions.
- Deny by default. Deny, suspension, expiration, incident lock, legal hold, and revocation semantics are first-class.
- Decisions never mutate target systems. Provisioning runs through plan, approval, apply, verification, and audit; writes require idempotency keys and emit audit events.
- Intended grants and observed native grants remain separate objects. Drift between them is a security finding.
- Revocation has higher operational priority than new grants.
- Controlled enforcement is limited to the synthetic mock connector behind readiness evidence, approval, and guardrails; live provider writes are blocked.

## Later phases

1. Environment-specific graph and audit drivers behind the production adapter contracts, plus deployment packaging.
2. Live read-only Entra ID, SharePoint, and AWS discovery using the existing discovery-run and native-grant contracts.
3. Environment-specific queue driver and managed worker deployment behind the durable queue adapter.
4. Controlled enforcement with one Microsoft and one AWS write path after connector security review.
5. Production hardening: deployable services, approved SIEM forwarding, live connector security review, and production ATO evidence retention.
