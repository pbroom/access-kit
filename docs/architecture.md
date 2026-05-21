# ReBAC Control Plane Architecture

## Purpose

Access Kit is a governed authorization control plane for relationship-based access control. It coordinates identity sources, resource inventories, relationship facts, policy decisions, provisioning plans, drift findings, audit events, and ATO evidence. It does not authenticate users and it does not replace native enforcement in Entra ID, Active Directory, AWS, SharePoint, Teams, Power Platform, or application-specific authorization layers.

The first milestone establishes contracts and validation evidence only. Live connectors, persistent graph storage, runtime API handlers, and dashboards are later phases.

## Layered Shape

1. Domain model: canonical subjects, resources, relationship tuples, decisions, grants, native grants, provisioning actions, drift findings, audit events, and evidence exports.
2. Policy Decision Point: deterministic `check`, `explain`, and `batch-check` decisions.
3. Policy Information Point: normalized identity, resource, relationship, classification, and context data.
4. Policy Administration Point: policy validation, approval, publishing, rollback, and mandatory policy tests.
5. Provisioning Orchestrator: plan, dry-run, apply, verify, revoke, repair, and rollback flows.
6. Connector adapters: provider-specific discovery, current-access readback, provisioning, reconciliation, and evidence emission behind a typed interface.
7. Audit and evidence plane: append-only event model, validation evidence, control mapping, and export contracts.
8. CLI: operator, CI/CD, and assessor surface that wraps API contracts.

## Data Flow

```mermaid
flowchart LR
  sources["Identity and resource sources"] --> ingest["Connector adapters"]
  ingest --> graph["Canonical registries and relationship graph"]
  graph --> pdp["Decision API"]
  pdp --> plan["Provisioning plan"]
  plan --> connector["Connector dry-run or enforcement"]
  connector --> verify["Readback verification"]
  verify --> audit["Append-only audit event"]
  audit --> evidence["ATO evidence export"]
  connector --> drift["Drift finding"]
  drift --> audit
```

## Milestone Boundaries

- The OpenAPI file is the public API source of truth.
- JSON Schemas define portable object contracts.
- TypeScript types mirror those schemas for implementation ergonomics.
- The CLI command list maps operator commands to API operations.
- The mock connector proves the adapter boundary without credentials or production mutation.
- Proof-point fixtures prove required policy behaviors before any live connector exists.

## Required Invariants

- Authorization is deterministic, reproducible, explainable, versioned, and testable.
- LLMs may not make authorization decisions.
- Deny by default.
- Deny, suspension, expiration, incident lock, legal hold, and revocation semantics must be first-class.
- Decisions never mutate target systems directly.
- Provisioning runs through plan, approval, apply, verification, and audit.
- Write operations require idempotency keys and emit audit events.
- Intended grants and native grants remain separate.
- Drift is a security finding, not only a log line.
- Revocation has higher operational priority than new grants.

## Later Phases

1. Runtime API service and durable graph/event stores.
2. Read-only Entra ID, SharePoint, and AWS discovery.
3. Simulation and dry-run reconciliation.
4. Controlled enforcement with one Microsoft and one AWS write path.
5. ATO hardening: tamper-evident audit storage, SIEM export, vulnerability evidence, break-glass, incident mode, and full evidence packages.
