# Decision Cache Semantics

This page defines the cache contract for policy enforcement points that want to reuse Access Kit decisions without authorizing from stale or cross-tenant state.

Decision caching is a PEP optimization boundary, not a second authorization engine. The runtime emits cache metadata with each `DecisionResult`; PEPs may store the result only when they honor the emitted key, TTL, invalidation signals, and fail-closed behavior.

## Cache Key

The cache key is derived from tenant, subject, action, resource, policy version, model version, relationship version, tuple version, context version, and `asOf` timestamp. It never includes raw context values, relationship paths, bearer tokens, provider identifiers, or source-specific display names.

The key changes when any of these inputs change:

- tenant boundary
- subject ID
- action
- resource ID
- policy or model version
- relationship or tuple version
- context version
- historical `asOf` timestamp

## TTL By Classification

Cache TTLs are intentionally short and classification-bound:

| Classification | Max TTL |
| --- | --- |
| `public` | 300 seconds |
| `internal` | 120 seconds |
| `confidential` | 60 seconds |
| `controlled` | 30 seconds |
| `restricted` | 30 seconds |
| `secret` | 15 seconds |
| unknown or unlisted | 30 seconds |

The default for unknown classifications is conservative. A PEP must not extend the TTL beyond the runtime-emitted maximum.

## Invalidation

PEPs must evict cached decisions when any emitted invalidation signal changes. Signals include tenant, subject, resource, action, policy, model, relationship set, tuple, context, and classification. Relationship writes, policy publication, model migration, resource classification changes, and context-version changes are invalidation events.

## Fail-Closed Behavior

If cache lookup, decoding, TTL validation, signal matching, or audit recording is ambiguous, the PEP must deny protected access and call Access Kit again before allowing. Local fallback authorization is not allowed. A stale cached allow is never a valid substitute for a fresh Access Kit decision.

## Auditability

The runtime includes cache metadata in the decision audit payload. PEPs that cache decisions must retain the cache key, TTL, expiration time, invalidation signals, and fail-closed outcome alongside their decision log. Cache hits should be traceable to the original `decisionId` and must preserve correlation IDs without exposing sensitive relationship paths to end users.
