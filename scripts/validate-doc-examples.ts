import SwaggerParser from "@apidevtools/swagger-parser";
import Ajv2020 from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";
import addFormats from "ajv-formats";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { readJsonFile } from "./lib/files.js";

const root = process.cwd();
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

const controlEvidenceMappingSchema = {
  type: "object",
  additionalProperties: false,
  required: ["controlId", "family", "status", "implementationSummary", "evidenceTypes", "sourceEventIds", "sourceArtifacts", "gaps"],
  properties: {
    controlId: { type: "string", pattern: "^[A-Z]{2}-[0-9]+(?:\\([0-9]+\\))?$" },
    family: { type: "string", pattern: "^[A-Z]{2}$" },
    status: { type: "string", enum: ["implemented", "partially_implemented", "planned"] },
    implementationSummary: { type: "string", minLength: 1 },
    evidenceTypes: {
      type: "array",
      minItems: 1,
      items: { type: "string", minLength: 1 }
    },
    sourceEventIds: {
      type: "array",
      items: { type: "string", pattern: "^[a-z0-9_:-]+$" }
    },
    sourceArtifacts: {
      type: "array",
      minItems: 1,
      items: { type: "string", minLength: 1 }
    },
    gaps: {
      type: "array",
      items: { type: "string", minLength: 1 }
    }
  }
} satisfies Record<string, unknown>;

const decisionSchemaPath = "schemas/decision.schema.json";
const decisionSchema = await readJsonFile<AnySchema>(join(root, decisionSchemaPath));
ajv.addSchema(decisionSchema, decisionSchemaPath);

validateWithSchema(
  "examples/api/explain.response.json",
  "schemas/decision.schema.json",
  await readJsonFile(join(root, "examples/api/explain.response.json"))
);

const openApiPath = join(root, "openapi/rebac-control-plane.yaml");
await SwaggerParser.validate(openApiPath);
const openApi = YAML.parse(await readFile(openApiPath, "utf8")) as OpenApiDocument;
const decisionCheckRequestSchema = getRequestSchema(openApi, "/v1/decision/check", "post");

validateInlineSchema(
  "examples/api/decision-check.request.json",
  decisionCheckRequestSchema,
  await readJsonFile(join(root, "examples/api/decision-check.request.json"))
);

validateInlineSchema(
  "examples/control-evidence-mapping.json",
  controlEvidenceMappingSchema,
  await readJsonFile(join(root, "examples/control-evidence-mapping.json"))
);

console.log("Validated documentation examples against JSON Schema and OpenAPI contracts.");
console.log("PASS examples/api/explain.response.json -> schemas/decision.schema.json");
console.log("PASS examples/api/decision-check.request.json -> OpenAPI POST /v1/decision/check request");
console.log("PASS examples/control-evidence-mapping.json -> local control/evidence mapping example contract");

function validateWithSchema(examplePath: string, schemaPath: string, data: unknown): void {
  const validate = ajv.getSchema(schemaPath);

  if (!validate) {
    throw new Error(`Schema was not registered: ${schemaPath}`);
  }

  if (!validate(data)) {
    throw new Error(`${examplePath} failed ${schemaPath}: ${ajv.errorsText(validate.errors)}`);
  }
}

function validateInlineSchema(examplePath: string, schema: Record<string, unknown>, data: unknown): void {
  const validate = ajv.compile(schema);

  if (!validate(data)) {
    throw new Error(`${examplePath} failed validation: ${ajv.errorsText(validate.errors)}`);
  }
}

function getRequestSchema(openApi: OpenApiDocument, path: string, method: string): Record<string, unknown> {
  const operation = asRecord(asRecord(openApi.paths[path], `${path} path`)[method], `${method.toUpperCase()} ${path}`);
  const requestBody = asRecord(operation.requestBody, `${method.toUpperCase()} ${path} requestBody`);
  const content = asRecord(requestBody.content, `${method.toUpperCase()} ${path} content`);
  const json = asRecord(content["application/json"], `${method.toUpperCase()} ${path} application/json content`);
  return asRecord(resolveLocalRefs(asRecord(json.schema, `${method.toUpperCase()} ${path} schema`), openApi), `${method.toUpperCase()} ${path} schema`);
}

function resolveLocalRefs(value: unknown, openApi: OpenApiDocument, seenRefs = new Set<string>()): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => resolveLocalRefs(item, openApi, seenRefs));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const record = value as Record<string, unknown>;
  const ref = record.$ref;

  if (typeof ref === "string") {
    if (!ref.startsWith("#/")) {
      throw new Error(`External OpenAPI refs are not supported for doc request examples: ${ref}`);
    }

    if (seenRefs.has(ref)) {
      throw new Error(`Circular OpenAPI ref found while validating doc examples: ${ref}`);
    }

    return resolveLocalRefs(readLocalRef(openApi, ref), openApi, new Set([...seenRefs, ref]));
  }

  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [key, resolveLocalRefs(entry, openApi, seenRefs)])
  );
}

function readLocalRef(openApi: OpenApiDocument, ref: string): unknown {
  let value: unknown = openApi;

  for (const segment of ref.slice(2).split("/")) {
    value = asRecord(value, ref)[decodeJsonPointerSegment(segment)];
  }

  return value;
}

function decodeJsonPointerSegment(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }

  return value as Record<string, unknown>;
}

interface OpenApiDocument {
  paths: Record<string, Record<string, unknown>>;
  components: {
    schemas: Record<string, unknown>;
  };
}
