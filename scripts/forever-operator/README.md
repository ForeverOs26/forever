# Forever Operator v0.1

Forever Operator safely validates a Claude-generated Git patch in a disposable Git worktree, runs the repository's real checks, and can create a task branch and Pull Request. It does not call an AI service and never applies an unverified patch to the primary working tree.

## Prerequisites

- Windows PowerShell 5.1 or PowerShell 7.
- Git, Node.js, `npm.cmd`, and GitHub CLI (`gh`).
- A clean primary repository and a configured Git author name/email.
- `gh auth login` completed for the single configured repository.
- The expected 40-character base commit and a `.patch` file supplied by Claude.
- Network access for fetch, dependency installation, push, PR creation, and CI checks.

No token or secret belongs in the task/configuration files. GitHub CLI keeps its own credentials outside this repository.

## First-time setup

1. Review `.forever-factory/operator.config.json`, especially the repository, validations, protected paths, and merge settings.
2. Keep `autoMerge` false until the workflow has been reviewed in real use.
3. Copy `.forever-factory/CURRENT_TASK.example.json` to `.forever-factory/CURRENT_TASK.json`. The formal field contract is `.forever-factory/task.schema.json`; the live task file should not contain secrets.
4. Put the selected patch under `.forever-factory/inbox/` and fill in the task fields.
5. Confirm `git status --short` is empty and run `gh auth status`.

Patch paths are resolved relative to `.forever-factory`. `allowedPaths` is the task boundary; `forbiddenPaths` adds task-specific blocks to the global protected paths.

`riskOverride` is a risk floor, not a replacement. It can raise LOW to MEDIUM/HIGH or MEDIUM to HIGH, but it can never reduce the risk calculated from the patch.

## Validation and lint baseline

All validation entries are structured `{ executable, arguments[] }` records. The operator launches executables directly and never sends task data through `cmd.exe`, a command shell, or `Invoke-Expression`. On Windows, npm/npx are resolved to `node.exe` plus the installed npm CLI script. Command logs render quoted arguments for review, redact sensitive output, and are never executable command strings.

The repository-wide lint baseline recorded on 2026-07-13 is 5,379 Prettier errors. It is reported as existing technical debt, not silently treated as success. For each patch, the operator runs ESLint directly on every changed `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, and `.cjs` file. Any changed-file lint failure stops the task. If no lint-supported file changed, lint passes with an explicit baseline note. This allows documentation and other clean patches to proceed without hiding new JavaScript/TypeScript violations or reformatting unrelated files.

## Normal operation

Start with a dry run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\forever-operator\Invoke-ForeverOperator.ps1 -TaskFile .\.forever-factory\CURRENT_TASK.json -Mode dry-run
```

Run local validation only:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\forever-operator\Invoke-ForeverOperator.ps1 -TaskFile .\.forever-factory\CURRENT_TASK.json -Mode validate-only
```

After reviewing the reports, create a commit, push the task branch, open the PR, and wait for checks:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\forever-operator\Invoke-ForeverOperator.ps1 -TaskFile .\.forever-factory\CURRENT_TASK.json -Mode create-pr
```

`full-safe-cycle` performs the same stages and may merge only when both task and configuration explicitly enable it and the patch is LOW risk. Before merge it re-reads the PR and branch protection, verifies exact base/head names, exact local commit SHA, mergeability, required check presence and success, required approvals, and that no new head commit appeared. If branch protection cannot be inspected, automatic merge is denied. In v0.1, leave automatic merge disabled. A MEDIUM-risk PR always requires owner approval. HIGH risk stops before push unless configuration explicitly permits PR creation, and can never auto-merge.

## Resume and cleanup

After correcting a reported failure, use `-Mode resume`. The state file prevents a completed task from being repeated and prevents a merge from running twice. If a process was interrupted and left a worktree or local task branch, inspect it, then run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\forever-operator\Invoke-ForeverOperator.ps1 -TaskFile .\.forever-factory\CURRENT_TASK.json -Mode cleanup
```

Logs, JSON state, JSON reports, and Markdown reports remain under `.forever-factory/` but are ignored by Git. Logs redact common secret assignments; security findings contain only a path and rule name.

## What it never does automatically

The operator never changes the primary working tree, resolves conflicts, rebases, force-pushes, pushes to `main`, suppresses validation, accesses browser/AI credentials, modifies Supabase, merges MEDIUM/HIGH risk, or reads outside the repository and configured inbox. It removes only its task-specific worktree and branch.

## Troubleshooting

- **Dirty repository:** commit, stash, or remove unrelated changes yourself; the operator will not decide for you.
- **Wrong base/default branch moved:** request a new patch against the exact current base. Do not silently rebase it.
- **Security finding:** inspect the reported file and rule; secret values are intentionally omitted.
- **Apply failure:** ask Claude to regenerate the patch from the expected base.
- **Validation failure:** inspect the task log, fix or regenerate the patch, then resume.
- **Authentication/repository mismatch:** run `gh auth status` and confirm `githubRepository` and `origin` point to the same repository.

## Tests

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\forever-operator\Test-ForeverOperator.ps1
```

Tests use a unique disposable repository under the Windows temporary directory and delete it afterward. They never run destructive scenarios against Forever.
