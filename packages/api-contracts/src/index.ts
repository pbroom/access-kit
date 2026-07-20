export const openApiSpecPath = "openapi/rebac-control-plane.yaml";

export * from "./contract-snapshot.js";
export * from "./contract-client.js";

export const schemaManifest = [
  "schemas/subject.schema.json",
  "schemas/resource.schema.json",
  "schemas/relationship.schema.json",
  "schemas/decision.schema.json",
  "schemas/native-grant.schema.json",
  "schemas/discovery-run.schema.json",
  "schemas/connector-security-review.schema.json",
  "schemas/enforcement-readiness.schema.json",
  "schemas/policy-model.schema.json",
  "schemas/provisioning-plan.schema.json",
  "schemas/audit-event.schema.json",
  "schemas/audit-export.schema.json",
  "schemas/drift-finding.schema.json",
  "schemas/audit-integrity.schema.json",
  "schemas/persistence-deployment-manifest.schema.json",
  "schemas/persistence-deployment-readiness.schema.json",
  "schemas/runbook-exercise.schema.json",
  "schemas/live-enforcement-pilot-manifest.schema.json",
  "schemas/live-enforcement-pilot-readiness.schema.json",
  "schemas/product-release-manifest.schema.json",
  "schemas/evidence-export.schema.json"
] as const;
