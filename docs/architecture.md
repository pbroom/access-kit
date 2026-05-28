# ReBAC Control Plane Architecture

## Purpose

Access Kit is a governed authorization control plane for relationship-based access control. It coordinates identity sources, resource inventories, relationship facts, policy decisions, provisioning plans, drift findings, audit events, and ATO evidence. It does not authenticate users and it does not replace native enforcement in Entra ID, Active Directory, AWS, SharePoint, Teams, Power Platform, or application-specific authorization layers.

The first milestone established contracts and validation evidence. Phase 1 added a local in-memory runtime for the core engine, mock connector, API handlers, and CLI-over-API flow. Phase 2 makes read-only discovery explicit: connector sync returns a discovery run, stores observed native grants separately from relationship tuples, exposes connector checks and discovery history, and lets operators inspect discovered native access. Phase 3 adds local dry-run provisioning jobs with verification hooks, idempotent replay, skipped-write evidence, and compensation records. Phase 4 starts controlled enforcement as a synthetic-only mock connector path with explicit readiness evidence, approval, guardrail controls, verification, rollback evidence hooks, and live provider writes blocked. Phase 5 completes the local ATO hardening proof point with audit hash-chain verification, SIEM-ready audit event exports, system boundary and data-flow evidence, control statements, access-review and exception evidence, ConMon metrics, POA&M inputs and export, OSCAL fragments, signed package metadata, verifier checks, control-to-event traces, operational evidence, SIEM export metadata, and local file-backed audit/evidence repository proof points. The current productionization slices add restartable local runtime snapshots, a `rebac-api` service entrypoint, optional bearer-token API guarding, a runtime readiness probe, a container image, a release workflow for signatures and provenance, reference Kubernetes manifests for probe wiring and admission-policy checks, persistent storage contracts for graph, audit, and job backends, a local JSON graph adapter, a local append-only audit adapter, a local JSON job adapter, production graph and connector-state adapters, a durable queue/job adapter, a production audit/evidence adapter boundary with signed windows and SIEM delivery/replay metadata, schema-backed production persistence manifest evidence checks, retained persistence-readiness report artifacts, production persistence readiness gates before database and identity-provider selection, HA/degraded-mode operating criteria for queue backpressure, audit-forwarder outage, read-only fallback, health signals, and recovery, and a schema-backed controlled live enforcement pilot gate for one Microsoft Graph direct-grant revocation candidate. Synthetic Entra ID, SharePoint, and AWS-style adapters prove provider boundaries without credentials. Environment-specific audit ledgers, SIEM deployments, provider credentials, Microsoft/AWS enforcement execution, and dashboards remain later phases.

## Layered Shape

1. Domain model: canonical subjects, resources, relationship tuples, decisions, grants, native grants, provisioning actions, drift findings, audit events, and evidence exports.
2. Policy Decision Point: deterministic `check`, `explain`, and `batch-check` decisions.
3. Policy Information Point: normalized identity, resource, relationship, classification, and context data.
4. Policy Administration Point: policy validation, approval, publishing, rollback, and mandatory policy tests.
5. Provisioning Orchestrator: plan, dry-run, apply, verify, revoke, repair, and rollback flows.
6. Connector adapters: provider-specific discovery, current-access readback, provisioning, reconciliation, and evidence emission behind a typed interface.
7. Audit and evidence plane: append-only event model, hash-chain integrity reports, SIEM-ready JSONL exports, validation evidence, control mapping, system boundary and data-flow evidence, access reviews, exception register, operational evidence, ConMon metrics, POA&M inputs and export, OSCAL fragments, signed package metadata, verifier checks, control trace views, SIEM metadata, and export contracts.
8. CLI: operator, CI/CD, and assessor surface that wraps API contracts.

## Data Flow

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

## Milestone Boundaries

- The OpenAPI file is the public API source of truth.
- JSON Schemas define portable object contracts.
- TypeScript types mirror those schemas for implementation ergonomics.
- The CLI command list maps operator commands to API operations.
- The mock connector proves the adapter boundary without credentials or production mutation.
- The local API runtime makes the OpenAPI-shaped surface executable with in-memory storage.
- Optional local JSON state snapshots and local graph/job repository files make the local API runtime restartable for synthetic proof points.
- The `rebac-api` service entrypoint reads host, port, actor, API keys, state path, and evidence repository settings from environment variables.
- Optional bearer-token guarding protects API routes except public health/readiness probes and audits failed attempts without token material.
- The `/v1/ready` probe reports runtime graph/job/state, audit/evidence repository wiring, auth-guard configuration, and registered connector adapters without returning secrets.
- The deployable API container builds the API workspace dependency closure, runs as a non-root Node 22 runtime, exposes port `3000`, and stores local proof-point state under `/var/lib/access-kit`.
- The release packaging workflow publishes only on `rebac-api-v*` tags or explicit manual dispatch, records SBOM/provenance metadata, pushes GitHub artifact attestations, and signs published digests with keyless cosign.
- The reference Kubernetes manifests wire startup, liveness, and readiness probes to the public health endpoints, keep bearer-token material in a secret reference, mount local state under `/var/lib/access-kit`, restrict pod runtime privileges, and provide a signed-image admission policy example for release digests.
- The production reference architecture maps the API, graph store, connector-state store, queue, audit/evidence store, SIEM, IdP or mTLS gateway, secrets manager, observability, backup, RTO/RPO, and Kubernetes overlay evidence that a target environment must fill before production traffic.
- Persistent storage contracts split graph facts, append-only audit evidence, connector-state history, and durable queue/job records so database, ledger, and queue adapters can be assessed independently before live connector writes.
- The live enforcement pilot gate requires read-only confidence, least-privilege write-scope review, two-role approval, degraded-runtime blocking, dry-run-first verification, rollback hooks, emergency revocation runbooks, and retained release approval before the first provider write candidate can advance.
- The CLI wraps the API and does not contain authorization logic.
- Read-only connector sync records a `DiscoveryRun` and observed `NativeGrant` objects.
- Discovery runs capture warnings, cursors, read-only evidence, and connector capability metadata.
- Synthetic provider adapters cover Entra ID, SharePoint, and AWS-style readback shapes without real tenant IDs, secrets, users, or resources.
- Resource native-access inspection reads observed provider grants without treating them as intended access.
- Provisioning jobs default to dry-run: they skip provider writes, run verification hooks, record compensation intent, and emit audit evidence.
- Controlled enforcement is limited to the synthetic mock connector and requires a ready connector report, approval, a change ticket, synthetic-only controls, incident-mode clearance, verification, and audit evidence.
- Audit exports provide SIEM-ready JSONL records for a bounded audit event window and emit their own audit evidence; the production audit adapter can retain signed windows plus SIEM delivery and replay receipts for those exports.
- ATO evidence exports include source events, audit integrity status, control mappings, control statements, system boundary, data flows, access reviews, exception register, operational evidence, ConMon metrics, POA&M inputs and export, OSCAL component-definition, SSP, assessment-results and POA&M fragments, signed package metadata, verifier checks, control-to-event trace views, artifact metadata, SIEM export metadata, and optional storage receipts when a repository is configured.
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

1. Environment-specific graph and audit drivers behind the production adapter contracts plus deployment packaging.
2. Live read-only Entra ID, SharePoint, and AWS discovery using the existing discovery-run and native-grant contracts.
3. Environment-specific queue driver and managed worker deployment behind the durable queue adapter.
4. Controlled enforcement with one Microsoft and one AWS write path after connector security review.
5. Production hardening: deployable services, approved SIEM forwarding, live connector security review, and production ATO evidence retention.
