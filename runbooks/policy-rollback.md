# Policy Rollback Runbook

## Purpose

Restore a prior policy version when a policy publication causes incorrect allows, incorrect denies, failed proof points, or unacceptable drift risk.

## Trigger

- New policy version fails validation or proof points.
- Incident review identifies policy regression.
- Excessive denials or unexpected allows after publication.
- Assessor or ISSO rejects policy evidence.

## Severity

Medium by default. High when sensitive resources, production outage, or unauthorized access is involved.

## Required Role

Policy owner plus security engineer or ISSO approval for high-severity rollback.

## Prerequisites

- Current and target policy versions.
- Change ticket.
- Impacted subject/resource/action sample.
- Latest proof-point validation result.

## Commands Or Proposed Commands

```sh
rebac policy validate ./policy/model.yaml
rebac policy test ./policy/tests.yaml
rebac policy publish ./policy/model.yaml --change-ticket chg:rollback-review
rebac explain user:alice read document:case-plan
pnpm validate:policy
pnpm validate:contracts
```

`POST /v1/policies/{id}/rollback` is the canonical API surface for rollback once policy storage is implemented. A future CLI flag such as `rebac explain ... --policy-version policy:previous` would be proposed behavior; it is not implemented in the current CLI.

## Expected Output

- Validation identifies the failed behavior or confirms the target version.
- Explain responses show the restored reason code.
- Policy rollback audit event references current version, target version, actor, and change ticket.

## Verification Steps

1. Run policy proof points.
2. Run targeted explain samples for impacted resources.
3. Confirm new decisions reference the rollback policy version.
4. Run reconciliation when policy changes affect intended grants.
5. Export audit/evidence for the rollback window.

## Audit Events Emitted

- `policy.validated`
- `policy.rollback_requested`
- `policy.published` or `policy.rolled_back`
- `decision.allowed` or `decision.denied`
- `evidence.generated`

## Evidence Retained

- Policy versions before and after rollback.
- Proof-point output.
- Explain samples.
- Change ticket.
- Audit events and evidence export.

## Escalation Path

Escalate to ISSO, product/governance lead, resource owners, and incident response if rollback affects privileged or sensitive resources.

## Rollback Or Compensating Action

If rollback creates a different unacceptable access state, publish a narrowly scoped emergency policy or explicit deny tuple with expiration and approval.
