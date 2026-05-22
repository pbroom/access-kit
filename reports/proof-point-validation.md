# Proof-Point Validation Evidence

Generated at: 2026-05-22T10:47:00.107Z

Branch: codex/rebac-phase5-siem-export

Node: v24.4.1

pnpm: 10.30.3

## Summary

All proof-point validation commands passed.

| Proof point | Command | Result |
| --- | --- | --- |
| typecheck | `corepack pnpm typecheck` | PASS |
| schema validation | `corepack pnpm validate:schemas` | PASS |
| OpenAPI validation | `corepack pnpm validate:openapi` | PASS |
| policy fixture validation | `corepack pnpm validate:policy` | PASS |
| CLI command contract | `corepack pnpm validate:cli-contract` | PASS |
| core engine tests | `corepack pnpm test:core` | PASS |
| API runtime tests | `corepack pnpm test:api` | PASS |
| CLI API smoke tests | `corepack pnpm test:cli` | PASS |

## Command Output

### typecheck

```text
> access-kit@0.1.0 typecheck /Users/peterbroomfield/access-kit-rebac-phase5-siem-export
> tsc --noEmit
```

### schema validation

```text
> access-kit@0.1.0 validate:schemas /Users/peterbroomfield/access-kit-rebac-phase5-siem-export
> tsx scripts/validate-schemas.ts

Validated 13 schemas and 13 example fixtures.
PASS audit-event.json -> schemas/audit-event.schema.json
PASS audit-export.json -> schemas/audit-export.schema.json
PASS audit-integrity.json -> schemas/audit-integrity.schema.json
PASS decision.json -> schemas/decision.schema.json
PASS discovery-run.json -> schemas/discovery-run.schema.json
PASS drift-finding.json -> schemas/drift-finding.schema.json
PASS enforcement-readiness.json -> schemas/enforcement-readiness.schema.json
PASS evidence-export.json -> schemas/evidence-export.schema.json
PASS native-grant.json -> schemas/native-grant.schema.json
PASS provisioning-plan.json -> schemas/provisioning-plan.schema.json
PASS relationship.json -> schemas/relationship.schema.json
PASS resource.json -> schemas/resource.schema.json
PASS subject.json -> schemas/subject.schema.json
```

### OpenAPI validation

```text
> access-kit@0.1.0 validate:openapi /Users/peterbroomfield/access-kit-rebac-phase5-siem-export
> tsx scripts/validate-openapi.ts

Validated OpenAPI contract at /Users/peterbroomfield/access-kit-rebac-phase5-siem-export/openapi/rebac-control-plane.yaml.
PASS 27 required API path groups are present.
PASS Phase 4 controlled-enforcement readiness, request, and job fields are present.
PASS Phase 5 audit integrity, audit export, and evidence export path groups are present.
```

### policy fixture validation

```text
> access-kit@0.1.0 validate:policy /Users/peterbroomfield/access-kit-rebac-phase5-siem-export
> tsx scripts/validate-policy-fixtures.ts

Validated 11 policy proof points.
PASS deny by default without relationship path
PASS deny unsupported action despite read relationship
PASS allow through relationship path
PASS allow through transitive reader relationship path
PASS allow through nested container relationship path
PASS allow through admin relationship path
PASS deny override beats allow path
PASS expired access is denied
PASS suspended user is denied
PASS duplicate event idempotency is specified
PASS drift is represented as security finding
```

### CLI command contract

```text
> access-kit@0.1.0 validate:cli-contract /Users/peterbroomfield/access-kit-rebac-phase5-siem-export
> vitest run tests/cli/cli-contract.test.ts


 RUN  v4.1.7 /Users/peterbroomfield/access-kit-rebac-phase5-siem-export


 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at  06:46:56
   Duration  168ms (transform 40ms, setup 0ms, import 57ms, tests 6ms, environment 0ms)
```

### core engine tests

```text
> access-kit@0.1.0 test:core /Users/peterbroomfield/access-kit-rebac-phase5-siem-export
> vitest run tests/core


 RUN  v4.1.7 /Users/peterbroomfield/access-kit-rebac-phase5-siem-export


 Test Files  2 passed (2)
      Tests  25 passed (25)
   Start at  06:46:57
   Duration  212ms (transform 117ms, setup 0ms, import 160ms, tests 14ms, environment 0ms)
```

### API runtime tests

```text
> access-kit@0.1.0 test:api /Users/peterbroomfield/access-kit-rebac-phase5-siem-export
> vitest run tests/api


 RUN  v4.1.7 /Users/peterbroomfield/access-kit-rebac-phase5-siem-export


 Test Files  1 passed (1)
      Tests  51 passed (51)
   Start at  06:46:58
   Duration  471ms (transform 118ms, setup 0ms, import 159ms, tests 201ms, environment 0ms)
```

### CLI API smoke tests

```text
> access-kit@0.1.0 test:cli /Users/peterbroomfield/access-kit-rebac-phase5-siem-export
> vitest run tests/cli


 RUN  v4.1.7 /Users/peterbroomfield/access-kit-rebac-phase5-siem-export


 Test Files  2 passed (2)
      Tests  29 passed (29)
   Start at  06:46:59
   Duration  351ms (transform 156ms, setup 0ms, import 216ms, tests 82ms, environment 0ms)
```


## Covered Proof Points

- TypeScript strict type checking.
- JSON Schema validation for subject, resource, relationship, decision, native grant, discovery run, enforcement-readiness, provisioning plan, audit event, audit export, drift finding, audit-integrity, and evidence export examples.
- OpenAPI validation for required decision, inventory, native access, discovery, relationship, policy, provisioning, reconciliation, audit, audit-integrity, audit-export, evidence, connector, and enforcement-readiness path groups.
- Policy fixtures for deny by default, relationship allow, deny override, expired access denial, suspended-user denial, idempotency, and drift finding.
- CLI command contract mapping each operator command to an API surface.
- Local core engine tests for deterministic check/explain and decision audit emission.
- API runtime tests for health, decision, relationship write audit, read-only mock and synthetic provider connector discovery, discovery run history, native access filtering, dry-run provisioning jobs, enforcement-readiness reports, controlled synthetic enforcement guardrails, audit integrity, SIEM-ready audit export, local file-backed audit/evidence storage, ATO evidence packaging, idempotent job replay, and reconciliation.
- CLI API smoke tests for operator, CI/CD, assessor, audit-integrity, SIEM-ready audit export, ATO evidence export, dry-run provisioning, connector readiness, and controlled synthetic enforcement surfaces calling the API.

## Outstanding Requirements

- Implement a persistent relationship graph and policy model store.
- Replace the local in-memory API runtime with production-ready persistence and deployment packaging.
- Replace local audit integrity, SIEM-ready audit exports, file-backed storage proof points, and SIEM export metadata with durable append-only audit storage, approved SIEM forwarding, retention, and replay procedures.
- Replace synthetic Entra ID, SharePoint, and AWS-style readback fixtures with live read-only connector discovery after connector security review.
- Persist discovery runs and native-grant readback outside the local in-memory store.
- Replace local dry-run provisioning, controlled synthetic enforcement, readiness gates, and reconciliation jobs with durable queues, retries, and dead-letter handling.
- Extend enforcement beyond the synthetic mock connector only after approval workflow, rollback, operational runbooks, emergency revocation behavior, and connector least-privilege review are complete.
- Expand ATO package generation with concrete system boundary diagrams, reviewed control implementation statements, POA&M workflow integration, and ConMon evidence delivery.
