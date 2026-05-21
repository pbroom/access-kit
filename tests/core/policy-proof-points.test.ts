import { describe, expect, it } from "vitest";
import proofPoints from "../fixtures/policy/proof-points.json" assert { type: "json" };
import {
  type DriftFinding,
  evaluateDecisionProofPoint,
  evaluateIdempotencyProofPoint,
  type PolicyProofPoint
} from "../../packages/core/src/index.js";

const validDriftStatuses = new Set<DriftFinding["status"]>([
  "open",
  "accepted",
  "repairing",
  "resolved"
]);

const validDriftRecommendedActions = new Set<DriftFinding["recommendedAction"]>([
  "revoke",
  "exception",
  "repair",
  "review"
]);

describe("policy proof points", () => {
  it("covers all required proof-point cases", () => {
    const names = proofPoints.map((proof) => proof.name);

    expect(names).toContain("deny by default without relationship path");
    expect(names).toContain("allow through relationship path");
    expect(names).toContain("allow through admin relationship path");
    expect(names).toContain("deny override beats allow path");
    expect(names).toContain("expired access is denied");
    expect(names).toContain("suspended user is denied");
    expect(names).toContain("duplicate event idempotency is specified");
    expect(names).toContain("drift is represented as security finding");
  });

  it("evaluates decision fixtures deterministically", () => {
    for (const proof of proofPoints as PolicyProofPoint[]) {
      if (proof.kind !== "decision") {
        continue;
      }

      const result = evaluateDecisionProofPoint(proof);
      expect(result.decision).toBe(proof.expect);
      expect(result.reasonCode).toBe(proof.expectedReasonCode);
      expect(result.constraints.llmDecisioning).toBe(false);
    }
  });

  it("deduplicates operations by idempotency key", () => {
    const proof = (proofPoints as PolicyProofPoint[]).find(
      (candidate) => candidate.kind === "idempotency"
    );

    expect(proof?.kind).toBe("idempotency");

    if (proof?.kind === "idempotency") {
      expect(evaluateIdempotencyProofPoint(proof)).toBe(proof.expectEffectiveOperations);
    }
  });

  it("represents drift as a first-class security finding", () => {
    const proof = (proofPoints as PolicyProofPoint[]).find((candidate) => candidate.kind === "drift");

    expect(proof?.kind).toBe("drift");

    if (proof?.kind === "drift") {
      expect(proof.finding.severity).toBe("high");
      expect(validDriftStatuses.has(proof.finding.status)).toBe(true);
      expect(validDriftRecommendedActions.has(proof.finding.recommendedAction)).toBe(true);
    }
  });
});
