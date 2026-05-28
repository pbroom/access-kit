# Proof-Point Validation Evidence

Generated at: 2026-05-28T03:11:04.689Z

Branch: codex/rebac-microsoft-delta-coverage

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
| connector security gate validation | `corepack pnpm validate:connector-security` | PASS |
| CLI command contract | `corepack pnpm validate:cli-contract` | PASS |
| container packaging validation | `corepack pnpm validate:packaging` | PASS |
| release packaging validation | `corepack pnpm validate:release-packaging` | PASS |
| deployment manifest validation | `corepack pnpm validate:deployment-manifests` | PASS |
| persistence deployment evidence validation | `corepack pnpm validate:persistence-deployment` | PASS |
| runbook exercise evidence validation | `corepack pnpm validate:runbook-exercises` | PASS |
| secure SDLC release evidence validation | `corepack pnpm validate:secure-sdlc` | PASS |
| core engine tests | `corepack pnpm test:core` | PASS |
| API runtime tests | `corepack pnpm test:api` | PASS |
| connector package tests | `corepack pnpm exec vitest run tests/connectors` | PASS |
| CLI API smoke tests | `corepack pnpm test:cli` | PASS |

## Command Output

### typecheck

```text
> access-kit@0.1.0 typecheck /Users/peterbroomfield/access-kit-microsoft-delta-coverage
> tsc --noEmit
```

### schema validation

```text
> access-kit@0.1.0 validate:schemas /Users/peterbroomfield/access-kit-microsoft-delta-coverage
> tsx scripts/validate-schemas.ts

Validated 18 schemas and 18 example fixtures.
PASS audit-event.json -> schemas/audit-event.schema.json
PASS audit-export.json -> schemas/audit-export.schema.json
PASS audit-integrity.json -> schemas/audit-integrity.schema.json
PASS connector-security-review.json -> schemas/connector-security-review.schema.json
PASS decision.json -> schemas/decision.schema.json
PASS discovery-run.json -> schemas/discovery-run.schema.json
PASS drift-finding.json -> schemas/drift-finding.schema.json
PASS enforcement-readiness.json -> schemas/enforcement-readiness.schema.json
PASS evidence-export.json -> schemas/evidence-export.schema.json
PASS native-grant.json -> schemas/native-grant.schema.json
PASS persistence-deployment-manifest.json -> schemas/persistence-deployment-manifest.schema.json
PASS persistence-deployment-readiness.json -> schemas/persistence-deployment-readiness.schema.json
PASS policy-model.json -> schemas/policy-model.schema.json
PASS provisioning-plan.json -> schemas/provisioning-plan.schema.json
PASS relationship.json -> schemas/relationship.schema.json
PASS resource.json -> schemas/resource.schema.json
PASS runbook-exercise.json -> schemas/runbook-exercise.schema.json
PASS subject.json -> schemas/subject.schema.json
```

### OpenAPI validation

```text
> access-kit@0.1.0 validate:openapi /Users/peterbroomfield/access-kit-microsoft-delta-coverage
> tsx scripts/validate-openapi.ts

Validated OpenAPI contract at /Users/peterbroomfield/access-kit-microsoft-delta-coverage/openapi/rebac-control-plane.yaml.
PASS 29 required API path groups are present.
PASS Phase 4 controlled-enforcement readiness, request, and job fields are present.
PASS Phase 5 readiness, audit integrity, audit export, and evidence export path groups are present.
PASS API examples validate against OpenAPI request and response schemas.
PASS API contract snapshot and generated TypeScript client metadata match OpenAPI.
PASS API versioning, deprecation, authentication, and rate-limit metadata are present.
```

### policy fixture validation

```text
> access-kit@0.1.0 validate:policy /Users/peterbroomfield/access-kit-microsoft-delta-coverage
> tsx scripts/validate-policy-fixtures.ts

Validated 13 policy proof points.
PASS default policy model -> 21 checks
PASS deny by default without relationship path
PASS deny unsupported action despite read relationship
PASS allow through relationship path
PASS allow through transitive reader relationship path
PASS allow through nested container relationship path
PASS allow through admin relationship path
PASS deny override beats allow path
PASS group-level deny override beats direct allow path
PASS expired access is denied
PASS suspended user is denied
PASS suspended intermediate group is not traversed
PASS duplicate event idempotency is specified
PASS drift is represented as security finding
```

### connector security gate validation

```text
> access-kit@0.1.0 validate:connector-security /Users/peterbroomfield/access-kit-microsoft-delta-coverage
> node --conditions=types --import tsx scripts/validate-connector-security-gate.ts

Validated connector security gates for 4 connector(s).
PASS mock: identity, consent, tenant boundary, and least-privilege scopes match runtime metadata; read-only health checks and scope checks pass; pagination, throttling, deletion, coverage-warning, and native-readback semantics are reviewed; secret handling is documented as synthetic/no-secret; live writes remain blocked and readiness gate preserves synthetic-only enforcement
PASS entra-readonly: identity, consent, tenant boundary, and least-privilege scopes match runtime metadata; read-only health checks and scope checks pass; pagination, throttling, deletion, coverage-warning, and native-readback semantics are reviewed; secret handling is documented as synthetic/no-secret; live writes remain blocked and readiness gate preserves synthetic-only enforcement
PASS sharepoint-readonly: identity, consent, tenant boundary, and least-privilege scopes match runtime metadata; read-only health checks and scope checks pass; pagination, throttling, deletion, coverage-warning, and native-readback semantics are reviewed; secret handling is documented as synthetic/no-secret; live writes remain blocked and readiness gate preserves synthetic-only enforcement
PASS aws-readonly: identity, consent, tenant boundary, and least-privilege scopes match runtime metadata; read-only health checks and scope checks pass; pagination, throttling, deletion, coverage-warning, and native-readback semantics are reviewed; secret handling is documented as synthetic/no-secret; live writes remain blocked and readiness gate preserves synthetic-only enforcement
```

### CLI command contract

```text
> access-kit@0.1.0 validate:cli-contract /Users/peterbroomfield/access-kit-microsoft-delta-coverage
> vitest run tests/cli/cli-contract.test.ts


 RUN  v4.1.7 /Users/peterbroomfield/access-kit-microsoft-delta-coverage


 Test Files  1 passed (1)
      Tests  5 passed (5)
   Start at  23:10:59
   Duration  274ms (transform 130ms, setup 0ms, import 203ms, tests 19ms, environment 0ms)
```

### container packaging validation

```text
> access-kit@0.1.0 validate:packaging /Users/peterbroomfield/access-kit-microsoft-delta-coverage
> tsx scripts/validate-container-packaging.ts

Validated deployable API container packaging.
PASS Dockerfile builds and runs the rebac-api runtime as a non-root container.
PASS Container packaging CI job builds and smoke-tests health, readiness, and API auth.
```

### release packaging validation

```text
> access-kit@0.1.0 validate:release-packaging /Users/peterbroomfield/access-kit-microsoft-delta-coverage
> tsx scripts/validate-release-packaging.ts

Validated deployable API release packaging.
PASS Container release workflow publishes only on tags or explicit manual dispatch.
PASS Container release workflow builds runtime image with SBOM/provenance, registry attestation, and keyless signing.
```

### deployment manifest validation

```text
> access-kit@0.1.0 validate:deployment-manifests /Users/peterbroomfield/access-kit-microsoft-delta-coverage
> tsx scripts/validate-deployment-manifests.ts

Validated deployable API Kubernetes manifests.
PASS Kubernetes manifests wire health/readiness probes, persistent state, secret references, and restricted runtime security.
PASS Admission policy requires immutable GHCR digests and keyless release signatures for rebac-api images.
```

### persistence deployment evidence validation

```text
> access-kit@0.1.0 validate:persistence-deployment /Users/peterbroomfield/access-kit-microsoft-delta-coverage
> tsx scripts/validate-persistence-deployment.ts

Validated persistence deployment manifest.
PASS Production persistence manifest schema, readiness report artifact, IaC evidence, release approval, backup/restore, and operator controls are wired.
PASS Local proof-point persistence manifests remain blocked from production readiness.
```

### runbook exercise evidence validation

```text
> access-kit@0.1.0 validate:runbook-exercises /Users/peterbroomfield/access-kit-microsoft-delta-coverage
> tsx scripts/validate-runbook-exercises.ts

Validated runbook exercise evidence.
PASS Runbook rehearsal evidence covers incident response, break-glass, backup/restore, contingency, emergency revocation, SIEM replay, and post-action review.
PASS Exercise record is deployment-scoped, synthetic, redacted, and not assessor-approved production evidence.
```

### secure SDLC release evidence validation

```text
> access-kit@0.1.0 validate:secure-sdlc /Users/peterbroomfield/access-kit-microsoft-delta-coverage
> tsx scripts/validate-secure-sdlc-evidence.ts

Validated secure SDLC release evidence.
PASS SAST, DAST, dependency, SBOM, fuzzing, tenant-isolation abuse, threat-model, vulnerability triage, and NIST SSDF evidence are retained or release-gated.
PASS Secure SDLC evidence maps mitigations across authorization, connector, persistence, cross-tenant isolation, and evidence-abuse paths.
```

### core engine tests

```text
> access-kit@0.1.0 test:core /Users/peterbroomfield/access-kit-microsoft-delta-coverage
> vitest run tests/core


 RUN  v4.1.7 /Users/peterbroomfield/access-kit-microsoft-delta-coverage


 Test Files  10 passed (10)
      Tests  148 passed (148)
   Start at  23:11:02
   Duration  223ms (transform 794ms, setup 0ms, import 1.09s, tests 102ms, environment 0ms)
```

### API runtime tests

```text
> access-kit@0.1.0 test:api /Users/peterbroomfield/access-kit-microsoft-delta-coverage
> vitest run tests/api


 RUN  v4.1.7 /Users/peterbroomfield/access-kit-microsoft-delta-coverage


 Test Files  4 passed (4)
      Tests  107 passed (107)
   Start at  23:11:02
   Duration  488ms (transform 494ms, setup 0ms, import 733ms, tests 250ms, environment 0ms)
```

### connector package tests

```text
RUN  v4.1.7 /Users/peterbroomfield/access-kit-microsoft-delta-coverage


 Test Files  3 passed (3)
      Tests  43 passed (43)
   Start at  23:11:03
   Duration  224ms (transform 334ms, setup 0ms, import 433ms, tests 48ms, environment 0ms)
```

### CLI API smoke tests

```text
> access-kit@0.1.0 test:cli /Users/peterbroomfield/access-kit-microsoft-delta-coverage
> vitest run tests/cli


 RUN  v4.1.7 /Users/peterbroomfield/access-kit-microsoft-delta-coverage


 Test Files  3 passed (3)
      Tests  35 passed (35)
   Start at  23:11:04
   Duration  308ms (transform 350ms, setup 0ms, import 603ms, tests 104ms, environment 0ms)
```


## Covered Proof Points

- TypeScript strict type checking.
- JSON Schema validation for subject, resource, relationship, decision, native grant, discovery run, connector-security-review, enforcement-readiness, provisioning plan, audit event, audit export, drift finding, audit-integrity, persistence-deployment manifest, persistence-deployment readiness, runbook exercise, and evidence export examples.
- OpenAPI validation for required readiness, decision, inventory, native access, discovery, relationship, policy, provisioning, reconciliation, audit, audit-integrity, audit-export, evidence, connector, enforcement-readiness, generated client metadata, contract snapshots, versioning, deprecation, authentication, rate-limit, and API example path groups.
- Policy fixtures for deny by default, relationship allow, deny override, expired access denial, suspended-user denial, idempotency, and drift finding.
- Connector security gate validation for connector identity, consent, tenant boundary, least-privilege read scopes, approved Microsoft Graph and AWS live-read scopes, pagination, throttling, deletion semantics, coverage-warning requirements, secret handling, and no-write defaults.
- CLI command contract mapping each operator command to an API surface.
- Deployable API container packaging validation for the Dockerfile, non-root runtime, /v1/ready healthcheck, API auth smoke path, and CI job.
- Release packaging validation for GHCR publishing gates, SBOM/provenance metadata, GitHub artifact attestation, and keyless cosign signing.
- Deployment manifest validation for Kubernetes probe wiring, secret references, persistent state/evidence mounts, restricted runtime security, network policy, immutable image digests, and signed-image admission policy.
- Persistence deployment evidence validation for the production manifest schema, retained readiness report artifact, external backend readiness, IaC output references, release approval, backup/restore, operator controls, and blocked local proof-point manifests.
- Runbook exercise evidence validation for rehearsed incident response, break-glass, backup/restore, contingency, emergency revocation, SIEM replay, and post-action review evidence records with redaction and non-production classification checks.
- Secure SDLC release evidence validation for SAST, DAST, dependency scanning, SBOM/provenance, fuzzing, tenant-isolation abuse tests, threat-model refresh, vulnerability triage, and NIST SSDF evidence.
- Local core engine tests for deterministic check/explain, decision audit emission, shared graph and connector-state repository conformance across in-memory, local JSON, production external, and production queue adapters, local JSON graph persistence and tamper checks, local append-only audit persistence and tamper findings, local JSON job persistence and idempotency lookups, production graph, connector-state, queue, and audit/evidence tenant/secret/backup checks, production audit signed windows, SIEM delivery monitoring, replay, immutable evidence receipts, tamper detection, queue idempotency, priority, retry, dead-letter, replay, connector-health semantics, admin authorization readiness for IdP or mTLS gateway controls, internal admin ReBAC, secrets-manager references, break-glass, incident notification, and post-action review, persistence-readiness gates for graph, audit, and job backends, and production persistence manifest readiness checks.
- API runtime tests for health, readiness probes, optional bearer-token API guarding, audited authentication failures, admin authorization readiness reporting without token, claim, header, certificate, connector, or secret leakage, decision, relationship write audit, read-only mock and synthetic provider connector discovery, repository-backed discovery run history, native access filtering, drift finding and reconciliation recovery, dry-run provisioning jobs, enforcement-readiness reports, controlled synthetic enforcement guardrails, audit integrity, SIEM-ready audit export, local file-backed audit/evidence storage, production audit/evidence adapter runtime persistence, restartable JSON runtime state snapshots, API service runtime config, complete local ATO evidence packaging, access-review and exception evidence, idempotent job replay, reconciliation, queued discovery, queued provisioning, queued evidence, queued revocation, and execution-time queue enforcement revalidation.
- Connector package tests for Microsoft Graph Entra, Microsoft 365 group and Teams coupling, SharePoint and OneDrive inventory, inheritance markers, coverage warnings, ownership, AWS read-only inventory, native grants, pagination, throttling, redaction, no-write, security-gate, and optional runtime-registration behavior, plus the sample read-only connector template for synthetic fixtures, tombstones, stale-grant replacement, redacted evidence, fail-closed provisioning hooks, and intentional security-gate registration.
- CLI API smoke tests for operator, CI/CD, assessor, audit-integrity, SIEM-ready audit export, ATO evidence export, dry-run provisioning, connector readiness, and controlled synthetic enforcement surfaces calling the API.
- Generated API client tests for bearer authentication, idempotency headers, fail-closed protected calls, and retry-after error propagation.

## Outstanding Requirements

- Select and configure an environment-specific production relationship graph and policy model store driver behind the production graph adapter.
- Select and configure an environment-specific WORM or immutable-ledger driver behind the production audit/evidence adapter.
- Select and configure an environment-specific queue driver behind the production queue/job adapter.
- Replace synthetic production persistence manifest evidence with environment-specific IaC outputs, approvals, and retained evidence artifacts.
- Replace local release and deployment-manifest proof points with environment-specific registry promotion approvals, enforced signed-image admission, IaC overlays for ingress/certificates/storage/networking, identity-provider-backed authentication, and operator authorization.
- Replace local bearer-token admin proof points with environment-specific IdP or mTLS gateway deployment, trusted identity propagation, separate admin ReBAC policy, secrets-manager integration, incident-mode notifications, break-glass approval, post-action review evidence, and request-scoped admin actor binding.
- Replace local audit integrity, SIEM-ready audit exports, JSON snapshots, local append-only audit proof points, and adapter-level SIEM delivery metadata with deployment-specific durable audit storage, approved SIEM forwarding, retention, alert routing, and replay evidence.
- Retain live Microsoft Graph and AWS sandbox evidence for environment-specific verification, and replace remaining synthetic SharePoint, OneDrive, and AWS-style readback fixtures with live read-only connector discovery after connector security review.
- Select and configure environment-specific production connector-state storage behind the production connector-state adapter for discovery runs, native-grant readback, drift findings, and reconciliation evidence.
- Deploy managed queue workers with production monitoring, retry, dead-letter, replay, and emergency revocation operating procedures.
- Extend enforcement beyond the synthetic mock connector only after approval workflow, rollback, operational runbooks, emergency revocation behavior, and connector least-privilege review are complete.
- Replace local ATO package proof points with deployment-specific diagrams, assessor-reviewed control statements, retained SBOM/security artifacts, access review campaigns, exception workflow, backup/restore test evidence, runbook exercise approvals, and ConMon delivery.
