# Automation Stewardship

This repo uses a lightweight steward loop so implementation slices can move through review without relying on chat memory. The loop has two human gates: choosing scope and merging PRs.

## Source Of Truth

[Implementation Backlog](implementation-backlog.md) is the durable roadmap. Each slice has a status, branch, PR reference, acceptance checks, security notes, and next action. `pnpm backlog:next` reads the first `ready` slice and prints the next candidate branch and acceptance criteria.

## State Labels

GitHub labels carry PR state:

- `stack` marks PRs that belong to the active implementation stack.
- `ready-for-automation` means an approved steward automation may fix CI, Greptle, or review issues inside the accepted scope.
- `needs-human` means steward automation should pause until a decision is made.
- `security-pass-required` means the PR needs `pnpm security:pass` before it can be merge-ready.
- `blocked` means the PR cannot progress without an external dependency or decision.
- `ready-to-merge` means a human has approved the PR after checks and security pass are clean.
- `next-slice` marks backlog candidates that are likely to be picked next.

Run `pnpm labels:sync` to create or update labels from `.github/labels.yml`. The script never deletes labels.

## Steward Loop

Run `pnpm pr:status` to inspect open PRs, labels, CI rollups, and next actions. `pnpm steward:check` is the same dry-run status command and is intended for scheduled or recurring automation.

The steward commands invoke TypeScript through `node --import tsx` so they do not depend on the `tsx` CLI launcher IPC path in restricted automation environments.

When a PR has `ready-for-automation`, the recurring steward may:

- pull the branch and inspect failing checks or review findings;
- make scoped fixes;
- run `pnpm ci:check` and any targeted commands;
- run `pnpm security:pass` when `security-pass-required` is present;
- push updates and leave a concise PR note.

When a PR has `needs-human` or `blocked`, the steward stops.

## Merge Readiness

Run `pnpm stack:ready` before merging a stack. It checks stack-labeled PRs for draft status, blocking labels, missing `ready-to-merge`, and non-passing CI rollups.

Run `pnpm security:pass` before applying `ready-to-merge`. It performs dependency audit, whitespace checks, full CI parity, build, tests, and evidence freshness validation.

## Next Slice Loop

After the active stack is merged:

1. Run `pnpm backlog:next`.
2. Confirm the suggested scope.
3. Create the suggested branch.
4. Move the row to `in_progress`.
5. Implement the slice, run `pnpm ci:check`, submit the PR, and move the row to `in_review`.

This keeps the agent useful without giving it authority to choose new scope or merge code on its own.
