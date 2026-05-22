# Domain Model

## Core Objects

`Subject` represents a person, group, service account, service principal, managed identity, device, or workload. It must have a stable canonical ID, source system, lifecycle state, version, timestamps, and source identifiers.

`Resource` represents a governed object such as a workspace, application, SharePoint site, Team, folder, document, Power App, flow, Dataverse environment, AWS account, role, dataset, API, or record. Every governed resource must have an owner, data steward, technical owner, classification, lifecycle state, and source system.

`RelationshipTuple` is the durable business fact used by the policy engine. Examples include `member_of`, `owner_of`, `manager_of`, `steward_of`, `contributor_to`, `contains`, `approved_by`, `delegate_of`, and deny or quarantine relationships.

`DecisionResult` is the computed answer to whether a subject can perform an action on a resource under a policy version, relationship tuple version, and request context.

`IntendedGrant` is the desired access state created by policy and approvals.

`NativeGrant` is what a provider actually enforces, such as a SharePoint permission, M365 group membership, Dataverse role, AWS role assignment, or app role. It records whether the grant is direct, inherited, or group-derived; the principal type; optional inheritance source; optional expiration; and connector attributes. These fields support readback, drift analysis, and revocation planning without converting native access into intended access.

`DiscoveryRun` records a read-only connector inventory pass. It has connector ID, mode, status, start and completion times, object counts, warnings, cursor/high-watermark details, read-only evidence, and audit event references. It is evidence that provider readback happened without turning native grants into intended access.

`ProvisioningPlan` is the auditable plan that converts a decision or request into dry-run or enforcement actions. Decisions must not directly mutate providers.

`DriftFinding` records a difference between intended access and native access. It has severity, source connector, recommended action, status, and timestamps.

`AuditEvent` records decisions, policy changes, connector actions, provisioning changes, drift, admin actions, and evidence generation in an append-only stream.

`EvidenceExport` records metadata for ATO evidence packages by framework, controls, time period, source events, responsible role, and format.

## Separation Rules

- Relationship facts are not permissions.
- Decisions are not grants.
- Intended grants are not native grants.
- Discovery runs are not provisioning jobs.
- Provisioning plans are not provisioning jobs.
- Drift findings are security objects, not incidental errors.
- Audit evidence is not a mutable operational table.

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
