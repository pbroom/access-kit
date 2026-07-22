# ATO Evidence Model

This page answers: what goes into an evidence export package, and how far does the local proof point get an assessor? The goal is that an assessor can trace architecture, data flow, control implementation, policy decision, enforcement action, verification, and audit evidence — generated continuously, not assembled manually at the end. The evidence is ATO-oriented and ATO-inspectable; it does not claim that the repository or any deployment has an authorization to operate.

## Control Families

The domain and API contracts map to these NIST/FedRAMP-relevant areas: AC (deny by default, least privilege, automated revocation), IA (federated identity assumptions, admin identity controls), AU (decision/provisioning/admin/connector logs with tamper evidence), CM (versioned policy models, configurations, baselines, drift findings), CA (evidence exports, validation reports, access reviews, continuous monitoring), RA/SI (vulnerability and dependency evidence, drift findings, remediation tracking), SC (encryption, API security, secure data flows), IR (emergency revocation, incident mode, post-action review), SA/SR (SBOMs, dependency inventory, secure SDLC evidence), and PT (PII minimization). The per-control mapping lives in the [Evidence Catalog](evidence-catalog.md).

## Evidence Export Contract

`schemas/evidence-export.schema.json` defines the package. An export includes: framework, control IDs, time period, source event IDs, audit integrity report, SIEM-ready audit export, system boundary and component inventory, data-flow evidence, control implementation mappings and statements, access-review evidence (campaigns, owner approvals, findings, exceptions, remediation IDs), an exception register with risk acceptance and expiry, continuous-monitoring metrics with governance counters, POA&M inputs, OSCAL fragments, signed package metadata, verifier checks, control-to-event trace views, an artifact manifest, operational evidence (SBOM, scanning, baselines, incident response, break-glass, backup, contingency), admin authorization evidence, SIEM export metadata, an optional storage receipt, responsible role, timestamp, and format.

The first generated evidence artifact is `reports/proof-point-validation.md`, which records tool versions, commit, command results, covered proof points, and outstanding requirements.

## What The Local Package Proves

The local evidence package is complete for proof-point validation. Access-review and exception evidence is rendered from durable governance records rather than invented one-off rows. The runtime exports bounded audit windows as SIEM-ready JSONL, persists audit events and evidence packages through the local file-backed repository, and keeps restartable JSON state snapshots. The production audit/evidence adapter, admin authorization readiness contract, release signature/provenance workflow, deployment manifests, persistence readiness gates, and secure SDLC manifest each add implementation proof for their boundary.

None of those paths substitutes for a selected production IdP or mTLS gateway, WORM driver, approved SIEM deployment, GRC system, database recovery exercises, signed-image admission enforcement, scanner exports, or assessor-approved control statements. They prove the contract and auditability shape without exporting production data, tenant identifiers, secrets, or live provider records.

## OSCAL And Signed Evidence

Evidence exports include machine-readable OSCAL-oriented fragments generated from the same canonical sources as the rest of the package. They are fragments, not an assessor-approved authorization package:

- `oscal.componentDefinition` maps boundary components and reviewed requirements.
- `oscal.systemSecurityPlan` maps deployment scope, data flows, and control implementation statements.
- `oscal.assessmentResults` maps reviewed controls, observations, source events, and gaps.
- `oscal.planOfActionAndMilestones` mirrors the package POA&M items.

`signedPackage`, `verifierChecks`, and `controlTraceViews` bind the canonical package hash to source events, reviewed statement references, deployment scope, and per-control trace records; see the [Evidence Integrity Verifier](evidence-integrity-verifier.md) for reproduction steps. The local proof signature is verified with trusted key metadata for the proof-point runtime; production deployments still need environment-managed signing keys, immutable retention, and assessor-approved control statements.

## Related Documentation

- [Evidence Catalog](evidence-catalog.md)
- [Audit And Evidence Export Runbook](../runbooks/audit-evidence-export.md)
- [Access Review And Exception Governance Runbook](../runbooks/access-review-exceptions.md)
