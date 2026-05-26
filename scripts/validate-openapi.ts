import SwaggerParser from "@apidevtools/swagger-parser";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import {
  apiContractSnapshot,
  generatedClientContractVersion,
  generatedClientOperations,
  type ApiContractOperationSnapshot
} from "../packages/api-contracts/src/index.js";

const root = process.cwd();
const openApiPath = join(root, "openapi/rebac-control-plane.yaml");

await SwaggerParser.validate(openApiPath);

const parsed = YAML.parse(await readFile(openApiPath, "utf8")) as {
  openapi: string;
  info: Record<string, unknown>;
  paths: Record<string, Record<string, unknown>>;
  components: {
    responses: Record<string, unknown>;
    schemas: Record<string, unknown>;
  };
  security?: unknown[];
};
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

const requiredOperations = new Map<string, string[]>([
  ["/v1/ready", ["get"]],
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
  ["/v1/audit/integrity", ["get"]],
  ["/v1/audit/export", ["get"]],
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

const decisionCheckExample = await readJsonFile("examples/api/decision-check.request.json");
const decisionCheckRequestSchema = getRequestSchema(parsed.paths["/v1/decision/check"]?.post, "/v1/decision/check");
assertValidExample(
  asRecord(resolveLocalSchemaRefs(decisionCheckRequestSchema, "/v1/decision/check request schema"), "/v1/decision/check request schema"),
  decisionCheckExample,
  "examples/api/decision-check.request.json"
);

const explainResponseSchemaRef = getResponseSchemaRef(parsed.paths["/v1/decision/explain"]?.post, "/v1/decision/explain", "200");
if (!referencesDecisionSchema(explainResponseSchemaRef)) {
  throw new Error(
    `OpenAPI /v1/decision/explain 200 response must reference schemas/decision.schema.json, found ${explainResponseSchemaRef}`
  );
}
const explainResponseSchema = asRecord(await readJsonFile("schemas/decision.schema.json"), "schemas/decision.schema.json");
const explainResponseExample = await readJsonFile("examples/api/explain.response.json");
assertValidExample(explainResponseSchema, explainResponseExample, "examples/api/explain.response.json");
const errorSchema = asRecord(parsed.components.schemas.Error, "Error schema");
const authFailureExample = await readJsonFile("examples/api/auth-failure.response.json");
assertValidExample(errorSchema, authFailureExample, "examples/api/auth-failure.response.json");

const openApiOperations = getOpenApiOperationSnapshot();
assertOperationSnapshot(apiContractSnapshot.operations, openApiOperations, "checked-in API contract snapshot");
assertOperationSnapshot(generatedClientOperations, openApiOperations, "generated TypeScript client operations");
assertContractMetadata();

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

const runtimeReadiness = asRecord(parsed.components.schemas.RuntimeReadiness, "RuntimeReadiness schema");
assertProperties(runtimeReadiness, ["status", "version", "checkedAt", "checks"], "RuntimeReadiness schema");
assertEnumIncludes(getProperty(runtimeReadiness, "status"), "ready_with_warnings", "RuntimeReadiness status");
assertResponseStatusNarrowing(
  getResponseSchema(parsed.paths["/v1/ready"]?.get, "/v1/ready", "200"),
  ["ready", "ready_with_warnings"],
  "/v1/ready 200 response"
);
assertResponseStatusNarrowing(
  getResponseSchema(parsed.paths["/v1/ready"]?.get, "/v1/ready", "503"),
  ["not_ready"],
  "/v1/ready 503 response"
);

console.log(`Validated OpenAPI contract at ${openApiPath}.`);
console.log(`PASS ${requiredOperations.size} required API path groups are present.`);
console.log("PASS Phase 4 controlled-enforcement readiness, request, and job fields are present.");
console.log("PASS Phase 5 readiness, audit integrity, audit export, and evidence export path groups are present.");
console.log("PASS API examples validate against OpenAPI request and response schemas.");
console.log("PASS API contract snapshot and generated TypeScript client metadata match OpenAPI.");
console.log("PASS API versioning, deprecation, authentication, and rate-limit metadata are present.");

function getRequestSchema(operation: unknown, label: string): Record<string, unknown> {
  const operationRecord = asRecord(operation, `${label} operation`);
  const requestBody = asRecord(operationRecord.requestBody, `${label} requestBody`);
  const content = asRecord(requestBody.content, `${label} request content`);
  const json = asRecord(content["application/json"], `${label} application/json content`);
  return asRecord(json.schema, `${label} request schema`);
}

function getResponseSchemaRef(operation: unknown, label: string, statusCode: string): string {
  const operationRecord = asRecord(operation, `${label} operation`);
  const responses = asRecord(operationRecord.responses, `${label} responses`);
  const response = asRecord(responses[statusCode], `${label} ${statusCode} response`);
  const content = asRecord(response.content, `${label} ${statusCode} response content`);
  const json = asRecord(content["application/json"], `${label} ${statusCode} application/json content`);
  const schema = asRecord(json.schema, `${label} ${statusCode} response schema`);
  const ref = schema.$ref;

  if (typeof ref !== "string") {
    throw new Error(`OpenAPI ${label} ${statusCode} response schema must be a $ref`);
  }

  return ref;
}

function getResponseSchema(operation: unknown, label: string, statusCode: string): Record<string, unknown> {
  const operationRecord = asRecord(operation, `${label} operation`);
  const responses = asRecord(operationRecord.responses, `${label} responses`);
  const response = asRecord(responses[statusCode], `${label} ${statusCode} response`);
  const content = asRecord(response.content, `${label} ${statusCode} response content`);
  const json = asRecord(content["application/json"], `${label} ${statusCode} application/json content`);
  return asRecord(json.schema, `${label} ${statusCode} response schema`);
}

async function readJsonFile(relativePath: string): Promise<unknown> {
  return JSON.parse(await readFile(join(root, relativePath), "utf8")) as unknown;
}

function assertValidExample(schema: Record<string, unknown>, example: unknown, label: string): void {
  const validate = ajv.compile(schema);

  if (!validate(example)) {
    throw new Error(`${label} failed OpenAPI schema validation: ${ajv.errorsText(validate.errors)}`);
  }
}

function referencesDecisionSchema(ref: string): boolean {
  return ref.replace(/\\/g, "/").toLowerCase().endsWith("schemas/decision.schema.json");
}

function resolveLocalSchemaRefs(value: unknown, label: string, seenRefs = new Set<string>()): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => resolveLocalSchemaRefs(item, label, seenRefs));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const schema = value as Record<string, unknown>;
  const ref = schema.$ref;

  if (ref === undefined) {
    return Object.fromEntries(
      Object.entries(schema).map(([key, entry]) => [key, resolveLocalSchemaRefs(entry, `${label}.${key}`, seenRefs)])
    );
  }

  if (typeof ref !== "string" || !ref.startsWith("#/components/schemas/")) {
    throw new Error(`OpenAPI ${label} has unsupported schema reference: ${String(ref)}`);
  }

  if (seenRefs.has(ref)) {
    throw new Error(`OpenAPI ${label} has circular schema reference: ${ref}`);
  }

  const schemaName = ref.slice("#/components/schemas/".length);
  const resolved = resolveLocalSchemaRefs(
    asRecord(parsed.components.schemas[schemaName], `${label} ${ref}`),
    `${label} ${ref}`,
    new Set([...seenRefs, ref])
  );
  const siblingEntries = Object.entries(schema).filter(([key]) => key !== "$ref");

  if (siblingEntries.length === 0) {
    return resolved;
  }

  return {
    ...asRecord(resolved, `${label} ${ref}`),
    ...Object.fromEntries(
      siblingEntries.map(([key, entry]) => [key, resolveLocalSchemaRefs(entry, `${label}.${key}`, seenRefs)])
    )
  };
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

function assertResponseStatusNarrowing(schema: Record<string, unknown>, expectedValues: string[], label: string): void {
  const allOf = schema.allOf;

  if (!Array.isArray(allOf)) {
    throw new Error(`OpenAPI ${label} must narrow RuntimeReadiness status with allOf`);
  }

  const statusSchema = allOf
    .map((entry, index) => asRecord(entry, `${label} allOf[${index}]`))
    .map((entry) => asOptionalRecord(entry.properties))
    .filter((properties): properties is Record<string, unknown> => Boolean(properties))
    .map((properties) => asOptionalRecord(properties.status))
    .find((status): status is Record<string, unknown> => Boolean(status));

  if (!statusSchema) {
    throw new Error(`OpenAPI ${label} must declare a narrowed status property`);
  }

  assertEnumExactly(statusSchema, expectedValues, `${label} status`);
}

function assertEnumExactly(schema: Record<string, unknown>, expectedValues: string[], label: string): void {
  const values = schema.enum;

  if (!Array.isArray(values) || values.length !== expectedValues.length || expectedValues.some((value) => !values.includes(value))) {
    throw new Error(`OpenAPI ${label} must have enum values: ${expectedValues.join(", ")}`);
  }
}

function getOpenApiOperationSnapshot(): ApiContractOperationSnapshot[] {
  return Object.entries(parsed.paths).flatMap(([path, pathItem]) =>
    ["get", "post", "put", "delete"].flatMap((method) => {
      const operation = pathItem[method];

      if (!operation) {
        return [];
      }

      const operationRecord = asRecord(operation, `${method.toUpperCase()} ${path}`);
      const operationId = operationRecord.operationId;

      if (typeof operationId !== "string" || operationId.length === 0) {
        throw new Error(`OpenAPI ${method.toUpperCase()} ${path} is missing operationId.`);
      }

      const auth = isPublicOperation(operationRecord) ? "public" : "bearer";

      if (auth === "public" && !["/v1/health", "/v1/ready"].includes(path)) {
        throw new Error(`OpenAPI ${method.toUpperCase()} ${path} cannot be public without an explicit review.`);
      }

      if (Boolean(operationRecord.deprecated) && typeof operationRecord["x-deprecation-note"] !== "string") {
        throw new Error(`OpenAPI deprecated operation ${operationId} must include x-deprecation-note.`);
      }

      return [
        {
          operationId,
          method: method.toUpperCase() as "DELETE" | "GET" | "POST" | "PUT",
          path,
          auth,
          idempotencyKey: hasIdempotencyKey(operationRecord),
          deprecated: Boolean(operationRecord.deprecated)
        }
      ];
    })
  );
}

function assertOperationSnapshot(
  actual: readonly unknown[],
  expected: readonly unknown[],
  label: string
): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);

  if (actualJson !== expectedJson) {
    throw new Error(`OpenAPI ${label} drifted from openapi/rebac-control-plane.yaml.`);
  }
}

function assertContractMetadata(): void {
  if (parsed.openapi !== apiContractSnapshot.openApiVersion) {
    throw new Error(`OpenAPI version ${parsed.openapi} does not match contract snapshot ${apiContractSnapshot.openApiVersion}.`);
  }

  if (parsed.info.version !== apiContractSnapshot.contractVersion) {
    throw new Error(`OpenAPI info.version ${String(parsed.info.version)} does not match contract snapshot ${apiContractSnapshot.contractVersion}.`);
  }

  if (parsed.info.version !== generatedClientContractVersion) {
    throw new Error(
      `OpenAPI info.version ${String(parsed.info.version)} does not match generated client ${generatedClientContractVersion}.`
    );
  }

  const versioning = asRecord(parsed.info["x-access-kit-versioning"], "OpenAPI versioning extension");
  const deprecationPolicy = versioning.deprecationPolicy;
  if (typeof deprecationPolicy !== "string" || !deprecationPolicy.includes("No operation is deprecated")) {
    throw new Error("OpenAPI must document versioning and deprecation policy.");
  }

  const rateLimits = asRecord(parsed.info["x-access-kit-rate-limits"], "OpenAPI rate-limit extension");
  if (
    rateLimits.authenticationFailureAuditSamplingWindowSeconds !==
      apiContractSnapshot.rateLimitPolicy.authenticationFailureAuditSamplingWindowSeconds ||
    rateLimits.retryAfterHeader !== apiContractSnapshot.rateLimitPolicy.retryAfterHeader
  ) {
    throw new Error("OpenAPI rate-limit metadata must match the API contract snapshot.");
  }

  const rateLimited = asRecord(parsed.components.responses.RateLimited, "RateLimited response");
  const headers = asRecord(rateLimited.headers, "RateLimited response headers");
  if (!headers[apiContractSnapshot.rateLimitPolicy.retryAfterHeader]) {
    throw new Error("OpenAPI RateLimited response must document Retry-After.");
  }
}

function isPublicOperation(operation: Record<string, unknown>): boolean {
  const security = operation.security ?? parsed.security;
  return Array.isArray(security) && security.length === 0;
}

function hasIdempotencyKey(operation: Record<string, unknown>): boolean {
  const parameters = operation.parameters;

  if (!Array.isArray(parameters)) {
    return false;
  }

  return parameters.some((parameter) => {
    const record = asRecord(parameter, "OpenAPI operation parameter");
    return record.$ref === "#/components/parameters/IdempotencyKey" || record.name === "Idempotency-Key";
  });
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`OpenAPI ${label} is not an object`);
  }

  return value as Record<string, unknown>;
}

function asOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
