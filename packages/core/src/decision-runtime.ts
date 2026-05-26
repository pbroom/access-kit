import { sha256 } from "./audit.js";
import type { DecisionRequest, JsonRecord, RelationshipTuple, Resource, Subject } from "./domain.js";
import type { RebacSeedData } from "./store.js";

export interface DecisionRuntimeVersionPins {
  policyVersion: string;
  modelVersion: string;
  relationshipVersion: string;
  tupleVersion: string;
  contextVersion: string;
  asOf: string;
}

export interface DecisionRuntimeVersionDefaults {
  policyVersion: string;
  modelVersion: string;
  relationshipVersion: string;
  tupleVersion: string;
  contextVersion?: string;
}

export interface DecisionTraversalBounds {
  maxDepth: number;
  maxRelationshipScans: number;
  maxVisitedNodes: number;
}

export type DecisionTraversalBound = keyof DecisionTraversalBounds;

export interface DecisionGraphSize {
  subjects: number;
  resources: number;
  relationships: number;
}

export interface DecisionTraversalReport {
  bounds: DecisionTraversalBounds;
  graphSize: DecisionGraphSize;
  relationshipScans: number;
  visitedNodes: number;
  maxDepthReached: number;
  boundsExceeded?: DecisionTraversalBound;
}

export interface DecisionLatencyTargets {
  targetMs: number;
  regressionGateMs: number;
}

export interface DecisionRuntimePerformanceReport {
  elapsedMs: number;
  targetMs: number;
  regressionGateMs: number;
  withinTarget: boolean;
  withinRegressionGate: boolean;
}

export interface DecisionRuntimeGraphFixture {
  name: "small" | "medium" | "large";
  minSubjects: number;
  minResources: number;
  minRelationships: number;
  latencyTargets: DecisionLatencyTargets;
}

export const DEFAULT_DECISION_TRAVERSAL_BOUNDS: DecisionTraversalBounds = {
  maxDepth: 16,
  maxRelationshipScans: 10_000,
  maxVisitedNodes: 2_000
};

export const DECISION_RUNTIME_GRAPH_FIXTURES: Record<DecisionRuntimeGraphFixture["name"], DecisionRuntimeGraphFixture> = {
  small: {
    name: "small",
    minSubjects: 10,
    minResources: 10,
    minRelationships: 50,
    latencyTargets: { targetMs: 25, regressionGateMs: 100 }
  },
  medium: {
    name: "medium",
    minSubjects: 100,
    minResources: 100,
    minRelationships: 1_000,
    latencyTargets: { targetMs: 75, regressionGateMs: 250 }
  },
  large: {
    name: "large",
    minSubjects: 500,
    minResources: 500,
    minRelationships: 5_000,
    latencyTargets: { targetMs: 150, regressionGateMs: 750 }
  }
};

export class DecisionTraversalGuard {
  readonly #bounds: DecisionTraversalBounds;
  readonly #graphSize: DecisionGraphSize;
  readonly #visitedNodes = new Set<string>();
  #relationshipScans = 0;
  #maxDepthReached = 0;
  #boundsExceeded: DecisionTraversalBound | undefined;

  constructor(bounds: DecisionTraversalBounds, graphSize: DecisionGraphSize, rootNodeId: string) {
    this.#bounds = bounds;
    this.#graphSize = graphSize;
    this.recordVisitedNode(rootNodeId);
  }

  get boundsExceeded(): DecisionTraversalBound | undefined {
    return this.#boundsExceeded;
  }

  recordRelationshipScan(): boolean {
    this.#relationshipScans += 1;
    return this.#requireWithinBound("maxRelationshipScans", this.#relationshipScans);
  }

  recordVisitedNode(nodeId: string): boolean {
    this.#visitedNodes.add(nodeId);
    return this.#requireWithinBound("maxVisitedNodes", this.#visitedNodes.size);
  }

  recordDepth(depth: number): boolean {
    this.#maxDepthReached = Math.max(this.#maxDepthReached, depth);
    return this.#requireWithinBound("maxDepth", depth);
  }

  report(): DecisionTraversalReport {
    return {
      bounds: this.#bounds,
      graphSize: this.#graphSize,
      relationshipScans: this.#relationshipScans,
      visitedNodes: this.#visitedNodes.size,
      maxDepthReached: this.#maxDepthReached,
      boundsExceeded: this.#boundsExceeded
    };
  }

  #requireWithinBound(bound: DecisionTraversalBound, value: number): boolean {
    if (value <= this.#bounds[bound]) {
      return true;
    }

    this.#boundsExceeded ??= bound;
    return false;
  }
}

export function normalizeDecisionRuntimeVersionPins(
  request: DecisionRequest,
  defaults: DecisionRuntimeVersionDefaults,
  evaluatedAt: string
): DecisionRuntimeVersionPins {
  return {
    policyVersion: request.policyVersion ?? defaults.policyVersion,
    modelVersion: request.modelVersion ?? defaults.modelVersion,
    relationshipVersion: request.relationshipVersion ?? defaults.relationshipVersion,
    tupleVersion: request.tupleVersion ?? defaults.tupleVersion,
    contextVersion: request.contextVersion ?? defaults.contextVersion ?? deriveContextVersion(request.context),
    asOf: request.asOf ?? evaluatedAt
  };
}

export function deriveContextVersion(context: JsonRecord | undefined): string {
  if (!context || Object.keys(context).length === 0) {
    return "context:none";
  }

  return `context:${sha256(context).slice(0, 16)}`;
}

export function mergeDecisionTraversalBounds(
  defaults: DecisionTraversalBounds,
  overrides: Partial<DecisionTraversalBounds> | undefined
): DecisionTraversalBounds {
  return {
    maxDepth: positiveIntegerOrDefault(overrides?.maxDepth, defaults.maxDepth),
    maxRelationshipScans: positiveIntegerOrDefault(overrides?.maxRelationshipScans, defaults.maxRelationshipScans),
    maxVisitedNodes: positiveIntegerOrDefault(overrides?.maxVisitedNodes, defaults.maxVisitedNodes)
  };
}

export function latencyTargetsForGraphSize(graphSize: DecisionGraphSize): DecisionLatencyTargets {
  if (
    graphSize.subjects >= DECISION_RUNTIME_GRAPH_FIXTURES.large.minSubjects ||
    graphSize.resources >= DECISION_RUNTIME_GRAPH_FIXTURES.large.minResources ||
    graphSize.relationships >= DECISION_RUNTIME_GRAPH_FIXTURES.large.minRelationships
  ) {
    return DECISION_RUNTIME_GRAPH_FIXTURES.large.latencyTargets;
  }

  if (
    graphSize.subjects >= DECISION_RUNTIME_GRAPH_FIXTURES.medium.minSubjects ||
    graphSize.resources >= DECISION_RUNTIME_GRAPH_FIXTURES.medium.minResources ||
    graphSize.relationships >= DECISION_RUNTIME_GRAPH_FIXTURES.medium.minRelationships
  ) {
    return DECISION_RUNTIME_GRAPH_FIXTURES.medium.latencyTargets;
  }

  return DECISION_RUNTIME_GRAPH_FIXTURES.small.latencyTargets;
}

export function createDecisionRuntimePerformanceReport(
  elapsedMs: number,
  targets: DecisionLatencyTargets
): DecisionRuntimePerformanceReport {
  const roundedElapsedMs = Number(elapsedMs.toFixed(3));

  return {
    elapsedMs: roundedElapsedMs,
    targetMs: targets.targetMs,
    regressionGateMs: targets.regressionGateMs,
    withinTarget: roundedElapsedMs <= targets.targetMs,
    withinRegressionGate: roundedElapsedMs <= targets.regressionGateMs
  };
}

export function createDecisionRuntimeGraphFixtureSeed(
  name: DecisionRuntimeGraphFixture["name"],
  createdAt = "2026-05-21T17:00:00.000Z"
): RebacSeedData {
  const fixture = DECISION_RUNTIME_GRAPH_FIXTURES[name];
  const groupCount = Math.max(1, fixture.minSubjects - 1);
  const resourceCount = Math.max(1, fixture.minResources - 1);
  const subjects: Subject[] = [
    {
      id: "user:runtime-subject",
      type: "user",
      displayName: "Runtime Subject",
      sourceSystem: "runtime-fixture",
      lifecycleState: "active",
      identifiers: { fixture: name },
      version: "subject:runtime-v1",
      createdAt
    },
    ...Array.from({ length: groupCount }, (_, index) => ({
      id: `group:runtime-${index}`,
      type: "group" as const,
      displayName: `Runtime Group ${index}`,
      sourceSystem: "runtime-fixture",
      lifecycleState: "active" as const,
      identifiers: { fixture: name, index: String(index) },
      version: "subject:runtime-v1",
      createdAt
    }))
  ];
  const resources: Resource[] = [
    {
      id: "document:runtime-target",
      type: "document",
      displayName: "Runtime Target",
      sourceSystem: "runtime-fixture",
      ownerId: "user:runtime-owner",
      dataStewardId: "user:runtime-steward",
      technicalOwnerId: "user:runtime-tech-owner",
      classification: "internal",
      lifecycleState: "active",
      version: "resource:runtime-v1",
      createdAt
    },
    ...Array.from({ length: resourceCount }, (_, index) => ({
      id: `document:runtime-${index}`,
      type: "document" as const,
      displayName: `Runtime Document ${index}`,
      sourceSystem: "runtime-fixture",
      ownerId: "user:runtime-owner",
      dataStewardId: "user:runtime-steward",
      technicalOwnerId: "user:runtime-tech-owner",
      classification: "internal",
      lifecycleState: "active" as const,
      version: "resource:runtime-v1",
      createdAt
    }))
  ];
  const relationships: RelationshipTuple[] = [
    createFixtureRelationship(
      "relationship:runtime-subject-group-0",
      "user:runtime-subject",
      "member_of",
      "group:runtime-0",
      createdAt
    ),
    createFixtureRelationship(
      "relationship:runtime-group-0-target",
      "group:runtime-0",
      "reader_of",
      "document:runtime-target",
      createdAt
    )
  ];

  for (let index = 0; relationships.length < fixture.minRelationships; index += 1) {
    relationships.push(
      createFixtureRelationship(
        `relationship:runtime-filler-${index}`,
        `group:runtime-${index % groupCount}`,
        "viewer_of",
        `document:runtime-${index % resourceCount}`,
        createdAt
      )
    );
  }

  return { subjects, resources, relationships };
}

function positiveIntegerOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function createFixtureRelationship(
  id: string,
  subjectId: string,
  relation: string,
  objectId: string,
  createdAt: string
): RelationshipTuple {
  return {
    id,
    subjectId,
    relation,
    objectId,
    sourceSystem: "runtime-fixture",
    assertedAt: createdAt,
    status: "active",
    version: "tuple:runtime-v1",
    createdAt
  };
}
