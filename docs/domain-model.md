# Domain Model

This page answers: what objects does Access Kit model, and which distinctions between them are load-bearing? JSON Schemas in `schemas/` are the portable contracts; `packages/core/src/domain.ts` mirrors them in TypeScript. Provider-specific fields stay in connector metadata unless they become portable contract fields.

## Core objects

**`Subject`** — a person, group, service account, service principal, managed identity, device, or workload, with a stable canonical ID, source system, lifecycle state, version, timestamps, and source identifiers.

**`Resource`** — a governed object (workspace, application, SharePoint site, Team, document, Power App, Dataverse environment, AWS account or role, dataset, API, record). Every governed resource has an owner, data steward, technical owner, classification, lifecycle state, and source system.

**`RelationshipTuple`** — the durable business fact the policy engine evaluates: `member_of`, `owner_of`, `manager_of`, `steward_of`, `contributor_to`, `contains`, `approved_by`, `delegate_of`, and deny or quarantine relationships.

**`DecisionResult`** — the computed answer to whether a subject can perform an action on a resource under pinned policy, model, relationship, tuple, context, and `asOf` versions. Carries traversal metrics and latency metadata so historical and large-graph decisions stay auditable. Its cache metadata (key, classification-bound TTL, invalidation signals, fail-closed fields) is a PEP contract; see [Decisions](decisions.md).

**`IntendedGrant`** — the desired access state created by policy and approvals.

**`NativeGrant`** — what a provider actually enforces (SharePoint permission, M365 group membership, Dataverse role, AWS role assignment, app role). Records whether the grant is direct, inherited, or group-derived, the principal type, optional expiration, and connector attributes — supporting readback, drift analysis, and revocation planning without converting native access into intended access.

**`DiscoveryRun`** — evidence of a read-only connector inventory pass: connector ID, mode, status, timing, object counts, warnings, cursors, read-only evidence, and audit references.

**`ProvisioningPlan`** — the auditable plan that converts a decision or request into dry-run or enforcement actions, with connector ID, idempotency keys, verification expectations, and compensation intent. Decisions never mutate providers directly.

**`EnforcementReadinessReport`** — precondition evidence for controlled enforcement: connector identity, provider boundary, guardrail controls, readiness checks, approver-role expectation, and change-ticket pattern. Currently only the synthetic `mock` connector can be marked ready.

**`ProvisioningJob`** — execution evidence for a plan. Dry-run jobs skip provider writes, run verification hooks, keep compensation planned, and return the same job on idempotent replay. Controlled enforcement jobs are synthetic-only: approval and guardrails required, mock connector only, readback verified, no live provider mutation.

**`DriftFinding`** — the security object created when reconciliation finds intended and observed native access disagree. Records severity, lifecycle state, owner, assignee, exception expiry, reconciliation evidence, ticket/SIEM hooks, remediation approval, dry-run repair evidence, and auto-repair policy controls. Auto-repair controls are evidence, not implicit permission to mutate providers.

**`AuditEvent`**, **`AuditIntegrityReport`**, **`AuditEventExport`** — the append-only event stream, its hash-chain verification result, and a bounded SIEM-ready JSONL export of a window of events. See [Audit Event Model](audit-event-model.md).

**`EvidenceExport`** — the ATO evidence package manifest: framework, controls, period, source events, audit integrity, control mappings and implementation statements, system boundary, data flows, access-review campaigns, exception requests, ConMon metrics, POA&M inputs, OSCAL fragments, signed package metadata, verifier checks, and SIEM export metadata. See [ATO Evidence Model](ato-evidence-model.md).

**Persistence and readiness objects** — `RebacGraphRepository`, `RebacJobRepository`, `ReferenceJobQueueAdapter`, and `AuditEventRepository` are the production-shaped storage boundaries; `PersistenceReadinessReport`, `PersistenceDeploymentManifest`, and `LiveEnforcementPilotManifest` record whether configured backends and gates meet production requirements. Local memory and file repositories are valid proof points but report as blocked for production readiness. See [Persistence](persistence.md) for the concrete local and PostgreSQL implementations.

## Separation rules

These distinctions are the security model in miniature:

- Relationship facts are not permissions. Decisions are not grants. Intended grants are not native grants.
- Discovery runs are not provisioning jobs. Readiness reports are not approvals. Plans are not jobs. Dry-run jobs are not provider writes.
- Controlled enforcement jobs require a matching ready readiness report and remain synthetic proof points. Pilot readiness reports are release gates, not provider credentials.
- Drift findings are security objects, not incidental errors.
- Audit evidence is append-only, not a mutable operational table. Local storage receipts are proof-point metadata, not production retention guarantees.
- Evidence exports are package manifests, not authorization decisions or provider writes.

## Canonical IDs and versioning

Canonical IDs use a typed prefix: `user:alice`, `group:case-team`, `workspace:case`, `document:case-plan`, `aws-role:analyst`, `evt:decision-001`. Source-specific IDs live under `identifiers` or connector metadata so duplicates can be resolved without changing public IDs.

Policy models, relationship tuple sets, resource classifications, connector configurations, provisioning plans, approval workflows, decision schemas, and evidence export schemas are all versioned. A historic decision must be reconstructable from subject, action, resource, policy version, relationship tuple version, context, and connector state.

## Worked example

`user:alice` is a `Subject`; `document:case-plan` is a `Resource`. Three tuples record that alice is `member_of group:case-team`, the group is `contributor_to workspace:case`, and the workspace `contains` the document. A `DecisionResult` allows alice to `read` the document through that path. A `ProvisioningPlan` can later plan the intended native state, a `NativeGrant` from discovery shows what the provider currently enforces, and a `DriftFinding` records any disagreement between the two.

## Related references

- [Glossary](glossary.md)
- [Decisions](decisions.md)
- [Provisioning Lifecycle](provisioning-lifecycle.md)
- [Drift Detection Model](drift-detection-model.md)
- `packages/core/src/domain.ts`, `schemas/*.schema.json`, `tests/fixtures/schema-examples/*.json`
- [ADR 0003: Relationship graph storage](../adrs/0003-relationship-graph-storage.md)
