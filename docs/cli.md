# CLI Contract

## Purpose

The `rebac` CLI is the operator, CI/CD, and inspection interface. It wraps the API contract and must not become a separate source of authorization logic.

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
rebac provision plan user:123 document:case-plan read --connector mock --mode enforcement --approver user:approver --change-ticket chg:phase4 --synthetic-only
rebac provision apply plan:abc --mode enforcement --approver user:approver --change-ticket chg:phase4 --synthetic-only

rebac reconcile run --connector sharepoint-readonly --dry-run
rebac reconcile findings --severity high

rebac discovery runs --connector sharepoint-readonly --status completed_with_warnings

rebac audit search --subject user:123 --from 2026-01-01
rebac audit integrity
rebac evidence export --framework nist-800-53 --controls AC-2,AC-3,AU-2 --from 2026-05-01T00:00:00.000Z --to 2026-05-31T23:59:59.000Z --format json

rebac connector list
rebac connector test mock
rebac connector readiness mock --mode enforcement --synthetic-only --approver-role access-approver --change-ticket-pattern '^chg:[a-z0-9_:-]+$'
rebac connector readiness mock --status ready
rebac connector sync mock --mode read_only
```

## Phase 2, 3, And 4 Runtime

The package exposes the command tree and calls the API over HTTP. Use `--api-url` or `REBAC_API_URL` to point the CLI at a running local or deployed control-plane API. Authorization logic stays in the API/core engine; the CLI is only an operator wrapper.

Read-only discovery uses `rebac connector sync <connector-id> --mode read_only`. Provider readback can then be inspected with `rebac resource native-access`, which returns observed native grants rather than intended grants or policy decisions. `rebac discovery runs` exposes run history, warning status, and cursor/evidence metadata for assessor and operator review.

Dry-run provisioning uses `rebac provision plan` followed by `rebac provision apply`. By default, `apply` creates a dry-run job: provider writes are skipped, verification hooks run, compensation intent is recorded, and audit evidence is emitted.

Controlled enforcement is available only as a synthetic Phase 4 proof point against the `mock` connector. Operators first run `rebac connector readiness mock --mode enforcement --synthetic-only` and pass the resulting report ID into provisioning with `--readiness-report <id>`. The CLI can then send `--mode enforcement --approver <id> --change-ticket <id> --readiness-report <id> --synthetic-only`, which wraps the API approval and guardrail fields. It still contains no authorization logic and cannot enable live Microsoft, AWS, SharePoint, AD, or Power Platform writes.

Phase 5 assessor commands use the same API contract. `rebac audit integrity` requests an audit hash-chain report, and `rebac evidence export` can request a framework, control set, time window, and format for the ATO evidence package metadata.
