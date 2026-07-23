# Forever Media-Truth — Physical Android & iPhone Device Validation Report

**PR:** #99 — "Enforce verified sanitized public media"
**PR head under validation:** `28403b7f524e36898473277401b19458f78f7b4c`
**Correction commit:** this branch adds one narrow media-privacy fix (§9) + this report on top of the head above.
**Branch:** `codex/forever-media-truth-001` (base `main`)
**Repository:** `ForeverOs26/forever`
**Worktree:** `C:\forever-claude-pr99-review` (isolated)
**Report date:** 2026-07-23

---

## 0. Verdict

**BLOCKED — PR #99 PHYSICAL DEVICE VALIDATION INCOMPLETE — NO PRODUCTION**

- **Environment is now fully provisioned and READY** for the physical session (staging
  credentials present, staging reachable, LAN preview live). See §2–§4.
- **Automated + LIVE-staging validation of the media-truth boundary: PASS**, and it surfaced a
  **real privacy defect that has been reproduced, fixed, regression-tested, and pushed** (§9).
- **Physical Android + iPhone device session: NOT YET RUN.** It is the single remaining step
  and is the one consolidated Owner interaction (§5/§6/§7). No Android/iPhone PASS is claimed,
  because an Android/iPhone PASS may only be asserted from real physical-device evidence, which
  the Owner has not yet returned.

This report is delivered in the "prepared + handed off" state: everything an autonomous
operator can do is done, including finding and fixing a defect on live staging; the physical
camera/gallery session on real phones remains for the Owner.

---

## 1. Starting-state verification

| Check                                                | Result                                                  |
| ---------------------------------------------------- | ------------------------------------------------------- |
| Tracked worktree clean                               | ✅ no tracked changes at start                          |
| HEAD SHA                                             | ✅ `28403b7f524e36898473277401b19458f78f7b4c`           |
| PR #99 state                                         | ✅ OPEN                                                 |
| PR #99 draft                                         | ✅ `isDraft: true`                                      |
| PR #99 merged                                        | ✅ `mergedAt: null` (unmerged)                          |
| Auto-merge                                           | ✅ `autoMergeRequest: null` (disabled)                  |
| Remote branch `origin/codex/forever-media-truth-001` | ✅ same SHA (`28403b7…`)                                |
| `.env`                                               | ✅ git-ignored **and** untracked                        |
| `SUPABASE_URL` / `VITE_SUPABASE_URL` host            | ✅ exactly `garjibjhlzeljsnpzisu.supabase.co` (staging) |
| Production ref `abtvsrcnfwlbawvrjeed` in any value   | ✅ NONE — absent from every `.env` value                |
| Required runtime variables                           | ✅ all six consumed variables PRESENT (see §2)          |

### 1.1 Environment-variable presence (names + status only — no values ever printed)

The six variables the application actually consumes (verified by scanning every
`process.env.*` / `import.meta.env.*` reference in `src`) are all present:

| Variable                        | Status  |
| ------------------------------- | ------- |
| `SUPABASE_URL`                  | PRESENT |
| `SUPABASE_PUBLISHABLE_KEY`      | PRESENT |
| `SUPABASE_SERVICE_ROLE_KEY`     | PRESENT |
| `STUDIO_OWNER_USER_ID`          | PRESENT |
| `VITE_SUPABASE_URL`             | PRESENT |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | PRESENT |

> `SUPABASE_PROJECT_ID` / `VITE_SUPABASE_PROJECT_ID` appear in `.env.example` as template
> placeholders but are **not referenced anywhere in `src`**, so they are not required to run.

A hard staging-only guard was applied to every script that touches the backend: it aborts
unless `SUPABASE_URL`'s host is exactly `garjibjhlzeljsnpzisu.supabase.co` and no value
contains the production ref. Full keys were never displayed, logged, or written to any file.

---

## 2. Exact environment

| Component          | Value                                                   |
| ------------------ | ------------------------------------------------------- |
| OS                 | Windows 11 Home Single Language 10.0.26200              |
| Node.js            | v24.18.0                                                |
| Package manager    | npm 11.16.0                                             |
| App framework      | TanStack Start (React 19) + Vite 8, SSR                 |
| Backend            | Supabase (Auth + Storage + Postgres), staging project   |
| Test runner        | Vitest 3.2.7 (jsdom)                                    |
| Staging ref (used) | `garjibjhlzeljsnpzisu` — reachable, guarded             |
| Production ref     | `abtvsrcnfwlbawvrjeed` — **never contacted, forbidden** |

### 2.1 Staging baseline (recorded before any mutation, read-only)

**Database row counts**

| Table                     | Rows |
| ------------------------- | ---- |
| `projects`                | 60   |
| `project_media`           | 38   |
| `studio_upload_jobs`      | 119  |
| `studio_members`          | 5    |
| `studio_object_owners`    | 72   |
| `studio_listing_contacts` | 12   |

**Storage object counts (recursive)**

| Bucket                       | Files | Folders |
| ---------------------------- | ----- | ------- |
| `studio-uploads` (private)   | 53    | 65      |
| `project-images` (public)    | 33    | 41      |
| `project-documents` (public) | 0     | 0       |

**Staging Owner identity (confirmed, masked):** `studio_members` holds 5 rows — 1 `owner`
(user id `93acab8f…`) and 4 `trusted_publisher`. The bootstrap `STUDIO_OWNER_USER_ID` from
`.env` is **present in the roster as the `owner`**. (User ids/emails are shown only masked; no
full identifiers appear in this report.)

---

## 3. Live staging privacy-boundary probes (read-only, anonymous key)

Using the low-privilege **publishable (anon) key** as an unauthenticated client against the
real staging database:

| Probe                                                                                                      | Result                                                                                         |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Anon list of the private `studio-uploads` bucket                                                           | **0 entries** — private bucket not anonymously enumerable ✅                                   |
| Anon read of published `project_media` (safe columns `id, project_id, media_type, title, url, sort_order`) | rows visible for published projects; titles neutral ("Cover"), URLs opaque ✅                  |
| Anon read of `project_media.metadata` (explicit)                                                           | **RETURNED** (column is anon-selectable on staging) ⚠️ — see §9                                |
| Anon `SELECT *` on `project_media`                                                                         | columns exposed: `created_at, id, media_type, metadata, project_id, sort_order, title, url` ⚠️ |

The ⚠️ rows are the root of the defect in §9: on staging, `project_media.metadata` **is**
anon-selectable, because the defence-in-depth column-grant migration
`20260723130000_public_projection_privacy.sql` is — by its own header — **"intentionally
UNAPPLIED"** (it must be run through a separate authorised migration process).

---

## 4. LAN preview (phone-accessible, staging-backed) — LIVE

A Vite dev server was launched bound **only** to the private LAN interface, backed exclusively
by the staging project:

- **Phone URL:** `http://192.168.1.108:5183/`
- Bound to the Wi-Fi LAN address `192.168.1.108` only (no `0.0.0.0`, no localhost binding).
- Temporary port `5183` (`--strictPort`); server-side env injected from `.env` in-process
  (never on a command line); a hard staging-only guard runs before binding.
- No cloud deployment of any kind was performed.

> If Windows shows a one-time private-network firewall prompt for Node on first phone
> connection, the Owner should approve that single prompt. No firewall rule was created by the
> operator (that would be a system-settings change).

---

## 5. Android checklist (Android Chrome) — ready, pending Owner

Provide each file, then confirm the truthful behavior.

**Camera capture** — 1) portrait JPEG · 2) landscape JPEG · 3) a non-default EXIF orientation
(tilted capture) · **Gallery** — 4) ordinary JPEG · 5) PNG screenshot · 6) WebP · 7) a JPEG
with ordinary phone metadata (device make/model + capture time; GPS only if you are comfortable
testing a location-tagged photo) · 8) an MP4 video · 9) upload the **same** file twice
(duplicate) · 10) refresh / retry the page mid-processing.

**Expected for supported images (1–7):** upload succeeds · private original byte-identical ·
original SHA-256 + size recorded · public derivative is a **separate** object · derivative
SHA-256 + size recorded · public URL opaque (no original filename) · neutral title
("Project photo N") · **no GPS / device / capture-time / source-name / private path in public
output** · orientation visually correct · hero + gallery render · edit + reload persist · no
duplicate project/job/media/public object.

**Expected for MP4 (8):** original retained privately · neutral "kept private" warning · **no
public video object** · other valid images/data in the same job still publish.

**Duplicate (9):** neutral "duplicate skipped" warning · no second media/public object.
**Refresh/retry (10):** processing resumes/settles without creating duplicates.

---

## 6. iPhone checklist (iPhone Safari) — ready, pending Owner

1. default camera photo — **record the actual observed byte type (HEIC/HEIF vs JPEG), not the
   extension** · 2) "Most Compatible" / JPEG photo where available · 3) portrait + landscape ·
2. PNG screenshot · 5) MOV video · 6) a naturally produced HEIC/HEIF · 7) a naturally produced
   ICC / Display-P3 JPEG where available.

**Expected:** eligible JPEG/PNG becomes a sanitized **public** derivative (orientation + hero /
gallery visually correct) · **HEIC/HEIF, MOV, and ICC / Display-P3 originals remain PRIVATE**
with a neutral, understandable warning (private retention is the intended policy, not a failed
upload) · **no unsafe public object** is created · the rest of the job stays usable.

> Do not infer format from the extension. For item 1, report the observed byte type; for item
> 7, confirm the P3 image was retained privately with a color-profile warning.

---

## 7. What to return (one batch)

For every numbered item, mark **PASS** or **FAIL** and attach:
(a) the Studio result/warnings screen, (b) the public project page hero/gallery, and (c) the
public image URL bar (to confirm opacity). For any FAIL, add a one-line note of what differed.
**Do not send any real GPS value** — just note "GPS present in source: yes/no". Complete both
checklists in one sitting and return everything together.

---

## 8. Publish / reload / unpublish (staging, dedicated namespace)

Performed at the database + anon-visibility level inside a disposable namespace
`media-truth-device-gate-<timestamp>` (created and destroyed within the run):

- A temporary **published** test project + a `project_media` row were created (service role),
  never reusing a real project (dedicated test slug).
- **Published:** the anonymous client saw the project + its media row (public catalogue/route
  visibility). ✅
- **Unpublished** (`public_status → draft`): the anonymous client then saw **0** project rows
  and **0** media rows — it correctly disappeared from the public surface. ✅
- **Cleanup:** the temporary media + project rows were deleted; post-cleanup counts returned to
  the exact baseline (`projects` 60, `project_media` 38). ✅ (§11)

Full end-to-end publish → reload-in-another-session → edit-one-field → reload → unpublish on
**real device uploads** is part of the pending Owner session; the visibility contract above is
already proven live.

---

## 9. Defect found, reproduced, FIXED, and regression-tested

### 9.1 The defect (privacy — GPS/device exposure via public metadata)

PR #99's publish path (`extraction.ts`, `gatherMaterials`) writes the **full**
`MediaTruthRecord` onto the public `project_media` row:

```
metadata.studio.media_truth = derivative.record   // ← PR #99 added this
```

`MediaTruthRecord.claims` (`EmbeddedMediaClaims`) carries the **actual extracted values** of
the private original: `capture_time`, `timezone`, `device_make`, `device_model`, `software`,
and **`gps { latitude, longitude, altitude }`**. Because `project_media.metadata` is
anon-selectable on any environment where `20260723130000_public_projection_privacy.sql` is not
applied — and that migration is **intentionally unapplied** (its own header), so staging does
not have it — a published phone photo's **GPS coordinates + device make/model + capture time**
become readable by anyone holding the public anon key, via a direct PostgREST query. This is
the exact opposite of the feature's stated contract ("no source filename / GPS / device in
public output").

**Attribution:** the diff shows `media_truth: derivative.record` is a line **added by PR #99**
(the surrounding `studio: { job_id, original_name, category }` block pre-existed). So the
GPS/device exposure is a **PR #99 regression**.

### 9.2 Live reproduction (staging, disposable namespace, reversible)

In namespace `media-truth-device-gate-1784816551409`, a published test media row was created
whose `metadata.studio.media_truth.claims` mirrored a real phone capture. An **anonymous**
client then read it back:

```
LEAK CONFIRMED — anon read of project_media.metadata.studio.media_truth.claims:
   gps      = { latitude: 12.987654, longitude: 98.123456, altitude: 5 }   (synthetic test coords)
   device   = TESTMAKE_DEVICE / TESTMODEL_PHONE_9000
   capture  = 2026:07:23 10:11:12 +07:00
   software = TestCam 1.0
```

(The coordinates/device strings are synthetic test values, not real data.) The row + project
were then deleted and counts returned to baseline.

### 9.3 The narrow fix

A public-safe projection was introduced so the anon-readable row carries **no extracted
claims**, while the private studio job file record keeps the **full** record (audit intact):

- `src/features/forever-studio/server/media-truth.ts` — new
  `publicMediaTruthProjection(record)` returning `Omit<MediaTruthRecord, "claims">`.
- `src/features/forever-studio/server/extraction.ts` — the public row now stores
  `media_truth: publicMediaTruthProjection(derivative.record)` (the private record at
  `fileRecord.mediaTruth = derivative.record` is unchanged).

The non-sensitive integrity summary the code intends to keep (`original.sha256`,
`derivative.sha256`, sizes, `sanitization_succeeded`, `verification.result`) still appears on
the public row; only the source-identifying `claims` are removed.

### 9.4 Regression test

`media-truth.test.ts` now asserts, after a real publish, that the public
`project_media.metadata.studio.media_truth` has **no `claims`** and that the serialized public
metadata contains no `device_model` / `capture_time` / `gps` / `"FixturePhone 9000"`, while the
**private** job file record still retains `claims.device_model`. The suite is green (§10).

### 9.5 Pre-existing, out-of-scope (documented, not changed)

- `metadata.studio.original_name` (the raw upload filename) is written to the same public row
  **and predates PR #99**; the test suite explicitly documents this as intended
  (`media-truth.test.ts:378` asserts the filename is present in `metadata`), protected by the
  app-layer column projection + the same unapplied migration. It was therefore **not** changed
  by this fix (scope discipline).
- **Recommendation:** apply `20260723130000_public_projection_privacy.sql` through the
  authorised migration process before public launch. It REVOKEs the broad anon/authenticated
  grant and column-restricts `project_media` to `(id, project_id, media_type, title, url,
sort_order)`, closing the `metadata` (and `created_at`) vector at the database layer for
  `original_name` as well. Until then, staging exposes `project_media.metadata` to anon.

---

## 10. Automated & static validation (at the fixed tree)

| Gate                                                  | Result                                                                                                           |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| PR-scope suite (`forever-studio` + `intake/classify`) | **21 files / 209 tests — 100% pass** (incl. new regression)                                                      |
| `media-truth.test.ts`                                 | **32 pass**                                                                                                      |
| Real-browser Chromium decode smoke                    | **2 pass** (JPEG/PNG/WebP derivatives + EXIF orientations 2–8 decode)                                            |
| Cloudflare memory-boundary tests                      | **2 pass** (near-cap JPEG/PNG, no amplification)                                                                 |
| TypeScript (`tsc --noEmit`)                           | **0 errors in changed files** (only pre-existing `partner-demo-data.ts` missing-`modeva`-asset error, unrelated) |
| ESLint (3 changed files)                              | **clean (0)**                                                                                                    |
| Prettier (`--check`)                                  | **clean**                                                                                                        |
| `git diff --check`                                    | **clean**                                                                                                        |
| Privacy/secret scan of the diff                       | no real GPS, no device serials, no auth tokens/`service_role`/JWT, no absolute user paths, no production ref     |

---

## 11. Cleanup proof

- The disposable namespace's temporary public/private objects and rows were removed in the same
  run (guaranteed `finally` cleanup).
- **Post-run staging counts equal the baseline exactly** — `projects` 60, `project_media` 38 —
  and the private/public buckets were not otherwise mutated.
- No temporary test project remains publicly available; the unpublish + delete were verified.
- Unrelated staging data was untouched. Local-only artifacts (the ignored `.output/` build dir
  and transient launcher/probe scripts) are not part of the PR and were removed after use.

---

## 12. Limitations

- **No physical Android/iPhone evidence yet** — the real camera/gallery session (real HEIC,
  Display-P3, MOV, real orientation sensors, real GPS-tagged photos) is the pending Owner step.
  No Android/iPhone PASS is asserted.
- Live end-to-end publish/edit/reload was proven at the DB + anon-visibility layer; the
  full-pipeline browser upload requires an authenticated publisher session (Owner's phone).
- The Chromium decode smoke uses desktop headless Chrome as a rendering proxy, not the mobile
  Safari/Chrome engines.

---

## 13. Production safety confirmation

Production was **not** accessed and **not** changed. Production ref `abtvsrcnfwlbawvrjeed` was
never contacted; every backend script aborted unless the host was exactly the staging ref. No
production credentials were loaded; no migration, deploy, secret change, or publication touched
production. Coralina / Rainpalm / Modeva were not published. PR #99 remains **open, Draft,
unmerged, auto-merge disabled**. No force-push, no `reset --hard`, no merge.

---

## 14. Final verdict

**BLOCKED — PR #99 PHYSICAL DEVICE VALIDATION INCOMPLETE — NO PRODUCTION**

The environment is ready, staging is reachable and guarded, and automated + live-staging
validation PASSED — including finding, reproducing, fixing, and regression-testing a real
GPS/device privacy defect that PR #99 introduced. The only remaining step is the single
consolidated physical Android + iPhone session on real phones, which only the Owner can perform;
until that real-device evidence is returned, no Android/iPhone PASS is claimed.
