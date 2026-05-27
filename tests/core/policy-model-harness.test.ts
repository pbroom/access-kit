import { describe, expect, it } from "vitest";
import {
  createDefaultPolicyModel,
  evaluateIdempotencyProofPoint,
  InMemoryRebacStore,
  RebacDecisionEngine,
  validatePolicyModel,
  type IdempotencyProofPoint,
  type PolicyModel,
  type RelationshipTuple,
  type Resource,
  type Subject
} from "../../packages/core/src/index.js";

const now = "2026-05-25T20:00:00.000Z";
const later = "2026-05-26T20:00:00.000Z";

describe("policy model test harness", () => {
  it("keeps canonical action grants compatible across table-driven property cases", () => {
    const model = createDefaultPolicyModel();
    const grantRelations = new Set(model.relations.filter((relation) => relation.kind === "grant").map((relation) => relation.name));

    for (const action of model.actions) {
      expect(action.grants.length, `${action.name} should declare at least one grant relation`).toBeGreaterThan(0);
      expect(action.grants.every((grant) => grantRelations.has(grant))).toBe(true);
    }

    expect(validatePolicyModel(model).valid).toBe(true);
  });

  it("fuzzes malformed model mutations into deterministic validation failures", () => {
    const cases: Array<{ name: string; mutate: (model: PolicyModel) => void; expectedCheck: string }> = [
      {
        name: "duplicate resource types",
        mutate: (model) => {
          model.resourceTypes.push(structuredClone(model.resourceTypes[0]!));
        },
        expectedCheck: "resource_types_unique"
      },
      {
        name: "unknown parent type",
        mutate: (model) => {
          model.resourceTypes[1] = {
            ...model.resourceTypes[1]!,
            allowedParentTypes: ["sharepoint_site"]
          };
        },
        expectedCheck: "resource_parent_types_known"
      },
      {
        name: "missing canonical relation",
        mutate: (model) => {
          model.relations = model.relations.filter((relation) => relation.name !== "member_of");
        },
        expectedCheck: "canonical_relations_present"
      },
      {
        name: "empty action grants",
        mutate: (model) => {
          model.actions = model.actions.map((action) => action.name === "read" ? { ...action, grants: [] } : action);
        },
        expectedCheck: "action_grants_declared"
      },
      {
        name: "unknown inherited action",
        mutate: (model) => {
          model.inheritanceRules[0] = {
            ...model.inheritanceRules[0]!,
            actions: ["read", "teleport"]
          };
        },
        expectedCheck: "inheritance_actions_known"
      },
      {
        name: "unknown deny relation",
        mutate: (model) => {
          model.denyRules.push({
            name: "ghost-denial",
            relation: "ghost_denial",
            precedence: "override"
          });
        },
        expectedCheck: "deny_relations_known"
      },
      {
        name: "unknown classification action",
        mutate: (model) => {
          model.classificationConstraints[0] = {
            ...model.classificationConstraints[0]!,
            allowedActions: ["read", "teleport"]
          };
        },
        expectedCheck: "classification_actions_known"
      },
      {
        name: "unknown context constraint type",
        mutate: (model) => {
          model.contextConstraints[0] = {
            ...model.contextConstraints[0]!,
            type: "object" as "string"
          };
        },
        expectedCheck: "context_constraint_types_known"
      },
      {
        name: "unordered migration",
        mutate: (model) => {
          model.migrations = [
            { fromVersion: "policy:not-current", toVersion: "policy:next", operations: ["add relation reviewer_of"] }
          ];
        },
        expectedCheck: "migrations_ordered"
      },
      {
        name: "cyclic migration",
        mutate: (model) => {
          model.migrations = [
            { fromVersion: "policy:local-v1", toVersion: "policy:local-v1", operations: ["rename action read view"] }
          ];
        },
        expectedCheck: "migrations_acyclic"
      }
    ];

    for (const testCase of cases) {
      const model = createDefaultPolicyModel();
      testCase.mutate(model);
      const result = validatePolicyModel(model);

      expect(result.valid, testCase.name).toBe(false);
      expect(result.checks, testCase.name).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: testCase.expectedCheck, status: "fail" })
        ])
      );
    }
  });

  it("bounds cyclic and wide graph traversal without granting through noise", () => {
    const store = new InMemoryRebacStore({
      subjects: [
        subject("user:alice", "tenant:a"),
        subject("group:case-team", "tenant:a"),
        ...Array.from({ length: 80 }, (_, index) => subject(`group:noise-${index}`, "tenant:a"))
      ],
      resources: [
        resource("workspace:case", "workspace", "tenant:a"),
        resource("document:case-plan", "document", "tenant:a"),
        ...Array.from({ length: 80 }, (_, index) => resource(`document:noise-${index}`, "document", "tenant:a"))
      ],
      relationships: [
        tuple("relationship:alice-case-team", "user:alice", "member_of", "group:case-team", "tenant:a"),
        tuple("relationship:case-team-workspace", "group:case-team", "reader_of", "workspace:case", "tenant:a"),
        tuple("relationship:workspace-document", "workspace:case", "contains", "document:case-plan", "tenant:a"),
        tuple("relationship:case-team-cycle", "group:case-team", "member_of", "group:case-team", "tenant:a"),
        ...Array.from({ length: 80 }, (_, index) =>
          tuple(`relationship:noise-${index}`, "group:case-team", "viewer_of", `document:noise-${index}`, "tenant:a")
        )
      ]
    });
    const engine = new RebacDecisionEngine(store, { now: () => now });
    const startedAt = performance.now();

    const result = engine.explain({
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan"
    });

    expect(result.decision).toBe("allow");
    expect(result.relationshipPath).toHaveLength(3);
    expect(performance.now() - startedAt).toBeLessThan(250);
  });

  it("fails closed on cross-tenant resource lookup and traversal abuse fixtures", () => {
    const directStore = tenantStore([
      tuple("relationship:alice-foreign-document", "user:alice", "reader_of", "document:foreign-plan", "tenant:b")
    ]);
    const directResult = new RebacDecisionEngine(directStore, { now: () => now }).explain({
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:foreign-plan"
    });

    expect(directResult.decision).toBe("deny");
    expect(directResult.reasonCode).toBe("DENY_TENANT_BOUNDARY");
    expect(directResult.relationshipPath).toEqual([]);

    const traversalStore = tenantStore([
      tuple("relationship:alice-foreign-group", "user:alice", "member_of", "group:foreign-team", "tenant:b"),
      tuple("relationship:foreign-group-local-document", "group:foreign-team", "reader_of", "document:case-plan", "tenant:b")
    ]);
    const traversalResult = new RebacDecisionEngine(traversalStore, { now: () => now }).explain({
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan"
    });

    expect(traversalResult.decision).toBe("deny");
    expect(traversalResult.reasonCode).toBe("DENY_DEFAULT_NO_RELATIONSHIP_PATH");
    expect(traversalResult.relationshipPath).toEqual([]);
  });

  it("does not leak connector evidence details into denied tenant-boundary decisions", () => {
    const store = tenantStore([
      {
        ...tuple("relationship:connector-bleed", "user:alice", "reader_of", "document:foreign-plan", "tenant:b"),
        attributes: {
          tenantId: "tenant:b",
          connectorCursor: "cursor:tenant-b-secret",
          evidenceExportUrl: "s3://tenant-b/export.zip"
        }
      }
    ]);
    const engine = new RebacDecisionEngine(store, { now: () => now });

    const result = engine.explain({
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:foreign-plan"
    });

    expect(result.decision).toBe("deny");
    expect(JSON.stringify(result)).not.toContain("tenant-b-secret");
    expect(JSON.stringify(result)).not.toContain("tenant-b/export.zip");
    expect(JSON.stringify(store.listAuditEvents())).not.toContain("tenant-b-secret");
    expect(JSON.stringify(store.listAuditEvents())).not.toContain("tenant-b/export.zip");
  });

  it("keeps time-travel checks deterministic across relationship expiry", () => {
    const store = tenantStore([
      {
        ...tuple("relationship:temporary-read", "user:alice", "reader_of", "document:case-plan", "tenant:a"),
        expiresAt: "2026-05-26T00:00:00.000Z"
      }
    ]);
    const request = {
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan",
      policyVersion: "policy:model-harness-v1",
      relationshipVersion: "tuple-set:model-harness-v1"
    };

    const beforeExpiry = new RebacDecisionEngine(store, { now: () => now }).explain(request);
    const afterExpiry = new RebacDecisionEngine(store, { now: () => later }).explain(request);

    expect(beforeExpiry).toMatchObject({
      decision: "allow",
      policyVersion: "policy:model-harness-v1",
      relationshipVersion: "tuple-set:model-harness-v1"
    });
    expect(afterExpiry).toMatchObject({
      decision: "deny",
      reasonCode: "DENY_DEFAULT_NO_RELATIONSHIP_PATH",
      policyVersion: "policy:model-harness-v1",
      relationshipVersion: "tuple-set:model-harness-v1"
    });
  });

  it("fails closed on policy caveats while keeping deterministic explanations typed", () => {
    const model = createAdvancedPolicyModel();
    const store = tenantStore([
      tuple("relationship:alice-local-document", "user:alice", "reader_of", "document:case-plan", "tenant:a")
    ]);
    const allowed = new RebacDecisionEngine(store, {
      now: () => now,
      policyModel: model
    }).explain({
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan",
      context: {
        riskScore: 22,
        deviceTrustLevel: "managed",
        accessTime: now
      }
    });

    expect(allowed.decision).toBe("allow");
    expect(allowed.constraints).toMatchObject({
      policyCaveats: {
        deterministic: true,
        policyModelVersion: "policy:local-v1",
        results: [
          {
            caveat: "low-risk-managed-device",
            relation: "reader_of",
            status: "pass"
          }
        ]
      }
    });

    const repeatedRelation = new RebacDecisionEngine(
      tenantStore([
        tuple("relationship:alice-case-team-reader", "user:alice", "reader_of", "group:case-team", "tenant:a"),
        tuple("relationship:case-team-document-reader", "group:case-team", "reader_of", "document:case-plan", "tenant:a")
      ]),
      {
        now: () => now,
        policyModel: model
      }
    ).explain({
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan",
      context: {
        riskScore: 22,
        deviceTrustLevel: "managed",
        accessTime: now
      }
    });
    const repeatedCaveats = repeatedRelation.constraints.policyCaveats as { results: unknown[] };

    expect(repeatedRelation.relationshipPath.map((step) => step.relation)).toEqual(["reader_of", "reader_of"]);
    expect(repeatedCaveats.results).toHaveLength(1);
    expect(repeatedCaveats.results).toEqual([
      expect.objectContaining({
        caveat: "low-risk-managed-device",
        relation: "reader_of",
        status: "pass"
      })
    ]);

    const missingDevice = new RebacDecisionEngine(store, {
      now: () => now,
      policyModel: model
    }).explain({
      subjectId: "user:alice",
      action: "read",
      resourceId: "document:case-plan",
      context: {
        riskScore: 22,
        accessTime: now
      }
    });

    expect(missingDevice).toMatchObject({
      decision: "deny",
      reasonCode: "DENY_POLICY_CAVEAT_UNSATISFIED",
      relationshipPath: [
        {
          subjectId: "user:alice",
          relation: "reader_of",
          objectId: "document:case-plan"
        }
      ]
    });
    expect(JSON.stringify(missingDevice.constraints)).not.toContain('"value"');
  });

  it("replays concurrent decision fixtures without losing audit events", async () => {
    const store = tenantStore([
      tuple("relationship:alice-local-document", "user:alice", "reader_of", "document:case-plan", "tenant:a")
    ]);
    const engine = new RebacDecisionEngine(store, { now: () => now });

    await Promise.all(
      Array.from({ length: 8 }, async (_, index) => {
        engine.check({
          subjectId: "user:alice",
          action: index % 2 === 0 ? "read" : "write",
          resourceId: "document:case-plan",
          policyVersion: `policy:replay-${index}`,
          relationshipVersion: `tuple-set:replay-${index}`
        });
      })
    );

    expect(store.listAuditEvents()).toHaveLength(8);
    expect(new Set(store.listAuditEvents().map((event) => event.eventId)).size).toBe(8);
    expect(store.listDecisions()).toHaveLength(8);
  });

  it("deduplicates idempotency collisions during replay", () => {
    const proof: IdempotencyProofPoint = {
      kind: "idempotency",
      name: "model harness idempotency collision",
      idempotencyKey: "idem:model-harness:grant",
      operations: [
        { id: "operation:1", idempotencyKey: "idem:model-harness:grant", operation: "grant read" },
        { id: "operation:2", idempotencyKey: "idem:model-harness:grant", operation: "grant read replay" },
        { id: "operation:3", idempotencyKey: "idem:model-harness:revoke", operation: "revoke read" }
      ],
      expectEffectiveOperations: 2
    };

    expect(evaluateIdempotencyProofPoint(proof)).toBe(2);
  });
});

function tenantStore(relationships: RelationshipTuple[]): InMemoryRebacStore {
  return new InMemoryRebacStore({
    subjects: [
      subject("user:alice", "tenant:a"),
      subject("group:case-team", "tenant:a"),
      subject("group:foreign-team", "tenant:b")
    ],
    resources: [
      resource("document:case-plan", "document", "tenant:a"),
      resource("document:foreign-plan", "document", "tenant:b")
    ],
    relationships
  });
}

function subject(id: string, tenantId: string): Subject {
  return {
    id,
    type: id.startsWith("group:") ? "group" : "user",
    displayName: id,
    sourceSystem: "model-harness",
    lifecycleState: "active",
    identifiers: {},
    attributes: { tenantId },
    version: "subject:model-harness",
    createdAt: now
  };
}

function createAdvancedPolicyModel(): PolicyModel {
  const model = createDefaultPolicyModel();
  model.contextConstraints = [
    { key: "riskScore", type: "number", required: true, auditable: true, min: 0, max: 100 },
    { key: "deviceTrustLevel", type: "string", required: true, auditable: true, maxLength: 32, allowedValues: ["managed", "trusted"] },
    { key: "accessTime", type: "datetime", required: true, auditable: true }
  ];
  model.caveats = [
    {
      name: "low-risk-managed-device",
      failClosed: true,
      reasonCode: "DENY_POLICY_CAVEAT_UNSATISFIED",
      conditions: [
        { source: "context", key: "riskScore", type: "number", operator: "less_than_or_equal", value: 35 },
        { source: "context", key: "deviceTrustLevel", type: "string", operator: "one_of", value: ["managed", "trusted"] },
        { source: "context", key: "accessTime", type: "datetime", operator: "before", value: "2026-05-27T00:00:00.000Z" }
      ]
    }
  ];
  model.conditionalRelationships = [
    { relation: "reader_of", actions: ["read"], caveats: ["low-risk-managed-device"] }
  ];
  model.explanation = {
    deterministic: true,
    includeContextKeys: ["riskScore", "deviceTrustLevel", "accessTime"],
    includeCaveatNames: ["low-risk-managed-device"]
  };
  return model;
}

function resource(id: string, type: Resource["type"], tenantId: string): Resource {
  return {
    id,
    type,
    displayName: id,
    sourceSystem: "model-harness",
    ownerId: "user:owner",
    dataStewardId: "user:steward",
    technicalOwnerId: "user:tech-owner",
    classification: "internal",
    lifecycleState: "active",
    attributes: { tenantId },
    version: "resource:model-harness",
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
    sourceSystem: "model-harness",
    assertedAt: now,
    status: "active",
    attributes: { tenantId },
    version: "tuple:model-harness",
    createdAt: now
  };
}
