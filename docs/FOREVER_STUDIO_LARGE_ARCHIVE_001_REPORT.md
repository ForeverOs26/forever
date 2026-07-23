# FOREVER-STUDIO-LARGE-ARCHIVE-001 — Implementation Report

Branch: `claude/forever-studio-large-archive-001` · Base: `8d173db` (post-PR-99 main)
Status: **implemented, fully validated locally, Draft PR, migration unapplied, no deployment**

---

## 1. Executive verdict

Forever Studio's 16 MiB synchronous ZIP ceiling is replaced by a production-shaped
**300 MiB-per-archive lane** built entirely on the existing stack — TanStack
Start/Nitro server functions, Supabase private Storage with signed upload URLs,
the existing `studio_upload_jobs` claim/heartbeat/stale-resume machinery, the
Fast-Intake ZIP safety contract, and the PR #99 media-truth pipeline. No new
service, queue, workflow engine, or paid dependency was required, and no new
runtime dependency was added.

The lane delivers the target operating contract:

- ZIP archives up to **300 MiB each**, several per upload job, up to **1 GiB of
  declared source material per job**;
- **resumable chunked upload** (8 MiB parts, each with its own short-lived
  signed URL) that survives unstable connections and re-planning resumes with
  only the missing parts — original bytes never transit the application server;
- server verification of every stored part (existence + exact size at
  confirmation, then streamed SHA-256 against the recorded claims) **before any
  expansion**;
- **bounded range-read ZIP processing** — the whole archive is never held in
  memory (proven: largest single storage read while processing a genuine
  288 MiB archive is one 8 MiB part);
- a **durable per-entry inventory** (`studio_archive_entries`) with
  claim-checked, pending-only settlement: retries are idempotent, one damaged
  entry never blocks the rest, and completion is derived from rows, not loops;
- **claim-scoped processing slices** that checkpoint and release, so the
  browser may close after upload acceptance and any signed-in Studio session's
  dashboard poll (or a future scheduled caller) continues the work;
- Media Truth intact: supported images publish as claims-stripped verified
  derivatives; video/HEIC/PDF/unknown entries are **truthfully retained
  privately**, never silently dropped, and original filenames / entry paths
  never cross the public boundary.

## 2. The previous 16 MiB limitation

`extraction.ts` capped archives at `MAX_ARCHIVE_BYTES = 16 MiB` and
`archive.ts`/`intake/zip.ts` required the **entire archive buffered in memory**
(central-directory parse over one `Buffer`) inside a single synchronous request
on a ~128 MiB Cloudflare Worker envelope, with per-entry/total expansion caps of
8/64 MiB. A 300 MiB ZIP uploaded fine (signed-URL PUT, ≤ 1 GiB) but was rejected
from expansion with `archive_too_large` and retained privately. Single-PUT
uploads also gave phones on unstable connections no resume path.

## 3. Chosen architecture

```
browser                       Worker (server functions)          Supabase
───────                       ─────────────────────────          ────────
slice ZIP into 8 MiB parts ─▶ plan: part manifest + signed ───▶  studio_archives row
upload part k ──────────────────────────────────────────────▶   private studio-uploads
  (retry per part; re-plan resumes missing parts)                jobs/{job}/parts/{archive}/{k}
confirm (per-part sha256) ─▶ verify existence + exact size ─▶    parts jsonb manifest
processJob ────────────────▶ SLICE loop under job claim:
                               • hash-verify parts (12/slice) ▶  checkpoint parts jsonb
                               • range-read EOCD+central dir,
                                 FULL safety contract, then  ▶   studio_archive_entries
                                 durable inventory insert         (one row per entry)
                               • route ≤24 entries / ≤64 MiB ▶   settle rows (pending-only,
                                 per slice, heartbeating          claim-checked)
                               • release claim ──────────────▶   status received (ready)
poll / dashboard / cron ────▶ next claim continues from rows
all archives terminal ──────▶ compose durable outcomes + ordinary files
                              → ONE atomic studio_publish_project txn
```

### Rejected alternatives

| Alternative | Why rejected |
|---|---|
| **Supabase TUS resumable upload** (`/upload/resumable`) | Requires user-JWT writes to `storage.objects` via new RLS policies, relaxing the repo's invariant that every storage write is server-issued-signed-URL or service-role; needs the `tus-js-client` dependency; not integration-testable in the disposable harness. Chunked signed-URL parts deliver the same resume granularity with the existing authorization boundary and zero new dependencies. |
| **Cloudflare Workflows / Queues** | New infrastructure + deploy-side configuration this repo cannot validate; the existing claim/heartbeat/stale-resume machinery already models durable, claimable background work. Evidence showed it needs only a slice-release primitive (`studio_release_job`) to continue promptly. |
| **Supabase Edge Function for processing** | A second runtime and credential surface; same memory problem unless the same range-read engine is built there; nothing it adds that slices don't. |
| **One long request with `waitUntil` chaining** | Worker CPU/time limits make a single 300 MiB pass unreliable; self-invoking fetch chains need an internal auth token and are fragile. Slices + durable checkpoints are strictly safer. |
| **Storage HTTP `Range` reads against one big object** | Would require a new authenticated raw-fetch path beside storage-js. Since the original always arrives as verified 8 MiB parts, mapping range reads onto part objects (`PartedArchiveSource`) gives bounded memory with the existing `downloadWithin` primitive and no new HTTP surface. |
| **Raising the 16 MiB constant** | The buffer-based reader + Worker envelope make it impossible; explicitly out of scope per the task. |

## 4. Upload contract

- `studioPlanArchiveUpload({jobId, fileName, declaredSize})` → validates ZIP
  name, ≤ 300 MiB, ≤ 8 archives/job, ≤ 1 GiB declared source per job; creates a
  `studio_archives` row (status `planned`, fixed `part_size = 8 MiB`,
  plan-order `ordinal`) and returns one signed target per part into the
  **private** `studio-uploads` bucket at
  `jobs/{jobId}/parts/{archiveId}/{00000}`. Re-planning the same
  `(fileName, declaredSize)` returns the **same archive** with `presentParts`
  (already stored with the exact planned size) and fresh targets only for
  missing parts — this is the resume path.
- Browser slices the `File`, uploads each part via
  `supabase.storage.uploadToSignedUrl` with per-part retry/backoff (4 attempts,
  exponential), computing per-part SHA-256 with Web Crypto.
- `studioConfirmArchiveUpload({jobId, archiveId, partSha256[]})` → server lists
  the stored part objects and accepts **only** when every part exists with
  exactly the planned size (final part = exact remainder). Wrong-sized objects
  are deleted and fresh targets returned. Acceptance records the per-part
  digest **claims**; the first processing slices then stream-hash every stored
  part and reject the archive (`archive_part_integrity_failed`, retained
  privately, nothing expanded) on any mismatch. Part 0 must carry ZIP magic
  bytes — filename/MIME/declared size are never trusted.
- Both endpoints run behind `requireStudioMember` + object-level job ownership
  + the known-project-target pre-authorization, inside the safe error envelope,
  and are audited (`studio_archive_planned` / `studio_archive_accepted`).

## 5. Processing / checkpoint model

Slices run **inside the existing job claim** (`studio_request_job_processing`
/ `studio_claim_job`, 15-minute stale window, 60 s heartbeat between parts and
entries). One `studioProcessJob` call advances one bounded slice:

1. **Verify** up to 12 unverified parts (8 MiB streamed hash each),
   checkpointing each into the archive's `parts` jsonb (claim-checked).
2. **Index**: bounded tail + central-directory range reads
   (`readZipDirectoryRanged`), the **complete** entry-set safety contract
   (`validateZipEntrySet` — traversal/absolute/drive/UNC names, Windows
   reserved names, symlinks, encryption, unsupported compression, ZIP64,
   duplicate and case-insensitive collisions, file/dir collisions,
   compression-ratio abuse — all archive-fatal, fail-closed, nothing expands),
   then an idempotent claim-checked insert of one durable row per file entry
   (`ON CONFLICT (archive_id, entry_index) DO NOTHING`).
3. **Route** up to 24 entries / 64 MiB expanded per slice, heartbeating between
   entries. Every entry ends in exactly one **claim-checked, pending-only**
   settlement (`studio_settle_archive_entry`) — the only transition out of
   `pending`, immutable afterwards. A stale worker's settle matches zero rows;
   it removes its own uploaded object and stops.
4. **Release**: with work remaining, `studio_release_job` returns the job to
   `received` (readiness preserved) so the *very next* poll claims and
   continues — no 15-minute stale wait. The uploader page polls
   `studioProcessJob` every 3 s while open; if closed, the existing dashboard
   poll (`studioResumePending`, any signed-in member, explicitly documented as
   cron-safe) continues the same durable work.

When every archive is terminal, the winning attempt composes materials from
the **durable rows** (deterministic order: archive `ordinal`, then
`entry_index`): published entries become the media batch (claims-stripped
media-truth projection only), adopted price list / facts merge with
first-archive-wins precedence (manual facts still outrank extracted ones), and
ordinary files flow through the unchanged `gatherMaterials` — seeded with the
settled entry digests so a file identical to an archive entry dedupes. One
atomic `studio_publish_project` / `studio_publish_resale` transaction commits,
exactly as before.

**Cleanup correctness under multi-attempt slices** (a behavior change to the
old sweep): entries published in earlier slices live under earlier claim
tokens' attempt prefixes, so the post-commit sweep now removes only objects
**not referenced** by the publication (winner's own uploads ∪ durable entry
objects) instead of "everything not under my prefix". Failure paths still
remove only the current attempt's unreferenced objects; committed publications
are never touched.

## 6. Data model (additive migration `20260724090000_studio_large_archive_v1.sql`)

- **`studio_archives`** — one row per uploaded ZIP: plan-order `ordinal`,
  private `file_name`, declared/observed sizes, fixed part geometry, `parts`
  jsonb manifest (≤ 38 items: size, declared + server digest, verified flag),
  `composite_sha256` (digest of ordered part digests — archive identity),
  lifecycle `status` (`planned → uploaded → verifying → indexed → completed`
  | `rejected`), `entry_count`, `total_uncompressed`, `extracted` jsonb
  (adopted sanitized price list / fact fields, ≤ 2 MiB), `error_code`.
- **`studio_archive_entries`** — the durable inventory: `(archive_id,
  entry_index)` unique, private `entry_name`, neutral `display_label`,
  classifier `category`, compressed/declared/observed sizes, verified
  `sha256`, magic-byte `media_class`, `state` (`pending | published_public |
  retained_private | skipped_duplicate | failed`), `outcome_code`, public
  bucket/path/url, media type, full private `media_truth` jsonb (claims
  allowed — the table is service-role only), settling `attempt`,
  `processed_at`.
- **Functions** (all claim-guarded in one transaction, service-role-only,
  `SET search_path = ''`): `studio_release_job`,
  `studio_update_archive_claimed` (whitelisted-field patch),
  `studio_index_archive_entries` (idempotent batch insert),
  `studio_settle_archive_entry` (pending-only), and read-only
  `studio_job_archive_entry_counts`.
- Both tables: RLS enabled, **zero policies**, all grants revoked except
  `service_role`; `ON DELETE CASCADE` from the job row only. No existing
  object is altered. Entry-level state deliberately lives in normalized rows —
  never an oversized JSON blob on the job row.

## 7. Archive and project limits (explicit budgets)

| Limit | Value | Rationale |
|---|---|---|
| Archive size | 300 MiB | product ceiling; also `maxArchiveBytes` of the ranged reader |
| Part size | 8 MiB fixed | resume granularity ≈ loss on interruption; bounded reads |
| Archives per job | 8 | keeps one job reviewable; more sessions are supported |
| Declared source per job | 1 GiB | initial product budget (files + archives) |
| Entries per archive | 2 000 | central directory stays ≤ 4 MiB cap |
| Central directory | 4 MiB | one bounded read |
| Per-entry expansion | 24 MiB (= media sanitize cap) | nothing larger can publish; larger entries are **per-entry retained**, never archive-fatal |
| Per-entry compressed read | 24 MiB | bounds one range read |
| Total expansion per archive | 1 GiB | 300 MiB source is not permission for unbounded output; beyond-budget entries retained privately |
| Compression ratio | 200× (>1 MiB entries) | zip-bomb indicator — archive-fatal |
| Slice budgets | 24 entries / 64 MiB expanded / 12 part hashes | checkpoint cadence ≪ stale window |
| Public media per job | 500 | page sanity; excess retained privately with warning |

Trade-off note: hostile indicators (traversal, collisions, encryption,
symlinks, bad method, ratio abuse, ZIP64) reject the **whole archive**
fail-closed; benign size overages (a 100 MB video inside the ZIP) settle **that
entry** as retained-private so the rest of the dossier still publishes. This
is the deliberate line between security semantics and product continuity.

## 8. Memory model

Peak processing memory per slice ≈ size-capped central directory (≤ 4 MiB) +
one cached part (8 MiB) + one compressed span (≤ 24 MiB, transient concat) +
one inflated entry (≤ 24 MiB) + one derivative (≤ 24 MiB) — comfortably inside
the ~128 MiB Worker envelope, independent of archive size. `PartedArchiveSource`
maps every range read onto individual stored parts via the existing bounded
`downloadWithin`; nothing ever requests more than one part from storage.
Measured (§11): processing a genuine 288 MiB archive grew process RSS by
**64–81 MiB peak** with the **largest single storage read = 8 MiB**.

## 9. Supported / unsupported entry behavior

| Entry | Outcome |
|---|---|
| Project-facts JSON | fields adopted source-backed (anti-fabrication rules unchanged), `project_facts_extracted`, file retained privately |
| Price-list JSON | sanitized via `sanitizePriceList`, first-archive-wins, later ones retained with truthful duplicate warnings |
| Price-list PDF | SIP extraction where a subprocess exists; on the Worker retained privately for later extraction (unchanged behavior) |
| JPEG / PNG / WebP media | PR #99 sanitize → verify → public derivative at token-scoped content-addressed path; full media-truth record stays on the private entry row; public metadata carries only the claims-stripped projection |
| Video, HEIC/HEIF, ICC-profiled, GIF/AVIF, PDFs-as-media | retained privately with per-family truthful warnings (`media_format_private`, `media_color_profile_unsupported`, …) |
| Duplicates (within job or vs the target project's existing media, by verified SHA-256) | deterministic `skipped_duplicate` |
| Corrupt entry (CRC/inflate) | that entry `failed` (`entry_integrity_failed`); everything else continues |
| Oversized entry / expansion budget exceeded | retained privately without expansion |
| Unknown documents | retained privately as source evidence |

Warnings are aggregated per outcome family (one line with a count — never
hundreds of rows) and never contain original filenames or entry paths.

## 10. Studio UX

`StudioUploader` now splits selection: ZIPs > 16 MiB take the chunked lane
(> 300 MiB refused up front with a clear message). Mobile-first panels show:

- per-archive upload progress: percentage, MB uploaded/total, part counter,
  a "connection hiccup — retrying" state, and the promise that retries resume
  from stored parts;
- after acceptance + the processing request: a **"You may close this page"**
  panel with live discovered/processed counts, per-archive status lines
  (verifying n/m parts → entries x/y → done / kept private), and
  public/private/duplicate/failed tallies from the durable rows
  (`studioGetJobProgress` serves the same public-safe projection anywhere);
- the existing result panel (open/share/edit) on publication; the existing
  retry affordance on failure. Ordinary uploads and small-ZIP behavior are
  unchanged, nothing requires pre-categorising files, and incomplete data
  still never blocks Owner-authorized publication.

## 11. Validation evidence (all local; fakes + disposable PostgreSQL)

New suites (49 new tests):

- `src/intake/tests/zip-ranged.test.ts` (12) — ranged reader ≡ buffer reader
  entry sets; sparse bounded reads (directory read touches < half the archive;
  one-entry read's largest range < 4 KiB); every hostile variant fail-closed;
  per-entry CRC isolation; short-read fail-closed.
- `large-archive-upload.test.ts` (9) — plan geometry/budgets, private-bucket
  targets, resume-by-replan, stored-size verification with wrong-size object
  removal, idempotent confirm, authorization denials, published-job refusal.
- `large-archive-processing.test.ts` (15) — mixed-archive end-to-end (facts +
  prices + media + video + unknown + duplicate), slice release between polls,
  browser-closed continuation via dashboard resume, crash → stale takeover →
  resume with settled outcomes untouched, idempotent post-publish retries,
  cross-archive and cross-job SHA-256 dedup, unsafe-archive fail-closed with
  the rest publishing, corrupt-entry isolation, tampered-part rejection,
  oversized-entry retention, upload-incomplete rejection, stale-token refusal
  on every claim-checked write, unreferenced-orphan sweep preserving
  multi-attempt entry objects, public-safe progress (no filenames anywhere).
- `large-archive-memory.test.ts` (2) — the 300 MiB proof and interruption
  resume.
- `large-archive-migration-contract.test.ts` (10) — static SQL posture.
- `studio.postgres.sql` +162 lines (LA-1…LA-5) — real-database RLS/grants,
  stale-token refusal, idempotent indexing, pending-only immutable settlement,
  release-preserves-readiness + immediate reclaim, job-delete cascade.

**Recorded measurements** (from the committed memory suite, this machine):

```
archive=288.0 MiB  parts=37  largestEntry=8 MiB  entries=39
totalExpanded=288.0 MiB  slices=8  storageDownloadCalls=51
largestSingleRead=8.0 MiB  peakRssGrowthDuringProcessing=64.5–81.1 MiB
interruption fixture: 13 parts / 12×8 MiB entries, worker killed after
slice 1 (12 parts verified, 0 entries), stale takeover after 16 min,
resumed and published in 3 further slices; zero re-processed outcomes
```

Proportional runs, all on this branch:

- **Full vitest**: 3 330 tests — every Studio, ZIP, upload/resume/concurrency,
  Media Truth, Project Detail and public-boundary suite passes. The only
  failures are the **pre-existing** ones unrelated to this change:
  3 × `src/import/importer-preflight.test.ts` (Coralina dry-run fixture drift,
  fails identically on unmodified code) and the known missing-`modeva`-asset
  environmental failures (`partner-demo-data`), documented in
  `AGENTS`/session notes as a fresh-worktree gotcha.
- **Disposable PostgreSQL harness** (`npm run studio:pg-test`, PostgreSQL 17):
  complete migration chain **including the new migration** + all behavioral
  assertions → `ALL STUDIO POSTGRES ASSERTIONS PASSED`.
- **TypeScript** `tsc --noEmit`: clean (after the documented local `modeva`
  placeholder scaffolding, which is untracked and not part of this PR).
- **ESLint**: clean on every file this PR touches. (Repo-wide `eslint .`
  carries pre-existing prettier-drift errors in ~90 untouched legacy files —
  e.g. `src/lib/database-types.ts`, unchanged since the initial commit; left
  alone to keep this diff reviewable.)
- **Prettier**: all touched TS/TSX files pass `--check`.
- **Build** (`npm run build`, Nitro → Cloudflare Workers): succeeds, emits
  `.output/server/wrangler.json`.
- `git diff --check`: clean. Secret/private-path scan of the diff: no
  credentials, keys, JWTs, or local paths; public projections and warnings
  carry neutral labels only.

## 12. Limitations (truthful)

- **Continuation requires a caller.** Work is durable and claimable, but on a
  serverless runtime somebody must invoke it: the uploader page while open,
  any member's dashboard poll, or a scheduled caller. A Cloudflare Cron
  Trigger hitting the documented cron-safe resume seam is the recommended ops
  follow-up (deploy-side config, out of scope here). Until then, a job whose
  browser closed completes on the next Studio visit.
- **Page-reload upload resume needs the same job.** Within a session, parts
  retry and re-planning resumes. After a full page reload the client currently
  starts a new job (new plan); stored parts of the abandoned job stay
  privately retained. A localStorage draft-job ledger is a small follow-up.
- **Per-project (cross-job) source budget** is enforced per job (1 GiB); a
  lifetime per-project quota needs a product decision on retention.
- **Cross-job dedup** relies on the target slug being known at processing time
  (all update workflows). A `new_development` upload that lands on an existing
  derived slug dedupes at compose time against existing media only via the
  progressive natural key.
- **ZIP64 (≥ 4 GiB or ≥ 65 535 entries) remains rejected** by design.
- Local tests prove logic and memory behavior, **not** real-network Supabase
  Storage throughput or Worker CPU accounting — that is the staging gate.

## 13. Migration state

`supabase/migrations/20260724090000_studio_large_archive_v1.sql` is
**additive, ordered after current main (`20260723130000`), and UNAPPLIED** to
any real environment. It runs in the disposable PostgreSQL chain only. The
PR #99 grant migration remains intentionally unapplied and untouched. No
staging or production database, storage, or credentials were accessed;
nothing was deployed.

## 14. Staging validation plan (explicit later gate)

1. Apply the migration chain to staging (Codex read-only pre-apply check as
   documented in the migration headers).
2. Real-device gate: phone on cellular uploads a genuine 100–300 MiB ZIP;
   kill the connection mid-part repeatedly; verify part-level resume and the
   accepted/verified transition.
3. Close the browser after acceptance; confirm dashboard-poll continuation and
   (if configured) cron continuation; measure slice wall-time and Worker CPU
   per slice against limits.
4. Verify published page media, private retention listing, warning aggregates,
   and that `studio-uploads` objects match the durable inventory.
5. Chaos pass: tamper a stored part via the dashboard, upload a hostile
   archive, and confirm fail-closed retention with truthful warnings.

## 15. Rollout / rollback

- **Rollout**: merge → apply migration to staging → staging gate above →
  apply to production → no feature flag needed (the lane activates only when
  a client sends a > 16 MiB ZIP; all existing flows are untouched).
- **Rollback**: revert the application commit — ordinary Studio remains fully
  functional (the lane is additive); large archives fall back to
  `archive_too_large` private retention exactly as before. The migration can
  stay applied (unused tables/functions are inert, service-role-only) or be
  dropped with the documented DOWN steps; no existing table or column is ever
  modified, so no data rollback exists to get wrong.

## 16. Access confirmation

**Staging and production were not accessed.** No deploy, no remote migration,
no real project publication, no credential use beyond the repo's local test
fixtures. Factory autonomy remains A0.
