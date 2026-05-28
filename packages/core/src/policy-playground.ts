import type { DecisionRequest, DecisionResult, JsonRecord } from "./domain.js";
import { RebacDecisionEngine } from "./engine.js";
import {
  createDemoSeedHarness,
  DEMO_POLICY_VERSION,
  DEMO_RELATIONSHIP_VERSION,
  DEMO_SEED_TIMESTAMP
} from "./demo-seed.js";
import {
  type PolicyModel,
  type PolicyModelContextType,
  type PolicyModelValidationCheck,
  type PolicyModelValidationResult,
  validatePolicyModel
} from "./policy-model.js";
import { InMemoryRebacStore, type RebacSeedData } from "./store.js";

export interface PolicyPlaygroundDecisionRequest {
  name: string;
  request: DecisionRequest;
  expectedDecision?: "allow" | "deny";
  expectedReasonCode?: string;
}

export interface PolicyPlaygroundInput {
  name?: string;
  model?: PolicyModel;
  seed?: RebacSeedData;
  context?: JsonRecord;
  requests?: PolicyPlaygroundDecisionRequest[];
  evaluatedAt?: string;
  policyVersion?: string;
  relationshipVersion?: string;
}

export interface PolicyPlaygroundRequestResult {
  name: string;
  request: DecisionRequest;
  contextValidation: PolicyModelValidationCheck[];
  decision?: DecisionResult;
  expectedDecision?: "allow" | "deny";
  expectedReasonCode?: string;
  matchedExpected?: boolean;
}

export interface PolicyPlaygroundResult {
  name: string;
  sandbox: {
    deterministic: true;
    nonWriting: true;
    storage: "in_memory_only";
    publishPolicy: "disabled";
    validationGate: "model_and_context_must_pass_before_evaluation";
    liveTenantData: false;
  };
  evaluatedAt: string;
  seedCounts: {
    subjects: number;
    resources: number;
    relationships: number;
  };
  modelValidation: PolicyModelValidationResult;
  requests: PolicyPlaygroundRequestResult[];
  skipped: boolean;
}

export function createDefaultPolicyPlaygroundInput(): PolicyPlaygroundInput {
  const harness = createDemoSeedHarness();

  return {
    name: "local-demo-policy-playground",
    model: harness.policy.model,
    seed: harness.seed,
    context: {
      purpose: "policy-playground",
      requestSource: "access-kit-policy-playground",
      tenantId: harness.tenantBoundary,
      synthetic: true,
      localProofPoint: true,
      liveTenantData: false
    },
    requests: harness.decisionRequests.map((preset) => ({
      name: preset.name,
      request: preset.request,
      expectedDecision: preset.expectedDecision,
      expectedReasonCode: preset.expectedReasonCode
    })),
    evaluatedAt: harness.generatedAt,
    policyVersion: DEMO_POLICY_VERSION,
    relationshipVersion: DEMO_RELATIONSHIP_VERSION
  };
}

export function runPolicyPlayground(input: PolicyPlaygroundInput = createDefaultPolicyPlaygroundInput()): PolicyPlaygroundResult {
  const playground = normalizeInput(input);
  const modelValidation = validatePolicyModel(playground.model);
  const store = new InMemoryRebacStore(structuredClone(playground.seed));
  const engine = new RebacDecisionEngine(store, {
    actor: "service:policy-playground",
    now: () => playground.evaluatedAt,
    policyVersion: playground.policyVersion,
    relationshipVersion: playground.relationshipVersion
  });
  const requests = playground.requests.map((entry) =>
    evaluatePlaygroundRequest(entry, playground.context, playground.model, modelValidation.valid, engine)
  );

  return {
    name: playground.name,
    sandbox: {
      deterministic: true,
      nonWriting: true,
      storage: "in_memory_only",
      publishPolicy: "disabled",
      validationGate: "model_and_context_must_pass_before_evaluation",
      liveTenantData: false
    },
    evaluatedAt: playground.evaluatedAt,
    seedCounts: {
      subjects: playground.seed.subjects?.length ?? 0,
      resources: playground.seed.resources?.length ?? 0,
      relationships: playground.seed.relationships?.length ?? 0
    },
    modelValidation,
    requests,
    skipped: !modelValidation.valid || requests.some((request) => request.decision === undefined)
  };
}

function normalizeInput(input: PolicyPlaygroundInput): Required<PolicyPlaygroundInput> {
  const defaults = createDefaultPolicyPlaygroundInput();

  return {
    name: input.name ?? defaults.name ?? "local-policy-playground",
    model: structuredClone(input.model ?? defaults.model!),
    seed: structuredClone(input.seed ?? defaults.seed!),
    context: structuredClone(input.context ?? defaults.context ?? {}),
    requests: structuredClone(input.requests ?? defaults.requests ?? []),
    evaluatedAt: input.evaluatedAt ?? defaults.evaluatedAt ?? DEMO_SEED_TIMESTAMP,
    policyVersion: input.policyVersion ?? input.model?.version ?? defaults.policyVersion ?? DEMO_POLICY_VERSION,
    relationshipVersion: input.relationshipVersion ?? defaults.relationshipVersion ?? DEMO_RELATIONSHIP_VERSION
  };
}

function evaluatePlaygroundRequest(
  entry: PolicyPlaygroundDecisionRequest,
  playgroundContext: JsonRecord,
  model: PolicyModel,
  modelIsValid: boolean,
  engine: RebacDecisionEngine
): PolicyPlaygroundRequestResult {
  const request: DecisionRequest = {
    ...entry.request,
    context: {
      ...playgroundContext,
      ...entry.request.context
    }
  };
  const contextValidation = validateRequestContext(model, request.context ?? {});

  if (!modelIsValid || contextValidation.some((check) => check.status === "fail")) {
    return {
      name: entry.name,
      request,
      contextValidation,
      expectedDecision: entry.expectedDecision,
      expectedReasonCode: entry.expectedReasonCode
    };
  }

  const decision = engine.explain(request);

  return {
    name: entry.name,
    request,
    contextValidation,
    decision,
    expectedDecision: entry.expectedDecision,
    expectedReasonCode: entry.expectedReasonCode,
    matchedExpected:
      entry.expectedDecision === undefined ||
      (decision.decision === entry.expectedDecision &&
        (entry.expectedReasonCode === undefined || decision.reasonCode === entry.expectedReasonCode))
  };
}

function validateRequestContext(model: PolicyModel, context: JsonRecord): PolicyModelValidationCheck[] {
  return model.contextConstraints.map((constraint) => {
    const value = context[constraint.key];

    if (value === undefined) {
      if (constraint.required) {
        return {
          name: `context.${constraint.key}`,
          status: "fail",
          message: `Required context key ${constraint.key} is missing.`
        };
      }
      return {
        name: `context.${constraint.key}`,
        status: "pass",
        message: `Optional context key ${constraint.key} is not present.`
      };
    }

    if (!valueMatchesContextType(value, constraint.type)) {
      return {
        name: `context.${constraint.key}`,
        status: "fail",
        message: `Context key ${constraint.key} must be ${constraint.type}.`
      };
    }

    return {
      name: `context.${constraint.key}`,
      status: "pass",
      message: `Context key ${constraint.key} matches ${constraint.type}.`
    };
  });
}

function valueMatchesContextType(value: unknown, type: PolicyModelContextType): boolean {
  if (type === "datetime") {
    return typeof value === "string" && !Number.isNaN(Date.parse(value));
  }
  return typeof value === type;
}
