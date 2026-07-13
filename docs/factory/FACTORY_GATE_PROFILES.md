# Forever Factory Gate Profiles

Status: Ratified operational policy
Current autonomy: A0 — Propose only
Operator maturity: v0.1 implemented in this branch; local checks become active after merge and setup; real low-risk operational proving not yet completed

## Authority and failure posture

- The PR diff is authoritative. A generated report is evidence about a run, not authority over the diff.
- An unavailable, missing, incomplete, or misconfigured gate that has been declared required and active is a gate failure, never a pass.
- A gate that has not yet been implemented or activated is labelled `PLANNED`, never passed.
- Until approved repository CI workflows are active, bootstrap relies on local Operator validation, manual diff review, and Owner merge authorization.
- Any stage, decision, roadmap, or Factory-state change updates its Ledger file in the same PR.
- Any shared contract is R2 and may have only one in-flight owning packet.
- R2 and R3 never auto-merge. R3 is merged only by the Owner.
- At A0 every packet and every merge remains Owner-approved.

## Active after merge and local setup — Operator v0.1

The integrated Operator can actively enforce these controls for a declared patch after its prerequisites are met:

- explicit expected-base existence and ancestry against fetched `origin/main`;
- optional patch `base-commit` equality;
- allowed/forbidden path scope and protected-path rejection;
- patch format, path traversal, binary-patch, file-size, secret-pattern, and client-data-pattern checks;
- isolated disposable worktree application with `git apply --check`;
- conservative LOW/MEDIUM/HIGH automatic risk floor;
- configured dependency install, TypeScript, full tests, changed-file ESLint, production build, and `git diff --check` profiles;
- a recorded global lint baseline separated from changed-file lint enforcement;
- retry limit, state/recovery records, and pre-push repeat security scan;
- no direct `main` push, no force-push, no silent conflict resolution, and no MEDIUM/HIGH automatic merge;
- `autoMerge: false` in `.forever-factory/operator.config.json`.

This repository currently has no approved active `.github/workflows` check definitions. GitHub CI enforcement is therefore `PLANNED`, not passed and not an active-required gate for this bootstrap PR. Once a workflow is activated as required, its absence or failure blocks merge.

## Planned or manual policy controls

These requirements are constitutional/manual today and require later Operator or CI enhancement before they can be called automated controls:

- native R0–R3 classification and risk-specific profiles;
- same-PR Ledger-change detection;
- shared-contract ownership locking;
- author–reviewer identity/family separation enforcement;
- reference/link integrity beyond available repository scripts;
- data-standard and canonical-evidence semantic validation;
- migration/write-path dry-run and idempotency selection by packet risk;
- explicit Owner-approval and Owner-merge verification for R2/R3;
- constitutional amendment isolation and the no-autonomy-increase-in-the-same-PR rule;
- reliable required-check enforcement after CI workflows are introduced.

## Profiles

### R0 — Reversible and inert

Required:

- formatting or changed-file lint as applicable;
- reference/link integrity;
- diff scope and `git diff --check`;
- same-PR Ledger update where applicable;
- clean task worktree.

Active after merge and local setup: patch/scope/security checks, changed-file ESLint where supported, configured validations, diff check, and worktree cleanliness mechanics. Reference integrity and Ledger semantics remain manual/planned.

### R1 — Product code behind deterministic gates

R0 plus:

- TypeScript;
- full product tests;
- production build;
- dependency and security scan;
- base-commit validation;
- no unexpected changed paths.

Active after merge and local setup: the locally configured R1-capable subset. GitHub CI enforcement remains `PLANNED`; Owner review and merge authorization remain required at A0.

### R2 — Structural or truth-adjacent

R1 plus:

- shared-contract ownership;
- migration or write-path dry-run where applicable;
- data-standard/evidence validation;
- idempotency where applicable;
- different author and reviewer with adversarial diff review;
- explicit Owner approval before merge;
- no automatic merge.

Active after merge and local setup: the R1-capable subset and permanent no-auto-merge boundary. Contract ownership, semantic evidence checks, author–reviewer separation, and Owner-approval verification are manual/planned.

### R3 — Constitutional, external, privileged, financial, legal, security, or production

R2 plus:

- dedicated constitutional or privileged review;
- external-side-effect confirmation;
- no autonomy increase in the same constitutional-amendment PR;
- no automatic merge;
- Owner merge only.

Active after merge and local setup: protected-path/high-risk stops and no automatic merge. Strategic review, external authorization, amendment isolation, and Owner-merge verification are manual/planned. Browser automation remains deferred and is not an active gate capability.
