# Outstanding Requirements

## Current Implementation Support

The current implementation intentionally avoids live tenant access and production mutation. Open stacked PRs are listed where support is implemented in the active review stack but not yet merged. PRs #14-#18, #20, and #31 are outside this implementation-support table, and repeated PR references are intentional when one PR spans multiple areas, such as #29 covering both runtime packaging and API authentication guard work.

| Area | Current support | Associated PR(s) |
| --- | --- | --- |
| Foundation contracts | OpenAPI, JSON Schemas, domain model, CLI/API contract notes, ADRs, mock connector boundary, policy fixtures, and initial proof-point validation evidence. | [#1](https://github.com/pbroom/access-kit/pull/1) |
| Local authorization engine | Deterministic local policy decisions, deny-by-default behavior, relationship-path authorization, deny overrides, expiration/suspension handling, drift fixtures, and core proof-point tests. | [#2](https://github.com/pbroom/access-kit/pull/2) |
| Local API runtime | API handlers for decisions, subjects, resources, relationships, connector flows, provisioning, reconciliation, audit, and evidence surfaces. | [#3](https://github.com/pbroom/access-kit/pull/3) |
| CLI-over-API flow | CLI wrappers that call the API instead of making local authorization decisions. | [#4](https://github.com/pbroom/access-kit/pull/4) |
| Contract and CI validation | First-class schema, OpenAPI, policy fixture, CLI contract, workflow, docs, packaging, deployment, test, build, and generated evidence validation. | [#6](https://github.com/pbroom/access-kit/pull/6), [#25](https://github.com/pbroom/access-kit/pull/25) |
| Read-only discovery | Mock and synthetic provider read-only discovery, discovery run history, observed native-grant readback, native access filtering, drift comparison support, and local repository-backed connector-state recovery. | [#5](https://github.com/pbroom/access-kit/pull/5), [#7](https://github.com/pbroom/access-kit/pull/7), [#46](https://github.com/pbroom/access-kit/pull/46) |
| Dry-run provisioning | Dry-run provisioning jobs, idempotent job replay, verification intent, skipped-write evidence, and compensation records without connector writes. | [#8](https://github.com/pbroom/access-kit/pull/8) |
| Controlled synthetic enforcement | Synthetic mock-only controlled enforcement, explicit approval fields, guardrail checks, and live provider write blocking. | [#9](https://github.com/pbroom/access-kit/pull/9) |
| Connector enforcement readiness | Connector enforcement-readiness reports and readiness gates required before controlled synthetic enforcement. | [#10](https://github.com/pbroom/access-kit/pull/10) |
| Audit and SIEM evidence | Audit integrity reports, audit hash-chain verification, SIEM-ready local audit exports, and bounded audit export contracts. | [#11](https://github.com/pbroom/access-kit/pull/11), [#13](https://github.com/pbroom/access-kit/pull/13) |
| Local ATO evidence package | Complete local ATO evidence packages, control mappings, access-review and exception evidence, ConMon/POA&M inputs, and local file-backed audit/evidence repository proof points. | [#12](https://github.com/pbroom/access-kit/pull/12), [#19](https://github.com/pbroom/access-kit/pull/19) |
| Runtime packaging | Restartable JSON runtime state snapshots, runnable `rebac-api` service entrypoint, runtime config loading, and public health/readiness probes. | [#21](https://github.com/pbroom/access-kit/pull/21), [#24](https://github.com/pbroom/access-kit/pull/24), [#29](https://github.com/pbroom/access-kit/pull/29) |
| API authentication guard | Optional bearer-token API guarding for non-loopback runtimes, audited authentication failures, and token material exclusion from logs/readiness output. | [#23](https://github.com/pbroom/access-kit/pull/23), [#29](https://github.com/pbroom/access-kit/pull/29) |
| Deployable API packaging | Deployable API container packaging, container smoke tests, release packaging contracts for signatures/provenance, and reference Kubernetes deployment manifests. | [#26](https://github.com/pbroom/access-kit/pull/26), [#27](https://github.com/pbroom/access-kit/pull/27), [#28](https://github.com/pbroom/access-kit/pull/28) |
| Persistent storage contracts | Persistent graph, audit, and job repository contracts plus production readiness gates for future durable stores. | [#30](https://github.com/pbroom/access-kit/pull/30) |
| Local persistence adapters | Local JSON graph persistence, local append-only audit persistence, local JSON job persistence, connector-state recovery, tamper checks, and idempotency lookups as proof-point adapters. | [#32](https://github.com/pbroom/access-kit/pull/32), [#33](https://github.com/pbroom/access-kit/pull/33), [#34](https://github.com/pbroom/access-kit/pull/34), [#46](https://github.com/pbroom/access-kit/pull/46) |
| Production persistence manifest evidence | Schema-backed production persistence manifest readiness checks, synthetic IaC/release/backup/operator-control evidence, and retained persistence-readiness report artifacts. | [#35](https://github.com/pbroom/access-kit/pull/35), [#36](https://github.com/pbroom/access-kit/pull/36), [#37](https://github.com/pbroom/access-kit/pull/37) |
| Documentation foundation | Start-here docs, concept of operations, architecture, domain, API, CLI, security, ATO evidence, persistence, deployment, runbooks, assessor guidance, and docs readiness reporting. | [#22](https://github.com/pbroom/access-kit/pull/22), [#25](https://github.com/pbroom/access-kit/pull/25) |

## Runtime

- Replace release and deployment-manifest proof points with environment-specific registry promotion approvals, enforced signed-image admission, IaC overlays for ingress/certificates/storage/networking, identity-provider-backed authentication, authorization, and approved deployment runbooks.
- Replace local JSON graph persistence with a production graph store for subjects, resources, relationship tuples, and native-grant readback.
- Replace local append-only audit persistence with production WORM or immutable ledger-backed audit storage.
- Replace local JSON job persistence with production queue/job storage behind the persistent storage contracts.
- Replace synthetic production persistence manifest evidence with environment-specific IaC outputs, release approvals, backup/restore evidence, and retained operator-control artifacts.
- Add policy model parsing, publication, rollback, and versioned test execution.
- Replace local in-memory, JSON snapshot, and local append-only audit proof points with durable append-only audit/event storage, immutability controls, retention, readiness checks, and recovery procedures.
- Replace local JSON provisioning jobs with queue-backed jobs, retries, backoff, dead-letter handling, connector health states, and durable idempotency records.

## Connectors

- Complete security review for connector identity and least-privilege scopes.
- Replace synthetic Entra ID, SharePoint, and AWS-style adapters with live read-only connectors after security review.
- Define live connector consent, tenant boundary, pagination, throttling, and deletion semantics.
- Replace local JSON graph/job connector-state proof points with production data stores for discovery runs, native grants, drift findings, and reconciliation evidence.
- Persist dry-run job evidence in durable queue/job storage rather than local JSON snapshots.
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
