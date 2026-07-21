import type { JsonRecord, ResourceType, SubjectType, ValidationCheckStatus } from "./domain.js";

export const POLICY_MODEL_SCHEMA_VERSION = "access-kit.policy-model.v1";

export type PolicyModelRelationKind = "membership" | "grant" | "containment" | "deny";
export type PolicyModelContextType = "string" | "number" | "boolean" | "datetime";
export type PolicyModelTenantBoundarySource = "subject" | "resource" | "context";
export type PolicyModelCaveatConditionSource = "subject" | "resource" | "relationship" | "context" | "environment";
export type PolicyModelCaveatOperator =
  | "equals"
  | "one_of"
  | "less_than_or_equal"
  | "greater_than_or_equal"
  | "before"
  | "after";
export type PolicyModelCaveatValue = string | number | boolean | string[] | number[] | boolean[];

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
  auditable?: boolean;
  min?: number;
  max?: number;
  maxLength?: number;
  allowedValues?: Array<string | number | boolean>;
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

export interface PolicyModelCaveatCondition {
  source: PolicyModelCaveatConditionSource;
  key: string;
  type: PolicyModelContextType;
  operator: PolicyModelCaveatOperator;
  value: PolicyModelCaveatValue;
}

export interface PolicyModelCaveat {
  name: string;
  failClosed: true;
  reasonCode: string;
  conditions: PolicyModelCaveatCondition[];
}

export interface PolicyModelConditionalRelationship {
  relation: string;
  caveats: string[];
  actions?: string[];
}

export interface PolicyModelExplanationPolicy {
  deterministic: true;
  includeContextKeys: string[];
  includeCaveatNames: string[];
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
  caveats?: PolicyModelCaveat[];
  conditionalRelationships?: PolicyModelConditionalRelationship[];
  explanation?: PolicyModelExplanationPolicy;
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

const defaultActionGrants = new Map<string, string[]>([
  ["read", ["viewer_of", "reader_of", "contributor_to", "owner_of", "admin_of"]],
  ["view", ["viewer_of", "reader_of", "contributor_to", "owner_of", "admin_of"]],
  ["write", ["contributor_to", "owner_of", "admin_of"]],
  ["contribute", ["contributor_to", "owner_of", "admin_of"]],
  ["admin", ["owner_of", "admin_of"]],
  ["administer", ["owner_of", "admin_of"]],
  ["manage", ["owner_of", "admin_of"]]
]);

const supportedContextTypes = new Set<PolicyModelContextType>(["string", "number", "boolean", "datetime"]);
const supportedCaveatOperators = new Set<PolicyModelCaveatOperator>([
  "equals",
  "one_of",
  "less_than_or_equal",
  "greater_than_or_equal",
  "before",
  "after"
]);
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
    actions: [...defaultActionGrants].map(([name, grants]) => ({ name, grants })),
    inheritanceRules: [
      {
        name: "group-membership-grants",
        relation: "member_of",
        through: "member_of",
        actions: [...defaultActionGrants.keys()]
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
      { classification: "internal", allowedActions: [...defaultActionGrants.keys()] },
      { classification: "confidential", allowedActions: ["read", "view", "write", "contribute", "admin", "administer", "manage"] }
    ],
    tenantBoundary: {
      key: "tenantId",
      source: "resource",
      crossTenantTraversal: false
    },
    caveats: [],
    conditionalRelationships: [],
    explanation: {
      deterministic: true,
      includeContextKeys: [],
      includeCaveatNames: []
    },
    migrations: []
  };
}

export interface CompiledPolicyModel {
  membershipRelations: ReadonlySet<string>;
  containmentRelations: ReadonlySet<string>;
  grantRelationsByAction: ReadonlyMap<string, ReadonlySet<string>>;
  traversalRelationsByAction: ReadonlyMap<string, ReadonlySet<string>>;
  denyRelationsByAction: ReadonlyMap<string, ReadonlySet<string>>;
  unscopedDenyRelations: ReadonlySet<string>;
}

export function compilePolicyModel(model: PolicyModel): CompiledPolicyModel {
  const membershipRelations = new Set<string>();
  const containmentRelations = new Set<string>();
  const grantRelations = new Set<string>();
  const denyRelations = new Set<string>();

  for (const relation of model.relations) {
    switch (relation.kind) {
      case "membership":
        membershipRelations.add(relation.name);
        break;
      case "containment":
        containmentRelations.add(relation.name);
        break;
      case "grant":
        grantRelations.add(relation.name);
        break;
      case "deny":
        denyRelations.add(relation.name);
        break;
      default: {
        const unsupported: never = relation.kind;
        throw new Error(`Unsupported policy model relation kind: ${String(unsupported)}`);
      }
    }
  }

  const grantRelationsByAction = new Map<string, Set<string>>();
  for (const action of model.actions) {
    const actionKey = action.name.toLowerCase();
    const grants = grantRelationsByAction.get(actionKey) ?? new Set<string>();
    for (const grant of action.grants) {
      if (grantRelations.has(grant)) {
        grants.add(grant);
      }
    }
    grantRelationsByAction.set(actionKey, grants);
  }

  const traversalRelationsByAction = new Map<string, Set<string>>();
  for (const rule of model.inheritanceRules) {
    if (!membershipRelations.has(rule.through) && !containmentRelations.has(rule.through)) {
      continue;
    }
    for (const action of rule.actions) {
      const actionKey = action.toLowerCase();
      const relations = traversalRelationsByAction.get(actionKey) ?? new Set<string>();
      relations.add(rule.through);
      traversalRelationsByAction.set(actionKey, relations);
    }
  }

  const unscopedDenyRelations = new Set<string>();
  const scopedDenyRelationsByAction = new Map<string, Set<string>>();
  for (const rule of model.denyRules) {
    if (!denyRelations.has(rule.relation)) {
      continue;
    }
    if (!rule.actions) {
      unscopedDenyRelations.add(rule.relation);
      continue;
    }
    for (const action of rule.actions) {
      const actionKey = action.toLowerCase();
      const relations = scopedDenyRelationsByAction.get(actionKey) ?? new Set<string>();
      relations.add(rule.relation);
      scopedDenyRelationsByAction.set(actionKey, relations);
    }
  }

  const denyRelationsByAction = new Map<string, Set<string>>();
  for (const [actionKey, relations] of scopedDenyRelationsByAction) {
    denyRelationsByAction.set(actionKey, new Set([...unscopedDenyRelations, ...relations]));
  }

  return {
    membershipRelations,
    containmentRelations,
    grantRelationsByAction,
    traversalRelationsByAction,
    denyRelationsByAction,
    unscopedDenyRelations
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
  addCheck(checkRelations(model));
  addCheck(checkActionMappings(model, relationNames));
  addCheck(checkInheritanceRules(model, relationNames, actionNames));
  addCheck(checkDenyRules(model, relationNames, actionNames));
  addCheck(checkTenantBoundary(model));
  addCheck(checkClassificationConstraints(model, actionNames));
  for (const check of checkContextConstraints(model)) {
    addCheck(check);
  }
  addCheck(checkCaveats(model));
  for (const check of checkConditionalRelationships(model, relationNames, actionNames)) {
    addCheck(check);
  }
  addCheck(checkExplanationPolicy(model));
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

function checkRelations(model: PolicyModel): PolicyModelValidationCheck {
  for (const relation of model.relations) {
    if (relation.subjectTypes.length === 0 || relation.objectTypes.length === 0) {
      return fail("relation_endpoints_declared", `Relation ${relation.name} must declare subject and object types.`);
    }
  }
  return pass("relation_endpoints_declared", "Relations declare subject and object types.");
}

function checkActionMappings(model: PolicyModel, relationNames: Set<string>): PolicyModelValidationCheck {
  const grantRelations = relationNamesOfKind(model, "grant");
  for (const action of model.actions) {
    if (action.grants.length === 0) {
      return fail("action_grants_declared", `Action ${action.name} must map to at least one grant relation.`);
    }
    for (const grant of action.grants) {
      if (!relationNames.has(grant)) {
        return fail("action_grants_known", `Action ${action.name} references unknown relation ${grant}.`);
      }
      if (!grantRelations.has(grant)) {
        return fail("action_grants_grant_kind", `Action ${action.name} references relation ${grant}, which is not declared as a grant relation.`);
      }
    }
  }
  return pass("action_grants_grant_kind", "Action mappings reference declared grant relations.");
}

function checkInheritanceRules(model: PolicyModel, relationNames: Set<string>, actionNames: Set<string>): PolicyModelValidationCheck {
  if (model.inheritanceRules.length === 0) {
    return fail("inheritance_rules_declared", "At least one inheritance rule is required.");
  }
  const traversalRelations = new Set([
    ...relationNamesOfKind(model, "membership"),
    ...relationNamesOfKind(model, "containment")
  ]);
  for (const rule of model.inheritanceRules) {
    if (!relationNames.has(rule.relation)) {
      return fail("inheritance_relations_known", `Inheritance rule ${rule.name} references unknown relation ${rule.relation}.`);
    }
    if (!relationNames.has(rule.through)) {
      return fail("inheritance_paths_known", `Inheritance rule ${rule.name} references unknown traversal relation ${rule.through}.`);
    }
    if (!traversalRelations.has(rule.through)) {
      return fail(
        "inheritance_traversal_kinds",
        `Inheritance rule ${rule.name} traverses ${rule.through}, which is not declared as a membership or containment relation.`
      );
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
  if (model.denyRules.length === 0) {
    return fail("deny_rules_present", "At least one override deny rule is required to keep the deny-by-default posture.");
  }
  const denyRelations = relationNamesOfKind(model, "deny");
  for (const rule of model.denyRules) {
    if (!relationNames.has(rule.relation)) {
      return fail("deny_relations_known", `Deny rule ${rule.name} references unknown relation ${rule.relation}.`);
    }
    if (!denyRelations.has(rule.relation)) {
      return fail("deny_relations_deny_kind", `Deny rule ${rule.name} references relation ${rule.relation}, which is not declared as a deny relation.`);
    }
    if (rule.actions?.length === 0) {
      return fail("deny_actions_declared", `Deny rule ${rule.name} must declare at least one action when actions are scoped.`);
    }
    for (const action of rule.actions ?? []) {
      if (!actionNames.has(action)) {
        return fail("deny_actions_known", `Deny rule ${rule.name} references unknown action ${action}.`);
      }
    }
  }
  return pass("deny_rules_present", "Override deny rules are declared and reference declared deny relations.");
}

function relationNamesOfKind(model: PolicyModel, kind: PolicyModelRelationKind): Set<string> {
  return new Set(model.relations.filter((relation) => relation.kind === kind).map((relation) => relation.name));
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

function checkContextConstraints(model: PolicyModel): PolicyModelValidationCheck[] {
  const unique = checkUnique("context_constraints_unique", model.contextConstraints.map((constraint) => constraint.key));

  if (unique.status === "fail") {
    return [unique];
  }

  for (const constraint of model.contextConstraints) {
    if (!supportedContextTypes.has(constraint.type)) {
      return [fail("context_constraint_types_known", `Context constraint ${constraint.key} has unsupported type ${String(constraint.type)}.`)];
    }
    if (constraint.min !== undefined && constraint.max !== undefined && constraint.min > constraint.max) {
      return [fail("context_constraint_bounds_valid", `Context constraint ${constraint.key} declares min greater than max.`)];
    }
    if (constraint.maxLength !== undefined && (constraint.type !== "string" || constraint.maxLength < 1)) {
      return [fail("context_constraint_bounds_valid", `Context constraint ${constraint.key} has an invalid maxLength bound.`)];
    }
    if (constraint.allowedValues) {
      for (const value of constraint.allowedValues) {
        if (!valueMatchesType(value, constraint.type)) {
          return [fail("context_constraint_bounds_valid", `Context constraint ${constraint.key} has an allowed value with the wrong type.`)];
        }
      }
    }
  }

  return [
    pass("context_constraint_types_known", "Context constraint types are supported."),
    pass("context_constraint_bounds_valid", "Context constraint bounds are valid.")
  ];
}

function checkCaveats(model: PolicyModel): PolicyModelValidationCheck {
  const caveats = model.caveats ?? [];
  const contextConstraints = new Map(model.contextConstraints.map((constraint) => [constraint.key, constraint]));
  const unique = checkUnique("policy_caveats_unique", caveats.map((caveat) => caveat.name));

  if (unique.status === "fail") {
    return unique;
  }

  for (const caveat of caveats) {
    if (caveat.failClosed !== true || !caveat.reasonCode) {
      return fail("policy_caveats_fail_closed", `Policy caveat ${caveat.name} must declare a fail-closed reason code.`);
    }
    if (caveat.conditions.length === 0) {
      return fail("policy_caveat_conditions_declared", `Policy caveat ${caveat.name} must declare at least one condition.`);
    }
    for (const condition of caveat.conditions) {
      const conditionValidation = validateCaveatCondition(caveat, condition, contextConstraints);
      if (conditionValidation) {
        return conditionValidation;
      }
    }
  }

  return pass("policy_caveats_fail_closed", "Policy caveats are typed and fail closed.");
}

function validateCaveatCondition(
  caveat: PolicyModelCaveat,
  condition: PolicyModelCaveatCondition,
  contextConstraints: Map<string, PolicyModelContextConstraint>
): PolicyModelValidationCheck | undefined {
  if (!supportedContextTypes.has(condition.type) || !supportedCaveatOperators.has(condition.operator)) {
    return fail("policy_caveat_conditions_typed", `Policy caveat ${caveat.name} uses an unsupported condition type or operator.`);
  }
  if (!operatorMatchesType(condition.operator, condition.type)) {
    return fail(
      "policy_caveat_conditions_typed",
      `Policy caveat ${caveat.name} operator ${condition.operator} is not supported for ${condition.type}.`
    );
  }
  if (!conditionValueMatchesType(condition.value, condition.type, condition.operator)) {
    return fail("policy_caveat_conditions_typed", `Policy caveat ${caveat.name} compares ${condition.key} to a value with the wrong type.`);
  }
  if (condition.source === "context") {
    const contextConstraint = contextConstraints.get(condition.key);
    if (!contextConstraint) {
      return fail("policy_caveat_context_known", `Policy caveat ${caveat.name} references unknown context key ${condition.key}.`);
    }
    if (contextConstraint.type !== condition.type) {
      return fail("policy_caveat_conditions_typed", `Policy caveat ${caveat.name} type does not match context key ${condition.key}.`);
    }
    if (contextConstraint.required !== true || contextConstraint.auditable !== true) {
      return fail("policy_caveat_context_auditable", `Policy caveat ${caveat.name} requires ${condition.key} to be required and auditable.`);
    }
    if (!contextConstraintIsBounded(contextConstraint, condition)) {
      return fail("policy_caveat_context_bounded", `Policy caveat ${caveat.name} requires bounded context key ${condition.key}.`);
    }
  }
  if (condition.source === "environment" && (condition.key !== "evaluatedAt" || condition.type !== "datetime")) {
    return fail("policy_caveat_conditions_typed", `Policy caveat ${caveat.name} can only use environment.evaluatedAt datetime conditions.`);
  }
  return undefined;
}

function checkConditionalRelationships(
  model: PolicyModel,
  relationNames: Set<string>,
  actionNames: Set<string>
): PolicyModelValidationCheck[] {
  const caveatNames = new Set((model.caveats ?? []).map((caveat) => caveat.name));
  const relationActionBindings = new Set<string>();

  for (const conditional of model.conditionalRelationships ?? []) {
    if (!relationNames.has(conditional.relation)) {
      return [fail("conditional_relationships_known", `Conditional relationship references unknown relation ${conditional.relation}.`)];
    }
    if (conditional.caveats.length === 0) {
      return [fail("conditional_relationships_caveats_known", `Conditional relationship ${conditional.relation} must name at least one caveat.`)];
    }
    for (const caveat of conditional.caveats) {
      if (!caveatNames.has(caveat)) {
        return [fail("conditional_relationships_caveats_known", `Conditional relationship ${conditional.relation} references unknown caveat ${caveat}.`)];
      }
    }
    if (conditional.actions?.length === 0) {
      return [fail("conditional_relationships_actions_known", `Conditional relationship ${conditional.relation} must name at least one action when actions are declared.`)];
    }
    for (const action of conditional.actions ?? []) {
      if (!actionNames.has(action)) {
        return [fail("conditional_relationships_actions_known", `Conditional relationship ${conditional.relation} references unknown action ${action}.`)];
      }
    }

    const scopedActions = conditional.actions ?? [...actionNames].sort();
    const uniqueScopedActions = new Set(scopedActions);
    if (uniqueScopedActions.size !== scopedActions.length) {
      return [fail("conditional_relationships_unique", `Conditional relationship ${conditional.relation} declares duplicate actions.`)];
    }
    for (const action of uniqueScopedActions) {
      const binding = `${conditional.relation}:${action}`;
      if (relationActionBindings.has(binding)) {
        return [fail("conditional_relationships_unique", `Conditional relationship ${conditional.relation} has duplicate conditionals for action ${action}.`)];
      }
      relationActionBindings.add(binding);
    }
  }

  return [
    pass("conditional_relationships_unique", "Conditional relationship relation/action bindings are unique."),
    pass("conditional_relationships_known", "Conditional relationships reference known relations, actions, and caveats.")
  ];
}

function checkExplanationPolicy(model: PolicyModel): PolicyModelValidationCheck {
  const explanation = model.explanation;

  if (!explanation) {
    return pass("deterministic_explanation_policy", "No advanced explanation policy is declared.");
  }
  if (explanation.deterministic !== true) {
    return fail("deterministic_explanation_policy", "Explanation policy must be deterministic.");
  }

  const contextKeys = new Set(model.contextConstraints.map((constraint) => constraint.key));
  const caveatNames = new Set((model.caveats ?? []).map((caveat) => caveat.name));

  for (const key of explanation.includeContextKeys) {
    if (!contextKeys.has(key)) {
      return fail("deterministic_explanation_policy", `Explanation policy references unknown context key ${key}.`);
    }
  }
  for (const caveat of explanation.includeCaveatNames) {
    if (!caveatNames.has(caveat)) {
      return fail("deterministic_explanation_policy", `Explanation policy references unknown caveat ${caveat}.`);
    }
  }

  return pass("deterministic_explanation_policy", "Explanation policy references known context keys and caveats.");
}

function operatorMatchesType(operator: PolicyModelCaveatOperator, type: PolicyModelContextType): boolean {
  if (type === "datetime") {
    return operator === "before" || operator === "after";
  }
  if (operator === "before" || operator === "after") {
    return false;
  }
  if (operator === "less_than_or_equal" || operator === "greater_than_or_equal") {
    return type === "number";
  }
  return true;
}

function conditionValueMatchesType(
  value: PolicyModelCaveatValue,
  type: PolicyModelContextType,
  operator: PolicyModelCaveatOperator
): boolean {
  if (operator === "one_of") {
    return Array.isArray(value) && value.length > 0 && value.every((entry) => valueMatchesType(entry, type));
  }
  return !Array.isArray(value) && valueMatchesType(value, type);
}

function valueMatchesType(value: unknown, type: PolicyModelContextType): boolean {
  if (type === "datetime") {
    return typeof value === "string" && !Number.isNaN(Date.parse(value));
  }
  return typeof value === type;
}

function contextConstraintIsBounded(
  constraint: PolicyModelContextConstraint,
  condition: PolicyModelCaveatCondition
): boolean {
  if (constraint.type === "boolean") {
    return true;
  }
  if (constraint.allowedValues && constraint.allowedValues.length > 0) {
    return true;
  }
  if (constraint.type === "number") {
    return constraint.min !== undefined && constraint.max !== undefined;
  }
  if (constraint.type === "string") {
    return constraint.maxLength !== undefined && constraint.maxLength > 0;
  }
  return condition.operator === "before" || condition.operator === "after";
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
