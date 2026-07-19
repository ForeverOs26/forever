# Forever Current Stage

Status: Canonical active-stage document
Last updated: 2026-07-19

## Stage name

Fast Intake v1 canonical on `main`, with the first measured real-project pilot as the next product checkpoint. Shared Forever Navigator (website + Booth Mode), ordinary new-project draft import simplification, and RC5.5D canonical-application closure remain canonical and unchanged.

## Shared Navigator (website + Booth Mode) — canonical

A shared Forever Navigator with two presentation shells is canonical on `main`. The website Navigator is implemented at `/navigator`, and Booth Mode is implemented at `/booth`. Booth remains intentionally unlinked from normal public navigation.

Canonical implementation:

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

## Fast Intake v1 — canonical

Fast Intake v1 is implemented, independently Windows-validated, and canonical
on `main`. It is a bounded, local, owner-only preparation-and-validation tool.
The local owner command is `npm.cmd run intake -- ...` in Windows PowerShell and
`cmd.exe`, and `npm run intake -- ...` in Bash, Linux, and macOS. It turns
project source materials (a folder
and/or ZIP archives) into a deterministic, validated, unpublished Progressive
draft payload for the existing ordinary draft importer. It reuses the existing
Progressive builder, fingerprint, currency policy, provenance and warning
model, and the ordinary `-ValidateOnly` invariants, with a hardened
untrusted-ZIP boundary, journaled crash-recoverable transactional artifact
output, per-project locking, and strengthened anti-fabrication guards.

Scope honesty: Fast Intake v1 consumes only already-structured artifacts (an
extracted price-list JSON and a `project-facts.json`). Raw PDFs, spreadsheets,
images, and videos are inventoried and classified only — it does not yet
transform an ordinary raw developer dossier into structured units/prices by
itself, and the 15-minute target applies when compatible structured artifacts
already exist. Raw-document extraction/OCR/spreadsheet parsing is a later Fast
Intake stage.

Fast Intake prepares and validates an unpublished Progressive draft. It creates
no database client, makes no production connection or network request, executes
no database import, creates no lead, and performs no production write or
publication. It writes local managed artifacts only, under
`forever-data/projects/<slug>/` and a gitignored temporary workspace. It does not add schema,
migration, RPC, RLS, grants, or backend services, does not create a
website/admin UI, and does not expand Factory autonomy. Coralina remains an
unpublished draft and Factory autonomy remains A0. See `docs/FAST_INTAKE_V1.md`.

## Current authorization and safety state

Current state remains:

- live capability is disabled;
- no executor credential has been provisioned for live use;
- Coralina is imported as a draft only and remains unpublished;
- Factory autonomy remains A0 - Propose only.

The ordinary draft importer does not authorize publication. Schema, migration, RPC, RLS, grant, existing-data mutation, and partial-state recovery work remains exceptional maintenance subject to its own review and validation.

## Active tasks

| Task                                                                | Owner             | Status                                                                |
| ------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------- |
| RC5.5D exceptional maintenance capability                           | Owner / Architect | Completed and retained                                                |
| Generic Progressive draft-import simplification                     | Codex / Owner     | Completed                                                             |
| Owner-authorized Coralina draft import through the generic importer | Owner             | Completed - draft only, unpublished                                   |
| Shared Navigator: website + Booth Mode over one Navigator Core      | Codex / Owner     | Completed and canonical on `main`                                     |
| Fast Intake v1 with a 15-minute draft target                        | Codex / Owner     | Implemented, independently Windows-validated, and canonical on `main` |
| Publication of any imported draft                                   | Owner             | Later, separate action                                                |

## Next checkpoint

Run Fast Intake v1 on one new non-sensitive real project with compatible structured artifacts, measure the complete local preparation-and-validation time against the 15-minute target, and record gaps before starting the separate raw-document extraction stage. This pilot must not automatically import or publish the project.

## Acceptance criteria for the next checkpoint

- One new non-sensitive real project with compatible structured artifacts is prepared and validated locally as an unpublished Progressive draft.
- Complete local preparation-and-validation time is measured against the 15-minute target and any gaps are recorded before the separate raw-document extraction stage begins.
- The pilot performs no automatic import or publication and requires no schema, migration, RPC, RLS, or grant work.
- Shared Navigator behavior at `/navigator` and `/booth` remains canonical over one NAV-001 Navigator Core, with Booth still unlinked from normal public navigation unless separately authorized.
- Factory autonomy remains A0 throughout.

## Out of scope

- Platform recertification, production rollback rehearsal, strict RC5.5D approval/receipt flow, `pg_stat_ssl`, project-specific production launchers, and repeated infrastructure audits for an ordinary import.
- Schema, migration, RPC, RLS, grant, existing-data mutation, or partial-state recovery work; these stay in the exceptional maintenance path.
- Publication, update/upsert behavior, automatic retries, or disaster-recovery automation.
- Linking Booth Mode from normal public navigation without a separate product decision.

## Definition of done

The next checkpoint is complete when the real-project pilot records its complete local preparation-and-validation time and gaps against the 15-minute target, with no automatic import, no publication action, no schema/migration/RLS/backend change, and Factory autonomy remaining A0.
