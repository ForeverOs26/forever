# Forever Task Template

Copy the block below into a task prompt. Fill in what is specific to the task
and leave the rest out — the repository supplies the workflow through
[`AGENTS.md`](../AGENTS.md) and
[`docs/FOREVER_DEVELOPMENT_WORKFLOW.md`](FOREVER_DEVELOPMENT_WORKFLOW.md).

---

```
TASK ID:
<FOREVER-AREA-NNN>

GOAL
<One sentence. The outcome, not the method.>

USER / BUSINESS OUTCOME
<What is true for a user or for the Owner once this is done.>

RELEVANT CONTEXT
<Only what the agent cannot find by reading the repository: prior attempts,
Owner decisions, external state, links.>

IN SCOPE
<-->

OUT OF SCOPE
<-->

REQUIRED EVIDENCE / ACCESS
<What must be observable or reachable for this outcome to be provable.
If it is missing, the agent stops with BLOCKED BEFORE IMPLEMENTATION.>

MUTATION AUTHORITY
<None by default. Name any external mutation that is explicitly authorized —
Cloudflare, Supabase, R2, production data, traffic, credentials, uploads.
Anything not named here is Owner-only.>

DONE WHEN
<-->
<-->

VERIFICATION
<Mode: Standard Development | Investigation | High-Risk / Production.
Standard is: focused tests, relevant integration tests, npm run verify:ci.>

STOP CONDITIONS
<What must make the agent stop and report instead of continuing.>

EXECUTION
Complete the entire authorized lifecycle in this one task — preflight,
implementation, verification, one complete final-diff review, one consolidated
verifier pass, at most one corrective pass, commit, push, draft PR, CI, and one
concise final report. Do not return an intermediate plan for approval and do not
ask to continue between internal phases.
```

---

## Notes

- **Task ID** makes the branch and the PR traceable. One task, one branch, one PR.
- **Required evidence / access** is the field that prevents speculative work.
  Be honest here: if the task needs production logs, a credential or an admin
  API, say so, so the agent can stop before implementing rather than after.
- **Mutation authority** defaults to none. Silence is not authorization.
- **Done when** should be checkable by someone reading the diff and the CI
  result, without rerunning the task.
