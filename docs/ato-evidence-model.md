# ATO Evidence Model

## Evidence Goal

The foundation must let an assessor trace architecture, data flow, control implementation, policy decision, enforcement action, verification, and audit evidence. Evidence should be generated continuously instead of assembled manually at the end.

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
- access review evidence
- exception register
- continuous-monitoring metrics
- POA&M inputs
- artifact manifest
- operational evidence for SBOM, dependency scanning, vulnerability scanning, configuration baseline, incident response, break-glass, backup, and contingency planning
- SIEM export metadata
- storage receipt, when an evidence repository is configured
- responsible role
- generated timestamp
- export format

The first generated evidence artifact is `reports/proof-point-validation.md`. It records tool versions, commit, command results, covered proof points, and outstanding requirements.

The default local Phase 5 evidence package is complete for proof-point validation: it includes boundary, data-flow, control statement, access review, exception, ConMon, POA&M, SIEM-ready, release-packaging, and operational evidence sections. The local runtime can export bounded audit windows as SIEM-ready JSONL records, persist audit events and evidence packages through a local file-backed repository, and keep restartable JSON state snapshots for validation. The release workflow adds signed-image and provenance proof points for the deployable API package. These local persistence and packaging paths are not substitutes for production WORM storage, retention, approved SIEM forwarding, deployment runbooks, database recovery, signed-image admission policy, or assessor-approved control statements. They prove the contract and auditability shape without exporting production data, tenant identifiers, secrets, or live provider records.

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
