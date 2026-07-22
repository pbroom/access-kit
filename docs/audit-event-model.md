# Audit Event Model

Audit events record decisions, denials, relationship writes, policy changes, connector activity, provisioning activity, drift findings, admin actions, integrity checks, and exports in an append-only, hash-chained stream. The local runtime verifies the chain and produces bounded JSONL-ready exports; the production audit adapter boundary adds immutable external receipts, retention metadata, signed windows, SIEM delivery monitoring, and replay records behind an injected store. That adapter is not a selected vendor ledger or approved SIEM deployment by itself — deployment teams still supply the environment-specific WORM driver, forwarder, access controls, and retained approvals.

## Core Concepts

| Concept                                   | Description                                                                                                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `eventId`                                 | Stable event identifier.                                                                                                                                                        |
| `eventType`                               | Machine-readable action type such as `decision.allowed`, `decision.denied`, `connector.discovery_completed`, `audit.exported`, or `evidence.generated`.                         |
| `occurredAt`                              | Event timestamp.                                                                                                                                                                |
| `actor`                                   | Service or principal responsible for the event.                                                                                                                                 |
| `subjectId` and `resourceId`              | Canonical IDs when the event concerns a subject or resource.                                                                                                                    |
| `correlationId`                           | Joins request, decision, provisioning, and evidence activity.                                                                                                                   |
| `policyVersion` and `relationshipVersion` | Decision traceability fields. Decision payloads also carry model, tuple, context, historical `asOf`, traversal, and latency SLO metadata when produced by the decision runtime. |
| `payloadHash`                             | Hash of the event payload.                                                                                                                                                      |
| `previousEventHash`                       | Hash-chain pointer for tamper-evidence.                                                                                                                                         |
| `payload`                                 | Event-specific details, minimized to required evidence.                                                                                                                         |

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
	"previousEventHash": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
	"payload": {
		"decisionId": "decision:allow-alice-read-case-plan",
		"reasonCode": "ALLOW_VIA_RELATIONSHIP_PATH"
	}
}
```

## Audit Integrity

`GET /v1/audit/integrity` verifies the append-only hash chain and returns an `AuditIntegrityReport`. The report includes event count, first and last event identifiers, first and last hashes, findings, status, verification time, and version.

## Audit Export

`GET /v1/audit/export` returns a bounded `AuditEventExport` with JSONL records, source event IDs, payload-hash inclusion, target, exported event count, and full-chain integrity status. The production adapter can retain signed audit windows and SIEM delivery or replay receipts for those windows; environment-specific forwarders still own actual SIEM transport and alert routing.

## Rules

- Never log secrets, tokens, production emails, live tenant IDs, or sensitive provider payloads.
- Production audit storage must use the immutable adapter boundary or a stricter equivalent: reject unredacted secret-bearing payloads, preserve event order, retain signed windows, and treat SIEM delivery failures as security-relevant findings until replay succeeds.
- Export consumers must preserve event order, hashes, and correlation IDs.
- Evidence exports include source event IDs and audit-integrity status so assessors can trace statements back to events.

## Related References

- [Evidence Catalog](evidence-catalog.md)
- [Audit/Evidence Export Runbook](../runbooks/audit-evidence-export.md)
- `schemas/audit-event.schema.json`
- `schemas/audit-integrity.schema.json`
- `schemas/audit-export.schema.json`
- `tests/fixtures/schema-examples/audit-event.json`
- [ADR 0005: Audit event log](../adrs/0005-audit-event-log.md)
