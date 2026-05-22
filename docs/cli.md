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

rebac provision plan user:123 document:case-plan read
rebac provision apply plan:abc
rebac provision revoke grant:abc

rebac reconcile run --connector sharepoint-readonly --dry-run
rebac reconcile findings --severity high

rebac discovery runs --connector sharepoint-readonly --status completed_with_warnings

rebac audit search --subject user:123 --from 2026-01-01
rebac evidence export --framework nist-800-53 --controls AC-2,AC-3,AU-2 --format json

rebac connector list
rebac connector test mock
rebac connector sync mock --mode read_only
```

## Phase 2 Runtime

The package exposes the command tree and calls the API over HTTP. Use `--api-url` or `REBAC_API_URL` to point the CLI at a running local or deployed control-plane API. Authorization logic stays in the API/core engine; the CLI is only an operator wrapper.

Read-only discovery uses `rebac connector sync <connector-id> --mode read_only`. Provider readback can then be inspected with `rebac resource native-access`, which returns observed native grants rather than intended grants or policy decisions. `rebac discovery runs` exposes run history, warning status, and cursor/evidence metadata for assessor and operator review.
