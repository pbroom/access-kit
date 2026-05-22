# Domain Model

## Core Objects

`Subject` represents a person, group, service account, service principal, managed identity, device, or workload. It must have a stable canonical ID, source system, lifecycle state, version, timestamps, and source identifiers.

`Resource` represents a governed object such as a workspace, application, SharePoint site, Team, folder, document, Power App, flow, Dataverse environment, AWS account, role, dataset, API, or record. Every governed resource must have an owner, data steward, technical owner, classification, lifecycle state, and source system.

`RelationshipTuple` is the durable business fact used by the policy engine. Examples include `member_of`, `owner_of`, `manager_of`, `steward_of`, `contributor_to`, `contains`, `approved_by`, `delegate_of`, and deny or quarantine relationships.

`DecisionResult` is the computed answer to whether a subject can perform an action on a resource under a policy version, relationship tuple version, and request context.

`IntendedGrant` is the desired access state created by policy and approvals.

`NativeGrant` is what a provider actually enforces, such as a SharePoint permission, M365 group membership, Dataverse role, AWS role assignment, or app role. It records whether the grant is direct, inherited, or group-derived; the principal type; optional inheritance source; optional expiration; and connector attributes. These fields support readback, drift analysis, and revocation planning without converting native access into intended access.

`DiscoveryRun` records a read-only connector inventory pass. It has connector ID, mode, status, start and completion times, object counts, warnings, cursor/high-watermark details, read-only evidence, and audit event references. It is evidence that provider readback happened without turning native grants into intended access.

`ProvisioningPlan` is the auditable plan that converts a decision or request into dry-run or enforcement actions. It records connector ID, action idempotency keys, verification expectations, and compensation intent. Decisions must not directly mutate providers.

`EnforcementReadinessReport` is the precondition evidence for controlled enforcement. It records connector identity, provider boundary, requested guardrail controls, readiness status, readiness checks, approver-role expectation, change-ticket pattern, and audit event references. In Phase 4 it can mark only the synthetic `mock` connector as ready; synthetic Entra ID, SharePoint, and AWS-style connectors remain blocked because live write review is incomplete.

`ProvisioningJob` records execution evidence for a plan. Dry-run jobs skip provider writes, run verification hooks, keep compensation planned, and return the same job on idempotent replay. Controlled enforcement jobs are synthetic-only in Phase 4: they require approval and guardrail controls, apply only through the mock connector, verify readback, and emit permission-change evidence without live provider mutation.

`DriftFinding` records a difference between intended access and native access. It has severity, source connector, recommended action, status, and timestamps.

`AuditEvent` records decisions, policy changes, connector actions, provisioning changes, drift, admin actions, and evidence generation in an append-only stream.

`AuditIntegrityReport` verifies the append-only audit event chain. It records event count, first and last event identifiers, first and last event hashes, findings, status, and version.

`AuditEventExport` records a bounded SIEM-ready export of append-only audit events. It includes the export ID, period, JSONL records, source event IDs, payload-hash inclusion, target, exported event count for the requested window, full-chain audit-integrity report, and version.

`AuditStorageReceipt` and `EvidenceStorageReceipt` record where local proof-point evidence was persisted, the hash of the stored event or package, backend type, storage time, and whether the backend claims immutability. Local file-backed receipts expose repository-relative locations, not host filesystem paths, and set `immutable: false`; production WORM storage remains future work.

`EvidenceExport` records metadata for ATO evidence packages by framework, controls, time period, source events, responsible role, format, audit integrity, control mappings, generated artifacts, continuous-monitoring metrics, POA&M inputs, and SIEM export metadata.

## Separation Rules

- Relationship facts are not permissions.
- Decisions are not grants.
- Intended grants are not native grants.
- Discovery runs are not provisioning jobs.
- Enforcement readiness reports are not approvals and are not provisioning plans.
- Provisioning plans are not provisioning jobs.
- Dry-run provisioning jobs are not provider writes.
- Controlled enforcement jobs in this milestone require a matching ready enforcement-readiness report and remain synthetic proof points, not live provider writes.
- Drift findings are security objects, not incidental errors.
- Audit evidence is not a mutable operational table.
- Audit exports are bounded event packages, not SIEM delivery guarantees.
- Evidence exports are package manifests, not authorization decisions or provider writes.
- Local storage receipts are proof-point metadata, not production retention guarantees.

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
