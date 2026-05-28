# Sample Policy Repository

This directory is a reusable policy-as-code example for Access Kit. It keeps model versions, reviewable migrations, tuple fixtures, regression snapshots, generated request/response examples, and CI policy-test wiring together so application teams can copy the shape into their own repositories.

The data is synthetic. It does not include live tenant IDs, emails, secrets, provider object IDs, customer names, or production logs.

## Layout

| Path | Purpose |
| --- | --- |
| `policy-repository.json` | Manifest that ties model versions, tuple sets, snapshots, generated examples, and CI wiring together. |
| `models/*.json` | Versioned policy models validated against `schemas/policy-model.schema.json` and `validatePolicyModel`. |
| `migrations/*.json` | Reviewable migration records that match the source model's `migrations` chain. |
| `fixtures/tuple-sets/*.json` | Synthetic subjects, resources, and relationship tuples for pinned relationship versions. |
| `snapshots/regression/*.json` | Authorization regression expectations for pinned policy and tuple versions. |
| `generated/api/**` | Generated decision-check request and expected response examples derived from regression snapshots. |
| `generated/policy-tests/**` | Generated starter authorization tests, tuple fixtures, example requests, expected results, and migration review snapshots derived from model definitions. |
| `.github/workflows/policy-tests.yml` | Copyable workflow showing how to run policy tests in CI. |

## Validate

Run the sample policy repository gate from the Access Kit root:

```sh
pnpm validate:sample-policy
```

The validator checks schema conformance, deterministic model validation, migration linkage, tenant and classification boundaries, tuple fixture hygiene, deny-default coverage, tenant-boundary denial, explicit-deny coverage, generated example drift, and the copyable CI command.

Regenerate starter review artifacts after model or migration edits:

```sh
pnpm generate:policy-tests
pnpm validate:generated-policy-tests
```

Generated starter artifacts are review aids only. They help authors bootstrap request and expected-result coverage, but they do not replace hand-authored deny, boundary, revocation, and abuse-case tests.

## Adaptation Rules

1. Start by copying the directory shape, not the example identities.
2. Add a new model file for every policy version and keep migration files reviewable.
3. Pin tuple fixtures and snapshots to explicit `policyVersion` and `relationshipVersion` values.
4. Regenerate examples and starter policy tests, then review them like code.
5. Keep deny-default, tenant-boundary, classification-boundary, expiration, and explicit-deny cases in hand-authored CI coverage.
6. Never check in live identifiers, secrets, provider account IDs, access tokens, or tenant exports.
