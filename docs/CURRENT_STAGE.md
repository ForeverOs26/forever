# Forever Current Stage

Status: Canonical active-stage document
Last updated: 2026-07-18

## Stage name

Ordinary new-project draft import simplification, after RC5.5D canonical-application closure, with a shared Forever Navigator (website + Booth Mode) implemented in an open, not-yet-merged pull request.

## Shared Navigator (website + Booth Mode) — pending review, not yet canonical

A shared Forever Navigator with two presentation shells has been implemented in **open pull request #84** (`claude/navigator-booth-implementation-1da3u9`). It is **not yet merged into `main`**, is **not yet canonical**, and the `/booth` route is **not yet part of the deployed site**. It remains pending independent Codex review and Owner approval and merge. Once merged, this section will be updated to describe it as the current canonical implementation.

What the PR implements, subject to review:

- NAV-001 as the shared Navigator source of truth. Its approved Screens 00–08 questions, order, options, DecisionProfile, Forever Story, RecommendationPath, advisor invitation, and confirmation/edit behavior are preserved unchanged.
- Website mode (`/navigator`) and Booth Mode (`/booth`) consuming one shared Navigator Core (`src/features/navigator/core/`): question definitions, gating, DecisionProfile derivation, Forever Story generation, RecommendationPath, and one deterministic project-match evaluator. Identical answers are designed to produce identical DecisionProfile, Forever Story, and recommendation results in either mode.
- Booth Mode as a presentation/employee workflow shell, not a second product: staff chrome, tablet layout, guarded reset, real-catalogue results, guest project selection, concise lead capture on the existing lead-service contract, and a completion screen. No second questionnaire, matching engine, or Project Detail page, and no authentication, CRM, analytics, kiosk, or device tracking.
- A deterministic evaluator that shows a factual match reason only when both the confirmed NAV-001 profile and the ProjectService record carry the supporting data, with sentinel/unavailable-value guards across every matching dimension; otherwise the honest "No exact match found — showing available projects for discussion" line, with the full real catalogue still shown. No match score, percentage, ranking, fabricated yield, market position, or verification status.
- Coralina excluded from the production client bundle and appearing only through the existing local development demo preview, with the refined neutral placeholder and the internal local-development badge. No schema, migration, RLS, or backend change.

## Prior stage

Ordinary new-project draft import simplification, after RC5.5D canonical-application closure.

## Current milestone

RC5.5D remains completed, canonically applied, and verified as an exceptional maintenance capability. Ordinary new-project persistence is one generic Progressive draft-import path: payload validation, duplicate check, one atomic Progressive RPC transaction, exact graph verification, `COMMIT`, and a short post-commit verification.

The Coralina production draft import through that generic importer is completed: 1 project, 8 buildings, 198 units, 198 prices, 6 warnings, 1 ingestion batch. Coralina remains an unpublished draft; publication is a later, separate action. The local website preview of Coralina is completed.

## Current authorization and safety state

Current state remains:

- live capability is disabled;
- no executor credential has been provisioned for live use;
- Coralina is imported as a draft only and remains unpublished;
- Factory autonomy remains A0 - Propose only.

The ordinary draft importer does not authorize publication. Schema, migration, RPC, RLS, grant, existing-data mutation, and partial-state recovery work remains exceptional maintenance subject to its own review and validation.

## Active tasks

| Task | Owner | Status |
| --- | --- | --- |
| RC5.5D exceptional maintenance capability | Owner / Architect | Completed and retained |
| Generic Progressive draft-import simplification | Codex / Owner | Completed |
| Owner-authorized Coralina draft import through the generic importer | Owner | Completed - draft only, unpublished |
| Shared Navigator: website + Booth Mode over one Navigator Core | Claude Code / Owner | Open PR #84 - pending independent review and Owner merge, not yet canonical |
| Fast Intake v1 with a 15-minute draft target | Owner | Blocked on PR #84 merge - not started |
| Publication of any imported draft | Owner | Later, separate action |

## Next checkpoint

Independent review and Owner approval and merge of PR #84 (shared Navigator: website + Booth Mode). Fast Intake v1 with a 15-minute draft target is the checkpoint **after** PR #84 merges — it is not started and does not begin until the Navigator PR is reviewed, approved, and merged into `main`.

## Acceptance criteria for the next checkpoint

- PR #84 receives independent Codex review and Owner approval.
- PR #84 is merged into `main` without schema, migration, RLS, or backend changes and without publishing Coralina.
- Only once merged: a new project's source material can begin targeting a validated, unpublished draft graph through the ordinary generic importer within a 15-minute target (Fast Intake v1), with no publication performed by the intake path and no schema, migration, RPC, RLS, or grant work in the ordinary path.
- Factory autonomy remains A0 throughout.

## Out of scope

- Platform recertification, production rollback rehearsal, strict RC5.5D approval/receipt flow, `pg_stat_ssl`, project-specific production launchers, and repeated infrastructure audits for an ordinary import.
- Schema, migration, RPC, RLS, grant, existing-data mutation, or partial-state recovery work; these stay in the exceptional maintenance path.
- Publication, update/upsert behavior, automatic retries, or disaster-recovery automation.
- Merging PR #84 without independent review, or treating it as canonical before merge.

## Definition of done

The next checkpoint is complete when PR #84 is independently reviewed, Owner-approved, and merged with no publication action, no schema/migration/RLS/backend change, and Factory autonomy remaining A0. Fast Intake v1 becomes the following checkpoint only after that merge.
