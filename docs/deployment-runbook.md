# Deployment Runbook

This runbook is a synthetic release-control proof point for the `rebac-api` container. It describes the operator checks expected before any environment-specific IaC, identity provider, registry promotion policy, or admission controller is selected.

## Release Preconditions

- The release source is a reviewed commit on the approved stack.
- `corepack pnpm ci:check` passes for the release commit.
- The `Container packaging` CI job passes for the release commit.
- The `Container Release` workflow is run from a `rebac-api-v*` tag or an explicit manual dispatch with `publish=true`.
- `pnpm validate:deployment-manifests` passes for the deployment manifest set.
- No production tenant IDs, provider secrets, production subjects, or provider write credentials are used during packaging.
- The target environment has an approved admin authorization descriptor or a documented exception. Production descriptors must evidence an IdP or mTLS gateway, MFA, bounded sessions, revocation SLA, separate admin ReBAC policy, secrets-manager references, break-glass approval, incident notifications, post-action review, and audit event coverage.

## Publish Procedure

1. Create a release tag using the `rebac-api-v<version>` pattern.
2. Let the `Container Release` workflow build the `runtime` target and publish to GHCR.
3. Capture the image digest from the workflow summary.
4. Verify the GitHub artifact attestation for that digest.
5. Verify the cosign keyless signature for that digest.
6. Replace the example image digest in deployment manifests with the verified digest.
7. Promote only the digest reference into deployment IaC.

## Runtime Checks

Before traffic is shifted, verify:

- `/v1/health` returns `200`.
- `/v1/ready` returns `200` and reports the expected state snapshot, evidence repository, auth guard, and connector readiness checks.
- Protected API routes return `401` without a bearer token.
- Protected API routes succeed with the approved deployment identity path.
- `/v1/ready` reports `admin_authorization` as `pass` for production traffic, or the deployment record explicitly accepts the local proof-point warning for a non-production exercise.
- Audit events are emitted for failed authentication attempts and write operations.
- State snapshot and evidence paths are mounted to approved storage for the target environment.
- The cluster admits only the verified digest when the signed-image admission policy is enforced.

## Rollback Procedure

1. Freeze promotion of the current digest.
2. Select the previous signed digest approved for the same environment.
3. Verify the prior digest's attestation and cosign signature again.
4. Update deployment IaC to the prior digest.
5. Confirm `/v1/ready`, `/v1/health`, API authentication, audit emission, and evidence writes.
6. Record the incident reference, failed digest, rollback digest, approver, verification output references, and post-rollback observations.

## Evidence To Retain

- CI run URL and release workflow URL.
- Image digest and release tag.
- Attestation verification result.
- Cosign verification result.
- Deployment IaC diff or change record.
- Deployment manifest validation result.
- Readiness and health probe observations.
- Authentication boundary smoke-test result.
- Admin authorization readiness output, IdP or mTLS gateway configuration reference, admin ReBAC policy reference, role-binding evidence, revocation evidence, and secrets-manager reference list.
- Break-glass approval test or tabletop reference, incident notification target verification, and post-action review evidence template.
- Audit/evidence write verification.
- Queue worker health, retry/backoff, dead-letter replay, and emergency revocation priority observations when a queue worker is enabled.
- Audit adapter signed-window, retention-policy, immutable receipt, SIEM delivery, failed-delivery alert, and replay observations when the production audit adapter or forwarder is enabled.
- Degraded-mode exercise evidence for queue backpressure, audit-forwarder outage, read-only fallback, emergency revocation priority, health signals, and recovery criteria.
- Rollback or exception record when applicable.

## Deferred Production Controls

- Environment-specific overlays for ingress, certificates, volumes, networking, and identity.
- Signed-image admission policy enforcement and exception workflow.
- Registry retention and promotion controls.
- Identity-provider-backed API authentication and operator authorization.
- Approved secrets delivery.
- Admin ReBAC role design, trusted gateway or mTLS claim mapping, emergency-access approval, incident-mode notification routing, and post-action review retention.
- Environment-specific graph, connector-state, queue, and WORM or immutable-ledger audit storage drivers behind the validated adapter contracts.
- Managed queue worker deployment, monitoring, and on-call procedures for retries, dead letters, replay, and emergency revocation handling.
- Approved SIEM forwarder deployment, alert routing, replay procedure, and retained delivery monitoring evidence.
- Environment-specific degraded-mode thresholds, alert routing, tabletop evidence, and recovery sign-off.
- Agency-specific change-management and release approvals.
