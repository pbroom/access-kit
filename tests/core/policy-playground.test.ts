import { describe, expect, it } from "vitest";
import {
  createDefaultPolicyPlaygroundInput,
  runPolicyPlayground,
  type PolicyPlaygroundInput
} from "../../packages/core/src/index.js";

describe("policy playground", () => {
  it("runs deterministic local allow and deny explanations without production writes", () => {
    const input = createDefaultPolicyPlaygroundInput();
    const first = runPolicyPlayground(input);
    const second = runPolicyPlayground(input);

    expect(first.sandbox).toMatchObject({
      deterministic: true,
      nonWriting: true,
      storage: "in_memory_only",
      publishPolicy: "disabled",
      liveTenantData: false
    });
    expect(first.modelValidation.valid).toBe(true);
    expect(first.requests.map((request) => request.decision?.decision)).toContain("allow");
    expect(first.requests.map((request) => request.decision?.decision)).toContain("deny");
    expect(first.requests.every((request) => request.matchedExpected)).toBe(true);
    expect(first.requests.map((request) => request.decision?.decisionId)).toEqual(
      second.requests.map((request) => request.decision?.decisionId)
    );
  });

  it("blocks playground evaluation when the edited model fails validation", () => {
    const input = createDefaultPolicyPlaygroundInput();
    const invalid: PolicyPlaygroundInput = {
      ...input,
      model: {
        ...input.model!,
        actions: input.model!.actions.map((action) => action.name === "read" ? { ...action, grants: [] } : action)
      }
    };

    const result = runPolicyPlayground(invalid);

    expect(result.modelValidation.valid).toBe(false);
    expect(result.modelValidation.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "action_grants_declared", status: "fail" })
      ])
    );
    expect(result.skipped).toBe(true);
    expect(result.requests.every((request) => request.decision === undefined)).toBe(true);
  });

  it("requires typed request context before evaluating decisions", () => {
    const input = createDefaultPolicyPlaygroundInput();
    const result = runPolicyPlayground({
      ...input,
      context: {
        ...input.context,
        riskScore: "high"
      }
    });

    expect(result.modelValidation.valid).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.requests[0]?.contextValidation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "context.riskScore", status: "fail" })
      ])
    );
    expect(result.requests.every((request) => request.decision === undefined)).toBe(true);
  });

  it("accepts datetime context constraints backed by ISO timestamp strings", () => {
    const input = createDefaultPolicyPlaygroundInput();
    const result = runPolicyPlayground({
      ...input,
      model: {
        ...input.model!,
        contextConstraints: [
          ...input.model!.contextConstraints,
          { key: "requestedAt", type: "datetime", required: true }
        ]
      },
      context: {
        ...input.context,
        requestedAt: "2026-05-28T00:00:00Z"
      }
    });

    expect(result.skipped).toBe(false);
    expect(result.requests[0]?.contextValidation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "context.requestedAt", status: "pass" })
      ])
    );
  });
});
