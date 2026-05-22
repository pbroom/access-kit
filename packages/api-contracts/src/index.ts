export const openApiSpecPath = "openapi/rebac-control-plane.yaml";

export const schemaManifest = [
  "schemas/subject.schema.json",
  "schemas/resource.schema.json",
  "schemas/relationship.schema.json",
  "schemas/decision.schema.json",
  "schemas/provisioning-plan.schema.json",
  "schemas/audit-event.schema.json",
  "schemas/drift-finding.schema.json",
  "schemas/evidence-export.schema.json"
] as const;
