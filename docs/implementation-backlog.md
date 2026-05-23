# Implementation Backlog

This file is the durable source of truth for implementation slice coordination. Update it in the same PR that changes a slice state so Codex, CI, and humans are reading the same map.

## Status Vocabulary

- `ready` means the slice is scoped and can be started after the current stack is clear.
- `in_progress` means a branch is being implemented locally.
- `in_review` means a PR exists or is being prepared for review.
- `blocked` means a human decision or external dependency is required.
- `merged` means the slice has landed on `main`.

## Operating Rules

- Scope selection and merges remain human-gated.
- Codex may fix CI failures, review findings, and contract drift for PRs labeled `ready-for-codex`.
- Codex must stop on `needs-human` or `blocked`.
- Every implementation slice should define acceptance checks and a security note before work starts.
- The first `ready` row is the default candidate for `pnpm backlog:next`.

## Slices

| ID | Slice | Status | Branch | PR | Acceptance Checks | Security Notes | Next Action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| AK-001 | Phase 0 architecture and public contract foundation | merged | codex/rebac-foundation-specs | #1 | Contracts, schemas, CLI spec, ADRs, and proof-point evidence validate. | Synthetic-only examples and no live tenant data. | Keep contracts backward-compatible unless an ADR says otherwise. |
| AK-002 | Phase 1 local core engine and mock connector runtime | merged | codex/rebac-core-engine | - | Deterministic check and explain paths pass policy proof points. | No LLM decisions and deny-by-default behavior remains covered. | Maintain engine proof points as shared regression tests. |
| AK-003 | Phase 2 read-only discovery and drift findings | merged | codex/rebac-readonly-discovery | - | Mock sync, native grants, inventory import, and reconciliation dry-run work locally. | No production writes and drift remains a security finding. | Keep live connectors read-only until enforcement gates are approved. |
| AK-004 | Phase 3 dry-run provisioning and reconciliation evidence | merged | codex/rebac-dry-run-provisioning | - | Plan, dry-run, verification intent, idempotency, and audit evidence are linked. | Connector apply hooks remain non-writing in this phase. | Preserve decision to plan to evidence traceability. |
| AK-005 | Phase 4 controlled enforcement readiness gates | merged | codex/rebac-enforcement-readiness | - | Enforcement readiness is opt-in and guarded by approval, rollback, break-glass, and incident-mode contracts. | Live writes remain out of scope without explicit security review. | Use readiness gates before any controlled enforcement slice. |
| AK-006 | Phase 5 ATO evidence hardening | merged | codex/rebac-phase5-complete | - | Audit export, evidence packages, control mapping, runbooks, and assessor docs validate. | Evidence exports avoid secrets and production identifiers. | Keep evidence generation reproducible. |
| AK-007 | Deployable API packaging and runtime guardrails | merged | codex/rebac-api-deployment-manifests | #29 | Container, release, Kubernetes, auth, health, and readiness validation pass. | Non-loopback API runtimes require bearer-token auth. | Maintain deployment validation as a CI gate. |
| AK-008 | Persistent graph storage contracts | merged | codex/rebac-storage-contracts-v2 | #30 | Persistence interfaces, docs, and storage contract tests pass. | Storage boundaries must preserve deterministic decisions and audit evidence. | Build runtime storage behind the merged boundary. |
| AK-009 | PR steward and next-slice automation loop | in_review | codex/rebac-pr-steward-automation | pending | Backlog, labels, PR steward scripts, next-slice script, stack readiness, and CI validation land. | Automation may coordinate and fix issues but must not merge without human approval. | Wait for CI, review, security pass, and human merge. |
| AK-010 | Durable repository storage implementation | ready | codex/rebac-durable-storage-runtime | - | API runtime can load, persist, and recover repository state through the storage boundary. | State snapshots must avoid secret material and keep audit records append-friendly. | Start after AK-009 merges. |
| AK-011 | Connector state persistence integration | ready | codex/rebac-connector-persistence | - | Discovery runs, native grants, drift findings, and connector evidence persist across restarts. | Read-only connector posture remains default. | Start after durable storage runtime is stable. |
| AK-012 | Evidence export integrity package | ready | codex/rebac-evidence-integrity-package | - | Evidence export includes manifest hashes and verifier documentation. | Hashes must be reproducible and must not expose secrets. | Start after persisted audit and evidence state are available. |
