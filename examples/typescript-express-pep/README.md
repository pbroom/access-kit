# TypeScript Express PEP Starter

This starter shows a fail-closed policy enforcement point for an Express-style route. It calls the local Access Kit API for every protected request and never authorizes from route-local state.

## Local API

Start the local API with a development key in your shell or CI environment:

```sh
REBAC_API_KEYS=local-dev-key pnpm --filter @access-kit/api build
```

The example reads the key from `ACCESS_KIT_API_KEY`. Do not commit real tokens or put production credentials in example source.

## Protected Route

```ts
import { createAccessKitClient, createAccessKitExpressPepMiddleware } from "@access-kit/typescript-client";

const accessKit = createAccessKitClient({
  apiKey: process.env.ACCESS_KIT_API_KEY ?? "",
  baseUrl: process.env.ACCESS_KIT_BASE_URL ?? "http://127.0.0.1:3000"
});

export const requireCasePlanRead = createAccessKitExpressPepMiddleware({
  client: accessKit,
  buildDecisionRequest: (request) => ({
    subjectId: String(request.headers?.["x-subject-id"] ?? ""),
    action: "read",
    resourceId: "document:case-plan"
  })
});
```

When the API denies, rejects authentication, or is unavailable, the middleware returns a denial response with an `x-correlation-id` header. The route handler only runs after the API returns `allow`.

## Policy Test CI Example

Run the starter policy-test example against the local API:

```sh
ACCESS_KIT_API_KEY=local-dev-key ACCESS_KIT_BASE_URL=http://127.0.0.1:3000 \
  pnpm tsx examples/typescript-express-pep/policy-test-ci.ts policy:local-rebac-v1
```

The script exits non-zero when the local API cannot be reached, authentication fails, or the policy test response contains a failing check.
