# ADR-0010: Fail Behavior By Resource Class

## Status

Accepted

## Decision

Sensitive resources fail closed when the decision service is unavailable. Low-risk cached reads may be allowed only when policy explicitly permits it. Connector outages queue work and mark degraded state. Revocations take priority over new grants.

## Consequences

Fail behavior is part of policy and operational design, not an incidental runtime default.
