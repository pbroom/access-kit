# Proof-Point Validation Evidence

Generated at: 2026-05-23T19:45:52.848Z

Branch: codex/rebac-storage-contracts-v2

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
| container packaging validation | `corepack pnpm validate:packaging` | PASS |
| release packaging validation | `corepack pnpm validate:release-packaging` | PASS |
| deployment manifest validation | `corepack pnpm validate:deployment-manifests` | PASS |
| core engine tests | `corepack pnpm test:core` | PASS |
| API runtime tests | `corepack pnpm test:api` | PASS |
| CLI API smoke tests | `corepack pnpm test:cli` | PASS |

## Command Output

### typecheck

```text
> access-kit@0.1.0 typecheck /Users/peterbroomfield/access-kit-stack-ops
> tsc --noEmit
```

### schema validation

```text
> access-kit@0.1.0 validate:schemas /Users/peterbroomfield/access-kit-stack-ops
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
> access-kit@0.1.0 validate:openapi /Users/peterbroomfield/access-kit-stack-ops
> tsx scripts/validate-openapi.ts

Validated OpenAPI contract at /Users/peterbroomfield/access-kit-stack-ops/openapi/rebac-control-plane.yaml.
PASS 28 required API path groups are present.
PASS Phase 4 controlled-enforcement readiness, request, and job fields are present.
PASS Phase 5 readiness, audit integrity, audit export, and evidence export path groups are present.
PASS API examples validate against OpenAPI request and response schemas.
```

### policy fixture validation

```text
> access-kit@0.1.0 validate:policy /Users/peterbroomfield/access-kit-stack-ops
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
> access-kit@0.1.0 validate:cli-contract /Users/peterbroomfield/access-kit-stack-ops
> vitest run tests/cli/cli-contract.test.ts


 RUN  v4.1.7 /Users/peterbroomfield/access-kit-stack-ops


 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at  15:45:47
   Duration  161ms (transform 36ms, setup 0ms, import 53ms, tests 6ms, environment 0ms)
```

### container packaging validation

```text
> access-kit@0.1.0 validate:packaging /Users/peterbroomfield/access-kit-stack-ops
> tsx scripts/validate-container-packaging.ts

Validated deployable API container packaging.
PASS Dockerfile builds and runs the rebac-api runtime as a non-root container.
PASS Container packaging CI job builds and smoke-tests health, readiness, and API auth.
```

### release packaging validation

```text
> access-kit@0.1.0 validate:release-packaging /Users/peterbroomfield/access-kit-stack-ops
> tsx scripts/validate-release-packaging.ts

Validated deployable API release packaging.
PASS Container release workflow publishes only on tags or explicit manual dispatch.
PASS Container release workflow builds runtime image with SBOM/provenance, registry attestation, and keyless signing.
```

### deployment manifest validation

```text
> access-kit@0.1.0 validate:deployment-manifests /Users/peterbroomfield/access-kit-stack-ops
> tsx scripts/validate-deployment-manifests.ts

Validated deployable API Kubernetes manifests.
PASS Kubernetes manifests wire health/readiness probes, persistent state, secret references, and restricted runtime security.
PASS Admission policy requires immutable GHCR digests and keyless release signatures for rebac-api images.
```

### core engine tests

```text
> access-kit@0.1.0 test:core /Users/peterbroomfield/access-kit-stack-ops
> vitest run tests/core


 RUN  v4.1.7 /Users/peterbroomfield/access-kit-stack-ops


 Test Files  3 passed (3)
      Tests  29 passed (29)
   Start at  15:45:50
   Duration  199ms (transform 170ms, setup 0ms, import 224ms, tests 17ms, environment 0ms)
```

### API runtime tests

```text
> access-kit@0.1.0 test:api /Users/peterbroomfield/access-kit-stack-ops
> vitest run tests/api


 RUN  v4.1.7 /Users/peterbroomfield/access-kit-stack-ops


 Test Files  1 passed (1)
      Tests  67 passed (67)
   Start at  15:45:51
   Duration  462ms (transform 118ms, setup 0ms, import 156ms, tests 209ms, environment 0ms)
```

### CLI API smoke tests

```text
> access-kit@0.1.0 test:cli /Users/peterbroomfield/access-kit-stack-ops
> vitest run tests/cli


 RUN  v4.1.7 /Users/peterbroomfield/access-kit-stack-ops


 Test Files  3 passed (3)
      Tests  30 passed (30)
   Start at  15:45:52
   Duration  343ms (transform 258ms, setup 0ms, import 366ms, tests 145ms, environment 0ms)
```


## Covered Proof Points

- TypeScript strict type checking.
- JSON Schema validation for subject, resource, relationship, decision, native grant, discovery run, enforcement-readiness, provisioning plan, audit event, audit export, drift finding, audit-integrity, and evidence export examples.
- OpenAPI validation for required readiness, decision, inventory, native access, discovery, relationship, policy, provisioning, reconciliation, audit, audit-integrity, audit-export, evidence, connector, and enforcement-readiness path groups.
- Policy fixtures for deny by default, relationship allow, deny override, expired access denial, suspended-user denial, idempotency, and drift finding.
- CLI command contract mapping each operator command to an API surface.
- Deployable API container packaging validation for the Dockerfile, non-root runtime, /v1/ready healthcheck, API auth smoke path, and CI job.
- Release packaging validation for GHCR publishing gates, SBOM/provenance metadata, GitHub artifact attestation, and keyless cosign signing.
- Deployment manifest validation for Kubernetes probe wiring, secret references, persistent state/evidence mounts, restricted runtime security, network policy, immutable image digests, and signed-image admission policy.
- Local core engine tests for deterministic check/explain, decision audit emission, persistent graph/job repository contracts, defensive in-memory conformance behavior, and persistence-readiness gates for graph, audit, and job backends.
- API runtime tests for health, readiness probes, optional bearer-token API guarding, audited authentication failures, decision, relationship write audit, read-only mock and synthetic provider connector discovery, discovery run history, native access filtering, dry-run provisioning jobs, enforcement-readiness reports, controlled synthetic enforcement guardrails, audit integrity, SIEM-ready audit export, local file-backed audit/evidence storage, restartable JSON runtime state snapshots, API service runtime config, complete local ATO evidence packaging, access-review and exception evidence, idempotent job replay, and reconciliation.
- CLI API smoke tests for operator, CI/CD, assessor, audit-integrity, SIEM-ready audit export, ATO evidence export, dry-run provisioning, connector readiness, and controlled synthetic enforcement surfaces calling the API.

## Outstanding Requirements

- Implement production graph, append-only audit, and queue/job adapters behind the persistent storage contracts.
- Replace local JSON runtime snapshots with a production relationship graph and policy model store.
- Replace local release and deployment-manifest proof points with environment-specific registry promotion approvals, enforced signed-image admission, IaC overlays for ingress/certificates/storage/networking, identity-provider-backed authentication, and operator authorization.
- Replace local audit integrity, SIEM-ready audit exports, JSON snapshots, file-backed storage proof points, and SIEM export metadata with durable append-only audit storage, approved SIEM forwarding, retention, and replay procedures.
- Replace synthetic Entra ID, SharePoint, and AWS-style readback fixtures with live read-only connector discovery after connector security review.
- Persist discovery runs and native-grant readback in production data stores rather than local JSON snapshots.
- Replace local dry-run provisioning, controlled synthetic enforcement, readiness gates, and reconciliation jobs with durable queues, retries, and dead-letter handling.
- Extend enforcement beyond the synthetic mock connector only after approval workflow, rollback, operational runbooks, emergency revocation behavior, and connector least-privilege review are complete.
- Replace local ATO package proof points with deployment-specific diagrams, assessor-reviewed control statements, retained SBOM/security artifacts, access review campaigns, exception workflow, backup/restore test evidence, and ConMon delivery.
