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

RC5.5D remains completed, canonically applied, and verified as an exceptional maintenance capability. Ordinary new-project persistence is now one generic Progressive draft-import path: payload validation, duplicate check, one atomic Progressive RPC transaction, exact graph verification, `COMMIT`, and a short post-commit verification.

The simplification was local-only: no production connection occurred and Coralina has not been imported. Publication remains a later, separate action.

## Current authorization and safety state

Current state remains:

- live capability is disabled;
- no executor credential has been provisioned for live use;
- Coralina has not been imported;
- Factory autonomy remains A0 - Propose only.

The ordinary draft importer does not authorize publication. Schema, migration, RPC, RLS, grant, existing-data mutation, and partial-state recovery work remains exceptional maintenance subject to its own review and validation.

## Active tasks

| Task | Owner | Status |
| --- | --- | --- |
| RC5.5D exceptional maintenance capability | Owner / Architect | Completed and retained |
| Generic Progressive draft-import simplification | Codex / Owner | Pending independent review and Owner approval in this R2 PR |
| Owner-authorized Coralina draft import through the generic importer | Owner | Next checkpoint - not started |
| Publication of any imported draft | Owner | Later, separate action |

## Next checkpoint

Owner-authorized Coralina draft import through `scripts/import/Import-ForeverProjectDraft.ps1`. The Owner supplies ordinary connection settings and a password interactively; the generic importer validates the existing payload, rejects duplicates, persists exactly one draft graph atomically through the Progressive RPC, verifies it, and commits. It does not publish the project.

## Acceptance criteria for the next checkpoint

- Owner explicitly authorizes the Coralina draft import after independent review of this R2 change.
- The existing Coralina payload and Progressive migration hashes match their recorded values.
- The generic importer reports a completed exact draft graph and post-commit check, or fails without a partial import.
- Publication is not performed by the import checkpoint.
- Factory autonomy remains A0.

## Out of scope

- Platform recertification, production rollback rehearsal, strict RC5.5D approval/receipt flow, `pg_stat_ssl`, project-specific production launchers, and repeated infrastructure audits for an ordinary import.
- Schema, migration, RPC, RLS, grant, existing-data mutation, or partial-state recovery work; these stay in the exceptional maintenance path.
- Publication, update/upsert behavior, automatic retries, or disaster-recovery automation.

## Definition of done

The next checkpoint is complete when the Owner-authorized Coralina payload is imported as a verified draft through the generic importer, with no publication action and Factory autonomy remaining A0.
