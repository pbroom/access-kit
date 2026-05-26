import { describe, expect, it } from "vitest";
import {
  createDefaultPolicyModel,
  validatePolicyModel,
  type PolicyModel
} from "../../packages/core/src/index.js";

function cloneDefaultModel(): PolicyModel {
  return structuredClone(createDefaultPolicyModel());
}

describe("policy model validation", () => {
  it("accepts the default versioned model contract", () => {
    const result = validatePolicyModel(createDefaultPolicyModel());

    expect(result.valid).toBe(true);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "schema_version", status: "pass" }),
        expect.objectContaining({ name: "resource_parent_types_known", status: "pass" }),
        expect.objectContaining({ name: "resource_classifications_declared", status: "pass" }),
        expect.objectContaining({ name: "inheritance_rules_declared", status: "pass" }),
        expect.objectContaining({ name: "context_constraint_types_known", status: "pass" }),
        expect.objectContaining({ name: "tenant_boundary_fail_closed", status: "pass" })
      ])
    );
  });

  it("reports unknown parent resource types with a dedicated check name", () => {
    const model = cloneDefaultModel();
    model.resourceTypes[0] = {
      ...model.resourceTypes[0]!,
      allowedParentTypes: ["not_a_resource_type" as PolicyModel["resourceTypes"][number]["type"]]
    };

    const result = validatePolicyModel(model);

    expect(result.valid).toBe(false);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "resource_types_known", status: "pass" }),
        expect.objectContaining({ name: "resource_parent_types_known", status: "fail" })
      ])
    );
  });

  it("reports preceding resource checks as passed when classification validation fails", () => {
    const model = cloneDefaultModel();
    model.resourceTypes[0] = {
      ...model.resourceTypes[0]!,
      classifications: []
    };

    const result = validatePolicyModel(model);

    expect(result.valid).toBe(false);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "resource_types_known", status: "pass" }),
        expect.objectContaining({ name: "resource_parent_types_known", status: "pass" }),
        expect.objectContaining({ name: "resource_classifications_declared", status: "fail" })
      ])
    );
  });

  it("rejects incompatible action grants before publication", () => {
    const model = cloneDefaultModel();
    model.actions = model.actions.map((action) =>
      action.name === "read" ? { ...action, grants: ["not_a_relation"] } : action
    );

    const result = validatePolicyModel(model);

    expect(result.valid).toBe(false);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "action_grants_known", status: "fail" })
      ])
    );
  });

  it("rejects unknown grants on non-canonical actions", () => {
    const model = cloneDefaultModel();
    model.actions.push({
      name: "delete",
      grants: ["not_a_relation"]
    });

    const result = validatePolicyModel(model);

    expect(result.valid).toBe(false);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "action_grants_known", status: "fail" })
      ])
    );
  });

  it("requires fail-closed tenant boundaries", () => {
    const model = cloneDefaultModel();
    model.tenantBoundary = {
      ...model.tenantBoundary,
      crossTenantTraversal: true as false
    };

    const result = validatePolicyModel(model);

    expect(result.valid).toBe(false);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "tenant_boundary_fail_closed", status: "fail" })
      ])
    );
  });

  it("flags generated policy metadata without bypassing deterministic validation", () => {
    const model = cloneDefaultModel();
    model.metadata = { source: "llm" };

    const result = validatePolicyModel(model);

    expect(result.valid).toBe(true);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "generated_policy_validated", status: "warn" })
      ])
    );
  });

  it("rejects unsupported context constraint types", () => {
    const model = cloneDefaultModel();
    model.contextConstraints[0] = {
      ...model.contextConstraints[0]!,
      type: "object" as "string"
    };

    const result = validatePolicyModel(model);

    expect(result.valid).toBe(false);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "context_constraint_types_known", status: "fail" })
      ])
    );
  });

  it("accepts typed policy caveats and conditional relationship metadata", () => {
    const model = cloneDefaultModel();
    model.contextConstraints = [
      { key: "riskScore", type: "number", required: true, auditable: true, min: 0, max: 100 },
      { key: "deviceTrustLevel", type: "string", required: true, auditable: true, maxLength: 32, allowedValues: ["managed", "trusted"] },
      { key: "accessTime", type: "datetime", required: true, auditable: true }
    ];
    model.caveats = [
      {
        name: "low-risk-managed-device",
        failClosed: true,
        reasonCode: "DENY_POLICY_CAVEAT_UNSATISFIED",
        conditions: [
          { source: "context", key: "riskScore", type: "number", operator: "less_than_or_equal", value: 35 },
          { source: "context", key: "deviceTrustLevel", type: "string", operator: "one_of", value: ["managed", "trusted"] },
          { source: "context", key: "accessTime", type: "datetime", operator: "before", value: "2026-05-27T00:00:00.000Z" }
        ]
      }
    ];
    model.conditionalRelationships = [
      { relation: "reader_of", actions: ["read", "view"], caveats: ["low-risk-managed-device"] }
    ];
    model.explanation = {
      deterministic: true,
      includeContextKeys: ["riskScore", "deviceTrustLevel", "accessTime"],
      includeCaveatNames: ["low-risk-managed-device"]
    };

    const result = validatePolicyModel(model);

    expect(result.valid).toBe(true);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "policy_caveats_fail_closed", status: "pass" }),
        expect.objectContaining({ name: "conditional_relationships_known", status: "pass" }),
        expect.objectContaining({ name: "deterministic_explanation_policy", status: "pass" })
      ])
    );
  });

  it("rejects unbounded or unauditable caveat context inputs", () => {
    const model = cloneDefaultModel();
    model.contextConstraints = [
      { key: "riskScore", type: "number", required: true, min: 0, max: 100 }
    ];
    model.caveats = [
      {
        name: "low-risk-context",
        failClosed: true,
        reasonCode: "DENY_POLICY_CAVEAT_UNSATISFIED",
        conditions: [
          { source: "context", key: "riskScore", type: "number", operator: "less_than_or_equal", value: 35 }
        ]
      }
    ];

    const result = validatePolicyModel(model);

    expect(result.valid).toBe(false);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "policy_caveat_context_auditable", status: "fail" })
      ])
    );
  });

  it("rejects migration chains that revisit a policy version", () => {
    const model = cloneDefaultModel();
    model.migrations = [
      { fromVersion: "policy:local-v1", toVersion: "policy:next", operations: ["add relation reviewer_of"] },
      { fromVersion: "policy:next", toVersion: "policy:local-v1", operations: ["rollback relation reviewer_of"] }
    ];

    const result = validatePolicyModel(model);

    expect(result.valid).toBe(false);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "migrations_acyclic", status: "fail" })
      ])
    );
  });
});
