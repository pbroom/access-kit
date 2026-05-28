# Deployable API Packaging

The `rebac-api` runtime is packaged as a container proof point for pre-production deployment exercises. It remains synthetic and local-first: no live tenant IDs, provider secrets, production subjects, or provider write credentials are required.

## Image Build

Build the API image from the repository root:

```sh
docker build --target runtime --tag access-kit-rebac-api:local .
```

The Dockerfile uses Node 22, installs with the committed pnpm lockfile, builds the API workspace dependency closure, deploys production dependencies for `@access-kit/api`, and runs the runtime as the non-root `node` user.

## Runtime Defaults

The container sets these defaults:

- `REBAC_API_HOST=0.0.0.0`
- `REBAC_API_PORT=3000`
- `REBAC_API_ACTOR=service:api`
- `REBAC_STATE_PATH=/var/lib/access-kit/state/runtime-state.json`
- `REBAC_EVIDENCE_ROOT=/var/lib/access-kit/evidence`

Mount `/var/lib/access-kit` to preserve local runtime snapshots, graph/job repository JSON files, append-only audit JSONL records, and local proof-point evidence packages across restarts. These files remain validation artifacts, not production database, WORM audit storage, approved queue storage, or approved SIEM retention.

Because the container binds to a non-loopback host, it refuses to start unless `REBAC_API_KEYS` contains at least one bearer token. Loopback-only local development can still run without keys.

The default admin authorization mode is `local_bearer_token`, which keeps the container proof point runnable but makes `/v1/ready` report an `admin_authorization` warning. Production deployment overlays must replace that proof point with `REBAC_ADMIN_AUTH_MODE=idp_gateway` or `REBAC_ADMIN_AUTH_MODE=mtls_gateway` plus evidence-backed `REBAC_ADMIN_*` settings for identity provider or certificate authority, gateway boundary, admin ReBAC policy, role bindings, secrets manager, break-glass approval, incident notifications, post-action review, audit event types, and evidence references. Do not store IdP secrets, gateway keys, client certificates, or bearer tokens in those descriptor fields; use external secret handles such as `ref:` or vault URIs.

## Smoke Test

Use synthetic API keys only:

```sh
export REBAC_SMOKE_TOKEN="<synthetic-smoke-token>"

docker run --rm --detach \
  --name rebac-api \
  --publish 3000:3000 \
  --env REBAC_API_KEYS="$REBAC_SMOKE_TOKEN" \
  --volume access-kit-rebac-data:/var/lib/access-kit \
  access-kit-rebac-api:local

curl --fail http://127.0.0.1:3000/v1/health
curl --fail http://127.0.0.1:3000/v1/ready
curl --fail --oauth2-bearer "$REBAC_SMOKE_TOKEN" http://127.0.0.1:3000/v1/subjects
```

Protected API routes should return `401` without a configured bearer token. `/v1/health` and `/v1/ready` stay public for orchestrator probes and do not expose token material or connector identifiers. Authentication failures are sampled once per failure reason per one-minute window for ongoing audit visibility without requiring unauthenticated requests to flush full runtime snapshots.

## CI Packaging Gate

The CI `Container packaging` job builds the runtime image and smoke-tests:

- `/v1/health` returns `200`
- `/v1/ready` returns `200`
- protected routes return `401` without a bearer token
- protected routes return `200` with the synthetic CI bearer token

## Release Packaging Gate

The `Container Release` workflow is intentionally separate from the PR smoke test. It can run without publishing on manual dispatch, and it publishes only when either:

- a `rebac-api-v*` tag is pushed
- a manual workflow dispatch sets `publish=true`

When publishing is enabled, the workflow builds the same `runtime` target, pushes the image to GHCR, emits SBOM/provenance metadata from Buildx, records a GitHub artifact attestation for the pushed digest, and signs the digest with keyless cosign through GitHub OIDC. No long-lived registry signing key is required for this proof point.

The image reference has this shape:

```text
ghcr.io/<owner>/<repo>/rebac-api@sha256:<digest>
```

## Verification

Use digest references for deployment manifests and admission policy checks. Tags are convenience pointers; the digest is the deployment identity.

```sh
IMAGE_REF="ghcr.io/<owner>/<repo>/rebac-api@sha256:<digest>"

cosign verify \
  --certificate-identity-regexp "https://github.com/<owner>/<repo>/.github/workflows/container-release.yml@refs/tags/rebac-api-v.*" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  "$IMAGE_REF"

gh attestation verify \
  --repo "<owner>/<repo>" \
  "$IMAGE_REF"
```

## Kubernetes Manifest Gate

Reference deployment manifests live under `deploy/kubernetes/`. They wire the deployable runtime to:

- immutable GHCR digest references
- `/v1/ready` readiness probes
- `/v1/health` startup and liveness probes
- a `rebac-api-auth` secret reference for bearer-token configuration
- a persistent `/var/lib/access-kit` volume for local proof-point state and evidence
- restricted pod security settings, disabled service-account token automounting, and a network policy

The manifests intentionally do not include secret values, tenant identifiers, provider credentials, ingress, certificate, or identity-provider wiring. Replace the placeholder image digest with a verified release digest before any deployment exercise:

```sh
kubectl apply -k deploy/kubernetes
```

The signed-image admission policy example lives at `deploy/policies/kyverno/rebac-api-signed-image-policy.yaml`. It is a policy contract for clusters that use Kyverno and cosign keyless verification; production clusters still need environment approval before enforcing it. Production overlays must also add the approved IdP or mTLS gateway, trusted header or certificate validation, secrets-manager integration, network controls, and retained admin authorization evidence before operator traffic is allowed.

## Production Reference Overlay

The production-reference overlay under `deploy/overlays/production-reference/` composes the base Kubernetes proof-point manifests with placeholder references for required production controls. It documents where a target environment must bind the API service to approved graph, connector-state, queue, audit/evidence, SIEM, secrets-manager, observability, backup, RTO, RPO, and admin-authorization evidence.

The overlay is intentionally not a production deployment by itself. It contains reference annotations and `ref:` placeholders only; platform teams must replace them with environment-specific IaC outputs, external secret references, signed-image evidence, IdP or mTLS gateway descriptors, SIEM delivery and replay records, and backup/restore evidence before promotion. See [Production Reference Architecture](production-reference-architecture.md).

## Persistence Deployment Evidence Gate

The synthetic production persistence manifest lives at `deploy/persistence/production-manifest.example.json` and is validated by `pnpm validate:persistence-deployment`.

That gate ties the manifest to the retained readiness report at `deploy/persistence/readiness-report.example.json` plus evidence references for IaC outputs, release approval, backup/restore results, and operator controls under `deploy/persistence/evidence/`. The example proves the deployment contract shape only: production use still needs environment-specific storage selection, real IaC outputs, approved identity-provider access, monitored secret handling, retained change records, WORM audit driver evidence, SIEM forwarding delivery monitoring, and replay procedure records.

## Rollback

Rollback is a digest change, not an in-place image mutation:

1. Select the last known-good signed digest from the release workflow summary or registry metadata.
2. Verify the cosign signature and GitHub attestation before promotion.
3. Update deployment IaC to the verified digest.
4. Watch `/v1/ready`, `/v1/health`, windowed authentication-failure audit volume, and audit write/readiness checks.
5. Record the rollback reason, prior digest, replacement digest, verification evidence, approver, and runtime observations in the deployment evidence package.

Future production deployment work still needs environment-specific overlays, ingress and certificate management, signed-image admission enforcement, identity-provider or mTLS authentication, separate admin ReBAC operator authorization, approved secrets handling, incident-mode notification wiring, post-action review evidence retention, and agency-specific release approvals.
