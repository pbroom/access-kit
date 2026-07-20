import { describe, expect, it } from "vitest";
import {
  createDefaultPolicyModel,
  InMemoryRebacStore,
  RebacDecisionEngine,
  validatePolicyModel,
  type PolicyModel,
  type RelationshipTuple,
  type Resource,
  type Subject
} from "../../packages/core/src/index.js";

const now = "2026-06-01T12:00:00.000Z";

describe("policy-driven decision engine", () => {
  it("grants a custom action through a custom grant relation declared by the model", () => {
    const store = auditStore([
      tuple("relationship:alice-auditor-document", "user:alice", "auditor_of", "document:case-plan")
    ]);
    const request = { subjectId: "user:alice", action: "audit", resourceId: "document:case-plan" };

    const customResult = new RebacDecisionEngine(store, { now: () => now, policyModel: createAuditPolicyModel() }).explain(request);
    const defaultResult = new RebacDecisionEngine(store, { now: () => now }).explain(request);

    expect(customResult.decision).toBe("allow");
    expect(customResult.reasonCode).toBe("ALLOW_VIA_RELATIONSHIP_PATH");
    expect(customResult.relationshipPath).toEqual([
      { subjectId: "user:alice", relation: "auditor_of", objectId: "document:case-plan" }
    ]);
    expect(defaultResult.decision).toBe("deny");
    expect(defaultResult.reasonCode).toBe("DENY_DEFAULT_NO_RELATIONSHIP_PATH");
  });

  it("enforces a custom deny relation and honors its per-action scoping", () => {
    const store = auditStore([
      tuple("relationship:alice-auditor-document", "user:alice", "auditor_of", "document:case-plan"),
      tuple("relationship:alice-reader-document", "user:alice", "reader_of", "document:case-plan"),
      tuple("relationship:alice-blocked-document", "user:alice", "blocked_from", "document:case-plan")
    ]);
    const engine = new RebacDecisionEngine(store, { now: () => now, policyModel: createAuditPolicyModel() });

    const audit = engine.explain({ subjectId: "user:alice", action: "audit", resourceId: "document:case-plan" });
    const read = engine.explain({ subjectId: "user:alice", action: "read", resourceId: "document:case-plan" });

    expect(audit.decision).toBe("deny");
    expect(audit.reasonCode).toBe("DENY_EXPLICIT_OVERRIDE");
    expect(audit.relationshipPath).toEqual([
      { subjectId: "user:alice", relation: "blocked_from", objectId: "document:case-plan" }
    ]);
    expect(read.decision).toBe("allow");
    expect(read.reasonCode).toBe("ALLOW_VIA_RELATIONSHIP_PATH");
  });

  it("propagates custom grants through membership and containment per inheritance rules", () => {
    const store = auditStore(transitiveAuditRelationships());
    const engine = new RebacDecisionEngine(store, { now: () => now, policyModel: createAuditPolicyModel() });

    const result = engine.explain({ subjectId: "user:alice", action: "audit", resourceId: "document:case-plan" });

    expect(result.decision).toBe("allow");
    expect(result.relationshipPath).toEqual([
      { subjectId: "user:alice", relation: "member_of", objectId: "group:audit-team" },
      { subjectId: "group:audit-team", relation: "auditor_of", objectId: "workspace:case" },
      { subjectId: "workspace:case", relation: "contains", objectId: "document:case-plan" }
    ]);
  });

  it("stops group propagation when the membership inheritance rule omits the action", () => {
    const model = createAuditPolicyModel();
    model.inheritanceRules = model.inheritanceRules.map((rule) =>
      rule.name === "group-membership-grants"
        ? { ...rule, actions: rule.actions.filter((action) => action !== "audit") }
        : rule
    );
    const store = auditStore(transitiveAuditRelationships());
    const engine = new RebacDecisionEngine(store, { now: () => now, policyModel: model });

    const audit = engine.explain({ subjectId: "user:alice", action: "audit", resourceId: "document:case-plan" });

    expect(audit.decision).toBe("deny");
    expect(audit.reasonCode).toBe("DENY_DEFAULT_NO_RELATIONSHIP_PATH");
  });

  it("stops container propagation when the containment inheritance rule omits the action", () => {
    const model = createAuditPolicyModel();
    model.inheritanceRules = model.inheritanceRules.map((rule) =>
      rule.name === "container-resource-grants"
        ? { ...rule, actions: rule.actions.filter((action) => action !== "audit") }
        : rule
    );
    const store = auditStore([
      tuple("relationship:alice-auditor-workspace", "user:alice", "auditor_of", "workspace:case"),
      tuple("relationship:workspace-contains-document", "workspace:case", "contains", "document:case-plan")
    ]);
    const engine = new RebacDecisionEngine(store, { now: () => now, policyModel: model });

    const audit = engine.explain({ subjectId: "user:alice", action: "audit", resourceId: "document:case-plan" });
    const workspaceAudit = engine.explain({ subjectId: "user:alice", action: "audit", resourceId: "workspace:case" });

    expect(audit.decision).toBe("deny");
    expect(audit.reasonCode).toBe("DENY_DEFAULT_NO_RELATIONSHIP_PATH");
    expect(workspaceAudit.decision).toBe("allow");
  });

  it("grants nothing through relations that are not declared in the model", () => {
    const store = auditStore([
      tuple("relationship:alice-super-admin-document", "user:alice", "super_admin_of", "document:case-plan")
    ]);
    const engine = new RebacDecisionEngine(store, { now: () => now, policyModel: createAuditPolicyModel() });

    for (const action of ["read", "write", "admin", "audit"]) {
      const result = engine.explain({ subjectId: "user:alice", action, resourceId: "document:case-plan" });

      expect(result.decision).toBe("deny");
      expect(result.reasonCode).toBe("DENY_DEFAULT_NO_RELATIONSHIP_PATH");
    }
  });

  it("fails closed when an action maps to a relation the model never declares as a grant", () => {
    const model = createAuditPolicyModel();
    model.actions = model.actions.map((action) =>
      action.name === "audit" ? { ...action, grants: ["undeclared_relation"] } : action
    );
    const store = auditStore([
      tuple("relationship:alice-undeclared-document", "user:alice", "undeclared_relation", "document:case-plan")
    ]);
    const engine = new RebacDecisionEngine(store, { now: () => now, policyModel: model });

    const result = engine.explain({ subjectId: "user:alice", action: "audit", resourceId: "document:case-plan" });

    expect(result.decision).toBe("deny");
    expect(result.reasonCode).toBe("DENY_DEFAULT_NO_RELATIONSHIP_PATH");
  });

  it("produces identical decisions with no model and with the explicit default model", () => {
    const relationships = [
      tuple("relationship:alice-member-team", "user:alice", "member_of", "group:audit-team"),
      tuple("relationship:team-contributor-workspace", "group:audit-team", "contributor_to", "workspace:case"),
      tuple("relationship:workspace-contains-document", "workspace:case", "contains", "document:case-plan"),
      tuple("relationship:alice-denied-read-document", "user:alice", "denied_read", "document:case-plan")
    ];
    const request = { subjectId: "user:alice", action: "read", resourceId: "document:case-plan" };

    const implicit = new RebacDecisionEngine(auditStore(relationships), {
      now: () => now,
      monotonicNow: () => 0
    }).explain(request);
    const explicit = new RebacDecisionEngine(auditStore(relationships), {
      now: () => now,
      monotonicNow: () => 0,
      policyModel: createDefaultPolicyModel()
    }).explain(request);

    expect(implicit).toEqual(explicit);
    expect(implicit.reasonCode).toBe("DENY_EXPLICIT_OVERRIDE");
  });
});

describe("policy model internal-consistency validation", () => {
  it("accepts a custom model with new relations, actions, deny rules, and inheritance rules", () => {
    const result = validatePolicyModel(createAuditPolicyModel());

    expect(result.valid).toBe(true);
  });

  it("rejects action mappings that reference non-grant relations", () => {
    const model = createAuditPolicyModel();
    model.actions = model.actions.map((action) =>
      action.name === "audit" ? { ...action, grants: ["member_of"] } : action
    );

    const result = validatePolicyModel(model);

    expect(result.valid).toBe(false);
    expect(result.checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "action_grants_grant_kind", status: "fail" })])
    );
  });

  it("rejects deny rules that reference non-deny relations", () => {
    const model = createAuditPolicyModel();
    model.denyRules.push({ name: "bogus-deny", relation: "auditor_of", precedence: "override" });

    const result = validatePolicyModel(model);

    expect(result.valid).toBe(false);
    expect(result.checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "deny_relations_deny_kind", status: "fail" })])
    );
  });

  it("rejects models without any deny rule", () => {
    const model = createAuditPolicyModel();
    model.denyRules = [];

    const result = validatePolicyModel(model);

    expect(result.valid).toBe(false);
    expect(result.checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "deny_rules_present", status: "fail" })])
    );
  });

  it("rejects inheritance rules that traverse non-membership, non-containment relations", () => {
    const model = createAuditPolicyModel();
    model.inheritanceRules.push({
      name: "grant-traversal",
      relation: "auditor_of",
      through: "auditor_of",
      actions: ["audit"]
    });

    const result = validatePolicyModel(model);

    expect(result.valid).toBe(false);
    expect(result.checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "inheritance_traversal_kinds", status: "fail" })])
    );
  });
});

function createAuditPolicyModel(): PolicyModel {
  const model = createDefaultPolicyModel();
  model.relations.push(
    { name: "auditor_of", kind: "grant", subjectTypes: ["user", "group"], objectTypes: ["workspace", "document"] },
    { name: "blocked_from", kind: "deny", subjectTypes: ["user", "group"], objectTypes: ["workspace", "document"] }
  );
  model.actions.push({ name: "audit", grants: ["auditor_of"] });
  model.inheritanceRules = model.inheritanceRules.map((rule) => ({
    ...rule,
    actions: [...rule.actions, "audit"]
  }));
  model.denyRules.push({ name: "audit-block", relation: "blocked_from", actions: ["audit"], precedence: "override" });
  return model;
}

function transitiveAuditRelationships(): RelationshipTuple[] {
  return [
    tuple("relationship:alice-member-team", "user:alice", "member_of", "group:audit-team"),
    tuple("relationship:team-auditor-workspace", "group:audit-team", "auditor_of", "workspace:case"),
    tuple("relationship:workspace-contains-document", "workspace:case", "contains", "document:case-plan")
  ];
}

function auditStore(relationships: RelationshipTuple[]): InMemoryRebacStore {
  return new InMemoryRebacStore({
    subjects: [subject("user:alice"), subject("group:audit-team")],
    resources: [resource("workspace:case", "workspace"), resource("document:case-plan", "document")],
    relationships
  });
}

function subject(id: string): Subject {
  return {
    id,
    type: id.startsWith("group:") ? "group" : "user",
    displayName: id,
    sourceSystem: "policy-driven-tests",
    lifecycleState: "active",
    identifiers: {},
    version: "subject:policy-driven",
    createdAt: now
  };
}

function resource(id: string, type: Resource["type"]): Resource {
  return {
    id,
    type,
    displayName: id,
    sourceSystem: "policy-driven-tests",
    ownerId: "user:owner",
    dataStewardId: "user:steward",
    technicalOwnerId: "user:tech-owner",
    classification: "internal",
    lifecycleState: "active",
    version: "resource:policy-driven",
    createdAt: now
  };
}

function tuple(id: string, subjectId: string, relation: string, objectId: string): RelationshipTuple {
  return {
    id,
    subjectId,
    relation,
    objectId,
    sourceSystem: "policy-driven-tests",
    assertedAt: now,
    status: "active",
    version: "tuple:policy-driven",
    createdAt: now
  };
}
