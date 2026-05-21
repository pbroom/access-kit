import type { RebacSeedData } from "./store.js";

const timestamp = "2026-05-21T17:00:00.000Z";

export function createLocalEngineSeed(): RebacSeedData {
  return {
    subjects: [
      {
        id: "user:alice",
        type: "user",
        displayName: "Alice Example",
        sourceSystem: "mock",
        lifecycleState: "active",
        identifiers: { employeeId: "E-0001" },
        version: "subject:v1",
        createdAt: timestamp,
        lastSeenAt: timestamp
      },
      {
        id: "user:bob",
        type: "user",
        displayName: "Bob Suspended",
        sourceSystem: "mock",
        lifecycleState: "suspended",
        identifiers: { employeeId: "E-0002" },
        version: "subject:v1",
        createdAt: timestamp,
        lastSeenAt: timestamp
      },
      {
        id: "group:case-team",
        type: "group",
        displayName: "Case Team",
        sourceSystem: "mock",
        lifecycleState: "active",
        identifiers: { mockGroupId: "case-team" },
        version: "subject:v1",
        createdAt: timestamp,
        lastSeenAt: timestamp
      }
    ],
    resources: [
      {
        id: "workspace:case",
        type: "workspace",
        displayName: "Case Workspace",
        sourceSystem: "mock",
        ownerId: "user:owner",
        dataStewardId: "user:steward",
        technicalOwnerId: "user:tech-owner",
        classification: "internal",
        lifecycleState: "active",
        version: "resource:v1",
        createdAt: timestamp,
        lastSeenAt: timestamp
      },
      {
        id: "document:case-plan",
        type: "document",
        displayName: "Case Plan",
        sourceSystem: "mock",
        ownerId: "user:owner",
        dataStewardId: "user:steward",
        technicalOwnerId: "user:tech-owner",
        classification: "internal",
        lifecycleState: "active",
        parentId: "workspace:case",
        version: "resource:v1",
        createdAt: timestamp,
        lastSeenAt: timestamp
      }
    ],
    relationships: [
      {
        id: "relationship:alice-case-team",
        subjectId: "user:alice",
        relation: "member_of",
        objectId: "group:case-team",
        sourceSystem: "mock",
        assertedAt: timestamp,
        status: "active",
        version: "tuple:v1",
        createdAt: timestamp
      },
      {
        id: "relationship:case-team-workspace",
        subjectId: "group:case-team",
        relation: "contributor_to",
        objectId: "workspace:case",
        sourceSystem: "mock",
        assertedAt: timestamp,
        status: "active",
        version: "tuple:v1",
        createdAt: timestamp
      },
      {
        id: "relationship:workspace-document",
        subjectId: "workspace:case",
        relation: "contains",
        objectId: "document:case-plan",
        sourceSystem: "mock",
        assertedAt: timestamp,
        status: "active",
        version: "tuple:v1",
        createdAt: timestamp
      }
    ]
  };
}
