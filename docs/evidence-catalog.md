# Evidence Catalog

## Purpose

This page catalogs the evidence Access Kit can produce or reference for ATO-oriented inspection.

## Audience

ISSOs, assessors, security engineers, platform engineers, governance leads, and evidence owners.

## What This Is

The evidence catalog maps repo artifacts, runtime exports, audit events, schemas, examples, runbooks, and validation reports to inspection use cases. It is an ATO-oriented foundation, not an authorization status claim.

## What This Is Not

This is not a complete system security plan, production evidence vault, WORM archive, approved SIEM integration, or FedRAMP package.

## Evidence Types

| Evidence type | Canonical artifact | Notes |
| --- | --- | --- |
| API contract | `openapi/rebac-control-plane.yaml` | Public API source of truth. |
| Schema contracts | `schemas/*.schema.json` | Portable object contracts. |
| Schema examples | `tests/fixtures/schema-examples/*.json` | Validated synthetic examples. |
| CLI contract | `packages/cli/src/commands.ts` and [CLI Contract](cli.md) | CLI maps to API, no local authorization logic. |
| Policy proof points | `tests/fixtures/policy/proof-points.json` | Deterministic behavior coverage. |
| ADRs | `adrs/0001-*.md` through `adrs/0010-*.md` | Architecture decisions. |
| Audit events | `schemas/audit-event.schema.json` | Decision and operational traceability. |
| Audit integrity | `schemas/audit-integrity.schema.json` | Hash-chain verification, including production audit adapter delivery findings. |
| Audit export | `schemas/audit-export.schema.json` | SIEM-ready JSONL package shape. |
| Persistence deployment manifest | `schemas/persistence-deployment-manifest.schema.json` | Production persistence backend and deployment-control gate. |
| Persistence deployment readiness | `schemas/persistence-deployment-readiness.schema.json` | Deterministic deployment-readiness report contract. |
| Persistence deployment evidence | `deploy/persistence/production-manifest.example.json` | Synthetic IaC, release, backup/restore, and operator-control references. |
| Admin authorization readiness | `packages/core/src/admin-authorization.ts` and `/v1/ready` | IdP or mTLS gateway, admin ReBAC, secrets-manager, break-glass, incident notification, and post-action review evidence contract. |
| Evidence export | `schemas/evidence-export.schema.json` | ATO package manifest with reproducible integrity hashes and optional immutable external storage receipts. |
| Evidence integrity verifier | [Evidence Integrity Verifier](evidence-integrity-verifier.md) | Steps for recomputing package and section hashes from stable JSON. |
| Validation report | `reports/proof-point-validation.md` | Generated proof-point evidence. |
| Runbooks | `runbooks/*.md` | Operational procedures and expected evidence. |

## Evidence Export Package

The `EvidenceExport` contract can include framework, controls, time period, source event IDs, audit integrity, an integrity manifest, control mappings, control statements, artifacts, system boundary, data flows, access reviews, exceptions, ConMon metrics, POA&M inputs, operational evidence, SIEM metadata, and storage receipt.

If the goal is an evidence package, use `schemas/evidence-export.schema.json`. Add a separate `evidence-object` schema only if atomic evidence objects become a distinct contract.

## Concrete Example

An assessor samples AC-3 for May 2026. The operator exports evidence for `AC-3`, includes source decision events, audit integrity status, control mapping, system boundary, and access-review evidence, then uses the decision and explain docs to trace a sample event back to policy and relationship versions.

## Security Considerations

- Evidence packages and integrity manifests must not include secrets, tokens, live tenant IDs, production emails, or sensitive provider payloads.
- Local file-backed receipts are proof points, not production immutability.
- Local bearer-token admin controls are proof points, not production admin authentication.
- Production evidence requires immutable adapter receipts, retention, access control, tamper evidence, delivery/replay monitoring, and reviewer approval.
- Production admin authorization evidence requires IdP or mTLS gateway configuration references, admin ReBAC policy and role-binding evidence, secrets-manager references, break-glass approval, incident notifications, and post-action review records.
- Mark assumptions, gaps, and planned controls clearly.

## Audit And Evidence Implications

Evidence generation emits an `evidence.generated` audit event. Evidence exports should include source event IDs and audit integrity so claims can be traced back to append-only events.

## Related Controls

AC, AU, CA, CM, IA, IR, RA, SA, SC, SI, SR, and PT families may reference evidence catalog entries.

## Related References

- [ATO Evidence Model](ato-evidence-model.md)
- [Control Traceability Matrix](control-traceability-matrix.md)
- [Assessor Inspection Guide](assessor-inspection-guide.md)
- [Audit Event Model](audit-event-model.md)
- `schemas/evidence-export.schema.json`
- `tests/fixtures/schema-examples/evidence-export.json`
- [ADR 0008: Evidence export control mapping](../adrs/0008-evidence-export-control-mapping.md)
