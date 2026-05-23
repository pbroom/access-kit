# Audit And Evidence Export Runbook

## Purpose

Generate bounded audit and evidence exports for review, incident response, access review, or assessor inspection.

## Trigger

- Assessor evidence request.
- Incident review.
- Access review campaign.
- Control testing window.
- Pre-submit proof-point review.

## Severity

Low for routine export. Medium or high when tied to an incident or legal request.

## Required Role

ISSO, security engineer, assessor support role, or evidence owner.

## Prerequisites

- Framework and control IDs.
- Time window.
- Export format.
- Authorization to view audit/evidence data.

## Commands Or Proposed Commands

```sh
rebac audit integrity
rebac audit export --from 2026-05-01T00:00:00.000Z --to 2026-05-31T23:59:59.000Z --target operator_download
rebac evidence export --framework nist-800-53 --controls AC-2,AC-3,AU-2,AU-6,CA-7 --from 2026-05-01T00:00:00.000Z --to 2026-05-31T23:59:59.000Z --format json
pnpm evidence:check
```

## Expected Output

- Audit integrity report returns `verified` or findings.
- Audit export returns JSONL-ready event records and source event IDs.
- Evidence export returns control mappings, source events, artifacts, boundary, data flows, ConMon, POA&M, operational evidence, and SIEM metadata.

## Verification Steps

1. Confirm time window and controls.
2. Verify audit chain status.
3. Confirm exported event count is expected.
4. Confirm evidence source event IDs link to audit events.
5. Record validation not performed, if any.

## Audit Events Emitted

- `audit.integrity_verified`
- `audit.exported`
- `evidence.generated`

## Evidence Retained

- Audit integrity report.
- Audit export metadata.
- Evidence export package.
- Storage receipt, if configured.
- Requester, purpose, and delivery record.

## Escalation Path

Escalate failed audit integrity, missing source events, or export access concerns to security engineering and ISSO.

## Rollback Or Compensating Action

If an export is generated for the wrong scope, mark it superseded, restrict distribution, regenerate the bounded export, and retain both events for audit traceability.
