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
- control implementation mappings
- continuous-monitoring metrics
- POA&M inputs
- artifact manifest
- SIEM export metadata
- responsible role
- generated timestamp
- export format

The first generated evidence artifact is `reports/proof-point-validation.md`. It records tool versions, commit, command results, covered proof points, and outstanding requirements.

The local Phase 5 evidence package remains metadata-only. It proves the contract and auditability shape without exporting production data, tenant identifiers, secrets, or live provider records.

## Minimum Evidence Package Later

- system boundary diagram
- data flow diagram
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
