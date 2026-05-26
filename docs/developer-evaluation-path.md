# Developer Evaluation Path

This path builds on the five-minute quickstart and runs the full local evaluation journey against the HTTP API in about 30 minutes. It uses only the synthetic demo seed harness and local proof-point evidence.

## Prerequisites

- Node 22 or newer
- pnpm 10 through Corepack
- A local `rebac-api` from the quickstart compose stack or `packages/api/src/bin.ts`

```sh
corepack enable
pnpm install --frozen-lockfile
```

## Start The API

Use the compose quickstart:

```sh
docker compose -f docker-compose.quickstart.yml up --build -d
```

Or run the API directly:

```sh
REBAC_API_KEYS=local-demo-token pnpm exec tsx packages/api/src/bin.ts
```

## Run The Evaluation

```sh
pnpm evaluation:demo
```

The runner waits for `/v1/health`, checks `/v1/ready`, upserts the demo harness subjects, resources, and relationships, creates and validates the demo policy fixture, runs policy proof-point tests, executes all evaluation check and explain presets, creates a dry-run provisioning plan and job, runs read-only connector sync and reconciliation, then exports audit and evidence packages.

Expected output includes:

```text
evaluation-write-case-plan: allow ALLOW_VIA_RELATIONSHIP_PATH
evaluation-explicit-deny-restricted-notes: deny DENY_EXPLICIT_OVERRIDE
evaluation-suspended-subject: deny DENY_SUBJECT_NOT_ACTIVE
evaluation-owner-admin-case-plan: allow ALLOW_VIA_RELATIONSHIP_PATH
provisioning: planned plan, completed dry-run job
reconciliation: 1 finding(s) from mock
```

Use `REBAC_API_URL` to target a different local API and `REBAC_API_KEY` to override the default local demo token.

## What The Runner Covers

| Step | API surface | Local proof point |
| --- | --- | --- |
| Seed harness | `POST /v1/subjects`, `POST /v1/resources`, `PUT /v1/relationships` | Synthetic tenant-bounded graph is loaded deterministically. |
| Policy tests | `POST /v1/policies`, `POST /v1/policies/{id}/validate` | The demo policy model validates and test mode confirms proof-point eligibility. |
| Decisions | `POST /v1/decision/check`, `POST /v1/decision/explain` | Allow, explicit deny, suspended subject deny, and owner admin paths match expected reason codes. |
| Dry-run provisioning | `POST /v1/provisioning/plans`, `POST /v1/provisioning/jobs` | Provider writes are skipped and verification records `providerWrite: false`. |
| Reconciliation | `POST /v1/connectors/{id}/sync`, `POST /v1/reconciliation/run` | Mock readback and drift findings remain dry-run and synthetic. |
| Evidence | `GET /v1/audit/export`, `GET /v1/evidence/export` | Audit integrity is verified and controls `AC-2`, `AC-3`, `AC-6`, `AU-2`, `AU-6`, `CA-7`, and `CM-3` are exported. |

## Safety Boundary

The evaluation path does not enable live connectors, perform provider writes, include production identifiers, or claim production ATO approval. The exported audit and evidence artifacts are local proof-point outputs for developer and assessor evaluation only.

For adoption fit, non-goals, production-readiness boundaries, integration patterns, and buyer, developer, and assessor checklists, read the [Product Positioning And Adoption Guide](product-positioning-adoption-guide.md) before treating this local run as evidence for a deployment plan.
