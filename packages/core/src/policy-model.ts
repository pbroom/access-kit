import type { JsonRecord, ResourceType, SubjectType, ValidationCheckStatus } from "./domain.js";

export const POLICY_MODEL_SCHEMA_VERSION = "access-kit.policy-model.v1";

export type PolicyModelRelationKind = "membership" | "grant" | "containment" | "deny";
export type PolicyModelContextType = "string" | "number" | "boolean";
export type PolicyModelTenantBoundarySource = "subject" | "resource" | "context";

export type PolicyModelNodeType = SubjectType | ResourceType;

export interface PolicyModelResourceType {
  type: ResourceType;
  allowedParentTypes?: ResourceType[];
  classifications: string[];
}

export interface PolicyModelRelation {
  name: string;
  kind: PolicyModelRelationKind;
  subjectTypes: PolicyModelNodeType[];
  objectTypes: PolicyModelNodeType[];
}

export interface PolicyModelActionMapping {
  name: string;
  grants: string[];
}

export interface PolicyModelInheritanceRule {
  name: string;
  relation: string;
  through: string;
  actions: string[];
}

export interface PolicyModelDenyRule {
  name: string;
  relation: string;
  actions?: string[];
  precedence: "override";
}

export interface PolicyModelContextConstraint {
  key: string;
  type: PolicyModelContextType;
  required?: boolean;
}

export interface PolicyModelClassificationConstraint {
  classification: string;
  allowedActions: string[];
}

export interface PolicyModelTenantBoundary {
  key: string;
  source: PolicyModelTenantBoundarySource;
  crossTenantTraversal: false;
}

export interface PolicyModelMigration {
  fromVersion: string;
  toVersion: string;
  operations: string[];
}

export interface PolicyModel {
  schemaVersion: typeof POLICY_MODEL_SCHEMA_VERSION;
  id: string;
  version: string;
  resourceTypes: PolicyModelResourceType[];
  relations: PolicyModelRelation[];
  actions: PolicyModelActionMapping[];
  inheritanceRules: PolicyModelInheritanceRule[];
  denyRules: PolicyModelDenyRule[];
  contextConstraints: PolicyModelContextConstraint[];
  classificationConstraints: PolicyModelClassificationConstraint[];
  tenantBoundary: PolicyModelTenantBoundary;
  migrations: PolicyModelMigration[];
  metadata?: JsonRecord;
}

export interface PolicyModelValidationCheck {
  name: string;
  status: ValidationCheckStatus;
  message?: string;
  evidence?: JsonRecord;
}

export interface PolicyModelValidationResult {
  valid: boolean;
  checks: PolicyModelValidationCheck[];
}

const supportedActions = new Map<string, string[]>([
  ["read", ["viewer_of", "reader_of", "contributor_to", "owner_of", "admin_of"]],
  ["view", ["viewer_of", "reader_of", "contributor_to", "owner_of", "admin_of"]],
  ["write", ["contributor_to", "owner_of", "admin_of"]],
  ["contribute", ["contributor_to", "owner_of", "admin_of"]],
  ["admin", ["owner_of", "admin_of"]],
  ["administer", ["owner_of", "admin_of"]],
  ["manage", ["owner_of", "admin_of"]]
]);

const requiredDenyRelations = new Set(["denied", "denied_read", "quarantined_from"]);
const requiredMembershipRelations = new Set(["member_of"]);
const requiredContainmentRelations = new Set(["contains"]);
const supportedContextTypes = new Set<PolicyModelContextType>(["string", "number", "boolean"]);
const knownResourceTypes = new Set<ResourceType>([
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
]);

export function createDefaultPolicyModel(): PolicyModel {
  return {
    schemaVersion: POLICY_MODEL_SCHEMA_VERSION,
    id: "policy-model:local-rebac-v1",
    version: "policy:local-v1",
    resourceTypes: [
      { type: "organization", classifications: ["internal"] },
      { type: "workspace", allowedParentTypes: ["organization"], classifications: ["internal"] },
      { type: "folder", allowedParentTypes: ["workspace", "folder"], classifications: ["internal", "confidential"] },
      { type: "document", allowedParentTypes: ["workspace", "folder"], classifications: ["internal", "confidential"] },
      { type: "application", allowedParentTypes: ["organization"], classifications: ["internal"] },
      { type: "dataset", allowedParentTypes: ["workspace"], classifications: ["internal", "confidential"] },
      { type: "api", allowedParentTypes: ["application"], classifications: ["internal"] }
    ],
    relations: [
      { name: "member_of", kind: "membership", subjectTypes: ["user", "group"], objectTypes: ["group"] },
      { name: "contains", kind: "containment", subjectTypes: ["organization", "workspace", "folder"], objectTypes: ["workspace", "folder", "document", "application", "dataset", "api"] },
      { name: "viewer_of", kind: "grant", subjectTypes: ["user", "group", "service_account"], objectTypes: ["workspace", "folder", "document", "application", "dataset", "api"] },
      { name: "reader_of", kind: "grant", subjectTypes: ["user", "group", "service_account"], objectTypes: ["workspace", "folder", "document", "application", "dataset", "api"] },
      { name: "contributor_to", kind: "grant", subjectTypes: ["user", "group", "service_account"], objectTypes: ["workspace", "folder", "document", "application", "dataset", "api"] },
      { name: "owner_of", kind: "grant", subjectTypes: ["user", "group", "service_account"], objectTypes: ["workspace", "folder", "document", "application", "dataset", "api"] },
      { name: "admin_of", kind: "grant", subjectTypes: ["user", "group", "service_account"], objectTypes: ["workspace", "folder", "document", "application", "dataset", "api"] },
      { name: "denied", kind: "deny", subjectTypes: ["user", "group", "service_account"], objectTypes: ["workspace", "folder", "document", "application", "dataset", "api"] },
      { name: "denied_read", kind: "deny", subjectTypes: ["user", "group", "service_account"], objectTypes: ["workspace", "folder", "document", "application", "dataset", "api"] },
      { name: "quarantined_from", kind: "deny", subjectTypes: ["user", "group", "service_account"], objectTypes: ["workspace", "folder", "document", "application", "dataset", "api"] }
    ],
    actions: [...supportedActions].map(([name, grants]) => ({ name, grants })),
    inheritanceRules: [
      {
        name: "group-membership-grants",
        relation: "member_of",
        through: "member_of",
        actions: [...supportedActions.keys()]
      },
      {
        name: "container-resource-grants",
        relation: "contains",
        through: "contains",
        actions: ["read", "view", "write", "contribute", "admin", "administer", "manage"]
      }
    ],
    denyRules: [
      { name: "explicit-deny", relation: "denied", precedence: "override" },
      { name: "read-deny", relation: "denied_read", actions: ["read", "view"], precedence: "override" },
      { name: "quarantine-deny", relation: "quarantined_from", precedence: "override" }
    ],
    contextConstraints: [
      { key: "purpose", type: "string" },
      { key: "riskScore", type: "number" }
    ],
    classificationConstraints: [
      { classification: "internal", allowedActions: [...supportedActions.keys()] },
      { classification: "confidential", allowedActions: ["read", "view", "write", "contribute", "admin", "administer", "manage"] }
    ],
    tenantBoundary: {
      key: "tenantId",
      source: "resource",
      crossTenantTraversal: false
    },
    migrations: []
  };
}

export function validatePolicyModel(model: PolicyModel): PolicyModelValidationResult {
  const checks: PolicyModelValidationCheck[] = [];
  const relationNames = new Set(model.relations.map((relation) => relation.name));
  const actionNames = new Set(model.actions.map((action) => action.name));
  const resourceTypeNames = new Set(model.resourceTypes.map((resourceType) => resourceType.type));

  addCheck(checkSchemaVersion(model));
  addCheck(checkUnique("resource_types_unique", model.resourceTypes.map((resourceType) => resourceType.type)));
  addCheck(checkUnique("relations_unique", model.relations.map((relation) => relation.name)));
  addCheck(checkUnique("actions_unique", model.actions.map((action) => action.name)));
  for (const check of checkKnownResourceTypes(model, resourceTypeNames)) {
    addCheck(check);
  }
  addCheck(checkRelations(model, relationNames));
  addCheck(checkActionMappings(model, relationNames));
  addCheck(checkInheritanceRules(model, relationNames, actionNames));
  addCheck(checkDenyRules(model, relationNames, actionNames));
  addCheck(checkTenantBoundary(model));
  addCheck(checkClassificationConstraints(model, actionNames));
  addCheck(checkContextConstraints(model));
  addCheck(checkMigrations(model));
  addCheck(checkGeneratedMetadata(model));

  return {
    valid: checks.every((check) => check.status !== "fail"),
    checks
  };

  function addCheck(check: PolicyModelValidationCheck): void {
    checks.push(check);
  }
}

function checkSchemaVersion(model: PolicyModel): PolicyModelValidationCheck {
  if (model.schemaVersion !== POLICY_MODEL_SCHEMA_VERSION) {
    return fail("schema_version", `Unsupported policy model schema version: ${String(model.schemaVersion)}`);
  }
  return pass("schema_version", "Policy model schema version is supported.");
}

function checkUnique(name: string, values: string[]): PolicyModelValidationCheck {
  const duplicates = values.filter((value, index) => values.indexOf(value) !== index);
  if (duplicates.length > 0) {
    return fail(name, `Duplicate values are not allowed: ${[...new Set(duplicates)].join(", ")}`);
  }
  return pass(name, "Names are unique.");
}

function checkKnownResourceTypes(model: PolicyModel, resourceTypeNames: Set<ResourceType>): PolicyModelValidationCheck[] {
  const checks: PolicyModelValidationCheck[] = [];
  for (const resourceType of model.resourceTypes) {
    if (!knownResourceTypes.has(resourceType.type)) {
      return [fail("resource_types_known", `Unsupported resource type: ${resourceType.type}`)];
    }
  }
  checks.push(pass("resource_types_known", "Resource types are supported."));

  for (const resourceType of model.resourceTypes) {
    for (const parentType of resourceType.allowedParentTypes ?? []) {
      if (!resourceTypeNames.has(parentType)) {
        return [
          ...checks,
          fail("resource_parent_types_known", `Resource type ${resourceType.type} references unknown parent type ${parentType}.`)
        ];
      }
    }
  }
  checks.push(pass("resource_parent_types_known", "Resource parent references are known."));

  for (const resourceType of model.resourceTypes) {
    if (resourceType.classifications.length === 0) {
      return [
        ...checks,
        fail("resource_classifications_declared", `Resource type ${resourceType.type} must declare at least one classification.`)
      ];
    }
  }
  checks.push(pass("resource_classifications_declared", "Resource classifications are declared."));
  return checks;
}

function checkRelations(model: PolicyModel, relationNames: Set<string>): PolicyModelValidationCheck {
  for (const required of [...requiredMembershipRelations, ...requiredContainmentRelations, ...requiredDenyRelations]) {
    if (!relationNames.has(required)) {
      return fail("canonical_relations_present", `Missing canonical relation ${required}.`);
    }
  }
  for (const relation of model.relations) {
    if (relation.subjectTypes.length === 0 || relation.objectTypes.length === 0) {
      return fail("relation_endpoints_declared", `Relation ${relation.name} must declare subject and object types.`);
    }
  }
  return pass("canonical_relations_present", "Canonical grant, membership, containment, and deny relations are declared.");
}

function checkActionMappings(model: PolicyModel, relationNames: Set<string>): PolicyModelValidationCheck {
  const actions = new Map(model.actions.map((action) => [action.name, action]));
  for (const action of model.actions) {
    if (action.grants.length === 0) {
      return fail("action_grants_declared", `Action ${action.name} must map to at least one grant relation.`);
    }
    for (const grant of action.grants) {
      if (!relationNames.has(grant)) {
        return fail("action_grants_known", `Action ${action.name} references unknown relation ${grant}.`);
      }
    }
  }
  for (const [requiredAction, requiredRelations] of supportedActions) {
    const action = actions.get(requiredAction);
    if (!action) {
      return fail("canonical_actions_present", `Missing canonical action ${requiredAction}.`);
    }
    for (const grant of action.grants) {
      if (!requiredRelations.includes(grant)) {
        return fail("action_grants_compatible", `Action ${requiredAction} uses relation ${grant}, which is not compatible with the current engine.`);
      }
    }
  }
  return pass("action_grants_compatible", "Action mappings are compatible with the current deterministic engine.");
}

function checkInheritanceRules(model: PolicyModel, relationNames: Set<string>, actionNames: Set<string>): PolicyModelValidationCheck {
  if (model.inheritanceRules.length === 0) {
    return fail("inheritance_rules_declared", "At least one inheritance rule is required.");
  }
  for (const rule of model.inheritanceRules) {
    if (!relationNames.has(rule.relation)) {
      return fail("inheritance_relations_known", `Inheritance rule ${rule.name} references unknown relation ${rule.relation}.`);
    }
    if (!relationNames.has(rule.through)) {
      return fail("inheritance_paths_known", `Inheritance rule ${rule.name} references unknown traversal relation ${rule.through}.`);
    }
    if (rule.actions.length === 0) {
      return fail("inheritance_actions_declared", `Inheritance rule ${rule.name} must declare at least one action.`);
    }
    for (const action of rule.actions) {
      if (!actionNames.has(action)) {
        return fail("inheritance_actions_known", `Inheritance rule ${rule.name} references unknown action ${action}.`);
      }
    }
  }
  return pass("inheritance_rules_declared", "Inheritance rules reference known relations, traversal paths, and actions.");
}

function checkDenyRules(model: PolicyModel, relationNames: Set<string>, actionNames: Set<string>): PolicyModelValidationCheck {
  for (const requiredRelation of requiredDenyRelations) {
    if (!model.denyRules.some((rule) => rule.relation === requiredRelation && rule.precedence === "override")) {
      return fail("deny_rules_present", `Missing override deny rule for ${requiredRelation}.`);
    }
  }
  for (const rule of model.denyRules) {
    if (!relationNames.has(rule.relation)) {
      return fail("deny_relations_known", `Deny rule ${rule.name} references unknown relation ${rule.relation}.`);
    }
    for (const action of rule.actions ?? []) {
      if (!actionNames.has(action)) {
        return fail("deny_actions_known", `Deny rule ${rule.name} references unknown action ${action}.`);
      }
    }
  }
  return pass("deny_rules_present", "Override deny rules are declared for canonical deny relations.");
}

function checkTenantBoundary(model: PolicyModel): PolicyModelValidationCheck {
  if (!model.tenantBoundary.key || model.tenantBoundary.crossTenantTraversal !== false) {
    return fail("tenant_boundary_fail_closed", "Tenant boundary must name a key and disable cross-tenant traversal.");
  }
  return pass("tenant_boundary_fail_closed", "Tenant boundary is explicit and fail-closed.");
}

function checkClassificationConstraints(model: PolicyModel, actionNames: Set<string>): PolicyModelValidationCheck {
  if (model.classificationConstraints.length === 0) {
    return fail("classification_constraints_declared", "At least one classification constraint is required.");
  }
  for (const constraint of model.classificationConstraints) {
    if (!constraint.classification || constraint.allowedActions.length === 0) {
      return fail("classification_constraints_declared", "Classification constraints must name a classification and allowed actions.");
    }
    for (const action of constraint.allowedActions) {
      if (!actionNames.has(action)) {
        return fail("classification_actions_known", `Classification ${constraint.classification} references unknown action ${action}.`);
      }
    }
  }
  return pass("classification_constraints_declared", "Classification constraints are declared and reference known actions.");
}

function checkContextConstraints(model: PolicyModel): PolicyModelValidationCheck {
  const unique = checkUnique("context_constraints_unique", model.contextConstraints.map((constraint) => constraint.key));

  if (unique.status === "fail") {
    return unique;
  }

  for (const constraint of model.contextConstraints) {
    if (!supportedContextTypes.has(constraint.type)) {
      return fail("context_constraint_types_known", `Context constraint ${constraint.key} has unsupported type ${String(constraint.type)}.`);
    }
  }

  return pass("context_constraint_types_known", "Context constraint types are supported.");
}

function checkMigrations(model: PolicyModel): PolicyModelValidationCheck {
  let expectedFrom = model.version;
  const seenVersions = new Set([model.version]);

  for (const migration of model.migrations) {
    if (migration.fromVersion !== expectedFrom) {
      return fail("migrations_ordered", `Migration from ${migration.fromVersion} does not follow expected version ${expectedFrom}.`);
    }
    if (migration.toVersion === migration.fromVersion || seenVersions.has(migration.toVersion)) {
      return fail("migrations_acyclic", `Migration ${migration.fromVersion} -> ${migration.toVersion} would create a policy version cycle.`);
    }
    if (migration.operations.length === 0) {
      return fail("migrations_have_operations", `Migration ${migration.fromVersion} -> ${migration.toVersion} must declare operations.`);
    }
    seenVersions.add(migration.toVersion);
    expectedFrom = migration.toVersion;
  }
  return pass("migrations_ordered", "Migrations are ordered and reviewable.");
}

function checkGeneratedMetadata(model: PolicyModel): PolicyModelValidationCheck {
  const source = model.metadata?.source ?? model.metadata?.generatedBy;
  if (source === "llm") {
    return {
      name: "generated_policy_validated",
      status: "warn",
      message: "Generated policy metadata is allowed only after the same deterministic validation passes."
    };
  }
  return pass("generated_policy_validated", "No generated-policy bypass metadata is present.");
}

function pass(name: string, message: string): PolicyModelValidationCheck {
  return { name, status: "pass", message };
}

function fail(name: string, message: string): PolicyModelValidationCheck {
  return { name, status: "fail", message };
}
