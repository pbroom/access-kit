# Provisioning Lifecycle

## Purpose

This page describes how Access Kit turns authorization intent into auditable provisioning plans, jobs, verification evidence, compensation intent, and drift checks.

## Audience

Platform engineers, security engineers, ISSOs, resource owners, connector developers, and assessors.

## What This Is

Provisioning is the controlled path from intended access to provider-facing actions. The current implementation supports dry-run provisioning and synthetic mock-only controlled enforcement.

## What This Is Not

Provisioning is not the decision itself, not a ticketing system, and not live Microsoft, AWS, SharePoint, Teams, Power Platform, Dataverse, or AD mutation. Decisions never mutate target systems directly.

## Lifecycle

1. A decision, request, revocation, expiration, or drift remediation creates intent.
2. `POST /v1/provisioning/plans` creates a `ProvisioningPlan`.
3. The plan records connector ID, subject, resource, action, mode, idempotency key, actions, verification expectations, and compensation intent.
4. Dry-run plans use `mode: "dry_run"` and `dryRun: true`.
5. Controlled enforcement plans require the synthetic `mock` connector, a ready enforcement-readiness report, approval, change ticket, and guardrail controls.
6. `POST /v1/provisioning/jobs` executes the plan.
7. Dry-run jobs skip provider writes, run verification hooks, and record planned compensation.
8. Synthetic enforcement jobs apply only through the mock connector and verify readback.
9. Jobs emit audit events and return stable job evidence.
10. Reconciliation compares intended and observed native state after provisioning.

## Concrete Example

```sh
rebac connector readiness mock --mode enforcement --synthetic-only --approver-role access-approver
rebac provision plan user:alice document:case-plan read --connector mock --mode enforcement --approver user:approver --change-ticket chg:phase4-controlled-enforcement --readiness-report readiness:mock:20260521t170000000z:1 --synthetic-only
rebac provision apply plan:decision:allow-alice-read-case-plan --mode enforcement --approver user:approver
```

For non-synthetic connectors, use dry-run only. The plan and job evidence show what would happen, what readback would verify, and what compensation would be needed.

## Security Considerations

- Use idempotency keys for every write path.
- Require readiness evidence before enforcement.
- Keep live provider writes blocked until connector least-privilege review, rollback, emergency revocation, and audit retention are complete.
- Prioritize revoke, expire, quarantine, and deny repair over new grants.
- Treat missing verification as failure or incomplete evidence.

## Audit And Evidence Implications

Provisioning emits audit events for plan creation, approval, job execution, skipped writes, verification, controlled synthetic enforcement, rollback, and reconciliation. Evidence exports use provisioning logs for AC, AU, CM, CA, and IR control support.

## Related Controls

AC-2, AC-3, AC-6, AU-2, AU-6, CM-3, CM-6, CA-7, and IR-4 depend on provisioning traceability and rollback evidence.

## Related References

- [Connector Contract](connector-contract.md)
- [Drift Detection Model](drift-detection-model.md)
- [Emergency Revocation Runbook](../runbooks/emergency-revocation.md)
- [Policy Rollback Runbook](../runbooks/policy-rollback.md)
- `schemas/provisioning-plan.schema.json`
- `tests/fixtures/schema-examples/provisioning-plan.json`
- [ADR 0007: Provisioning idempotency](../adrs/0007-provisioning-idempotency.md)
- [ADR 0010: Fail behavior](../adrs/0010-fail-behavior.md)
