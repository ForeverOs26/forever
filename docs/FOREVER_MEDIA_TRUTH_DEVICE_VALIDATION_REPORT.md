# Forever Media-Truth — Physical Android & iPhone Device Validation Report

**PR:** #99 — "Enforce verified sanitized public media"
**Exact PR head:** `8b04d869484b79719f29fb3db72acf07dc225077`
**Branch:** `codex/forever-media-truth-001` (base `main`)
**Repository:** `ForeverOs26/forever`
**Worktree:** `C:\forever-claude-pr99-review` (isolated)
**Report date:** 2026-07-23

---

## 0. Verdict

**BLOCKED — PR #99 PHYSICAL DEVICE VALIDATION INCOMPLETE — NO PRODUCTION**

- **Automated / code-level validation of the media-truth boundary: PASS** (full detail in §5–§9).
- **Physical Android + iPhone device session: NOT RUN — BLOCKED** on environment provisioning
  (no staging Supabase credentials available; production is forbidden). Detail in §3.

No PASS is claimed for Android or iPhone, because no real physical-device evidence was
produced. Per the task contract, an Android/iPhone PASS may only be asserted from real
physical evidence, which requires a staging-backed, phone-reachable preview that this
environment cannot currently stand up.

---

## 1. Starting-state verification (completed before any change)

| Check                                                | Result                                        |
| ---------------------------------------------------- | --------------------------------------------- |
| Worktree clean                                       | ✅ no tracked changes                         |
| HEAD SHA                                             | ✅ `8b04d869484b79719f29fb3db72acf07dc225077` |
| PR #99 state                                         | ✅ OPEN                                       |
| PR #99 draft                                         | ✅ `isDraft: true`                            |
| PR #99 merged                                        | ✅ `mergedAt: null` (unmerged)                |
| Auto-merge                                           | ✅ `autoMergeRequest: null` (disabled)        |
| Remote branch `origin/codex/forever-media-truth-001` | ✅ same SHA (`8b04d869…`)                     |
| Newer commits                                        | ✅ 0 ahead / 0 behind remote                  |
| Base branch                                          | `main`                                        |

No code was modified before this verification. No defect requiring a code correction was
found (see §11), so this branch carries only this validation report as an additive commit.

---

## 2. Exact environment

| Component                           | Value                                                              |
| ----------------------------------- | ------------------------------------------------------------------ |
| OS                                  | Windows 11 Home Single Language 10.0.26200                         |
| Node.js                             | v24.18.0                                                           |
| Package manager                     | npm 11.16.0 (repo also carries `bun.lock`)                         |
| App framework                       | TanStack Start (React) + Vite 7, SSR                               |
| Deploy target                       | Nitro → Cloudflare Workers preset (`.output/server/wrangler.json`) |
| Backend                             | Supabase (Auth + Storage + Postgres)                               |
| Test runner                         | Vitest 3.2.7 (jsdom)                                               |
| Local Postgres (disposable harness) | PostgreSQL 17 (`C:\Program Files\PostgreSQL\17\bin`)               |
| Headless decode engine              | Google Chrome (stable), Windows, `--headless=new --dump-dom`       |

### Staging / production identity

| Identity               | Ref                    | Status in this run                                                                                                                                      |
| ---------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `forever-staging`      | `garjibjhlzeljsnpzisu` | **Not reachable** — no credentials present anywhere in the worktree, shell, `.dev.vars`, or wrangler config                                             |
| production (FORBIDDEN) | `abtvsrcnfwlbawvrjeed` | Present only in `supabase/config.toml`, `supabase/.temp/project-ref`, and the _main-repo_ `.env` (outside this worktree). **Never loaded, never used.** |

**Proof no production credentials were loaded into any test process:** the isolated worktree
contains only `.env.example` (placeholder values). No `.env` / `.dev.vars` exists in the
worktree. No `SUPABASE_*` / `STUDIO_*` variables were exported into any test, build, or
harness process. The disposable Postgres harness runs a throwaway loopback cluster with **no
linked project and no network connection** (see §6). The Nitro build ran with no Supabase
environment. At no point was ref `abtvsrcnfwlbawvrjeed` contacted.

---

## 3. Physical-device session status — BLOCKED (why, and how to unblock)

The physical Android + iPhone session requires a **phone-reachable URL backed by the staging
Supabase project** so that real camera/gallery uploads exercise the true
`private original → verified private source → private metadata → sanitized public derivative`
flow (Auth + private `studio-uploads` bucket + public `project-images` bucket + `project_media`).

This environment cannot currently prepare that preview:

1. **No staging credentials.** Ref `garjibjhlzeljsnpzisu` has no URL/keys in the worktree,
   shell env, `.dev.vars`, or wrangler config.
2. **Only production credentials exist**, and they are explicitly forbidden. A phone-facing
   test preview will **not** be pointed at production ref `abtvsrcnfwlbawvrjeed`.
3. **No local Supabase emulation path.** Supabase CLI is not installed; the Docker daemon is
   not running — so a local Supabase (Auth/Storage/DB) stack cannot be brought up either.
4. A credential-less LAN preview would boot the marketing/catalogue UI but could not
   authenticate a publisher, write to Storage buckets, or persist `project_media` — i.e. it
   cannot exercise the subject of this validation.

**Device models / OS / browser versions:** _not applicable — the session was not run._

### Unblock steps (single Owner-provisioning step, then the §4/§5 checklists run in one sitting)

1. Place staging credentials for `garjibjhlzeljsnpzisu` into `C:\forever-claude-pr99-review\.env`
   (or `.dev.vars`): `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   (server-only), and the one-time `STUDIO_OWNER_USER_ID` (or `STUDIO_OWNER_EMAIL`) bootstrap.
   Mirror the browser-visible values into the `VITE_SUPABASE_*` equivalents.
2. Approve, once, the Windows private-network prompt for the local preview port.
3. The device-gate operator then re-runs the preparation, which binds a LAN preview, records
   the staging baseline (row + Storage counts) under a unique test namespace
   `media-truth-device-gate-<timestamp>`, and hands the Owner the §4/§5 checklists.

Until step 1 is provided, the device gate remains BLOCKED by design (no production fallback).

---

## 4. Android checklist (ready to run once §3 is unblocked) — NOT YET EXECUTED

Android Chrome. Each row lists the file to provide and the truthful behavior to confirm.

**A. Camera capture**

1. Portrait JPEG (rear camera).
2. Landscape JPEG.
3. Photo with a non-default EXIF orientation (rotate the phone / use a tilted capture).
4. A photo below the 64 MP / 12,000 px limit (any normal phone photo).

**B. Gallery upload**

5. Ordinary JPEG.
6. PNG screenshot.
7. WebP image.
8. A JPEG containing ordinary phone metadata (device make/model, capture time; GPS if you
   have a location-tagged photo you are comfortable testing with).
9. An MP4 video.

**Expected supported-image behavior (1–8, images):** upload succeeds · private original
byte-identical · original SHA-256 + size recorded · public derivative is a _separate_ object ·
derivative SHA-256 + size recorded · public URL is opaque (no original filename) · neutral
title ("Project photo N") · no GPS / device / capture-time / source-name / private path in
public output · orientation visually correct · hero + gallery render · edit + reload persist ·
no duplicate project / job / media row.

**Expected MP4 behavior (9):** job succeeds · original retained privately · neutral
"remains private" warning · **no public video object created** · other valid content in the
same job still publishes.

**Return for each:** a screenshot of (a) the Studio result/warnings, (b) the public
project page hero/gallery, and (c) the public image URL bar (to confirm opacity). Do **not**
return any real GPS value — just note "GPS present in source: yes/no".

---

## 5. iPhone checklist (ready to run once §3 is unblocked) — NOT YET EXECUTED

iPhone Safari.

1. **Default camera photo** — after upload, record whether the actual bytes were **HEIC/HEIF
   or JPEG** (determined from the stored bytes, not the extension).
2. **"Most Compatible" / JPEG** capture or export.
3. **PNG** screenshot.
4. **Portrait and landscape** orientations.
5. **MOV** video.
6. **Display-P3 / ICC-bearing JPEG** where the device naturally produces one.

**Expected — JPEG / PNG / WebP without an unsupported color profile:** sanitized derivative
becomes public · orientation visually correct where the browser honors preserved metadata ·
hero/gallery persists after edit + reload.

**Expected — HEIC/HEIF, MOV, and ICC / Display-P3 media:** original uploads and is retained
**privately** · **no unsafe public object** created · neutral, understandable warning · the
rest of the project/job stays usable. Private retention here is the intended privacy policy,
**not** a failed upload.

**Return:** the same three screenshots as Android, plus for item 1 the observed byte type
(HEIC vs JPEG), and for item 6 confirmation that the P3 image was retained privately with the
color-profile warning.

> Send the completed Android + iPhone screenshots back in **one** batch; the checklists are
> designed to be completed in a single sitting.

---

## 6. Automated & code-level validation (COMPLETED) — evidence

### 6.1 Test suites

| Suite                                                              | Result                                                                                           |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| **PR #99 scope** (`forever-studio` + `intake/classify`), isolated  | **21 files / 209 tests — 100% pass**                                                             |
| `media-truth.test.ts` (media-truth suite)                          | **32 pass**                                                                                      |
| `media-decode-smoke.test.ts` (Chromium decode smoke, real browser) | **2 pass** (30.0 s)                                                                              |
| `media-memory.test.ts` (memory regression)                         | **2 pass**                                                                                       |
| `staging-verification.test.ts`                                     | **16 pass**                                                                                      |
| `storage-concurrency.test.ts` (attempt cleanup / no duplicates)    | **8 pass**                                                                                       |
| `migration-contract.test.ts` (public-projection contract)          | **27 pass**                                                                                      |
| Full repository suite                                              | 3271 pass · 5 skip · **3 fail** — all 3 failures pre-existing and unrelated to PR #99 (see §6.6) |

### 6.2 Chromium decode smoke (real rendering evidence, credential-free)

`media-decode-smoke.test.ts` runs the **actual sanitizer output** through a real headless
Chrome and asserts a successful decode:

- Representative sanitized **JPEG, PNG, WebP** derivatives all decode with valid natural
  dimensions.
- **Every preserved EXIF orientation 2–8** decodes successfully — i.e. the minimal one-tag
  orientation the sanitizer re-emits is honored by a real browser engine. This is the
  strongest credential-free proxy for "public rendering + orientation correct" and directly
  supports the §4/§5 orientation expectations.

### 6.3 Disposable local PostgreSQL harness (public-boundary SQL proof)

`node scripts/studio/run-postgres-tests.mjs` — throwaway loopback cluster, **no linked
project, no network**. Applied the bootstrap prerequisites + the **full committed migration
chain (21 migrations, ending at `20260723130000_public_projection_privacy.sql`)**, then ran
the behavioral suite:

```
[studio-pg] running behavioral suite
 assert_true … (×17)
 assert_public_query_contract … (×2)
result: ALL STUDIO POSTGRES ASSERTIONS PASSED
[studio-pg] PASS   (exit 0)
```

`assert_public_query_contract` confirms the anon/authenticated public projection is
column-restricted at the database layer (see §8).

### 6.4 Static gates

| Gate                                               | Result                                                                                                                                                           |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript (`tsc --noEmit`)                        | **0 errors in PR #99 scope.** The only error is pre-existing and outside scope: `partner-demo-data.ts` imports an absent `forever-data/projects/modeva/**` file. |
| ESLint (all 19 changed files)                      | **clean (0)**                                                                                                                                                    |
| Prettier (`--check`, changed files)                | **clean — "All matched files use Prettier code style"**                                                                                                          |
| Nitro / Cloudflare build (`npm run build`)         | **exit 0** — Cloudflare Workers preset; `.output/server/wrangler.json`, `.output/public/_headers`, `.output/nitro.json` generated. (Build only; **no deploy.**)  |
| `git diff --check` (whitespace / conflict markers) | **clean**                                                                                                                                                        |

### 6.5 Privacy / secret / path / GPS scans of the PR diff

- No absolute user paths introduced except **synthetic adversarial test fixtures** in
  `media-truth.test.ts` (deliberately hostile filenames containing path-, email-, phone-,
  and unicode-shaped strings such as "family photo" / "secret" written in other scripts) used
  to prove the sanitizer/warning layer strips **all** original-filename content from public
  output. These are test inputs, not real data.
- **No real GPS coordinate pairs**, no device serial numbers, no auth tokens, no
  `service_role`/JWT/`sk_` secrets, and no reference to production ref
  `abtvsrcnfwlbawvrjeed` were introduced by the PR.

### 6.6 The 3 whole-suite failures are pre-existing and unrelated to PR #99

| Failing test                                                 | Root cause                                                                                                                                                                                                                           | Related to PR #99?                                                |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `project-detail/partner-demo-data.test.ts`                   | Static import of `forever-data/projects/modeva/source/brochure/…jpg` and `…/extracted/price-list.json` — the entire `modeva` dataset is absent from this worktree (`forever-data/projects/` has only `coralina`, `rainpalm-villas`). | **No** — file not touched by PR #99; missing data asset.          |
| `import/importer-preflight.test.ts` (×3, "coralina" dry-run) | `importProject("coralina")` returns `status:"blocked"` with zero counts — the Coralina source dataset / DB state required by the preflight is not present.                                                                           | **No** — `src/import/**` not touched by PR #99; missing data/env. |

Proof of independence: `git diff main...HEAD` does **not** touch `src/import/**`,
`partner-demo-data.*`, or `forever-data/**`; and neither failing test imports anything from
the PR #99 (`forever-studio` media-truth) scope.

---

## 7. Format-by-format expected outcomes (from the shipped code + passing tests)

These are the truthful behaviors the shipped `media-truth.ts` + `extraction.ts` enforce and
that the §6 suites exercise. The physical device session (§4/§5) will confirm them end-to-end
on real files.

| Input                                                | Eligible for public derivative? | Behavior                                                                                                                                          | Enforced at                                       |
| ---------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| JPEG (baseline/progressive)                          | ✅                              | container rewritten; EXIF/APP1, IPTC/APP13, COM stripped; JFIF canonicalized (thumbnail removed); orientation preserved as a minimal one-tag EXIF | `rewriteJpeg`                                     |
| PNG                                                  | ✅                              | eXIf/tEXt/zTXt/iTXt/tIME + unknown ancillary chunks stripped; render allow-list only; orientation preserved                                       | `rewritePng`                                      |
| WebP                                                 | ✅                              | EXIF/XMP + unknown chunks stripped; VP8X flags rebuilt; orientation preserved                                                                     | `rewriteWebp`                                     |
| JPEG/PNG/WebP with **ICC / Display-P3** profile      | ❌ retained private             | dedicated `color_profile_unsupported` reason (NOT "malformed"); neutral warning; no public object                                                 | `rewriteJpeg/Png/Webp` → `createPublicDerivative` |
| HEIC / HEIF                                          | ❌ retained private             | detected as image by `ftyp` brand but content-type not in the sanitize set → `unsupported_format`; original stays private                         | `detectMediaClass` + `createPublicDerivative`     |
| MP4 / MOV / MKV / WebM video                         | ❌ retained private             | publishable _class_ video, but no sanitizer → `unsupported_format`; **no public video object**                                                    | `extraction.ts` derivative loop                   |
| Over 64 MP or > 12,000 px/side                       | ❌ retained private             | decode-bomb guard rejects; `over_limit`/parse-reject; original private                                                                            | `withinPixelBounds`                               |
| Over 24 MiB compressed                               | ❌ retained private             | `over_limit`; original private                                                                                                                    | `createPublicDerivative`                          |
| Malformed / structurally invalid                     | ❌ retained private             | fail-closed; `malformed_media`; original private                                                                                                  | parsers + verifier                                |
| Duplicate of an already-seen original (same SHA-256) | skipped                         | neutral "duplicate skipped" warning; no second media/public object                                                                                | `seenHashes`                                      |
| Class/role mismatch (e.g. PDF named as photo)        | ❌ retained private             | `media_class_mismatch`; original private                                                                                                          | `isPublishableMediaClass`                         |

---

## 8. Database, Storage & public-boundary proof (code + SQL level)

Verified without touching staging:

- **Every file lands private first** in `studio-uploads`; only sanitized + verified image
  derivatives are uploaded to public buckets (`extraction.ts` — `declareJobFiles`,
  `PRIVATE_SOURCE_BUCKET`).
- **Original byte-identity** is re-checked (`size` + full SHA-256) _before_ any rewrite; the
  original SHA-256 and size are recorded in `MediaTruthRecord.original`
  (`media-truth.ts:1097`, `:1155`).
- **Derivative is a separate object** with its own recorded SHA-256 + size
  (`media-truth.ts:1156`).
- **Public path is opaque** — derived only from `jobId` + processing-token attempt prefix +
  ordinal + `derivativeSha256[:16]`; **no original filename** participates
  (`publicPathForDerivative`, `extraction.ts:126`). Public **title** is neutral
  ("Project photo N", etc.).
- **Original filenames are stripped from warnings** (`fileWarning` replaces the filename with
  "Private source file", `extraction.ts:466`).
- **Post-upload re-verification**: after uploading a public derivative, the stored object is
  re-hashed and its SHA-256/size/media-class/content-type must match, else it is **removed**
  (`extraction.ts:957`) — so no stale/corrupt public object survives.
- **`project_media.metadata` is not selectable by anon/authenticated.** The public read path
  selects only `id, media_type, title, url, sort_order`
  (`project-detail-service.ts:15`); migration `20260723130000_public_projection_privacy.sql`
  REVOKEs the broad grant and column-restricts `project_media` to
  `(id, project_id, media_type, title, url, sort_order)`. The private
  `metadata.studio.media_truth` / `original_name` never enter the public projection. Proven
  by the Postgres harness `assert_public_query_contract`.
- **Independent second-gate verification** (`verifyPublicDerivative`) re-parses the _final_
  derivative bytes and rejects any forbidden segment/chunk, dimension change, or orientation
  drift, before the record is marked verified (`media-truth.ts:963`).

---

## 9. Duplicate / retry / concurrency (code + tests)

- **Duplicate original** (same SHA-256) → skipped with a neutral warning; no duplicate media
  row and no duplicate public object (`seenHashes`, `extraction.ts:867`).
- **Concurrent / retried attempts** write only under their own processing-token-scoped
  immutable prefix; a losing/stale attempt removes only its own objects — proven by
  `storage-concurrency.test.ts` (8 tests incl. multi-bucket cleanup) and the resume/retry
  idempotency tests in `orchestrator.test.ts` / `resume.test.ts`.
- **A single failed file is a warning + private retention, never a job failure** — valid
  files in the same job still publish (`extraction.ts` design; exercised across the studio
  suites).

Full end-to-end duplicate/retry/refresh-during-processing behavior on real devices (§8 of the
task) will be confirmed in the physical session once §3 is unblocked.

---

## 10. Publish / unpublish / reload — NOT YET EXECUTED (requires staging)

Deferred to the physical session (staging-only). The public read/unpublish column contract is
already proven at the SQL level (§8); the live catalogue/direct-route/sitemap behavior needs
the staging backend.

---

## 11. Defect policy outcome

No repository defect was found. The media-truth boundary is a pure, deterministic,
fail-closed implementation whose truth claims are covered by the passing §6 suites. The two
whole-suite failures are pre-existing missing-data issues outside PR #99's scope (§6.6).
Therefore **no code correction was made**, and this branch receives only this additive
validation-report commit. Scope was not broadened.

---

## 12. Cleanup proof

No staging or production data was created, mutated, published, or deleted — the device
session that would have created the `media-truth-device-gate-<timestamp>` namespace was not
run. There is therefore nothing to clean up in staging, and staging baselines are unchanged
by definition. Local artifacts only: a disposable Postgres cluster (auto-removed by the
harness) and the local `.output/` build directory (gitignored, not part of the PR). No
unrelated Owner files were touched.

---

## 13. Limitations

- **No physical Android/iPhone evidence** was produced (device session blocked, §3). No
  Android or iPhone PASS is claimed.
- Real-camera artifacts that only a physical device produces — genuine HEIC from an iPhone,
  Display-P3 JPEGs, real orientation sensors, real MOV/MP4 — were **not** exercised
  end-to-end; their handling is shown at the code + synthetic-fixture level only.
- The Chromium decode smoke uses desktop headless Chrome as a rendering proxy, not the actual
  mobile Safari/Chrome engines.
- Live staging Storage/DB/public-route behavior (§8 live checks, §10) was proven only at the
  code + disposable-Postgres level, not against `garjibjhlzeljsnpzisu`.

---

## 14. Production safety confirmation

Production was **not** accessed and **not** changed. Production ref `abtvsrcnfwlbawvrjeed` was
never contacted; no production credentials were loaded into any process; no migration, deploy,
secret change, or publication touched production. PR #99 remains **open, Draft, unmerged, with
auto-merge disabled**. No force-push, no `reset --hard`, no merge.

---

## 15. Final verdict

**BLOCKED — PR #99 PHYSICAL DEVICE VALIDATION INCOMPLETE — NO PRODUCTION**

Automated and code-level validation of the media-truth boundary PASSED in full. The physical
Android + iPhone device gate is blocked solely on staging-credential provisioning (§3); once
staging credentials for `garjibjhlzeljsnpzisu` are supplied, the §4/§5 checklists can be
completed in a single Owner session and this report updated with real device evidence.
