# FOREVER-STUDIO-LARGE-ARCHIVE-001 — Implementation Report

Branch: `claude/forever-studio-large-archive-001` · Base: `8d173db` (post-PR-99 main)
Status: **implemented + architect-review corrective pass, fully validated locally, Draft PR, migration unapplied, no deployment**

> **Corrective pass (2026-07-24).** The first revision of this report
> overstated three things; this revision corrects the system and the words:
>
> 1. *"The browser may close and processing continues"* was only true while
>    an authenticated Studio session kept polling. It is now true without any
>    session: a **real scheduled runner** (Cloudflare Cron Trigger → the
>    Worker's `scheduled()` export → the `cloudflare:scheduled` Nitro hook)
>    is implemented and its deploy configuration is committed.
> 2. *"Accepted/verified"* conflated storage acceptance with verification.
>    The lifecycle now says exactly what has been proven: stored is never
>    called verified, and "byte verification passed" appears only after every
>    stored part has been hash-verified.
> 3. *"All unsupported entries retained privately"* previously meant "still
>    inside the original archive". Retained entries are now **independently
>    extracted into private, hash-verified evidence objects**, including
>    entries far above the in-memory cap (streamed, never buffered).

---

## 1. Executive verdict

Forever Studio's 16 MiB synchronous ZIP ceiling is replaced by a
production-shaped **300 MiB-per-archive lane** built entirely on the existing
stack — TanStack Start/Nitro server functions, Supabase private Storage with
signed upload URLs, the existing `studio_upload_jobs`
claim/heartbeat/stale-resume machinery, the Fast-Intake ZIP safety contract,
and the PR #99 media-truth pipeline — plus one Cloudflare **Cron Trigger** on
the same Worker (configuration committed, nothing deployed). No new service,
queue, workflow engine, or paid/native dependency was added.

The lane's operating contract, as now implemented and locally proven:

- ZIP archives up to **300 MiB each**, several per upload job, up to **1 GiB
  of declared source material per job**;
- **resumable chunked upload** (8 MiB parts, each with its own short-lived
  signed URL); resume identity is a **client upload fingerprint + exact
  size** — never the filename — so two different archives sharing a name and
  byte size can never attach to each other's stored parts;
- a **truthful verification lifecycle**: storage acceptance
  (`uploaded_unverified`) proves only existence + exact size of every part;
  the actual stored bytes are then streamed through SHA-256
  (`byte_verifying`), and only 38-of-38 verified parts produce
  `byte_verified` — nothing expands before that, and no UI calls anything
  "verified" earlier. The **exact whole-archive SHA-256** is additionally
  recorded from the ordered verified parts (bounded reads);
- **bounded range-read ZIP processing** — the whole archive is never held in
  memory (largest single storage read while processing a genuine 288 MiB
  archive: one 8 MiB part);
- **complete private extraction**: every safe entry becomes independently
  addressable private evidence. Entries above the 24 MiB in-memory cap (large
  videos, big PDFs) take a **streaming lane** — STORE or DEFLATE, bounded
  8 MiB chunks, full-stream CRC-32 + exact-size verification, per-part
  re-hashed storage writes — so a 64 MiB MP4 is retrievable and
  hash-verifiable on its own without touching the parent archive;
- a **durable per-entry inventory** (`studio_archive_entries`) with
  claim-checked, pending-only settlement: retries are idempotent, one damaged
  entry never blocks the rest, completion derives from rows;
- **autonomous continuation**: the Owner may close the browser once every
  part is durably stored and the processing request is confirmed; the
  scheduled runner advances the remaining slices with server-only
  credentials — no HTTP endpoint, no user token, no session;
- Media Truth intact: supported images publish as claims-stripped verified
  derivatives; everything else stays private, and original filenames / entry
  paths never cross the public boundary.

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
fingerprint file (4×256KiB) ─▶ plan: resume by (fp, size) ─────▶  studio_archives row
upload part k ──────────────────────────────────────────────▶   private studio-uploads
  (retry per part; re-plan resumes missing parts)                jobs/{job}/parts/{archive}/{k}
confirm (per-part sha256) ─▶ existence + exact size ─────────▶   status uploaded_unverified
processJob (explicit req.) ─▶ SLICE loop under job claim:         ("stored", NOT "verified")
                               • hash stored parts (12/slice) ▶  status byte_verifying
                               • all parts match ─────────────▶  status byte_verified
                               • exact archive SHA-256 (ordered
                                 8 MiB part reads, one hash)  ▶  archive_sha256
                               • range-read EOCD+central dir,
                                 FULL safety contract, then   ▶  studio_archive_entries
                                 durable inventory insert         status processing_entries
                               • route entries: publish images,
                                 stream/extract the rest into ▶  private evidence parts
                                 hashed private evidence          jobs/{job}/evidence/{a}/{e}/{k}
                               • release claim ───────────────▶  status received (ready)
uploader page (if open) ─────▶ accelerates via 3 s polls
Cloudflare Cron (*/5) ───────▶ Worker scheduled() export
                               → cloudflare:scheduled hook
                               → runScheduledStudioTick          NO browser, NO user token,
                                 (bounded slices, server creds)  NO public endpoint
all archives terminal ───────▶ compose durable outcomes + ordinary files
                               → ONE atomic studio_publish_project txn
```

### The autonomous runner (architect item 1)

The deployed Worker module generated by the Nitro `cloudflare-module` preset
**already exports a `scheduled()` handler** that fires the
`cloudflare:scheduled` runtime hook under `context.waitUntil`. The smallest
real runner is therefore not new infrastructure at all:

- `wrangler.jsonc` (repo root, committed) declares
  `triggers.crons = ["*/5 * * * *"]`. Nitro's cloudflare preset reads the
  repo wrangler config at build time and merges it into the generated
  `.output/server/wrangler.json` — verified in the committed build check.
- `src/features/forever-studio/server/scheduled.plugin.ts` is a Nitro runtime
  plugin (registered via `nitro.plugins` in `vite.config.ts`, bundled into
  the server build only) that hooks `cloudflare:scheduled` and runs
  `runStudioScheduledTickSafely()`.
- `runScheduledStudioTick(deps)` (service.ts) lists due jobs through the
  service-role-only `studio_list_due_jobs` RPC — which enforces **explicit
  processing-requested readiness and a currently active source membership
  before its LIMIT** — claims each through the ordinary single-winner claim
  (never `requestJobProcessing`: the runner never marks readiness itself),
  and advances bounded claim-scoped slices up to a per-invocation budget
  (12 slices). Authorization for each job is the creator's current
  membership; the Owner/Trusted Publisher upload remains the publication
  authorization and audit metadata records `executed_via: scheduled_runner`.
  Per-job failures are isolated and redacted; the tick never throws.

Cloudflare Workflows and Queues remain rejected (new infrastructure this
repo cannot validate); a Cron Trigger on the existing Worker is deploy
configuration for machinery that already exists. Idle cost is one due-jobs
query per 5 minutes. **The configuration is committed but NOT deployed; no
staging/production access occurred.**

### Rejected alternatives

| Alternative | Why rejected |
|---|---|
| **Supabase TUS resumable upload** (`/upload/resumable`) | Requires user-JWT writes to `storage.objects` via new RLS policies, relaxing the repo's invariant that every storage write is server-issued-signed-URL or service-role; needs the `tus-js-client` dependency; not integration-testable in the disposable harness. Chunked signed-URL parts deliver the same resume granularity with the existing authorization boundary and zero new dependencies. |
| **Cloudflare Workflows / Queues** | New infrastructure + billing surface this repo cannot validate locally; the claim/heartbeat/stale-resume machinery already models durable claimable work, and the Worker's existing `scheduled()` export needed only a cron expression + a runtime hook. |
| **Supabase Edge Function for processing** | A second runtime and credential surface; same memory problem unless the same range-read engine is built there. |
| **One long request with `waitUntil` chaining** | Worker CPU/time limits make a single 300 MiB pass unreliable; self-invoking fetch chains need an internal auth token and are fragile. Slices + durable checkpoints + a cron tick are strictly safer. |
| **Storage HTTP `Range` reads against one big object** | Would require a new authenticated raw-fetch path beside storage-js. Since the original always arrives as verified 8 MiB parts, mapping range reads onto part objects (`PartedArchiveSource`) gives bounded memory with the existing `downloadWithin` primitive. |
| **Raising the 16 MiB constant** | The buffer-based reader + Worker envelope make it impossible; explicitly out of scope per the task. |

## 4. Upload contract (truthful states)

- The browser first computes an **upload fingerprint**: SHA-256 over a domain
  prefix, four bounded content samples (head, two interior windows, tail —
  at most 4 × 256 KiB read), and the exact byte length. Cheap on a phone,
  deterministic, private (service-role column only). It is a **resume
  identity, never a verification**: the server still verifies every stored
  byte. A fingerprint collision cannot corrupt data — mixed parts fail the
  per-part hash verification and reject the archive fail-closed.
- `studioPlanArchiveUpload({jobId, fileName, declaredSize, uploadFingerprint})`
  → validates and creates/resumes a `studio_archives` row. Resume lookup is
  `(upload_fingerprint, declared_size)` — a renamed identical file resumes;
  a different file with the same name and size gets a fresh archive id and
  fresh part paths (regression-tested).
- `studioConfirmArchiveUpload({jobId, archiveId, partSha256[]})` → the server
  lists stored part objects and accepts **only** when every part exists with
  exactly the planned size. That makes the archive **`uploaded_unverified`**:
  durably stored, zero bytes hash-verified. The UI says *"Upload safely
  stored. Integrity verification continues."* — never "verified".
- The first processing slices stream-hash every stored part against the
  recorded claims (`byte_verifying`, 12 parts per slice, checkpointed).
  Any mismatch rejects the whole archive (`archive_part_integrity_failed`,
  retained privately, nothing expanded). Only 38-of-38 matches produce
  **`byte_verified`** — the single point after which the UI may show
  *"Archive byte verification passed."* The verified per-part hashes are
  preserved on the row afterwards.
- After byte verification, the **exact whole-archive SHA-256**
  (`archive_sha256`) is computed by streaming the ordered parts through one
  hash (8 MiB bounded reads, idempotent restart). `composite_sha256` remains
  the digest-of-part-digests and is never labelled as the file hash.

Archive lifecycle: `planned → uploaded_unverified → byte_verifying →
byte_verified → processing_entries → completed | rejected` — DB-enforced
(the retired ambiguous values `uploaded`/`verifying`/`indexed` are rejected
by the CHECK constraint).

## 5. Processing / checkpoint model

Slices run **inside the existing job claim** (15-minute stale window, 60 s
heartbeat between parts, entries, and evidence writes). One slice advances:
part verification (≤ 12), or exact-hash + indexing, or entry routing (≤ 24
entries / ≤ 64 MiB expanded), each outcome settled through the claim-checked
pending-only `studio_settle_archive_entry`. With work remaining the slice
releases the claim (`studio_release_job`, readiness preserved) so the next
caller — the uploader page while open, any Studio session's dashboard poll,
or the **scheduled runner** — continues immediately.

Entry routing:

- structured JSON / price artifacts → adopted first-archive-wins (unchanged);
- JPEG/PNG/WebP → PR #99 media-truth sanitize → verify → public derivative;
- **entries ≤ 24 MiB that stay private** (video, HEIC, unrecognized, budget
  overflow, sanitize-ineligible) → settled `retained_private` **with a
  private evidence manifest**: the CRC-verified bytes re-staged as fixed
  8 MiB private objects, each re-hashed from storage after the write;
- **entries > 24 MiB (uncompressed or compressed)** → the **streaming
  evidence lane**: `streamZipEntryDataRanged` pulls the compressed span in
  8 MiB chunks, STORE passes through / DEFLATE inflates through a
  backpressured `node:zlib` stream, output re-chunks into 8 MiB evidence
  parts, with running SHA-256, head sniff (magic-byte class), and
  full-stream CRC-32 + exact-size verification. A corrupt stream removes its
  partial evidence and settles that entry `failed` — never archive-fatal.
  Peak memory ≈ one compressed chunk + inflater window + one output part,
  independent of entry size;
- beyond the 1 GiB per-archive expansion budget → truthfully retained
  **inside the parent archive only** (recorded as not independently
  extracted);
- duplicates (within job or against the target project, by verified SHA-256)
  → `skipped_duplicate` (a freshly streamed duplicate removes its redundant
  evidence copy).

Evidence part paths are deterministic per entry (no attempt token): every
attempt derives byte-identical content from the same verified archive parts,
so a lost-claim race can only rewrite identical bytes, and the settled
manifest records what was verified in storage. The parent archive parts
remain the immutable parent evidence.

## 6. Data model (additive migration `20260724090000_studio_large_archive_v1.sql`)

- **`studio_archives`** — adds to the first revision:
  `upload_fingerprint` (NOT NULL, hex-checked, resume identity, private),
  `archive_sha256` (exact file hash, hex-checked), the truthful `status`
  CHECK set, and the `(job_id, upload_fingerprint, declared_size)` resume
  index. `composite_sha256` is explicitly documented as NOT the file hash.
- **`studio_archive_entries`** — adds `evidence JSONB`: `{bucket, prefix,
  partSize, partCount, parts:[{index,size,sha256}], totalSize,
  crc32Verified}` — the independently addressable private evidence manifest.
- **Functions** — `studio_update_archive_claimed` whitelists
  `archive_sha256` (fingerprint is insert-only, deliberately not patchable);
  `studio_settle_archive_entry` persists `evidence`. All remain
  claim-guarded, service-role-only, `SET search_path = ''`.
- Both tables: RLS enabled, zero policies, service-role-only grants,
  cascade from the job row only. The migration remains **additive and
  UNAPPLIED**; it runs in the disposable PostgreSQL chain only.

## 7. Archive and project limits (explicit budgets)

| Limit | Value | Rationale |
|---|---|---|
| Archive size | 300 MiB | product ceiling; also `maxArchiveBytes` of the ranged reader |
| Part size | 8 MiB fixed | resume granularity ≈ loss on interruption; bounded reads |
| Evidence part size | 8 MiB fixed | bounded writes; mirrors upload parts |
| Archives per job | 8 | keeps one job reviewable |
| Declared source per job | 1 GiB | initial product budget (files + archives) |
| Entries per archive | 2 000 | central directory stays ≤ 4 MiB cap |
| Central directory | 4 MiB | one bounded read |
| Per-entry in-memory cap | 24 MiB (= media sanitize cap) | larger entries take the STREAMING evidence lane (never buffered whole) |
| Total expansion per archive | 1 GiB | includes streamed evidence; beyond-budget entries stay inside the parent archive |
| Compression ratio | 200× (>1 MiB entries) | zip-bomb indicator — archive-fatal |
| Slice budgets | 24 entries / 64 MiB expanded / 12 part hashes | checkpoint cadence ≪ stale window |
| Scheduled tick budget | 12 slice advancements | bounded work per cron invocation |
| Public media per job | 500 | page sanity; excess retained privately with warning |

Hostile indicators (traversal, collisions, encryption, symlinks, bad method,
ratio abuse, ZIP64) still reject the **whole archive** fail-closed; a benign
oversized entry is a per-entry streaming-extraction outcome, never
archive-fatal.

## 8. Memory model

Peak processing memory per slice ≈ size-capped central directory (≤ 4 MiB) +
one cached part (8 MiB) + one compressed chunk (≤ 8 MiB streaming / ≤ 24 MiB
buffered lane) + one inflated entry (≤ 24 MiB buffered lane) or one evidence
part (8 MiB streaming lane) + one derivative (≤ 24 MiB) — comfortably inside
the ~128 MiB Worker envelope, independent of archive and entry size.
Measured (§11): a genuine 288 MiB archive processed with the largest single
storage read = **8 MiB** and peak RSS growth **≈ 128 MiB** (fake-storage
residency excluded — see the suite comment); the 120 MiB evidence archive
(64 MiB single entry) processed with largest read **and** largest written
object = **8 MiB**.

## 9. Supported / unsupported entry behavior

| Entry | Outcome |
|---|---|
| Project-facts JSON | fields adopted source-backed, `project_facts_extracted`, retained privately **with evidence** |
| Price-list JSON / PDF | first-archive-wins adoption (unchanged); retained privately **with evidence** |
| JPEG / PNG / WebP media | PR #99 sanitize → verify → public derivative; claims-stripped public projection |
| Video, HEIC/HEIF, ICC-profiled, GIF/AVIF, PDFs-as-media ≤ 24 MiB | retained privately **with independently addressable evidence** (`media_format_private`, …) |
| Any entry > 24 MiB (video, PDF, unknown) | **streaming evidence lane**: extracted to hashed private evidence parts, `entry_over_size_limit`, exact size + SHA-256 + byte class recorded |
| Duplicates (by verified SHA-256) | deterministic `skipped_duplicate`; a streamed duplicate's redundant evidence is removed |
| Corrupt entry (CRC/inflate, buffered or streamed) | that entry `failed` (`entry_integrity_failed`), partial evidence removed; everything else continues |
| Beyond 1 GiB expansion budget | retained inside the parent archive only (`archive_expansion_budget_reached`) — truthfully NOT independently extracted |
| Unknown documents | retained privately **with evidence** as source evidence |

## 10. Studio UX (truthful copy)

- During upload: per-part progress with retry states. After the server
  confirms storage: **"Upload safely stored. Integrity verification
  continues."** — the client never claims verification.
- Processing panel: shows **uploaded parts / total** and **verified parts /
  total** separately, discovered/processed entry counts, and per-archive
  truthful status lines (`verifying stored bytes 12/38 parts` →
  **"Archive byte verification passed."** at `byte_verified` →
  `processing n/m` → `done`). The close-the-page affordance reads: *"You may
  close this page — Forever continues processing automatically in the
  background"* — now backed by the scheduled runner, not by hoping another
  session polls.
- Publication and failure panels unchanged; small-ZIP and ordinary uploads
  unchanged.

## 11. Validation evidence (all local; fakes + disposable PostgreSQL)

New/updated suites in the corrective pass:

- `scheduled-runner.test.ts` (7) — **A. autonomous continuation**: upload +
  single explicit processing request, browser terminated, ZERO dashboard
  polls; repeated scheduled ticks (cron cadence) drive the job to published
  with no duplicate rows/objects; interruption between ticks → stale
  takeover preserving settled outcomes; never-requested jobs untouched;
  disabled sources excluded before the batch; Partner Demo no-op;
  per-invocation slice budget respected; the Nitro plugin registers
  `cloudflare:scheduled`.
- `large-archive-verification.test.ts` (1, genuine 297 MiB / 38 parts) —
  **B. truthful verification**: storage acceptance shows
  `uploaded_unverified` (38 uploaded / 0 verified); the first slice yields
  exactly 12/38 and `byte_verifying`; every observed state below 38/38 is
  an unverified state; the exact `archive_sha256` equals an independently
  computed whole-file hash and differs from `composite_sha256`.
- `large-archive-evidence.test.ts` (1) — **C. large private extraction**:
  JPEG publishes via Media Truth; a 64 MiB MP4 (STORE) and a 30 MiB PDF
  (DEFLATE) are independently extracted with matching SHA-256, byte class
  video/pdf, and reconstructable 8 MiB evidence parts; neither is public
  (exactly one public object exists); a corrupt oversized entry fails in
  isolation leaving zero evidence objects; instrumented largest read AND
  largest write = 8 MiB.
- `large-archive-upload.test.ts` (10) — **D. resume collision**: two ZIPs
  with identical filename and byte size create different archive ids and
  fresh part paths (stale parts never reused); a renamed identical file
  resumes; fingerprint validation; storage acceptance truthfully
  `uploaded_unverified` with zero verified parts.
- `archive-upload-fingerprint.test.ts` (4) — the REAL browser fingerprint
  (Web Crypto) equals the node fixture mirror on both the full-content and
  sampled paths; different content behind identical name+size differs;
  sampled bytes bounded at 4 × 256 KiB.
- `zip-ranged.test.ts` (17, +5) — streaming reader ≡ buffered reader for
  STORE and DEFLATE at 64 KiB chunk granularity; full-stream CRC/size
  verification fail-closed; output capped at the declared size; consumer
  (storage) errors propagate verbatim, never mislabelled as ZIP corruption;
  incremental CRC-32 ≡ one-shot CRC over arbitrary chunkings.
- `large-archive-processing.test.ts` (15) — oversized-entry test now proves
  extraction INTO evidence (exact size, SHA-256, per-part storage checks);
  all prior end-to-end, dedup, fail-closed, stale-token, sweep, and
  progress-privacy behavior re-proven.
- `large-archive-memory.test.ts` (2) + `large-archive-migration-contract.test.ts`
  (12, +2: truthful-status CHECK, fingerprint/exact-hash/evidence whitelists).
- `studio.postgres.sql` — real-database: truthful status CHECK rejects the
  retired `uploaded` value and malformed fingerprints; `archive_sha256`
  patches through the claim-checked whitelist; the evidence manifest
  persists structured on a retained settlement; all prior LA-1…LA-5
  assertions re-proven.

**Recorded measurements** (committed suites, this machine):

```
288 MiB memory proof: archive=288.0MiB parts=37 entries=39
  totalExpanded=288.0MiB slices=8 downloadCalls=88 largestRead=8.0MiB
  peakRssGrowth≈128MiB (fake-storage evidence payloads evicted between
  slices — they are remote objects in production; see suite comment)
38-part verification proof: 12/38 after slice 1 (byte_verifying),
  byte_verified only at 38/38; archive_sha256 == independent full hash
evidence proof: archive=120.0MiB slices=4 largestRead=8.0MiB
  largestWrite=8.0MiB (64 MiB entry streamed, never buffered)
interruption fixture: worker killed mid-run, stale takeover after 16 min,
  settled outcomes byte-identical after resume
```

Proportional runs, all on this branch (exact numbers in the PR description):

- **Full vitest**: every Studio, ZIP, upload/resume/concurrency, Media
  Truth, and public-boundary suite passes; the only failures are the
  **pre-existing** ones unrelated to this change
  (`src/import/importer-preflight.test.ts` fixture drift and the
  missing-`modeva`-asset environmental failures), which fail identically on
  unmodified code.
- **Disposable PostgreSQL harness** (`npm run studio:pg-test`,
  PostgreSQL 17): complete migration chain including the extended migration
  → `ALL STUDIO POSTGRES ASSERTIONS PASSED`.
- **TypeScript** `tsc --noEmit`: clean.
- **ESLint + Prettier**: clean on every file this PR touches (repo-wide
  `eslint .` carries pre-existing drift in untouched legacy files).
- **Build** (`npm run build`, Nitro → Cloudflare Workers): succeeds;
  `.output/server/wrangler.json` contains the merged
  `triggers.crons=["*/5 * * * *"]` and the server bundle contains the
  `cloudflare:scheduled` registration; the client bundle contains no
  service-role symbols.
- `git diff --check`: clean. Secret/private-path scan of the diff: no
  credentials, keys, JWTs, or local paths.

## 12. Limitations (truthful)

- **The cron trigger must ship with a deploy.** The runner code and its
  wrangler configuration are committed and locally proven through the DI
  seam, but this repository deploys nothing: until the next deployment
  publishes the Worker with its generated wrangler config, background
  continuation in the deployed environment still relies on Studio sessions.
  Verifying the first real cron invocation is the explicit staging gate.
- **Page-reload upload resume needs the same job.** Within a session, parts
  retry and re-planning resumes (now fingerprint-keyed). After a full page
  reload the client starts a new job; stored parts of the abandoned job stay
  privately retained. A localStorage draft-job ledger is a small follow-up.
- **The upload fingerprint samples content**; files differing only outside
  the sampled windows fingerprint identically. This can only affect resume
  routing, never data integrity: per-part hash verification rejects mixed
  parts fail-closed.
- **Entries beyond the 1 GiB expansion budget** are not independently
  extracted (truthfully recorded); they remain inside the verified parent
  archive.
- **Per-project (cross-job) source budget** is enforced per job (1 GiB); a
  lifetime per-project quota needs a product decision on retention.
- **ZIP64 (≥ 4 GiB or ≥ 65 535 entries) remains rejected** by design.
- Local tests prove logic and memory behavior, **not** real-network Supabase
  Storage throughput, Worker CPU accounting, or the platform actually firing
  cron — that is the staging gate.

## 13. Migration state

`supabase/migrations/20260724090000_studio_large_archive_v1.sql` was extended
IN PLACE by this corrective pass (it has never been applied anywhere, so the
draft is still one additive migration). It remains **additive, ordered after
current main (`20260723130000`), and UNAPPLIED** to any real environment; it
runs in the disposable PostgreSQL chain only. The PR #99 grant migration
remains intentionally unapplied and untouched. No staging or production
database, storage, or credentials were accessed; nothing was deployed.

## 14. Staging validation plan (explicit later gate)

1. Apply the migration chain to staging; deploy the Worker so the generated
   wrangler config (with `triggers.crons`) takes effect.
2. Real-device gate: phone on cellular uploads a genuine 100–300 MiB ZIP;
   kill the connection mid-part repeatedly; verify part-level resume and the
   truthful stored → byte-verified transitions in the UI.
3. **Close the browser after the processing request; verify the cron tick
   alone completes the job** (watch `executed_via: scheduled_runner` audit
   metadata); measure slice wall-time and Worker CPU per slice against
   limits.
4. Verify published page media, private evidence objects (reconstruct one
   large entry from its manifest), warning aggregates, and that
   `studio-uploads` objects match the durable inventory.
5. Chaos pass: tamper a stored part, upload a hostile archive, upload two
   different ZIPs with the same name+size, and confirm fail-closed behavior
   with truthful warnings.

## 15. Rollout / rollback

- **Rollout**: merge → apply migration to staging → staging gate above →
  production. No feature flag needed (the lane activates only for > 16 MiB
  ZIPs); the cron trigger ships with the normal deploy config.
- **Rollback**: revert the application commit — ordinary Studio remains
  fully functional; large archives fall back to `archive_too_large` private
  retention. Removing `wrangler.jsonc` removes the cron trigger at the next
  deploy. The migration can stay applied (unused tables/functions are inert,
  service-role-only) or be dropped with the documented DOWN steps.

## 16. Access confirmation

**Staging and production were not accessed.** No deploy, no remote migration,
no real project publication, no credential use beyond the repo's local test
fixtures. The scheduled runner was exercised exclusively through its
dependency-injected local seam. Factory autonomy remains A0.
