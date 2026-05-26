import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";

export type RuntimeRequestSchemaName =
  | "connectorSync"
  | "decisionBatch"
  | "decisionRequest"
  | "driftRemediation"
  | "enforcementReadiness"
  | "policyDraft"
  | "policyPublish"
  | "policyRollback"
  | "provisioningJob"
  | "provisioningPlan"
  | "reconciliationRun"
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
const policyModelSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "id",
    "version",
    "resourceTypes",
    "relations",
    "actions",
    "inheritanceRules",
    "denyRules",
    "contextConstraints",
    "classificationConstraints",
    "tenantBoundary",
    "migrations"
  ],
  properties: {
    schemaVersion: { const: "access-kit.policy-model.v1" },
    id: { type: "string", pattern: idPattern },
    version: { type: "string", minLength: 1 },
    resourceTypes: {
      type: "array",
      minItems: 1,
      items: jsonObject
    },
    relations: {
      type: "array",
      minItems: 1,
      items: jsonObject
    },
    actions: {
      type: "array",
      minItems: 1,
      items: jsonObject
    },
    inheritanceRules: {
      type: "array",
      minItems: 1,
      items: jsonObject
    },
    denyRules: {
      type: "array",
      minItems: 1,
      items: jsonObject
    },
    contextConstraints: {
      type: "array",
      items: jsonObject
    },
    classificationConstraints: {
      type: "array",
      minItems: 1,
      items: jsonObject
    },
    tenantBoundary: jsonObject,
    migrations: {
      type: "array",
      items: jsonObject
    },
    metadata: jsonObject
  }
} as const;
const enforcementControlSchema = {
  type: "object",
  additionalProperties: false,
  required: ["syntheticOnly", "liveProviderWrites", "incidentMode", "breakGlass"],
  properties: {
    syntheticOnly: { type: "boolean" },
    liveProviderWrites: { type: "boolean" },
    incidentMode: { type: "boolean" },
    breakGlass: { type: "boolean" }
  }
} as const;
const driftAutoRepairPolicySchema = {
  type: "object",
  additionalProperties: false,
  required: ["enabled", "allowedActions", "maxSeverity", "requireApproval", "requireConnectorReadiness", "liveProviderWrites"],
  properties: {
    enabled: { type: "boolean" },
    allowedActions: {
      type: "array",
      items: { enum: ["revoke", "repair", "review"] },
      uniqueItems: true
    },
    maxSeverity: { enum: ["low", "medium", "high", "critical"] },
    requireApproval: { type: "boolean" },
    requireConnectorReadiness: { type: "boolean" },
    liveProviderWrites: { type: "boolean" },
    reason: { type: "string", minLength: 1 }
  }
} as const;
const provisioningApprovalSchema = {
  type: "object",
  additionalProperties: false,
  required: ["decision", "approverId", "changeTicket", "approvedAt"],
  properties: {
    decision: { const: "approved" },
    approverId: { type: "string", minLength: 1 },
    changeTicket: { type: "string", minLength: 1 },
    approvedAt: { type: "string", minLength: 1 },
    expiresAt: { type: "string", minLength: 1 },
    reason: { type: "string", minLength: 1 }
  }
} as const;

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
  connectorSync: {
    type: "object",
    additionalProperties: false,
    required: ["mode"],
    properties: {
      mode: { const: "read_only" }
    }
  },
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
  enforcementReadiness: {
    type: "object",
    additionalProperties: false,
    required: ["control"],
    properties: {
      mode: { const: "enforcement" },
      control: enforcementControlSchema,
      requiredApproverRole: { type: "string", minLength: 1 },
      changeTicketPattern: { type: "string", minLength: 1 }
    }
  },
  driftRemediation: {
    type: "object",
    additionalProperties: false,
    required: ["approval", "autoRepairPolicy"],
    properties: {
      approval: provisioningApprovalSchema,
      autoRepairPolicy: driftAutoRepairPolicySchema,
      hookEvidence: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["system", "referenceId", "status", "recordedAt"],
          properties: {
            system: { enum: ["ticket", "siem"] },
            referenceId: { type: "string", minLength: 1 },
            status: { enum: ["pending", "linked", "notified", "failed"] },
            recordedAt: dateTime,
            url: { type: "string", minLength: 1 },
            evidence: jsonObject
          }
        }
      }
    }
  },
  policyDraft: {
    type: "object",
    additionalProperties: false,
    required: ["name", "model", "tests"],
    properties: {
      name: { type: "string", minLength: 1 },
      model: policyModelSchema,
      tests: {
        type: "array",
        items: jsonObject
      }
    }
  },
  policyPublish: {
    type: "object",
    additionalProperties: false,
    required: ["changeTicket", "approverId"],
    properties: {
      changeTicket: { type: "string", minLength: 1 },
      approverId: { type: "string", minLength: 1 }
    }
  },
  policyRollback: {
    type: "object",
    additionalProperties: false,
    required: ["targetVersion", "changeTicket", "approverId"],
    properties: {
      targetVersion: { type: "string", minLength: 1 },
      changeTicket: { type: "string", minLength: 1 },
      approverId: { type: "string", minLength: 1 }
    }
  },
  provisioningJob: {
    type: "object",
    additionalProperties: false,
    required: ["planId", "approverId"],
    properties: {
      planId: { type: "string", minLength: 1 },
      approverId: { type: "string", minLength: 1 },
      mode: { enum: ["dry_run", "enforcement"] },
      dryRun: { type: "boolean" },
      approval: provisioningApprovalSchema,
      control: enforcementControlSchema
    }
  },
  provisioningPlan: {
    type: "object",
    additionalProperties: false,
    required: ["dryRun"],
    properties: {
      subjectId: { type: "string", minLength: 1 },
      action: { type: "string", minLength: 1 },
      resourceId: { type: "string", minLength: 1 },
      context: jsonObject,
      mode: { enum: ["dry_run", "enforcement"] },
      dryRun: { type: "boolean" },
      grantId: { type: "string", minLength: 1 },
      connectorId: { type: "string" },
      approval: provisioningApprovalSchema,
      control: enforcementControlSchema,
      readinessReportId: { type: "string", minLength: 1 }
    }
  },
  reconciliationRun: {
    type: "object",
    additionalProperties: false,
    required: ["connectorId", "dryRun"],
    properties: {
      connectorId: { type: "string", minLength: 1 },
      dryRun: { const: true },
      trigger: { enum: ["manual", "scheduled"] },
      schedule: {
        type: "object",
        additionalProperties: false,
        properties: {
          cadence: { enum: ["manual", "hourly", "daily", "weekly"] },
          scheduledAt: dateTime,
          windowStart: dateTime,
          windowEnd: dateTime,
          nextRunAt: dateTime,
          gracePeriodHours: { type: "integer", minimum: 0 },
          overdue: { type: "boolean" }
        }
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
