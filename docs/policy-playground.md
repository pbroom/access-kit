# Policy Playground

The policy playground is a local-only way to edit synthetic policy models, tuple fixtures, request context, and decision requests, then inspect deterministic allow and deny explanations.

Run the default demo playground:

```bash
pnpm playground:policy
```

Run the checked-in sample:

```bash
pnpm playground:policy examples/policy-playground.sample.json
```

The command prints JSON to stdout. It does not start an API server, connect to a provider, write repository state, publish policy, or load live tenant data. Each run builds a fresh in-memory store from the playground input, validates the policy model, validates typed request context, and only evaluates requests when those gates pass.

## Input Shape

The playground input may include:

- `model`: a policy model matching `schemas/policy-model.schema.json`
- `seed`: synthetic `subjects`, `resources`, and `relationships`
- `context`: request context merged into every decision request
- `requests`: named decision requests with optional expected decision and reason code checks
- `evaluatedAt`, `policyVersion`, and `relationshipVersion`: deterministic pins for repeatable output

When omitted, the playground uses the demo seed harness from `docs/demo-seed-harness.md`.

## Validation Gates

The playground intentionally has no publish path. A model that fails `validatePolicyModel` skips request evaluation, and request context that violates model context constraints also skips evaluation. Publishing remains limited to the API and CLI policy publication flow, where validation, approval, change-ticket, and audit gates apply.

## Security Boundaries

- Synthetic data only; no live provider credentials or production tenant records are loaded.
- Execution is deterministic through fixed timestamps and version pins.
- State is in memory and discarded after the process exits.
- Decision explanations are local proof points, not production ATO approval.
