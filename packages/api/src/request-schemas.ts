import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";

export type RuntimeRequestSchemaName =
  | "decisionBatch"
  | "decisionRequest"
  | "relationship"
  | "resource"
  | "subject";

const ajv = new Ajv2020({ allErrors: true, strict: true });
const isoDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
ajv.addFormat("date-time", {
  type: "string",
  validate: (value: string) => isoDateTimePattern.test(value) && !Number.isNaN(Date.parse(value))
});

const idPattern = "^[a-z0-9_:-]+$";
const dateTime = { type: "string", format: "date-time" } as const;
const jsonObject = { type: "object", additionalProperties: true } as const;

const decisionRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["subjectId", "action", "resourceId"],
  properties: {
    subjectId: { type: "string", minLength: 1 },
    action: { type: "string", minLength: 1 },
    resourceId: { type: "string", minLength: 1 },
    context: jsonObject,
    policyVersion: { type: "string", minLength: 1 },
    relationshipVersion: { type: "string", minLength: 1 }
  }
} as const;

const schemas: Record<RuntimeRequestSchemaName, object> = {
  decisionRequest: decisionRequestSchema,
  decisionBatch: {
    type: "object",
    additionalProperties: false,
    required: ["requests"],
    properties: {
      requests: {
        type: "array",
        minItems: 1,
        items: decisionRequestSchema
      }
    }
  },
  subject: {
    type: "object",
    additionalProperties: false,
    required: ["id", "type", "displayName", "sourceSystem", "lifecycleState", "identifiers", "version", "createdAt"],
    properties: {
      id: { type: "string", pattern: idPattern },
      type: {
        type: "string",
        enum: ["user", "group", "service_account", "service_principal", "managed_identity", "device", "workload"]
      },
      displayName: { type: "string", minLength: 1 },
      sourceSystem: { type: "string", minLength: 1 },
      lifecycleState: {
        type: "string",
        enum: ["active", "inactive", "suspended", "terminated", "deleted"]
      },
      identifiers: {
        type: "object",
        additionalProperties: { type: "string" },
        minProperties: 1
      },
      attributes: jsonObject,
      version: { type: "string", minLength: 1 },
      createdAt: dateTime,
      updatedAt: dateTime,
      lastSeenAt: dateTime
    }
  },
  resource: {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "type",
      "displayName",
      "sourceSystem",
      "ownerId",
      "dataStewardId",
      "technicalOwnerId",
      "classification",
      "lifecycleState",
      "version",
      "createdAt"
    ],
    properties: {
      id: { type: "string", pattern: idPattern },
      type: {
        type: "string",
        enum: [
          "organization",
          "workspace",
          "application",
          "sharepoint_site",
          "team",
          "folder",
          "document",
          "power_app",
          "flow",
          "dataverse_environment",
          "aws_account",
          "aws_role",
          "dataset",
          "api"
        ]
      },
      displayName: { type: "string", minLength: 1 },
      sourceSystem: { type: "string", minLength: 1 },
      ownerId: { type: "string", pattern: idPattern },
      dataStewardId: { type: "string", pattern: idPattern },
      technicalOwnerId: { type: "string", pattern: idPattern },
      classification: { type: "string", minLength: 1 },
      lifecycleState: {
        type: "string",
        enum: ["active", "inactive", "suspended", "terminated", "deleted"]
      },
      parentId: { type: "string", pattern: idPattern },
      attributes: jsonObject,
      version: { type: "string", minLength: 1 },
      createdAt: dateTime,
      updatedAt: dateTime,
      lastSeenAt: dateTime
    }
  },
  relationship: {
    type: "object",
    additionalProperties: false,
    required: ["id", "subjectId", "relation", "objectId", "sourceSystem", "assertedAt", "status", "version", "createdAt"],
    properties: {
      id: { type: "string", pattern: idPattern },
      subjectId: { type: "string", pattern: idPattern },
      relation: { type: "string", minLength: 1 },
      objectId: { type: "string", pattern: idPattern },
      sourceSystem: { type: "string", minLength: 1 },
      assertedAt: dateTime,
      assertedBy: { type: "string", pattern: idPattern },
      expiresAt: dateTime,
      status: { type: "string", enum: ["active", "expired", "deleted"] },
      attributes: jsonObject,
      version: { type: "string", minLength: 1 },
      createdAt: dateTime,
      updatedAt: dateTime
    }
  }
};

const validators = new Map<RuntimeRequestSchemaName, ValidateFunction>(
  Object.entries(schemas).map(([name, schema]) => [name as RuntimeRequestSchemaName, ajv.compile(schema)])
);

export function validateRuntimeRequestSchema(schemaName: RuntimeRequestSchemaName, value: unknown): string[] {
  const validate = validators.get(schemaName);

  if (!validate) {
    throw new Error(`Unknown runtime request schema: ${schemaName}`);
  }

  if (validate(value)) {
    return [];
  }

  return (validate.errors ?? []).map((error) => {
    const location = error.instancePath || "/";
    return `${location} ${error.message ?? "failed schema validation"}`;
  });
}
