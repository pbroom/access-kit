# CLI Contract

## Purpose

The `rebac` CLI is the operator, CI/CD, and inspection interface. It wraps the API contract and must not become a separate source of authorization logic.

The implementation command manifest is `packages/cli/src/commands.ts`. Contract validation keeps the command-to-API mapping aligned with `openapi/rebac-control-plane.yaml`.

## Command Families

```text
rebac subject sync --connector entra-readonly
rebac subject get user:123
rebac subject access user:123

rebac resource discover --connector sharepoint-readonly
rebac resource get document:case-plan
rebac resource access document:case-plan
rebac resource native-access document:case-plan --connector mock --grant-type direct --principal-type user

rebac relation set user:123 member_of group:case-team
rebac relation delete user:123 member_of group:case-team
rebac relation path user:123 document:case-plan

rebac policy validate ./policy/model.yaml
rebac policy test ./policy/tests.yaml
rebac policy publish ./policy/model.yaml --change-ticket CHG-12345

rebac check user:123 read document:case-plan
rebac explain user:123 read document:case-plan

rebac provision plan user:123 document:case-plan read --connector mock
rebac provision apply plan:abc
rebac provision revoke grant:abc
rebac provision plan user:123 document:case-plan read --connector mock --mode enforcement --approver user:approver --change-ticket chg:phase4 --readiness-report readiness:mock:phase4 --synthetic-only
rebac provision apply plan:abc --mode enforcement --approver user:approver

rebac reconcile run --connector sharepoint-readonly --dry-run
rebac reconcile findings --severity high
rebac reconcile remediate --finding drift:001 --change-ticket chg:drift-001 --ticket chg:drift-001 --siem siem:drift-001 --max-severity high

rebac discovery runs --connector sharepoint-readonly --status completed_with_warnings

rebac audit search --subject user:123 --from 2026-01-01
rebac audit integrity
rebac audit export --from 2026-05-01T00:00:00.000Z --to 2026-05-31T23:59:59.000Z --target operator_download
rebac evidence export --framework nist-800-53 --controls AC-2,AC-3,AU-2 --from 2026-05-01T00:00:00.000Z --to 2026-05-31T23:59:59.000Z --format json
rebac evidence verify --package evidence-export.json

rebac connector list
rebac connector test mock
rebac connector readiness mock --mode enforcement --synthetic-only --approver-role access-approver --change-ticket-pattern '^chg:[a-z0-9_:-]+$'
rebac connector readiness mock --status ready
rebac connector sync mock --mode read_only
```

## Phase 2, 3, And 4 Runtime

The package exposes the command tree and calls the API over HTTP. Use `--api-url` or `REBAC_API_URL` to point the CLI at a running local or deployed control-plane API. Authorization logic stays in the API/core engine; the CLI is only an operator wrapper.

Policy commands follow the API lifecycle. `rebac policy validate` and `rebac policy test` ask the API to run deterministic model and proof-point checks; `rebac policy publish` requires a change ticket and fails closed when the target policy has not already passed validation.

Read-only discovery uses `rebac connector sync <connector-id> --mode read_only`. Provider readback can then be inspected with `rebac resource native-access`, which returns observed native grants rather than intended grants or policy decisions. `rebac discovery runs` exposes run history, warning status, and cursor/evidence metadata for assessor and operator review.

Dry-run provisioning uses `rebac provision plan` followed by `rebac provision apply`. By default, `apply` creates a dry-run job: provider writes are skipped, verification hooks run, compensation intent is recorded, and audit evidence is emitted.

Controlled enforcement is available only as a synthetic Phase 4 proof point against the `mock` connector. Operators first run `rebac connector readiness mock --mode enforcement --synthetic-only` and pass the resulting report ID into provisioning with `--readiness-report <id>`. The CLI can then send `--mode enforcement --approver <id> --change-ticket <id> --readiness-report <id> --synthetic-only`, which wraps the API approval and guardrail fields. It still contains no authorization logic and cannot enable live Microsoft, AWS, SharePoint, AD, or Power Platform writes.

Phase 5 assessor commands use the same API contract. `rebac audit integrity` requests an audit hash-chain report, `rebac audit export` requests SIEM-ready JSONL audit records for a time window, and `rebac evidence export` can request a framework, control set, time window, and format for the complete local ATO evidence package, including boundary, data-flow, access-review, exception, operational, ConMon, POA&M, OSCAL fragments, signed package metadata, verifier checks, control trace views, and SIEM metadata. `rebac evidence verify --package <path>` posts an exported package to the verifier endpoint and returns package hash, section hash, signature, deployment-scope, OSCAL, POA&M, and control trace checks.

## Security Considerations

- The CLI must not evaluate authorization locally.
- Use `--api-url` or `REBAC_API_URL` to target the intended API boundary.
- Treat evidence and explain output as sensitive.
- Do not place tokens, secrets, tenant IDs, production emails, or live provider identifiers in command examples.

## Related Documentation

- [API Contract Notes](api.md)
- [Decision Lifecycle](decision-lifecycle.md)
- [Explain API](explain-api.md)
- [Assessor Inspection Guide](assessor-inspection-guide.md)
- [CLI example script](../examples/cli/operator-and-assessor.sh)
