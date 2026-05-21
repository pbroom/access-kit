# Proof-Point Validation Evidence

Generated at: 2026-05-21T18:35:48.981Z

Branch: codex/rebac-phase1-cli

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
| core engine tests | `corepack pnpm test:core` | PASS |
| API runtime tests | `corepack pnpm test:api` | PASS |
| CLI API smoke tests | `corepack pnpm test:cli` | PASS |

## Command Output

### typecheck

```text
> access-kit@0.1.0 typecheck /Users/peterbroomfield/access-kit-rebac-foundation-specs
> tsc --noEmit
```

### schema validation

```text
> access-kit@0.1.0 validate:schemas /Users/peterbroomfield/access-kit-rebac-foundation-specs
> tsx scripts/validate-schemas.ts

Validated 8 schemas and 8 example fixtures.
PASS audit-event.json -> schemas/audit-event.schema.json
PASS decision.json -> schemas/decision.schema.json
PASS drift-finding.json -> schemas/drift-finding.schema.json
PASS evidence-export.json -> schemas/evidence-export.schema.json
PASS provisioning-plan.json -> schemas/provisioning-plan.schema.json
PASS relationship.json -> schemas/relationship.schema.json
PASS resource.json -> schemas/resource.schema.json
PASS subject.json -> schemas/subject.schema.json
```

### OpenAPI validation

```text
> access-kit@0.1.0 validate:openapi /Users/peterbroomfield/access-kit-rebac-foundation-specs
> tsx scripts/validate-openapi.ts

Validated OpenAPI contract at /Users/peterbroomfield/access-kit-rebac-foundation-specs/openapi/rebac-control-plane.yaml.
PASS 22 required API path groups are present.
```

### policy fixture validation

```text
> access-kit@0.1.0 validate:policy /Users/peterbroomfield/access-kit-rebac-foundation-specs
> tsx scripts/validate-policy-fixtures.ts

Validated 8 policy proof points.
PASS deny by default without relationship path
PASS allow through relationship path
PASS allow through admin relationship path
PASS deny override beats allow path
PASS expired access is denied
PASS suspended user is denied
PASS duplicate event idempotency is specified
PASS drift is represented as security finding
```

### core engine tests

```text
> access-kit@0.1.0 test:core /Users/peterbroomfield/access-kit-rebac-foundation-specs
> vitest run tests/core


 RUN  v4.1.7 /Users/peterbroomfield/access-kit-rebac-foundation-specs


 Test Files  2 passed (2)
      Tests  9 passed (9)
   Start at  14:35:46
   Duration  175ms (transform 91ms, setup 0ms, import 122ms, tests 7ms, environment 0ms)
```

### API runtime tests

```text
> access-kit@0.1.0 test:api /Users/peterbroomfield/access-kit-rebac-foundation-specs
> vitest run tests/api


 RUN  v4.1.7 /Users/peterbroomfield/access-kit-rebac-foundation-specs


 Test Files  1 passed (1)
      Tests  4 passed (4)
   Start at  14:35:47
   Duration  217ms (transform 52ms, setup 0ms, import 81ms, tests 40ms, environment 0ms)
```

### CLI API smoke tests

```text
> access-kit@0.1.0 test:cli /Users/peterbroomfield/access-kit-rebac-foundation-specs
> vitest run tests/cli


 RUN  v4.1.7 /Users/peterbroomfield/access-kit-rebac-foundation-specs


 Test Files  2 passed (2)
      Tests  6 passed (6)
   Start at  14:35:48
   Duration  238ms (transform 99ms, setup 0ms, import 146ms, tests 39ms, environment 0ms)
```


## Covered Proof Points

- TypeScript strict type checking.
- JSON Schema validation for subject, resource, relationship, decision, provisioning plan, audit event, drift finding, and evidence export examples.
- OpenAPI validation for required decision, inventory, relationship, policy, provisioning, reconciliation, audit, evidence, and connector path groups.
- Policy fixtures for deny by default, relationship allow, deny override, expired access denial, suspended-user denial, idempotency, and drift finding.
- Local core engine tests for deterministic check/explain and decision audit emission.
- API runtime tests for health, decision, relationship write audit, mock connector sync, and reconciliation.
- CLI API smoke tests for operator, CI/CD, and assessor surfaces calling the API.

## Outstanding Requirements

- Implement a persistent relationship graph and policy model store.
- Replace the local in-memory API runtime with production-ready persistence and deployment packaging.
- Implement durable append-only audit storage with tamper-evidence and SIEM export.
- Add live read-only connector discovery for Entra ID, SharePoint, and AWS after connector security review.
- Add dry-run provisioning and reconciliation job execution with queueing, retries, and dead-letter handling.
- Add controlled enforcement only after approval workflow, rollback, and connector least-privilege review are complete.
- Add ATO package generation for concrete system boundary diagrams, control implementation statements, POA&M inputs, and ConMon evidence.
