# Proof-Point Validation Evidence

Generated at: 2026-05-22T10:41:49.797Z

Branch: codex/rebac-ci-contracts

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
> access-kit@0.1.0 typecheck /Users/peterbroomfield/access-kit-rebac-ci-contracts
> tsc --noEmit
```

### schema validation

```text
> access-kit@0.1.0 validate:schemas /Users/peterbroomfield/access-kit-rebac-ci-contracts
> tsx scripts/validate-schemas.ts

Validated 10 schemas and 10 example fixtures.
PASS audit-event.json -> schemas/audit-event.schema.json
PASS decision.json -> schemas/decision.schema.json
PASS discovery-run.json -> schemas/discovery-run.schema.json
PASS drift-finding.json -> schemas/drift-finding.schema.json
PASS evidence-export.json -> schemas/evidence-export.schema.json
PASS native-grant.json -> schemas/native-grant.schema.json
PASS provisioning-plan.json -> schemas/provisioning-plan.schema.json
PASS relationship.json -> schemas/relationship.schema.json
PASS resource.json -> schemas/resource.schema.json
PASS subject.json -> schemas/subject.schema.json
```

### OpenAPI validation

```text
> access-kit@0.1.0 validate:openapi /Users/peterbroomfield/access-kit-rebac-ci-contracts
> tsx scripts/validate-openapi.ts

Validated OpenAPI contract at /Users/peterbroomfield/access-kit-rebac-ci-contracts/openapi/rebac-control-plane.yaml.
PASS 23 required API path groups are present.
```

### policy fixture validation

```text
> access-kit@0.1.0 validate:policy /Users/peterbroomfield/access-kit-rebac-ci-contracts
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
> access-kit@0.1.0 validate:cli-contract /Users/peterbroomfield/access-kit-rebac-ci-contracts
> vitest run tests/cli/cli-contract.test.ts


 RUN  v4.1.7 /Users/peterbroomfield/access-kit-rebac-ci-contracts


 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at  06:41:46
   Duration  147ms (transform 31ms, setup 0ms, import 46ms, tests 5ms, environment 0ms)
```

### core engine tests

```text
> access-kit@0.1.0 test:core /Users/peterbroomfield/access-kit-rebac-ci-contracts
> vitest run tests/core


 RUN  v4.1.7 /Users/peterbroomfield/access-kit-rebac-ci-contracts


 Test Files  2 passed (2)
      Tests  24 passed (24)
   Start at  06:41:47
   Duration  189ms (transform 102ms, setup 0ms, import 137ms, tests 12ms, environment 0ms)
```

### API runtime tests

```text
> access-kit@0.1.0 test:api /Users/peterbroomfield/access-kit-rebac-ci-contracts
> vitest run tests/api


 RUN  v4.1.7 /Users/peterbroomfield/access-kit-rebac-ci-contracts


 Test Files  1 passed (1)
      Tests  24 passed (24)
   Start at  06:41:48
   Duration  295ms (transform 72ms, setup 0ms, import 103ms, tests 91ms, environment 0ms)
```

### CLI API smoke tests

```text
> access-kit@0.1.0 test:cli /Users/peterbroomfield/access-kit-rebac-ci-contracts
> vitest run tests/cli


 RUN  v4.1.7 /Users/peterbroomfield/access-kit-rebac-ci-contracts


 Test Files  2 passed (2)
      Tests  21 passed (21)
   Start at  06:41:49
   Duration  279ms (transform 111ms, setup 0ms, import 162ms, tests 71ms, environment 0ms)
```


## Covered Proof Points

- TypeScript strict type checking.
- JSON Schema validation for subject, resource, relationship, decision, native grant, discovery run, provisioning plan, audit event, drift finding, and evidence export examples.
- OpenAPI validation for required decision, inventory, native access, relationship, policy, provisioning, reconciliation, audit, evidence, and connector path groups.
- Policy fixtures for deny by default, relationship allow, deny override, expired access denial, suspended-user denial, idempotency, and drift finding.
- CLI command contract mapping each operator command to an API surface.
- Local core engine tests for deterministic check/explain and decision audit emission.
- API runtime tests for health, decision, relationship write audit, read-only mock connector discovery, native access, and reconciliation.
- CLI API smoke tests for operator, CI/CD, and assessor surfaces calling the API.

## Outstanding Requirements

- Implement a persistent relationship graph and policy model store.
- Replace the local in-memory API runtime with production-ready persistence and deployment packaging.
- Implement durable append-only audit storage with tamper-evidence and SIEM export.
- Add live read-only connector discovery for Entra ID, SharePoint, and AWS after connector security review.
- Persist discovery runs and native-grant readback outside the local in-memory store.
- Add dry-run provisioning and reconciliation job execution with queueing, retries, and dead-letter handling.
- Add controlled enforcement only after approval workflow, rollback, and connector least-privilege review are complete.
- Add ATO package generation for concrete system boundary diagrams, control implementation statements, POA&M inputs, and ConMon evidence.
