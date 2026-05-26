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
- Admin authorization evidence references when the export supports a production deployment claim.

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
- Evidence export returns control mappings, source events, integrity manifest, artifacts, boundary, data flows, ConMon, POA&M, operational evidence, and SIEM metadata.
- Admin authorization evidence, when in scope, identifies the IdP or mTLS gateway configuration reference, admin ReBAC policy reference, secrets-manager references, break-glass approval, incident notification, post-action review, and related admin audit event types without exposing secret material.
- When the production audit adapter is configured, retained evidence also includes immutable audit/evidence receipts, signed audit windows, SIEM delivery status, and replay records for failed deliveries.

## Verification Steps

1. Confirm time window and controls.
2. Verify audit chain status.
3. Confirm exported event count is expected.
4. Confirm evidence source event IDs link to audit events.
5. Recompute evidence package and section hashes with [Evidence Integrity Verifier](../docs/evidence-integrity-verifier.md).
6. For production adapter runs, confirm signed audit window metadata, retention policy, immutable storage receipts, and SIEM delivery records.
7. For admin authorization claims, confirm `/v1/ready` reported `admin_authorization` as `pass` or record the non-production proof-point warning.
8. Record validation not performed, if any.

## Audit Events Emitted

- `audit.integrity_verified`
- `audit.exported`
- `evidence.generated`

## Evidence Retained

- Audit integrity report.
- Audit export metadata.
- Evidence export package.
- Integrity manifest verification result.
- Storage receipt, if configured.
- Signed audit window, SIEM delivery, and replay receipt when the production audit adapter or forwarder is configured.
- Requester, purpose, and delivery record.
- Admin authorization readiness output and post-action review evidence when the export covers privileged operator activity.

## Escalation Path

Escalate failed audit integrity, missing source events, export access concerns, or unreplayed SIEM delivery failures to security engineering and ISSO.

## Rollback Or Compensating Action

If an export is generated for the wrong scope, mark it superseded, restrict distribution, regenerate the bounded export, and retain both events for audit traceability.
