import { describe, expect, it } from "vitest";
import { resolveDriftLifecycleState, type DriftFinding } from "../../packages/core/src/index.js";

const now = "2026-05-26T12:00:00.000Z";

describe("resolveDriftLifecycleState", () => {
  it("preserves explicit lifecycle state over an expired exception timestamp", () => {
    expect(resolveDriftLifecycleState({
      ...createFinding(),
      lifecycleState: "repairing",
      status: "repairing",
      exceptionExpiresAt: "2026-05-25T12:00:00.000Z"
    }, now)).toBe("repairing");
  });

  it("marks implicit exception findings as expired after their exception window", () => {
    expect(resolveDriftLifecycleState({
      ...createFinding(),
      lifecycleState: undefined as unknown as DriftFinding["lifecycleState"],
      status: "accepted",
      exceptionExpiresAt: "2026-05-25T12:00:00.000Z"
    }, now)).toBe("expired_exception");
  });
});

function createFinding(): DriftFinding {
  return {
    id: "drift:test",
    resourceId: "resource:test",
    subjectId: "user:test",
    nativeAccess: "read",
    intendedAccess: "none",
    severity: "high",
    lifecycleState: "open",
    ownerId: "role:security-operations",
    assigneeId: "role:security-engineer",
    detectedAt: now,
    sourceConnectorId: "mock",
    recommendedAction: "exception",
    status: "open",
    scheduledReconciliation: {
      cadence: "daily",
      scheduledAt: now,
      nextRunAt: "2026-05-27T12:00:00.000Z",
      gracePeriodHours: 24,
      overdue: false
    },
    hookEvidence: [],
    remediation: {},
    autoRepairPolicy: {
      enabled: false,
      allowedActions: ["review"],
      maxSeverity: "high",
      requireApproval: true,
      requireConnectorReadiness: true,
      liveProviderWrites: false
    },
    version: "drift:v1",
    createdAt: now
  };
}
