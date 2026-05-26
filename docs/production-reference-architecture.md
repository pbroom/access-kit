# Production Reference Architecture

## Purpose

This reference architecture describes how Access Kit moves from the local proof-point runtime to an environment-specific production deployment. It ties the API service, graph store, connector-state store, job queue, audit and evidence store, SIEM forwarding, IdP or mTLS gateway, secrets manager, observability, backup, RTO/RPO, and Kubernetes overlays into one deployment map.

It is an implementation guide and evidence checklist. It is not a FedRAMP authorization, an ATO decision, a selected vendor architecture, or permission to enable live provider writes.

## Boundary

```mermaid
flowchart LR
  users["Operators and CI/CD"] --> gateway["Approved IdP or mTLS gateway"]
  gateway --> api["rebac-api service"]
  api --> graph["Graph and connector-state store"]
  api --> queue["Durable job queue"]
  api --> audit["Immutable audit and evidence store"]
  api --> secrets["Secrets manager references"]
  queue --> workers["Managed workers"]
  workers --> connectors["Read-only connectors"]
  audit --> siem["SIEM forwarder"]
  api --> metrics["Metrics, logs, traces"]
  graph --> backup["Backup and restore evidence"]
  queue --> backup
  audit --> backup
```

The local Kubernetes manifests in `deploy/kubernetes/` remain the base proof point. Production overlays must replace local-only assumptions with reviewed external services and retained evidence before handling production traffic.

## Required Components

| Component | Production responsibility | Proof-point source |
| --- | --- | --- |
| API service | Run a signed `rebac-api` digest behind the approved admin identity boundary. | `deploy/kubernetes/`, `docs/deployment.md` |
| IdP or mTLS gateway | Authenticate operators, preserve MFA/session evidence, and map trusted claims into admin ReBAC roles. | `docs/security-model.md`, `docs/api.md` |
| Graph store | Persist subjects, resources, relationships, native grants, tenant boundaries, and backup metadata behind the repository contract. | `docs/persistence.md`, `deploy/persistence/production-manifest.example.json` |
| Connector-state store | Retain discovery runs, readiness reports, reconciliation records, drift findings, and connector evidence separately from queue execution. | `docs/persistence.md` |
| Job queue | Execute discovery, reconciliation, provisioning, evidence, and revocation work durably with idempotency, retry, dead-letter, replay, and emergency priority. | `packages/core/src/production-job-queue.ts` |
| Audit and evidence store | Retain append-only audit records, signed windows, evidence receipts, delivery monitoring, replay records, and backup metadata. | `packages/core/src/production-audit.ts` |
| SIEM forwarder | Deliver bounded audit windows, alert on failed delivery, and retain replay proof. | `docs/audit-event-model.md` |
| Secrets manager | Store API keys, IdP or mTLS references, connector credentials, signing configuration, and rotation evidence outside manifests and logs. | `adrs/0009-secret-management.md` |
| Observability | Capture health, readiness, queue depth, failed auth, audit delivery, connector coverage, and emergency revocation metrics. | `docs/concept-of-operations.md` |
| Degraded-mode operations | Define fail-closed degraded modes, queue backpressure, audit-forwarder outage behavior, read-only fallback, health signals, and recovery criteria. | `docs/ha-degraded-mode-operations.md` |
| Backup and restore | Test graph, connector-state, queue, audit, evidence, and configuration recovery against defined RTO/RPO. | `runbooks/audit-evidence-export.md`, `deploy/persistence/evidence/backup-restore.example.json` |

## Kubernetes Overlay Shape

The production-reference overlay in `deploy/overlays/production-reference/` documents the expected Kustomize boundary:

- use the base `deploy/kubernetes/` manifests
- replace the image with a verified immutable GHCR digest
- keep bearer tokens and IdP or mTLS material in external secret references
- add production control annotations for gateway, secrets manager, SIEM, observability, backup, RTO, and RPO evidence
- keep the signed-image admission policy in audit mode until the target cluster has an approved exception process
- record which external graph, queue, and audit/evidence adapters back the deployment

The overlay deliberately avoids real hostnames, tenant IDs, account IDs, secret names, token values, and provider credentials.

## RTO/RPO Targets

| Data class | Example target | Evidence required |
| --- | --- | --- |
| Relationship graph and native grants | RTO 4 hours, RPO 15 minutes | Restore run ID, snapshot hash, tenant-boundary checks, and post-restore decision replay. |
| Connector-state history | RTO 8 hours, RPO 1 hour | Last safe cursor, replayed discovery run, stale-state warnings, and reconciliation result. |
| Queue state and idempotency records | RTO 2 hours, RPO 5 minutes | Dead-letter replay result, emergency revocation priority check, and duplicate suppression proof. |
| Audit and evidence records | RTO 24 hours, RPO 0 for accepted writes | Immutable receipt, signed-window verification, SIEM replay proof, and tamper check. |
| Configuration and release digest | RTO 2 hours, RPO current approved commit | IaC diff, signed digest verification, approval record, and rollback rehearsal. |

Target environments may set stricter values. Looser values require explicit risk acceptance and an exception expiry.

## Deployment Flow

1. Build and sign the `rebac-api` image through the release workflow.
2. Verify the GitHub attestation and cosign identity for the digest.
3. Select environment-specific graph, connector-state, queue, audit/evidence, SIEM, observability, and secrets-manager services.
4. Fill the production-reference overlay with references to approved evidence artifacts, not secret material.
5. Run `pnpm validate:deployment-manifests`, `pnpm validate:persistence-deployment`, and the environment-specific IaC validation.
6. Apply the overlay to a non-production environment and confirm `/v1/health`, `/v1/ready`, API authentication, audit emission, queue worker health, degraded-mode signals, and backup/restore evidence.
7. Exercise queue backpressure, audit-forwarder outage, read-only fallback, emergency revocation priority, and recovery criteria before promotion.
8. Promote only after the release approval, admin authorization descriptor, signed-image admission posture, SIEM replay path, degraded-mode evidence, and rollback record are retained.

## Evidence To Retain

- signed image digest, SBOM/provenance, attestation verification, and cosign verification
- admin IdP or mTLS descriptor, MFA/session policy, role binding, revocation SLA, and break-glass approval evidence
- graph, connector-state, queue, audit/evidence, SIEM, secrets-manager, and observability service references
- deployment IaC diff, Kustomize overlay, and release approval
- readiness output with production admin authorization passing
- backup and restore test records with RTO/RPO observations
- queue dead-letter replay, connector-health, and emergency revocation priority observations
- audit signed-window verification, SIEM delivery, failed-delivery alert, and replay proof
- degraded-mode exercise covering queue backpressure, audit-forwarder outage, read-only fallback, health signals, and recovery criteria
- post-deployment review and rollback rehearsal notes

## Security Guardrails

- Do not place secret values, bearer tokens, client certificates, tenant IDs, account IDs, production emails, or customer resource names in manifests, docs, fixtures, warnings, logs, or evidence reports.
- Do not enable live provider writes from this architecture alone. Live enforcement still requires connector-specific readiness, approval, rollback, emergency revocation, monitoring, and audit evidence.
- Do not collapse observed native grants into intended access. Policy and relationship data remain the authorization source of truth.
- Do not treat local JSON state, local JSONL audit files, or in-memory stores as production controls.
- Keep SIEM delivery failures, stale connector reads, audit tampering, queue dead letters, and backup failures visible as security-relevant findings until replay or remediation is complete.

## Related Artifacts

- [Deployable API Packaging](deployment.md)
- [Deployment Runbook](deployment-runbook.md)
- [HA And Degraded-Mode Operations](ha-degraded-mode-operations.md)
- [Persistence](persistence.md)
- [Security Model](security-model.md)
- [System Context and Boundary](system-context-and-boundary.md)
- [Audit Event Model](audit-event-model.md)
- [Concept Of Operations](concept-of-operations.md)
- [production-reference overlay](../deploy/overlays/production-reference/README.md)
