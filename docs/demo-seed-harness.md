# Demo Seed Harness

The demo seed harness is the canonical synthetic local dataset for developer quickstarts and evaluation walkthroughs. It creates deterministic subjects, resources, relationships, a policy model fixture, decision request presets, and evidence labels without live tenant data.

## Canonical Module

Use `createDemoSeedHarness()` from `@access-kit/core` when an example needs the full manifest. Use `createDemoSeedData()` when a runtime only needs `RebacSeedData`.

```ts
import { createDemoSeedHarness, InMemoryRebacStore, RebacDecisionEngine } from "@access-kit/core";

const harness = createDemoSeedHarness();
const store = new InMemoryRebacStore(harness.seed);
const engine = new RebacDecisionEngine(store, { now: () => harness.generatedAt });

const quickstart = harness.decisionRequests.find((request) => request.name === "quickstart-allow-case-plan");
const result = quickstart ? engine.explain(quickstart.request) : undefined;
```

The checked example manifest at `examples/demo-seed-harness.json` lists the stable IDs and labels future quickstart, collection, SDK, and evaluation slices should reuse.

## Safety Boundary

All harness data is:

- synthetic and deterministic
- bounded to `tenant:local-demo`
- labeled as local proof-point evidence
- explicit that it is not production ATO approval
- free of live tenant identifiers, emails, secrets, tokens, customer names, and production logs

## Decision Presets

| Name | Path | Expected result |
| --- | --- | --- |
| `quickstart-allow-case-plan` | `user:alice` reads `document:case-plan` | `allow`, `ALLOW_VIA_RELATIONSHIP_PATH` |
| `quickstart-deny-default` | `user:external-reviewer` reads `document:case-plan` | `deny`, `DENY_DEFAULT_NO_RELATIONSHIP_PATH` |
| `evaluation-write-case-plan` | `user:alice` writes `document:case-plan` | `allow`, `ALLOW_VIA_RELATIONSHIP_PATH` |
| `evaluation-explicit-deny-restricted-notes` | `user:alice` reads `document:restricted-notes` | `deny`, `DENY_EXPLICIT_OVERRIDE` |
| `evaluation-suspended-subject` | `user:bob` reads `document:case-plan` | `deny`, `DENY_SUBJECT_NOT_ACTIVE` |
| `evaluation-owner-admin-case-plan` | `user:case-owner` administers `document:case-plan` | `allow`, `ALLOW_VIA_RELATIONSHIP_PATH` |

## Evidence Labels

| Label | Audience | Controls |
| --- | --- | --- |
| `quickstart-local-proof-point` | Five-minute quickstart | `AC-3`, `AU-2` |
| `evaluation-policy-proof-points` | Thirty-minute evaluation | `AC-3`, `CM-3` |
| `evaluation-ato-evidence` | Thirty-minute evaluation | `AC-2`, `AC-3`, `AC-6`, `AU-2`, `AU-6` |
| `evaluation-drift-and-reconciliation` | Thirty-minute evaluation | `AC-6`, `CA-7` |

Use the evaluation presets through [Developer Evaluation Path](developer-evaluation-path.md). Keep new quickstart, API collection, SDK, and evaluation examples on these IDs unless a future backlog slice intentionally revs `DEMO_SEED_VERSION`.
