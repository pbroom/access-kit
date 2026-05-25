# Policy Testing Guide

## Purpose

This page documents how Access Kit proves deterministic authorization behavior before policy changes are published or relied on.

## Audience

Application developers, platform engineers, security engineers, policy authors, ISSOs, assessors, and resource owners.

## What This Is

Policy testing combines a versioned policy model contract with synthetic proof points. `schemas/policy-model.schema.json` defines the portable model shape, `packages/core/src/policy-model.ts` validates model semantics, and `tests/fixtures/policy/proof-points.json` verifies deny-by-default, allow paths, explicit deny, expiration, suspended users, idempotency, and drift behavior.

## What This Is Not

Policy tests are not production access approvals, live tenant validation, or replacement for access reviews. They prove behavior of deterministic policy logic against synthetic examples.

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

Current model validation covers resource types, relations, action mappings, inheritance rules, deny rules, context and classification constraints, tenant boundaries, migrations, and generated-policy metadata warnings.

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

## Publication Expectations

Before a policy is published:

1. Validate the model against `schemas/policy-model.schema.json`.
2. Run deterministic model validation with `validatePolicyModel`.
3. Update or add proof points for the intended behavior.
4. Confirm deny paths, revocation paths, expiration, suspension, and explicit deny behavior.
5. Run schema, OpenAPI, policy, and CLI contract validation.
6. Ensure the change ticket and audit evidence reference the policy version.

## Security Considerations

- Do not publish policies that lack deny/default and revocation proof points.
- Do not publish unvalidated models; the API returns `POLICY_NOT_VALIDATED` before publication.
- Do not make allow rules broader than the relationship facts justify.
- Do not use unreviewed generated text as policy logic.
- Treat policy rollback as an operational runbook event with audit evidence.

## Audit And Evidence Implications

Policy validation and proof-point results support CM and CA evidence. Published policy changes should emit audit events and preserve policy version linkage to decisions.

## Related Controls

AC-3, AC-6, AU-2, CM-3, CM-6, CA-7, RA-5, and SI-4.

## Related References

- [Decision Lifecycle](decision-lifecycle.md)
- [Explain API](explain-api.md)
- [Policy Rollback Runbook](../runbooks/policy-rollback.md)
- `tests/fixtures/policy/proof-points.json`
- `scripts/validate-policy-fixtures.ts`
- [ADR 0004: Policy model strategy](../adrs/0004-policy-model-strategy.md)
