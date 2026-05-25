import SwaggerParser from "@apidevtools/swagger-parser";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { apiContractSnapshot, type ApiContractOperationSnapshot } from "../packages/api-contracts/src/index.js";

const root = process.cwd();
const openApiPath = join(root, "openapi/rebac-control-plane.yaml");
const referencePath = join(root, "docs", "api-reference.md");
const checkOnly = process.argv.includes("--check");

await SwaggerParser.validate(openApiPath);

const openApi = YAML.parse(await readFile(openApiPath, "utf8")) as OpenApiDocument;
const generated = renderApiReference(openApi, apiContractSnapshot.operations);

if (checkOnly) {
  const current = await readCurrentReference();

  if (current !== generated) {
    throw new Error("docs/api-reference.md is stale. Run `pnpm generate:api-reference`.");
  }

  console.log("Generated API reference is current.");
} else {
  await writeFile(referencePath, generated, "utf8");
  console.log(`Wrote ${referencePath}`);
}

function renderApiReference(
  document: OpenApiDocument,
  operations: readonly ApiContractOperationSnapshot[]
): string {
  const grouped = new Map<string, ApiReferenceOperation[]>();

  for (const snapshot of operations) {
    const operation = readOperation(document, snapshot);
    const tag = operation.tags?.[0] ?? "untagged";
    const entries = grouped.get(tag) ?? [];
    entries.push({ snapshot, operation });
    grouped.set(tag, entries);
  }

  const lines = [
    "# Generated API Reference",
    "",
    "<!-- This file is generated from openapi/rebac-control-plane.yaml. Run `pnpm generate:api-reference` to refresh it. -->",
    "",
    `Contract version: ${String(document.info.version)}`,
    "",
    `OpenAPI version: ${String(document.openapi)}`,
    "",
    "Source: `openapi/rebac-control-plane.yaml`",
    "",
    "Generated client: `packages/api-contracts/src/generated-client.ts`",
    "",
    "## API Behavior",
    "",
    "- All routes except `/v1/health` and `/v1/ready` require bearer authentication.",
    "- Operations marked with `Idempotency-Key: required` fail closed when the header is missing.",
    "- `429` responses must honor `Retry-After`; clients must not fall back to local authorization decisions.",
    "- Error payloads use stable machine-readable codes and correlation IDs when available.",
    "",
    "## Versioning And Deprecation",
    "",
    String(asRecord(document.info["x-access-kit-versioning"], "OpenAPI versioning extension").deprecationPolicy).trim(),
    "",
    "## Example Artifacts",
    "",
    "- Decision check request: [`examples/api/decision-check.request.json`](../examples/api/decision-check.request.json)",
    "- Explain response: [`examples/api/explain.response.json`](../examples/api/explain.response.json)",
    "- Authentication failure response: [`examples/api/auth-failure.response.json`](../examples/api/auth-failure.response.json)",
    "",
    "## Operations",
    ""
  ];

  for (const [tag, entries] of grouped) {
    lines.push(`### ${titleCase(tag)}`, "");

    for (const { snapshot, operation } of entries) {
      lines.push(`#### \`${snapshot.method} ${snapshot.path}\``, "");
      lines.push(`Operation ID: \`${snapshot.operationId}\``, "");
      lines.push(`Summary: ${operation.summary ?? "No summary."}`, "");
      lines.push(`Authentication: ${snapshot.auth === "public" ? "public" : "bearer token required"}`, "");
      lines.push(`Idempotency-Key: ${snapshot.idempotencyKey ? "required" : "not required"}`, "");
      lines.push(`Deprecated: ${snapshot.deprecated ? "yes" : "no"}`, "");

      const parameters = operation.parameters ?? [];
      if (parameters.length > 0) {
        lines.push("Parameters:", "");
        for (const parameter of parameters) {
          const resolved = resolveParameter(document, parameter);
          lines.push(
            `- \`${resolved.name}\` (${resolved.in}${resolved.required ? ", required" : ""}): ${schemaLabel(resolved.schema)}`
          );
        }
        lines.push("");
      }

      const requestSchema = requestBodySchema(operation);
      if (requestSchema) {
        lines.push(`Request body: ${schemaLabel(requestSchema)}`, "");
      }

      lines.push("Responses:", "");
      for (const [status, response] of Object.entries(operation.responses)) {
        const resolved = resolveResponse(document, response);
        lines.push(`- \`${status}\`: ${resolved.description ?? "No description."}${responseSchemaLabel(resolved)}`);
      }
      lines.push("");
    }
  }

  lines.push("## CI Validation", "");
  lines.push("`pnpm validate:api-reference` regenerates this file from OpenAPI and fails when it drifts.", "");

  return `${lines.join("\n")}\n`;
}

function readOperation(
  document: OpenApiDocument,
  snapshot: ApiContractOperationSnapshot
): OpenApiOperation {
  const pathItem = asRecord(document.paths[snapshot.path], `OpenAPI path ${snapshot.path}`);
  const operation = asRecord(pathItem[snapshot.method.toLowerCase()], `${snapshot.method} ${snapshot.path}`);
  asRecord(operation.responses, `${snapshot.method} ${snapshot.path} responses`);

  return operation as unknown as OpenApiOperation;
}

function resolveParameter(document: OpenApiDocument, parameter: unknown): OpenApiParameter {
  return resolveRef(document, parameter) as OpenApiParameter;
}

function resolveResponse(document: OpenApiDocument, response: unknown): OpenApiResponse {
  return resolveRef(document, response) as OpenApiResponse;
}

function resolveRef(document: OpenApiDocument, value: unknown): unknown {
  const record = asRecord(value, "OpenAPI reference value");
  const ref = record.$ref;

  if (typeof ref !== "string") {
    return record;
  }

  if (!ref.startsWith("#/")) {
    return { description: ref };
  }

  let current: unknown = document;

  for (const segment of ref.slice(2).split("/")) {
    current = asRecord(current, ref)[decodeJsonPointerSegment(segment)];
  }

  return current;
}

async function readCurrentReference(): Promise<string> {
  try {
    return await readFile(referencePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      console.error("docs/api-reference.md is missing. Run `pnpm generate:api-reference`.");
      process.exit(1);
    }

    throw error;
  }
}

function requestBodySchema(operation: OpenApiOperation): unknown | undefined {
  const requestBody = operation.requestBody;

  if (!requestBody) {
    return undefined;
  }

  const content = asRecord(asRecord(requestBody, "requestBody").content, "requestBody content");
  return firstContentSchema(content);
}

function responseSchemaLabel(response: OpenApiResponse): string {
  const content = response.content;

  if (!content) {
    return "";
  }

  return ` Schema: ${schemaLabel(firstContentSchema(content))}`;
}

function firstContentSchema(content: Record<string, unknown>): unknown | undefined {
  const json = asOptionalRecord(content["application/json"]);

  if (json) {
    return json.schema;
  }

  return Object.values(content)
    .map((value) => asOptionalRecord(value))
    .find((value): value is Record<string, unknown> => Boolean(value))?.schema;
}

function schemaLabel(schema: unknown): string {
  if (!schema || typeof schema !== "object") {
    return "`unknown`";
  }

  const record = schema as Record<string, unknown>;

  if (typeof record.$ref === "string") {
    return `\`${record.$ref}\``;
  }

  if (typeof record.type === "string") {
    return `\`${record.type}\``;
  }

  if (Array.isArray(record.allOf)) {
    return "`allOf`";
  }

  return "`inline schema`";
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }

  return value as Record<string, unknown>;
}

function asOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error !== null && typeof error === "object" && "code" in error;
}

function decodeJsonPointerSegment(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

function titleCase(value: string): string {
  return value.replace(/(^|-)([a-z])/g, (_, prefix: string, letter: string) => `${prefix ? " " : ""}${letter.toUpperCase()}`);
}

interface ApiReferenceOperation {
  snapshot: ApiContractOperationSnapshot;
  operation: OpenApiOperation;
}

interface OpenApiDocument {
  openapi: string;
  info: {
    "x-access-kit-versioning"?: unknown;
    version: string;
  };
  paths: Record<string, Record<string, unknown>>;
}

interface OpenApiOperation {
  tags?: string[];
  summary?: string;
  parameters?: unknown[];
  requestBody?: unknown;
  responses: Record<string, unknown>;
}

interface OpenApiParameter {
  name: string;
  in: string;
  required?: boolean;
  schema?: unknown;
}

interface OpenApiResponse {
  description?: string;
  content?: Record<string, unknown>;
}
