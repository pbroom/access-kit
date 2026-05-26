# Policy Testing Guide

## Purpose

This page documents how Access Kit proves deterministic authorization behavior before policy changes are published or relied on.

## Audience

Application developers, platform engineers, security engineers, policy authors, ISSOs, assessors, and resource owners.

## What This Is

Policy testing combines a versioned policy model contract with synthetic proof points and stress fixtures. `schemas/policy-model.schema.json` defines the portable model shape, `packages/core/src/policy-model.ts` validates model semantics, `tests/fixtures/policy/proof-points.json` verifies core proof points, and `tests/core/policy-model-harness.test.ts` exercises malformed model cases, traversal bounds, tenant-boundary abuse, replay, and time-travel behavior.

## What This Is Not

Policy tests are not production access approvals, live tenant validation, or replacement for access reviews. They prove behavior of deterministic policy logic against synthetic examples.

For interactive local exploration, use the policy playground:

```bash
pnpm playground:policy examples/policy-playground.sample.json
```

The playground validates edited models and typed request context before running deterministic in-memory explain calls. It cannot publish policy and never writes production data.

## Test Coverage

Current proof points cover:

- deny by default without a relationship path
- unsupported action denial
- allow through direct and transitive relationship paths
- containment traversal
- admin relationship handling
- explicit deny override
- expired relationship denial
- suspended subject denial
- idempotent relationship write behavior
- drift finding behavior

Current model validation covers resource types, relations, action mappings, inheritance rules, deny rules, context and classification constraints, tenant boundaries, fail-closed caveats and conditional relationships, deterministic explanation policy, migration ordering and cycles, and generated-policy metadata warnings.

Current harness coverage adds:

- table-driven malformed model fuzz cases
- cyclic and wide graph traversal bounds
- cross-tenant resource lookup and relationship traversal denial
- connector-state and evidence leakage checks on denied tenant-boundary decisions
- replay, idempotency collision, and time-travel decision fixtures
- typed caveat enforcement for ABAC, device posture, risk, and access-time context

The reusable sample policy repository in [examples/sample-policy-repository](../examples/sample-policy-repository/README.md) shows the policy-as-code layout expected from adopters: model versions, migration files, tuple fixtures, regression snapshots, conditional relationship caveats, generated request/response examples, generated starter policy-test artifacts, and copyable CI policy-test wiring.

Generated starter policy tests come from model definitions via `pnpm generate:policy-tests`. The generator writes tuple fixtures, starter authorization cases, example requests, expected results, and migration regression review snapshots under `examples/sample-policy-repository/generated/policy-tests`. `pnpm validate:generated-policy-tests` fails when those artifacts drift.

Generated tests are review aids only. They can lower the cost of initial coverage, but they cannot replace explicit deny, tenant-boundary, classification-boundary, revocation, expiration, and abuse-case tests that are written and reviewed by policy owners.

## Concrete Example

```json
{
  "kind": "decision",
  "name": "deny by default without relationship path",
  "subjectId": "user:alice",
  "action": "read",
  "resourceId": "document:case-plan",
  "relationships": [],
  "subjectStatus": "active",
  "now": "2026-05-21T17:00:00.000Z",
  "expect": "deny",
  "expectedReasonCode": "DENY_DEFAULT_NO_RELATIONSHIP_PATH"
}
```

Run:

```sh
pnpm validate:policy
```

To validate the sample policy repository conventions:

```sh
pnpm validate:sample-policy
```

## Publication Expectations

Before a policy is published:

1. Validate the model against `schemas/policy-model.schema.json`.
2. Run deterministic model validation with `validatePolicyModel`.
3. Update or add proof points for the intended behavior.
4. Update tuple fixtures, migration files, regression snapshots, and generated examples together.
5. Make conditional inputs typed, bounded, auditable, and fail closed when missing or invalid.
6. Regenerate starter policy-test artifacts when model definitions change, then review the generated diff.
7. Confirm deny paths, revocation paths, expiration, suspension, explicit deny behavior, caveat denial, and tenant-boundary denial with hand-authored tests.
8. Run schema, OpenAPI, policy, sample-policy, generated-policy-test, and CLI contract validation.
9. Ensure the change ticket and audit evidence reference the policy version.

## Security Considerations

- Do not publish policies that lack deny/default and revocation proof points.
- Do not publish unvalidated models; the API returns `POLICY_NOT_VALIDATED` before publication.
- Do not make allow rules broader than the relationship facts justify.
- Do not treat generated starter tests as sufficient coverage for boundary or abuse behavior.
- Do not treat missing ABAC, device, risk, or time context as an implicit allow.
- Do not use unreviewed generated text as policy logic.
- Treat policy rollback as an operational runbook event with audit evidence.

## Audit And Evidence Implications

Policy validation and proof-point results support CM and CA evidence. Published policy changes should emit audit events and preserve policy version linkage to decisions.

## Related Controls

AC-3, AC-6, AU-2, CM-3, CM-6, CA-7, RA-5, and SI-4.

## Related References

- [Decision Lifecycle](decision-lifecycle.md)
- [Explain API](explain-api.md)
- [Policy Playground](policy-playground.md)
- [Policy Rollback Runbook](../runbooks/policy-rollback.md)
- `tests/fixtures/policy/proof-points.json`
- `examples/sample-policy-repository/`
- `scripts/validate-policy-fixtures.ts`
- `scripts/validate-sample-policy-repository.ts`
- [ADR 0004: Policy model strategy](../adrs/0004-policy-model-strategy.md)
