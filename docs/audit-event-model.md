# Audit Event Model

## Purpose

This page documents the append-only audit event model, tamper-evidence expectations, SIEM-ready export shape, and evidence implications.

## Audience

Security engineers, ISSOs, assessors, platform engineers, incident responders, and audit/evidence owners.

## What This Is

Audit events record decisions, denials, relationship writes, policy changes, connector activity, provisioning activity, drift findings, admin actions, audit integrity checks, audit exports, and evidence exports. The current local runtime supports hash-chain verification and bounded JSONL-ready audit exports.

## What This Is Not

The current audit implementation is not production WORM storage, approved SIEM delivery, retention policy, or immutable legal record. It is a local proof point for the contract and integrity model.

## Core Concepts

| Concept | Description |
| --- | --- |
| `eventId` | Stable event identifier. |
| `eventType` | Machine-readable action type such as `decision.allowed`, `decision.denied`, `connector.discovery_completed`, `audit.exported`, or `evidence.generated`. |
| `occurredAt` | Event timestamp. |
| `actor` | Service or principal responsible for the event. |
| `subjectId` and `resourceId` | Canonical IDs when the event concerns a subject or resource. |
| `correlationId` | Joins request, decision, provisioning, and evidence activity. |
| `policyVersion` and `relationshipVersion` | Decision traceability fields. |
| `payloadHash` | Hash of the event payload. |
| `previousEventHash` | Hash-chain pointer for tamper-evidence. |
| `payload` | Event-specific details, minimized to required evidence. |

## Concrete Example

```json
{
  "eventId": "evt:decision-allow-alice-read-case-plan",
  "eventType": "decision.allowed",
  "occurredAt": "2026-05-21T17:00:00.000Z",
  "actor": "service:decision-engine",
  "subjectId": "user:alice",
  "resourceId": "document:case-plan",
  "correlationId": "corr:decision-allow-alice-read-case-plan",
  "policyVersion": "policy:test-v1",
  "relationshipVersion": "tuple-set:test-v1",
  "payloadHash": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "payload": {
    "decisionId": "decision:allow-alice-read-case-plan",
    "reasonCode": "ALLOW_VIA_RELATIONSHIP_PATH"
  }
}
```

## Audit Integrity

`GET /v1/audit/integrity` verifies the append-only hash chain and returns an `AuditIntegrityReport`. The report includes event count, first and last event identifiers, first and last hashes, findings, status, verification time, and version.

## Audit Export

`GET /v1/audit/export` returns a bounded `AuditEventExport` with JSONL records, source event IDs, payload-hash inclusion, target, exported event count, and full-chain integrity status. Local targets are contract proof points; production SIEM forwarding remains future deployment work.

## Security Considerations

- Do not log secrets, tokens, production emails, live tenant IDs, or sensitive provider payloads.
- Audit events should be append-only and hash chained.
- Production deployments require immutable or tamper-evident storage, retention, replay, and monitoring.
- Audit export consumers must preserve event order, hashes, and correlation IDs.

## Audit And Evidence Implications

Audit events are source evidence for AC, AU, CM, CA, IR, and SI controls. Evidence exports should include source event IDs and audit-integrity status so assessors can trace statements back to events.

## Related Controls

AU-2, AU-3, AU-6, AU-9, AC-2, AC-3, CM-3, CA-7, IR-5, and SI-4.

## Related References

- [Evidence Catalog](evidence-catalog.md)
- [Control Traceability Matrix](control-traceability-matrix.md)
- [Audit/Evidence Export Runbook](../runbooks/audit-evidence-export.md)
- `schemas/audit-event.schema.json`
- `schemas/audit-integrity.schema.json`
- `schemas/audit-export.schema.json`
- `tests/fixtures/schema-examples/audit-event.json`
- [ADR 0005: Audit event log](../adrs/0005-audit-event-log.md)
