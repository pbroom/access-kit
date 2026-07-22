# Decisions

This page answers four questions: how does a decision get made, what does `explain` return, when may an enforcement point cache a decision, and what must an enforcement point do to be conformant? The endpoints are `POST /v1/decision/check`, `POST /v1/decision/explain`, and `POST /v1/decision/batch-check`; [the OpenAPI contract](../openapi/rebac-control-plane.yaml) is the source of truth for schemas and status codes, and `packages/core/src/engine.ts` is the implementation.

A decision is not a native provider permission, a provisioning action, or an authentication result. Decisions never mutate target systems.

## How a decision is made

1. The caller supplies `subjectId`, `action`, `resourceId`, and optionally `context`, version pins (`policyVersion`, `modelVersion`, `relationshipVersion`, `tupleVersion`, `contextVersion`), and a historical `asOf` timestamp.
2. The engine loads canonical subject and resource records and rejects missing or inactive ones.
3. It evaluates relationship tuples visible at `asOf`, honoring assertion time, expiration, deletion, tuple version pins, and lifecycle state at that point in time.
4. The configured policy model (default model when none is provided) compiles grant, deny, membership, and containment semantics: action mappings define which relations grant each action, deny rules define override relations, and inheritance rules define which membership and containment relations may be traversed. Relations not declared in the model grant nothing.
5. Explicit deny paths are checked before allow paths. Allow paths are evaluated under bounded traversal; exceeding depth, visited-node, or relationship-scan limits fails closed. No valid path means deny by default.
6. The decision is recorded, an audit event is emitted (`decision.allowed` or `decision.denied`, with correlation ID and version context), and the response carries the decision ID, reason code, all version pins, `asOf`, traversal metrics, latency metadata, constraints, and evaluation time.

Every decision must be reproducible from its request plus pinned versions. Historical decisions evaluate state as of the pinned `asOf` and fail closed for invalid or future timestamps. LLM output is never a decision input.

## Reason codes

| Reason code                                                                      | Meaning                                                                               |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `ALLOW_VIA_RELATIONSHIP_PATH`                                                    | An active relationship path grants the requested action.                              |
| `DENY_DEFAULT_NO_RELATIONSHIP_PATH`                                              | No active action-bearing path was found.                                              |
| `DENY_EXPLICIT_OVERRIDE`                                                         | A deny or quarantine relationship overrides an allow path.                            |
| `DENY_SUBJECT_NOT_FOUND` / `DENY_RESOURCE_NOT_FOUND`                             | The subject or resource is unknown.                                                   |
| `DENY_SUBJECT_NOT_ACTIVE` / `DENY_RESOURCE_NOT_ACTIVE`                           | The subject or resource is suspended, terminated, deleted, or inactive.               |
| `DENY_SUBJECT_LIFECYCLE_UNKNOWN_AS_OF` / `DENY_RESOURCE_LIFECYCLE_UNKNOWN_AS_OF` | Historical lifecycle state cannot be inferred safely from available timestamps.       |
| `DENY_INVALID_AS_OF` / `DENY_AS_OF_IN_FUTURE`                                    | The historical evaluation timestamp is unparseable or later than evaluation time.     |
| `DENY_TRAVERSAL_BOUND_EXCEEDED`                                                  | Graph traversal exceeded configured depth, visited-node, or relationship-scan bounds. |

## Explain

`explain` runs the same deterministic engine as `check` and returns the same `DecisionResult` contract, with `relationshipPath` populated when a path contributes to the decision. It exists for audit review, incident response, access review, and assessor inspection — it is not a free-form justification and its output must never be hand-edited.

A request and the shape of its response:

```json
{
	"subjectId": "user:alice",
	"action": "read",
	"resourceId": "document:case-plan",
	"context": {"purpose": "case-review"}
}
```

```json
{
	"decisionId": "decision:allow-alice-read-case-plan",
	"decision": "allow",
	"reasonCode": "ALLOW_VIA_RELATIONSHIP_PATH",
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
		"traversal": {
			"relationshipScans": 3,
			"visitedNodes": 3,
			"maxDepthReached": 3
		}
	}
}
```

See [examples/api/explain.response.json](../examples/api/explain.response.json) for a complete response including version pins, time-travel metadata, and performance fields.

Explanations reveal relationship structure, so callers need least privilege, paths must use canonical IDs (never live tenant identifiers), and provider-specific metadata should be redacted unless it is required evidence. Each explain request emits a decision audit event with `explain: true`.

## Caching decisions

Caching is a PEP optimization, not a second authorization engine. The runtime emits cache metadata with each `DecisionResult`; a PEP may store the result only when it honors the emitted key, TTL, invalidation signals, and fail-closed behavior.

**Key.** Derived from tenant, subject, action, resource, all version pins, and `asOf`. It never includes raw context values, relationship paths, bearer tokens, or provider identifiers. Any change to those inputs changes the key.

**TTL.** Classification-bound and short. A PEP must not extend the TTL beyond the runtime-emitted maximum.

| Classification                      | Max TTL |
| ----------------------------------- | ------- |
| `public`                            | 300 s   |
| `internal`                          | 120 s   |
| `confidential`                      | 60 s    |
| `controlled`, `restricted`, unknown | 30 s    |
| `secret`                            | 15 s    |

**Invalidation.** Evict when any emitted signal changes: tenant, subject, resource, action, policy, model, relationship set, tuple, context, or classification. Relationship writes, policy publication, model migration, and classification changes are all invalidation events.

**Fail closed.** If lookup, decoding, TTL validation, signal matching, or audit recording is ambiguous, deny protected access and call Access Kit again. A stale cached allow is never a substitute for a fresh decision.

**Auditability.** Cache hits must be traceable to the original `decisionId`, preserve correlation IDs, and retain the key, TTL, expiration, invalidation signals, and fail-closed outcome alongside the decision log.

## PEP conformance

A policy enforcement point treats Access Kit as the deterministic authorization source for protected resources: it calls the decision API for every protected request, fails closed when the API fails, and never substitutes local logic for a denied or failed response.

| Requirement       | Conformance expectation                                                                                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API failure       | Protected handlers do not run when Access Kit is unavailable, rejects authentication, times out, or returns non-2xx. The PEP returns a denial with a correlation ID.                   |
| Correlation IDs   | Caller-supplied correlation IDs are forwarded to Access Kit and echoed on the response; generated IDs are stable for the request.                                                      |
| Decision logging  | Allow and deny outcomes emit internal logs with the decision ID, reason code, and correlation ID.                                                                                      |
| No local fallback | Route-local roles, cached application state, or framework guards cannot authorize when Access Kit denies or fails.                                                                     |
| Reason codes      | Denials preserve machine-readable reason codes; API failures use a distinct unavailable code.                                                                                          |
| Explain safety    | Protected middleware never calls explain automatically or exposes debug traces to end users. Explain belongs behind an operator-controlled diagnostic path.                            |
| Redaction         | End-user denial bodies contain only a stable denial code, correlation ID, and safe reason code — no relationship paths, sensitive identifiers, group or folder names, or decision IDs. |

Run the conformance suite with:

```sh
pnpm validate:pep-conformance
```

It exercises three starters against the same behavior contract: TypeScript Express ([examples/typescript-express-pep/](../examples/typescript-express-pep/)), Python FastAPI ([examples/python-fastapi-pep/](../examples/python-fastapi-pep/), requires `python3`), and Go Envoy ext-authz ([examples/go-envoy-ext-authz/](../examples/go-envoy-ext-authz/), which ships an Envoy config with `failure_mode_allow: false`). The tests live in `tests/sdk-pep/` and intentionally use local role-like headers and sensitive path fixtures to prove the PEP does not authorize locally or leak relationship paths. New SDKs and middleware should add adapter tests against the same contract before being marked reviewable in the backlog.

## Related references

- [Domain Model](domain-model.md)
- [Policy Testing Guide](policy-testing-guide.md)
- [Audit Event Model](audit-event-model.md)
- `schemas/decision.schema.json`, `tests/fixtures/schema-examples/decision.json`
- [ADR 0002: Deterministic authorization](../adrs/0002-deterministic-authorization.md)
