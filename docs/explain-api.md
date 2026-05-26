# Explain API

## Purpose

This page provides the flagship documentation for `POST /v1/decision/explain`, the inspection-oriented decision endpoint.

## Audience

Application developers, security engineers, ISSOs, assessors, incident responders, and resource owners.

## What This Is

The Explain API returns an authorization decision with relationship path, reason code, policy, model, relationship, tuple, and context version pins, historical `asOf`, traversal metrics, latency SLO metadata, constraints, and evaluation timestamp. It is designed for audit review, incident response, access review, and assessor inspection.

## What This Is Not

Explain is not a ticket approval, grant creation, provider readback, or free-form natural-language justification. It uses the same deterministic engine as `check`.

## Endpoint

`POST /v1/decision/explain`

The response currently uses the same `DecisionResult` contract as `check`, with `relationshipPath` populated when a path contributes to the decision.

## Request Example

```json
{
  "subjectId": "user:alice",
  "action": "read",
  "resourceId": "document:case-plan",
  "context": {
    "purpose": "case-review",
    "requestSource": "synthetic-example"
  },
  "policyVersion": "policy:test-v1",
  "modelVersion": "model:test-v1",
  "relationshipVersion": "tuple-set:test-v1",
  "tupleVersion": "tuple:test-v1",
  "contextVersion": "context:test-v1",
  "asOf": "2026-05-21T17:00:00.000Z"
}
```

## Response Example

```json
{
  "decisionId": "decision:allow-alice-read-case-plan",
  "decision": "allow",
  "subjectId": "user:alice",
  "action": "read",
  "resourceId": "document:case-plan",
  "reasonCode": "ALLOW_VIA_RELATIONSHIP_PATH",
  "policyVersion": "policy:test-v1",
  "modelVersion": "model:test-v1",
  "relationshipVersion": "tuple-set:test-v1",
  "tupleVersion": "tuple:test-v1",
  "contextVersion": "context:test-v1",
  "asOf": "2026-05-21T17:00:00.000Z",
  "relationshipPath": [
    {
      "subjectId": "user:alice",
      "relation": "member_of",
      "objectId": "group:case-team"
    },
    {
      "subjectId": "group:case-team",
      "relation": "contributor_to",
      "objectId": "workspace:case"
    },
    {
      "subjectId": "workspace:case",
      "relation": "contains",
      "objectId": "document:case-plan"
    }
  ],
  "constraints": {
    "deterministic": true,
    "denyByDefault": true,
    "llmDecisioning": false,
    "explain": true,
    "timeTravel": {
      "asOf": "2026-05-21T17:00:00.000Z",
      "evaluatedAt": "2026-05-21T17:00:00.000Z",
      "historical": false
    },
    "traversal": {
      "relationshipScans": 3,
      "visitedNodes": 3,
      "maxDepthReached": 3
    },
    "performance": {
      "targetMs": 25,
      "regressionGateMs": 100,
      "withinRegressionGate": true
    }
  },
  "evaluatedAt": "2026-05-21T17:00:00.000Z"
}
```

## API Errors

OpenAPI is the source of truth for status codes. Implementations should preserve stable validation errors for malformed requests, fail closed on unavailable required state, and emit audit evidence for accepted decisions. Error payload examples should remain synthetic.

## Security Considerations

- Explanations can reveal sensitive relationship structure; callers need least privilege.
- Relationship paths should use canonical IDs and avoid live tenant identifiers in logs or examples.
- Explanation output must not be hand-edited into a more favorable decision.
- Redact provider-specific metadata unless it is required evidence.

## Audit And Evidence Implications

Each explain request emits a decision audit event with `explain: true` in the payload. Evidence packages can use explain outputs to support access reviews, incident investigations, control testing, and assessor sampling.

## Related Controls

AC-3, AC-6, AU-2, AU-3, AU-6, CA-7, and IR-5 benefit from explainability and traceability.

## Related References

- [Decision Lifecycle](decision-lifecycle.md)
- [API Contract Notes](api.md)
- [Policy Testing Guide](policy-testing-guide.md)
- [Audit Event Model](audit-event-model.md)
- `schemas/decision.schema.json`
- `tests/fixtures/schema-examples/decision.json`
- [ADR 0002: Deterministic authorization](../adrs/0002-deterministic-authorization.md)
