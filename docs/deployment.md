# Deployment

This page answers: how is the `rebac-api` container built, verified, and deployed, and what must a production environment add around it? The container proof point is synthetic and local-first — no live tenant IDs, provider secrets, or provider write credentials are required anywhere in this flow.

## Build and run the image

```sh
docker build --target runtime --tag access-kit-rebac-api:local .
```

The Dockerfile uses Node 22, installs from the committed pnpm lockfile, builds the `@access-kit/api` dependency closure, and runs as the non-root `node` user. Container defaults:

- `REBAC_API_HOST=0.0.0.0`, `REBAC_API_PORT=3000`, `REBAC_API_ACTOR=service:api`
- `REBAC_STATE_PATH=/var/lib/access-kit/state/runtime-state.json`
- `REBAC_EVIDENCE_ROOT=/var/lib/access-kit/evidence`

Mount `/var/lib/access-kit` to keep runtime snapshots, graph/job JSON files, append-only audit JSONL, and local evidence across restarts. These are validation artifacts, not production storage. Because the container binds beyond loopback, it refuses to start unless `REBAC_API_KEYS` has at least one bearer token.

The default admin mode is `local_bearer_token`, which keeps the proof point runnable but makes `/v1/ready` report an `admin_authorization` warning. Production overlays must set `REBAC_ADMIN_AUTH_MODE=idp_gateway` or `mtls_gateway` plus evidence-backed `REBAC_ADMIN_*` descriptor settings, using external secret handles (`ref:` or vault URIs) — never inline secrets.

Smoke test with a synthetic token:

```sh
export REBAC_SMOKE_TOKEN="<synthetic-smoke-token>"
docker run --rm --detach --name rebac-api --publish 3000:3000 \
  --env REBAC_API_KEYS="$REBAC_SMOKE_TOKEN" \
  --volume access-kit-rebac-data:/var/lib/access-kit \
  access-kit-rebac-api:local

curl --fail http://127.0.0.1:3000/v1/health
curl --fail http://127.0.0.1:3000/v1/ready
curl --fail --oauth2-bearer "$REBAC_SMOKE_TOKEN" http://127.0.0.1:3000/v1/subjects
```

Protected routes return `401` without a token; `/v1/health` and `/v1/ready` stay public for orchestrator probes and expose no token material. The CI `Container packaging` job runs the same checks on every PR.

## Release and verification

The `Container Release` workflow publishes only on a `rebac-api-v*` tag or a manual dispatch with `publish=true`. It builds the same `runtime` target, pushes to GHCR, emits SBOM/provenance metadata, records a GitHub artifact attestation, and signs the digest with keyless cosign via GitHub OIDC.

Deploy by digest, never by tag — the digest is the deployment identity:

```sh
IMAGE_REF="ghcr.io/<owner>/<repo>/rebac-api@sha256:<digest>"

cosign verify \
  --certificate-identity-regexp "https://github.com/<owner>/<repo>/.github/workflows/container-release.yml@refs/tags/rebac-api-v.*" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  "$IMAGE_REF"

gh attestation verify --repo "<owner>/<repo>" "$IMAGE_REF"
```

Rollback is a digest change, not an in-place mutation: pick the last known-good signed digest, re-verify its signature and attestation, update deployment IaC, watch `/v1/ready`, `/v1/health`, authentication-failure audit volume, and audit writes, and record the rollback in the deployment evidence package. The operator procedure is in the [Deployment Runbook](deployment-runbook.md).

## Kubernetes manifests

Reference manifests live under `deploy/kubernetes/` (`kubectl apply -k deploy/kubernetes`). They wire immutable GHCR digest references, `/v1/ready` readiness and `/v1/health` startup/liveness probes, a `rebac-api-auth` secret reference, a persistent `/var/lib/access-kit` volume, restricted pod security, disabled service-account token automounting, and a network policy. They deliberately omit secret values, ingress, certificates, and identity-provider wiring.

A Kyverno signed-image admission policy example lives at `deploy/policies/kyverno/rebac-api-signed-image-policy.yaml`; keep it in audit mode until the target cluster has an approved exception process.

## Production reference architecture

The production-reference overlay under `deploy/overlays/production-reference/` composes the base manifests with `ref:` placeholders for every control a target environment must bind. It is a deployment map and evidence checklist — not a selected vendor architecture, an ATO, or permission to enable live provider writes.

```mermaid
flowchart LR
  users["Operators and CI/CD"] --> gateway["Approved IdP or mTLS gateway"]
  gateway --> api["rebac-api service"]
  api --> graph["Graph and connector-state store"]
  api --> queue["Durable job queue"]
  api --> audit["Immutable audit and evidence store"]
  api --> secrets["Secrets manager references"]
  queue --> workers["Managed workers"]
  workers --> connectors["Read-only connectors"]
  audit --> siem["SIEM forwarder"]
  api --> metrics["Metrics, logs, traces"]
  graph --> backup["Backup and restore evidence"]
  queue --> backup
  audit --> backup
```

| Component                | Production responsibility                                                                                        | Proof-point source                                                |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| API service              | Run a signed `rebac-api` digest behind the approved admin identity boundary.                                     | `deploy/kubernetes/`                                              |
| IdP or mTLS gateway      | Authenticate operators, preserve MFA/session evidence, map trusted claims into admin ReBAC roles.                | [Security Model](security-model.md), [API notes](api.md)          |
| Graph store              | Persist subjects, resources, relationships, native grants, and tenant boundaries behind the repository contract. | [Persistence](persistence.md)                                     |
| Connector-state store    | Retain discovery, readiness, reconciliation, and drift evidence separately from queue execution.                 | [Persistence](persistence.md)                                     |
| Job queue                | Execute work durably with idempotency, retry, dead-letter, replay, and emergency revocation priority.            | `packages/core/src/reference-job-queue.ts`                        |
| Audit and evidence store | Retain append-only records, signed windows, delivery monitoring, and backup metadata.                            | `packages/core/src/reference-audit.ts`                            |
| SIEM forwarder           | Deliver bounded audit windows, alert on failed delivery, retain replay proof.                                    | [Audit Event Model](audit-event-model.md)                         |
| Secrets manager          | Keep API keys, gateway references, connector credentials, and rotation evidence out of manifests and logs.       | [ADR 0009](../adrs/0009-secret-management.md)                     |
| Degraded-mode operations | Define fail-closed degraded modes, backpressure, outage behavior, and recovery criteria.                         | [HA and Degraded-Mode Operations](ha-degraded-mode-operations.md) |
| Backup and restore       | Test recovery of every store against defined RTO/RPO.                                                            | `deploy/persistence/evidence/backup-restore.example.json`         |

### RTO/RPO targets

| Data class                           | Example target                       | Evidence required                                                                            |
| ------------------------------------ | ------------------------------------ | -------------------------------------------------------------------------------------------- |
| Relationship graph and native grants | RTO 4 h, RPO 15 min                  | Restore run ID, snapshot hash, tenant-boundary checks, post-restore decision replay.         |
| Connector-state history              | RTO 8 h, RPO 1 h                     | Last safe cursor, replayed discovery run, stale-state warnings, reconciliation result.       |
| Queue state and idempotency records  | RTO 2 h, RPO 5 min                   | Dead-letter replay result, emergency revocation priority check, duplicate suppression proof. |
| Audit and evidence records           | RTO 24 h, RPO 0 for accepted writes  | Immutable receipt, signed-window verification, SIEM replay proof, tamper check.              |
| Configuration and release digest     | RTO 2 h, RPO current approved commit | IaC diff, signed digest verification, approval record, rollback rehearsal.                   |

Stricter values are fine; looser values require explicit risk acceptance with an exception expiry.

### Deployment flow

1. Build and sign the image through the release workflow; verify the attestation and cosign identity.
2. Select environment-specific graph, connector-state, queue, audit/evidence, SIEM, observability, and secrets-manager services.
3. Fill the production-reference overlay with references to approved evidence artifacts, not secret material.
4. Run `pnpm validate:deployment-manifests`, `pnpm validate:persistence-deployment`, and environment-specific IaC validation.
5. Apply to a non-production environment; confirm probes, authentication, audit emission, queue worker health, degraded-mode signals, and backup/restore evidence.
6. Exercise queue backpressure, audit-forwarder outage, read-only fallback, and emergency revocation priority before promotion.
7. Promote only after release approval, the admin authorization descriptor, admission posture, SIEM replay path, degraded-mode evidence, and a rollback record are retained.

## Validation gates

Two schema-backed evidence gates keep proof-point artifacts from being mistaken for production readiness:

- **Persistence deployment** (`pnpm validate:persistence-deployment`): validates `deploy/persistence/production-manifest.example.json` against its readiness report and evidence references, and proves a local proof-point manifest stays blocked from production readiness.
- **Live enforcement pilot** (`pnpm validate:live-enforcement-pilot`): validates `deploy/live-enforcement-pilot/manifest.example.json` — one opt-in Microsoft Graph direct-grant revocation candidate gated on read-only confidence, least-privilege write-scope review, two-role approval, degraded-runtime blocking, dry-run-first verification, rollback hooks, and emergency revocation runbooks. The synthetic evidence files define the shape for review; they do not authorize provider writes.

## Guardrails

- No secret values, bearer tokens, client certificates, tenant IDs, account IDs, or customer resource names in manifests, docs, fixtures, logs, or evidence.
- No live provider writes from this architecture alone; live enforcement requires connector-specific readiness, approval, rollback, and monitoring evidence.
- Observed native grants never collapse into intended access.
- Local JSON state, local JSONL audit files, and in-memory stores are never production controls.
- SIEM delivery failures, stale connector reads, audit tampering, queue dead letters, and backup failures stay visible as security-relevant findings until replayed or remediated.
