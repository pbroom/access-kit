# Generated API Reference

<!-- This file is generated from openapi/rebac-control-plane.yaml. Run `pnpm generate:api-reference` to refresh it. -->

Contract version: 0.1.0

OpenAPI version: 3.1.0

Source: `openapi/rebac-control-plane.yaml`

Contract snapshot client: `packages/api-contracts/src/contract-client.ts`

## API Behavior

- All routes except `/v1/health` and `/v1/ready` require bearer authentication.
- Operations marked with `Idempotency-Key: required` fail closed when the header is missing.
- `429` responses must honor `Retry-After`; clients must not fall back to local authorization decisions.
- Error payloads use stable machine-readable codes and correlation IDs when available.

## Versioning And Deprecation

No operation is deprecated in 0.1.0. Future deprecations must keep the operation in OpenAPI and generated clients with a migration note until the next major contract.

## Example Artifacts

- Decision check request: [`examples/api/decision-check.request.json`](../examples/api/decision-check.request.json)
- Explain response: [`examples/api/explain.response.json`](../examples/api/explain.response.json)
- Authentication failure response: [`examples/api/auth-failure.response.json`](../examples/api/auth-failure.response.json)

## Operations

### Health

#### `GET /v1/health`

Operation ID: `getHealth`

Summary: Return local API health and version.

Authentication: public

Idempotency-Key: not required

Deprecated: no

Responses:

- `200`: API health. Schema: `object`

#### `GET /v1/ready`

Operation ID: `getReadiness`

Summary: Return deployment readiness checks for the local API runtime.

Authentication: public

Idempotency-Key: not required

Deprecated: no

Responses:

- `200`: API runtime is ready, possibly with non-blocking warnings. Schema: `allOf`
- `503`: API runtime is not ready. Schema: `allOf`

### Decision

#### `POST /v1/decision/check`

Operation ID: `checkDecision`

Summary: Run a fast allow or deny authorization decision.

Authentication: bearer token required

Idempotency-Key: not required

Deprecated: no

Request body: `#/components/schemas/DecisionRequest`

Responses:

- `200`: Decision result. Schema: `../schemas/decision.schema.json`
- `400`: Invalid request. Schema: `#/components/schemas/Error`

#### `POST /v1/decision/explain`

Operation ID: `explainDecision`

Summary: Run a decision and return relationship path, versions, and reason code.

Authentication: bearer token required

Idempotency-Key: not required

Deprecated: no

Request body: `#/components/schemas/DecisionRequest`

Responses:

- `200`: Explainable decision result. Schema: `../schemas/decision.schema.json`

#### `POST /v1/decision/batch-check`

Operation ID: `batchCheckDecision`

Summary: Evaluate several decision requests.

Authentication: bearer token required

Idempotency-Key: not required

Deprecated: no

Request body: `object`

Responses:

- `200`: Batch decision results. Schema: `object`

### Subjects

#### `GET /v1/subjects`

Operation ID: `listSubjects`

Summary: List canonical subjects.

Authentication: bearer token required

Idempotency-Key: not required

Deprecated: no

Parameters:

- `pageToken` (query): `string`
- `pageSize` (query): `integer`

Responses:

- `200`: Subject page. Schema: `object`

#### `POST /v1/subjects`

Operation ID: `createSubject`

Summary: Create or import a canonical subject.

Authentication: bearer token required

Idempotency-Key: required

Deprecated: no

Parameters:

- `Idempotency-Key` (header, required): `string`

Request body: `../schemas/subject.schema.json`

Responses:

- `201`: Created subject. Schema: `../schemas/subject.schema.json`

#### `GET /v1/subjects/{id}`

Operation ID: `getSubject`

Summary: Get a canonical subject.

Authentication: bearer token required

Idempotency-Key: not required

Deprecated: no

Parameters:

- `id` (path, required): `string`

Responses:

- `200`: Subject. Schema: `../schemas/subject.schema.json`
- `404`: Object was not found. Schema: `#/components/schemas/Error`

#### `GET /v1/subjects/{id}/access`

Operation ID: `getSubjectAccess`

Summary: Explain current access for a subject.

Authentication: bearer token required

Idempotency-Key: not required

Deprecated: no

Parameters:

- `id` (path, required): `string`

Responses:

- `200`: Subject access decisions. Schema: `#/components/schemas/AccessView`

### Resources

#### `GET /v1/resources`

Operation ID: `listResources`

Summary: List canonical resources.

Authentication: bearer token required

Idempotency-Key: not required

Deprecated: no

Parameters:

- `pageToken` (query): `string`
- `pageSize` (query): `integer`

Responses:

- `200`: Resource page. Schema: `object`

#### `POST /v1/resources`

Operation ID: `createResource`

Summary: Create or import a canonical resource.

Authentication: bearer token required

Idempotency-Key: required

Deprecated: no

Parameters:

- `Idempotency-Key` (header, required): `string`

Request body: `../schemas/resource.schema.json`

Responses:

- `201`: Created resource. Schema: `../schemas/resource.schema.json`

#### `GET /v1/resources/{id}`

Operation ID: `getResource`

Summary: Get a canonical resource.

Authentication: bearer token required

Idempotency-Key: not required

Deprecated: no

Parameters:

- `id` (path, required): `string`

Responses:

- `200`: Resource. Schema: `../schemas/resource.schema.json`

#### `GET /v1/resources/{id}/access`

Operation ID: `getResourceAccess`

Summary: Explain who can access a resource and why.

Authentication: bearer token required

Idempotency-Key: not required

Deprecated: no

Parameters:

- `id` (path, required): `string`

Responses:

- `200`: Resource access decisions. Schema: `#/components/schemas/AccessView`

#### `GET /v1/resources/{id}/native-access`

Operation ID: `getResourceNativeAccess`

Summary: Inspect observed native grants discovered for a resource.

Authentication: bearer token required

Idempotency-Key: not required

Deprecated: no

Parameters:

- `id` (path, required): `string`
- `connectorId` (query): `string`
- `subjectId` (query): `string`
- `nativePermission` (query): `string`
- `grantType` (query): `string`
- `principalType` (query): `string`

Responses:

- `200`: Observed native access readback. Schema: `#/components/schemas/NativeAccessView`

### Relationships

#### `GET /v1/relationships`

Operation ID: `queryRelationships`

Summary: Query relationship tuples.

Authentication: bearer token required

Idempotency-Key: not required

Deprecated: no

Parameters:

- `subjectId` (query): `string`
- `objectId` (query): `string`
- `relation` (query): `string`

Responses:

- `200`: Relationship tuples. Schema: `object`

#### `PUT /v1/relationships`

Operation ID: `putRelationship`

Summary: Idempotently create or replace a relationship tuple.

Authentication: bearer token required

Idempotency-Key: required

Deprecated: no

Parameters:

- `Idempotency-Key` (header, required): `string`

Request body: `../schemas/relationship.schema.json`

Responses:

- `200`: Relationship tuple. Schema: `../schemas/relationship.schema.json`

#### `DELETE /v1/relationships`

Operation ID: `deleteRelationship`

Summary: Idempotently delete a relationship tuple.

Authentication: bearer token required

Idempotency-Key: required

Deprecated: no

Parameters:

- `Idempotency-Key` (header, required): `string`
- `relationshipId` (query, required): `string`

Responses:

- `204`: Relationship tuple deleted.

### Policies

#### `GET /v1/policies`

Operation ID: `listPolicies`

Summary: List policy models and versions.

Authentication: bearer token required

Idempotency-Key: not required

Deprecated: no

Responses:

- `200`: Policy versions. Schema: `object`

#### `POST /v1/policies`

Operation ID: `createPolicy`

Summary: Create a draft policy model.

Authentication: bearer token required

Idempotency-Key: required

Deprecated: no

Parameters:

- `Idempotency-Key` (header, required): `string`

Request body: `#/components/schemas/PolicyDraft`

Responses:

- `201`: Policy summary. Schema: `#/components/schemas/PolicySummary`

#### `POST /v1/policies/{id}/validate`

Operation ID: `validatePolicy`

Summary: Validate policy syntax and mandatory tests.

Authentication: bearer token required

Idempotency-Key: not required

Deprecated: no

Parameters:

- `id` (path, required): `string`

Responses:

- `200`: Policy validation result. Schema: `#/components/schemas/ValidationResult`

#### `POST /v1/policies/{id}/publish`

Operation ID: `publishPolicy`

Summary: Publish an approved policy model.

Authentication: bearer token required

Idempotency-Key: required

Deprecated: no

Parameters:

- `id` (path, required): `string`
- `Idempotency-Key` (header, required): `string`

Request body: `object`

Responses:

- `200`: Published policy. Schema: `#/components/schemas/PolicySummary`

#### `POST /v1/policies/{id}/rollback`

Operation ID: `rollbackPolicy`

Summary: Roll back to a prior policy version.

Authentication: bearer token required

Idempotency-Key: required

Deprecated: no

Parameters:

- `id` (path, required): `string`
- `Idempotency-Key` (header, required): `string`

Request body: `object`

Responses:

- `200`: Rolled-back policy. Schema: `#/components/schemas/PolicySummary`

### Provisioning

#### `POST /v1/provisioning/plans`

Operation ID: `createProvisioningPlan`

Summary: Create a dry-run or controlled synthetic enforcement provisioning plan.

Authentication: bearer token required

Idempotency-Key: required

Deprecated: no

Parameters:

- `Idempotency-Key` (header, required): `string`

Request body: `object`

Responses:

- `201`: Provisioning plan. Schema: `../schemas/provisioning-plan.schema.json`

#### `POST /v1/provisioning/jobs`

Operation ID: `createProvisioningJob`

Summary: Run a dry-run or controlled synthetic enforcement provisioning job for a plan.

Authentication: bearer token required

Idempotency-Key: required

Deprecated: no

Parameters:

- `Idempotency-Key` (header, required): `string`

Request body: `object`

Responses:

- `202`: Provisioning job accepted. Schema: `#/components/schemas/ProvisioningJob`

#### `GET /v1/provisioning/jobs/{id}`

Operation ID: `getProvisioningJob`

Summary: Get provisioning job status.

Authentication: bearer token required

Idempotency-Key: not required

Deprecated: no

Parameters:

- `id` (path, required): `string`

Responses:

- `200`: Provisioning job. Schema: `#/components/schemas/ProvisioningJob`

### Reconciliation

#### `POST /v1/reconciliation/run`

Operation ID: `runReconciliation`

Summary: Run connector reconciliation and drift detection.

Authentication: bearer token required

Idempotency-Key: required

Deprecated: no

Parameters:

- `Idempotency-Key` (header, required): `string`

Request body: `object`

Responses:

- `202`: Reconciliation run accepted. Schema: `#/components/schemas/ReconciliationRun`

#### `GET /v1/reconciliation/findings`

Operation ID: `listDriftFindings`

Summary: List drift findings.

Authentication: bearer token required

Idempotency-Key: not required

Deprecated: no

Parameters:

- `severity` (query): `string`
- `status` (query): `string`
- `lifecycleState` (query): `string`
- `ownerId` (query): `string`
- `assigneeId` (query): `string`

Responses:

- `200`: Drift findings. Schema: `object`

#### `POST /v1/reconciliation/findings/{id}/remediation`

Operation ID: `planDriftRemediation`

Summary: Plan approved dry-run remediation for a drift finding.

Authentication: bearer token required

Idempotency-Key: required

Deprecated: no

Parameters:

- `id` (path, required): `string`
- `Idempotency-Key` (header, required): `string`

Request body: `object`

Responses:

- `202`: Drift finding updated with dry-run remediation evidence. Schema: `../schemas/drift-finding.schema.json`

### Audit

#### `GET /v1/audit/events`

Operation ID: `searchAuditEvents`

Summary: Search append-only audit events.

Authentication: bearer token required

Idempotency-Key: not required

Deprecated: no

Parameters:

- `subjectId` (query): `string`
- `resourceId` (query): `string`
- `from` (query): `string`
- `to` (query): `string`

Responses:

- `200`: Audit events. Schema: `object`

#### `GET /v1/audit/integrity`

Operation ID: `verifyAuditIntegrity`

Summary: Verify append-only audit hash-chain integrity.

Authentication: bearer token required

Idempotency-Key: not required

Deprecated: no

Responses:

- `200`: Audit integrity report. Schema: `../schemas/audit-integrity.schema.json`

#### `GET /v1/audit/export`

Operation ID: `exportAuditEvents`

Summary: Export SIEM-ready audit events as JSONL records.

Authentication: bearer token required

Idempotency-Key: not required

Deprecated: no

Parameters:

- `from` (query): `string`
- `to` (query): `string`
- `target` (query): `string`

Responses:

- `200`: SIEM-ready audit event export. Schema: `../schemas/audit-export.schema.json`

### Evidence

#### `GET /v1/evidence/export`

Operation ID: `exportEvidence`

Summary: Export ATO evidence for controls and time period.

Authentication: bearer token required

Idempotency-Key: not required

Deprecated: no

Parameters:

- `framework` (query): `string`
- `controls` (query): `string`
- `from` (query): `string`
- `to` (query): `string`
- `format` (query): `string`

Responses:

- `200`: Evidence export metadata. Schema: `../schemas/evidence-export.schema.json`

#### `POST /v1/evidence/verify`

Operation ID: `verifyEvidencePackage`

Summary: Verify a signed evidence package.

Authentication: bearer token required

Idempotency-Key: required

Deprecated: no

Parameters:

- `Idempotency-Key` (header, required): `string`

Request body: `../schemas/evidence-export.schema.json`

Responses:

- `200`: Evidence verification report. Schema: `object`

### Connectors

#### `GET /v1/connectors`

Operation ID: `listConnectors`

Summary: List connector registrations and capabilities.

Authentication: bearer token required

Idempotency-Key: not required

Deprecated: no

Responses:

- `200`: Connector list. Schema: `object`

#### `POST /v1/connectors/{id}/test`

Operation ID: `testConnector`

Summary: Test connector health and least-privilege permissions.

Authentication: bearer token required

Idempotency-Key: not required

Deprecated: no

Parameters:

- `id` (path, required): `string`

Responses:

- `200`: Connector validation result. Schema: `#/components/schemas/ValidationResult`

#### `GET /v1/connectors/{id}/enforcement-readiness`

Operation ID: `listConnectorEnforcementReadiness`

Summary: List connector enforcement readiness reports.

Authentication: bearer token required

Idempotency-Key: not required

Deprecated: no

Parameters:

- `id` (path, required): `string`
- `status` (query): `string`

Responses:

- `200`: Connector enforcement readiness report list. Schema: `object`

#### `POST /v1/connectors/{id}/enforcement-readiness`

Operation ID: `checkConnectorEnforcementReadiness`

Summary: Check controlled-enforcement readiness for a connector.

Authentication: bearer token required

Idempotency-Key: not required

Deprecated: no

Parameters:

- `id` (path, required): `string`

Request body: `object`

Responses:

- `200`: Connector enforcement readiness report. Schema: `#/components/schemas/EnforcementReadinessReport`

#### `POST /v1/connectors/{id}/sync`

Operation ID: `syncConnector`

Summary: Run read-only connector discovery and current-access readback.

Authentication: bearer token required

Idempotency-Key: required

Deprecated: no

Parameters:

- `id` (path, required): `string`
- `Idempotency-Key` (header, required): `string`

Request body: `object`

Responses:

- `202`: Connector discovery completed. Schema: `#/components/schemas/DiscoveryRun`

### Discovery

#### `GET /v1/discovery/runs`

Operation ID: `listDiscoveryRuns`

Summary: List read-only discovery runs.

Authentication: bearer token required

Idempotency-Key: not required

Deprecated: no

Parameters:

- `connectorId` (query): `string`
- `status` (query): `string`

Responses:

- `200`: Discovery run list. Schema: `object`

## CI Validation

`pnpm validate:api-reference` regenerates this file from OpenAPI and fails when it drifts.

