import proofPoints from "../tests/fixtures/policy/proof-points.json" assert { type: "json" };
import {
  createDefaultPolicyModel,
  type DriftFinding,
  evaluateDecisionProofPoint,
  evaluateIdempotencyProofPoint,
  type PolicyProofPoint,
  validatePolicyModel
} from "../packages/core/src/index.js";

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

const requiredProofPointNames = new Set([
  "deny by default without relationship path",
  "deny unsupported action despite read relationship",
  "allow through relationship path",
  "allow through transitive reader relationship path",
  "allow through nested container relationship path",
  "allow through admin relationship path",
  "deny override beats allow path",
  "group-level deny override beats direct allow path",
  "expired access is denied",
  "suspended user is denied",
  "suspended intermediate group is not traversed",
  "duplicate event idempotency is specified",
  "drift is represented as security finding"
]);

const seen = new Set<string>();
const modelValidation = validatePolicyModel(createDefaultPolicyModel());

if (!modelValidation.valid) {
  throw new Error(
    `Default policy model failed validation: ${modelValidation.checks
      .filter((check) => check.status === "fail")
      .map((check) => check.message ?? check.name)
      .join("; ")}`
  );
}

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
      !validDriftStatuses.has(proof.finding.status) ||
      !validDriftRecommendedActions.has(proof.finding.recommendedAction) ||
      !proof.finding.ownerId ||
      !proof.finding.assigneeId ||
      !proof.finding.scheduledReconciliation ||
      proof.finding.autoRepairPolicy.liveProviderWrites
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
console.log(`PASS default policy model -> ${modelValidation.checks.length} checks`);
for (const name of seen) {
  console.log(`PASS ${name}`);
}
