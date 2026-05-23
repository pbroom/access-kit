# Decision Lifecycle

## Purpose

This page describes how authorization requests become deterministic, explainable, audited decisions.

## Audience

Application developers, platform engineers, security engineers, ISSOs, assessors, and resource owners.

## What This Is

The decision lifecycle covers `POST /v1/decision/check`, `POST /v1/decision/explain`, and `POST /v1/decision/batch-check`. It also describes reason codes, version traceability, audit events, and how decisions relate to grants and provisioning.

## What This Is Not

A decision is not a native provider permission, provisioning action, ticket approval, or authentication result. Decisions do not mutate target systems.

## Lifecycle

1. Caller supplies `subjectId`, `action`, `resourceId`, optional `context`, optional `policyVersion`, and optional `relationshipVersion`.
2. API validates the request against the OpenAPI contract.
3. The engine loads canonical subject and resource records.
4. The engine rejects missing or inactive subjects and resources.
5. The engine evaluates active relationship tuples and expiration.
6. Explicit deny paths are checked before allow paths.
7. Allow paths are evaluated for the requested action.
8. The engine returns deny by default if no valid path exists.
9. The response includes decision ID, allow or deny, reason code, policy version, relationship version, constraints, and evaluation time.
10. `explain` includes the relationship path; `check` may omit it for the fast path.
11. The decision is recorded and an audit event is emitted.

## Reason Codes

| Reason code | Meaning | Typical response |
| --- | --- | --- |
| `ALLOW_VIA_RELATIONSHIP_PATH` | An active relationship path grants the requested action. | `allow` |
| `DENY_DEFAULT_NO_RELATIONSHIP_PATH` | No active action-bearing path was found. | `deny` |
| `DENY_EXPLICIT_OVERRIDE` | A deny or quarantine relationship overrides an allow path. | `deny` |
| `DENY_SUBJECT_NOT_FOUND` | The subject is unknown. | `deny` |
| `DENY_SUBJECT_NOT_ACTIVE` | The subject is suspended, terminated, deleted, or inactive. | `deny` |
| `DENY_RESOURCE_NOT_FOUND` | The resource is unknown. | `deny` |
| `DENY_RESOURCE_NOT_ACTIVE` | The resource is inactive or deleted. | `deny` |

## Concrete Example

```json
{
  "subjectId": "user:alice",
  "action": "read",
  "resourceId": "document:case-plan",
  "context": {
    "purpose": "case-review"
  }
}
```

An `explain` response can include a path from `user:alice` to `document:case-plan` through group membership, workspace contribution, and containment. The same request returns deny if the subject is suspended, the relationship expires, the resource is inactive, or an explicit deny relationship exists.

## Security Considerations

- Deny by default is required.
- Explicit deny must override allow relationships.
- Suspended, expired, terminated, or deleted subjects must fail closed.
- Every decision must be reproducible from request, policy version, relationship version, context, and evaluated time.
- LLM output must not be used as the decision engine.

## Audit And Evidence Implications

Decision audit events use `decision.allowed` or `decision.denied`, include a correlation ID, and carry policy and relationship version context. Evidence exports use decision logs for AC and AU traceability.

## Related Controls

AC-2, AC-3, AC-6, AU-2, AU-3, AU-6, CM-3, and CA-7 are directly supported by decision traceability.

## Related References

- [Explain API](explain-api.md)
- [Domain Model](domain-model.md)
- [Policy Testing Guide](policy-testing-guide.md)
- [Audit Event Model](audit-event-model.md)
- [OpenAPI contract](../openapi/rebac-control-plane.yaml)
- `schemas/decision.schema.json`
- `tests/fixtures/schema-examples/decision.json`
- `packages/core/src/engine.ts`
- [ADR 0002: Deterministic authorization](../adrs/0002-deterministic-authorization.md)
