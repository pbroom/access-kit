# Outstanding Requirements

This first milestone intentionally stops at contracts, documentation, mock boundaries, fixtures, and validation evidence.

## Runtime

- Replace local in-memory API handlers with deployable production service packaging.
- Add persistent graph storage for subjects, resources, and relationship tuples.
- Add policy model parsing, publication, rollback, and versioned test execution.
- Add durable append-only audit/event storage with hash chaining.
- Add queue-backed provisioning jobs, retries, backoff, dead-letter handling, and connector health states.

## Connectors

- Complete security review for connector identity and least-privilege scopes.
- Add read-only Entra ID discovery.
- Add read-only SharePoint discovery.
- Add read-only AWS discovery.
- Add simulation and dry-run reconciliation before enforcement.
- Add controlled enforcement only after approvals, verification, rollback, and operational runbooks exist.

## ATO And Operations

- Produce system boundary and data flow diagrams for the deployed target environment.
- Map control implementation statements to a concrete NIST/FedRAMP baseline.
- Add SBOM, dependency scanning, SAST/DAST, vulnerability scan, and configuration baseline evidence.
- Add SIEM export and retention policy.
- Add break-glass and incident mode workflows.
- Add backup/restore and contingency evidence.
- Add access review and exception workflow evidence.
