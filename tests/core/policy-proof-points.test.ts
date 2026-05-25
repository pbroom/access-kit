import { describe, expect, it } from "vitest";
import proofPoints from "../fixtures/policy/proof-points.json" assert { type: "json" };
import {
  createDecisionProofPointStore,
  type DriftFinding,
  evaluateDecisionProofPoint,
  evaluateIdempotencyProofPoint,
  type PolicyProofPoint,
  RebacDecisionEngine
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
    expect(names).toContain("deny unsupported action despite read relationship");
    expect(names).toContain("allow through relationship path");
    expect(names).toContain("allow through transitive reader relationship path");
    expect(names).toContain("allow through nested container relationship path");
    expect(names).toContain("allow through admin relationship path");
    expect(names).toContain("deny override beats allow path");
    expect(names).toContain("group-level deny override beats direct allow path");
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

  it("keeps decision proof-point fixtures aligned with the runtime engine", () => {
    for (const proof of proofPoints as PolicyProofPoint[]) {
      if (proof.kind !== "decision") {
        continue;
      }

      const proofPointResult = evaluateDecisionProofPoint(proof);
      const runtimeEngine = new RebacDecisionEngine(createDecisionProofPointStore(proof), {
        actor: "service:policy-proof-point-runtime-parity-test",
        now: () => proof.now,
        policyVersion: "policy:test-v1",
        relationshipVersion: "tuple-set:test-v1"
      });
      const runtimeResult = runtimeEngine.explain({
        subjectId: proof.subjectId,
        action: proof.action,
        resourceId: proof.resourceId
      });

      expect({
        decision: proofPointResult.decision,
        reasonCode: proofPointResult.reasonCode,
        relationshipPath: proofPointResult.relationshipPath
      }).toEqual({
        decision: runtimeResult.decision,
        reasonCode: runtimeResult.reasonCode,
        relationshipPath: runtimeResult.relationshipPath
      });
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
