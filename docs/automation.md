# Automation Stewardship

This repo uses a lightweight steward loop so implementation slices can move through review without relying on chat memory. The loop has two human gates: choosing scope and merging PRs.

## Source Of Truth

[Implementation Backlog](implementation-backlog.md) is the durable roadmap and source of truth for implementation execution. Each slice has a status, priority, dependency list, parallel-safety flag, conflict area, branch, PR reference, acceptance checks, security notes, and next action. `pnpm backlog:batch` reads the dependency-cleared `ready` rows and prints the next parallel-safe batch.

Linear mirrors the backlog for human planning, ownership, comments, labels, and roadmap visibility. When the repo backlog changes, update the matching Linear issue in the same work session; if Linear changes first, mirror it back into the repo backlog before treating it as executable. If the two disagree, the repo backlog is authoritative for Codex execution and the Linear drift should be flagged.

The typed automation contract manifest in `scripts/lib/automation-contract.ts` is the canonical implementation source for validation plans, package-script requirements, PR state-label policy, stack readiness rules, CI workflow expectations, steward workflow checks, and proof-point evidence generation.

Generated API collections are part of the docs validation surface. Run `pnpm validate:api-collections` to check that the Postman and Bruno demo seed collections are current, cover the required workflows, and avoid checked-in secrets.

`pnpm validate:ci` remains a local steward preflight that checks workflow structure against the automation contract. CI does not run that self-check against its own workflow; `pnpm validate:automation` and the behavior-oriented jobs remain the hosted gates.

## State Labels

GitHub labels carry PR state:

- `stack` marks PRs that belong to the active implementation stack.
- `ready-for-automation` means an approved steward automation may fix CI, Greptle, or review issues inside the accepted scope.
- `needs-human` means steward automation should pause until a decision is made.
- `security-pass-required` means the PR needs `pnpm security:pass` before it can be merge-ready.
- `blocked` means the PR cannot progress without an external dependency or decision.
- `ready-to-merge` means a human has approved the PR after checks and security pass are clean.
- `next-slice` marks backlog candidates that are likely to be picked next.

Run `pnpm labels:sync` to create or update labels from `scripts/lib/automation-contract.ts`. The checked-in `.github/labels.yml` file mirrors that manifest for GitHub-facing review, and `pnpm validate:automation` fails if it drifts. The script never deletes labels.

## Steward Loop

Run `pnpm pr:status` to inspect open PRs, labels, CI rollups, and next actions. `pnpm steward:check` is the same dry-run status command and is intended for scheduled or recurring automation.

The steward commands invoke TypeScript through `node --import tsx` so they do not depend on the `tsx` CLI launcher IPC path in restricted automation environments.

The always-on network monitor is `.github/workflows/pr-steward.yml`, which runs inside GitHub Actions with repository-scoped GitHub access. App-level scheduled automations are optional because some app cron environments cannot resolve `github.com` or `api.github.com` even when a normal local shell can.

Before enabling an app-level steward that fetches, pushes, or comments on PRs, run:

```sh
pnpm automation:doctor
```

If the doctor fails in that environment, keep the app automation paused and use the GitHub Actions steward plus interactive/local runs. Repeated scheduled failures are environment noise, not PR signal.

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

## Batch Slice Loop

After the active stack is merged or otherwise clear:

1. Run `pnpm backlog:batch`.
2. Confirm the suggested batch. A serial row with `Parallel` set to `no` runs alone; parallel-safe rows can run together when dependencies are merged and their `Area` values differ.
3. Create one branch per selected row from `origin/main`.
4. Move each selected row to `in_progress` in its own implementation branch.
5. Implement each slice as its own PR, run `pnpm ci:check`, submit each PR, and move its row to `in_review`.
6. Once reviews are resolved, CI is green, security passes complete, and the human merge gate is satisfied, merge the batch and repeat from `pnpm backlog:batch`.

This keeps the agent useful without giving it authority to choose unscoped work or merge code on its own.
