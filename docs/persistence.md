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

## Current Adapters

`InMemoryRebacPersistenceRepository` is a conformance adapter for tests and local proof points. It implements the graph and job repository contracts over the existing in-memory store, returns defensive copies, and advertises itself as non-durable memory storage. It is not a production database adapter.

`LocalJsonFileGraphRepository` is the first concrete graph adapter behind `RebacGraphRepository`. It persists only subjects, resources, relationship tuples, and native grants to a hash-checked JSON snapshot, reloads those graph facts across process starts, and leaves jobs, decisions, audit events, and evidence packages outside the graph file. It advertises `local_file` and `durable: false`, so production readiness remains blocked until an approved external graph backend is configured.

`LocalAppendOnlyAuditRepository` is the first concrete audit adapter behind `AuditEventRepository`. It appends audit events to JSONL records with stored event hashes, rejects duplicate event IDs, refuses out-of-order appends when `previousEventHash` does not match the current tail, and reports local record tampering through audit integrity findings. It advertises local retention and hash-chain capabilities, but it does not claim production durability, backup/restore, or WORM immutability.

`LocalJsonFileJobRepository` is the first concrete job adapter behind `RebacJobRepository`. It persists discovery runs, enforcement-readiness reports, provisioning plans, provisioning jobs, drift findings, reconciliation runs, and decision records to a hash-checked JSON snapshot. It supports idempotency-key lookups for plans and jobs, stable overwrite by record identifier, and atomic local snapshot replacement. It advertises queue/idempotency/transaction/backup proof-point capabilities, but it does not claim production durability.

## Future Adapters

Production adapters should be added behind the same contracts:

- graph database or relational graph projection for subjects, resources, relationship tuples, and native grants
- WORM or immutable ledger-backed audit storage with production durability, retention, and backup/restore evidence
- durable queue/job storage for discovery, reconciliation, provisioning, decision recording, and evidence work
- environment-specific backup, restore, retention, and migration evidence

No live provider write path should depend on local JSON snapshots, local JSONL audit files, or in-memory repositories. Local graph, audit, and job persistence are development and validation adapters, not production approval paths.
