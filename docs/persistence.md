# Persistent Storage Foundation

The local runtime still uses in-memory state, local JSON snapshots, and local proof-point evidence files by default. This storage foundation defines the production adapter boundary that later database, audit-ledger, and queue implementations must satisfy before live connectors or enforcement can rely on them.

## Repository Groups

The persistent control plane is split into three repository groups:

- **Graph repository:** canonical subjects, resources, relationship tuples, and observed native grants.
- **Audit repository:** append-only audit events, hash-chain integrity, immutability, retention, and replay.
- **Job repository:** discovery runs, enforcement-readiness reports, provisioning plans, provisioning jobs, drift findings, reconciliation runs, and recorded decisions.

These groups intentionally stay separate. Relationship tuples are not native grants, decisions are not provisioning jobs, and audit events are not mutable operational records.

## Readiness Contract

`assessPersistenceReadiness` evaluates backend descriptors before a deployment can claim production-ready persistence.

Required production capabilities:

- Graph: read/write graph facts, relationship queries, transactional writes, and backup/restore.
- Audit: append-only writes, hash-chain verification, immutability, retention, and backup/restore.
- Jobs: queue/enqueue semantics, idempotency lookup, transactional writes, and backup/restore.

The readiness report blocks local memory and local file proof points from being treated as production storage. Audit backends must also declare immutability controls and at least one year of retention.

## Deployment Manifest

`PersistenceDeploymentManifest` raises the readiness check from individual backend descriptors to a deployment-level production gate. It requires production environment intent, exactly one external backend kind for graph, audit, and jobs, evidence references, and deployment controls for identity-provider-backed access, operator authorization, externalized secrets, backup/restore testing, change approval, monitoring, and migration review.

`assessPersistenceDeploymentReadiness` combines backend descriptor readiness with the deployment manifest checks. Local proof-point adapters remain blocked even when they implement the local contract because production readiness requires `external_graph`, `external_append_only_audit`, and `external_queue` backend kinds plus deployment control evidence.

`schemas/persistence-deployment-manifest.schema.json` and `deploy/persistence/production-manifest.example.json` make this gate reviewable outside TypeScript. `schemas/persistence-deployment-readiness.schema.json` and `deploy/persistence/readiness-report.example.json` retain the deterministic readiness report produced from that manifest. `pnpm validate:persistence-deployment` validates both schemas, checks that the retained report matches the core readiness assessment, checks that referenced IaC/release/backup/operator evidence exists, and proves a local proof-point manifest remains blocked from production readiness.

## Current Adapters

When the API runtime receives `REBAC_STATE_PATH`, `createLocalRuntimePersistence` wires the local JSON graph and job repositories beside the legacy runtime snapshot. Explicit subject, resource, relationship, decision, and provisioning operations write through those repositories and reload across restarts. Audit events stay in the append-only audit file or the compatibility state snapshot rather than being copied into graph or job state.

`InMemoryRebacPersistenceRepository` is a conformance adapter for tests and local proof points. It implements the graph and job repository contracts over the existing in-memory store, returns defensive copies, and advertises itself as non-durable memory storage. It is not a production database adapter.

`LocalJsonFileGraphRepository` is the first concrete graph adapter behind `RebacGraphRepository`. It persists only subjects, resources, relationship tuples, and native grants to a hash-checked JSON snapshot, reloads those graph facts across process starts, and leaves jobs, decisions, audit events, and evidence packages outside the graph file. It advertises `local_file` and `durable: false`, so production readiness remains blocked until an approved external graph backend is configured.

`LocalAppendOnlyAuditRepository` is the first concrete audit adapter behind `AuditEventRepository`. It appends audit events to JSONL records with stored event hashes, rejects duplicate event IDs, refuses out-of-order appends when `previousEventHash` does not match the current tail, and reports local record tampering through audit integrity findings. It advertises local retention and hash-chain capabilities, but it does not claim production durability, backup/restore, or WORM immutability.

`LocalJsonFileJobRepository` is the first concrete job adapter behind `RebacJobRepository`. It persists discovery runs, enforcement-readiness reports, provisioning plans, provisioning jobs, drift findings, reconciliation runs, and decision records to a hash-checked JSON snapshot. It supports idempotency-key lookups for plans and jobs, stable overwrite by record identifier, and atomic local snapshot replacement. It advertises queue/idempotency/transaction/backup proof-point capabilities, but it does not claim production durability.

`ProductionGraphStoreAdapter` is the production graph contract adapter. It is backed by an injected external snapshot store so a selected graph database or relational graph projection can supply the storage driver later without changing authorization semantics. The adapter stores only subjects, resources, relationship tuples, native grants, backup metadata, and a hash envelope. It advertises `external_graph`, rejects malformed or tampered stored payloads before serving data, rejects secret-bearing records, requires tenant-boundary attributes on persisted subjects and resources, and keeps backend-specific behavior out of authorization decisions.

`ProductionConnectorStateStoreAdapter` is the production connector-state contract adapter. It persists discovery runs, enforcement-readiness reports, provisioning plans, provisioning jobs, drift findings, reconciliation evidence, decisions, backup metadata, and a hash envelope through an injected external snapshot store. It intentionally describes itself as `external_connector_state`, not `external_queue`; durable queue execution remains the AK-036 boundary. The adapter exists so connector state can be stored behind the current runtime repository methods while the later job-runtime slice selects queue semantics.

`tests/core/repository-conformance.test.ts` runs the shared graph and connector-state repository conformance suite against the in-memory proof-point adapter, the local JSON adapters, and the production external adapters. Adapter-specific tamper, malformed payload, tenant-boundary, secret-material, descriptor, and backup/restore checks remain explicit production tests.

## Future Adapters

Production adapters should be added behind the same contracts:

- selected graph database or relational graph projection driver for subjects, resources, relationship tuples, and native grants
- WORM or immutable ledger-backed audit storage with production durability, retention, and backup/restore evidence
- selected connector-state storage driver for discovery, reconciliation, provisioning, decision recording, and evidence history
- durable queue/job storage for execution, retries, dead letters, and replay
- environment-specific backup, restore, retention, and migration evidence

No live provider write path should depend on local JSON snapshots, local JSONL audit files, or in-memory repositories. Local graph, audit, and job persistence are development and validation adapters, not production approval paths. The manifest evidence under `deploy/persistence/` is synthetic and must be replaced by deployment-specific IaC outputs and retained approval evidence before production use.
