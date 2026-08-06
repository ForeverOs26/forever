# Forever Development Workflow

Status: Canonical development lifecycle
Last updated: 2026-08-06

The short standing contract is [`AGENTS.md`](../AGENTS.md) (loaded automatically
by Codex, and by Claude Code through [`CLAUDE.md`](../CLAUDE.md)). This document
is the detail behind it. The prompt shape is
[`docs/FOREVER_TASK_TEMPLATE.md`](FOREVER_TASK_TEMPLATE.md).

Roles and stage governance are unchanged and remain in
[`docs/AI_WORKFLOW.md`](AI_WORKFLOW.md),
[`docs/FOREVER_FACTORY_CONSTITUTION.md`](FOREVER_FACTORY_CONSTITUTION.md) and
[`docs/DECISIONS.md`](DECISIONS.md). This document governs **how one task is
executed**, not what work is chosen.

> **This is a delivery process, not an architecture project.** These documents
> exist to get product work finished. Do not grow them into a framework, and do
> not add process for its own sake.

---

## 1. The task contract

A task prompt supplies **Goal, Context, Constraints, Done when**. The repository
supplies everything else. Anything the prompt does not say is governed here.

One active engineering task → one coherent outcome → one branch → one pull
request. A single prompt authorizes the complete lifecycle below. Between its
internal phases the agent does not ask permission to continue.

Ask the Owner only when a decision is genuinely theirs, or when you are blocked
and no assumption is safe.

## 2. Task modes

Pick the mode from the outcome, not the effort.

### Standard Development

Ordinary feature or bug fix.

- Focused tests for the changed behaviour, plus the integration tests that cover it.
- `npm run verify:ci` before the PR.
- No runbook, no mutation harness, no forensic report.

### Investigation

"Why does X happen?" — the deliverable is understanding.

- Read-only. No production mutation, no speculative product change.
- Ends in a **root cause** or an **exact blocker**, never in "probably".
- If the root cause is not established, say so. Do not claim a fix.
- A safe mitigation may ship from an investigation **only** when it has
  independent product value and is explicitly in scope, and it must be labelled
  a mitigation — never the root-cause repair.

### High-Risk / Production

Schema, RLS, authentication, deployment, credentials, production data, traffic
or file-upload state.

- Domain harnesses plus the full suite.
- Every external mutation is a separate, explicit Owner gate, named in advance.
- The agent prepares and proves; the Owner executes.

## 3. Evidence and access readiness

Run this **before** writing code.

1. What must be true for the stated outcome to be reachable?
2. Which of those things can this session actually observe or change?
3. What is missing — evidence, access, credentials, permissions, data?

If something indispensable is missing, stop and report
**`BLOCKED BEFORE IMPLEMENTATION`**: the missing item, why it is indispensable,
and the one bounded Owner action that would unblock it.

> **More checking is not progress when the missing prerequisite is access to the
> primary evidence.**

Never substitute for missing production evidence with extra documentation,
confident wording, cosmetic UI changes or unproved assumptions.

### Evidence labels

Every material claim carries one:

| Label      | Meaning                                                        |
| ---------- | -------------------------------------------------------------- |
| `PROVEN`   | Reproduced in this task, with the command, output or artifact. |
| `INFERRED` | Reasoned from code or documents; not observed.                 |
| `UNKNOWN`  | Not established.                                               |

An inference is never physical or production proof.

## 4. Lifecycle

```
explore → plan → implement → verify → review → PR
```

1. **Explore.** Read the repository before changing it: the current branch, the
   base SHA, the files the outcome touches, and the tests that already cover
   them. Establish the readiness check in §3.
2. **Plan.** Internally. Do not return a plan for approval when the lifecycle is
   already authorized.
3. **Implement.** Only what the outcome requires. No unrelated refactors,
   renames, dependency bumps or documentation expansion.
4. **Verify.** Proportionally (§5). Fix what you break.
5. **Review.** One complete final-diff review, then one consolidated verifier
   pass (§6).
6. **PR.** One focused commit, push the task branch only, open **one draft PR**
   using the repository template, wait for `quality-gate` to reach a terminal
   state, fix any task-induced failure inside the same task, then report.

The agent does not merge, does not enable automatic merge, does not mark a PR
ready without Owner instruction, and does not force-push or rewrite published
history.

## 5. Proportional verification

The canonical gate is:

```bash
npm run verify:ci
```

It runs, in order: `process:check` → `typecheck` → `build` → `test:ci` →
`lint:changed`. The build runs before the tests because several suites read
`.output/`.

| Mode                   | Required                                                           |
| ---------------------- | ------------------------------------------------------------------ |
| Standard Development   | focused tests, relevant integration tests, `npm run verify:ci`     |
| Investigation          | read-only evidence only; a root cause or an exact blocker          |
| High-Risk / Production | the above plus domain harnesses, and explicit Owner mutation gates |

### Two baseline facts about this repository

Both are `PROVEN` against a clean `origin/main` worktree on 2026-08-06 and both
are pre-existing — neither is caused by, nor excuses, any new change.

- **Whole-repository lint is not clean.** `npm run lint` reports ~1,635
  `prettier/prettier` errors across ~94 files on `main`, ~81 of them under
  `src/`. It is therefore not a gate. `npm run lint:changed` lints the files this
  branch touched — committed and uncommitted — against the merge base, with one
  exemption: a file that was **already unformatted at the merge base** is exempt
  from `prettier/prettier`, so touching one line of it does not force an
  unrelated whole-file reformat. Nothing else is exempt; new files are strict,
  and every other ESLint error fails everywhere. Repository-wide formatting
  cleanup is a separate authorized task, and when it lands the exemption stops
  applying to anything.
- **Two suites need source material that git does not carry.**
  `src/features/project-detail/partner-demo-data.test.ts` and
  `src/import/importer-preflight.test.ts` depend on gitignored files under
  `forever-data/projects/*/source/`. They pass where that material exists and
  fail in any fresh checkout. `npm run test:ci` runs the **entire** suite and
  tolerates a failure in exactly those files **only while the required paths are
  absent**; a failure anywhere else, or in those files when the data is present,
  fails the gate. Because that tolerance is never empty in CI, `test:ci` also
  fails if any test file on disk never reported a result (a truncated run is not
  a pass) or if vitest reports an unhandled run-level error. The tolerance is
  per **file**: a new test added to one of those two files is not gated in a
  fresh checkout. Do not fabricate or copy the missing data to make them pass.

Both facts have a review trigger: revisit this section whenever the formatting
cleanup lands, or whenever a suite is added to or removed from the tolerated
list in `scripts/process/run-full-tests.mjs`.

## 6. One review, one correction

1. The implementer reviews the **complete final diff** once — the whole change,
   not only the last local correction.
2. When available, one **read-only verifier** (a subagent, or a second agent)
   reviews after implementation, so exploration and review stay out of the
   implementation context. It returns **all** P0/P1 blockers in a single
   consolidated pass.
3. **At most one** consolidated corrective pass follows.
4. After that pass, the outcome is exactly one of:
   - **`APPROVED`**
   - **`BLOCKED`** — with the exact blocker
   - **`SPLIT INTO A NEW TASK`** — with the residue named

   Do not begin a third patch cycle on the same task.

If the same class of mistake occurs twice, write a short retrospective and
update `AGENTS.md` or this document. Durable guidance replaces long corrective
prompts.

## 7. Context recovery

For a compacted, interrupted or resumed session, in this order:

1. Reread `AGENTS.md` and `CLAUDE.md`.
2. Reread the current task contract.
3. Inspect `git status`, the branch, the base SHA, the commits, and the
   **complete** diff against the base.
4. Inspect the current PR and its CI state (`gh pr view`, `gh pr checks`).
5. Continue from that repository evidence — not from reconstructed chat memory.
6. Never restart completed work because context was compacted.

One session corresponds to one coherent outcome. Old PR descriptions and
historical reports are context, never the current task contract.

## 8. External mutation authorization

An agent must not deploy, or change Cloudflare, Supabase, R2, production data,
traffic, credentials, secrets or file-upload state, unless the task explicitly
authorizes that exact action.

CI runs no secrets and performs no deployment. When a mutation is genuinely
required, the agent prepares it, proves it is correct, and reports **one bounded
Owner action** with the precise steps.

## 9. Final report format

Keep it short. Six parts:

1. **Outcome** — done / blocked / split, in one line.
2. **Changed files.**
3. **Verification** — what ran, and the result, with labels.
4. **Unknowns** — what stayed `INFERRED` or `UNKNOWN`.
5. **External mutations** — performed, or required of the Owner.
6. **Next decision** — the single thing the Owner must decide.

Do not replay the task history.

## 10. What this process does and does not promise

It does not guarantee correct code on the first attempt. Its contract is that a
task either **completes through one bounded lifecycle** or **stops early with an
exact blocker**, instead of expanding indefinitely.

---

## Reference

- OpenAI Codex — [Custom instructions with AGENTS.md](https://developers.openai.com/codex/guides/agents-md)
- [AGENTS.md open format](https://agents.md/)
- Anthropic — [How Claude remembers your project (CLAUDE.md, `@` imports)](https://code.claude.com/docs/en/memory)
- Anthropic — [Subagents](https://code.claude.com/docs/en/sub-agents)
- GitHub — [Creating a pull request template](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/creating-a-pull-request-template-for-your-repository)
- GitHub — [Workflow syntax for GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
- GitHub — [About rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)
