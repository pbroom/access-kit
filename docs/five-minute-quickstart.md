# Five-Minute Quickstart

This quickstart starts the local `rebac-api` container, seeds the canonical demo harness, and runs the first allow and deny-by-default decision checks through the HTTP API.

## Prerequisites

- Node 22 or newer
- pnpm 10 through Corepack
- Docker with Compose v2

```sh
corepack enable
pnpm install --frozen-lockfile
```

## Start The API

```sh
docker compose -f docker-compose.quickstart.yml up --build -d
```

The compose file builds the `rebac-api` runtime image, binds it to `127.0.0.1:3000` through the published port, and configures `REBAC_API_KEYS=local-demo-token` for protected API calls.

## Run The Seeded Demo

```sh
pnpm quickstart:demo
```

The runner waits for `/v1/health`, checks `/v1/ready`, upserts the synthetic subjects, resources, and relationships from `createDemoSeedHarness()`, then calls:

- `POST /v1/decision/check`
- `POST /v1/decision/explain`
- `GET /v1/audit/events`

Expected output includes:

```text
quickstart-allow-case-plan: allow ALLOW_VIA_RELATIONSHIP_PATH
quickstart-deny-default: deny DENY_DEFAULT_NO_RELATIONSHIP_PATH
```

The same command can be rerun; seed writes are upserts.

## Inspect The API Manually

```sh
curl http://127.0.0.1:3000/v1/health
curl http://127.0.0.1:3000/v1/ready
```

Protected routes require the same bearer token configured in `REBAC_API_KEY`. Use the checked runner for the authenticated seed, check, explain, and audit calls:

```sh
REBAC_API_KEY=local-demo-token pnpm quickstart:demo
```

Use `REBAC_API_URL` to target a different local API.

## Stop And Reset

```sh
docker compose -f docker-compose.quickstart.yml down
docker compose -f docker-compose.quickstart.yml down -v
```

The first command stops the container while retaining the local quickstart volume. The second removes the volume and resets the local demo state.

## Safety Boundary

The quickstart uses only the `tenant:local-demo` synthetic harness data described in [Demo Seed Harness](demo-seed-harness.md). It does not enable live connectors, write to provider tenants, include production identifiers, or represent production ATO approval.
