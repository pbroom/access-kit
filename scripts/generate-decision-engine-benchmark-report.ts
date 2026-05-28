import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  InMemoryRebacStore,
  RebacDecisionEngine,
  type RebacSeedData,
  type RelationshipTuple,
  type Resource,
  type Subject
} from "../packages/core/src/index.js";

interface BenchmarkSample {
  relationships: number;
  coldEngineMs: number;
  warmMedianEngineMs: number;
  warmP95EngineMs: number;
  coldTotalMs: number;
  warmMedianTotalMs: number;
}

interface DecisionPerformanceConstraint {
  elapsedMs: number;
}

const reportPath = join(process.cwd(), "reports/decision-engine-benchmark.md");
const createdAt = "2026-05-21T17:00:00.000Z";
const iterations = 31;
const relationshipCounts = [5_000, 50_000, 100_000, 250_000, 500_000];

const baselineSamples: BenchmarkSample[] = [
  { relationships: 5_000, coldEngineMs: 3.039, warmMedianEngineMs: 1.792, warmP95EngineMs: 2.19, coldTotalMs: 4.068, warmMedianTotalMs: 1.858 },
  { relationships: 50_000, coldEngineMs: 19.722, warmMedianEngineMs: 16.984, warmP95EngineMs: 17.885, coldTotalMs: 19.835, warmMedianTotalMs: 17.068 },
  { relationships: 100_000, coldEngineMs: 37.586, warmMedianEngineMs: 35.153, warmP95EngineMs: 38.276, coldTotalMs: 37.683, warmMedianTotalMs: 35.257 },
  { relationships: 250_000, coldEngineMs: 97.598, warmMedianEngineMs: 87.258, warmP95EngineMs: 95.803, coldTotalMs: 97.693, warmMedianTotalMs: 87.392 },
  { relationships: 500_000, coldEngineMs: 191.331, warmMedianEngineMs: 177.591, warmP95EngineMs: 184.394, coldTotalMs: 191.427, warmMedianTotalMs: 177.707 }
];

const currentSamples = relationshipCounts.map((relationships) => runBenchmark(relationships));
await writeReport(baselineSamples, currentSamples);
console.log(`Wrote ${reportPath}`);

function runBenchmark(relationships: number): BenchmarkSample {
  const store = new InMemoryRebacStore(createBenchmarkSeed(relationships));
  const engine = new RebacDecisionEngine(store, { now: () => createdAt, tupleVersion: "tuple:bench" });
  const engineMs: number[] = [];
  const totalMs: number[] = [];

  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    const result = engine.explain({
      subjectId: "user:runtime-subject",
      action: "read",
      resourceId: "document:runtime-target"
    });
    totalMs.push(performance.now() - startedAt);
    engineMs.push(Number((result.constraints.performance as DecisionPerformanceConstraint).elapsedMs));

    if (result.reasonCode !== "ALLOW_VIA_RELATIONSHIP_PATH") {
      throw new Error(`Expected allow decision for ${relationships} relationships, got ${result.reasonCode}.`);
    }
  }

  return {
    relationships,
    coldEngineMs: round(engineMs[0] ?? 0),
    warmMedianEngineMs: round(percentile(engineMs.slice(1), 0.5)),
    warmP95EngineMs: round(percentile(engineMs.slice(1), 0.95)),
    coldTotalMs: round(totalMs[0] ?? 0),
    warmMedianTotalMs: round(percentile(totalMs.slice(1), 0.5))
  };
}

function createBenchmarkSeed(relationshipTarget: number): RebacSeedData {
  const groupCount = Math.max(100, Math.floor(relationshipTarget / 10));
  const resourceCount = Math.max(100, Math.floor(relationshipTarget / 10));
  const subjects: Subject[] = [
    subject("user:runtime-subject", "user"),
    ...Array.from({ length: groupCount }, (_, index) => subject(`group:${index}`, "group"))
  ];
  const resources: Resource[] = [
    resource("document:runtime-target"),
    ...Array.from({ length: resourceCount }, (_, index) => resource(`document:${index}`))
  ];
  const relationships: RelationshipTuple[] = [
    tuple("relationship:subject-group", "user:runtime-subject", "member_of", "group:0"),
    tuple("relationship:group-target", "group:0", "reader_of", "document:runtime-target")
  ];

  for (let index = 0; relationships.length < relationshipTarget; index += 1) {
    relationships.push(tuple(
      `relationship:filler:${index}`,
      `group:${index % groupCount}`,
      "viewer_of",
      `document:${index % resourceCount}`
    ));
  }

  return { subjects, resources, relationships };
}

function subject(id: string, type: Subject["type"]): Subject {
  return {
    id,
    type,
    displayName: id,
    sourceSystem: "benchmark",
    lifecycleState: "active",
    identifiers: { benchmark: "decision-engine" },
    attributes: { tenantId: "tenant:a" },
    version: "subject:bench",
    createdAt
  };
}

function resource(id: string): Resource {
  return {
    id,
    type: "document",
    displayName: id,
    sourceSystem: "benchmark",
    ownerId: "user:owner",
    dataStewardId: "user:steward",
    technicalOwnerId: "user:tech",
    classification: "internal",
    lifecycleState: "active",
    attributes: { tenantId: "tenant:a" },
    version: "resource:bench",
    createdAt
  };
}

function tuple(id: string, subjectId: string, relation: string, objectId: string): RelationshipTuple {
  return {
    id,
    subjectId,
    relation,
    objectId,
    sourceSystem: "benchmark",
    assertedAt: createdAt,
    status: "active",
    version: "tuple:bench",
    attributes: { tenantId: "tenant:a" },
    createdAt
  };
}

async function writeReport(before: BenchmarkSample[], after: BenchmarkSample[]): Promise<void> {
  const lines = [
    "# Decision Engine Benchmark",
    "",
    "This report compares the original TypeScript decision traversal against the optimized TypeScript traversal on a synthetic graph with a short reachable allow path and many unrelated relationships.",
    "",
    `- Iterations per size: ${iterations} (first run is cold, remaining runs feed the warm median and p95).`,
    "- Scenario: `user:runtime-subject -> group:0 -> document:runtime-target`, plus filler `viewer_of` relationships distributed across unrelated groups and documents.",
    "- Baseline source: pre-optimization run on `origin/main` before this branch changed the engine/store hot path.",
    "",
    "## Warm Median Engine Time",
    "",
    "```mermaid",
    "xychart-beta",
    "  title \"Warm median engine time by relationship count\"",
    `  x-axis [${after.map((sample) => compactRelationshipCount(sample.relationships)).join(", ")}]`,
    `  y-axis "ms" 0 --> ${Math.ceil(Math.max(...before.map((sample) => sample.warmMedianEngineMs)))}`,
    `  line "Before" [${before.map((sample) => sample.warmMedianEngineMs).join(", ")}]`,
    `  line "After" [${after.map((sample) => sample.warmMedianEngineMs).join(", ")}]`,
    "```",
    "",
    "## Results",
    "",
    "| Relationships | Before warm median engine ms | After warm median engine ms | Speedup | Before p95 engine ms | After p95 engine ms |",
    "| ---: | ---: | ---: | ---: | ---: | ---: |",
    ...after.map((sample, index) => {
      const baseline = before[index]!;
      return [
        sample.relationships.toLocaleString("en-US"),
        formatMs(baseline.warmMedianEngineMs),
        formatMs(sample.warmMedianEngineMs),
        `${formatRatio(baseline.warmMedianEngineMs / sample.warmMedianEngineMs)}x`,
        formatMs(baseline.warmP95EngineMs),
        formatMs(sample.warmP95EngineMs)
      ].join(" | ").replace(/^/, "| ").replace(/$/, " |");
    }),
    "",
    "## Visual Scale",
    "",
    "The headline chart uses the baseline scale, which makes the optimized line hug zero. These zoomed views avoid font-dependent text bars and make the post-optimization values readable.",
    "",
    "```mermaid",
    "xychart-beta",
    "  title \"After optimization latency zoom\"",
    `  x-axis [${after.map((sample) => compactRelationshipCount(sample.relationships)).join(", ")}]`,
    `  y-axis "microseconds" 0 --> ${chartCeiling(after.map((sample) => millisecondsToMicroseconds(sample.warmP95EngineMs)))}`,
    `  line "Warm median" [${after.map((sample) => millisecondsToMicroseconds(sample.warmMedianEngineMs)).join(", ")}]`,
    `  line "Warm p95" [${after.map((sample) => millisecondsToMicroseconds(sample.warmP95EngineMs)).join(", ")}]`,
    "```",
    "",
    "```mermaid",
    "xychart-beta",
    "  title \"Warm median speedup factor\"",
    `  x-axis [${after.map((sample) => compactRelationshipCount(sample.relationships)).join(", ")}]`,
    `  y-axis "x faster" 0 --> ${chartCeiling(after.map((sample, index) => speedup(before[index]!, sample)))}`,
    `  bar "Speedup" [${after.map((sample, index) => Math.round(speedup(before[index]!, sample))).join(", ")}]`,
    "```",
    "",
    "## Notes",
    "",
    "- The benchmark is intentionally shaped to expose the previous global relationship filtering/indexing cost. It is not a worst-case graph-explosion traversal.",
    "- The optimized engine lazily filters active relationships per visited subject and caches that subject index by relationship revision, `asOf`, and tuple-version scope.",
    "- The store now keeps relationship adjacency by subject, so unrelated graph size no longer dominates decisions with a short reachable path.",
    ""
  ];

  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${lines.join("\n")}\n`, "utf8");
}

function percentile(values: number[], percentileValue: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * percentileValue));
  return sorted[index] ?? 0;
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function formatMs(value: number): string {
  return value.toFixed(3);
}

function formatRatio(value: number): string {
  return value >= 100 ? value.toFixed(0) : value.toFixed(1);
}

function compactRelationshipCount(value: number): string {
  return `${value / 1_000}k`;
}

function millisecondsToMicroseconds(value: number): number {
  return Math.round(value * 1_000);
}

function speedup(before: BenchmarkSample, after: BenchmarkSample): number {
  return before.warmMedianEngineMs / after.warmMedianEngineMs;
}

function chartCeiling(values: number[]): number {
  const max = Math.max(...values);
  if (max < 1) {
    return Number((Math.ceil(max * 100) / 100).toFixed(2));
  }
  if (max < 100) {
    return Math.ceil(max / 10) * 10;
  }
  return Math.ceil(max / 1_000) * 1_000;
}
