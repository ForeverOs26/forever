<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

# Forever Development Contract

This is the standing contract for every coding agent in this repository. It is
deliberately short. The full lifecycle is in
[`docs/FOREVER_DEVELOPMENT_WORKFLOW.md`](docs/FOREVER_DEVELOPMENT_WORKFLOW.md);
the prompt shape is in
[`docs/FOREVER_TASK_TEMPLATE.md`](docs/FOREVER_TASK_TEMPLATE.md).

A task prompt should normally need only **Goal, Context, Constraints, Done when**.
Everything below is supplied by the repository and does not need repeating.

## 1. One task, one outcome

One active engineering task → one coherent outcome → one branch → one pull
request. A single prompt authorizes the whole lifecycle: preflight, plan,
implementation, tests, complete diff review, commit, push, CI, final report.

Do not stop after a plan or an intermediate phase to ask "continue?" when the
remaining work is already authorized and unblocked. Ask only when a decision is
genuinely the Owner's or when you are blocked.

## 2. Readiness before implementation

Before writing code, establish whether the evidence, access and permissions
needed to reach the stated outcome actually exist.

If something indispensable is missing, stop and report
**`BLOCKED BEFORE IMPLEMENTATION`** with the exact missing item and the one
bounded Owner action that would unblock it.

Never compensate for missing production evidence with more documentation,
confident wording, cosmetic UI changes or unproved assumptions. More checking is
not progress when the missing prerequisite is access to the primary evidence.

## 3. Evidence labels

Label every material claim:

- **`PROVEN`** — reproduced here, with the command, output or artifact.
- **`INFERRED`** — reasoned from code or documents, not observed.
- **`UNKNOWN`** — not established.

An inference is never physical or production proof. Do not upgrade a label to
make a report read better.

## 4. Task modes

| Mode                       | Use for                                        | Verification                                                                         |
| -------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| **Standard Development**   | ordinary feature or bug fix                    | focused tests + relevant integration tests + `npm run verify:ci`                     |
| **Investigation**          | "why does X happen?"                           | read-only evidence; ends in a root cause **or** an exact blocker — no product change |
| **High-Risk / Production** | schema, RLS, auth, deployment, production data | domain harnesses + full suite + explicit Owner mutation gates                        |

Investigation and implementation are different modes. If the root cause cannot
be established, do not claim it was fixed. A safe mitigation may ship only when
it has independent product value and is in scope, and it must never be presented
as the root-cause repair.

Do not create runbooks, mutation frameworks, forensic reports or extra approval
gates for ordinary low-risk changes.

## 5. Canonical commands

```bash
npm run verify:ci        # the canonical gate: process check, typecheck, build, full tests, changed-file lint
```

Individually: `npm run process:check`, `npm run typecheck`, `npm run build`,
`npm run test:ci`, `npm run lint:changed`. `npm test` runs Vitest raw.

The build must run **before** the tests — several suites read `.output/`.
`npm run verify:ci` already orders them correctly.

Whole-repository `npm run lint` is **not** clean on `main` and is not a gate.
`npm run lint:changed` lints only the files this branch touches.

## 6. Review budget

1. The implementer reviews the **complete final diff once** — not only the last
   local correction.
2. When available, one **read-only verifier** (subagent or second agent) runs
   after implementation and returns **all** P0/P1 blockers in one consolidated
   pass.
3. **At most one** consolidated corrective pass follows.
4. After that pass the only outcomes are **`APPROVED`**, **`BLOCKED`**, or
   **`SPLIT INTO A NEW TASK`**. Do not begin a third patch cycle on the same
   task.

If the same class of mistake happens twice, write a short retrospective and
update this contract or the workflow document — do not issue another long
corrective prompt.

## 7. Context recovery

After compaction, interruption or resume: reread this file and the task
contract, then inspect `git status`, the branch, the base SHA, the commits, the
complete diff, and the current PR and CI state. Continue from repository
evidence, not from chat memory. Never restart completed work because context was
compacted. One session ≈ one coherent outcome; old PR descriptions and
historical reports are not the current task contract.

## 8. External mutations are Owner-only

An agent must not deploy, or change Cloudflare, Supabase, R2, production data,
traffic, credentials, secrets or file-upload state, unless the task explicitly
authorizes that exact action. Report the required mutation as one bounded Owner
action instead.

## 9. Prohibited

- Merging a pull request, or enabling automatic merge.
- Force-pushing or otherwise rewriting published history (see the Lovable
  warning above).
- Refactors, renames or dependency changes unrelated to the stated outcome.
- Expanding documentation to substitute for missing evidence.
- Adding a repository gate that already fails on a clean `main` baseline.

## 10. Final report

Outcome, changed files, verification results, unknowns, external mutations,
next decision. Do not replay the task history.
