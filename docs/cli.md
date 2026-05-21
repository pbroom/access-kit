# CLI Contract

## Purpose

The `rebac` CLI is the operator, CI/CD, and inspection interface. It wraps the API contract and must not become a separate source of authorization logic.

## Command Families

```text
rebac subject sync --connector entra
rebac subject get user:123
rebac subject access user:123

rebac resource discover --connector sharepoint
rebac resource get document:case-plan
rebac resource access document:case-plan

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

rebac reconcile run --connector sharepoint --dry-run
rebac reconcile findings --severity high

rebac audit search --subject user:123 --from 2026-01-01
rebac evidence export --framework nist-800-53 --controls AC-2,AC-3,AU-2 --format json

rebac connector list
rebac connector test mock
rebac connector sync mock --mode read_only
```

## Current Milestone

The package exposes the command tree and a contract smoke test. Commands currently return the API surface they map to; runtime API calls will be implemented in a later milestone.
