# Domain Model

## Purpose

This page is the canonical narrative description of Access Kit domain objects and source-of-truth boundaries.

## Audience

Application developers, platform engineers, security engineers, ISSOs, assessors, and resource owners.

## What This Is

The domain model defines the objects used to make, explain, provision, reconcile, audit, and evidence authorization decisions. JSON Schemas in `schemas/` are the portable object contracts. TypeScript interfaces in `packages/core/src/domain.ts` mirror those concepts for implementation.

## What This Is Not

The domain model is not an identity directory, provider permission model, SIEM schema, ticketing workflow, or live tenant inventory. Provider-specific fields remain connector metadata unless they become portable contract fields.

## Core Objects

`Subject` represents a person, group, service account, service principal, managed identity, device, or workload. It must have a stable canonical ID, source system, lifecycle state, version, timestamps, and source identifiers.

`Resource` represents a governed object such as a workspace, application, SharePoint site, Team, folder, document, Power App, flow, Dataverse environment, AWS account, role, dataset, API, or record. Every governed resource must have an owner, data steward, technical owner, classification, lifecycle state, and source system.

`RelationshipTuple` is the durable business fact used by the policy engine. Examples include `member_of`, `owner_of`, `manager_of`, `steward_of`, `contributor_to`, `contains`, `approved_by`, `delegate_of`, and deny or quarantine relationships.

`DecisionResult` is the computed answer to whether a subject can perform an action on a resource under pinned policy, model, relationship, tuple, context, and `asOf` versions plus request context. The result carries traversal metrics and latency SLO metadata so historical and large-graph decisions remain auditable and regression-testable.

`IntendedGrant` is the desired access state created by policy and approvals.

`NativeGrant` is what a provider actually enforces, such as a SharePoint permission, M365 group membership, Dataverse role, AWS role assignment, or app role. It records whether the grant is direct, inherited, or group-derived; the principal type; optional inheritance source; optional expiration; and connector attributes. These fields support readback, drift analysis, and revocation planning without converting native access into intended access.

`DriftFinding` is the operational security object created when reconciliation finds a mismatch between intended and observed native access. It records severity, lifecycle state, owner, assignee, exception expiry, scheduled reconciliation evidence, ticket/SIEM hook evidence, remediation approval, dry-run repair evidence, and auto-repair policy controls. Auto-repair controls are explicit evidence, not implicit permission to mutate providers; local proof-point findings keep live provider writes disabled.

`DiscoveryRun` records a read-only connector inventory pass. It has connector ID, mode, status, start and completion times, object counts, warnings, cursor/high-watermark details, read-only evidence, and audit event references. It is evidence that provider readback happened without turning native grants into intended access.

`ProvisioningPlan` is the auditable plan that converts a decision or request into dry-run or enforcement actions. It records connector ID, action idempotency keys, verification expectations, and compensation intent. Decisions must not directly mutate providers.

`EnforcementReadinessReport` is the precondition evidence for controlled enforcement. It records connector identity, provider boundary, requested guardrail controls, readiness status, readiness checks, approver-role expectation, change-ticket pattern, and audit event references. In Phase 4 it can mark only the synthetic `mock` connector as ready; synthetic Entra ID, SharePoint, and AWS-style connectors remain blocked because live write review is incomplete.

`ProvisioningJob` records execution evidence for a plan. Dry-run jobs skip provider writes, run verification hooks, keep compensation planned, and return the same job on idempotent replay. Controlled enforcement jobs are synthetic-only in Phase 4: they require approval and guardrail controls, apply only through the mock connector, verify readback, and emit permission-change evidence without live provider mutation.

`DriftFinding` records a difference between intended access and native access. It has severity, source connector, recommended action, status, and timestamps.

`AuditEvent` records decisions, policy changes, connector actions, provisioning changes, drift, admin actions, and evidence generation in an append-only stream.

`AuditIntegrityReport` verifies the append-only audit event chain. It records event count, first and last event identifiers, first and last event hashes, findings, status, and version.

`AuditEventExport` records a bounded SIEM-ready export of append-only audit events. It includes the export ID, period, JSONL records, source event IDs, payload-hash inclusion, target, exported event count for the requested window, full-chain audit-integrity report, and version.

`AuditStorageReceipt` and `EvidenceStorageReceipt` record where evidence was persisted, the hash of the stored event or package, backend type, storage time, and whether the backend claims immutability. Local file-backed receipts expose repository-relative locations, not host filesystem paths, and set `immutable: false`; the production audit/evidence adapter returns external immutable receipts while still requiring an environment-specific WORM or immutable-ledger driver before production use.

`LocalJsonFileGraphRepository` persists subjects, resources, relationship tuples, and native grants as a hash-checked local graph snapshot for development and validation. It deliberately excludes provisioning jobs, decisions, audit events, and evidence packages.

`LocalAppendOnlyAuditRepository` persists audit events as append-only JSONL records with stored event hashes and previous-event hash checks. It is a local integrity proof point, not a production WORM audit store.

`ReferenceAuditEvidenceAdapter` defines the reference audit and evidence boundary. It stores ordered immutable audit records, retention policy metadata, signed audit windows, SIEM delivery and replay records, tamper-evident evidence package receipts, backup/restore metadata, and integrity findings for delivery failures or tampered envelopes. It rejects unredacted secret-bearing payloads instead of silently storing them.

`LocalJsonFileJobRepository` persists discovery runs, enforcement-readiness reports, provisioning plans, provisioning jobs, drift findings, access-review campaigns, governance findings, exception requests, reconciliation runs, and decision records as a hash-checked local job snapshot. It is a local queue/job proof point, not a production worker queue.

`ReferenceJobQueueAdapter` defines the reference queue/job boundary for discovery, reconciliation, provisioning, evidence, and revocation work. It keeps durable idempotency records with payload hashes, connector health, retry/backoff state, dead-letter records, replay metadata, emergency revocation priority, backup/restore metadata, and a hash envelope. The optional API worker drains queued records through the same runtime functions as the synchronous API so approval, readiness, audit, and persistence behavior remain centralized.

`RebacStateRepository` records restartable synthetic runtime state snapshots for subjects, resources, relationships, native grants, discovery runs, readiness reports, provisioning plans and jobs, reconciliation runs, decisions, drift findings, access-review campaigns, governance findings, exception requests, and audit events. The local JSON implementation is a deployment-packaging proof point, not a production graph database or queue. Runtime state readers accept the current hash-checked envelope and explicitly named legacy state-array migrations; malformed or unknown persisted fields fail closed.

`RebacGraphRepository`, `RebacJobRepository`, `ReferenceJobQueueAdapter`, and `AuditEventRepository` are the production-shaped persistence boundaries. Graph storage owns canonical subjects, resources, relationship tuples, and observed native grants. Job storage owns discovery, readiness, provisioning, drift, access-review, exception, remediation, reconciliation, and decision records. Queue storage owns operational enqueue, reservation, retry, dead-letter, replay, and connector-health state. Audit storage owns the append-only event stream and integrity checks. Production readiness requires durable graph writes, append-only immutable audit retention, idempotent durable queue storage, transactional behavior where needed, and backup/restore evidence.

`PersistenceReadinessReport` records whether configured graph, audit, and job backends meet the required production capabilities. Local memory and local file repositories are valid proof points but must report as blocked for production readiness.

`PersistenceDeploymentManifest` records the production persistence target, backend descriptors, deployment control evidence, and evidence references. `PersistenceDeploymentReadinessReport` combines backend readiness with deployment controls so local proof-point storage cannot be represented as production-ready persistence.

`LiveEnforcementPilotManifest` records the first controlled live write candidate and its release gates. It limits the candidate to one opt-in provider revocation path, captures read-only confidence, least-privilege write-scope review, two-role approval, degraded connector and audit blocking, verification, rollback hooks, emergency revocation runbooks, and retained evidence references. `LiveEnforcementPilotReadinessReport` is the deterministic readiness result for that manifest. Synthetic pilot-candidate artifacts are not provider credentials and do not enable live writes by themselves.

`EvidenceExport` records metadata for ATO evidence packages by framework, controls, time period, source events, responsible role, format, audit integrity, integrity manifest hashes, control mappings, control implementation statements, generated artifacts, system boundary, data flows, durable access-review campaigns, exception requests with risk acceptance and expiry, continuous-monitoring metrics, POA&M inputs and export, OSCAL component-definition, SSP, assessment-results and POA&M fragments, signed package metadata, verifier checks, control-to-event trace views, operational evidence, and SIEM export metadata.

## Separation Rules

- Relationship facts are not permissions.
- Decisions are not grants.
- Intended grants are not native grants.
- Discovery runs are not provisioning jobs.
- Enforcement readiness reports are not approvals and are not provisioning plans.
- Provisioning plans are not provisioning jobs.
- Dry-run provisioning jobs are not provider writes.
- Controlled enforcement jobs in this milestone require a matching ready enforcement-readiness report and remain synthetic proof points, not live provider writes.
- Live enforcement pilot readiness reports are release gates, not provider credentials or blanket write authorization.
- Drift findings are security objects, not incidental errors.
- Audit evidence is not a mutable operational table.
- Audit exports are bounded event packages. SIEM delivery guarantees require production adapter delivery receipts plus an approved environment-specific forwarder.
- Evidence exports are package manifests, not authorization decisions or provider writes.
- Operational evidence entries are local proof points, not production runbook approvals.
- Local storage receipts are proof-point metadata, not production retention guarantees. External immutable receipts require the production audit/evidence adapter and deployment-specific storage evidence.

## Canonical IDs

Canonical IDs use a typed prefix such as `user:alice`, `group:case-team`, `workspace:case`, `document:case-plan`, `aws-role:analyst`, or `evt:decision-001`. Source-specific IDs live under `identifiers` or connector metadata so duplicate identities and resources can be resolved without changing public IDs.

## Versioning

These objects must be versioned:

- policy models
- relationship tuple sets
- resource classifications
- connector configurations
- provisioning plans
- approval workflows
- decision schemas
- evidence export schemas

A historic decision must be reconstructable from subject, action, resource, policy version, relationship tuple version, context, and connector state.

Decision cache metadata records the cache key, classification-bound TTL, expiration time, invalidation signals, fail-closed behavior, and audit fields emitted with a decision. It is a PEP contract only; it does not authorize local fallback behavior or permit cached decisions to outlive policy, tuple, context, tenant, or classification changes.

## Concrete Example

`user:alice` is a `Subject`. `document:case-plan` is a `Resource`. `relationship:alice-case-team` records that `user:alice member_of group:case-team`. `relationship:case-team-workspace` records that the group is a contributor to `workspace:case`. `relationship:workspace-document` records that the workspace contains the document.

A `DecisionResult` can allow `user:alice` to `read` the document through that path. A later `ProvisioningPlan` can plan the intended native state. A `NativeGrant` from discovery can show what the provider currently enforces. A `DriftFinding` records disagreement between intended and native state.

## Security Considerations

- Keep relationship facts separate from native permissions.
- Keep intended grants separate from observed provider grants.
- Use stable canonical IDs and keep source-specific identifiers in metadata.
- Treat lifecycle state, expiration, suspension, quarantine, legal hold, and explicit deny relationships as authorization inputs.
- Do not store secrets, access tokens, production emails, or live tenant IDs in examples, fixtures, audit payloads, or evidence.

## Audit And Evidence Implications

Audit events should reference canonical subject IDs, resource IDs, policy versions, relationship versions, reason codes, correlation IDs, and source event IDs. Evidence exports should include domain objects only when needed for control inspection and should preserve the distinction between decisions, intended state, native state, drift, and evidence.

Runtime state snapshots also retain `PersistenceDegradationReceipt` entries for local proof-point write failures when a state repository is configured. These receipts are not a substitute for atomic production transactions, but they prevent graph, job, audit, or state write failures from disappearing after a restart.

## Related Controls

AC, AU, CM, CA, IA, and PT controls depend on stable object identity, versioning, minimization, and traceability.

## Related References

- [Glossary](glossary.md)
- [Decision Lifecycle](decision-lifecycle.md)
- [Provisioning Lifecycle](provisioning-lifecycle.md)
- [Drift Detection Model](drift-detection-model.md)
- `packages/core/src/domain.ts`
- `schemas/*.schema.json`
- `tests/fixtures/schema-examples/*.json`
- [ADR 0003: Relationship graph storage](../adrs/0003-relationship-graph-storage.md)
