# FOREVER-STUDIO-LARGE-ARCHIVE-001 — Implementation Report

Branch: `claude/forever-studio-large-archive-001` · Base: `8d173db` (post-PR-99 main)
Status: **implemented + three corrective passes (architect review, two independent Codex audits), fully validated locally, Draft PR, migration unapplied, no deployment**

> **Corrective pass 3 (2026-07-24, second independent Codex audit).** The
> audit found one remaining HIGH-severity defect: the lifecycle trigger
> returned early on same-state updates, so a worker holding a valid
> processing claim could stay in `processing_entries` and rewrite
> `parts`, `observed_size`, `composite_sha256`, `archive_sha256`,
> `entry_count`, `total_uncompressed` — replacing verified evidence without
> ever changing state — and a fabricated manifest could satisfy the
> completion checks. Corrected at the database layer:
>
> 1. **The same-state validation bypass is removed.** Every INSERT/UPDATE —
>    transition or idempotent re-write — must satisfy the complete invariants
>    of the state the row lands in; the transition matrix applies only to
>    state changes, but validation always runs.
> 2. **Verified archive evidence is now one coherent, database-recomputed
>    definition.** For any row in `byte_verified`, `processing_entries`, or
>    `completed`: exactly `part_count` ordered part objects (integer indexes
>    covering 0..n−1 — no duplicate, gap, reorder, or extra), geometry
>    `part_count = ceil(declared_size / part_size)`, each part at its exact
>    expected size (final part = exact remainder) with sizes summing to
>    `declared_size`, every part `verified=true` with a valid server SHA-256
>    EQUAL to the plan-time client claim, `observed_size = declared_size`,
>    `archive_sha256` present, and `composite_sha256` equal to the digest the
>    DATABASE recomputes over the ordered server hashes. The parts manifest
>    is additionally **cryptographically bound to the immutable
>    `manifest_sha256` identity on every row version** — PostgreSQL re-derives
>    `sha256(domain ‖ declared_size ‖ part_size ‖ part_count ‖ ordered raw
declared digests)` (the exact server preimage) — so a fabricated or
>    rewritten manifest can never satisfy ANY state, planned included.
> 3. **Verification evidence is immutable after `byte_verified`** (OLD vs NEW
>    in the trigger): `parts`, `observed_size`, `composite_sha256`,
>    `archive_sha256` are frozen through `processing_entries` and `completed`;
>    `entry_count`/`total_uncompressed` freeze once recorded; terminal states
>    accept only strict no-op re-writes. The RPC whitelist shrinks in step:
>    evidence fields cannot even be PRESENTED in a patch after verification,
>    unknown patch fields are rejected outright, indexing is phase-gated to
>    `byte_verified`, and settlement to `processing_entries`.
> 4. **The TypeScript fake mirrors the full contract** (no weaker test
>    database), and the PostgreSQL suite gained an adversarial battery
>    (LA-10) that proves — with before/after row snapshots — that every
>    rejected tamper attempt changed nothing. The audit
>    found five defects; all five are corrected in this revision:
> 5. **Sampled resume identity replaced by the exact per-part manifest.**
>    The v1 upload fingerprint hashed only four bounded windows, so two
>    same-size files differing outside the samples could collide and the
>    second could attach to the first's stored parts (or idempotently
>    "confirm" an accepted archive it did not upload). The resume identity is
>    now the **complete ordered per-part SHA-256 manifest** — every byte
>    hashed, sequentially, one 8 MiB part at a time (bounded memory) — bound
>    to the archive at PLAN time; resume happens only on a digest-for-digest
>    match, and confirm refuses any manifest that differs from the planned
>    one. The sampled-fingerprint contract is removed.
> 6. **Cross-job archive ownership enforced in SQL.** A valid processing
>    claim on job B could previously call the archive RPCs against job A's
>    archive. Every RPC now locks the target archive and proves
>    `archive.job_id = p_job_id` (returning FALSE otherwise), and a
>    **composite foreign key** `(archive_id, job_id) →
studio_archives(id, job_id)` makes cross-job entry rows unrepresentable
>    at the constraint layer.
> 7. **ZIP structural binding hardened in BOTH readers.** EOCD candidates
>    must consume the file exactly (offset + 22 + comment = EOF; ambiguous
>    duplicates reject); disk fields must be zero; the central directory must
>    sit flush against the EOCD and be consumed exactly; and every entry's
>    LOCAL header is bound to its central record (exact name bytes, method,
>    relevant flags, encryption, CRC/sizes or verified data-descriptor
>    semantics, disjoint local spans) before any payload byte is read.
> 8. **The archive lifecycle is DB-enforced.** A trigger implements the full
>    transition matrix plus state evidence (byte_verified requires every part
>    verified with a server hash, observed = declared size, and the exact
>    archive SHA-256; processing_entries requires the durable inventory;
>    completed requires zero pending entries) — TypeScript callers can no
>    longer skip or regress states, and malformed JSON patches fail safely
>    before any cast.
> 9. **The memory claim is re-measured honestly.** A processing-only,
>    disk-backed, forced-GC child-process benchmark replaces the fake-storage
>    RSS reading and explains the 64–81 vs 119.9 MiB discrepancy (§8, §11).

> **Corrective pass 1 (2026-07-24, architect review).** The first revision of this report
> overstated three things; this revision corrects the system and the words:
>
> 1. _"The browser may close and processing continues"_ was only true while
>    an authenticated Studio session kept polling. It is now true without any
>    session: a **real scheduled runner** (Cloudflare Cron Trigger → the
>    Worker's `scheduled()` export → the `cloudflare:scheduled` Nitro hook)
>    is implemented and its deploy configuration is committed.
> 2. _"Accepted/verified"_ conflated storage acceptance with verification.
>    The lifecycle now says exactly what has been proven: stored is never
>    called verified, and "byte verification passed" appears only after every
>    stored part has been hash-verified.
> 3. _"All unsupported entries retained privately"_ previously meant "still
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
  signed URL); resume identity is the **exact ordered per-part SHA-256
  manifest** (every byte hashed, bounded memory) — never the filename, never
  a sampled digest — so two different archives can never attach to each
  other's stored parts no matter where their bytes differ;
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
hash EVERY 8 MiB part ──────▶ plan: resume ONLY on exact ─────▶  studio_archives row
  (sequential, bounded)        manifest match (all digests)       (manifest bound at plan)
upload part k ──────────────────────────────────────────────▶   private studio-uploads
  (retry per part; re-plan resumes missing parts)                jobs/{job}/parts/{archive}/{k}
confirm (same manifest) ───▶ manifest must equal the plan's ─▶   status uploaded_unverified
                              + existence + exact size
processJob (explicit req.) ─▶ SLICE loop under job claim:         ("stored", NOT "verified")
                               • hash stored parts (12/slice) ▶  status byte_verifying
                               • all parts match + exact
                                 archive SHA-256 (streamed
                                 chunks, no part buffers) ────▶  status byte_verified
                                 (one atomic patch; the DB        + archive_sha256
                                  trigger demands the evidence)
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

| Alternative                                             | Why rejected                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Supabase TUS resumable upload** (`/upload/resumable`) | Requires user-JWT writes to `storage.objects` via new RLS policies, relaxing the repo's invariant that every storage write is server-issued-signed-URL or service-role; needs the `tus-js-client` dependency; not integration-testable in the disposable harness. Chunked signed-URL parts deliver the same resume granularity with the existing authorization boundary and zero new dependencies. |
| **Cloudflare Workflows / Queues**                       | New infrastructure + billing surface this repo cannot validate locally; the claim/heartbeat/stale-resume machinery already models durable claimable work, and the Worker's existing `scheduled()` export needed only a cron expression + a runtime hook.                                                                                                                                           |
| **Supabase Edge Function for processing**               | A second runtime and credential surface; same memory problem unless the same range-read engine is built there.                                                                                                                                                                                                                                                                                     |
| **One long request with `waitUntil` chaining**          | Worker CPU/time limits make a single 300 MiB pass unreliable; self-invoking fetch chains need an internal auth token and are fragile. Slices + durable checkpoints + a cron tick are strictly safer.                                                                                                                                                                                               |
| **Storage HTTP `Range` reads against one big object**   | Would require a new authenticated raw-fetch path beside storage-js. Since the original always arrives as verified 8 MiB parts, mapping range reads onto part objects (`PartedArchiveSource`) gives bounded memory with the existing `downloadWithin` primitive.                                                                                                                                    |
| **Raising the 16 MiB constant**                         | The buffer-based reader + Worker envelope make it impossible; explicitly out of scope per the task.                                                                                                                                                                                                                                                                                                |

## 4. Upload contract (truthful states, exact manifest identity)

- The browser first computes the **upload part manifest**: the ordered
  SHA-256 of EVERY fixed-size part, read and hashed strictly one 8 MiB slice
  at a time (proven: one slice per part, ≤ one part in flight — never a
  whole-file ArrayBuffer). Covering every byte, it replaces the retired v1
  sampled fingerprint, which could not distinguish same-size files differing
  outside its four windows. It is a **resume identity, never a
  verification**: the server still verifies every stored byte.
- `studioPlanArchiveUpload({jobId, fileName, declaredSize, partSha256[]})` →
  validates the manifest against the declared geometry (count =
  ⌈size/8 MiB⌉, all lowercase hex), derives the server-side **manifest
  identity** (SHA-256 over domain/version ‖ exact size ‖ part size ‖ part
  count ‖ ordered raw digests), and creates/resumes a `studio_archives` row.
  Resume happens **only when the complete stored manifest matches
  digest-for-digest** (the identity digest merely narrows candidates); ANY
  difference — a single byte anywhere — yields a fresh archive id and fresh
  part paths, and stale parts are never reported present for different bytes
  (regression-tested, including a difference placed exactly where the old
  sampled windows never looked). The manifest digests are bound to
  `parts[].declaredSha256` at plan time.
- `studioConfirmArchiveUpload({jobId, archiveId, partSha256[]})` → the
  submitted manifest must equal the archive's planned manifest exactly
  (`archive_manifest_mismatch` otherwise — **an accepted archive can never
  be idempotently confirmed by a different manifest**, and confirm can never
  rewrite claims). The server then lists stored part objects and accepts
  **only** when every part exists with exactly the planned size. That makes
  the archive **`uploaded_unverified`**: durably stored, zero bytes
  hash-verified. The UI says _"Upload safely stored. Integrity verification
  continues."_ — never "verified".
- The first processing slices stream-hash every stored part against the
  plan-time claims (`byte_verifying`, 12 parts per slice, checkpointed).
  Any mismatch rejects the whole archive (`archive_part_integrity_failed`,
  retained privately, nothing expanded). When the last part matches, the
  **exact whole-archive SHA-256** is streamed across the ordered parts in
  transport-sized chunks (readObjectStream — no per-part buffers) and ONE
  atomic patch records parts + `composite_sha256` + `archive_sha256` +
  **`byte_verified`** — the single point after which the UI may show
  _"Archive byte verification passed."_ The DB lifecycle trigger refuses the
  transition without this complete evidence. `composite_sha256` remains the
  digest-of-part-digests and is never labelled as the file hash.

Archive lifecycle — **enforced by the database trigger
`studio_archive_lifecycle_guard`, not by callers** (inserts start at
`planned` carrying the plan-bound manifest and NO verification evidence;
EVERY row version — same-state updates included — must satisfy the complete
invariants of the state it lands in; identity fields are immutable from
birth and verification evidence is immutable after `byte_verified`):

```
planned             → uploaded_unverified | rejected
uploaded_unverified → byte_verifying      | rejected
byte_verifying      → byte_verified       | rejected   (requires: all parts
                                                        verified + server sha,
                                                        observed = declared,
                                                        archive_sha256 present)
byte_verified       → processing_entries  | rejected   (requires: inventory rows
                                                        = entry_count, totals set)
processing_entries  → completed           | rejected   (requires: zero pending
                                                        entries, evidence intact)
completed / rejected → terminal (no outgoing edges)
```

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

- **`studio_archives`** —
  `manifest_sha256` (NOT NULL, hex-checked: the server-derived manifest
  identity; the retired `upload_fingerprint` column is gone),
  `archive_sha256` (exact file hash, hex-checked, REQUIRED to enter
  `byte_verified`), the truthful `status` CHECK set, the
  `(job_id, manifest_sha256, declared_size)` resume-candidate index, and
  **`UNIQUE (id, job_id)`** — the composite identity target for the entries'
  cross-job constraint. `composite_sha256` is explicitly documented as NOT
  the file hash.
- **`studio_archive_lifecycle_guard`** (trigger, BEFORE INSERT OR UPDATE) —
  the transition matrix and state evidence of §4, enforced for EVERY caller
  (RPC, PostgREST, direct SQL) on EVERY row version — there is **no
  same-state bypass**. Inserts must start `planned` with no verification
  evidence; identity fields (id, job, manifest identity, size, geometry,
  ordinal, filename, created_at) are immutable; the parts manifest is
  **cryptographically bound to `manifest_sha256`** (the trigger re-derives
  the server's identity preimage with PostgreSQL's own `sha256()`); rows in
  `byte_verified`/`processing_entries`/`completed` must carry the complete
  recomputed evidence (ordered indexes, exact sizes + sum, server hash =
  plan-time claim per part, observed = declared, exact archive hash,
  recomputed composite, inventory count + job ownership, zero pending for
  completed); after `byte_verified` the evidence columns are frozen (OLD vs
  NEW), after `processing_entries` the inventory numbers are too, and
  terminal states accept only strict no-op re-writes. Violations raise and
  roll back — TypeScript can neither skip, regress, nor silently rewrite a
  state.
- **`studio_archive_entries`** — `evidence JSONB` (the independently
  addressable private evidence manifest) and the **composite FK
  `(archive_id, job_id) REFERENCES studio_archives (id, job_id)`**: an entry
  claiming archive A under job B is unrepresentable at the constraint layer.
- **Functions** — every processing RPC now (a) locks the job claim,
  (b) **locks the target archive/entry and proves it belongs to the claimed
  job** (FALSE otherwise — a valid claim on job B can never write into job
  A's archive), and (c) validates every supplied JSON field's type/shape
  BEFORE casting (`studio_archive_patch_invalid`,
  `studio_archive_outcome_invalid`, `studio_archive_entries_invalid` — a
  malformed patch fails safely, changing nothing).
  `studio_update_archive_claimed` additionally rejects unknown patch fields
  outright and **shrinks its whitelist by lifecycle position**
  (`studio_archive_patch_forbidden`): after `byte_verified`, the evidence
  fields (`parts`, `observed_size`, `composite_sha256`, `archive_sha256`)
  cannot even be presented; after `processing_entries`, neither can
  `entry_count`/`total_uncompressed`; terminal rows accept status-only
  no-op patches (`manifest_sha256` remains insert-only, deliberately not
  patchable). `studio_index_archive_entries` is phase-gated to
  `byte_verified` archives (the transitioned entry count can never be
  diluted afterwards) and `studio_settle_archive_entry` remains pending-only
  AND phase-gated to `processing_entries`. All remain claim-guarded,
  service-role-only, `SET search_path = ''`.
- Both tables: RLS enabled, zero policies, service-role-only grants,
  cascade from the job row only. The migration remains **additive and
  UNAPPLIED**; it runs in the disposable PostgreSQL chain only.

## 7. Archive and project limits (explicit budgets)

| Limit                       | Value                                         | Rationale                                                                        |
| --------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------- |
| Archive size                | 300 MiB                                       | product ceiling; also `maxArchiveBytes` of the ranged reader                     |
| Part size                   | 8 MiB fixed                                   | resume granularity ≈ loss on interruption; bounded reads                         |
| Evidence part size          | 8 MiB fixed                                   | bounded writes; mirrors upload parts                                             |
| Archives per job            | 8                                             | keeps one job reviewable                                                         |
| Declared source per job     | 1 GiB                                         | initial product budget (files + archives)                                        |
| Entries per archive         | 2 000                                         | central directory stays ≤ 4 MiB cap                                              |
| Central directory           | 4 MiB                                         | one bounded read                                                                 |
| Per-entry in-memory cap     | 24 MiB (= media sanitize cap)                 | larger entries take the STREAMING evidence lane (never buffered whole)           |
| Total expansion per archive | 1 GiB                                         | includes streamed evidence; beyond-budget entries stay inside the parent archive |
| Compression ratio           | 200× (>1 MiB entries)                         | zip-bomb indicator — archive-fatal                                               |
| Slice budgets               | 24 entries / 64 MiB expanded / 12 part hashes | checkpoint cadence ≪ stale window                                                |
| Scheduled tick budget       | 12 slice advancements                         | bounded work per cron invocation                                                 |
| Public media per job        | 500                                           | page sanity; excess retained privately with warning                              |

Hostile indicators (traversal, collisions, encryption, symlinks, bad method,
ratio abuse, ZIP64) still reject the **whole archive** fail-closed; a benign
oversized entry is a per-entry streaming-extraction outcome, never
archive-fatal.

**Structural binding (audit corrective, both readers).** Beyond the entry-set
contract, the readers now bind the ZIP's physical structure:

- an EOCD candidate is accepted **only** when
  `offset + 22 + declaredCommentLength == EOF` — fake EOCD signatures inside
  comments or trailing garbage are not candidates, a lying comment length or
  undeclared trailing bytes mean no candidate at all, and TWO exact-EOF
  candidates (a crafted comment embedding a plausible EOCD) reject as
  structurally ambiguous;
- this-disk, central-directory-disk, and every per-entry disk-start field
  must be 0, and entries-on-this-disk must equal total entries (multi-disk
  rejected consistently);
- the central directory must sit **flush against the EOCD** and parsing must
  consume **exactly** its declared byte size;
- before ANY payload byte is read, each entry's LOCAL header must agree with
  its central record: exact filename **bytes**, compression method, the
  relevant general-purpose flags (encryption, data-descriptor, UTF-8), zero
  encryption bits, and CRC-32/compressed/uncompressed sizes — or, with flag
  bit 3, zeroed local fields plus a **data descriptor after the payload that
  matches the central values** (valid signed and unsigned forms accepted;
  wrong or missing descriptors reject);
- entries occupy pairwise-disjoint spans: duplicate local offsets, a central
  record pointing into another entry's local record, or one entry's claimed
  bytes overlapping another's are rejected at the entry-set level, and each
  entry's payload (+ descriptor) must end before the NEXT entry's local
  header (or the central directory) — central metadata is never trusted to
  describe bytes that belong to a different local record.

## 8. Memory model (re-measured after the independent audit)

Working-set bound by construction, per slice: size-capped central directory
(≤ 4 MiB) + one cached part (8 MiB, single-part reads now return read-only
views instead of copies) + one compressed chunk (≤ 8 MiB streaming /
≤ 24 MiB buffered lane) + one inflated entry (≤ 24 MiB buffered lane) or one
pending evidence part (8 MiB streaming lane) + one derivative (≤ 24 MiB) —
independent of archive and entry size. Part verification and the exact
whole-archive SHA-256 now stream in **transport-sized chunks**
(`readObjectStream`) and allocate no per-part buffers at all.

**Why the two earlier numbers disagreed (64–81 vs 119.9 MiB).** Both prior
figures measured the WRONG thing: a vitest worker whose in-memory fake
Storage retained every uploaded part and extracted evidence object as
resident JS Buffers (≈ 288 MiB of fake payloads, partially masked by a
mid-test eviction hack), with the baseline taken before GC had settled the
fixture-generation garbage. The result was dominated by fake-storage
residency and GC timing — machine- and run-dependent — which is exactly why
two runs produced 64–81 and 119.9 MiB. Neither measured the engine.

**The measurement of record** is now a processing-only, child-process
benchmark (`node scripts/studio/run-memory-benchmark.mjs` →
`large-archive-memory-benchmark.test.ts`, vitest forks pool +
`--expose-gc`): the ~286 MiB fixture is streamed to DISK before the
baseline, storage is DISK-backed (objects are files, hashing streams 64 KiB
chunks — the shape of remote object storage), GC is forced at the baseline
and between slices, and RSS is sampled at every storage operation and entry
settlement with per-phase attribution. Result on this machine (286 MiB
archive, 36 parts, 29 entries incl. a 64 MiB STORE video and a 30 MiB
DEFLATE document, 8 slices):

| Figure                                                                | Value                                        |
| --------------------------------------------------------------------- | -------------------------------------------- |
| Peak RSS growth over post-setup baseline (unconstrained GC watermark) | **96.2 MiB**                                 |
| — verify_parts / exact_archive_sha / central_directory phase peaks    | ≤ baseline (streaming; no allocation growth) |
| Max LIVE set between slices (after forced GC)                         | **30.0 MiB**                                 |
| Final RSS growth after completion + GC                                | **−9.7 MiB** (nothing retained)              |
| Largest single storage read / write                                   | **8 MiB / 8 MiB**                            |
| Largest single buffered entry (largest engine-allocated buffer)       | 8 MiB (cap: 24 MiB)                          |

Interpretation, stated carefully: the 96 MiB figure is an
**unconstrained-Node GC watermark** — collectible churn from the bounded
8 MiB lanes accumulating between garbage collections, NOT live memory (the
post-GC live set is 30 MiB and the final growth is negative). A
memory-pressured runtime such as the Workers isolate collects that churn
instead of growing; only the live set can cause a hard OOM. We therefore
claim: bounded live working set ≈ 30 MiB + bounded single allocations
≤ 24 MiB — and we do NOT claim a specific deployed peak-RSS number; the real
Worker figure is an explicit staging-gate measurement (§14). The in-suite
288 MiB memory test remains as a fast regression guard for bounded reads.

## 9. Supported / unsupported entry behavior

| Entry                                                            | Outcome                                                                                                                                      |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Project-facts JSON                                               | fields adopted source-backed, `project_facts_extracted`, retained privately **with evidence**                                                |
| Price-list JSON / PDF                                            | first-archive-wins adoption (unchanged); retained privately **with evidence**                                                                |
| JPEG / PNG / WebP media                                          | PR #99 sanitize → verify → public derivative; claims-stripped public projection                                                              |
| Video, HEIC/HEIF, ICC-profiled, GIF/AVIF, PDFs-as-media ≤ 24 MiB | retained privately **with independently addressable evidence** (`media_format_private`, …)                                                   |
| Any entry > 24 MiB (video, PDF, unknown)                         | **streaming evidence lane**: extracted to hashed private evidence parts, `entry_over_size_limit`, exact size + SHA-256 + byte class recorded |
| Duplicates (by verified SHA-256)                                 | deterministic `skipped_duplicate`; a streamed duplicate's redundant evidence is removed                                                      |
| Corrupt entry (CRC/inflate, buffered or streamed)                | that entry `failed` (`entry_integrity_failed`), partial evidence removed; everything else continues                                          |
| Beyond 1 GiB expansion budget                                    | retained inside the parent archive only (`archive_expansion_budget_reached`) — truthfully NOT independently extracted                        |
| Unknown documents                                                | retained privately **with evidence** as source evidence                                                                                      |

## 10. Studio UX (truthful copy)

- During upload: per-part progress with retry states. After the server
  confirms storage: **"Upload safely stored. Integrity verification
  continues."** — the client never claims verification.
- Processing panel: shows **uploaded parts / total** and **verified parts /
  total** separately, discovered/processed entry counts, and per-archive
  truthful status lines (`verifying stored bytes 12/38 parts` →
  **"Archive byte verification passed."** at `byte_verified` →
  `processing n/m` → `done`). The close-the-page affordance reads: _"You may
  close this page — Forever continues processing automatically in the
  background"_ — now backed by the scheduled runner, not by hoping another
  session polls.
- Publication and failure panels unchanged; small-ZIP and ordinary uploads
  unchanged.

## 11. Validation evidence (all local; fakes + disposable PostgreSQL)

New/updated in corrective pass 3 (second independent audit — lifecycle
evidence hardening):

- `studio.postgres.sql` **LA-10 adversarial lifecycle-evidence suite** (real
  PostgreSQL 17, full migration chain) — all 27 enumerated adversarial
  scenarios, each rejected operation proven with before/after row snapshots
  (`to_jsonb` modulo `updated_at`) to have changed **no archive field, no
  entry field, and no unrelated row**: valid `byte_verified` creation; the
  accepted same-state no-op; same-state tampering with parts / archive hash
  / observed size / composite / manifest identity at `byte_verified` AND at
  `processing_entries` (refused by BOTH the RPC whitelist reduction and the
  trigger's OLD-vs-NEW freeze, including direct service-role SQL); the
  byte_verified evidence gate refusing an unverified part, reordered
  indexes, a duplicate index, a missing part, and a wrong final-part size;
  the same five shapes refused again as single-statement FABRICATED
  `byte_verified → processing_entries` transitions; entry-count freezing and
  the re-counted completion gate (a directly inserted extra inventory row
  blocks completion; the composite FK keeps foreign-job inventory
  unrepresentable); completion with a pending entry refused; valid
  completion; completed/rejected as strict no-op terminals (evidence,
  extracted artifacts, and error codes all frozen; every earlier state
  unreachable by RPC or SQL); malformed parts JSON (object-for-array, scalar
  elements, fractional index/size, malformed digests, unknown part fields,
  identity-digest mismatch) failing atomically at any state; stale tokens
  and cross-job claims refused for patch, index, and settle; and the new
  phase gates (no indexing after `byte_verified`, no settlement outside
  `processing_entries`).
- `studio.postgres.sql` LA-2/LA-3/LA-6 fixtures now carry **real manifest
  identities** (a suite mirror of the server's digest derivation feeds the
  trigger's cryptographic binding), server hashes EQUAL to plan-time claims,
  and database-recomputed composites; new negatives prove a WELL-FORMED but
  WRONG manifest identity cannot even be planned, a claim/server hash
  MISMATCH cannot byte-verify, and a wrong composite is refused.
- `large-archive-migration-contract.test.ts` (16) — static proof the
  same-state bypass is gone, every immutability/binding/forbidden-field
  error class exists, and the phase gates are present in the SQL text.
- `fakes.ts` — the in-memory database now mirrors the ENTIRE hardened
  contract (identity immutability, manifest binding via the same preimage,
  full verified-state evidence incl. claim/server equality and the
  recomputed composite, post-verification freezes, terminal no-ops,
  inventory/job-ownership checks, RPC whitelist reduction, phase gates), so
  TypeScript tests can no longer pass against a weaker database than
  PostgreSQL enforces. All 266 Studio-suite tests pass against the stricter
  fake with **zero production-code changes** — proof the legitimate engine
  flows never relied on the removed bypass.

New/updated suites in corrective pass 2 (independent audit):

- `large-archive-upload.test.ts` (13) — the exact-manifest contract: the
  complete manifest is bound at plan; resume only on digest-for-digest
  match; **same name + same size differing ONLY in a region the retired
  sampled fingerprint never read → different upload records, zero stale
  parts reported present**; an accepted archive refuses a different manifest
  at confirm (wrong digest AND wrong length), byte-identically unchanged
  after the refusals; malformed manifests (non-hex, wrong count) rejected;
  the server-derived identity changes with any digest, the size, the part
  size, and digest ORDER.
- `archive-upload-manifest.test.ts` (4) — the REAL browser implementation
  (Web Crypto over a File) equals the node mirror digest-for-digest incl. a
  short tail part; a single flipped interior byte (outside the old sample
  windows) changes exactly one digest; **memory-bounded by construction:
  one slice per part, max slice = one part, at most ONE part in flight**.
- `zip-structural.test.ts` (22, both readers) — fake EOCD inside a comment
  (exact-EOF-crafted → ambiguous reject; non-exact → real record wins);
  wrong comment length both directions; trailing bytes; nonzero
  this-disk/cd-disk/entry-disk-start; entries-on-disk ≠ total; CD not flush
  against EOCD (three variants); CD not consuming its declared size; local
  name/method/flags/encryption/CRC/size mismatches; local extra-field
  boundary escape; central record pointing into another entry; overlapping
  claimed ranges; data descriptor valid (signed + unsigned), corrupt,
  missing, and non-zeroed local fields.
- `studio.postgres.sql` (LA-1…LA-9, real PostgreSQL 17; LA-10 added by pass
  3 above) — the full lifecycle
  walk under the live claim with the trigger demanding evidence at every
  gate; **cross-job proofs: job B's VALID claim cannot index into, patch, or
  settle job A's archive (FALSE, zero rows), the composite FK rejects a
  forged (archive A, job B) entry row, and the true pair stays
  representable**; skipping straight to byte_verified; byte_verified with
  one unverified part or without archive_sha256; processing_entries with a
  wrong entry_count; completed with a pending entry; completed and rejected
  as terminal (every regression target); identity immutability under direct
  service-role SQL; 11 malformed patches + 6 malformed outcomes + malformed
  inventory payloads all raise `*_invalid` and change nothing; stale-token
  behavior unchanged throughout.
- `large-archive-migration-contract.test.ts` (15 at pass 2; 16 after pass 3)
  — static contract: the manifest identity column (retired fingerprint
  gone), UNIQUE (id, job_id), the composite FK, ownership locks in every
  RPC, the lifecycle trigger with every violation class, and pre-cast
  patch/outcome validation.
- `large-archive-memory-benchmark.test.ts` + `run-memory-benchmark.mjs` —
  the processing-only measurement of record (§8).

From corrective pass 1 (all re-proven on this revision):

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
- `zip-ranged.test.ts` (17) — streaming reader ≡ buffered reader for
  STORE and DEFLATE at 64 KiB chunk granularity; full-stream CRC/size
  verification fail-closed; output capped at the declared size; consumer
  (storage) errors propagate verbatim, never mislabelled as ZIP corruption;
  incremental CRC-32 ≡ one-shot CRC over arbitrary chunkings.
- `large-archive-processing.test.ts` (15) — oversized-entry test now proves
  extraction INTO evidence (exact size, SHA-256, per-part storage checks);
  all prior end-to-end, dedup, fail-closed, stale-token, sweep, and
  progress-privacy behavior re-proven.
- `large-archive-memory.test.ts` (2) — retained as the fast in-suite
  bounded-read regression guard (the measurement of record is the §8
  benchmark).

**Recorded measurements** (committed suites, this machine, this revision):

```
processing-only benchmark (disk-backed, forced GC, child process):
  archive=286.0MiB parts=36 entries=29 slices=8
  peakGrowth=96.2MiB (unconstrained-GC watermark)
  liveSetBetweenSlices(max, post-GC)=30.0MiB finalGrowth=-9.7MiB
  verify/exact-sha/central-directory phase peaks ≤ baseline
  largestRead=8MiB largestWrite=8MiB largestBufferedEntry=8MiB
38-part verification proof: 12/38 after slice 1 (byte_verifying),
  byte_verified only at 38/38; archive_sha256 == independent full hash
evidence proof: archive=120.0MiB slices=4 largestRead=8.0MiB
  largestWrite=8.0MiB (64 MiB entry streamed, never buffered)
interruption fixture: worker killed mid-run, stale takeover after 16 min,
  settled outcomes byte-identical after resume
```

Fresh validation, all on the corrective-pass-3 revision (exact numbers in
the PR description):

- **Full vitest**: 3371 passed / 6 skipped; the ONLY failures are the four
  **pre-existing** ones unrelated to this change
  (`src/import/importer-preflight.test.ts` fixture drift ×3 and the
  missing-`modeva`-asset environmental failure ×1) — **re-proven to fail
  IDENTICALLY at the exact base commit `5025c63`** by stashing this pass and
  re-running both files on unmodified code (same 4 tests, same assertions).
  The Studio suites (30 files, 266+ tests incl. lifecycle, migration
  contract, large-archive processing/upload/verification/evidence, manifest
  identity, scheduled runner, stale-token/concurrency, private evidence,
  ZIP safety, and Media Truth) all pass against the STRICTER fake.
- **Disposable PostgreSQL harness** (PostgreSQL 17, explicit PATH):
  complete migration chain including the reworked migration →
  `ALL STUDIO POSTGRES ASSERTIONS PASSED` (LA-1…LA-9 plus the new LA-10
  adversarial lifecycle-evidence battery with unchanged-row proofs).
- **TypeScript** `tsc --noEmit`: clean.
- **ESLint + Prettier**: clean on every file this PR touches (repo-wide
  `eslint .` carries pre-existing drift in untouched legacy files).
- **Build** (`npm run build`, Nitro → Cloudflare Workers): succeeds;
  `.output/server/wrangler.json` contains the merged
  `triggers.crons=["*/5 * * * *"]` and the server bundle contains the
  `scheduled` registration; the client bundle contains no service-role
  symbols, no private paths, and no retired-fingerprint contract (the single
  `sb_secret_` string match in the client bundle is supabase-js's own
  key-format check, present on unmodified code as well).
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
  retry and re-planning resumes (manifest-keyed). After a full page reload
  the client starts a new job; stored parts of the abandoned job stay
  privately retained. A localStorage draft-job ledger is a small follow-up.
- **Manifest computation reads the whole file once client-side** (one 8 MiB
  part at a time). On a phone this costs one sequential read + hash pass of
  the archive before the upload begins — the price of an identity that
  covers every byte; the pass is bounded-memory and the same digests double
  as the verification claims.
- **The deployed Worker's real peak memory is not claimed from local
  benchmarks.** The engine's live working set is measured at ≈ 30 MiB with
  ≤ 8 MiB single I/O lanes (§8), but the actual isolate figure under
  Workers' GC is an explicit staging-gate measurement.
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

`supabase/migrations/20260724090000_studio_large_archive_v1.sql` was
reworked IN PLACE by all three corrective passes (it has never been applied
anywhere, so the draft is still one additive migration — now with the
manifest identity column, the composite ownership constraints, and the
same-state-proof, evidence-freezing lifecycle trigger with cryptographic
manifest binding). It remains **additive, ordered after
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
