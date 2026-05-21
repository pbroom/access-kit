import { describe, expect, it } from "vitest";
import {
  createLocalEngineSeed,
  InMemoryRebacStore,
  RebacDecisionEngine,
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

  it("emits append-only audit events for every decision", () => {
    const store = new InMemoryRebacStore(createLocalEngineSeed());
    const engine = new RebacDecisionEngine(store, { now: () => now });

    engine.check({ subjectId: "user:alice", action: "read", resourceId: "document:case-plan" });
    engine.check({ subjectId: "user:alice", action: "read", resourceId: "workspace:unknown" });

    const events = store.listAuditEvents();
    expect(events).toHaveLength(2);
    expect(events[0]?.eventType).toBe("decision.allowed");
    expect(events[1]?.eventType).toBe("decision.denied");
    expect(events[1]?.previousEventHash).toBe(events[0]?.payloadHash);
  });

  it("continues the audit hash chain after an engine restart", () => {
    const store = new InMemoryRebacStore(createLocalEngineSeed());
    const firstEngine = new RebacDecisionEngine(store, { now: () => now });
    firstEngine.check({ subjectId: "user:alice", action: "read", resourceId: "document:case-plan" });

    const restartedEngine = new RebacDecisionEngine(store, { now: () => now });
    restartedEngine.check({ subjectId: "user:alice", action: "read", resourceId: "workspace:unknown" });

    const events = store.listAuditEvents();
    expect(events).toHaveLength(2);
    expect(events[1]?.previousEventHash).toBe(events[0]?.payloadHash);
  });
});

function tuple(
  id: string,
  subjectId: string,
  relation: string,
  objectId: string
): RelationshipTuple {
  return {
    id,
    subjectId,
    relation,
    objectId,
    sourceSystem: "mock",
    assertedAt: now,
    status: "active",
    version: "tuple:v1",
    createdAt: now
  };
}
