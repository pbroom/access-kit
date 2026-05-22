import SwaggerParser from "@apidevtools/swagger-parser";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";

const root = process.cwd();
const openApiPath = join(root, "openapi/rebac-control-plane.yaml");

await SwaggerParser.validate(openApiPath);

const parsed = YAML.parse(await readFile(openApiPath, "utf8")) as {
  paths: Record<string, Record<string, unknown>>;
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
  ["/v1/audit/events", ["get"]],
  ["/v1/evidence/export", ["get"]],
  ["/v1/connectors", ["get"]],
  ["/v1/connectors/{id}/test", ["post"]],
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

console.log(`Validated OpenAPI contract at ${openApiPath}.`);
console.log(`PASS ${requiredOperations.size} required API path groups are present.`);
