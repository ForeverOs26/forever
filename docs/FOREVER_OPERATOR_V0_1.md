# Forever Operator v0.1 — Architecture Report

Status: implemented local infrastructure; push and merge not performed

## Purpose and boundary

Operator v0.1 is the first deterministic Forever Factory integration layer. It accepts a reviewed Git patch, validates its declared scope and security posture, applies it only in a disposable worktree based on an explicit commit, runs repository validations, and can prepare a GitHub Pull Request. It uses PowerShell, Git, npm, and GitHub CLI only. No AI call, browser automation, Night Shift queue, database write, or product architecture change is included.

## Components

- `.forever-factory/operator.config.json`: repository identity, paths, allowed validation profiles, protected paths, risk and merge policy, retry and timeout settings.
- `.forever-factory/CURRENT_TASK.example.json`: documented task contract.
- `scripts/forever-operator/ForeverOperator.psm1`: intake, validation, security, worktree, Git/GitHub, state, recovery, and reporting engine.
- `scripts/forever-operator/Invoke-ForeverOperator.ps1`: Windows command entry point.
- `scripts/forever-operator/Test-ForeverOperator.ps1`: disposable-repository and policy tests.
- `scripts/forever-operator/README.md`: owner runbook.

## Safety model

The primary repository must be clean. The expected base must exist and be an ancestor of the fetched default branch. If a patch carries `base-commit` metadata, it must match exactly. Scope and binary checks occur before worktree creation; `git apply --check` occurs before application. Security scans run after apply and again before push. Findings report only path and rule. Every command stops on failure, is timed, and is summarized in task state and reports.

Native execution is structured: an allowlisted executable name and argument array are passed directly to `ProcessStartInfo` with `UseShellExecute=false`. Task-controlled values never enter `cmd.exe`, a shell command string, or `Invoke-Expression`. Windows argument encoding follows CreateProcess quoting rules; npm/npx resolve to `node.exe` and the installed CLI script. Logged command representations are review-only quoted displays and sensitive output is redacted.

Risk is conservative: migrations, workflow security, auth/payment-like modules, deployment configuration, lockfile changes, and large deletion are HIGH. Product source changes are at least MEDIUM. Documentation, tests, isolated fixes, and internal tooling can be LOW. `riskOverride` is a minimum risk floor and cannot downgrade automatic risk. Protected paths cannot be bypassed. HIGH never auto-merges and is blocked before push by default. MEDIUM requires review. LOW can auto-merge only with two explicit opt-ins plus successful local checks and explicit verification of PR base/head, local and remote head SHA equality, mergeability, required checks, approvals, and branch protection. Missing protection metadata fails closed.

The repository-wide lint baseline is 5,379 existing Prettier errors. The operator reports that baseline separately and runs ESLint only over changed lint-supported files. Any changed-file violation stops the patch; a patch with no changed JavaScript/TypeScript files records a pass plus the baseline count. It never reformats unrelated files or suppresses new violations.

Task state and task-specific branches prevent accidental duplicate work. Completed or merged checkpoints are not repeated. Cleanup removes only the task's configured disposable worktree/local branch and preserves reports/logs. Published history is never rewritten.

## Manual prerequisites for Constantin

Constantin must select the patch, provide its exact base commit and allowed path scope, maintain Git identity and GitHub CLI authentication, review every generated report, approve MEDIUM-risk PRs, and keep automatic merge disabled until operational confidence is established. Any HIGH-risk work requires a separately reviewed configuration decision; merging it remains manual.

## Known v0.1 limitations and recommended v0.2

PowerShell 5.1 cannot provide a perfect cross-platform process-tree timeout; child tools may require manual termination after a hard interruption. Secret scanning is deterministic pattern matching, not a full DLP product. Resume safely reruns a safe stage rather than continuing inside a command. GitHub metadata depends on `gh` access to branch-protection endpoints; inability to inspect protection disables automatic merge. Dependency validation uses the repository lockfile and can require network access.

Recommended v0.2: signed task manifests, stricter patch provenance generation, runtime JSON Schema validation, granular resumable checkpoints, configurable secret-rule packs, per-file lint-baseline diffing, and Windows process-tree cancellation. Browser automation, Night Shift, and model selection should remain separate later milestones.

## Implementation validation

- Operator safety and integration tests: 24 passed, 0 failed; disposable temporary repositories and mocked GitHub operations only.
- Dependency validation: `npm ci --ignore-scripts` passed (npm reported 1 low and 2 moderate dependency advisories; no automatic audit fix was run).
- TypeScript: `npx tsc --noEmit` passed.
- Product tests: 225 files / 1,661 tests passed.
- Production build: passed.
- Git whitespace check: passed.
- Lint policy: existing repository baseline is recorded as 5,379 Prettier errors; changed operator PowerShell/JSON/Markdown files contain no lint-supported JavaScript/TypeScript files, so no new ESLint violation is introduced. Integration tests prove unchanged-baseline pass, changed-file pass, and changed-file failure behavior.

Push, Pull Request creation, GitHub-check waiting, and merge were intentionally not exercised because this task authorizes only a local commit and patch.
