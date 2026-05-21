import proofPoints from "../tests/fixtures/policy/proof-points.json" assert { type: "json" };
import {
  evaluateDecisionProofPoint,
  evaluateIdempotencyProofPoint,
  type PolicyProofPoint
} from "../packages/core/src/index.js";

const requiredProofPointNames = new Set([
  "deny by default without relationship path",
  "allow through relationship path",
  "deny override beats allow path",
  "expired access is denied",
  "suspended user is denied",
  "duplicate event idempotency is specified",
  "drift is represented as security finding"
]);

const seen = new Set<string>();

for (const proof of proofPoints as PolicyProofPoint[]) {
  seen.add(proof.name);

  if (proof.kind === "decision") {
    const result = evaluateDecisionProofPoint(proof);

    if (result.decision !== proof.expect || result.reasonCode !== proof.expectedReasonCode) {
      throw new Error(
        `Policy proof point failed: ${proof.name}. Expected ${proof.expect}/${proof.expectedReasonCode}, got ${result.decision}/${result.reasonCode}`
      );
    }
  }

  if (proof.kind === "idempotency") {
    const effectiveOperations = evaluateIdempotencyProofPoint(proof);

    if (effectiveOperations !== proof.expectEffectiveOperations) {
      throw new Error(
        `Idempotency proof point failed: ${proof.name}. Expected ${proof.expectEffectiveOperations}, got ${effectiveOperations}`
      );
    }
  }

  if (proof.kind === "drift") {
    if (
      proof.expect !== "valid_drift_finding" ||
      proof.finding.status !== "open" ||
      proof.finding.recommendedAction !== "revoke"
    ) {
      throw new Error(`Drift proof point failed: ${proof.name}`);
    }
  }
}

for (const required of requiredProofPointNames) {
  if (!seen.has(required)) {
    throw new Error(`Missing required policy proof point: ${required}`);
  }
}

console.log(`Validated ${seen.size} policy proof points.`);
for (const name of seen) {
  console.log(`PASS ${name}`);
}
