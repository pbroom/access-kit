import { describe, expect, it } from "vitest";
import {
  AuditRecorder,
  auditEventHash,
  createDecisionRuntimeGraphFixtureSeed,
  createLocalEngineSeed,
  InMemoryRebacStore,
  RebacDecisionEngine,
  verifyAuditChain,
  type DecisionRuntimePerformanceReport,
  type DecisionTraversalReport,
  type RelationshipTuple
} from "../../packages/core/src/index.js";

const now = "2026-05-21T17:00:00.000Z";

describe("RebacDecisionEngine", () => {
  it("allows a subject through a relationship path and explains the path", () => {
    const store = new InMemoryRebacStore(createLocalEngineSeed());
    const engine = new RebacDecisionEngine(store, { now: () => now });

    const result = engine.explain({
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan"
    });

    expect(result.decision).toBe("allow");
    expect(result.reasonCode).toBe("ALLOW_VIA_RELATIONSHIP_PATH");
    expect(result.relationshipPath).toEqual([
      { subjectId: "user:alice", relation: "member_of", objectId: "group:case-team" },
      { subjectId: "group:case-team", relation: "contributor_to", objectId: "workspace:case" },
      { subjectId: "workspace:case", relation: "contains", objectId: "document:case-plan" }
    ]);
  });

  it("records explicit version pins, historical timestamp, traversal metrics, and SLO metadata", () => {
    const store = new InMemoryRebacStore(createLocalEngineSeed());
    const engine = new RebacDecisionEngine(store, { now: () => now });

    const result = engine.explain({
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan",
      context: { purpose: "case-review" },
      policyVersion: "policy:pinned-v1",
      modelVersion: "model:pinned-v1",
      relationshipVersion: "tuple-set:pinned-v1",
      tupleVersion: "tuple:v1",
      contextVersion: "context:pinned-v1",
      asOf: now
    });
    const constraints = decisionRuntimeConstraints(result);

    expect(result).toMatchObject({
      decision: "allow",
      policyVersion: "policy:pinned-v1",
      modelVersion: "model:pinned-v1",
      relationshipVersion: "tuple-set:pinned-v1",
      tupleVersion: "tuple:v1",
      contextVersion: "context:pinned-v1",
      asOf: now
    });
    expect(constraints.timeTravel).toEqual({ asOf: now, evaluatedAt: now, historical: false });
    expect(constraints.traversal).toMatchObject({
      graphSize: { subjects: 3, resources: 2, relationships: 3 },
      bounds: { maxDepth: 16, maxRelationshipScans: 10000, maxVisitedNodes: 2000 },
      maxDepthReached: 3
    });
    expect(constraints.performance.withinRegressionGate).toBe(true);
    expect(store.listAuditEvents()[0]?.payload).toMatchObject({
      modelVersion: "model:pinned-v1",
      tupleVersion: "tuple:v1",
      contextVersion: "context:pinned-v1",
      asOf: now
    });
  });

  it("evaluates relationship expiration at a historical asOf timestamp", () => {
    const seed = createLocalEngineSeed();
    const historicalCreatedAt = "2026-05-21T00:00:00.000Z";
    const store = new InMemoryRebacStore({
      ...seed,
      subjects: seed.subjects?.map((subject) => ({ ...subject, createdAt: historicalCreatedAt })),
      resources: seed.resources?.map((resource) => ({ ...resource, createdAt: historicalCreatedAt })),
      relationships: [
        tuple(
          "relationship:alice-reader-document-expiring",
          "user:alice",
          "reader_of",
          "document:case-plan",
          undefined,
          {
            assertedAt: historicalCreatedAt,
            createdAt: historicalCreatedAt,
            expiresAt: "2026-05-21T12:00:00.000Z"
          }
        )
      ]
    });
    const engine = new RebacDecisionEngine(store, { now: () => now });

    const current = engine.explain({
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan"
    });
    const historical = engine.explain({
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan",
      asOf: "2026-05-21T11:59:00.000Z"
    });

    expect(current.reasonCode).toBe("DENY_DEFAULT_NO_RELATIONSHIP_PATH");
    expect(historical.reasonCode).toBe("ALLOW_VIA_RELATIONSHIP_PATH");
    expect(decisionRuntimeConstraints(historical).timeTravel.historical).toBe(true);
  });

  it("uses tuple-version pins to choose deterministic historical tuples", () => {
    const seed = createLocalEngineSeed();
    const store = new InMemoryRebacStore({
      ...seed,
      relationships: [
        tuple(
          "relationship:alice-denied-document-v1",
          "user:alice",
          "denied_read",
          "document:case-plan",
          undefined,
          { version: "tuple:legacy-v1" }
        ),
        tuple(
          "relationship:alice-reader-document-v2",
          "user:alice",
          "reader_of",
          "document:case-plan",
          undefined,
          { version: "tuple:current-v2" }
        )
      ]
    });
    const engine = new RebacDecisionEngine(store, { now: () => now });

    const legacy = engine.explain({
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan",
      tupleVersion: "tuple:legacy-v1"
    });
    const current = engine.explain({
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan",
      tupleVersion: "tuple:current-v2"
    });

    expect(legacy.reasonCode).toBe("DENY_EXPLICIT_OVERRIDE");
    expect(current.reasonCode).toBe("ALLOW_VIA_RELATIONSHIP_PATH");
  });

  it("fails closed when traversal bounds are exceeded", () => {
    const store = new InMemoryRebacStore(createLocalEngineSeed());
    const engine = new RebacDecisionEngine(store, {
      now: () => now,
      traversalBounds: { maxDepth: 1 }
    });

    const result = engine.explain({
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan"
    });

    expect(result.decision).toBe("deny");
    expect(result.reasonCode).toBe("DENY_TRAVERSAL_BOUND_EXCEEDED");
    expect(decisionRuntimeConstraints(result).traversal.boundsExceeded).toBe("maxDepth");
  });

  it("keeps the large graph-size fixture within the decision runtime regression gate", () => {
    const store = new InMemoryRebacStore(createDecisionRuntimeGraphFixtureSeed("large"));
    const engine = new RebacDecisionEngine(store, { now: () => now, tupleVersion: "tuple:runtime-v1" });

    const result = engine.explain({
      subjectId: "user:runtime-subject",
      action: "read",
      resourceId: "document:runtime-target"
    });
    const constraints = decisionRuntimeConstraints(result);

    expect(result.reasonCode).toBe("ALLOW_VIA_RELATIONSHIP_PATH");
    expect(constraints.traversal.graphSize).toMatchObject({
      subjects: 500,
      resources: 500,
      relationships: 5000
    });
    expect(constraints.performance).toMatchObject({
      targetMs: 150,
      regressionGateMs: 750,
      withinRegressionGate: true
    });
  });

  it("denies future historical timestamps", () => {
    const store = new InMemoryRebacStore(createLocalEngineSeed());
    const engine = new RebacDecisionEngine(store, { now: () => now });

    const result = engine.explain({
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan",
      asOf: "2026-05-22T17:00:00.000Z"
    });

    expect(result.decision).toBe("deny");
    expect(result.reasonCode).toBe("DENY_AS_OF_IN_FUTURE");
  });

  it("denies unsupported actions even when a read path exists", () => {
    const store = new InMemoryRebacStore(createLocalEngineSeed());
    const engine = new RebacDecisionEngine(store, { now: () => now });

    const result = engine.explain({
      subjectId: "user:alice",
      action: "delete",
      resourceId: "document:case-plan"
    });

    expect(result.decision).toBe("deny");
    expect(result.reasonCode).toBe("DENY_DEFAULT_NO_RELATIONSHIP_PATH");
    expect(result.relationshipPath).toEqual([]);
  });

  it("denies by default when no relationship path exists", () => {
    const store = new InMemoryRebacStore(createLocalEngineSeed());
    store.upsertResource({
      id: "document:orphan",
      type: "document",
      displayName: "Orphan Document",
      sourceSystem: "mock",
      ownerId: "user:owner",
      dataStewardId: "user:steward",
      technicalOwnerId: "user:tech-owner",
      classification: "internal",
      lifecycleState: "active",
      version: "resource:v1",
      createdAt: now
    });
    const engine = new RebacDecisionEngine(store, { now: () => now });

    const result = engine.explain({
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:orphan"
    });

    expect(result.decision).toBe("deny");
    expect(result.reasonCode).toBe("DENY_DEFAULT_NO_RELATIONSHIP_PATH");
  });

  it("does not traverse tenant-tagged relationships when the root request is untagged", () => {
    const seed = createLocalEngineSeed();
    const store = new InMemoryRebacStore({
      subjects: [
        {
          id: "user:global",
          type: "user",
          displayName: "Global User",
          sourceSystem: "mock",
          lifecycleState: "active",
          identifiers: {},
          version: "subject:v1",
          createdAt: now
        },
        {
          id: "group:tenant-a",
          type: "group",
          displayName: "Tenant A Group",
          sourceSystem: "mock",
          lifecycleState: "active",
          identifiers: {},
          attributes: { tenantId: "tenant:a" },
          version: "subject:v1",
          createdAt: now
        }
      ],
      resources: [
        {
          id: "document:global",
          type: "document",
          displayName: "Global Document",
          sourceSystem: "mock",
          ownerId: "user:owner",
          dataStewardId: "user:steward",
          technicalOwnerId: "user:tech-owner",
          classification: "internal",
          lifecycleState: "active",
          version: "resource:v1",
          createdAt: now
        }
      ],
      relationships: [
        tuple("relationship:global-tenant-group", "user:global", "member_of", "group:tenant-a", { tenantId: "tenant:a" }),
        tuple("relationship:tenant-group-global-document", "group:tenant-a", "reader_of", "document:global", { tenantId: "tenant:a" })
      ],
      auditEvents: seed.auditEvents
    });
    const engine = new RebacDecisionEngine(store, { now: () => now });

    const result = engine.explain({
      subjectId: "user:global",
      action: "read",
      resourceId: "document:global"
    });

    expect(result.decision).toBe("deny");
    expect(result.reasonCode).toBe("DENY_DEFAULT_NO_RELATIONSHIP_PATH");
    expect(result.relationshipPath).toEqual([]);
  });

  it("gives explicit deny precedence over an allow path", () => {
    const seed = createLocalEngineSeed();
    const deny: RelationshipTuple = {
      id: "relationship:alice-denied-document",
      subjectId: "user:alice",
      relation: "denied",
      objectId: "document:case-plan",
      sourceSystem: "mock",
      assertedAt: now,
      status: "active",
      version: "tuple:v1",
      createdAt: now
    };
    const store = new InMemoryRebacStore({
      ...seed,
      relationships: [...(seed.relationships ?? []), deny]
    });
    const engine = new RebacDecisionEngine(store, { now: () => now });

    const result = engine.explain({
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan"
    });

    expect(result.decision).toBe("deny");
    expect(result.reasonCode).toBe("DENY_EXPLICIT_OVERRIDE");
  });

  it("gives group-level deny paths precedence over allow paths", () => {
    const seed = createLocalEngineSeed();
    const store = new InMemoryRebacStore({
      ...seed,
      relationships: [
        ...(seed.relationships ?? []),
        tuple("relationship:case-team-denied-document", "group:case-team", "denied_read", "document:case-plan")
      ]
    });
    const engine = new RebacDecisionEngine(store, { now: () => now });

    const result = engine.explain({
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan"
    });

    expect(result.decision).toBe("deny");
    expect(result.reasonCode).toBe("DENY_EXPLICIT_OVERRIDE");
    expect(result.relationshipPath).toEqual([
      { subjectId: "user:alice", relation: "member_of", objectId: "group:case-team" },
      { subjectId: "group:case-team", relation: "denied_read", objectId: "document:case-plan" }
    ]);
  });

  it("does not follow containment while searching for explicit deny paths", () => {
    const seed = createLocalEngineSeed();
    const store = new InMemoryRebacStore({
      ...seed,
      relationships: [
        ...(seed.relationships ?? []),
        tuple("relationship:document-quarantined-workspace", "document:case-plan", "quarantined_from", "workspace:case")
      ]
    });
    const engine = new RebacDecisionEngine(store, { now: () => now });

    const result = engine.explain({
      subjectId: "user:alice",
      action: "read",
      resourceId: "workspace:case"
    });

    expect(result.decision).toBe("allow");
    expect(result.reasonCode).toBe("ALLOW_VIA_RELATIONSHIP_PATH");
    expect(result.relationshipPath).toEqual([
      { subjectId: "user:alice", relation: "member_of", objectId: "group:case-team" },
      { subjectId: "group:case-team", relation: "contributor_to", objectId: "workspace:case" }
    ]);
  });

  it("does not traverse past a target reached by a disallowed relation", () => {
    const seed = createLocalEngineSeed();
    const store = new InMemoryRebacStore({
      ...seed,
      relationships: [
        tuple("relationship:alice-viewer-workspace", "user:alice", "viewer_of", "workspace:case"),
        tuple("relationship:workspace-document", "workspace:case", "contains", "document:case-plan"),
        tuple("relationship:document-contributor-workspace", "document:case-plan", "contributor_to", "workspace:case")
      ]
    });
    const engine = new RebacDecisionEngine(store, { now: () => now });

    const result = engine.explain({
      subjectId: "user:alice",
      action: "write",
      resourceId: "workspace:case"
    });

    expect(result.decision).toBe("deny");
    expect(result.reasonCode).toBe("DENY_DEFAULT_NO_RELATIONSHIP_PATH");
  });

  it("upgrades queued graph nodes when a later path carries an action grant", () => {
    const seed = createLocalEngineSeed();
    const store = new InMemoryRebacStore({
      ...seed,
      relationships: [
        tuple("relationship:alice-member-workspace", "user:alice", "member_of", "workspace:case"),
        tuple("relationship:alice-contributor-workspace", "user:alice", "contributor_to", "workspace:case"),
        tuple("relationship:workspace-document", "workspace:case", "contains", "document:case-plan")
      ]
    });
    const engine = new RebacDecisionEngine(store, { now: () => now });

    const result = engine.explain({
      subjectId: "user:alice",
      action: "write",
      resourceId: "document:case-plan"
    });

    expect(result.decision).toBe("allow");
    expect(result.relationshipPath).toEqual([
      { subjectId: "user:alice", relation: "contributor_to", objectId: "workspace:case" },
      { subjectId: "workspace:case", relation: "contains", objectId: "document:case-plan" }
    ]);
  });

  it("denies suspended subjects even when they have a direct grant", () => {
    const seed = createLocalEngineSeed();
    const direct: RelationshipTuple = {
      id: "relationship:bob-reader-document",
      subjectId: "user:bob",
      relation: "reader_of",
      objectId: "document:case-plan",
      sourceSystem: "mock",
      assertedAt: now,
      status: "active",
      version: "tuple:v1",
      createdAt: now
    };
    const store = new InMemoryRebacStore({
      ...seed,
      relationships: [...(seed.relationships ?? []), direct]
    });
    const engine = new RebacDecisionEngine(store, { now: () => now });

    const result = engine.explain({
      subjectId: "user:bob",
      action: "read",
      resourceId: "document:case-plan"
    });

    expect(result.decision).toBe("deny");
    expect(result.reasonCode).toBe("DENY_SUBJECT_NOT_ACTIVE");
  });

  it("denies inactive subjects even when they have an allow path", () => {
    const seed = createLocalEngineSeed();
    const store = new InMemoryRebacStore({
      ...seed,
      subjects: seed.subjects?.map((subject) =>
        subject.id === "user:alice" ? { ...subject, lifecycleState: "inactive" } : subject
      )
    });
    const engine = new RebacDecisionEngine(store, { now: () => now });

    const result = engine.explain({
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan"
    });

    expect(result.decision).toBe("deny");
    expect(result.reasonCode).toBe("DENY_SUBJECT_NOT_ACTIVE");
  });

  it("does not allow through inactive intermediate graph nodes", () => {
    const seed = createLocalEngineSeed();
    const store = new InMemoryRebacStore({
      ...seed,
      subjects: seed.subjects?.map((subject) =>
        subject.id === "group:case-team" ? { ...subject, lifecycleState: "deleted" } : subject
      )
    });
    const engine = new RebacDecisionEngine(store, { now: () => now });

    const result = engine.explain({
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan"
    });

    expect(result.decision).toBe("deny");
    expect(result.reasonCode).toBe("DENY_DEFAULT_NO_RELATIONSHIP_PATH");
  });

  it("does not allow through missing intermediate graph nodes", () => {
    const seed = createLocalEngineSeed();
    const store = new InMemoryRebacStore({
      ...seed,
      subjects: seed.subjects?.filter((subject) => subject.id !== "group:case-team")
    });
    const engine = new RebacDecisionEngine(store, { now: () => now });

    const result = engine.explain({
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan"
    });

    expect(result.decision).toBe("deny");
    expect(result.reasonCode).toBe("DENY_DEFAULT_NO_RELATIONSHIP_PATH");
  });

  it("does not allow through inactive intermediate containers", () => {
    const seed = createLocalEngineSeed();
    const store = new InMemoryRebacStore({
      ...seed,
      resources: seed.resources?.map((resource) =>
        resource.id === "workspace:case" ? { ...resource, lifecycleState: "deleted" } : resource
      )
    });
    const engine = new RebacDecisionEngine(store, { now: () => now });

    const result = engine.explain({
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan"
    });

    expect(result.decision).toBe("deny");
    expect(result.reasonCode).toBe("DENY_DEFAULT_NO_RELATIONSHIP_PATH");
  });

  it("does not allow through missing intermediate containers", () => {
    const seed = createLocalEngineSeed();
    const store = new InMemoryRebacStore({
      ...seed,
      resources: seed.resources?.filter((resource) => resource.id !== "workspace:case")
    });
    const engine = new RebacDecisionEngine(store, { now: () => now });

    const result = engine.explain({
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan"
    });

    expect(result.decision).toBe("deny");
    expect(result.reasonCode).toBe("DENY_DEFAULT_NO_RELATIONSHIP_PATH");
  });

  it("does not treat lower-privilege permission edges as traversal hops", () => {
    const seed = createLocalEngineSeed();
    const store = new InMemoryRebacStore({
      ...seed,
      relationships: [
        tuple("relationship:alice-viewer-case-team", "user:alice", "viewer_of", "group:case-team"),
        tuple("relationship:case-team-admin-document", "group:case-team", "admin_of", "document:case-plan")
      ]
    });
    const engine = new RebacDecisionEngine(store, { now: () => now });

    const result = engine.explain({
      subjectId: "user:alice",
      action: "admin",
      resourceId: "document:case-plan"
    });

    expect(result.decision).toBe("deny");
    expect(result.reasonCode).toBe("DENY_DEFAULT_NO_RELATIONSHIP_PATH");
  });

  it("emits append-only audit events for every decision", () => {
    const store = new InMemoryRebacStore(createLocalEngineSeed());
    const engine = new RebacDecisionEngine(store, { now: () => now });

    engine.check({ subjectId: "user:alice", action: "read", resourceId: "document:case-plan" });
    engine.check({ subjectId: "user:alice", action: "read", resourceId: "workspace:unknown" });

    const events = store.listAuditEvents();
    expect(events).toHaveLength(2);
    expect(events[0]?.eventType).toBe("decision.allowed");
    expect(events[1]?.eventType).toBe("decision.denied");
    expect(events[0]?.payloadHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(events[1]?.previousEventHash).toBe(auditEventHash(events[0]!));
  });

  it("keeps check and explain decisions distinct for the same request timestamp", () => {
    const store = new InMemoryRebacStore(createLocalEngineSeed());
    const engine = new RebacDecisionEngine(store, { now: () => now });
    const request = { subjectId: "user:alice", action: "read", resourceId: "document:case-plan" };

    const check = engine.check(request);
    const explain = engine.explain(request);

    expect(check.decisionId).not.toBe(explain.decisionId);
    expect(store.listDecisions()).toHaveLength(2);
    expect(store.listAuditEvents()).toHaveLength(2);
  });

  it("keeps repeated same-timestamp audit events unique by chain position", () => {
    const store = new InMemoryRebacStore(createLocalEngineSeed());
    const engine = new RebacDecisionEngine(store, { now: () => now });
    const request = { subjectId: "user:alice", action: "read", resourceId: "document:case-plan" };

    engine.check(request);
    engine.check(request);

    const events = store.listAuditEvents();
    expect(events).toHaveLength(2);
    expect(events[0]?.eventId).not.toBe(events[1]?.eventId);
    expect(events[1]?.previousEventHash).toBe(auditEventHash(events[0]!));
  });

  it("continues the audit hash chain after an engine restart", () => {
    const store = new InMemoryRebacStore(createLocalEngineSeed());
    const firstEngine = new RebacDecisionEngine(store, { now: () => now });
    firstEngine.check({ subjectId: "user:alice", action: "read", resourceId: "document:case-plan" });

    const restartedEngine = new RebacDecisionEngine(store, { now: () => now });
    restartedEngine.check({ subjectId: "user:alice", action: "read", resourceId: "workspace:unknown" });

    const events = store.listAuditEvents();
    expect(events).toHaveLength(2);
    expect(events[1]?.previousEventHash).toBe(auditEventHash(events[0]!));
  });

  it("chains audit events using full previous event metadata", () => {
    const input = {
      eventType: "decision.allowed",
      actor: "service:decision-engine",
      subjectId: "user:alice",
      resourceId: "document:case-plan",
      correlationId: "corr:test",
      payload: {
        decisionId: "decision:test"
      }
    } as const;
    const recorder = new AuditRecorder();
    const first = recorder.record(input, now);
    const second = recorder.record({ ...input, eventType: "decision.denied" }, now);
    const tamperedRecorder = new AuditRecorder([{ ...first, actor: "service:tampered" }]);
    const afterTamper = tamperedRecorder.record({ ...input, eventType: "decision.denied" }, now);

    expect(second.previousEventHash).toBe(auditEventHash(first));
    expect(afterTamper.previousEventHash).not.toBe(second.previousEventHash);
  });

  it("verifies audit hash-chain integrity and reports tampering", () => {
    const recorder = new AuditRecorder();
    const first = recorder.record(
      {
        eventType: "decision.allowed",
        actor: "service:decision-engine",
        subjectId: "user:alice",
        resourceId: "document:case-plan",
        correlationId: "corr:test",
        payload: { decisionId: "decision:test" }
      },
      now
    );
    const second = recorder.record(
      {
        eventType: "decision.denied",
        actor: "service:decision-engine",
        subjectId: "user:alice",
        resourceId: "workspace:unknown",
        correlationId: "corr:test",
        payload: { decisionId: "decision:denied" }
      },
      now
    );

    const verified = verifyAuditChain([first, second], now);
    const tampered = verifyAuditChain([{ ...first, payload: { decisionId: "decision:tampered" } }, second], now);

    expect(verified).toMatchObject({
      status: "verified",
      eventCount: 2,
      findings: [],
      firstEventId: first.eventId,
      lastEventId: second.eventId
    });
    expect(tampered.status).toBe("failed");
    expect(tampered.findings.map((finding) => finding.code)).toEqual(expect.arrayContaining([
      "PAYLOAD_HASH_MISMATCH",
      "PREVIOUS_EVENT_HASH_MISMATCH"
    ]));
  });
});

function tuple(
  id: string,
  subjectId: string,
  relation: string,
  objectId: string,
  attributes?: Record<string, unknown>,
  overrides: Partial<RelationshipTuple> = {}
): RelationshipTuple {
  return {
    id,
    subjectId,
    relation,
    objectId,
    sourceSystem: "mock",
    attributes,
    assertedAt: now,
    status: "active",
    version: "tuple:v1",
    createdAt: now,
    ...overrides
  };
}

function decisionRuntimeConstraints(result: { constraints: Record<string, unknown> }): {
  timeTravel: { asOf: string; evaluatedAt: string; historical: boolean };
  traversal: DecisionTraversalReport;
  performance: DecisionRuntimePerformanceReport;
} {
  return result.constraints as {
    timeTravel: { asOf: string; evaluatedAt: string; historical: boolean };
    traversal: DecisionTraversalReport;
    performance: DecisionRuntimePerformanceReport;
  };
}
