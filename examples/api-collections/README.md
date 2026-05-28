# API Collections

This directory contains generated Postman and Bruno collections for the Access Kit demo seed evaluation flow. The requests use the synthetic IDs from `examples/demo-seed-harness.json` and do not include live tenant data, production identifiers, or checked-in secrets.

## Run The Demo Seed API

Start a local API that is explicitly seeded with the demo harness:

```sh
export REBAC_API_KEYS="<local throwaway bearer token>"
corepack pnpm api-collections:demo
```

Set the same local token in your Postman or Bruno environment variable named `rebac_api_token`. Leave `invalid_rebac_api_token` as `intentionally-invalid`; it is intentionally invalid for the auth-failure examples.

## Collections

- Postman: `postman/access-kit-demo-seed.postman_collection.json`
- Bruno: `bruno/`

Run the setup request first so `demo_policy_id` is captured before the policy-test request. Run the dry-run provisioning plan request before the job request so `provisioning_plan_id` is captured. The authentication-failure requests intentionally disable or override collection auth and should return `401` when the API is started with `REBAC_API_KEYS`.

## Coverage

- decision check
- decision explain
- policy create
- policy test
- provisioning plan
- provisioning job
- reconciliation
- auth failure missing
- auth failure invalid
- audit export
- evidence export

Regenerate these artifacts with:

```sh
corepack pnpm generate:api-collections
```

Validation runs through:

```sh
corepack pnpm validate:api-collections
```
