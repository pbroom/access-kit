# Connector Outage Runbook

## Purpose

Respond when a connector cannot discover, read back, verify, or reconcile provider access.

## Trigger

- Connector health check fails.
- Discovery run fails or completes with blocking warnings.
- Provisioning verification cannot read back state.
- Reconciliation coverage is incomplete.

## Severity

Medium for degraded readback. High when revocation, sensitive resources, or active incident response depends on the connector.

## Required Role

Platform engineer or connector owner, with security engineer involvement for high severity.

## Prerequisites

- Connector ID.
- Latest connector test result.
- Latest discovery run ID.
- Provider status and credential status, when live connectors exist.

## Commands Or Proposed Commands

```sh
rebac connector list
rebac connector test mock
rebac connector sync mock --mode read_only
rebac discovery runs --connector mock --status failed
rebac audit search --from 2026-05-23
```

## Expected Output

- Connector test identifies failing permission, health, or boundary check.
- Discovery run records failure or warnings.
- Audit events preserve outage evidence.

## Verification Steps

1. Confirm connector health after mitigation.
2. Run read-only sync.
3. Confirm discovery counts and warnings are acceptable.
4. Run reconciliation for affected resources.
5. Review audit events and evidence export.

## Audit Events Emitted

- `connector.tested`
- `connector.discovery_completed` or failure equivalent
- `audit.exported`
- `evidence.generated`

## Evidence Retained

- Connector test output.
- Discovery run.
- Warning list and cursor metadata.
- Provider status reference.
- Mitigation notes.

## Escalation Path

Escalate to provider platform owner, security engineer, ISSO, and incident response when revocation or high-risk drift cannot be verified.

## Rollback Or Compensating Action

Pause new grants for affected connector boundaries. Use provider-native emergency revocation if Access Kit cannot verify high-risk access.
