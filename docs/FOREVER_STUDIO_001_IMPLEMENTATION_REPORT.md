# FOREVER-STUDIO-001 — Implementation Report

Status: Implemented and hardened in an open, unmerged draft PR (#95); pending independent review and Owner approval. Not merged. No migration applied by this task; no production connection.
Base commit: `50a79ad8e3584dc6d5569d3979c162fbd81b537e` (authoritative main)
Branch: `claude/forever-studio-upload-dfev75`
Date: 2026-07-21

## What Forever Studio is

An authenticated, mobile-first web tool through which the Owner and invited
Trusted Publishers add real projects and resale listings by uploading the
materials they have — brochures, price lists, plans, ZIP archives, photos,
videos, structured JSON, and a few typed facts. Forever extracts what it
safely can, creates or updates the record, and publishes the public page
immediately.

Durable product rule (recorded in `docs/DECISIONS.md`):

> An upload by Owner or Trusted Publisher is direct publication
> authorization. Incomplete business data never creates a follow-on approval
> or publication gate.

This rule removes business-completeness blockers only. It does **not** permit
insecure authentication, cross-project corruption, credential exposure, or
silent loss of uploaded files — those are enforced and tested at the
server/data boundary.

## Architecture

**TanStack Start server functions + Supabase Auth + a server-managed
`studio_members` role table, orchestrating the existing progressive ingestion
lane through new additive, atomic, service-role-only SQL transaction
functions.**

The app deploys to **Cloudflare Workers** (`cloudflare-module`,
`nodejs_compat`). That runtime has no subprocess and no writable filesystem
and is memory-limited, which shapes three decisions: (1) SIP price-list PDF
extraction runs only where a subprocess exists (local/self-hosted) and
otherwise degrades to private retention + a warning; (2) large media are never
buffered — their size comes from storage metadata and they are published by a
server-side copy; (3) durable processing is claim-based so a dashboard poll or
a scheduled worker can drive it.

Studio adds one narrow orchestration layer and reuses — never reimplements —
`buildProgressiveBatch`, provenance precedence, dependency resolution,
`fetchExistingProjectState`, `buildListingDraft`, Fast Intake classification
and sanitization, SIP, and the atomic `forever_progressive_ingest` RPC. No
second intake or project database architecture.

### Alternatives considered and rejected

1. Browser-side writes with per-role RLS — spreads write authorization across
   ~20 tables and risks cross-project corruption. Rejected.
2. Supabase Edge Functions — a second runtime while the ingestion code already
   lives in the app server. Rejected.
3. Reusing the strict RC5.5D approval/receipt lane — it is exactly the gate the
   product rule forbids. Left untouched.
4. Extending the CLI/PowerShell importer UX — publishers must never need a
   terminal. Its RPC is reused; its UX is not.

## Corrective hardening (PR #95 review round)

Every item below was independently verified and corrected, with regression and
real-database tests added.

1. **Private contact isolation.** `listings.contact_name/phone/email` are
   removed from the public row and relocated (non-destructively) into a new
   private `studio_listing_contacts` table (RLS on, no policies, service-role
   only). The anonymous reader selects no contact columns; `/resale/$slug`
   routes every enquiry through Forever `/contact`. Studio can view/edit
   contacts privately.
2. **Atomic create + publish.** The former two-RPC sequence (create, then a
   publish patch) is replaced by one service-role-only SQL function
   `studio_publish_project` that claims the job, composes the unchanged
   `forever_progressive_ingest`, applies the authorized `published` state, and
   finalizes the job — all in one transaction. Any failure rolls the whole
   operation back (no project, children, batch, or public page survive a
   partial run). Real-PG tested.
3. **Concurrency-safe claiming.** `studio_claim_job` is a database
   compare-and-set with a `processing_token` and stale-claim recovery: exactly
   one worker processes a job; a request that dies mid-claim is recoverable
   after `processing_started_at` goes stale; a published job is never
   reprocessed. `studio_publish_resale` gives each listing a deterministic
   per-job slug so two concurrent calls converge on one listing.
4. **Private staging for every file.** Every upload lands in the private
   `studio-uploads` bucket. Only selected, byte-verified final media are copied
   (server-side, no buffering) to public buckets on deterministic immutable
   paths during finalization; a failed job exposes no public object (copies are
   cleaned up), and raw PDFs, ZIPs, price lists, legal files, and unselected
   media stay private.
5. **Actual-byte verification.** Observed size (from storage metadata), SHA-256
   (for bounded files), magic-byte media class, and declared-vs-observed
   mismatch are recorded per file. Separate limits bound upload size (1 GiB),
   server parse (20 MiB), archive expansion (100 MiB), and hashing (25 MiB).
   Forged media declarations (extension says image, bytes disagree) are refused
   and retained privately; duplicate content is skipped; oversized business
   files are retained, never blocking; large media are never downloaded.
6. **No business-identity blocker.** The required project-name attribute is
   removed. A stable identity is derived from facts, an uploaded project-facts
   file, or a deterministic `new-project-<date>-<job8>` fallback — never a
   random duplicate on retry; the source stays attached; renaming is a later
   edit.
7. **Automatic durable resume.** `resumeDueJobs` (called on each dashboard poll
   and safe for a Cloudflare Cron Trigger / worker) claims and completes
   received, retryable-failed, and stale-processing jobs. Closing the phone
   browser or losing the network never loses work or requires a second
   publication decision; no duplicate publication occurs. Manual Retry remains
   an emergency fallback.
8. **History preservation.** `studio_upload_jobs.created_by` is now nullable
   with `ON DELETE SET NULL`, plus a retained `creator_email`/`creator_role`
   snapshot; deleting an auth account never cascade-deletes Studio history.
9. **Truthful provenance.** An ordinary Owner entry is `owner_provided` and a
   Trusted Publisher entry `trusted_publisher_provided` (new statuses).
   `owner_verified` is reserved for an explicit future verification action; a
   publisher can never overwrite an Owner value; ordinary Studio input never
   sets `forever_verified` and never yields a public "Forever Verified" claim.
10. **Hardened auth/invites.** Bootstrap is database-enforced single-winner
    (advisory lock + partial unique index) and prefers a stable
    `STUDIO_OWNER_USER_ID` or a confirmed-email match. Invitations support an
    existing Supabase Auth account (no password) via a scoped
    `studio_lookup_auth_user_id` lookup; passwords are never displayed, logged,
    or persisted; public self-registration stays impossible; disable is
    immediate.
11. **Sanitized errors.** Users and job records only ever see a stable safe
    code, a concise message, and a retryability flag; raw database/filesystem/
    SQL/path text is redacted from server logs and never surfaced.
12. **Daily UX.** Edit forms are prefilled with current values, show which
    values are public, and let the Owner pick the hero image; the dashboard
    shows live processing state and auto-resumes; source date and last update
    are shown; all fields stay optional; Open/Share/Update/Unpublish remain.
13. **Migration truth.** `20260718113000_progressive_ingestion_v1.sql` is
    already applied (Coralina is imported as an unpublished draft); this task
    corrects every statement that said otherwise. Only the additive Studio
    migration is pending; Codex performs a read-only live-schema check before
    it is applied; no migration was applied here.

## Migration (the single PENDING Studio migration)

`supabase/migrations/20260721120000_forever_studio_v1.sql` — additive over the
already-applied progressive migration; not applied by this task. It creates:

- `studio_members`, `studio_upload_jobs`, `studio_listing_contacts` (all RLS
  on, no policies, service-role only); `created_by` SET NULL; a single-owner
  partial unique index; the private `studio-uploads` bucket.
- Functions `studio_bootstrap_owner`, `studio_claim_job`, `studio_fail_job`,
  `studio_publish_project`, `studio_publish_resale`, `studio_lookup_auth_user_id`
  — every one `SET search_path=''` and granted EXECUTE to `service_role` only.
- Non-destructive relocation of any listing contact data into the private
  table, then removal of the public contact columns.

It re-runs no prior migration, touches nothing under
`forever_import`/`forever_execution`, and adds no approval/readiness/review/
confirmation objects. Contract pinned by
`src/features/forever-studio/tests/migration-contract.test.ts`.

## Validation completed (this environment)

- **Focused Studio suite — 78 tests, all passing**
  (`src/features/forever-studio/tests/`): authorization (17), orchestrator (18,
  incl. the committed Coralina 8/198/198 proof and the incomplete Rainpalm
  21-unit/9-price proof, atomic rollback before and after graph insertion,
  single-winner concurrent claim, idempotent retry, staging-path and
  no-name/no-slug proofs), resale + private contact (8), staging + byte
  verification (7), automatic resume (5), error sanitization (4), migration
  contract (13), bundle boundary (6).
- **Real PostgreSQL — the COMPLETE committed migration chain** (all
  `supabase/migrations/*.sql` in order, incl. the strict lane and the applied
  progressive migration) applies cleanly to a disposable PostgreSQL 16.13
  cluster via `scripts/studio/run-postgres-tests.mjs`
  (`npm run studio:pg-test`), and the behavioral suite
  `src/features/forever-studio/tests/studio.postgres.sql` passes: internal-only
  RLS/grants, service-role-only functions, private-contact schema isolation,
  single-winner bootstrap (+ partial-unique-index guard), concurrency-safe
  claim + stale recovery, atomic publish rollback (no project/child/batch),
  idempotent create+publish+replay, resale idempotency + private contact,
  anon visibility of only published rows, cross-project isolation, and audit
  preservation after auth-user deletion. (Local PostgreSQL is 16.13; production
  is 17.6 — the SQL uses no 17-only features, but a 17.6 rehearsal remains an
  Owner/Codex step.)
- **Full repository suite:** run with `npx vitest run`. All suites pass except
  the two that already fail at the base commit `50a79ad` in this environment
  (`src/import/importer-preflight.test.ts`,
  `src/features/project-detail/partner-demo-data.test.ts`) because they import
  real Owner source binaries not committed to the repository (Modeva brochure/
  price-list, Coralina dossier). Unrelated to and unchanged by this PR. Exact
  totals are reported in the PR description.
- **TypeScript:** clean except the same pre-existing missing-Modeva-file error
  in `partner-demo-data.ts`.
- **ESLint / Prettier:** clean on all new/changed Studio files (the repository
  baseline carries pre-existing formatting errors this PR does not touch).
- **Production build:** succeeds; client-asset scan of `.output/public` shows
  zero occurrences of `SUPABASE_SERVICE_ROLE_KEY`, `service_role`,
  `studio_members`, `studio_publish`, or `forever_progressive_ingest`, and no
  contact-column identifiers.

## Success-target measurement

Manual JSON / SQL / terminal / extra approval for the publisher: zero by
construction (asserted). The 2–5-minute and 15-minute targets and real phone
camera/file-picker behavior need a real-device pilot to be measured honestly.

## Remaining work (Owner / Codex / deployment — not performed here)

1. **Codex live-schema check, then apply the single pending Studio migration**
   `20260721120000_forever_studio_v1.sql`. Do NOT re-apply the progressive
   migration — it is already applied.
2. **Environment:** set server-side `SUPABASE_SERVICE_ROLE_KEY`,
   `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and either `STUDIO_OWNER_USER_ID`
   (preferred) or `STUDIO_OWNER_EMAIL`; sign in once to bootstrap the Owner;
   optionally disable public sign-ups in the Supabase dashboard.
3. **Durable background execution:** the poll-driven resume is the working
   default on Cloudflare Workers. For fully unattended completion without an
   open dashboard, wire a Cloudflare Cron Trigger (or an external worker) to
   call the resume entry point; the claim contract is transport-independent.
4. **Type regeneration:** regenerate `src/integrations/supabase/types.ts` after
   the migration applies and tighten the deliberately untyped data-access casts.
5. **Real-device + PostgreSQL 17.6 pilot:** interaction-time targets, camera/
   file-picker behavior, real PDF price lists through server-side SIP (needs
   `pdftotext` on a self-hosted host — the Worker retains + warns), large-video
   upload, and a 17.6 migration rehearsal.
6. **Coralina / Rainpalm production publication** — explicitly NOT done and not
   authorized by this PR.

## Risks and deliberate limitations

- SIP extraction is unavailable on the deployed Worker (no subprocess);
  price-list PDFs are retained privately with a warning there.
- `processUploadJob` runs synchronously within one request; very large dossiers
  may need the cron/worker resume path — the job record makes that safe and
  idempotent.
- A copied-but-orphaned public object can exist briefly after a crash between
  copy and cleanup; deterministic job-scoped paths make retry overwrite it, and
  a periodic sweep of non-published jobs is the documented retention policy.
- Any authorized upload publishes (per the rule); Unpublish is one tap.
- `deps.server.ts` talks to PostgREST untyped until types are regenerated.

## Confirmations

- No production connection occurred; no production credentials were used.
- No migration was applied; no production data was mutated.
- Coralina and Rainpalm were not published (in production or anywhere).
- No real lead was created or changed; no Telegram authentication occurred.
- Partner Demo and the public truth boundary are preserved (tested).
- Factory remains A0 — Propose only.
