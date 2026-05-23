# Outstanding Requirements

The current implementation supports local policy decisions, mock and synthetic provider read-only discovery, discovery run history, observed native-grant readback, dry-run provisioning jobs, synthetic mock-only controlled enforcement, connector enforcement-readiness reports, audit integrity reports, SIEM-ready local audit exports, complete local ATO evidence packages, local file-backed audit/evidence repository proof points, restartable JSON runtime snapshots, a runnable API service entrypoint, deployable API container packaging, release packaging contracts for signatures and provenance, reference Kubernetes deployment manifests, persistent storage repository contracts, public health/readiness probes, optional bearer-token API guarding with audited failures, drift fixtures, API handlers, CLI wrappers, and validation evidence. It still intentionally avoids live tenant access and production mutation.

## Runtime

- Replace release and deployment-manifest proof points with environment-specific registry promotion approvals, enforced signed-image admission, IaC overlays for ingress/certificates/storage/networking, identity-provider-backed authentication, authorization, and approved deployment runbooks.
- Implement production graph, append-only audit, and queue/job adapters behind the persistent storage contracts.
- Replace local JSON runtime snapshots with a production graph store for subjects, resources, relationship tuples, and native-grant readback.
- Add policy model parsing, publication, rollback, and versioned test execution.
- Replace local in-memory, JSON snapshot, and local file-backed audit proof points with durable append-only audit/event storage, immutability controls, retention, readiness checks, and recovery procedures.
- Replace local provisioning jobs with queue-backed jobs, retries, backoff, dead-letter handling, connector health states, and durable idempotency records.

## Connectors

- Complete security review for connector identity and least-privilege scopes.
- Replace synthetic Entra ID, SharePoint, and AWS-style adapters with live read-only connectors after security review.
- Define live connector consent, tenant boundary, pagination, throttling, and deletion semantics.
- Persist discovery runs and native grants in a production database rather than local JSON snapshots.
- Persist reconciliation runs and dry-run job evidence in durable queue/job storage rather than local JSON snapshots.
- Extend controlled enforcement beyond the synthetic mock proof point only after live connector write scopes, approvals, verification, rollback, least-privilege connector review, operational runbooks, and emergency revocation behavior are reviewed and evidenced.
- Promote enforcement-readiness reports from local proof-point records to durable release gates for each connector/version pair.

## Production ATO And Operations

- Replace local proof-point boundary and data-flow evidence with deployed target-environment diagrams.
- Replace generated control implementation statements with reviewed NIST/FedRAMP baseline statements approved for the deployed system.
- Replace local SBOM/dependency/configuration proof points with release-retained SBOMs, dependency scanning, SAST/DAST, vulnerability scan, and configuration baseline artifacts.
- Replace local SIEM-ready audit exports and SIEM export metadata with an approved SIEM forwarder, retention policy, delivery monitoring, and replay procedure.
- Replace local break-glass and incident-mode proof points with identity-provider-backed workflows, approvals, notifications, and post-action reviews.
- Replace local backup/restore and contingency proof points with tested recovery procedures, RTO/RPO evidence, and contingency exercises.
- Replace local access-review and exception proof points with durable review campaigns, risk acceptance workflow, expiry, and remediation evidence.
