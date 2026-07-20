# Forever Current Stage

Status: Canonical active-stage document
Last updated: 2026-07-20

## Stage name

Structured Input Preparation Design v1 is independently reviewed, Owner approved, and canonical. The active development checkpoint is SIP-001A: qualify and deterministically extract one supported text-based PDF price list into candidate `ExtractedPriceList` JSON, validate it, produce an exception-only review summary, and prove current Fast Intake consumes the reviewed result unchanged. Partner Demo v1 remains canonical and presentation-ready, with its presentation pending scheduling in parallel; it does not block SIP-001A. Shared Forever Navigator (website + Booth Mode), Fast Intake v1, ordinary new-project draft import simplification, and RC5.5D canonical-application closure remain canonical and unchanged.

Completed prerequisites for this stage:

- Navigator canonical (website `/navigator` + Booth `/booth` over one NAV-001 Navigator Core);
- Booth canonical;
- Coralina local preview complete (unpublished draft, local development only);
- Fast Intake v1 canonical;
- ordinary Progressive draft import canonical.

## Structured Input Preparation Design v1 - canonical

SIP-001 begins with authorized local raw price-list PDF input and reuses the existing Fast Intake safe inventory, path, ZIP, hashing, duplicate, and classification boundaries. SIP-001A adds local Poppler executable/version preflight, PDF text-layer qualification, deterministic extraction of one supported table layout, exact source page and row references, candidate normalization, duplicate and ambiguity blocking, an exception-only CLI review summary, reviewed final `ExtractedPriceList` JSON, deterministic repeat proof, and unchanged Fast Intake compatibility proof.

SIP-001A explicitly excludes project-facts automation, XLSX/CSV extraction, OCR, scanned PDFs, images and floor plans, AI extraction, cloud processing, database connection, import, publication, admin UI, and Factory autonomy expansion.

Rainpalm is the intended first pilot only when its actual raw price-list PDF is confirmed in an authorized local source folder. The committed Rainpalm payload is comparison ground truth, not proof that the raw PDF is present. Absence of that PDF blocks the real Rainpalm pilot but does not invalidate the design or prevent qualification/parser infrastructure work with safe fixtures.

## Partner Demo v1 — canonical

Partner Demo v1 is a presentation-readiness layer over the existing product, not a second product:

- one canonical 7–10 minute partner runbook in `docs/PARTNER_DEMO_V1.md` (persona, timed script, routes, fallbacks, checklist, shutdown, honest limitations);
- a local Windows launcher `scripts/demo/Start-Forever-Partner-Demo.cmd` that reserves the exact port, enforces process-scoped no-write and committed-local-data controls, waits for a local safety response before opening the browser, and owns server shutdown (no production credentials or background job);
- launcher-only project data at the existing ProjectService/Project Detail boundaries: source-backed Modeva plus the existing Coralina preview, with no production connection; ordinary development and production service behavior remain unchanged;
- an explicit local no-write mode at the existing `submitLead` boundary: mandatory in the Partner Demo and opt-in (`VITE_DEMO_LEAD_MODE=true`) for ordinary `npm run dev`; lead forms validate and complete, no Supabase client/write request occurs, and no guest data is logged;
- minimal shared-UI presentation fixes: the home hero now leads with "Start the Forever Navigator", the website Navigator completion CTA routes to `/contact`, the internal placeholder "Temporary Forever ID" was removed, unsupported static claims are excluded from the Partner Demo path, sparse records issue no scores/verification claims, and the Passport omits render-time generation metadata instead of suppressing hydration mismatches;
- no new Navigator, matching engine, questionnaire, Project Detail engine, Passport, or lead system; no fabricated project facts; Coralina remains an unpublished local-development preview.

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
- Partner Demo v1 remains canonical;
- Rainpalm remains unimported and unpublished;
- Coralina is imported as a draft only and remains unpublished;
- no production connection, import, publication, lead, or production write is authorized by SIP-001A;
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
| Rainpalm Fast Intake Pilot 01                                       | Codex / Owner     | Completed successfully — 39.834s, unpublished validated partial draft |
| Partner Demo v1 (runbook, launcher, no-write lead demo mode)        | Claude / Owner    | Completed and canonical on `main`                                     |
| Structured Input Preparation Design v1                              | Codex / Owner     | Completed; independently reviewed, Owner approved, and canonical      |
| SIP-001A supported text-PDF extraction                              | Codex / Owner     | Active development checkpoint                                         |
| Present Partner Demo v1 to the partner                              | Owner             | Parallel pending business checkpoint; scheduling dependent            |
| Publication of any imported draft                                   | Owner             | Later, separate action                                                |

## Active development checkpoint

SIP-001A qualifies and deterministically extracts one supported text-based PDF price list into candidate `ExtractedPriceList` JSON, validates it, produces an exception-only review summary, and proves current Fast Intake consumes the reviewed result unchanged. The implementation must remain local, deterministic, source-referenced, fail closed on duplicates and ambiguity, and byte-identical on repeat.

## Parallel pending business checkpoint

Present Forever Partner Demo v1 when the partner is available, using `docs/PARTNER_DEMO_V1.md`, collect structured feedback, and classify every item as one of: demo blocker; product improvement; future roadmap idea; or commercial/partnership decision. This presentation remains pending scheduling and does not block SIP-001A.

## Pilot prerequisite

The real Rainpalm SIP-001A pilot requires the actual raw Rainpalm price-list PDF in an authorized local source folder. Until confirmed, safe fixtures may prove qualification and parser infrastructure, but cannot claim a real Rainpalm raw-PDF pilot. Rainpalm remains unimported and unpublished.

## Acceptance criteria for the active development checkpoint

- One qualified supported text-based PDF price-list layout is extracted deterministically into candidate `ExtractedPriceList` JSON.
- Every accepted value has exact source page and row references; duplicate, inferred, ambiguous, conflicting, recovery, and unclear date/currency cases are blocked for review.
- The reviewed final JSON is byte-identical across a deterministic repeat and passes unchanged Fast Intake compatibility validation.
- No project-facts automation, XLSX/CSV extraction, OCR, scanned-PDF/image/floor-plan processing, AI/cloud extraction, database connection, import, publication, admin UI, or Factory autonomy expansion occurs.
- Shared Navigator behavior at `/navigator` and `/booth` remains canonical over one NAV-001 Navigator Core, with Booth still unlinked from normal public navigation unless separately authorized.
- Coralina remains an unpublished draft and Factory autonomy remains A0 throughout.

## Out of scope

- Platform recertification, production rollback rehearsal, strict RC5.5D approval/receipt flow, `pg_stat_ssl`, project-specific production launchers, and repeated infrastructure audits for an ordinary import.
- Schema, migration, RPC, RLS, grant, existing-data mutation, or partial-state recovery work; these stay in the exceptional maintenance path.
- Publication, update/upsert behavior, automatic retries, or disaster-recovery automation.
- Linking Booth Mode from normal public navigation without a separate product decision.
- Project-facts automation, XLSX/CSV extraction, OCR, scanned PDFs, images and floor plans, AI extraction, cloud processing, database connection, import, publication, admin UI, and Factory autonomy expansion.

## Definition of done

The active checkpoint is complete when SIP-001A proves qualification, deterministic extraction of one supported text-PDF layout, exact source references, exception-only review, reviewed final JSON, duplicate/ambiguity blocking, deterministic repeat, and unchanged Fast Intake consumption. The partner presentation remains a parallel pending business checkpoint; when delivered, its feedback is classified as demo blocker / product improvement / future roadmap idea / commercial-partnership decision, with no production lead, import, publication, or production write. Coralina remains unpublished, Rainpalm remains unimported and unpublished, and Factory autonomy remains A0.
