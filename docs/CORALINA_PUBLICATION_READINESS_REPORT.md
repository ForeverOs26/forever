# Coralina Publication Readiness Report

**Task:** CORALINA-PUBLICATION-READINESS-001
**Date:** 2026-07-23
**Branch:** `claude/coralina-publication-readiness` (isolated worktree `C:\forever-claude-coralina`, outside `C:\forever`)
**Base:** `origin/main` @ `7963ceeb3e49f932153dd92afde0e5cb446b57f5` (merge of PR #95)
**Scope discipline:** This audit did not modify `docs/CURRENT_STAGE.md`, `docs/FOREVER_STATUS.md`, `docs/DECISIONS.md`, `docs/ROADMAP.md`, `docs/FOREVER_STUDIO_PRODUCTION_PREFLIGHT_REPORT.md`, or any file touched by PR #96 (`codex/forever-studio-production-preflight`). Verified by `git diff origin/main...origin/codex/forever-studio-production-preflight --stat`: PR #96 touches only `docs/CURRENT_STAGE.md`, `docs/DECISIONS.md`, `docs/FOREVER_STATUS.md`, `docs/FOREVER_STUDIO_001_IMPLEMENTATION_REPORT.md`, `docs/FOREVER_STUDIO_OWNER_RUNBOOK.md`, `docs/FOREVER_STUDIO_PRODUCTION_PREFLIGHT_REPORT.md`, `docs/ROADMAP.md` — no overlap with this report's file or with any Coralina source. Rainpalm import/publish and Factory autonomy were not touched or discussed as actionable items. Production was not accessed, queried, migrated, or changed; Coralina was not published or unpublished.

---

## Executive Verdict

**Coralina is not ready for commercial publication today.** The application-code layer (rendering, evidence-gating, truth-safety, tests) is in strong shape and would behave correctly and honestly if Coralina data reached it. But three concrete gaps sit between "code is safe" and "listing is live and useful to a real buyer":

1. **No database row exists.** Every artifact in `forever-data/projects/coralina/` is a validated, dry-run-only preparation package. Repo evidence confirms no import has ever executed against any real database (staging or production) — the closest proof is a hermetic test-fixture run in `orchestrator.test.ts`, not a live write. Publishing requires an explicit, Owner-authorized import execution, which is outside this audit's authority and was correctly not attempted.
2. **Media has no hosting path.** The progressive import payload deliberately carries **zero** media/document rows (`PAYLOAD_SUMMARY.md`: "0 media, 0 documents") because the ingestion RPC has no stable storage URL for the 343 classified local files (brochure, masterplan, floor plans, 119 images, 3 videos, 16 documents). If Coralina were imported and published exactly as currently packaged, the public page would show **no gallery, no brochure download, no master plan, no floor plans** — a commercially unusable listing despite rich underlying material. This is the single highest-priority blocker.
3. **The unit/price snapshot is one cycle stale.** The canonical payload reflects the 2026-07-03 price list. A newer, fully validated 2026-07-17 list (adds unit `CKD508`, drops `CKF406` from availability, zero price changes) has been reviewed with zero blocking issues but was never merged into `extracted/price-list.json` / `progressive/payload.json`.

Beyond these three, several **legitimate Owner decisions** remain (publish without stated construction status? without freehold/leasehold statement? without formal media-rights confirmation?) — the code handles all of these honestly today by hiding the field rather than fabricating it, so none of them is a code defect, but each is a real commercial judgment call the Owner should make explicitly before go-live.

No fabrication, invented score, unsupported verification wording, or cross-project contamination was found anywhere in the Coralina path. **No code defect was found that is safe, narrowly-scoped to Coralina, and independent of the open blockers above** — see Part E. This is therefore a **documentation-only readiness report**; no source code was changed on this branch.

---

## Part A — Current Canonical Coralina State (from committed evidence only)

| Field | Value | Source |
|---|---|---|
| Canonical slug | `coralina` | `forever-data/projects/coralina/manifest.json:5`; `identity.ts` `CORALINA_SLUG` |
| Official project name | "The Title Coralina Kamala" | `manifest.json:4` |
| Developer | Rhom Bho Property Public Company Limited | `manifest.json:6,47`; `evidence/rc5-4-evidence-review.json` — `SOURCE_VERIFIED`, high confidence, corroborated by Thailand SEC filing. AssetWise is only an indirect major shareholder, not the developer. |
| Location / country | Kamala, Phuket, Thailand | `manifest.json:8-10` — `SOURCE_VERIFIED` |
| Publication/active status expected by committed import | `public_status='draft'`, `is_active=true`, `forever_verified=false` (RPC create-mode defaults); `payload.project.publish: false` | `progressive/payload.json:13`; `supabase/migrations/20260718113000_progressive_ingestion_v1.sql:526,540-542` |
| Buildings | 8 (A–H) | `progressive/payload.json.buildings[]`; `validation-summary.json:7` |
| Units | 198 | `payload.json.units[]`; `extracted/unit-plans.json` (198 records) |
| Current price count | 198 (one per unit) | `payload.json.prices[]`; `extracted/price-list.json` |
| Price-list effective date (canonical, in payload) | 2026-07-03 | `import-status.json:163-168` |
| Newer price list (validated, **not merged**) | 2026-07-17 — 197 unchanged, +1 unit (`CKD508`), −1 from availability (`CKF406`), 0 price changes | `updates/2026-07-17/version-diff.json`; `updates/2026-07-17/price-list/review-summary.json` (0 blocking issues) |
| Warnings (6, from `progressive/payload.json.warnings[]`) | `developer_unresolved` (raw name preserved, no production developer UUID match), `location_unresolved` (same for location), `coordinates_missing`, `construction_status_missing`, `media_processing_deferred`, `document_processing_deferred` | `payload.json`; mirrored in `import-status.json.validation_issues[]` |
| Currency provenance | THB, `inferred_default` — country-default policy inference, **not** stated on any source price row | `evidence/rc5-4-evidence-review.json:169-184`; `src/import/currency-policy.ts:5-7,42-44` |
| Brochure / master plan / floor plans / unit plans / maps / photos / videos | Classified & described in JSON (brochure 4 files, price-list 2, masterplan 10, unit-plans 198, images 116, videos 3, documents 10 = 343 total), but the **underlying binary files are not committed to git** (`.gitkeep` only) and have no stable storage URL for import | `README.md:13-19`; `.gitignore:82-86`; `evidence/rc5-4-evidence-review.json:11` (`private_source_material_committed: false`) |
| Fields shown vs. hidden on the public Project Detail page | Every optional field (`constructionStatus`, `ownershipType`, investment/rental metrics, trust score/verdict) is null-guarded and rendered as absent (`return null` / hidden), never fabricated | `src/features/coralina-integration/adapters/coralina-project-detail.ts:98-99,124-139`; `src/features/project-detail/components/ProjectHero.tsx`, `ProjectGallery.tsx:16`, `ProjectDocuments.tsx:12`, `ProjectInvestmentAnalysis.tsx:39`, `ProjectTrustSummary.tsx:49` |
| Forever Passport / Intelligence output | Both the advisory-layer passport (`forever-passport.ts`) and the intelligence-engine passport (`intelligence-engine.ts`) correctly produce "Insufficient verified data" / no-score states for Coralina; the intelligence engine's numeric score is computed in memory but gated off-screen (`assessmentAvailable` false for Coralina's current sparse record) | `src/features/advisory/forever-passport.ts:63-73`; `src/features/passport/components/ForeverPassportCard.tsx:158-174`; `src/features/coralina-integration/tests/advisory.test.ts:24-34` |
| Evidence/provenance strength for material public claims | Developer, project name, location: `SOURCE_VERIFIED` (external corporate + Thailand SEC filing). Currency: `inferred_default` (policy, not evidence). Coordinates, construction status, ownership tenure, payment plan, rental/investment data: no evidence — absent by design (`CORALINA_DATA_GAPS`, `coralina-facts.ts:205-215`) | `evidence/rc5-4-evidence-review.json`; `data/coralina-facts.ts:205-215` |

**Important caveat repeated throughout this report:** repository presence of validated JSON is not proof of production state. No repo evidence — none was expected or sought, per instructions — confirms or denies whether a `projects` row with `slug='coralina'` exists in the live database today. That can only be confirmed by an Owner-authorized, out-of-band production check, which this audit did not perform.

---

## Part B — Publication Readiness Matrix

| # | Area | Classification | Note |
|---|---|---|---|
| 1 | Identity & developer | **READY** | Source-verified via official corporate site + Thailand SEC filing (`evidence/rc5-4-evidence-review.json`). |
| 2 | Location | **READY** | Source-verified (Kamala, Phuket, Thailand); matches Discovery's area-filter option list exactly. |
| 3 | Descriptions & positioning | **READY WITH TRANSPARENT LIMITATION** | Brochure-derived tagline/highlights/description carry per-field provenance; `total_units`, `project_area`, `completion` are null in the brochure extraction and correctly omitted rather than guessed. |
| 4 | Unit inventory | **REQUIRED PRE-PUBLICATION CORRECTION** | 198 units, no duplicates, fully evidence-backed — but reflects the 2026-07-03 snapshot, not the reviewed 2026-07-17 update (+1/−1 unit). Must be reconciled before go-live so buyers see current availability. |
| 5 | Prices & availability | **REQUIRED PRE-PUBLICATION CORRECTION** | Same staleness issue as #4; zero price *changes* between the two snapshots, so this is availability-only, not a pricing-accuracy problem. |
| 6 | Payment terms | **READY WITH TRANSPARENT LIMITATION** | No source evidence exists; `paymentPlans: []` by design, field hidden rather than fabricated. Acceptable for a first listing (buyer contacts Forever), common in the category. |
| 7 | Ownership / freehold / leasehold | **OWNER DECISION REQUIRED** | No source states tenure type; field is correctly hidden, not guessed — but this is a legally material fact for foreign buyers in Thailand. Owner should decide whether first publication should proceed without it, or whether it must be sourced first. |
| 8 | Construction & completion status | **OWNER DECISION REQUIRED** | Same pattern: correctly hidden (`construction_status_missing` warning), but commercially significant. Owner should decide whether to source this before or accept publishing without it. |
| 9 | Facilities | **READY WITH TRANSPARENT LIMITATION** | Extracted from brochure with provenance; not independently verified against masterplan geometry (masterplan is not machine-interpreted — see #10). |
| 10 | Master plan | **READY WITH TRANSPARENT LIMITATION** | 1 master-plan PDF + 9 building-labeled JPGs classified; no OCR/spatial linkage between units and masterplan positions exists yet — acceptable to publish the plan images as-is, just not as an interactive unit-locator. |
| 11 | Floor & unit plans | **BLOCKED** | 198 unit-plan images exist and match unit count 1:1, but see #20 — no image is currently import-eligible because none has a stable storage URL. |
| 12 | Gallery & video | **BLOCKED** | 116 images + 3 videos classified with rich metadata, same hosting blocker as #11 — `ProjectGallery.tsx` correctly renders nothing rather than a placeholder, but "renders nothing" is not commercially acceptable for a real listing. |
| 13 | Brochure & downloadable documents | **BLOCKED** | 16 documents classified (brochure, company profile, facilities, etc.), same hosting blocker. |
| 14 | Passport | **READY** | Both passport implementations correctly stay in a no-claim / evidence-pending state for Coralina's current record; covered by `advisory.test.ts` and the `assessmentAvailable` gate in `ForeverPassportCard.tsx` / `ProjectDetailEngine.tsx`. |
| 15 | Scores, verdicts, recommendations, unsupported claims | **READY** | `INVESTMENT_SCORE_UNAVAILABLE` / `RENTAL_SCORE_UNAVAILABLE` sentinels enforced; advisory layer never computes a new score/verdict/ranking for sparse projects; verified by tests. |
| 16 | Investment / rental / liquidity information | **READY** | `investmentInformation: []`, `rentalInformation: []` hardcoded empty at the canonical-record layer; no claim is asserted anywhere in the advisory or intelligence layers for Coralina today. |
| 17 | Project warnings & missing-data presentation | **READY** | 6 structured ingestion-time warnings are tracked (for operators); the public UI's response to each underlying gap is to hide the field, not to surface a scary internal code to the buyer — correct behavior for a consumer product. |
| 18 | Public route, catalogue, Navigator, sitemap, search | **READY** | Fully generic: `/projects/coralina` route, `/projects` catalogue filter (`is_active=true`), sitemap (`listActiveSlugs()`), and Discovery search/area-filter all work for Coralina with zero Coralina-specific code once the DB row exists and is active. Navigator/booth explicitly excludes Coralina from production catalogue matching and is covered by a dedicated test (`booth/coralina-preview.test.ts`). |
| 19 | Mobile rendering | **READY** | Standard Tailwind responsive breakpoints, no Coralina-specific layout code; same code path as every other published project. |
| 20 | Media rights and attribution | **OWNER DECISION REQUIRED** | No rights/license/attribution field exists anywhere in Coralina's data or in the platform's project-media schema — this is a platform-wide gap, not Coralina-specific. Owner should confirm Forever has commercial rights to publish the developer-supplied marketing materials before they go live; formal per-asset attribution fields are a post-publication enrichment (see Part D). |
| 21 | Contact and lead CTA | **READY** | `ProjectContactCTA` / `ContactForm` are fully generic and slug-driven; no Coralina-specific wiring needed; no internal path or debug leakage found in any contact-path component. |
| 22 | Publication rollback / unpublish path | **READY** | `setProjectPublication(slug, {publish:false})` is generic, tested (`orchestrator.test.ts`: "supports explicit unpublish and republish"), and backed by a Postgres RLS defense-in-depth requiring `is_active=true AND public_status='published'` for any public read. |

---

## Part C — Truth and Safety Review

No evidence of any of the following was found in the Coralina path:

- **Fabricated or optimistic claims** — none found. All optional facts are hidden, not guessed, at both the adapter layer (`coralina-project-detail.ts`) and the render layer (component-level null guards).
- **Unsupported verification wording** — `ProjectDeveloper.tsx` explicitly labels an unverified developer name "as stated by the source. Not yet verified by Forever." rather than asserting verification.
- **Invented scores or verdicts** — `advisory.test.ts` directly asserts Coralina's investment/rental scores stay at the `UNAVAILABLE` sentinel and every readiness verdict stays `"Insufficient verified data"`.
- **Unsupported rental yield or investment claims** — `investmentInformation`/`rentalInformation` are hardcoded empty at the canonical-record layer; nothing downstream can compute a claim from an empty array.
- **Assumed construction status** — `constructionProgress: []`; field renders as absent.
- **Assumed ownership type** — `ownershipType: ""`; field renders as absent.
- **Fallback media from another project** — explicitly removed platform-wide per FOREVER-TRUTH-001A (`project-service.ts` comment: "a missing photo must stay missing rather than silently become another project's photograph"); Coralina's demo-preview adapter goes further and zeroes all media rather than risk a repo-relative path leaking.
- **Stale or unexplained prices** — the one staleness issue found (Part B #4/#5) is fully explained, diffed, and reviewed (`version-diff.json`, zero price changes) — it is a pending reconciliation, not an unexplained discrepancy.
- **Private paths or source locations** — no runtime UI path was found that renders `forever-data/...` source paths to the public; those paths exist only in build-time JSON artifacts (`coralina-facts.ts` provenance metadata), which is normal for an internal audit trail as long as it is never bundled into a public response. Worth a final check at build/bundle time if a debug view is ever added (see Part D).
- **Contact-data leakage** — none found; `ContactForm`'s only DEV-only notice contains no internal data.
- **Seeded-project contamination** — Coralina is not one of the six `KNOWN_FICTITIOUS_PROJECT_SLUGS`; `public-truth.test.ts` regex-scans all of `src/` for forbidden fictitious names/slugs and passes.
- **Duplicate Coralina records or routes** — three independent layers guard this: DB `UNIQUE` constraint on `projects.slug`, import-time collision-inspector blocking on `duplicate_target_rows`, and payload-internal `findDuplicateEntities`/`validateNoDuplicateEntities` checks, all covered by passing tests.

**One item worth flagging, not fixing:** `src/features/advisory/tests/*` use an unrelated fixture literally named `"Coralina"` with slug `"coralina-layan"` for generic comparison/ranking tests. It never touches the real `proj_coralina` data path and poses no current risk, but the shared display name is a latent naming-collision risk if a real "Coralina Layan" product or copy-pasted seed data is ever introduced later. Recommend renaming the fixture in a future, low-priority cleanup — not blocking, not attempted on this branch (out of narrow scope, and touching shared advisory test fixtures carries more blast radius than benefit for a documentation-only readiness audit).

---

## Part D — User and Commercial Experience (real Phuket buyer's perspective)

**Required before first publication:**
- Resolve the media-hosting blocker (Part B #11-13) — a listing with zero photos, no brochure, and no master plan is not commercially viable regardless of how honest the "hide, don't fabricate" behavior is.
- Reconcile the unit/price snapshot to 2026-07-17 (Part B #4/#5) so availability is current at go-live.
- Owner decision on ownership/tenure and construction-status disclosure (Part B #7/#8) — a serious buyer evaluating a pre-completion Thai project will look for both within the first few seconds.

**Valuable immediately after publication:**
- Source coordinates for a map pin — currently null; `ProjectHero`/detail page presumably support a map, and Kamala buyers commonly compare projects by beach distance (Discovery already has a "beach distance" filter).
- Source construction/completion status once available from the developer, to unlock the currently-suppressed trust/investment sections without any code change (the gating is fully evidence-driven already).
- Confirm and record media rights/attribution (Part B #20) so the images can be used confidently in marketing beyond the project page itself.

**Future catalogue-scale improvement (not Coralina-specific, do not build now):**
- A platform-wide media-rights/attribution schema field (currently doesn't exist for any project, not just Coralina).
- Formal unit-to-masterplan spatial linkage (interactive "click a unit on the plan") — would require OCR/geometry work across the whole catalogue, not just Coralina.
- A generic, schema-driven "no unsupported claim" guard to replace the current fixed 12-column/6-slug allowlist in `public-truth.ts`, so future imports don't need a new named column to be covered.

No broad redesign, new scoring engine, marketplace, or CRM work is proposed, per the audit's explicit constraints.

---

## Part E — Implementation

**No code change was made on this branch.** The audit did not find a defect that is simultaneously (a) a clear repository defect, (b) independent of PR #96, (c) safe, (d) source-backed, (e) non-production, and (f) narrowly required for Coralina readiness. Every gap identified is one of:

- A legitimate, evidence-driven behavior working as designed (hide-don't-fabricate), which is correct and should not be changed;
- A data-lifecycle decision (price-list reconciliation) that changes material commercial facts and therefore warrants explicit human/Owner execution rather than a silent automated merge;
- An infrastructure gap (media hosting) that is out of scope for a narrow, non-production code fix; or
- A genuine Owner judgment call (tenure/construction disclosure, media rights) that only the Owner can resolve.

This is therefore a **documentation-only readiness PR**, adding only this report.

---

## Exact Publication Blockers (must be resolved before go-live)

1. **No live database row exists for Coralina.** Requires an Owner-authorized import execution (out of this audit's authority and not attempted).
2. **Media/document hosting pipeline gap.** The progressive-ingestion RPC has no stable storage URL for any of the 343 classified Coralina files, so the payload carries 0 media/document rows by design. Without resolving this, Coralina would publish with no gallery, brochure, master plan, or floor plans.
3. **Stale unit/price snapshot.** Canonical `extracted/price-list.json` / `progressive/payload.json` reflect 2026-07-03; a fully reviewed 2026-07-17 update (0 blocking issues, 0 price changes, +1/−1 unit availability) has not been merged in.

## Exact Owner Decisions Required

1. Publish with construction/completion status undisclosed, or require sourcing it first?
2. Publish with ownership/tenure (freehold/leasehold) undisclosed, or require sourcing it first?
3. Confirm Forever's commercial rights to publish the developer-supplied brochure/masterplan/photo/video assets before they go live.
4. Approve the specific mechanism and timing for merging the 2026-07-17 price-list update into the canonical payload (who signs off on the CKD508/CKF406 availability change).

## Required Pre-Publication Corrections

- Merge the reviewed 2026-07-17 price-list update into `extracted/price-list.json` and regenerate `progressive/payload.json` via `scripts/coralina/generate-progressive-payload.mjs`, after Owner sign-off on the availability delta.
- Stand up a stable storage path (e.g., object storage bucket + CDN URL) for Coralina's classified media/documents so a re-generated payload can carry non-zero media/document rows.

## Optional Post-Publication Enrichment

- Coordinates for map display.
- Construction/completion status once sourced (fully automatic once evidence exists — no code change needed, gating is already evidence-driven).
- Formal media-rights/attribution metadata (platform-wide schema addition).
- Unit-to-masterplan spatial linkage.

## Proposed First-Publication Checklist

1. Owner resolves the four decisions above.
2. Media hosting path stood up; Coralina media/documents re-processed through the import with stable URLs.
3. Price-list reconciled to the latest reviewed snapshot.
4. Owner-authorized import executed against the target database (`create` mode → `public_status='draft'`, `is_active=true`).
5. Post-import spot check: confirm unit/price/media counts match the reconciled payload; confirm no warnings remain unaddressed that the Owner hasn't explicitly accepted.
6. `setProjectPublication(slug: "coralina", { publish: true })` executed by an authorized operator.
7. Immediately verify in production: `/projects/coralina` renders correctly, `/projects` catalogue includes it, `sitemap.xml` includes it, Discovery search/area filter finds it, contact CTA submits a lead correctly.
8. Spot-check on a real mobile device in addition to desktop.

## Validation Plan (for any future code change made to close these gaps)

- Run the Coralina-scoped suite: `npx vitest run src/features/coralina-integration` (currently 10 files / 50 tests, all passing).
- Run the adjacent safety-mechanism suite: `npx vitest run src/lib/public-truth.test.ts src/lib/project-service.test.ts src/lib/production-cleanup-plan.test.ts src/import/collision-inspector.test.ts src/features/coralina-knowledge` (currently 12 files / 164 tests, all passing).
- Run the full suite (`npm run test`), `npx tsc --noEmit` (no dedicated `typecheck` script exists in `package.json`), `npm run lint`, and `npx prettier --check .` before merging any code change.
- Re-run `orchestrator.test.ts -t "unpublish"` to reconfirm the rollback path after any change to the publication service.

## Rollback / Unpublish Plan

If a problem is found after publication, call `setProjectPublication(deps, actor, { slug: "coralina", publish: false })` (`src/features/forever-studio/server/service.ts:1035-1054`) — this flips `public_status` back to `draft`, is logged as an audit event (`studio_project_unpublished`), and is backed by Postgres RLS (`is_active=true AND public_status='published'` required for any public read) as defense in depth even if the application-layer call were somehow skipped. This is a generic, already-tested mechanism (`orchestrator.test.ts`: "supports explicit unpublish and republish") — no Coralina-specific rollback code is needed. Do **not** use the `FOREVER_TRUTH_001A_PRODUCTION_CLEANUP_PLAN.md` mechanism for this — it is scoped exclusively to the six known-fictitious seed slugs and explicitly excludes Coralina.

## Confirmation

This audit was performed entirely against the committed repository state in an isolated git worktree (`C:\forever-claude-coralina`, branch `claude/coralina-publication-readiness`). No production system, database, or Coralina/Rainpalm publication state was accessed, queried, migrated, or changed. No file listed as off-limits in the task instructions, and no file touched by PR #96, was modified. `npm install` was run in the isolated worktree only, to make `npx vitest` runnable; it materializes the gitignored `node_modules/` from the existing `package-lock.json` and touches no tracked file.

---

CORALINA READINESS AUDIT COMPLETE — READY FOR OWNER REVIEW — UNPUBLISHED
