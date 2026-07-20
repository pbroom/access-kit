import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  InMemoryRebacStore,
  RebacDecisionEngine,
  type RebacSeedData,
  type RelationshipTuple,
  type Resource,
  type Subject
} from "../../packages/core/src/index.js";

const now = "2026-05-21T17:00:00.000Z";
const grantRelations = ["viewer_of", "reader_of", "contributor_to", "owner_of", "admin_of"] as const;
const allRelations = [
  "member_of",
  "contains",
  ...grantRelations,
  "denied",
  "denied_read",
  "quarantined_from"
] as const;

interface RandomGraph {
  seed: RebacSeedData;
  subjectId: string;
  resourceId: string;
  tenantId: string;
}

const randomGraph = fc.record({
  subjectCount: fc.integer({ min: 1, max: 4 }),
  groupCount: fc.integer({ min: 1, max: 3 }),
  resourceCount: fc.integer({ min: 1, max: 4 }),
  tenantIndex: fc.integer({ min: 0, max: 1 }),
  relationshipSpecs: fc.array(
    fc.record({
      sourceKind: fc.constantFrom<"subject" | "group" | "resource">("subject", "group", "resource"),
      sourceIndex: fc.nat(5),
      targetKind: fc.constantFrom<"group" | "resource">("group", "resource"),
      targetIndex: fc.nat(5),
      relation: fc.constantFrom(...allRelations),
      tenantIndex: fc.integer({ min: 0, max: 1 })
    }),
    { minLength: 0, maxLength: 16 }
  )
}).map(createRandomGraph);

describe("RebacDecisionEngine property tests", () => {
  it("denies requests when generated graphs contain no grant-relation path", () => {
    fc.assert(fc.property(randomGraph, (graph) => {
      const store = new InMemoryRebacStore({
        ...graph.seed,
        relationships: (graph.seed.relationships ?? []).filter((relationship) => !grantRelations.includes(
          relationship.relation as typeof grantRelations[number]
        ))
      });

      expect(decide(store, graph.subjectId, graph.resourceId).decision).toBe("deny");
    }), { numRuns: 100 });
  });

  it("gives explicit denies precedence over generated allowed requests", () => {
    fc.assert(fc.property(randomGraph, (graph) => {
      const allowedSeed = withRelationship({
        ...graph.seed,
        relationships: (graph.seed.relationships ?? []).filter((relationship) =>
          !["denied", "denied_read", "quarantined_from"].includes(relationship.relation)
        )
      }, tuple(
        "relationship:forced-allow",
        graph.subjectId,
        "reader_of",
        graph.resourceId,
        graph.tenantId
      ));
      const allowedStore = new InMemoryRebacStore(allowedSeed);

      expect(decide(allowedStore, graph.subjectId, graph.resourceId).decision).toBe("allow");

      const deniedStore = new InMemoryRebacStore(withRelationship(allowedSeed, tuple(
        "relationship:forced-deny",
        graph.subjectId,
        "denied_read",
        graph.resourceId,
        graph.tenantId
      )));

      expect(decide(deniedStore, graph.subjectId, graph.resourceId)).toMatchObject({
        decision: "deny",
        reasonCode: "DENY_EXPLICIT_OVERRIDE"
      });
    }), { numRuns: 100 });
  });

  it("never turns a deny into an allow after removing a grant tuple", () => {
    fc.assert(fc.property(randomGraph, fc.constantFrom(...grantRelations), (graph, relation) => {
      const granted = tuple("relationship:removable-grant", graph.subjectId, relation, graph.resourceId, graph.tenantId);
      const denied = tuple("relationship:forced-deny", graph.subjectId, "denied", graph.resourceId, graph.tenantId);
      const seed = withRelationship(withRelationship(graph.seed, granted), denied);
      const initial = decide(new InMemoryRebacStore(seed), graph.subjectId, graph.resourceId);
      const afterRemoval = decide(
        new InMemoryRebacStore({
          ...seed,
          relationships: seed.relationships?.filter((relationship) => relationship.id !== granted.id)
        }),
        graph.subjectId,
        graph.resourceId
      );

      expect(initial.decision).toBe("deny");
      expect(afterRemoval.decision).toBe("deny");
    }), { numRuns: 100 });
  });

  it("never allows across tenant boundaries despite a direct grant", () => {
    fc.assert(fc.property(randomGraph, fc.integer({ min: 0, max: 3 }), (graph, resourceIndex) => {
      const resourceId = `document:cross-tenant-${resourceIndex}`;
      const otherTenantId = graph.tenantId === "tenant:0" ? "tenant:1" : "tenant:0";
      const seed: RebacSeedData = {
        ...graph.seed,
        resources: [
          ...(graph.seed.resources ?? []),
          resource(resourceId, otherTenantId)
        ],
        relationships: [
          ...(graph.seed.relationships ?? []),
          tuple("relationship:cross-tenant-grant", graph.subjectId, "reader_of", resourceId, graph.tenantId)
        ]
      };

      expect(decide(new InMemoryRebacStore(seed), graph.subjectId, resourceId)).toMatchObject({
        decision: "deny",
        reasonCode: "DENY_TENANT_BOUNDARY"
      });
    }), { numRuns: 100 });
  });

  it("produces identical decisions and reason codes for the same graph and asOf", () => {
    fc.assert(fc.property(randomGraph, (graph) => {
      const store = new InMemoryRebacStore(graph.seed);
      const engine = new RebacDecisionEngine(store, { now: () => now });
      const request = {
        subjectId: graph.subjectId,
        action: "read",
        resourceId: graph.resourceId,
        asOf: now
      };

      const first = engine.explain(request);
      const second = engine.explain(request);

      expect(second.decision).toBe(first.decision);
      expect(second.reasonCode).toBe(first.reasonCode);
    }), { numRuns: 100 });
  });
});

function createRandomGraph(input: {
  subjectCount: number;
  groupCount: number;
  resourceCount: number;
  tenantIndex: number;
  relationshipSpecs: Array<{
    sourceKind: "subject" | "group" | "resource";
    sourceIndex: number;
    targetKind: "group" | "resource";
    targetIndex: number;
    relation: typeof allRelations[number];
    tenantIndex: number;
  }>;
}): RandomGraph {
  const tenantId = `tenant:${input.tenantIndex}`;
  const subjects = Array.from({ length: input.subjectCount }, (_, index) => subject(`user:${index}`, tenantId));
  const groups = Array.from({ length: input.groupCount }, (_, index) => subject(`group:${index}`, tenantId, "group"));
  const resources = Array.from({ length: input.resourceCount }, (_, index) => resource(`document:${index}`, tenantId));
  const subjectNodes = [...subjects, ...groups];
  const containment = resources.slice(1).map((child, index) =>
    tuple(`relationship:contains-${index}`, resources[index]!.id, "contains", child.id, tenantId)
  );
  const relationships = input.relationshipSpecs.map((spec, index) => {
    const source = spec.sourceKind === "resource"
      ? resources[spec.sourceIndex % resources.length]!
      : spec.sourceKind === "group"
        ? groups[spec.sourceIndex % groups.length]!
        : subjects[spec.sourceIndex % subjects.length]!;
    const target = spec.targetKind === "group"
      ? groups[spec.targetIndex % groups.length]!
      : resources[spec.targetIndex % resources.length]!;

    return tuple(`relationship:random-${index}`, source.id, spec.relation, target.id, `tenant:${spec.tenantIndex}`);
  });

  return {
    seed: { subjects: subjectNodes, resources, relationships: [...containment, ...relationships] },
    subjectId: subjects[0]!.id,
    resourceId: resources[0]!.id,
    tenantId
  };
}

function decide(store: InMemoryRebacStore, subjectId: string, resourceId: string) {
  return new RebacDecisionEngine(store, { now: () => now }).explain({
    subjectId,
    action: "read",
    resourceId,
    asOf: now
  });
}

function withRelationship(seed: RebacSeedData, relationship: RelationshipTuple): RebacSeedData {
  return { ...seed, relationships: [...(seed.relationships ?? []), relationship] };
}

function subject(id: string, tenantId: string, type: Subject["type"] = "user"): Subject {
  return {
    id,
    type,
    displayName: id,
    sourceSystem: "property-test",
    lifecycleState: "active",
    identifiers: {},
    attributes: { tenantId },
    version: "subject:property-v1",
    createdAt: now
  };
}

function resource(id: string, tenantId: string): Resource {
  return {
    id,
    type: "document",
    displayName: id,
    sourceSystem: "property-test",
    ownerId: "user:owner",
    dataStewardId: "user:steward",
    technicalOwnerId: "user:technical-owner",
    classification: "internal",
    lifecycleState: "active",
    attributes: { tenantId },
    version: "resource:property-v1",
    createdAt: now
  };
}

function tuple(
  id: string,
  subjectId: string,
  relation: string,
  objectId: string,
  tenantId: string
): RelationshipTuple {
  return {
    id,
    subjectId,
    relation,
    objectId,
    sourceSystem: "property-test",
    assertedAt: now,
    status: "active",
    attributes: { tenantId },
    version: "tuple:property-v1",
    createdAt: now
  };
}
