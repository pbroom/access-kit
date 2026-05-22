import SwaggerParser from "@apidevtools/swagger-parser";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";

const root = process.cwd();
const openApiPath = join(root, "openapi/rebac-control-plane.yaml");

await SwaggerParser.validate(openApiPath);

const parsed = YAML.parse(await readFile(openApiPath, "utf8")) as {
  paths: Record<string, Record<string, unknown>>;
  components: {
    schemas: Record<string, unknown>;
  };
};

const requiredOperations = new Map<string, string[]>([
  ["/v1/decision/check", ["post"]],
  ["/v1/decision/explain", ["post"]],
  ["/v1/decision/batch-check", ["post"]],
  ["/v1/subjects", ["get", "post"]],
  ["/v1/subjects/{id}/access", ["get"]],
  ["/v1/resources", ["get", "post"]],
  ["/v1/resources/{id}/access", ["get"]],
  ["/v1/resources/{id}/native-access", ["get"]],
  ["/v1/relationships", ["get", "put", "delete"]],
  ["/v1/policies", ["get", "post"]],
  ["/v1/policies/{id}/validate", ["post"]],
  ["/v1/policies/{id}/publish", ["post"]],
  ["/v1/policies/{id}/rollback", ["post"]],
  ["/v1/provisioning/plans", ["post"]],
  ["/v1/provisioning/jobs", ["post"]],
  ["/v1/provisioning/jobs/{id}", ["get"]],
  ["/v1/reconciliation/run", ["post"]],
  ["/v1/reconciliation/findings", ["get"]],
  ["/v1/discovery/runs", ["get"]],
  ["/v1/audit/events", ["get"]],
  ["/v1/evidence/export", ["get"]],
  ["/v1/connectors", ["get"]],
  ["/v1/connectors/{id}/test", ["post"]],
  ["/v1/connectors/{id}/enforcement-readiness", ["get", "post"]],
  ["/v1/connectors/{id}/sync", ["post"]]
]);

for (const [path, methods] of requiredOperations) {
  const pathItem = parsed.paths[path];

  if (!pathItem) {
    throw new Error(`OpenAPI contract is missing required path: ${path}`);
  }

  for (const method of methods) {
    if (!pathItem[method]) {
      throw new Error(`OpenAPI contract is missing required operation: ${method.toUpperCase()} ${path}`);
    }
  }
}

const planRequestSchema = getRequestSchema(parsed.paths["/v1/provisioning/plans"]?.post, "/v1/provisioning/plans");
assertProperties(planRequestSchema, ["mode", "dryRun", "approval", "control", "readinessReportId"], "provisioning plan request");
assertEnumIncludes(getProperty(planRequestSchema, "mode"), "enforcement", "provisioning plan request mode");

const readinessRequestSchema = getRequestSchema(
  parsed.paths["/v1/connectors/{id}/enforcement-readiness"]?.post,
  "/v1/connectors/{id}/enforcement-readiness"
);
assertProperties(readinessRequestSchema, ["mode", "control", "requiredApproverRole", "changeTicketPattern"], "enforcement readiness request");

const jobRequestSchema = getRequestSchema(parsed.paths["/v1/provisioning/jobs"]?.post, "/v1/provisioning/jobs");
assertProperties(jobRequestSchema, ["mode", "dryRun", "approval", "control"], "provisioning job request");
assertEnumIncludes(getProperty(jobRequestSchema, "mode"), "enforcement", "provisioning job request mode");

const provisioningJob = asRecord(parsed.components.schemas.ProvisioningJob, "ProvisioningJob schema");
assertEnumIncludes(getProperty(provisioningJob, "mode"), "enforcement", "ProvisioningJob mode");
assertProperties(provisioningJob, ["approval", "control"], "ProvisioningJob schema");
const actionResults = getProperty(provisioningJob, "actionResults");
const actionItems = asRecord(asRecord(actionResults, "ProvisioningJob.actionResults").items, "ProvisioningJob.actionResults.items");
assertEnumIncludes(getProperty(actionItems, "status"), "applied", "ProvisioningJob action result status");

for (const schemaName of ["ProvisioningApproval", "EnforcementControl", "EnforcementReadinessReport"]) {
  if (!parsed.components.schemas[schemaName]) {
    throw new Error(`OpenAPI contract is missing required component schema: ${schemaName}`);
  }
}

console.log(`Validated OpenAPI contract at ${openApiPath}.`);
console.log(`PASS ${requiredOperations.size} required API path groups are present.`);
console.log("PASS Phase 4 controlled-enforcement readiness, request, and job fields are present.");

function getRequestSchema(operation: unknown, label: string): Record<string, unknown> {
  const operationRecord = asRecord(operation, `${label} operation`);
  const requestBody = asRecord(operationRecord.requestBody, `${label} requestBody`);
  const content = asRecord(requestBody.content, `${label} request content`);
  const json = asRecord(content["application/json"], `${label} application/json content`);
  return asRecord(json.schema, `${label} request schema`);
}

function assertProperties(schema: Record<string, unknown>, properties: string[], label: string): void {
  const declared = asRecord(schema.properties, `${label} properties`);

  for (const property of properties) {
    if (!declared[property]) {
      throw new Error(`OpenAPI ${label} is missing property: ${property}`);
    }
  }
}

function getProperty(schema: Record<string, unknown>, property: string): Record<string, unknown> {
  const properties = asRecord(schema.properties, "schema properties");
  return asRecord(properties[property], `property ${property}`);
}

function assertEnumIncludes(schema: Record<string, unknown>, value: string, label: string): void {
  const values = schema.enum;

  if (!Array.isArray(values) || !values.includes(value)) {
    throw new Error(`OpenAPI ${label} must include enum value: ${value}`);
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`OpenAPI ${label} is not an object`);
  }

  return value as Record<string, unknown>;
}
