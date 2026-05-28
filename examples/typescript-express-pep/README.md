# TypeScript Express PEP Starter

This starter shows a fail-closed policy enforcement point for an Express-style route. It calls the local Access Kit API for every protected request and never authorizes from route-local state.

## Local API

Build and start the local API with a development key in your shell or CI environment:

```sh
pnpm --filter @access-kit/api build
REBAC_API_KEYS=local-dev-key node packages/api/dist/bin.js
```

The example reads the key from `ACCESS_KIT_API_KEY`. Do not commit real tokens or put production credentials in example source.

## Protected Route

```ts
import {
  createAccessKitClient,
  createAccessKitExpressPepMiddleware,
  type ExpressPepRequest
} from "@access-kit/typescript-client";

interface AuthenticatedRequest extends ExpressPepRequest {
  readonly auth: {
    readonly subjectId: string;
  };
}

const accessKit = createAccessKitClient({
  apiKey: process.env.ACCESS_KIT_API_KEY ?? "",
  baseUrl: process.env.ACCESS_KIT_BASE_URL ?? "http://127.0.0.1:3000"
});

export const requireCasePlanRead = createAccessKitExpressPepMiddleware<AuthenticatedRequest>({
  client: accessKit,
  buildDecisionRequest: (request) => ({
    subjectId: request.auth.subjectId,
    action: "read",
    resourceId: "document:case-plan"
  })
});
```

Run authentication middleware before the PEP and populate `request.auth.subjectId` from a verified session, JWT, mTLS gateway identity, or other trusted middleware result. Do not map `subjectId` from caller-supplied headers such as `x-subject-id` or `x-user-id`; those headers are user-controlled unless a trusted gateway strips and reissues them before the request reaches Express.

When the API denies, rejects authentication, or is unavailable, the middleware returns a denial response with an `x-correlation-id` header. The route handler only runs after the API returns `allow`.

## Policy Test CI Example

Run the starter policy-test example against the local API:

```sh
ACCESS_KIT_API_KEY=local-dev-key ACCESS_KIT_BASE_URL=http://127.0.0.1:3000 \
  pnpm tsx examples/typescript-express-pep/policy-test-ci.ts policy:local-rebac-v1
```

The script exits non-zero when the local API cannot be reached, authentication fails, or the policy test response contains a failing check.
