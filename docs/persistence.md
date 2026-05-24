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

## Current Adapters

`InMemoryRebacPersistenceRepository` is a conformance adapter for tests and local proof points. It implements the graph and job repository contracts over the existing in-memory store, returns defensive copies, and advertises itself as non-durable memory storage. It is not a production database adapter.

`LocalJsonFileGraphRepository` is the first concrete graph adapter behind `RebacGraphRepository`. It persists only subjects, resources, relationship tuples, and native grants to a hash-checked JSON snapshot, reloads those graph facts across process starts, and leaves jobs, decisions, audit events, and evidence packages outside the graph file. It advertises `local_file` and `durable: false`, so production readiness remains blocked until an approved external graph backend is configured.

## Future Adapters

Production adapters should be added behind the same contracts:

- graph database or relational graph projection for subjects, resources, relationship tuples, and native grants
- WORM or immutable ledger-backed audit storage
- durable queue/job storage for discovery, reconciliation, provisioning, and evidence work
- environment-specific backup, restore, retention, and migration evidence

No live provider write path should depend on local JSON snapshots or in-memory repositories. Local JSON graph persistence is a development and validation adapter, not a production approval path.
