# Forever Current Stage

Status: Canonical active-stage document
Last updated: 2026-07-18

## Stage name

Shared Forever Navigator with website and Booth Mode presentation shells, on top of the completed Coralina production draft import.

## Shared Navigator (website + Booth Mode)

One shared Forever Navigator now serves two presentation modes without becoming two products:

- NAV-001 is the shared Navigator source of truth. Its approved Screens 00–08 questions, order, options, DecisionProfile, Forever Story, RecommendationPath, advisor invitation, and confirmation/edit behavior are preserved unchanged.
- Website mode (`/navigator`) and Booth Mode (`/booth`) consume one shared Navigator Core (`src/features/navigator/core/`): question definitions, gating, DecisionProfile derivation, Forever Story generation, RecommendationPath, and one deterministic project-match evaluator. Identical answers produce identical DecisionProfile, Forever Story, and recommendation results in either mode.
- Booth Mode is a presentation/employee workflow shell, not a second product: it adds staff chrome, tablet layout, guarded reset, real-catalogue results, guest project selection, concise lead capture on the existing lead-service contract, and a completion screen. It introduces no second questionnaire, matching engine, or Project Detail page, and no authentication, CRM, analytics, kiosk, or device tracking.
- The deterministic evaluator shows a factual match reason only when both the confirmed NAV-001 profile and the ProjectService record carry the supporting data; otherwise it uses the honest "No exact match found — showing available projects for discussion" line and still shows the full real catalogue. No match score, percentage, ranking, fabricated yield, market position, or verification status is computed or shown.
- Coralina remains excluded from production and appears only through the existing local development demo preview, with the refined neutral placeholder and the internal local-development badge. Booth introduces no schema, migration, RLS, or backend.

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
| Shared Navigator: website + Booth Mode over one Navigator Core | Claude Code / Owner | Implemented in PR #84 - pending independent review |
| Fast Intake v1 with a 15-minute draft target | Owner | Next checkpoint - not started |
| Publication of any imported draft | Owner | Later, separate action |

## Next checkpoint

Fast Intake v1 with a 15-minute draft target: from received project source material to a validated draft graph through the generic importer in fifteen minutes or less, without publication.

## Acceptance criteria for the next checkpoint

- A new project's source material reaches a validated, unpublished draft graph through the ordinary generic importer within the 15-minute target.
- No publication is performed by the intake path.
- No schema, migration, RPC, RLS, or grant work occurs in the ordinary path.
- Factory autonomy remains A0.

## Out of scope

- Platform recertification, production rollback rehearsal, strict RC5.5D approval/receipt flow, `pg_stat_ssl`, project-specific production launchers, and repeated infrastructure audits for an ordinary import.
- Schema, migration, RPC, RLS, grant, existing-data mutation, or partial-state recovery work; these stay in the exceptional maintenance path.
- Publication, update/upsert behavior, automatic retries, or disaster-recovery automation.

## Definition of done

The next checkpoint is complete when Fast Intake v1 produces a validated, unpublished draft within the 15-minute target through the ordinary generic importer, with no publication action and Factory autonomy remaining A0.
