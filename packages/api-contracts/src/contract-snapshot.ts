export type ApiContractAuth = "bearer" | "public";
export type ApiContractMethod = "DELETE" | "GET" | "POST" | "PUT";

export interface ApiContractOperationSnapshot {
  readonly operationId: string;
  readonly method: ApiContractMethod;
  readonly path: string;
  readonly auth: ApiContractAuth;
  readonly idempotencyKey: boolean;
  readonly deprecated: boolean;
}

export interface ApiContractSnapshot {
  readonly contractVersion: string;
  readonly openApiVersion: string;
  readonly source: string;
  readonly generatedClient: {
    readonly language: "typescript";
    readonly artifact: string;
  };
  readonly rateLimitPolicy: {
    readonly authenticationFailureAuditSamplingWindowSeconds: number;
    readonly retryAfterHeader: "Retry-After";
  };
  readonly operations: readonly ApiContractOperationSnapshot[];
}

export const apiContractSnapshot = {
  contractVersion: "0.1.0",
  openApiVersion: "3.1.0",
  source: "openapi/rebac-control-plane.yaml",
  generatedClient: {
    language: "typescript",
    artifact: "packages/api-contracts/src/generated-client.ts"
  },
  rateLimitPolicy: {
    authenticationFailureAuditSamplingWindowSeconds: 60,
    retryAfterHeader: "Retry-After"
  },
  operations: [
    { operationId: "getHealth", method: "GET", path: "/v1/health", auth: "public", idempotencyKey: false, deprecated: false },
    { operationId: "getReadiness", method: "GET", path: "/v1/ready", auth: "public", idempotencyKey: false, deprecated: false },
    { operationId: "checkDecision", method: "POST", path: "/v1/decision/check", auth: "bearer", idempotencyKey: false, deprecated: false },
    { operationId: "explainDecision", method: "POST", path: "/v1/decision/explain", auth: "bearer", idempotencyKey: false, deprecated: false },
    { operationId: "batchCheckDecision", method: "POST", path: "/v1/decision/batch-check", auth: "bearer", idempotencyKey: false, deprecated: false },
    { operationId: "listSubjects", method: "GET", path: "/v1/subjects", auth: "bearer", idempotencyKey: false, deprecated: false },
    { operationId: "createSubject", method: "POST", path: "/v1/subjects", auth: "bearer", idempotencyKey: true, deprecated: false },
    { operationId: "getSubject", method: "GET", path: "/v1/subjects/{id}", auth: "bearer", idempotencyKey: false, deprecated: false },
    { operationId: "getSubjectAccess", method: "GET", path: "/v1/subjects/{id}/access", auth: "bearer", idempotencyKey: false, deprecated: false },
    { operationId: "listResources", method: "GET", path: "/v1/resources", auth: "bearer", idempotencyKey: false, deprecated: false },
    { operationId: "createResource", method: "POST", path: "/v1/resources", auth: "bearer", idempotencyKey: true, deprecated: false },
    { operationId: "getResource", method: "GET", path: "/v1/resources/{id}", auth: "bearer", idempotencyKey: false, deprecated: false },
    { operationId: "getResourceAccess", method: "GET", path: "/v1/resources/{id}/access", auth: "bearer", idempotencyKey: false, deprecated: false },
    { operationId: "getResourceNativeAccess", method: "GET", path: "/v1/resources/{id}/native-access", auth: "bearer", idempotencyKey: false, deprecated: false },
    { operationId: "queryRelationships", method: "GET", path: "/v1/relationships", auth: "bearer", idempotencyKey: false, deprecated: false },
    { operationId: "putRelationship", method: "PUT", path: "/v1/relationships", auth: "bearer", idempotencyKey: true, deprecated: false },
    { operationId: "deleteRelationship", method: "DELETE", path: "/v1/relationships", auth: "bearer", idempotencyKey: true, deprecated: false },
    { operationId: "listPolicies", method: "GET", path: "/v1/policies", auth: "bearer", idempotencyKey: false, deprecated: false },
    { operationId: "createPolicy", method: "POST", path: "/v1/policies", auth: "bearer", idempotencyKey: true, deprecated: false },
    { operationId: "validatePolicy", method: "POST", path: "/v1/policies/{id}/validate", auth: "bearer", idempotencyKey: false, deprecated: false },
    { operationId: "publishPolicy", method: "POST", path: "/v1/policies/{id}/publish", auth: "bearer", idempotencyKey: true, deprecated: false },
    { operationId: "rollbackPolicy", method: "POST", path: "/v1/policies/{id}/rollback", auth: "bearer", idempotencyKey: true, deprecated: false },
    { operationId: "createProvisioningPlan", method: "POST", path: "/v1/provisioning/plans", auth: "bearer", idempotencyKey: true, deprecated: false },
    { operationId: "createProvisioningJob", method: "POST", path: "/v1/provisioning/jobs", auth: "bearer", idempotencyKey: true, deprecated: false },
    { operationId: "getProvisioningJob", method: "GET", path: "/v1/provisioning/jobs/{id}", auth: "bearer", idempotencyKey: false, deprecated: false },
    { operationId: "runReconciliation", method: "POST", path: "/v1/reconciliation/run", auth: "bearer", idempotencyKey: true, deprecated: false },
    { operationId: "listDriftFindings", method: "GET", path: "/v1/reconciliation/findings", auth: "bearer", idempotencyKey: false, deprecated: false },
    { operationId: "planDriftRemediation", method: "POST", path: "/v1/reconciliation/findings/{id}/remediation", auth: "bearer", idempotencyKey: true, deprecated: false },
    { operationId: "searchAuditEvents", method: "GET", path: "/v1/audit/events", auth: "bearer", idempotencyKey: false, deprecated: false },
    { operationId: "verifyAuditIntegrity", method: "GET", path: "/v1/audit/integrity", auth: "bearer", idempotencyKey: false, deprecated: false },
    { operationId: "exportAuditEvents", method: "GET", path: "/v1/audit/export", auth: "bearer", idempotencyKey: false, deprecated: false },
    { operationId: "exportEvidence", method: "GET", path: "/v1/evidence/export", auth: "bearer", idempotencyKey: false, deprecated: false },
    { operationId: "verifyEvidencePackage", method: "POST", path: "/v1/evidence/verify", auth: "bearer", idempotencyKey: true, deprecated: false },
    { operationId: "listConnectors", method: "GET", path: "/v1/connectors", auth: "bearer", idempotencyKey: false, deprecated: false },
    { operationId: "testConnector", method: "POST", path: "/v1/connectors/{id}/test", auth: "bearer", idempotencyKey: false, deprecated: false },
    { operationId: "listConnectorEnforcementReadiness", method: "GET", path: "/v1/connectors/{id}/enforcement-readiness", auth: "bearer", idempotencyKey: false, deprecated: false },
    { operationId: "checkConnectorEnforcementReadiness", method: "POST", path: "/v1/connectors/{id}/enforcement-readiness", auth: "bearer", idempotencyKey: false, deprecated: false },
    { operationId: "syncConnector", method: "POST", path: "/v1/connectors/{id}/sync", auth: "bearer", idempotencyKey: true, deprecated: false },
    { operationId: "listDiscoveryRuns", method: "GET", path: "/v1/discovery/runs", auth: "bearer", idempotencyKey: false, deprecated: false }
  ]
} as const satisfies ApiContractSnapshot;
