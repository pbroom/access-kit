import { describe, expect, it } from "vitest";
import proofPoints from "../fixtures/policy/proof-points.json" assert { type: "json" };
import {
  createDecisionProofPointStore,
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
    expect(names).toContain("deny unsupported action despite read relationship");
    expect(names).toContain("allow through relationship path");
    expect(names).toContain("allow through transitive reader relationship path");
    expect(names).toContain("allow through nested container relationship path");
    expect(names).toContain("allow through admin relationship path");
    expect(names).toContain("deny override beats allow path");
    expect(names).toContain("group-level deny override beats direct allow path");
    expect(names).toContain("expired access is denied");
    expect(names).toContain("suspended user is denied");
    expect(names).toContain("suspended intermediate group is not traversed");
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

  it("applies intermediate graph-node lifecycle overrides", () => {
    const proof = (proofPoints as PolicyProofPoint[]).find(
      (candidate) => candidate.name === "suspended intermediate group is not traversed"
    );

    expect(proof?.kind).toBe("decision");

    if (proof?.kind === "decision") {
      const store = createDecisionProofPointStore(proof);
      expect(store.getSubject("group:suspended-reviewers")?.lifecycleState).toBe("suspended");
      expect(evaluateDecisionProofPoint(proof).reasonCode).toBe("DENY_DEFAULT_NO_RELATIONSHIP_PATH");
    }
  });

  it("rejects unclassified graph-node prefixes", () => {
    expect(() =>
      createDecisionProofPointStore({
        kind: "decision",
        name: "reject unknown prefix",
        subjectId: "user:alice",
        action: "read",
        resourceId: "document:case-plan",
        relationships: [
          {
            id: "relationship:unknown-prefix",
            subjectId: "user:alice",
            relation: "member_of",
            objectId: "external:partner-system",
            sourceSystem: "mock",
            assertedAt: "2026-05-21T17:00:00.000Z",
            status: "active",
            version: "tuple:v1",
            createdAt: "2026-05-21T17:00:00.000Z"
          }
        ],
        subjectStatus: "active",
        now: "2026-05-21T17:00:00.000Z",
        expect: "deny",
        expectedReasonCode: "DENY_DEFAULT_NO_RELATIONSHIP_PATH"
      })
    ).toThrow("Unrecognized policy proof-point graph node prefix");
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
