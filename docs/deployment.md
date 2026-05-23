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

Mount `/var/lib/access-kit` to preserve local runtime snapshots and local proof-point audit/evidence files across restarts. These files remain validation artifacts, not production database, WORM audit storage, or approved SIEM retention.

Because the container binds to a non-loopback host, it refuses to start unless `REBAC_API_KEYS` contains at least one bearer token. Loopback-only local development can still run without keys.

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

Protected API routes should return `401` without a configured bearer token. `/v1/health` and `/v1/ready` stay public for orchestrator probes and do not expose token material.

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

## Rollback

Rollback is a digest change, not an in-place image mutation:

1. Select the last known-good signed digest from the release workflow summary or registry metadata.
2. Verify the cosign signature and GitHub attestation before promotion.
3. Update deployment IaC to the verified digest.
4. Watch `/v1/ready`, `/v1/health`, authentication-failure audit volume, and audit write/readiness checks.
5. Record the rollback reason, prior digest, replacement digest, verification evidence, approver, and runtime observations in the deployment evidence package.

Future production deployment work still needs environment IaC, signed-image admission policy, identity-provider authentication, operator authorization, approved secrets handling, and agency-specific release approvals.
