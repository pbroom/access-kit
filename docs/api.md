# API Contract Notes

## Source Of Truth

`openapi/rebac-control-plane.yaml` is the public API source of truth. The TypeScript runtime must conform to it rather than inventing routes independently.

## Service Runtime

The API package exposes a `rebac-api` entrypoint for local deployment packaging proof points. It starts the same OpenAPI-shaped runtime used by tests and accepts these environment variables:

- `REBAC_API_HOST`, default `127.0.0.1`
- `REBAC_API_PORT`, default `3000`
- `REBAC_API_ACTOR`, default `service:api`
- `REBAC_API_KEYS`, optional comma-separated bearer tokens for API access
- `REBAC_STATE_PATH`, optional local JSON runtime state snapshot path
- `REBAC_EVIDENCE_ROOT`, optional local audit/evidence repository root

When `REBAC_API_KEYS` is set, every `/v1` route except `/v1/health` and `/v1/ready` requires `Authorization: Bearer <token>`. Failed authentication attempts return `401`, set a bearer challenge, and emit `api.authentication_failed` audit evidence without logging token material. `REBAC_STATE_PATH` is a restartability proof point for synthetic runtime state. It is not a replacement for production graph, audit, queue, or evidence stores.

## API Groups

- Health: process health and runtime readiness probes.
- Decision: `check`, `explain`, and `batch-check`.
- Subjects: canonical subject registry and subject access view.
- Resources: canonical resource registry, decision-derived resource access view, and observed native-access view.
- Relationships: tuple query, put, and delete.
- Policies: draft, validate, publish, and rollback.
- Provisioning: dry-run plans, controlled synthetic enforcement plans, and jobs.
- Reconciliation: connector runs and drift findings.
- Audit: append-only event search, hash-chain integrity verification, and SIEM-ready event export.
- Evidence: control/time-bounded export with control mappings, integrity, boundary/data-flow evidence, access reviews, exceptions, ConMon metrics, POA&M inputs, operational evidence, and SIEM metadata.
- Discovery: read-only discovery run history.
- Connectors: capability listing, health/permission test, enforcement-readiness checks, and read-only discovery sync.

## Phase 2 Read-Only Discovery

`GET /v1/connectors` returns the registered connector adapters, including provider, tenant boundary, required read scopes, and capability flags. Phase 2 registers synthetic `mock`, `entra-readonly`, `sharepoint-readonly`, and `aws-readonly` connectors. These are contract fixtures, not live tenant integrations.

`POST /v1/connectors/{id}/test` returns connector health and permission checks. Check statuses are `pass`, `warn`, or `fail`; only failures make the response invalid.

`POST /v1/connectors/{id}/enforcement-readiness` returns an `EnforcementReadinessReport`. Phase 4 readiness is synthetic-only: the mock connector can return `ready` when live writes are disabled, incident mode is clear, break-glass is disabled, and provisioning/readback capabilities are present. Synthetic provider read-only connectors return `blocked` because live least-privilege write review is intentionally incomplete. The check emits `connector.enforcement_readiness_checked` audit evidence.

`GET /v1/connectors/{id}/enforcement-readiness` lists readiness reports and supports filtering by `status`.

`POST /v1/connectors/{id}/sync` accepts `mode: "read_only"` and returns a `DiscoveryRun`. The run records counts for discovered subjects, resources, relationship tuples, native grants, and warnings. It can include warnings, cursor/high-watermark metadata, and read-only evidence. It also emits `connector.discovery_completed` audit evidence.

`GET /v1/discovery/runs` lists discovery run history. It supports filtering by `connectorId` and status, including `completed_with_warnings`.

`GET /v1/resources/{id}/native-access` returns observed `NativeGrant` records from the latest discovery data. It supports connector, subject, native permission, grant type, and principal type filters. These records represent provider readback only; they are not intended grants and do not create authorization decisions.

## Phase 3 And 4 Provisioning

`POST /v1/provisioning/plans` defaults to `mode: "dry_run"` with `dryRun: true`. A plan records connector ID, action idempotency keys, pending verification metadata, and compensation intent. Revocation plans use `grantId`; grant/repair plans use subject, resource, and action.

`POST /v1/provisioning/jobs` also defaults to `mode: "dry_run"` with `dryRun: true` and `Idempotency-Key`. The local runtime returns the same job for repeated submissions with the same idempotency key. Dry-run jobs do not call provider write APIs; they mark actions as skipped, run connector verification hooks, and emit provisioning audit events.

Phase 4 adds `mode: "enforcement"` with `dryRun: false` for the synthetic `mock` connector only. Enforcement requests must include an approval object with `decision: "approved"`, `approverId`, `changeTicket`, and `approvedAt`, a control object with `syntheticOnly: true`, `liveProviderWrites: false`, `incidentMode: false`, and `breakGlass: false`, and a ready `readinessReportId` from the matching connector. The readiness report must match the current connector boundary, the submitted controls, and the approval change-ticket pattern. Read-only synthetic provider connectors, missing readiness evidence, and unsafe control settings are rejected before a job is accepted.

`GET /v1/provisioning/jobs/{id}` returns dry-run or controlled-enforcement job evidence.

`POST /v1/reconciliation/run` remains dry-run only and returns findings, counts, and audit event IDs.

## Phase 5 ATO Evidence

`GET /v1/ready` returns deployment-readiness checks for the local API runtime. It reports bearer-token guard configuration, local state snapshot wiring, local audit/evidence repositories, and registered connector adapters. The endpoint is public for orchestrator probes and never returns token material.

`GET /v1/audit/integrity` verifies the append-only audit event hash chain. The report includes event count, first and last event identifiers, first and last event hashes, findings, and an audit event ID for the verification action.

`GET /v1/audit/export` accepts `from`, `to`, and `target`. It returns a bounded `AuditEventExport` with JSONL records, source event IDs, payload hashes, an `exportedEventCount` for the requested window, and full-chain audit-integrity status. The local runtime supports `operator_download` and `siem_forwarder` as contract targets, but does not push events to an external SIEM. The export emits `audit.exported` audit evidence.

`GET /v1/evidence/export` accepts `framework`, `controls`, `from`, `to`, and `format`. The response is the complete local Phase 5 ATO package shape: audit integrity, control mappings, control statements, generated artifacts, system boundary, data flows, access reviews, exception register, continuous-monitoring metrics, POA&M inputs, operational evidence, and JSONL-ready SIEM export metadata. When an evidence repository is configured, the response also includes a storage receipt for the persisted package. The export emits `evidence.generated` audit evidence.

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
