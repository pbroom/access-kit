# API Contract Notes

## Source Of Truth

`openapi/rebac-control-plane.yaml` is the public API source of truth. The TypeScript runtime must conform to it rather than inventing routes independently.

## API Groups

- Decision: `check`, `explain`, and `batch-check`.
- Subjects: canonical subject registry and subject access view.
- Resources: canonical resource registry, decision-derived resource access view, and observed native-access view.
- Relationships: tuple query, put, and delete.
- Policies: draft, validate, publish, and rollback.
- Provisioning: dry-run plans and jobs.
- Reconciliation: connector runs and drift findings.
- Audit: append-only event search.
- Evidence: control/time-bounded export.
- Discovery: read-only discovery run history.
- Connectors: capability listing, health/permission test, and read-only discovery sync.

## Phase 2 Read-Only Discovery

`GET /v1/connectors` returns the registered connector adapters, including provider, tenant boundary, required read scopes, and capability flags. Phase 2 registers synthetic `mock`, `entra-readonly`, `sharepoint-readonly`, and `aws-readonly` connectors. These are contract fixtures, not live tenant integrations.

`POST /v1/connectors/{id}/test` returns connector health and permission checks. Check statuses are `pass`, `warn`, or `fail`; only failures make the response invalid.

`POST /v1/connectors/{id}/sync` accepts `mode: "read_only"` and returns a `DiscoveryRun`. The run records counts for discovered subjects, resources, relationship tuples, native grants, and warnings. It can include warnings, cursor/high-watermark metadata, and read-only evidence. It also emits `connector.discovery_completed` audit evidence.

`GET /v1/discovery/runs` lists discovery run history. It supports filtering by `connectorId` and status, including `completed_with_warnings`.

`GET /v1/resources/{id}/native-access` returns observed `NativeGrant` records from the latest discovery data. It supports connector, subject, native permission, grant type, and principal type filters. These records represent provider readback only; they are not intended grants and do not create authorization decisions.

## Write Requirements

Every write operation must:

- require `Idempotency-Key`
- emit an audit event
- preserve policy and relationship version context where relevant
- support retry without duplicate effective grants
- return stable canonical IDs

## Decision Requirements

Every decision response includes:

- decision ID
- allow or deny
- subject, action, and resource
- reason code
- policy version
- relationship tuple version
- relationship path used, when any
- constraints
- evaluation timestamp

`check` is optimized for fast allow or deny. `explain` is optimized for audit, incident response, system owner review, and assessor evidence.
