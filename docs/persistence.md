# Persistent Storage Foundation

This page answers: where does state live today, what must a production backend satisfy, and which adapters exist? The local runtime defaults to in-memory state, local JSON snapshots, and local proof-point evidence files. The production adapter boundary defined here is what database, audit-ledger, and queue implementations must satisfy before live connectors or enforcement can rely on them.

## Repository groups

Storage is split into three deliberately separate groups: relationship tuples are not native grants, decisions are not provisioning jobs, and audit events are not mutable operational records.

- **Graph**: canonical subjects, resources, relationship tuples, and observed native grants.
- **Audit**: append-only events, hash-chain integrity, immutability, retention, and replay.
- **Jobs**: discovery runs, readiness reports, provisioning plans and jobs, drift findings, reconciliation runs, and recorded decisions.

## Readiness contract

`assessPersistenceReadiness` evaluates backend descriptors: graph backends need transactional writes, relationship queries, and backup/restore; audit backends need append-only writes, hash-chain verification, immutability controls, at least one year of retention, and backup/restore; job backends need queue semantics, idempotency lookup, transactional writes, and backup/restore. Local memory and local file adapters always report blocked for production.

`PersistenceDeploymentManifest` raises this to a deployment-level gate: it requires production intent, exactly one external backend kind each for graph (`external_graph`), audit (`external_append_only_audit`), and jobs (`external_queue`), plus deployment controls for IdP-backed access, operator authorization, externalized secrets, backup/restore testing, change approval, monitoring, and migration review. `pnpm validate:persistence-deployment` validates the schemas (`schemas/persistence-deployment-manifest.schema.json`, `schemas/persistence-deployment-readiness.schema.json`) against the retained examples under `deploy/persistence/` and proves a local proof-point manifest stays blocked.

## Adapters

| Adapter                               | Contract                                                 | Storage                                                     | Production-ready?                                                                                                                       |
| ------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `InMemoryRebacPersistenceRepository`  | graph + jobs                                             | memory                                                      | No — test/proof-point conformance adapter.                                                                                              |
| `LocalJsonFileGraphRepository`        | `RebacGraphRepository`                                   | hash-checked local JSON (graph facts only)                  | No — `local_file`, `durable: false`.                                                                                                    |
| `LocalAppendOnlyAuditRepository`      | `AuditEventRepository`                                   | local JSONL with event hashes, rejects out-of-order appends | No — local integrity proof point, not WORM.                                                                                             |
| `LocalJsonFileJobRepository`          | `RebacJobRepository`                                     | hash-checked local JSON with idempotency lookups            | No — proof-point capabilities only.                                                                                                     |
| `ReferenceGraphStoreAdapter`          | `RebacGraphRepository`                                   | injected external snapshot store                            | Boundary for a selected graph backend; enforces tenant-boundary attributes, rejects tampered or secret-bearing payloads.                |
| `ReferenceConnectorStateStoreAdapter` | connector state                                          | injected external snapshot store                            | Boundary only; describes itself as `external_connector_state`, not a queue.                                                             |
| `ReferenceJobQueueAdapter`            | queue/jobs                                               | injected external snapshot store                            | Boundary for a durable queue: idempotency records, emergency revocation priority, retry/backoff, dead-letter, replay, connector health. |
| `ReferenceAuditEvidenceAdapter`       | audit/evidence                                           | injected append-only external store                         | Boundary for a WORM or ledger driver: signed windows, SIEM delivery and replay receipts, tamper detection, secret-payload rejection.    |
| `@access-kit/persistence-postgres`    | `ExternalSnapshotStore` + `ExternalAppendOnlyAuditStore` | PostgreSQL                                                  | First concrete external backend; see below.                                                                                             |

When the API runtime receives `REBAC_STATE_PATH`, `createLocalRuntimePersistence` wires the local JSON graph and job repositories beside the legacy runtime snapshot; writes go through those repositories and reload across restarts. Audit events stay in the append-only audit file or the compatibility snapshot.

## PostgreSQL backend

`@access-kit/persistence-postgres` implements the injectable snapshot store (graph and connector-state snapshots with hash-guarded compare-exchange writes) and the append-only audit store (INSERT-only audit, evidence, signed-window, and SIEM delivery rows). It bootstraps its schema with `CREATE TABLE IF NOT EXISTS` plus indexes and enforces append-only semantics with database triggers that reject `UPDATE`/`DELETE` on audit rows outside an explicit backup-restore transaction. Audit sequence continuity is re-verified on every read.

Setting `REBAC_DATABASE_URL` (with `REBAC_DATABASE_TENANT_BOUNDARY` and `REBAC_DATABASE_AUDIT_SIGNING_KEY`) selects this backend in the API runtime. The factory verifies the connection during schema bootstrap before constructing any repository, so `durable: true` descriptors are only produced against a live connection. Integration tests gate on `REBAC_TEST_DATABASE_URL` and run in CI against a `postgres:16` service container. Selecting, operating, and evidencing a production Postgres deployment (HA, backups, access controls, monitoring) remains deployment-specific work.

## Queue execution

`drainNextQueuedJob` is the optional runtime worker path for queued discovery, reconciliation, provisioning, evidence export, and revocation jobs. It reserves a queue record, executes through the same runtime functions as the synchronous API, and completes the record only after those flows finish. Controlled enforcement revalidates approval, readiness, and controls at execution time.

## Test coverage

`tests/core/repository-conformance.test.ts` runs the shared conformance suite against the in-memory, local JSON, and production external adapters. Adapter-specific tamper, malformed-payload, tenant-boundary, secret-material, queue-semantics, and backup/restore checks are explicit production tests. `tests/api/job-queue-runner.test.ts` covers the worker drain path.

## What production still needs

Selected drivers behind the same contracts — a graph database or relational projection, an environment-specific WORM or ledger driver, a connector-state store, a durable queue with managed workers — plus deployment-specific backup, restore, retention, and migration evidence. No live provider write path may depend on local JSON snapshots, local JSONL audit files, or in-memory repositories.
