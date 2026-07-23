# Forever Media-Truth — Android & iPhone Device Validation Report

**PR:** #99 — "Enforce verified sanitized public media"
**PR head validated:** `28403b7f524e36898473277401b19458f78f7b4c`
**Correction commits on branch:** the narrow media-privacy fix (§9) + this report, on top of the head above.
**Branch:** `codex/forever-media-truth-001` (base `main`)
**Repository:** `ForeverOs26/forever`
**Worktree:** `C:\forever-claude-pr99-review` (isolated)
**Report date:** 2026-07-23

---

## 0. Verdict

**PR #99 DEVICE GATE PASSED — ANDROID PHYSICAL + IPHONE WEBKIT COMPATIBILITY — READY FOR OWNER REVIEW — NO PRODUCTION**

- **Android physical device session: PASS** — the Owner completed it on a real Android phone
  (Chrome). Every claim is corroborated by the live staging database, Storage, and byte-level
  inspection (§4) and matches the Owner screenshots.
- **iPhone: AUTOMATED WEBKIT/IPHONE-COMPATIBILITY PASS** (§5). A physical iPhone was **not
  available** to the Owner, so **no physical iPhone PASS is claimed**; real iPhone camera /
  file-picker behavior remains a deferred rollout gate (§12).
- **A real privacy defect that PR #99 introduced was fixed, regression-tested, and pushed** last
  pass (§9); this pass **re-proved the fix on the Owner's real published photos** — the
  extracted device/capture metadata is retained privately and is absent from every public row.
- **Staging only.** Production ref `abtvsrcnfwlbawvrjeed` was never accessed (§13).

---

## 1. Environment & identity

| Component          | Value                                                                |
| ------------------ | -------------------------------------------------------------------- |
| OS                 | Windows 11 Home Single Language 10.0.26200                           |
| Node.js / npm      | v24.18.0 / 11.16.0                                                   |
| App framework      | TanStack Start (React 19) + Vite 8, SSR                              |
| Backend            | Supabase (Auth + Storage + Postgres), **staging** project            |
| Test runner        | Vitest 3.2.7 (jsdom)                                                 |
| Browser automation | Playwright **WebKit 26.5** (iPhone 14 emulation) + headless Chromium |
| Local Postgres     | PostgreSQL 17 disposable loopback harness                            |
| Staging ref (used) | `garjibjhlzeljsnpzisu` — reachable, hard-guarded                     |
| Production ref     | `abtvsrcnfwlbawvrjeed` — **never contacted, forbidden**              |

Every backend script enforced a hard staging-only guard (aborts unless `SUPABASE_URL`'s host is
exactly `garjibjhlzeljsnpzisu.supabase.co` and no value contains the production ref). Secrets
were never printed; ids/emails/device identifiers are masked or generalised in this report.

**Starting state:** tracked worktree clean; HEAD `b2e67ba` (validated PR head `28403b7` + the
two correction commits); PR #99 OPEN / Draft / unmerged / auto-merge disabled; remote branch in
sync.

**Staging baseline (recorded before this gate):** `projects` 60, `project_media` 38,
`studio_upload_jobs` 119; Storage `studio-uploads` 53 files, `project-images` 33 files. Owner
identity confirmed: `studio_members` has the bootstrap user as `role=owner`.

---

## 2. Android physical validation — PASS

The Owner logged in to Forever Studio on **Android Chrome**, ran a **project-update** workflow,
uploaded 4 photos + 1 video, and published. Identified job: **`2a295ac3…`**
(`status=published`, `workflow=project_update`, `attempt_count=1`, created 2026-07-23 15:13Z by
the owner), targeting project `dr95-1784740628249-old-dashboard-resume` (`0543785f…`). The job
ran **after** the §9 fix was deployed to the preview, so it exercised the corrected code.

Uploaded set: **2 camera captures** (rear camera; device make/model + capture timestamps present
in EXIF), **1 messaging-app JPEG** (EXIF orientation 6), **1 PNG screenshot**, **1 MP4 video**.

### 2.1 Per-file result (DB + Storage + bytes)

| #   | Kind                      | Result              | Public derivative                     | Private original             | Notes                                     |
| --- | ------------------------- | ------------------- | ------------------------------------- | ---------------------------- | ----------------------------------------- |
| 1   | camera JPEG               | ✅ published_public | opaque `…/00-facc15a1…​.jpg`, 1.99 MB | byte-identical, SHA verified | device+capture in **private** record only |
| 2   | camera JPEG               | ✅ published_public | opaque `…/01-1ab9743a…​.jpg`, 2.28 MB | byte-identical, SHA verified | device+capture in **private** record only |
| 3   | messaging JPEG (orient 6) | ✅ published_public | opaque `…/02-a5d1ab12…​.jpg`, 0.85 MB | byte-identical, SHA verified | orientation preserved (see §2.3)          |
| 4   | PNG screenshot            | ✅ published_public | opaque `…/03-e04ef4fe…​.png`, 2.40 MB | byte-identical, SHA verified | no EXIF in source                         |
| 5   | MP4 video                 | ✅ retained PRIVATE | **none** (publicPath null)            | byte-identical, SHA verified | neutral "kept private" warning (§2.4)     |

Verified for all supported images (matches the Owner's "photos appeared on the public page,
portrait/landscape correct, gallery worked, Published"):

- **Public sanitized derivatives produced** for all 4 images; each is a separate object in the
  public `project-images` bucket. ✅
- **Original files remain in private `studio-uploads`** and are **byte-identical** — recomputed
  SHA-256 equals the recorded value for every file. ✅
- **Original + derivative SHA-256 and size are recorded** in the job's file records and the
  media-truth record. ✅
- **Public paths are opaque** — `studio/<jobId>/<attempt>/<ordinal>-<derivativeSha16>.<ext>`;
  no original filename participates. ✅
- **Public titles are neutral** — "Project photo 1…4". ✅
- **Public media contains no original filename** (URL + title opaque). ✅
- **Anonymous users cannot download the private originals** — every `studio-uploads` download
  with the public key was **DENIED**. ✅
- **No duplicates** — 4 files → 4 media rows → 4 public derivatives; single attempt, no retry
  duplication. ✅
- **Hero + gallery persisted** — project `main_image_url` set; 4 `gallery` rows; the project was
  **publicly readable** during the Owner session (anon saw all 4 rows). ✅

### 2.2 Public metadata carries no GPS/device/capture (the §9 fix, proven on real data)

The two camera captures carried **device make/model + capture timestamps** in their EXIF
(`sensitive_metadata_found=true`); the messaging JPEG carried device + orientation. All of this
is retained **only** on the private studio job record. Every public `project_media` row for this
project has:

- `metadata.studio.media_truth` **without a `claims` key** (`HAS_CLAIMS=false`) — verified via
  both the service-role and the **anonymous** read path. ✅
- **no** `gps` / `latitude` / `longitude` / `device_make` / `device_model` / `capture_time` /
  `software` token anywhere in the public row. ✅

### 2.3 Orientation preserved, no metadata in public bytes

The messaging JPEG's public derivative was downloaded and its JPEG segments parsed: its APP1
Exif block is **orientation-only** — a single IFD0 entry `Orientation=6`, and **no** GPS, Make,
Model, Software, DateTime, or MakerNote tag. The other three derivatives contained no
device/GPS/date strings at all. This is exactly the "orientation preserved as a minimal one-tag
EXIF" contract, and matches the Owner's "portrait and landscape rendered correctly". ✅

### 2.4 MP4 private-retention — PASS

The MP4 (`mediaClass=video`) stayed **private**: `status=uploaded`, `publicBucket/publicPath =
null`, the private original is retained and anon-denied, **no public object** exists for it
(only the 4 image derivatives are under the job prefix), and **no `media_type=video` row** was
created. The job produced exactly one warning — `media_sanitization_unsupported` ("Private
source file uses a format that Forever cannot safely sanitize for public delivery yet; it
remains private") — the "one note" the Owner reported. The valid images and the project still
published successfully. ✅

---

## 3. iPhone — AUTOMATED WEBKIT/IPHONE-COMPATIBILITY PASS (not a physical iPhone)

A physical iPhone was unavailable to the Owner, so this is an **automated WebKit compatibility
substitute** using Playwright **WebKit 26.5** under **iPhone 14 emulation** (390×664, Mobile
Safari UA). It is **not** a physical iPhone PASS.

| Check                                                                                         | Result                                       |
| --------------------------------------------------------------------------------------------- | -------------------------------------------- |
| WebKit decodes representative sanitized **JPEG/PNG/WebP** derivatives (real sanitizer output) | **PASS** (jpeg 1920×1280, png 2×3, webp 1×1) |
| WebKit decodes preserved **EXIF orientations 2–8**                                            | **PASS** (all decode)                        |
| WebKit renders the **live staging public gallery** hero at full resolution                    | **PASS** (3072×4096)                         |
| Gallery **persists after reload** in WebKit                                                   | **PASS**                                     |
| Public page exposes **no device/filename/date tokens** (rendered DOM)                         | **PASS**                                     |
| WebKit renders the **Studio login shell** (email + password)                                  | **PASS**                                     |

> Gallery **thumbnails** lazy-load below the short mobile fold, so only the hero is force-loaded
> in the headless run; the hero proves the sanitized derivative renders in WebKit, and the Owner
> physically confirmed gallery navigation on Android.

### 3.1 Sanitizer behavior for the iPhone formats (real PR #99 code, engine-independent)

The upload/sanitization decision is server-side Node logic (identical across browser engines).
The **actual PR #99 sanitizer** was exercised on synthetic fixtures for all eight requested
cases:

| Item | Input                          | Outcome                                                      | Result |
| ---- | ------------------------------ | ------------------------------------------------------------ | ------ |
| 1–2  | safe JPEG portrait + landscape | eligible → sanitized public derivative                       | PASS   |
| 3    | PNG screenshot                 | eligible → sanitized public derivative                       | PASS   |
| 4    | HEIC / HEIF                    | image class, **not** sanitizable → retained private          | PASS   |
| 5    | MOV / QuickTime                | video class → no image-sanitizer path → private              | PASS   |
| 6    | ICC / Display-P3 JPEG          | ineligible, reason **`color_profile_unsupported`** → private | PASS   |
| 7    | duplicate upload               | identical SHA-256 → second skipped                           | PASS   |
| 8    | mixed safe JPEG + unsupported  | eligible JPEG publishes, unsupported stays private           | PASS   |

These behaviors are additionally covered by the committed suites (`staging-verification`,
`media-truth`) and by the Owner's **live** Android job, which already proved the real
upload→sanitize→publish (JPEG/PNG) and private-retention (MP4/video) flow end-to-end on staging.

**Deferred:** real iPhone **camera capture** (genuine HEIC, Display-P3, MOV) and the iOS Safari
**file-picker** path were not exercised on a physical device; the authenticated WebKit
upload-through-UI was not driven because it requires Studio credentials the operator does not
hold and must not enter. These remain a rollout gate (§12).

---

## 4. Public privacy proof (Owner job + synthetic)

Proven for the Owner's real published media and via the synthetic sanitizer cases:

- **Private originals are not anonymously accessible** — anon download of each `studio-uploads`
  original was DENIED; anon list of the private bucket returns 0. ✅
- **`project_media.metadata` claims are not exposed by the new projection** — every public row's
  `media_truth` has no `claims` (verified via the anonymous key). ✅
- **GPS / device / capture-time / software values are absent from the public row.** ✅
- **Public image bytes contain no forbidden metadata** — sanitized derivatives carry at most a
  one-tag orientation EXIF; no GPS/device/date/MakerNote. ✅
- **Public URL / title contain no original filename.** ✅
- **MP4 / MOV / HEIC / ICC files have no public objects.** ✅
- **Only safe, supported derivatives become public.** ✅
- **SQL layer:** the disposable Postgres harness `assert_public_query_contract` confirms the
  column-restricted public projection when the (defence-in-depth) grant migration is applied.

**Pre-existing, out of scope (documented):** `metadata.studio.original_name` (the raw upload
filename) is still written to the public row — this **predates PR #99** and is asserted as
intended by an existing test. It is anon-readable on any environment where the **intentionally
unapplied** migration `20260723130000_public_projection_privacy.sql` is not applied (staging
today). **Rollout gate:** apply that migration through the authorised process before public
production rollout — it REVOKEs the broad grant and column-restricts `project_media` to
`(id, project_id, media_type, title, url, sort_order)`, closing the `original_name` vector at
the database layer.

---

## 5. Publish / reload / unpublish + cleanup

- The Owner's project was **published** and publicly readable during the session (§2); the
  public gallery rendered and reloaded in WebKit (§3).
- **Unpublished** at cleanup (`public_status → draft`): the anonymous client then saw **0**
  project rows and **0** media rows — it correctly disappeared from the public catalogue/route.
- **Cleanup evidence:** no synthetic `media-truth-device-gate-%` projects remain (0). This gate
  created **no** persistent synthetic staging rows or Storage objects. Final counts —
  `projects` 60 (= baseline), `project_media` 42, `studio_upload_jobs` 120 — differ from
  baseline **only** by the Owner's preserved evidence (+4 media, +1 job, 0 new projects). The
  Owner's media rows/objects were **preserved** as sanitized evidence, not deleted. Unrelated
  staging data (other pre-existing test projects) was left untouched.
- The Owner's device-gate project is left **unpublished**; no test project is publicly available.

---

## 6. Full validation (this pass, at the fixed tree)

| Gate                                                | Result                                                                                                                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Forever Studio + `intake/classify` suite            | **21 files / 209 tests pass**                                                                                                                                            |
| media-truth suite                                   | **32 pass** (incl. §9 regression)                                                                                                                                        |
| Chromium decode smoke (real browser)                | **pass** (JPEG/PNG/WebP + orientations 2–8)                                                                                                                              |
| **WebKit** iPhone-compat (Playwright)               | **pass** (§3)                                                                                                                                                            |
| Memory-boundary regression                          | **pass**                                                                                                                                                                 |
| Storage concurrency / replay / cleanup              | **pass**                                                                                                                                                                 |
| Public-query + Project Detail tests                 | **pass**                                                                                                                                                                 |
| Disposable PostgreSQL 17 harness (`studio:pg-test`) | **ALL STUDIO POSTGRES ASSERTIONS PASSED** (incl. `assert_public_query_contract` ×2)                                                                                      |
| TypeScript (`tsc --noEmit`)                         | **0 errors in changed files** (only the pre-existing `partner-demo-data.ts` missing-`modeva`-asset error, unrelated)                                                     |
| ESLint (changed) / Prettier / `git diff --check`    | **clean**                                                                                                                                                                |
| Nitro / Cloudflare build (`vite build`)             | **exit 0** — `wrangler.json`/`nitro.json`/`_headers` generated; **no deploy**                                                                                            |
| Diff privacy/secret/path/GPS scan                   | **clean** — no prod ref, secret, path, or coordinate                                                                                                                     |
| Generated-bundle scan                               | client bundle carries the **public** anon key only; the **service-role key value is NOT present**; no prod ref, no device/filename tokens, sanitizer version server-only |

---

## 7. The §9 fix (recap)

PR #99 originally wrote the **full** `MediaTruthRecord` (including `claims`: GPS, device
make/model, capture time, software) into the anon-readable `project_media.metadata`. Fixed by
`publicMediaTruthProjection()` = `Omit<MediaTruthRecord,"claims">` for the public row, with the
full record retained on the private job file record; a regression test asserts the public row
carries no `claims`/`gps`/`device`/`capture_time` while the private record retains them. This
pass re-proved it on the Owner's **real** photos (§2.2, §4).

---

## 8. Remaining rollout gates

1. **Physical iPhone** camera-capture + Safari file-picker (genuine HEIC/HEIF, Display-P3, MOV)
   — deferred; the Owner has no iPhone. WebKit compatibility (rendering + engine) is proven; the
   real device path is not.
2. **Apply `20260723130000_public_projection_privacy.sql`** via the authorised migration process
   before public production rollout, to close the pre-existing `original_name` (and
   `created_at`) `project_media.metadata` vector at the DB layer.

---

## 9. Production safety

Production was **not** accessed or changed. Production ref `abtvsrcnfwlbawvrjeed` was never
contacted; every backend script hard-aborts unless the host is exactly the staging ref. No
deploy, migration, secret change, or publication touched production. Coralina / Rainpalm /
Modeva were not published. PR #99 remains **open, Draft, unmerged, auto-merge disabled**. No
force-push, no `reset --hard`, no merge.

---

## 10. Final verdict

**PR #99 DEVICE GATE PASSED — ANDROID PHYSICAL + IPHONE WEBKIT COMPATIBILITY — READY FOR OWNER REVIEW — NO PRODUCTION**

Android physical evidence passes and is fully corroborated by staging database, Storage, and
byte-level inspection; the media-truth privacy defect PR #99 introduced is fixed and re-proven
on the Owner's real photos; the automated WebKit/iPhone-compatibility substitute passes (with a
physical iPhone session honestly deferred); cleanup restored staging to baseline plus only the
Owner's preserved evidence; and no unresolved PR #99 defect remains.
