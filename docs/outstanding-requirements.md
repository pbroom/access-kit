# Outstanding Requirements

The current implementation supports local policy decisions, mock and synthetic provider read-only discovery, discovery run history, observed native-grant readback, dry-run provisioning jobs, synthetic mock-only controlled enforcement, connector enforcement-readiness reports, drift fixtures, API handlers, CLI wrappers, and validation evidence. It still intentionally avoids live tenant access and production mutation.

## Runtime

- Replace local in-memory API handlers with deployable production service packaging.
- Add persistent graph storage for subjects, resources, and relationship tuples.
- Add policy model parsing, publication, rollback, and versioned test execution.
- Add durable append-only audit/event storage with hash chaining.
- Replace local provisioning jobs with queue-backed jobs, retries, backoff, dead-letter handling, and connector health states.

## Connectors

- Complete security review for connector identity and least-privilege scopes.
- Replace synthetic Entra ID, SharePoint, and AWS-style adapters with live read-only connectors after security review.
- Define live connector consent, tenant boundary, pagination, throttling, and deletion semantics.
- Persist discovery runs and native grants outside the local in-memory store.
- Persist reconciliation runs and dry-run job evidence outside the local in-memory store.
- Extend controlled enforcement beyond the synthetic mock proof point only after live connector write scopes, approvals, verification, rollback, least-privilege connector review, operational runbooks, and emergency revocation behavior are reviewed and evidenced.
- Promote enforcement-readiness reports from local proof-point records to durable release gates for each connector/version pair.

## ATO And Operations

- Produce system boundary and data flow diagrams for the deployed target environment.
- Map control implementation statements to a concrete NIST/FedRAMP baseline.
- Add SBOM, dependency scanning, SAST/DAST, vulnerability scan, and configuration baseline evidence.
- Add SIEM export and retention policy.
- Add break-glass and incident mode workflows.
- Add backup/restore and contingency evidence.
- Add access review and exception workflow evidence.
