# ATO Evidence Model

## Evidence Goal

The foundation must let an assessor trace architecture, data flow, control implementation, policy decision, enforcement action, verification, and audit evidence. Evidence should be generated continuously instead of assembled manually at the end.

This is ATO-oriented and ATO-inspectable evidence. It does not claim that the repository, local proof point, or any deployment has an authorization to operate.

## Control Families

The first milestone maps the domain and API contracts to these NIST/FedRAMP-relevant areas:

- AC: deny by default, least privilege, automated revocation, approved access paths, separation of duties.
- IA: federated identity assumptions, service identity inventory, admin identity controls.
- AU: decision logs, provisioning logs, readiness-check logs, admin logs, connector logs, tamper-evidence.
- CM: versioned policy models, connector configuration, enforcement-readiness reports, approved baselines, drift findings.
- CA: evidence exports, validation reports, access review results, continuous monitoring.
- RA/SI: vulnerability and dependency evidence, anomaly/drift findings, remediation tracking.
- SC: encryption, API security, key management, secure data flows.
- IR: emergency revocation, incident mode, lockout mode, post-action review.
- SA/SR: SBOMs, connector dependency inventory, secure SDLC evidence.
- PT: PII minimization and purpose limitation.

## Evidence Export Contract

Evidence exports include:

- framework
- control IDs
- time period
- evidence type
- source event IDs
- audit integrity report
- SIEM-ready audit event export
- system boundary and component inventory
- data-flow evidence
- control implementation mappings
- control implementation statements
- access review evidence with campaign, owner approval, finding, exception request, and remediation IDs
- exception register with request status, risk acceptance, expiry, owner approval, remediation, and evidence references
- continuous-monitoring metrics, including governance counters for pending approvals, pending risk acceptance, expired exceptions, and overdue remediation
- POA&M inputs, including governance findings with stable remediation IDs
- artifact manifest
- operational evidence for SBOM, dependency scanning, vulnerability scanning, configuration baseline, incident response, break-glass, backup, and contingency planning
- admin authorization evidence for IdP or mTLS gateway configuration, separate admin ReBAC policy, role bindings, secrets-manager references, break-glass approval, incident-mode notifications, and post-action review
- SIEM export metadata
- storage receipt, when an evidence repository is configured
- responsible role
- generated timestamp
- export format

The first generated evidence artifact is `reports/proof-point-validation.md`. It records tool versions, commit, command results, covered proof points, and outstanding requirements.

The default local Phase 5 evidence package is complete for proof-point validation: it includes boundary, data-flow, control statement, access review, exception, ConMon, POA&M, SIEM-ready, release-packaging, deployment-manifest, persistence-readiness, and operational evidence sections. Access review and exception evidence is backed by durable governance records for campaigns, findings, exception requests, owner approvals, risk acceptance, expiry, and remediation tracking; evidence export renders those records instead of inventing one-off local proof-point rows. The local runtime can export bounded audit windows as SIEM-ready JSONL records, persist audit events and evidence packages through a local file-backed repository, and keep restartable JSON state snapshots for validation. The production audit/evidence adapter adds implementation proof for immutable external audit receipts, signed audit windows, retention metadata, SIEM delivery monitoring, replay records, tamper-evident evidence package receipts, and backup/restore metadata. The admin authorization readiness contract adds a testable shape for IdP or mTLS gateway evidence, internal admin ReBAC, external secrets-manager references, break-glass approval, incident-mode notification, and post-action review evidence. The release workflow adds signature and provenance proof points for the deployable runtime package, deployment manifests prove probe, secret-reference, runtime hardening, and admission-policy contracts, and persistence readiness checks define graph/audit/job backend requirements plus schema-backed deployment-manifest controls, retained readiness report artifacts, IaC output references, release approvals, backup/restore records, and operator-control evidence for production storage claims. These adapter, admin-authorization, persistence, packaging, and governance paths are not substitutes for a selected production IdP, mTLS gateway, WORM driver, approved SIEM forwarding deployment, GRC system, deployment runbooks, database recovery exercises, signed-image admission enforcement, or assessor-approved control statements. They prove the contract and auditability shape without exporting production data, tenant identifiers, secrets, or live provider records.

## Local Phase 5 Evidence Package

- system boundary and component inventory
- data flow inventory
- authorization data model
- identity source inventory
- resource inventory
- connector inventory
- service account and service principal inventory
- privileged user list
- policy model versions
- access review results
- exception requests and risk acceptance
- remediation and POA&M-ready governance findings
- decision log samples
- enforcement-readiness reports
- audit integrity reports
- continuous monitoring metrics
- SIEM export records
- provisioning log samples
- admin activity logs
- configuration baseline
- vulnerability scan outputs
- incident response playbooks
- contingency and backup evidence
- encryption and key management documentation
- rules of behavior
- privacy notes
- control implementation statements
- POA&M register

## OSCAL Guidance

OSCAL artifacts are not generated by the current repository. If OSCAL output is added later, it should be generated from the same canonical sources used by evidence export: OpenAPI, JSON Schemas, ADRs, runbooks, audit events, control mappings, validation reports, system boundary, data flows, and deployment-specific control statements.

Until then, treat `schemas/evidence-export.schema.json` as the canonical package manifest and map its control statements and artifacts into OSCAL only as a downstream transformation.

## Related Documentation

- [Evidence Catalog](evidence-catalog.md)
- [Control Traceability Matrix](control-traceability-matrix.md)
- [Assessor Inspection Guide](assessor-inspection-guide.md)
- [Audit And Evidence Export Runbook](../runbooks/audit-evidence-export.md)
- [Access Review And Exception Governance Runbook](../runbooks/access-review-exceptions.md)
