# FOREVER-STUDIO-001 — Implementation Report

Status: Implemented and hardened in an open, unmerged draft PR (#95); pending independent Codex audit and Owner approval. Not merged. No migration applied by this task; no production connection.
Base commit: `50a79ad8e3584dc6d5569d3979c162fbd81b537e` (authoritative main)
Branch: `claude/forever-studio-upload-dfev75`
Date: 2026-07-21 (final author-side hardening pass applied the same day)

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
5. **Actual-byte verification.** EVERY stored file within the 1 GiB ceiling is
   streamed once through SHA-256: exact server-observed byte count, full
   digest, and a magic-byte media class from the actual bytes — for large
   photos and videos too, without ever buffering an object whole. Forged media
   declarations (extension says image/video, bytes disagree) are refused and
   retained privately regardless of size; forged declared sizes are recorded
   as mismatches with a warning; duplicate content is skipped at any size;
   oversized files are retained, never blocking. Separate limits bound upload
   size (1 GiB), server parse (20 MiB), and archive expansion (100 MiB).
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
    corrects every statement that said otherwise. Only the Studio migration is
    pending; Codex performs a read-only live-schema check before it is
    applied; no migration was applied here.

## Final author-side hardening (third commit)

An independent re-review of the actual PR diff confirmed nine remaining
defects; every one is corrected in this pass, with behavioral regressions and
real-database coverage. No architecture change — the same one-Studio,
server-boundary, direct-publication design.

1. **Large-file integrity no longer depends on the extension.** Previously
   media above 25 MiB was classified by filename and copied public unverified.
   Now every stored object is streamed once (bounded memory) for its full
   SHA-256, exact byte count, and magic-byte class; only byte-verified media
   publish, at any size. `ftyp` containers are classified by brand: HEIC/HEIF
   (`heic/heix/mif1/msf1/…`) and AVIF are images, the MP4/MOV/3GP families are
   video, and an UNKNOWN `ftyp` brand is `other` — retained privately, never
   published, never blocking. `.heif` was added to the intake classifier's
   image extensions.
2. **The ZIP path now uses the complete safety contract.** The previous code
   called only the low-level entry reader (name safety + CRC), skipping the
   entry-SET validation. `server/archive.ts` now runs the full Fast Intake
   contract before ANY expansion — archive size, entry count, per-entry and
   total expanded budgets, compression ratio, traversal/absolute/drive/UNC,
   Windows reserved names, symlinks, encryption, ZIP64, unsupported methods,
   duplicate + case-insensitive and file/directory collisions — then streams
   entries ONE at a time (CRC + declared size verified) instead of
   materializing the whole expansion. Studio limits: 100 MiB archive, 300
   entries, 50 MiB/entry, 500 MiB total, ratio 200. A rejected archive
   expands nothing, stays privately retained, and never blocks the job's
   other materials. Regressions include a GENUINE deflate zip bomb and an
   excessive-total-expansion archive against the production code path.
3. **Storage side effects are claim-scoped.** Public media paths embed the
   processing-claim token (`studio/<job>/<attempt>/NN-name`), so a stale
   worker can never overwrite or delete a newer claim's objects; job file
   metadata updates are compare-and-set on the claim token; failure cleanup
   is grouped per bucket (photos and documents live in different public
   buckets); after commit the winner sweeps other attempts' orphans, a losing
   worker removes only its own copies, and the recorded winning attempt
   protects committed media even if a publish response is lost in transit. A
   worker that crashes between the public copy and the database commit leaves
   orphans only under its own dead prefix — removed by the next successful
   attempt's sweep (deterministic cleanup), and consisting only of
   publication-authorized media, never private data.
4. **Audit failure cannot invalidate a committed publication.** All audit
   writes are post-commit and non-fatal: on failure the redacted diagnostic
   goes to protected server logs and the user-visible result remains success;
   nothing is rolled back, deleted, or retried as unpublished. Regression:
   audit outage after commit for both project and resale publication.
5. **Resale editing obeys provenance precedence.** `updateResaleListing` now
   applies the same `canReplaceField` rule as project enrichment: blanks fill,
   equal-or-weaker values update, but a Trusted Publisher can never silently
   replace `owner_provided` (or stronger) values — the stronger value is
   preserved, and a truthful `listing_field_conflict_preserved` record is
   returned to the editor AND persisted in `ingestion_warnings`. No approval
   gate. Owner input continues to outrank publisher input.
6. **Publisher operational history is isolated at the data boundary.**
   `getOverview` returns only the caller's own jobs to a Trusted Publisher —
   another publisher's job ids, creator emails, errors, and staging metadata
   never leave the server. The Owner continues to see everything.
7. **Every Studio endpoint uses the safe error envelope.** All 13 server
   functions and the membership middleware run inside `runStudioEndpoint`:
   access/Studio errors pass through with their stable safe codes; any other
   failure is logged redacted and crosses to the browser only as
   `studio_request_failed` with a concise safe message.
8. **Terminal failures and lease safety.** `studio_claim_job` now refuses
   `retryable = false` jobs (in exact agreement with the resume query), and a
   new token-guarded `studio_heartbeat_job` lets a live worker refresh its
   lease between files/entries (`HEARTBEAT_SECONDS`), so legitimate long
   processing is never mistaken for death while a silent worker still goes
   stale. Proven at the database: a fresh or heartbeaten lease cannot be
   stolen; a stale lease is recoverable; a non-retryable job is not; a stale
   worker cannot finalize or heartbeat after losing its lease.
9. **Migration and rollback truth.** The Studio migration header now states
   exactly what is purely additive and what is the one relocation + column
   drop, the preservation sequence, the Codex read-only pre-apply checklist,
   and the apply order; the DOWN section is explicitly a reference, NOT a
   complete automatic rollback, with the exact contact-restoration order that
   must precede any destructive drop. The already-applied progressive
   migration was not touched; no migration was applied.

## Migration (the single PENDING Studio migration)

`supabase/migrations/20260721120000_forever_studio_v1.sql` — layers on the
already-applied progressive migration; not applied by this task. Exact truth:

- **Purely additive:** `studio_members`, `studio_upload_jobs`,
  `studio_listing_contacts` (all RLS on, no policies, service-role only);
  `created_by` SET NULL; a single-owner partial unique index; the private
  `studio-uploads` bucket row; and the functions `studio_bootstrap_owner`,
  `studio_claim_job`, `studio_heartbeat_job`, `studio_fail_job`,
  `studio_publish_project`, `studio_publish_resale`,
  `studio_lookup_auth_user_id` — every one `SET search_path=''` and granted
  EXECUTE to `service_role` only.
- **The one non-additive step:** existing `listings.contact_*` values are
  first COPIED into the private table, then the three public contact columns
  are DROPPED — both inside the migration's single transaction. Existing
  contact data is preserved in the private table (expected relocated rows:
  zero, since Studio — their only writer — is unshipped; the copy runs first
  regardless).
- **Rollback:** the in-file DOWN section is a reference, NOT a complete
  automatic rollback. If rollback were ever required, private contacts must
  be restored first (re-add the columns, copy back from
  `studio_listing_contacts`) before any destructive drop — the exact order is
  documented in the migration file, along with the fact that restoring them
  re-exposes private data and therefore needs an explicit Owner decision.
- **Codex pre-apply check (read-only), documented in the file:** migration
  history contains `20260718113000` and not `20260721120000`;
  `forever_progressive_ingest` exists; no `studio_*` objects exist yet;
  whether `listings.contact_*` holds any non-NULL data. Apply this file
  alone; never re-apply the progressive migration.

It re-runs no prior migration, touches nothing under
`forever_import`/`forever_execution`, and adds no approval/readiness/review/
confirmation objects. Contract pinned by
`src/features/forever-studio/tests/migration-contract.test.ts`.

## Validation completed (this environment)

- **Focused Studio suite — 119 tests across 11 files, all passing**
  (`src/features/forever-studio/tests/`): authorization + cross-publisher job
  isolation (19), orchestrator (19, incl. the committed Coralina 8/198/198
  proof, the incomplete Rainpalm 21-unit/9-price proof, atomic rollback
  before and after graph insertion, single-winner concurrent claim,
  idempotent retry, no-name/no-slug proofs, and rejected-archive
  non-blocking), staging + byte verification incl. streaming SHA-256, forged
  sizes, HEIC/HEIF/MOV brands, and large disguised media (14), REAL ZIP
  safety contract incl. a genuine zip bomb and excessive total expansion
  (12), resale + private contact + provenance precedence (11),
  storage-concurrency + audit-outage + lease behavior (8), bundle boundary
  (6), automatic resume (5), endpoint safe-error envelope (5), error
  sanitization (4), migration contract (16).
- **Real PostgreSQL — the COMPLETE committed migration chain** (all
  `supabase/migrations/*.sql` in order, incl. the strict lane and the applied
  progressive migration) applies cleanly to a disposable PostgreSQL 16.13
  cluster via `scripts/studio/run-postgres-tests.mjs`
  (`npm run studio:pg-test`), and the behavioral suite
  `src/features/forever-studio/tests/studio.postgres.sql` passes: internal-only
  RLS/grants, service-role-only functions, private-contact schema isolation,
  single-winner bootstrap (+ partial-unique-index guard), concurrency-safe
  claim + stale recovery, lease heartbeat (fresh lease cannot be stolen;
  stale worker cannot heartbeat or finalize), terminal `retryable=false`
  exclusion, atomic publish rollback (no project/child/batch), idempotent
  create+publish+replay, resale idempotency + private contact, anon
  visibility of only published rows, cross-project isolation, and audit
  preservation after auth-user deletion. (Local PostgreSQL is 16.13;
  production is 17.6 — the SQL uses no 17-only features, but a 17.6 rehearsal
  remains an Owner/Codex step. Provenance-precedence conflicts are enforced
  in the shared batch builder and are covered by the behavioral suites.)
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
  may need the cron/worker resume path — the job record and the lease
  heartbeat make that safe and idempotent.
- Orphaned public objects: an attempt that crashes between its public copy and
  the database commit leaves objects only under its own token-scoped prefix.
  They are removed by that worker's own failure path, by a losing worker's
  self-cleanup, or by the next successful attempt's post-commit sweep. The
  residual case — a hard-crashed attempt on a job that never succeeds again —
  can leave publication-authorized media files (never private data) under a
  dead prefix; they are inert, unreferenced, and removable by the documented
  sweep. We do NOT claim zero public orphans in every crash interleaving.
- Any authorized upload publishes (per the rule); Unpublish is one tap.
- `deps.server.ts` talks to PostgREST untyped until types are regenerated.
- The streaming hash relies on `Blob.stream()` (standard on Workers and Node
  18+); if a runtime lacked it, files above the bounded fallback would be
  retained privately rather than published unverified (fail closed).

## Confirmations

- No production connection occurred; no production credentials were used.
- No migration was applied; no production data was mutated.
- Coralina and Rainpalm were not published (in production or anywhere).
- No real lead was created or changed; no Telegram authentication occurred.
- Partner Demo and the public truth boundary are preserved (tested).
- Factory remains A0 — Propose only.
