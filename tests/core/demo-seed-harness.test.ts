import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createDemoSeedHarness,
  DEMO_POLICY_VERSION,
  DEMO_RELATIONSHIP_VERSION,
  DEMO_SEED_ID,
  DEMO_SEED_SOURCE_SYSTEM,
  DEMO_SEED_TENANT_ID,
  DEMO_SEED_TIMESTAMP,
  DEMO_SEED_VERSION,
  InMemoryRebacStore,
  RebacDecisionEngine,
  validatePolicyModel,
  type DemoSeedHarness
} from "../../packages/core/src/index.js";

describe("demo seed harness", () => {
  it("creates deterministic synthetic tenant-bounded seed data", () => {
    const harness = createDemoSeedHarness();
    const seed = harness.seed;

    expect(harness).toMatchObject({
      id: DEMO_SEED_ID,
      version: DEMO_SEED_VERSION,
      generatedAt: DEMO_SEED_TIMESTAMP,
      sourceSystem: DEMO_SEED_SOURCE_SYSTEM,
      tenantBoundary: DEMO_SEED_TENANT_ID,
      synthetic: true,
      localProofPoint: true,
      liveTenantData: false
    });
    expect(seed.subjects).toHaveLength(8);
    expect(seed.resources).toHaveLength(5);
    expect(seed.relationships).toHaveLength(10);
    expect(new Set(seed.subjects?.map((subject) => subject.id))).toHaveProperty("size", seed.subjects?.length);
    expect(new Set(seed.resources?.map((resource) => resource.id))).toHaveProperty("size", seed.resources?.length);
    expect(new Set(seed.relationships?.map((relationship) => relationship.id))).toHaveProperty("size", seed.relationships?.length);

    for (const entity of [...(seed.subjects ?? []), ...(seed.resources ?? []), ...(seed.relationships ?? [])]) {
      expect(entity.sourceSystem).toBe(DEMO_SEED_SOURCE_SYSTEM);
      expect(entity.createdAt).toBe(DEMO_SEED_TIMESTAMP);
      expect(entity.attributes).toMatchObject({
        tenantId: DEMO_SEED_TENANT_ID,
        seedHarnessId: DEMO_SEED_ID,
        synthetic: true,
        localProofPoint: true,
        liveTenantData: false
      });
    }
  });

  it("evaluates every decision preset with the expected result", () => {
    const harness = createDemoSeedHarness();
    const store = new InMemoryRebacStore(harness.seed);
    const engine = new RebacDecisionEngine(store, {
      now: () => harness.generatedAt,
      policyVersion: DEMO_POLICY_VERSION,
      relationshipVersion: DEMO_RELATIONSHIP_VERSION
    });

    for (const preset of harness.decisionRequests) {
      const result = engine.explain(preset.request);

      expect(result.decision, preset.name).toBe(preset.expectedDecision);
      expect(result.reasonCode, preset.name).toBe(preset.expectedReasonCode);
      expect(result.policyVersion, preset.name).toBe(DEMO_POLICY_VERSION);
      expect(result.relationshipVersion, preset.name).toBe(DEMO_RELATIONSHIP_VERSION);
      expect(result.constraints).toMatchObject({
        deterministic: true,
        denyByDefault: true,
        llmDecisioning: false,
        explain: true
      });
    }
  });

  it("packages a valid policy fixture and local proof-point evidence labels", () => {
    const harness = createDemoSeedHarness();

    expect(validatePolicyModel(harness.policy.model)).toMatchObject({ valid: true });
    expect(harness.policy.model.metadata).toMatchObject({
      seedHarnessId: DEMO_SEED_ID,
      source: DEMO_SEED_SOURCE_SYSTEM,
      tenantBoundary: DEMO_SEED_TENANT_ID,
      synthetic: true,
      localProofPoint: true,
      liveTenantData: false
    });
    expect(harness.policy.tests.map((test) => test.name)).toEqual(
      harness.decisionRequests.map((request) => request.name)
    );

    for (const label of harness.evidenceLabels) {
      expect(label.controls.length).toBeGreaterThan(0);
      expect(label.evidenceTypes.length).toBeGreaterThan(0);
      expect(label).toMatchObject({
        localProofPoint: true,
        synthetic: true,
        liveTenantData: false
      });
      expect(label.disclaimer).toContain("not production ATO approval");
    }

    expect(harness.quickstart.decisionRequestNames).toEqual([
      "quickstart-allow-case-plan",
      "quickstart-deny-default"
    ]);
    expect(harness.evaluation.evidenceLabelNames).toEqual([
      "evaluation-policy-proof-points",
      "evaluation-ato-evidence",
      "evaluation-drift-and-reconciliation"
    ]);
  });

  it("keeps policy fixture request contexts isolated from decision presets", () => {
    const harness = createDemoSeedHarness();
    const policyRequest = harness.policy.tests[0]?.request;
    const presetRequest = harness.decisionRequests[0]?.request;

    expect(policyRequest).toBeDefined();
    expect(presetRequest).toBeDefined();

    policyRequest!.context = {
      ...policyRequest!.context,
      purpose: "mutated-policy-fixture"
    };

    expect(presetRequest!.context).not.toMatchObject({ purpose: "mutated-policy-fixture" });
  });

  it("keeps the checked example manifest aligned with the core harness", () => {
    const harness = createDemoSeedHarness();
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), "examples/demo-seed-harness.json"), "utf8")
    ) as Record<string, unknown>;

    expect(manifest).toEqual(exampleManifestFor(harness));
  });
});

function exampleManifestFor(harness: DemoSeedHarness): Record<string, unknown> {
  return {
    id: harness.id,
    version: harness.version,
    generatedAt: harness.generatedAt,
    sourceSystem: harness.sourceSystem,
    tenantBoundary: harness.tenantBoundary,
    localProofPoint: harness.localProofPoint,
    synthetic: harness.synthetic,
    liveTenantData: harness.liveTenantData,
    counts: {
      subjects: harness.seed.subjects?.length ?? 0,
      resources: harness.seed.resources?.length ?? 0,
      relationships: harness.seed.relationships?.length ?? 0,
      decisionRequests: harness.decisionRequests.length,
      evidenceLabels: harness.evidenceLabels.length
    },
    seed: {
      subjects: harness.seed.subjects?.map((subject) => subject.id) ?? [],
      resources: harness.seed.resources?.map((resource) => resource.id) ?? [],
      relationships: harness.seed.relationships?.map((relationship) => relationship.id) ?? []
    },
    policy: {
      name: harness.policy.name,
      modelId: harness.policy.model.id,
      version: harness.policy.model.version,
      testNames: harness.policy.tests.map((test) => test.name)
    },
    decisionRequests: harness.decisionRequests.map((request) => ({
      name: request.name,
      audience: request.audience,
      subjectId: request.request.subjectId,
      action: request.request.action,
      resourceId: request.request.resourceId,
      expectedDecision: request.expectedDecision,
      expectedReasonCode: request.expectedReasonCode,
      evidenceLabels: request.evidenceLabels
    })),
    evidenceLabels: harness.evidenceLabels.map((label) => ({
      name: label.name,
      audience: label.audience,
      controls: label.controls,
      evidenceTypes: label.evidenceTypes
    })),
    quickstart: harness.quickstart,
    evaluation: harness.evaluation
  };
}
