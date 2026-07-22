# Quickstart

Two paths: a five-minute seeded demo against the containerized API, and a thirty-minute evaluation that exercises the full local surface. Both use only the synthetic `tenant:local-demo` demo seed harness — no live connectors, no provider writes, no production identifiers.

## Prerequisites

- Node 22 or newer, pnpm 10 through Corepack, Docker with Compose v2

```sh
corepack enable
pnpm install --frozen-lockfile
```

## Five-minute demo

Start the API and run the seeded demo:

```sh
docker compose -f docker-compose.quickstart.yml up --build -d
pnpm quickstart:demo
```

The compose file builds the `rebac-api` image, binds it to `127.0.0.1:3000`, and sets `REBAC_API_KEYS=local-demo-token`. The runner waits for `/v1/health`, checks `/v1/ready`, upserts the demo subjects, resources, and relationships, then calls `check`, `explain`, and the audit event listing. Expected output includes:

```text
quickstart-allow-case-plan: allow ALLOW_VIA_RELATIONSHIP_PATH
quickstart-deny-default: deny DENY_DEFAULT_NO_RELATIONSHIP_PATH
```

Rerunning is safe; seed writes are upserts. To poke at the API yourself:

```sh
curl http://127.0.0.1:3000/v1/health
curl http://127.0.0.1:3000/v1/ready
```

Protected routes need the bearer token (`Authorization: Bearer local-demo-token`). `REBAC_API_URL` retargets the runners; `REBAC_API_KEY` overrides the token.

To stop, run `docker compose -f docker-compose.quickstart.yml down` (add `-v` to also reset the demo volume).

## Thirty-minute evaluation

With the same API running (or `REBAC_API_KEYS=local-demo-token pnpm exec tsx packages/api/src/bin.ts`):

```sh
pnpm evaluation:demo
```

| Step                 | API surface                                                        | What it proves                                                                                        |
| -------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Seed harness         | `POST /v1/subjects`, `POST /v1/resources`, `PUT /v1/relationships` | Synthetic tenant-bounded graph loads deterministically.                                               |
| Policy tests         | `POST /v1/policies`, `POST /v1/policies/{id}/validate`             | The demo policy model validates and proof-point tests pass.                                           |
| Decisions            | `POST /v1/decision/check`, `POST /v1/decision/explain`             | Allow, explicit deny, suspended-subject deny, and owner-admin paths return the expected reason codes. |
| Dry-run provisioning | `POST /v1/provisioning/plans`, `POST /v1/provisioning/jobs`        | Provider writes are skipped; verification records `providerWrite: false`.                             |
| Reconciliation       | `POST /v1/connectors/{id}/sync`, `POST /v1/reconciliation/run`     | Mock readback and drift findings stay dry-run and synthetic.                                          |
| Evidence             | `GET /v1/audit/export`, `GET /v1/evidence/export`                  | Audit integrity verifies and control-mapped evidence exports.                                         |

Expected output includes:

```text
evaluation-write-case-plan: allow ALLOW_VIA_RELATIONSHIP_PATH
evaluation-explicit-deny-restricted-notes: deny DENY_EXPLICIT_OVERRIDE
evaluation-suspended-subject: deny DENY_SUBJECT_NOT_ACTIVE
evaluation-owner-admin-case-plan: allow ALLOW_VIA_RELATIONSHIP_PATH
provisioning: planned plan, completed dry-run job
reconciliation: 1 finding(s) from mock
```

The exported audit and evidence artifacts are local proof-point outputs for developer and assessor evaluation, not evidence for a deployment plan. See the proof-point-versus-production table in [Start Here](start-here.md) before drawing production conclusions.

## The demo seed harness

The harness is the canonical synthetic dataset behind both runners and the API collections. `createDemoSeedHarness()` from `@access-kit/core` returns the full manifest; `createDemoSeedData()` returns just the seed. Stable IDs and labels live in [examples/demo-seed-harness.json](../examples/demo-seed-harness.json) — reuse them in new examples unless a backlog slice intentionally revs `DEMO_SEED_VERSION`.

```ts
import {
	createDemoSeedHarness,
	InMemoryRebacStore,
	RebacDecisionEngine,
} from '@access-kit/core';

const harness = createDemoSeedHarness();
const store = new InMemoryRebacStore(harness.seed);
const engine = new RebacDecisionEngine(store, {now: () => harness.generatedAt});
```

Decision presets and their expected outcomes:

| Name                                        | Path                                                | Expected result                             |
| ------------------------------------------- | --------------------------------------------------- | ------------------------------------------- |
| `quickstart-allow-case-plan`                | `user:alice` reads `document:case-plan`             | `allow`, `ALLOW_VIA_RELATIONSHIP_PATH`      |
| `quickstart-deny-default`                   | `user:external-reviewer` reads `document:case-plan` | `deny`, `DENY_DEFAULT_NO_RELATIONSHIP_PATH` |
| `evaluation-write-case-plan`                | `user:alice` writes `document:case-plan`            | `allow`, `ALLOW_VIA_RELATIONSHIP_PATH`      |
| `evaluation-explicit-deny-restricted-notes` | `user:alice` reads `document:restricted-notes`      | `deny`, `DENY_EXPLICIT_OVERRIDE`            |
| `evaluation-suspended-subject`              | `user:bob` reads `document:case-plan`               | `deny`, `DENY_SUBJECT_NOT_ACTIVE`           |
| `evaluation-owner-admin-case-plan`          | `user:case-owner` administers `document:case-plan`  | `allow`, `ALLOW_VIA_RELATIONSHIP_PATH`      |

## Policy playground

To experiment with policy models and tuples without an API server:

```sh
pnpm playground:policy
pnpm playground:policy examples/policy-playground.sample.json
```

Each run builds a fresh in-memory store from the input (`model`, `seed`, `context`, named `requests` with optional expected outcomes, and deterministic pins like `evaluatedAt`), validates the policy model and request context, evaluates only when those gates pass, and prints JSON to stdout. State is discarded on exit. The playground deliberately has no publish path — publishing stays behind the API/CLI flow with its validation, approval, change-ticket, and audit gates. When no input is given it uses the demo seed harness.

## Example applications

Two runnable synthetic apps show integration patterns end to end; their code and tests are the documentation:

- **SaaS app** ([examples/sample-saas-app/](../examples/sample-saas-app/), gate: `pnpm validate:sample-saas-app`) — a protected tenant-scoped route using the Express-style PEP middleware, fail-closed tenant boundaries, safe operator-only explain, correlation and decision-ID traceability, and a CI policy-test workflow.
- **Internal admin app** ([examples/internal-admin-app/](../examples/internal-admin-app/), gate: `pnpm validate:sample-admin-app`) — an elevated operator surface with a separate admin ReBAC graph, approval evidence before sensitive actions, break-glass handling with incident context and post-action review, and no local role fallback.
