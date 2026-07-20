# TG-WATCH-001A — Transport-Independent Offline Watcher Core: Architecture and Implementation Package

Status: Proposed architecture and implementation package for Owner review and Codex implementation. Not implemented, not tested, not validated. No Telegram authentication, network access, production access, import, or publication is performed or authorized by this document.

Authority: `docs/CURRENT_STAGE.md` active checkpoint **TG-WATCH-001 — Universal Read-Only Telegram Source Watcher Design and Safe Pilot**, at main commit `141dc94a544761d16460cf92c180df8968c648c7`. SIP-001A and SIP-001B remain canonical. Coralina remains unpublished; Rainpalm remains unimported and unpublished; Partner Demo remains canonical; Factory remains A0 — Propose only.

---

## 1. Executive architecture decision

TG-WATCH-001A builds **one transport-independent offline watcher core** under `src/watcher/`, exercised exclusively through an **offline replay transport** that reads synthetic fixture events from local JSON — no Telegram client, credential, session, or network access exists anywhere in TG-WATCH-001A.

The single pipeline is:

```
offline replay transport
  → normalized source event (the frozen transport boundary)
  → registry validation (allowlist; unregistered channels rejected)
  → quarantine staging (temp dir, bounded read)
  → SHA-256 + exact byte-count verification
  → content deduplication (content-addressed store)
  → deterministic classification (registry policy + MIME + extension + bounded keywords)
  → durable machine-readable receipt (atomic write)
  → per-channel state advancement (atomic, monotonic, receipt-gated)
  → Owner-review summary (CLI, exception-oriented)
```

The later live Telegram transport (TG-WATCH-001B) plugs in **only** at the normalized-source-event boundary: it must emit the same `WatcherSourceEvent` objects the replay transport emits, and nothing downstream of that boundary may know which transport produced an event.

Core decisions:

1. **Reuse Forever primitives, do not build a parallel platform.** Path safety, atomic JSON output, per-directory locking, SHA-256-of-JSON, source-integrity fingerprints, canonical serialization, and filename-safety rules are all reused from `src/intake/` and `src/import/` (exact citations in §2). Only genuinely new concerns (registry, event contract, quarantine content store, per-channel state, classifier, receipts) are watcher-owned.
2. **Recommended future live transport: GramJS (npm `telegram`, pure-TypeScript MTProto) as primary; TDLib JSON (`tdl` + prebuilt tdjson) as fallback.** Bot API is disqualified (§3). Neither transport is installed or initialized in TG-WATCH-001A.
3. **Identity is two-layered**: message-attachment identity (`registry_id + message_id + attachment_index + revision`) drives idempotent replay; content identity (SHA-256 of finalized bytes) drives deduplication. Filenames, timestamps, and byte sizes are never identity.
4. **Classification only recommends a processor.** It never executes SIP, import, or publication. Every non-duplicate outcome requires Owner review in the pilot.
5. **No repository writes during normal watcher operation.** All watcher output lives under an Owner-configured quarantine root outside the repository; tests use temporary directories.

---

## 2. Existing Forever primitives to reuse

Verified against the repository at `141dc94`. Three tiers: direct reuse, small shared extraction, watcher-owned.

### 2.1 Direct reuse (import as-is via `@/` alias)

| Concern | Module | Exports to reuse |
| --- | --- | --- |
| Safe path handling | `src/intake/paths.ts` | `IntakePathError`, `isStrictlyInside(child, parent)`, `isSamePath(a, b)`, `assertSafeSlug(slug)`, `isFilesystemRoot(p)`, `assertPathBoundaries(input)`, `removeManagedDir(target, allowedParents, forbidden)` |
| Atomic JSON output | `src/intake/fs-utils.ts` | `toCanonicalJson(value)`, `atomicWriteFile(targetPath, contents)`, `atomicWriteJson(targetPath, value)`, `removeDirSafe(dir)`, `toLogicalPath(...segments)` |
| Filename/entry-name safety (traversal, control chars, Windows-invalid chars `<>:"\|?*`, absolute/drive/UNC paths, `.`/`..` segments, trailing dot/space, reserved device names CON/PRN/AUX/NUL/COM1–9/LPT1–9) | `src/intake/zip.ts` | `assertSafeEntryName(rawName, maxPathLength?)`, `safeJoinInside(destDir, entryName, maxPathLength?)`, error-class family precedent (`ZipError`, `ZipTraversalError`, `ZipLimitError`, `ZipUnsupportedError`) |
| Locking + stale-lock recovery | `src/intake/txn.ts` | `acquireProjectLock(dir)`, `releaseProjectLock(dir)`, `LOCK_DIRNAME`, `STALE_LOCK_MS` — applied to the quarantine root (one watcher process at a time), same mkdir-exclusive + pid-liveness + owner-token semantics proven by `src/intake/tests/lock-process.test.ts` |
| Deterministic JSON hashing | `src/intake/sip/artifacts.ts` | `sha256OfJson(value)` |
| Source-integrity fingerprints | `src/intake/sip/source-integrity.ts` | `SourceFileFingerprint`, `SourceIntegrityError`, `fingerprintSourceFile(path)`, `assertSourceUnchanged(before, path)`, `processWithSourceIntegrity(path, processor)` |
| Canonical/deterministic serialization | `src/import/persistence-projection.ts` | `canonicalJson(value)`, `canonicalJsonString(value)`, `slugify(value)` |
| CLI argument-parsing convention | `src/intake/cli-args.ts` | Result-union pattern `{ ok: true; options } \| { ok: false; error }`, `--flag=value` and `--flag value`, repeatable flags — copied structurally, watcher-owned parser |
| CLI bootstrap convention | `src/intake/run-cli.mjs`, `src/intake/sip/run-cli.mjs` | jiti bootstrap with `alias { "@": srcRoot }`; watcher copies this file shape verbatim |
| Exit-code convention | `src/intake/run.ts` catch block | 0 success; 2 validation; 3 conflict; 4 locked; 5 unrecoverable; 1 otherwise — watcher maps its own error classes onto the same numbers |
| Test conventions | `src/intake/tests/*` | `mkdtempSync(join(tmpdir(), ...))` + `rmSync` teardown; deterministic injected clock (`FIXED_NOW`); fail-closed no-network/no-DB guard pattern from `src/intake/tests/local-only.test.ts`; crash/failpoint hook pattern from `txn.ts` (`TxnHooks`-style `failAt`/`crashAt`); synthetic hostile-fixture builder precedent `src/intake/tests/zip-writer.ts`; fixture-support module precedent `src/intake/sip/tests/test-support.ts` |

### 2.2 Small shared extraction (flagged, optional — Codex decides with Owner)

| Item | Current location | Note |
| --- | --- | --- |
| Streaming SHA-256 file hash (`hashFile`) | module-private in `src/intake/inventory.ts` | Either export it from `inventory.ts` (one-line change) or keep the watcher-owned `hashFileSha256` draft in §11.5. Recommendation: **watcher-owned** copy with a bounded-read size limit (the intake version has no max-bytes guard), so `src/intake/` stays untouched. |
| `TELEGRAM_PUBLIC_CHANNEL_PATTERN` (`/^@[A-Za-z][A-Za-z0-9_]{4,31}$/`) | module-private in `src/intake/sip/update-package.ts:31` | Re-declared as exported `WATCHER_CHANNEL_USERNAME_PATTERN` in `src/watcher/types.ts`. Deliberate small duplication; later extraction to a shared module is optional. |
| `SHA256_PATTERN` (`/^[a-f0-9]{64}$/`) | module-private in `src/intake/validate-draft.ts` and `src/intake/sip/update-package.ts` | Re-declared as exported `SHA256_HEX_PATTERN` in `src/watcher/types.ts`. Same rationale. |

### 2.3 Watcher-owned (new implementations)

Channel registry schema + validation; normalized source-event contract; offline replay transport; quarantine content store (staging → verify → content-addressed finalize); duplicate-identity helpers; deterministic classifier; per-channel durable state; receipts and Owner summary; orchestrator; display-filename sanitizer (a *transforming* sanitizer for metadata display, distinct from `zip.ts`'s *rejecting* validator, which it delegates to for safety checks).

### 2.4 Explicitly not reused

- `src/intake/txn.ts` journal phases (`TxnJournal`, `commitArtifacts`, `reconcileProject`) — intake-artifact-specific (5 fixed artifacts, backup/install swap). The watcher's finalize is simpler (content-addressed, rename-once, idempotent) and does not need a multi-artifact swap journal. The *lock* from the same file is reused.
- `src/intake/classify.ts` — different taxonomy (draft-import folders). Its precedence structure (ordered rule lists, extension dictionaries) is copied as a pattern only.
- `src/import/transaction-executor.ts`, `src/import/collision-inspector.ts`, `src/import/database.ts` — database execution machinery; the watcher never touches a database.
- `src/factory/continue-forever/atomic-lock.ts` — Factory run-lock store; heavier than needed. `txn.ts`'s lock suffices.
- `zod` — present in `package.json` but the intake/import engines use hand-rolled validation exclusively; the watcher follows the engine convention (hand-rolled guards, string error codes, custom `Error` subclasses).

---

## 3. Telegram transport comparison (future TG-WATCH-001B — not installed now)

| Criterion | 1. TDLib JSON (tdjson via `tdl`) | 2. MTProto TS client (GramJS, npm `telegram`) | 3. Bot API |
| --- | --- | --- | --- |
| Public channels via user account | Yes (full user API) | Yes (full user API) | **No** — a bot only sees channels where it is an admin; it cannot join or read arbitrary public channels. Disqualifying: developers will not add our bot as admin. |
| Windows deployment | Native `tdjson.dll` (prebuilt or C++ build), FFI binding | Pure JS/TS — `npm install` only | HTTPS only |
| Native binary requirement | Yes (largest operational risk on the Owner's Windows machine) | None | None |
| Node/TS integration | Third-party binding (`tdl`); JSON interface, weaker typing | First-class TypeScript, typed API | Trivial |
| Update ordering | Handled internally by TDLib (persistent local DB, ordered updates) | Raw updates exposed; ordering is app responsibility — **neutralized by our design**: the core is poll/backfill-driven from its own per-channel cursor, not push-dependent | Ordered `getUpdates`, but only bot-visible |
| Gap recovery after downtime | Built-in (TDLib replays difference) | `catchUp` support plus explicit history backfill from `last_processed_message_id` — again the core's own cursor makes this deterministic | None for non-admin channels |
| Edited / deleted posts | Full events | Full events (`UpdateEditChannelMessage`, `UpdateDeleteChannelMessages`) + edit dates on fetched history | Only where bot is admin |
| File downloading | Built-in file manager (resume, parts) | `downloadMedia` with app-side retry; adequate for our bounded sizes | `getFile` capped ~20 MB — disqualifying for construction videos |
| Encrypted session storage | Local TDLib DB supports `database_encryption_key` | Session serialization is plaintext by default → **watcher must encrypt at rest** (Owner-protected local store, e.g. DPAPI/passphrase-wrapped file outside Git) | Bot token only |
| Maintenance risk | TDLib official and active; Node binding third-party; native rebuilds on updates | Community-maintained, widely used, pure TS; no binary churn; `bunfig.toml` `minimumReleaseAge = 86400` supply-chain guard applies | Lowest, but unusable |
| Impact if session stolen | Full account takeover — equal | Full account takeover — equal. Mitigation identical: dedicated Forever account, minimal contacts, 2FA, encrypted session outside Git | Bot token abuse only |
| Constraining logic to allowlisted registry | App-level in all cases — our pipeline enforces the registry regardless of transport | Same | Same |
| 12–15 Title channels, other developers later | Fine | Fine (polling + FLOOD_WAIT backoff) | No |

**Recommendation for TG-WATCH-001B:**

- **Primary: GramJS** (`telegram` npm package). Pure TypeScript, zero native binaries on the Owner's Windows machine, first-class typing under the repo's strict TS, and a small adapter surface because the offline core already owns ordering, cursoring, dedup, and recovery. Its weaker built-in gap recovery is irrelevant to a cursor-driven poll/backfill design.
- **Fallback: TDLib JSON via `tdl` + prebuilt tdjson**, if GramJS proves unreliable for update delivery or long-session stability at 12–15 channels. Its built-in ordering/gap machinery is the strongest, at the cost of a native DLL and third-party FFI binding.
- **Rejected: Bot API** — cannot read third-party public channels without admin rights and cannot download large media.

Neither transport is installed, initialized, or configured in TG-WATCH-001A.

---

## 4. Offline-core architecture

### 4.1 Modules and dependency direction

```
src/watcher/
  types.ts        ← leaf: constants, shared types, error classes, patterns
  registry.ts     → types
  event.ts        → types, registry (id/username patterns only)
  filename.ts     → types, @/intake/zip (assertSafeEntryName)
  hash.ts         → types (node:crypto, node:fs)
  quarantine.ts   → types, hash, @/intake/{paths,fs-utils}
  dedupe.ts       → types
  classify.ts     → types, registry (entry type), dedupe (DuplicateState)
  state.ts        → types, @/intake/fs-utils, quarantine (layout)
  receipt.ts      → types, classify, dedupe, quarantine
  transport/replay.ts → types, event (validation only)
  run.ts          → everything above + @/intake/txn (lock)
  cli-args.ts     → types
  cli.ts          → cli-args, run       (not exported from index.ts)
  index.ts        ← barrel (everything except cli.ts, per intake convention)
```

Rules: dependencies point downward only; `transport/replay.ts` may import `event.ts` and `types.ts` **only** (this is the frozen boundary the live transport will also honor); no watcher module imports `run.ts`; no module outside `src/watcher/` is modified except the two integration points listed in §10.

### 4.2 Pipeline (one message, one channel)

1. **Transport** yields `WatcherSourceEvent` objects in ascending `message_id` per channel (replay transport sorts and validates its fixture file; the live transport must do the same from its own fetch).
2. **Registry validation**: event `registry_id` + `channel_username` must match an enabled registry entry exactly; unregistered or disabled channels produce a rejection receipt line and advance nothing.
3. **Quarantine staging**: each attachment's bytes are copied from the transport (replay: fixture blob file) into `staging/<uid>/` under the quarantine root via bounded read; symlinks/reparse points refused; max-size enforced during the read, not after.
4. **Verification**: SHA-256 + exact byte count computed during the same bounded read; mismatch with `reported_byte_size` (when present) fails the attachment.
5. **Deduplication**: content identity (SHA-256) checked against the content store; message-attachment identity checked against per-channel state (`recent_message_keys` + receipts).
6. **Classification**: deterministic (registry policy + MIME + extension + bounded filename/caption keywords + media class). Recommendation derived; never executed.
7. **Receipt**: one machine-readable JSON receipt per attachment (and one per text-only/edit/delete event), written atomically before any state advance.
8. **State advancement**: `last_processed_message_id` advances monotonically only after every attachment of the message is finalized (or terminally rejected) and the receipt is durable. Failures leave the cursor untouched → retryable.
9. **Owner-review summary**: exception-oriented CLI table + counts; every non-duplicate item flagged for Owner review; no production action follows.

### 4.3 Quarantine root layout (Owner-configured, never hardcoded, never inside the repo)

```
<quarantine_root>/
  .watcher.lock/                       # reused intake mkdir-lock
  staging/<uid>/...                    # per-run scratch, removed on completion/failure
  content/<sha256[0:2]>/<sha256>       # finalized bytes, content-addressed, write-once
  content/<sha256[0:2]>/<sha256>.meta.json
  channels/<registry_id>/state.json    # per-channel durable state
  channels/<registry_id>/receipts/<message_id>/a<idx>-r<rev>.receipt.json
  channels/<registry_id>/receipts/<message_id>/event-r<rev>.receipt.json
```

---

## 5. TypeScript schemas

### 5.1 Channel registry (strict, non-secret)

See draft §11.1. Shape:

```ts
interface WatcherRegistry {
  watcher_registry_version: "1";
  entries: readonly WatcherRegistryEntry[];
}

interface WatcherRegistryEntry {
  registry_id: string;                 // /^[a-z0-9][a-z0-9-]{1,63}$/, unique
  enabled: boolean;
  developer_slug: string;              // assertSafeSlug rules
  developer_name?: string;             // display only, bounded printable
  project_slug: string;                // assertSafeSlug rules
  channel_username: string;            // /^@[A-Za-z][A-Za-z0-9_]{4,31}$/, unique case-insensitive
  expected_channel_id?: number;        // optional positive integer for later live resolution
  allowed_source_categories: readonly ("price_list" | "master_plan" | "construction_media" | "document")[];
  accept_price_lists: boolean;
  accept_master_plans: boolean;
  accept_construction_media: boolean;
  local_processing_policy: "quarantine_only";
}
```

Example fixture (one real entry + one clearly synthetic entry):

```json
{
  "watcher_registry_version": "1",
  "entries": [
    {
      "registry_id": "coralina-kamala",
      "enabled": true,
      "developer_slug": "the-title",
      "developer_name": "The Title / Rhom Bho",
      "project_slug": "coralina",
      "channel_username": "@coralinakamala",
      "allowed_source_categories": ["price_list", "master_plan", "construction_media", "document"],
      "accept_price_lists": true,
      "accept_master_plans": true,
      "accept_construction_media": true,
      "local_processing_policy": "quarantine_only"
    },
    {
      "registry_id": "synthetic-demo",
      "enabled": true,
      "developer_slug": "synthetic-developer",
      "developer_name": "Synthetic Test Developer (not real)",
      "project_slug": "synthetic-demo-project",
      "channel_username": "@synthetic_demo_channel",
      "expected_channel_id": 1000000001,
      "allowed_source_categories": ["price_list", "document"],
      "accept_price_lists": true,
      "accept_master_plans": false,
      "accept_construction_media": false,
      "local_processing_policy": "quarantine_only"
    }
  ]
}
```

Rejections (validation error codes; each thrown as `WatcherRegistryError` with the code as message prefix, intake style):

`watcher_registry_unreadable`, `watcher_registry_not_object`, `watcher_registry_version_unsupported`, `watcher_registry_entries_not_array`, `watcher_registry_unknown_property`, `watcher_registry_id_invalid`, `watcher_registry_duplicate_id`, `watcher_registry_channel_username_invalid` (also covers phone-number-shaped values), `watcher_registry_duplicate_channel_username`, `watcher_registry_developer_slug_invalid`, `watcher_registry_project_slug_invalid` (unsafe slugs, separators, `..`), `watcher_registry_developer_name_invalid`, `watcher_registry_expected_channel_id_invalid`, `watcher_registry_categories_invalid`, `watcher_registry_category_unsupported`, `watcher_registry_flag_not_boolean`, `watcher_registry_processing_policy_unsupported`, `watcher_registry_secret_material_rejected` (defense-in-depth value scan: api_id/api_hash/session/password/key material patterns), `watcher_registry_path_material_rejected` (no property value may look like a filesystem path or output location).

Unknown properties are rejected outright, which also structurally excludes phone numbers, `api_id`, `api_hash`, session strings, encryption keys, passwords, and output paths as *fields*; the two `*_material_rejected` codes additionally scan permitted string *values*.

### 5.2 Normalized source event (the frozen transport boundary)

See draft §11.2. Strict separation:

- **Source facts** (from Telegram, immutable): `channel_username`, `message_id`, `published_at`, `edited_at`, `message_link`, `source_text`, attachment `original_filename` / `mime_type` / `reported_byte_size` / `media_class`.
- **Transport metadata** (opaque, replay-only or live-only): `transport.kind`, `transport.file_ref` per attachment, `transport.cursor_hint`.
- **Operational metadata**: `ingested_at` (local clock, injected in tests).
- **Local processing results** never appear in the event — they live exclusively in receipts and state.

Invariants: `published_at`/`edited_at` are Telegram message metadata and are **never** promoted to a document content date (mirrors SIP-001A's no-inferred-content-date rule). Project identity comes **only** from the registry entry matched by `registry_id` + `channel_username` — never from a filename or caption.

### 5.3 Per-channel state and receipt schemas

See drafts §11.7 and §11.8.

---

## 6. Classification policy (deterministic, conservative)

Allowed signals only: registry entry policy flags, MIME type, filename extension, bounded filename keywords, bounded caption keywords, attachment media class. Prohibited: AI, OCR, image analysis, PDF text extraction, any project-specific prices/unit numbers/row counts.

Bounded keyword dictionaries (complete, case-insensitive, substring on sanitized filename + caption):

- `PRICE_KEYWORDS = ["price list", "pricelist", "price"]`
- `MASTER_PLAN_KEYWORDS = ["master plan", "masterplan"]`
- `CONSTRUCTION_KEYWORDS = ["construction", "progress", "site update"]`

Extension/MIME tables (complete): documents `.pdf`↔`application/pdf`; photos `.jpg .jpeg .png .webp`↔`image/*`; videos `.mp4 .mov`↔`video/*`.

**Classification precedence (exact, first match wins):**

1. Media class not in `{document, photo, video}`, or extension outside the tables above → `unsupported_attachment`.
2. Extension and MIME type disagree about the class (e.g. `.pdf` with `image/jpeg`) → `manual_review_required` (ambiguity `mime_extension_conflict`).
3. Document (PDF): price keywords matched AND master-plan keywords matched → `manual_review_required` (ambiguity `price_and_master_plan_signals`).
4. Document: price keywords only → `canonical_price_table`.
5. Document: master-plan keywords only → `visual_master_plan`.
6. Document: neither → `other_document`.
7. Photo: construction keywords matched → `construction_photo`; no keywords → `manual_review_required` (ambiguity `photo_without_bounded_signal`) — conservative: an unlabeled image is never assumed to be construction media.
8. Video: construction keywords matched → `construction_video`; no keywords → `manual_review_required` (ambiguity `video_without_bounded_signal`).

**Recommendation derivation (exact, first match wins):** classification is intrinsic; the recommendation applies registry policy and duplicate state:

1. `duplicateState === "content_duplicate"` or `"exact_replay"` → `ignore_duplicate_content`.
2. `canonical_price_table` → `route_to_sip_price_list` if `accept_price_lists` and `"price_list" ∈ allowed_source_categories`, else `manual_review_required`.
3. `visual_master_plan` → `register_visual_master_plan` if `accept_master_plans` and `"master_plan" ∈ allowed_source_categories`, else `manual_review_required`.
4. `construction_photo` / `construction_video` → `register_construction_media` if `accept_construction_media` and `"construction_media" ∈ allowed_source_categories`, else `manual_review_required`.
5. `other_document` → `retain_other_document` if `"document" ∈ allowed_source_categories`, else `manual_review_required`.
6. `unsupported_attachment` and `manual_review_required` → `manual_review_required`.

A recommendation is advice recorded in the receipt. The watcher never invokes SIP, the importer, or publication. In the pilot, every receipt with a recommendation other than `ignore_duplicate_content` has `owner_review_required: true`.

---

## 7. Quarantine, identity, and state rules

### 7.1 Quarantine and integrity boundary

- Quarantine root is a **required CLI argument** (`--quarantine-root`); no hardcoded Owner-machine path; tests use `mkdtempSync`. The root is refused if it is a filesystem root (`isFilesystemRoot`), inside the repository working tree, or not strictly containable (`isStrictlyInside` checks on every derived path).
- **Stage before finalize**: bytes land in `staging/<uid>/` first. Staged reads are bounded: the copy loop enforces `max_attachment_bytes` (default 512 MiB, configurable down; never up past 2 GiB) *while streaming*, and computes SHA-256 + byte count in the same pass (draft §11.5).
- **Exact verification**: computed byte count must equal `reported_byte_size` when the event provides one (`watcher_quarantine_byte_count_mismatch` otherwise).
- **Atomic finalize**: `content/<sha256[0:2]>/<sha256>` via same-volume `rename` (the `atomicWriteFile` temp+rename pattern). If the target already exists: existing size must equal the new byte count, else fail closed `watcher_quarantine_content_collision`; equal → dedup hit, staging copy deleted, **no overwrite ever**.
- Sanitized filename is metadata/display only (draft §11.4); file paths are content-addressed, so no attachment-controlled string ever becomes a path segment. `assertSafeEntryName` from `src/intake/zip.ts` is still applied to `original_filename` for its receipt display form (traversal, Windows reserved names, control chars).
- Symlink/reparse protection: staged and finalized targets are checked with `lstat` (regular file required); parent boundary checks resolve through symlinks/junctions via the reused `isStrictlyInside` (which uses `realpathSync.native` internally).
- Cleanup after failure: `staging/<uid>/` is removed via the reused `removeManagedDir` guard in a `finally` block; the content store is never partially written (rename is the only publish step).
- No attachment is ever executed, parsed, rendered, or opened; nothing is generated beside raw source bytes plus `.meta.json` sidecars and receipts; no repository writes occur during normal watcher operation.

### 7.2 Identity and duplicate semantics

- **Message-attachment identity**: `registry_id + ":" + message_id + ":" + attachment_index + ":r" + revision`.
- **Content identity**: SHA-256 of finalized attachment bytes.
- Outcomes (all covered by the test matrix):
  - exact replay (same identity, same content hash) → idempotent no-op, receipt already exists and is byte-identical apart from nothing (receipts are deterministic given an injected clock);
  - same bytes in a different message → `content_duplicate`, recommendation `ignore_duplicate_content`, receipt still records the sighting;
  - same filename, different bytes → new content (filename is never identity);
  - edited caption, unchanged bytes → metadata-only event receipt (`event_kind: "message_edited"`), no new revision, no byte duplication;
  - edited attachment (same index, new bytes) → revision increments → new attachment identity + new content entry;
  - deleted Telegram message → `message_deleted` event receipt; existing receipts and content remain as historical record — nothing is deleted;
  - duplicates never depend on filename, timestamp, or byte size alone.

### 7.3 Per-channel durable state

Schema in draft §11.7. Rules:

- one state file per channel, `channels/<registry_id>/state.json`, written only via `atomicWriteJson`;
- `last_processed_message_id` advances **only after** receipt durability and attachment finalization, monotonically, never skipping an unprocessed lower id;
- failed messages leave the cursor untouched and remain retryable on the next run;
- replay of already-processed events is a no-op (idempotent);
- state contains no secrets and no message bodies — only ids, hashes, timestamps, bounded `recent_message_keys` (last 200 identity keys), and receipt references;
- unknown `watcher_state_schema_version` → `WatcherStateError` `watcher_state_migration_unsupported`, fail closed; the watcher never silently resets or migrates state;
- crash recovery: on start, the (locked) run re-derives from receipts on disk whether the last message completed; a receipt without a state advance is healed by re-advancing; a state advance without a receipt is impossible by ordering. No message is ever silently skipped.

---

## 8. Threat model

| # | Threat | Phase | Mitigation |
| --- | --- | --- | --- |
| 1 | Telegram session theft | live (001B) | Dedicated Forever-only Telegram account (no personal chats/contacts), 2FA, session encrypted at rest in a protected local store outside Git, never logged, never in receipts/state; review gate before any authentication (per DECISIONS review trigger) |
| 2 | Over-broad account access | live | Dedicated account joined only to registry channels; application reads only allowlisted `registry_id`s; no contact/private-chat processing ever |
| 3 | Malicious filenames (traversal, reserved names, control chars, homoglyph noise) | core | Content-addressed storage (filename never becomes a path); `assertSafeEntryName` + transforming display sanitizer; receipts show sanitized name + original as quoted metadata |
| 4 | Oversized files / disk exhaustion | core | Streaming max-size enforcement during read; per-run staging quota; configurable `max_attachment_bytes`; oversize → terminal rejection receipt, cursor still advances past the message only by Owner decision (default: mark failed, retryable) |
| 5 | Symlink/reparse-point attacks | core | `lstat` regular-file checks; boundary checks resolve through symlinks (`isStrictlyInside`); quarantine root refused on reparse ancestry |
| 6 | Duplicate floods (same bytes re-posted) | core | Content store dedup is O(1) per duplicate; receipts record sightings without re-storing bytes; bounded `recent_message_keys` |
| 7 | Channel impersonation / username changes | live | Registry pins `channel_username` + optional `expected_channel_id`; on live resolution, mismatch between resolved id and expected id → channel quarantined (`health: "failed"`), nothing processed until Owner updates the registry |
| 8 | Edited/deleted posts rewriting history | core | Append-only receipts + revisions; deletions recorded, never propagated as deletions of local data |
| 9 | Stale transport cursors | core/live | Cursor is opaque and advisory; authoritative resume point is `last_processed_message_id`; backfill re-fetch is idempotent by identity + content hash |
| 10 | Partial downloads / source mutation mid-read | core | Hash + byte count computed on the exact stored bytes; `reported_byte_size` mismatch fails; `processWithSourceIntegrity` pattern for any re-read |
| 11 | Malicious archives | core | Watcher does **not** extract archives; a `.zip`/`.rar` attachment classifies as `unsupported_attachment` → manual review (the hardened `extractZip` exists if a later checkpoint opts in) |
| 12 | Accidental secret logging | all | Registry/event/state/receipt schemas reject secret-shaped fields; `assertNoSecretMaterial` scan before every state/receipt write; no session values exist in TG-WATCH-001A at all |
| 13 | Broad scraping drift | live | Registry allowlist is the only channel source; no discovery, no search, no joining logic |
| 14 | Automatic-import risk | core | Classifier emits recommendations only; no import/SIP/publication call sites exist in `src/watcher/`; tests assert no DB client construction (reusing the `local-only.test.ts` fail-closed pattern) |
| 15 | Automatic-publication risk | core | Same as 14; receipts carry `owner_review_required` and no executable action |
| 16 | Least privilege on disk | all | Quarantine root owned by the Owner's user; watcher writes only under it; repo writes prohibited during operation |

---

## 9. Test matrix (Vitest, `src/watcher/tests/`)

All groups use temp dirs (`mkdtempSync`), the injected fixed clock, and synthetic fixtures from §10 — no real Telegram exports, media, client information, or developer PDFs.

| # | Group / file | Purpose | Fixture | Expected result | Key error codes |
| --- | --- | --- | --- | --- | --- |
| 1 | `registry.test.ts` | Registry validation accepts the canonical fixture; rejects each malformed variant | `registry.fixture.json` + inline mutations | Valid registry parses; every rejection throws `WatcherRegistryError` | `watcher_registry_duplicate_id`, `_duplicate_channel_username`, `_channel_username_invalid`, `_unknown_property`, `_category_unsupported`, `_secret_material_rejected`, `_path_material_rejected` |
| 2 | `event.test.ts` | Strict event schema; unknown props, bad dates, bad ids rejected | inline events | Valid events pass; violations throw `WatcherEventError` | `watcher_event_unknown_property`, `_message_id_invalid`, `_date_invalid`, `_attachment_invalid` |
| 3 | `replay-transport.test.ts` | Event normalization + ordering from replay dir | `replay/basic/` | Events yielded ascending per channel; malformed fixture fails closed | `watcher_replay_unreadable`, `watcher_replay_order_invalid` |
| 4 | `routing.test.ts` | Two-channel routing; unregistered channel rejected | `replay/two-channels/`, `replay/unregistered-channel/` | Per-channel state independent; unregistered event → rejection receipt, no state | `watcher_event_channel_not_registered` |
| 5 | `filename.test.ts` | Path traversal + Windows unsafe names + control chars in display sanitizer | hostile name list (incl. `..\\..\\evil`, `CON.pdf`, trailing dots, NUL) | Sanitized display names; never used as paths | (transform, not throw) |
| 6 | `quarantine-boundaries.test.ts` | Reparse/symlink boundaries; root safety | temp dirs with symlinked ancestor | Unsafe roots and symlinked staged files refused | `watcher_quarantine_root_unsafe`, `_symlink_rejected` |
| 7 | `quarantine-atomic.test.ts` | Stage→finalize atomicity; interrupted finalize leaves no partial content | failpoint hooks (`failAt`) | Content dir has zero partial files; staging cleaned | `watcher_quarantine_finalize_conflict` |
| 8 | `integrity.test.ts` | SHA-256 + exact byte verification | blob fixtures | Hash matches precomputed; reported-size mismatch fails | `watcher_quarantine_byte_count_mismatch` |
| 9 | `oversize.test.ts` | Max-size enforcement during streaming | oversize synthetic blob | Rejected mid-stream, staging cleaned | `watcher_quarantine_oversize_rejected` |
| 10 | `dedupe.test.ts` | Content dedup; same bytes/different filename; same filename/different bytes | `replay/duplicate-content/`, `replay/same-name-new-bytes/` | duplicate → `content_duplicate` + `ignore_duplicate_content`; new bytes → new content | — |
| 11 | `idempotency.test.ts` | Exact replay is a no-op | run same replay dir twice | Second run: zero new content, zero state change, receipts byte-identical | — |
| 12 | `edited-events.test.ts` | Edited caption vs edited attachment vs deleted message | `replay/edited-caption/`, `replay/edited-attachment/`, `replay/deleted-message/` | caption → metadata receipt, no new revision; attachment → revision r2; delete → historical receipt retained | — |
| 13 | `classify.test.ts` | Full precedence table incl. ambiguity + policy gates | inline attachment descriptors | Exactly the §6 rules, incl. both-signals → manual review | — |
| 14 | `receipt.test.ts` | Receipt generation, determinism, owner-review flag | one full pipeline run | Receipt fields complete; injected clock → byte-identical repeat | — |
| 15 | `state-recovery.test.ts` | Crash between finalize/receipt/state | failpoint hooks | Re-run heals; no message silently skipped; cursor never regresses | `watcher_state_migration_unsupported` (separate case) |
| 16 | `cursor.test.ts` | Cursor advances only after receipt + finalize; failures retryable | replay with one failing attachment | `last_processed` stops before failing message; retry succeeds after fixture fix | — |
| 17 | `no-secrets.test.ts` | No-secret serialization | scan all written JSON | No phone/api_id/api_hash/session/password/token-shaped content in any output | `watcher_registry_secret_material_rejected` |
| 18 | `determinism.test.ts` | Deterministic replay end-to-end | `replay/basic/` twice into two roots | Content store + receipts + state byte-identical across roots (fixed clock) | — |
| 19 | `cleanup.test.ts` | Cleanup after failure | induced failures at each stage | `staging/` empty after every failure path | — |
| 20 | `output-boundary.test.ts` | Output-boundary enforcement; no repo writes; no DB/network | fail-closed mocks (pattern of `src/intake/tests/local-only.test.ts`) | No Supabase client constructed; no fs writes outside quarantine root/temp | — |
| 21 | `lock.test.ts` | Single watcher instance per quarantine root | real child process (pattern of `lock-process.test.ts`) | Second acquire fails with exit-code-4 mapping; stale lock reclaimed | `watcher_lock_held` |

Replay fixture set (`src/watcher/test-fixtures/`, all synthetic — blobs are tiny hand-written byte files with correct magic numbers only):

`replay/basic/` (Coralina-like price-list PDF event + master-plan PDF event + construction photo + construction video + unrelated PDF + unsupported attachment), `replay/two-channels/`, `replay/unregistered-channel/`, `replay/edited-caption/`, `replay/edited-attachment/`, `replay/repeated-message/`, `replay/duplicate-content/`, `replay/same-name-new-bytes/`, `replay/oversized/`, `replay/malicious-filename/`, `replay/interrupted/` (drives failpoint hooks), plus `blobs/` (`synthetic-price.pdf` = literal `%PDF-1.4` + padding, `synthetic-photo.jpg` = JPEG SOI/EOI markers, `synthetic-video.mp4` = minimal `ftyp` box, `synthetic.bin`).

---

## 10. Repository implementation map

New area `src/watcher/` (narrow, mirrors `src/intake/` conventions). No changes to Project Detail, Navigator, Booth, database, import engine, or production application code.

| File | New/Modified | Purpose | Key exports | Reuses | Test file |
| --- | --- | --- | --- | --- | --- |
| `src/watcher/types.ts` | New | Constants, shared types, error classes, patterns | `WATCHER_SCHEMA_VERSION`, `WATCHER_SOURCE_CATEGORIES`, `WATCHER_CHANNEL_USERNAME_PATTERN`, `SHA256_HEX_PATTERN`, `REGISTRY_ID_PATTERN`, `WatcherRegistryError`, `WatcherEventError`, `WatcherQuarantineError`, `WatcherStateError`, `WatcherLockError` | — | (via all groups) |
| `src/watcher/registry.ts` | New | Registry schema + validation | `WatcherRegistry`, `WatcherRegistryEntry`, `parseWatcherRegistry`, `loadWatcherRegistry`, `findEnabledEntry` | `assertSafeSlug` (`@/intake/paths`) | `tests/registry.test.ts` |
| `src/watcher/event.ts` | New | Normalized event contract + validation | `WatcherSourceEvent`, `WatcherEventAttachment`, `WatcherEventKind`, `parseWatcherSourceEvent` | patterns from `types` | `tests/event.test.ts` |
| `src/watcher/filename.ts` | New | Display-filename sanitizer | `SanitizedDisplayName`, `sanitizeDisplayFilename` | `assertSafeEntryName` (`@/intake/zip`) as validator | `tests/filename.test.ts` |
| `src/watcher/hash.ts` | New | Bounded streaming SHA-256 | `StreamHashResult`, `hashFileSha256`, `copyAndHashBounded` | pattern of `inventory.ts` private `hashFile` (§2.2) | `tests/integrity.test.ts` |
| `src/watcher/quarantine.ts` | New | Layout + staging + atomic content-addressed finalize | `QuarantineLayout`, `createQuarantineLayout`, `stageAttachmentBytes`, `finalizeAttachment`, `FinalizeResult` | `@/intake/paths`, `@/intake/fs-utils` | `tests/quarantine-*.test.ts`, `tests/oversize.test.ts`, `tests/cleanup.test.ts` |
| `src/watcher/dedupe.ts` | New | Identity helpers + duplicate classification | `MessageAttachmentIdentity`, `messageIdentityKey`, `DuplicateState`, `classifyDuplicate` | — | `tests/dedupe.test.ts`, `tests/idempotency.test.ts` |
| `src/watcher/classify.ts` | New | Deterministic classifier + recommendation | `WatcherClassification`, `WatcherRecommendation`, `ClassificationResult`, `classifyAttachment`, `deriveRecommendation` | precedence pattern of `@/intake/classify` | `tests/classify.test.ts` |
| `src/watcher/state.ts` | New | Per-channel durable state | `WatcherChannelState`, `emptyChannelState`, `readChannelState`, `writeChannelState`, `advanceProcessed` | `atomicWriteJson` (`@/intake/fs-utils`) | `tests/state-recovery.test.ts`, `tests/cursor.test.ts` |
| `src/watcher/receipt.ts` | New | Receipts + Owner summary | `WatcherAttachmentReceipt`, `WatcherEventReceipt`, `buildAttachmentReceipt`, `receiptRelativePath`, `renderOwnerSummary` | `sha256OfJson` (`@/intake/sip/artifacts`), `canonicalJson` (`@/import/persistence-projection`) | `tests/receipt.test.ts` |
| `src/watcher/transport/replay.ts` | New | Offline replay transport | `ReplayTransport`, `openReplayTransport`, `ReplaySource` | `parseWatcherSourceEvent` only (frozen boundary) | `tests/replay-transport.test.ts` |
| `src/watcher/run.ts` | New | Orchestrator (lock → registry → events → pipeline → summary) | `RunWatcherReplayOptions`, `RunWatcherReplayResult`, `runWatcherReplay` | `acquireProjectLock`/`releaseProjectLock` (`@/intake/txn`) | `tests/determinism.test.ts`, `tests/routing.test.ts`, `tests/output-boundary.test.ts`, `tests/lock.test.ts` |
| `src/watcher/cli-args.ts` | New | Pure arg parsing | `WatcherReplayOptions`, `parseWatcherReplayInvocation` | intake result-union pattern | `tests/cli-args.test.ts` |
| `src/watcher/cli.ts` | New | CLI entry (not in barrel) | `main` | intake `cli.ts` shape, exit codes 0/2/3/4/5/1 | — |
| `src/watcher/run-cli.mjs` | New | jiti bootstrap | — | copied from `src/intake/run-cli.mjs` | — |
| `src/watcher/index.ts` | New | Barrel (everything except `cli.ts`) | re-exports | intake `index.ts` convention | — |
| `src/watcher/tests/*.test.ts` (21 files, §9) | New | Test matrix | — | intake test conventions | — |
| `src/watcher/tests/failpoints.ts` | New | Test-only failpoint hooks | `WatcherFailpoint`, hook types | `TxnHooks` pattern | — |
| `src/watcher/test-fixtures/registry.fixture.json` | New | Registry fixture (§5.1) | — | — | — |
| `src/watcher/test-fixtures/replay/**`, `test-fixtures/blobs/**` | New | Synthetic replay fixtures (§9) | — | — | — |
| `package.json` | Modified | Add script `"watch:replay": "node src/watcher/run-cli.mjs"` | — | — | — |

Open integration point (marked, Owner/Codex decision): where the *real* registry file lives when the pilot starts. Recommendation: `forever-data/watcher/channel-registry.json` with a `.gitignore` allowlist addition (mirrors the existing `forever-data/projects/coralina/` allowlist precedent); the CLI takes `--registry <path>` explicitly either way, so TG-WATCH-001A does not depend on this decision.

---

## 11. Draft implementation package (compile-oriented, NOT tested, NOT committed as working code)

Drafts follow observed conventions: hand-rolled validation, `readonly` interfaces, custom `Error` subclasses with `this.name`, string error-code message prefixes, result-union parsers, `@/` alias for cross-area imports. Where repository integration is uncertain it is marked `// UNCERTAIN:`.

### 11.1 `src/watcher/types.ts`

```ts
export const WATCHER_SCHEMA_VERSION = "1" as const;

export const WATCHER_SOURCE_CATEGORIES = [
  "price_list",
  "master_plan",
  "construction_media",
  "document",
] as const;
export type WatcherSourceCategory = (typeof WATCHER_SOURCE_CATEGORIES)[number];

export const WATCHER_LOCAL_PROCESSING_POLICIES = ["quarantine_only"] as const;
export type WatcherLocalProcessingPolicy = (typeof WATCHER_LOCAL_PROCESSING_POLICIES)[number];

export type WatcherAttachmentMediaClass = "document" | "photo" | "video" | "other";

// Deliberate re-declarations of module-private intake patterns (see package §2.2).
export const WATCHER_CHANNEL_USERNAME_PATTERN = /^@[A-Za-z][A-Za-z0-9_]{4,31}$/;
export const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
export const REGISTRY_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
export const ISO_UTC_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

export const DEFAULT_MAX_ATTACHMENT_BYTES = 512 * 1024 * 1024;
export const HARD_MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024 * 1024;
export const RECENT_MESSAGE_KEY_LIMIT = 200;

export class WatcherRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WatcherRegistryError";
  }
}
export class WatcherEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WatcherEventError";
  }
}
export class WatcherQuarantineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WatcherQuarantineError";
  }
}
export class WatcherStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WatcherStateError";
  }
}
export class WatcherLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WatcherLockError";
  }
}

const SECRET_KEY_PATTERN =
  /(api[_-]?id|api[_-]?hash|session|password|passphrase|secret|token|private[_-]?key|phone)/i;
const SECRET_VALUE_PATTERN =
  /(BEGIN [A-Z ]*PRIVATE KEY|StringSession|^[A-Za-z0-9+/=]{120,}$|^\+?\d{7,15}$)/;

/** Defense-in-depth: refuse to serialize anything secret-shaped. */
export function assertNoSecretMaterial(value: unknown, code: string, path = "$"): void {
  if (typeof value === "string") {
    if (SECRET_VALUE_PATTERN.test(value.trim())) {
      throw new WatcherRegistryError(`${code}: secret-shaped value at ${path}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecretMaterial(item, code, `${path}[${index}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(key)) {
        throw new WatcherRegistryError(`${code}: secret-shaped property "${key}" at ${path}`);
      }
      assertNoSecretMaterial(child, code, `${path}.${key}`);
    }
  }
}
```

### 11.2 `src/watcher/registry.ts`

```ts
import { readFileSync } from "node:fs";

import { assertSafeSlug } from "@/intake/paths";
import {
  REGISTRY_ID_PATTERN,
  WATCHER_CHANNEL_USERNAME_PATTERN,
  WATCHER_LOCAL_PROCESSING_POLICIES,
  WATCHER_SOURCE_CATEGORIES,
  WatcherRegistryError,
  assertNoSecretMaterial,
  type WatcherLocalProcessingPolicy,
  type WatcherSourceCategory,
} from "./types";

export interface WatcherRegistryEntry {
  readonly registry_id: string;
  readonly enabled: boolean;
  readonly developer_slug: string;
  readonly developer_name?: string;
  readonly project_slug: string;
  readonly channel_username: string;
  readonly expected_channel_id?: number;
  readonly allowed_source_categories: readonly WatcherSourceCategory[];
  readonly accept_price_lists: boolean;
  readonly accept_master_plans: boolean;
  readonly accept_construction_media: boolean;
  readonly local_processing_policy: WatcherLocalProcessingPolicy;
}

export interface WatcherRegistry {
  readonly watcher_registry_version: "1";
  readonly entries: readonly WatcherRegistryEntry[];
}

const REGISTRY_ROOT_KEYS = new Set(["watcher_registry_version", "entries"]);
const ENTRY_REQUIRED_KEYS = [
  "registry_id",
  "enabled",
  "developer_slug",
  "project_slug",
  "channel_username",
  "allowed_source_categories",
  "accept_price_lists",
  "accept_master_plans",
  "accept_construction_media",
  "local_processing_policy",
] as const;
const ENTRY_OPTIONAL_KEYS = ["developer_name", "expected_channel_id"] as const;
const ENTRY_ALLOWED_KEYS = new Set<string>([...ENTRY_REQUIRED_KEYS, ...ENTRY_OPTIONAL_KEYS]);

const DEVELOPER_NAME_PATTERN = /^[\p{L}\p{N} .,'&()\/-]{1,80}$/u;
const PATHLIKE_PATTERN = /[\\/]|^[A-Za-z]:|^\.\.?$/;

function fail(code: string, detail: string): never {
  throw new WatcherRegistryError(`${code}: ${detail}`);
}

function requireBoolean(value: unknown, code: string, field: string): boolean {
  if (typeof value !== "boolean") fail(code, `${field} must be a boolean`);
  return value;
}

function parseEntry(value: unknown, index: number): WatcherRegistryEntry {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("watcher_registry_not_object", `entry ${index} is not an object`);
  }
  const record = value as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (!ENTRY_ALLOWED_KEYS.has(key)) {
      fail("watcher_registry_unknown_property", `entry ${index} property "${key}"`);
    }
  }
  for (const key of ENTRY_REQUIRED_KEYS) {
    if (!(key in record)) {
      fail("watcher_registry_unknown_property", `entry ${index} missing required "${key}"`);
    }
  }

  const registryId = record.registry_id;
  if (typeof registryId !== "string" || !REGISTRY_ID_PATTERN.test(registryId)) {
    fail("watcher_registry_id_invalid", `entry ${index}`);
  }

  const channel = record.channel_username;
  if (typeof channel !== "string" || !WATCHER_CHANNEL_USERNAME_PATTERN.test(channel)) {
    fail("watcher_registry_channel_username_invalid", `entry ${index}`);
  }

  const developerSlug = record.developer_slug;
  const projectSlug = record.project_slug;
  for (const [field, slug] of [
    ["developer_slug", developerSlug],
    ["project_slug", projectSlug],
  ] as const) {
    if (typeof slug !== "string" || PATHLIKE_PATTERN.test(slug)) {
      fail(`watcher_registry_${field}_invalid`, `entry ${index}`);
    }
    try {
      assertSafeSlug(slug);
    } catch {
      fail(`watcher_registry_${field}_invalid`, `entry ${index}`);
    }
  }

  let developerName: string | undefined;
  if ("developer_name" in record) {
    if (typeof record.developer_name !== "string" || !DEVELOPER_NAME_PATTERN.test(record.developer_name)) {
      fail("watcher_registry_developer_name_invalid", `entry ${index}`);
    }
    developerName = record.developer_name;
  }

  let expectedChannelId: number | undefined;
  if ("expected_channel_id" in record) {
    const id = record.expected_channel_id;
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
      fail("watcher_registry_expected_channel_id_invalid", `entry ${index}`);
    }
    expectedChannelId = id;
  }

  const categoriesRaw = record.allowed_source_categories;
  if (!Array.isArray(categoriesRaw) || categoriesRaw.length === 0) {
    fail("watcher_registry_categories_invalid", `entry ${index}`);
  }
  const categories: WatcherSourceCategory[] = [];
  for (const category of categoriesRaw) {
    if (
      typeof category !== "string" ||
      !(WATCHER_SOURCE_CATEGORIES as readonly string[]).includes(category) ||
      categories.includes(category as WatcherSourceCategory)
    ) {
      fail("watcher_registry_category_unsupported", `entry ${index} category "${String(category)}"`);
    }
    categories.push(category as WatcherSourceCategory);
  }

  const policy = record.local_processing_policy;
  if (
    typeof policy !== "string" ||
    !(WATCHER_LOCAL_PROCESSING_POLICIES as readonly string[]).includes(policy)
  ) {
    fail("watcher_registry_processing_policy_unsupported", `entry ${index}`);
  }

  assertNoSecretMaterial(record, "watcher_registry_secret_material_rejected", `entries[${index}]`);

  return {
    registry_id: registryId,
    enabled: requireBoolean(record.enabled, "watcher_registry_flag_not_boolean", "enabled"),
    developer_slug: developerSlug as string,
    ...(developerName === undefined ? {} : { developer_name: developerName }),
    project_slug: projectSlug as string,
    channel_username: channel,
    ...(expectedChannelId === undefined ? {} : { expected_channel_id: expectedChannelId }),
    allowed_source_categories: categories,
    accept_price_lists: requireBoolean(record.accept_price_lists, "watcher_registry_flag_not_boolean", "accept_price_lists"),
    accept_master_plans: requireBoolean(record.accept_master_plans, "watcher_registry_flag_not_boolean", "accept_master_plans"),
    accept_construction_media: requireBoolean(record.accept_construction_media, "watcher_registry_flag_not_boolean", "accept_construction_media"),
    local_processing_policy: policy as WatcherLocalProcessingPolicy,
  };
}

export function parseWatcherRegistry(value: unknown): WatcherRegistry {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("watcher_registry_not_object", "registry root");
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!REGISTRY_ROOT_KEYS.has(key)) {
      fail("watcher_registry_unknown_property", `root property "${key}"`);
    }
  }
  if (record.watcher_registry_version !== "1") {
    fail("watcher_registry_version_unsupported", String(record.watcher_registry_version));
  }
  if (!Array.isArray(record.entries)) {
    fail("watcher_registry_entries_not_array", "entries");
  }

  const entries = record.entries.map(parseEntry);

  const seenIds = new Set<string>();
  const seenChannels = new Set<string>();
  for (const entry of entries) {
    if (seenIds.has(entry.registry_id)) {
      fail("watcher_registry_duplicate_id", entry.registry_id);
    }
    seenIds.add(entry.registry_id);
    const channelKey = entry.channel_username.toLowerCase();
    if (seenChannels.has(channelKey)) {
      fail("watcher_registry_duplicate_channel_username", entry.channel_username);
    }
    seenChannels.add(channelKey);
  }

  return { watcher_registry_version: "1", entries };
}

export function loadWatcherRegistry(registryPath: string): WatcherRegistry {
  let raw: string;
  try {
    raw = readFileSync(registryPath, "utf8").replace(/^﻿/, "");
  } catch (error) {
    fail("watcher_registry_unreadable", `${registryPath}: ${String(error)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail("watcher_registry_unreadable", `${registryPath}: invalid JSON`);
  }
  return parseWatcherRegistry(parsed);
}

export function findEnabledEntry(
  registry: WatcherRegistry,
  registryId: string,
  channelUsername: string,
): WatcherRegistryEntry | null {
  const entry = registry.entries.find((candidate) => candidate.registry_id === registryId);
  if (!entry || !entry.enabled) return null;
  if (entry.channel_username.toLowerCase() !== channelUsername.toLowerCase()) return null;
  return entry;
}
```

### 11.3 `src/watcher/event.ts`

```ts
import {
  ISO_UTC_INSTANT_PATTERN,
  REGISTRY_ID_PATTERN,
  WATCHER_CHANNEL_USERNAME_PATTERN,
  WatcherEventError,
  type WatcherAttachmentMediaClass,
} from "./types";

export type WatcherEventKind = "message" | "message_edited" | "message_deleted";
export type WatcherTransportKind = "replay" | "telegram_live";

export interface WatcherEventAttachment {
  readonly attachment_index: number;
  readonly media_class: WatcherAttachmentMediaClass;
  readonly original_filename: string | null;
  readonly mime_type: string | null;
  readonly reported_byte_size: number | null;
  /** Opaque transport handle: replay blob path or live Telegram file reference. Never interpreted downstream. */
  readonly transport_file_ref: string;
}

export interface WatcherSourceEvent {
  readonly watcher_event_schema_version: "1";
  // --- source facts (from the channel; never invented, never reinterpreted) ---
  readonly registry_id: string;
  readonly channel_username: string;
  readonly resolved_channel_id: number | null;
  readonly message_id: number;
  readonly event_kind: WatcherEventKind;
  /** Telegram publication instant. NEVER a document content date. */
  readonly published_at: string;
  readonly edited_at: string | null;
  readonly message_link: string | null;
  readonly source_text: string | null;
  readonly attachments: readonly WatcherEventAttachment[];
  // --- transport metadata (opaque) ---
  readonly transport: {
    readonly kind: WatcherTransportKind;
    readonly cursor_hint: string | null;
  };
  // --- operational metadata ---
  readonly ingested_at: string;
}

const EVENT_KEYS = new Set([
  "watcher_event_schema_version",
  "registry_id",
  "channel_username",
  "resolved_channel_id",
  "message_id",
  "event_kind",
  "published_at",
  "edited_at",
  "message_link",
  "source_text",
  "attachments",
  "transport",
  "ingested_at",
]);
const ATTACHMENT_KEYS = new Set([
  "attachment_index",
  "media_class",
  "original_filename",
  "mime_type",
  "reported_byte_size",
  "transport_file_ref",
]);
const EVENT_KINDS = new Set(["message", "message_edited", "message_deleted"]);
const MEDIA_CLASSES = new Set(["document", "photo", "video", "other"]);
const TRANSPORT_KINDS = new Set(["replay", "telegram_live"]);

function fail(code: string, detail: string): never {
  throw new WatcherEventError(`${code}: ${detail}`);
}

function requireInstant(value: unknown, field: string): string {
  if (typeof value !== "string" || !ISO_UTC_INSTANT_PATTERN.test(value)) {
    fail("watcher_event_date_invalid", field);
  }
  return value;
}

function parseAttachment(value: unknown, index: number): WatcherEventAttachment {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("watcher_event_attachment_invalid", `attachment ${index} not an object`);
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!ATTACHMENT_KEYS.has(key)) {
      fail("watcher_event_unknown_property", `attachment ${index} property "${key}"`);
    }
  }
  const attachmentIndex = record.attachment_index;
  if (typeof attachmentIndex !== "number" || !Number.isSafeInteger(attachmentIndex) || attachmentIndex < 0 || attachmentIndex !== index) {
    fail("watcher_event_attachment_invalid", `attachment ${index} index mismatch`);
  }
  if (typeof record.media_class !== "string" || !MEDIA_CLASSES.has(record.media_class)) {
    fail("watcher_event_attachment_invalid", `attachment ${index} media_class`);
  }
  if (record.original_filename !== null && typeof record.original_filename !== "string") {
    fail("watcher_event_attachment_invalid", `attachment ${index} original_filename`);
  }
  if (record.mime_type !== null && typeof record.mime_type !== "string") {
    fail("watcher_event_attachment_invalid", `attachment ${index} mime_type`);
  }
  const size = record.reported_byte_size;
  if (size !== null && (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0)) {
    fail("watcher_event_size_invalid", `attachment ${index}`);
  }
  if (typeof record.transport_file_ref !== "string" || record.transport_file_ref.length === 0) {
    fail("watcher_event_attachment_invalid", `attachment ${index} transport_file_ref`);
  }
  return {
    attachment_index: attachmentIndex,
    media_class: record.media_class as WatcherAttachmentMediaClass,
    original_filename: record.original_filename as string | null,
    mime_type: record.mime_type as string | null,
    reported_byte_size: size as number | null,
    transport_file_ref: record.transport_file_ref,
  };
}

export function parseWatcherSourceEvent(value: unknown): WatcherSourceEvent {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("watcher_event_invalid", "event is not an object");
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!EVENT_KEYS.has(key)) fail("watcher_event_unknown_property", `"${key}"`);
  }
  if (record.watcher_event_schema_version !== "1") {
    fail("watcher_event_schema_version_unsupported", String(record.watcher_event_schema_version));
  }
  if (typeof record.registry_id !== "string" || !REGISTRY_ID_PATTERN.test(record.registry_id)) {
    fail("watcher_event_invalid", "registry_id");
  }
  if (
    typeof record.channel_username !== "string" ||
    !WATCHER_CHANNEL_USERNAME_PATTERN.test(record.channel_username)
  ) {
    fail("watcher_event_invalid", "channel_username");
  }
  const resolvedId = record.resolved_channel_id;
  if (resolvedId !== null && (typeof resolvedId !== "number" || !Number.isSafeInteger(resolvedId) || resolvedId <= 0)) {
    fail("watcher_event_invalid", "resolved_channel_id");
  }
  const messageId = record.message_id;
  if (typeof messageId !== "number" || !Number.isSafeInteger(messageId) || messageId <= 0) {
    fail("watcher_event_message_id_invalid", String(messageId));
  }
  if (typeof record.event_kind !== "string" || !EVENT_KINDS.has(record.event_kind)) {
    fail("watcher_event_invalid", "event_kind");
  }
  const publishedAt = requireInstant(record.published_at, "published_at");
  const editedAt = record.edited_at === null ? null : requireInstant(record.edited_at, "edited_at");
  if (record.message_link !== null && typeof record.message_link !== "string") {
    fail("watcher_event_invalid", "message_link");
  }
  if (record.source_text !== null && typeof record.source_text !== "string") {
    fail("watcher_event_invalid", "source_text");
  }
  if (!Array.isArray(record.attachments)) {
    fail("watcher_event_attachment_invalid", "attachments not an array");
  }
  const transport = record.transport;
  if (transport === null || typeof transport !== "object" || Array.isArray(transport)) {
    fail("watcher_event_invalid", "transport");
  }
  const transportRecord = transport as Record<string, unknown>;
  for (const key of Object.keys(transportRecord)) {
    if (key !== "kind" && key !== "cursor_hint") {
      fail("watcher_event_unknown_property", `transport property "${key}"`);
    }
  }
  if (typeof transportRecord.kind !== "string" || !TRANSPORT_KINDS.has(transportRecord.kind)) {
    fail("watcher_event_invalid", "transport.kind");
  }
  if (transportRecord.cursor_hint !== null && typeof transportRecord.cursor_hint !== "string") {
    fail("watcher_event_invalid", "transport.cursor_hint");
  }

  return {
    watcher_event_schema_version: "1",
    registry_id: record.registry_id,
    channel_username: record.channel_username,
    resolved_channel_id: resolvedId as number | null,
    message_id: messageId,
    event_kind: record.event_kind as WatcherEventKind,
    published_at: publishedAt,
    edited_at: editedAt,
    message_link: record.message_link as string | null,
    source_text: record.source_text as string | null,
    attachments: record.attachments.map(parseAttachment),
    transport: {
      kind: transportRecord.kind as WatcherTransportKind,
      cursor_hint: transportRecord.cursor_hint as string | null,
    },
    ingested_at: requireInstant(record.ingested_at, "ingested_at"),
  };
}
```

### 11.4 `src/watcher/filename.ts`

```ts
import { assertSafeEntryName } from "@/intake/zip";

export interface SanitizedDisplayName {
  readonly display_name: string;
  readonly original_filename: string | null;
  readonly was_modified: boolean;
  readonly passed_strict_validation: boolean;
}

const DISPLAY_MAX_LENGTH = 120;
const UNSAFE_CHARS = /[ -<>:"|?*\\/]/g;
const WINDOWS_RESERVED = new Set([
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
]);

/**
 * Transforming sanitizer for DISPLAY/metadata use only. Storage paths are
 * content-addressed (sha256), so this name is never used to build a path.
 * Strict validation is delegated to the reused intake rulebook.
 */
export function sanitizeDisplayFilename(original: string | null): SanitizedDisplayName {
  if (original === null || original.trim().length === 0) {
    return {
      display_name: "unnamed",
      original_filename: original,
      was_modified: original !== null,
      passed_strict_validation: false,
    };
  }

  let passedStrict = true;
  try {
    assertSafeEntryName(original);
  } catch {
    passedStrict = false;
  }

  const lastSegment = original.split(/[\\/]/).filter((part) => part.length > 0).pop() ?? "";
  let cleaned = lastSegment.replace(UNSAFE_CHARS, "_").replace(/[. ]+$/g, "");
  if (cleaned.length === 0) cleaned = "unnamed";

  const dotIndex = cleaned.indexOf(".");
  const base = (dotIndex > 0 ? cleaned.slice(0, dotIndex) : cleaned).toLowerCase();
  if (WINDOWS_RESERVED.has(base)) cleaned = `file-${cleaned}`;

  if (cleaned.length > DISPLAY_MAX_LENGTH) {
    cleaned = cleaned.slice(0, DISPLAY_MAX_LENGTH);
  }

  return {
    display_name: cleaned,
    original_filename: original,
    was_modified: cleaned !== original,
    passed_strict_validation: passedStrict,
  };
}
```

### 11.5 `src/watcher/hash.ts` + finalize core of `src/watcher/quarantine.ts`

```ts
// hash.ts
import { createHash } from "node:crypto";
import { closeSync, openSync, readSync } from "node:fs";

import { WatcherQuarantineError } from "./types";

export interface StreamHashResult {
  readonly sha256: string;
  readonly byteSize: number;
}

/** Bounded streaming SHA-256; refuses files above maxBytes DURING the read. */
export function hashFileSha256(path: string, maxBytes: number): StreamHashResult {
  const hash = createHash("sha256");
  const buffer = Buffer.alloc(1024 * 1024);
  const fd = openSync(path, "r");
  let total = 0;
  try {
    for (;;) {
      const read = readSync(fd, buffer, 0, buffer.length, null);
      if (read <= 0) break;
      total += read;
      if (total > maxBytes) {
        throw new WatcherQuarantineError(
          `watcher_quarantine_oversize_rejected: ${path} exceeds ${maxBytes} bytes`,
        );
      }
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    closeSync(fd);
  }
  return { sha256: hash.digest("hex"), byteSize: total };
}
```

```ts
// quarantine.ts (finalize core; layout/staging elided for brevity — see §4.3/§7.1)
import { existsSync, lstatSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

import { atomicWriteJson } from "@/intake/fs-utils";
import { isFilesystemRoot, isStrictlyInside } from "@/intake/paths";

import { hashFileSha256 } from "./hash";
import { SHA256_HEX_PATTERN, WatcherQuarantineError } from "./types";

export interface QuarantineLayout {
  readonly root: string;
  readonly stagingRoot: string;
  readonly contentRoot: string;
  readonly channelsRoot: string;
}

export function createQuarantineLayout(root: string): QuarantineLayout {
  if (isFilesystemRoot(root)) {
    throw new WatcherQuarantineError(`watcher_quarantine_root_unsafe: ${root} is a filesystem root`);
  }
  // UNCERTAIN: repo-tree exclusion — the orchestrator should additionally refuse a
  // root inside the repository working tree; the exact "repo root" discovery
  // convention (nearest package.json vs explicit flag) is a Codex integration choice.
  return {
    root,
    stagingRoot: join(root, "staging"),
    contentRoot: join(root, "content"),
    channelsRoot: join(root, "channels"),
  };
}

export interface FinalizeInput {
  readonly stagedFilePath: string;
  readonly reportedByteSize: number | null;
  readonly maxBytes: number;
}

export interface FinalizeResult {
  readonly sha256: string;
  readonly byteSize: number;
  readonly contentRef: string;
  readonly deduplicated: boolean;
}

export function contentPathFor(layout: QuarantineLayout, sha256: string): string {
  if (!SHA256_HEX_PATTERN.test(sha256)) {
    throw new WatcherQuarantineError(`watcher_quarantine_hash_mismatch: malformed digest`);
  }
  return join(layout.contentRoot, sha256.slice(0, 2), sha256);
}

export function finalizeAttachment(layout: QuarantineLayout, input: FinalizeInput): FinalizeResult {
  const staged = lstatSync(input.stagedFilePath);
  if (!staged.isFile() || staged.isSymbolicLink()) {
    throw new WatcherQuarantineError(
      `watcher_quarantine_symlink_rejected: ${input.stagedFilePath}`,
    );
  }
  if (!isStrictlyInside(input.stagedFilePath, layout.stagingRoot)) {
    throw new WatcherQuarantineError(
      `watcher_quarantine_traversal_rejected: staged file outside staging root`,
    );
  }

  const { sha256, byteSize } = hashFileSha256(input.stagedFilePath, input.maxBytes);
  if (input.reportedByteSize !== null && input.reportedByteSize !== byteSize) {
    throw new WatcherQuarantineError(
      `watcher_quarantine_byte_count_mismatch: reported ${input.reportedByteSize}, actual ${byteSize}`,
    );
  }

  const target = contentPathFor(layout, sha256);
  const contentRef = `content/${sha256.slice(0, 2)}/${sha256}`;

  if (existsSync(target)) {
    const existing = statSync(target);
    if (existing.size !== byteSize) {
      // Practically unreachable for SHA-256; fail closed rather than overwrite.
      throw new WatcherQuarantineError(`watcher_quarantine_content_collision: ${sha256}`);
    }
    rmSync(input.stagedFilePath, { force: true });
    return { sha256, byteSize, contentRef, deduplicated: true };
  }

  mkdirSync(dirname(target), { recursive: true });
  renameSync(input.stagedFilePath, target); // atomic publish, same volume
  atomicWriteJson(`${target}.meta.json`, {
    watcher_content_meta_version: "1",
    sha256,
    byte_size: byteSize,
  });
  return { sha256, byteSize, contentRef, deduplicated: false };
}
```

### 11.6 `src/watcher/dedupe.ts`

```ts
export interface MessageAttachmentIdentity {
  readonly registry_id: string;
  readonly message_id: number;
  readonly attachment_index: number;
  readonly revision: number;
}

export function messageIdentityKey(identity: MessageAttachmentIdentity): string {
  return `${identity.registry_id}:${identity.message_id}:${identity.attachment_index}:r${identity.revision}`;
}

export type DuplicateState = "new_content" | "content_duplicate" | "exact_replay";

export interface ClassifyDuplicateInput {
  /** sha256 previously finalized for this exact identity key, if any. */
  readonly priorShaForIdentity: string | null;
  /** true when these bytes already exist in the content store under any identity. */
  readonly contentSeenBefore: boolean;
  readonly sha256: string;
}

export function classifyDuplicate(input: ClassifyDuplicateInput): DuplicateState {
  if (input.priorShaForIdentity !== null && input.priorShaForIdentity === input.sha256) {
    return "exact_replay";
  }
  if (input.contentSeenBefore) {
    return "content_duplicate";
  }
  return "new_content";
}
```

### 11.7 `src/watcher/classify.ts` and `src/watcher/state.ts` (condensed)

```ts
// classify.ts
import type { WatcherRegistryEntry } from "./registry";
import type { WatcherEventAttachment } from "./event";
import type { DuplicateState } from "./dedupe";

export type WatcherClassification =
  | "canonical_price_table"
  | "visual_master_plan"
  | "construction_photo"
  | "construction_video"
  | "other_document"
  | "unsupported_attachment"
  | "manual_review_required";

export type WatcherRecommendation =
  | "route_to_sip_price_list"
  | "register_visual_master_plan"
  | "register_construction_media"
  | "retain_other_document"
  | "manual_review_required"
  | "ignore_duplicate_content";

const PRICE_KEYWORDS = ["price list", "pricelist", "price"] as const;
const MASTER_PLAN_KEYWORDS = ["master plan", "masterplan"] as const;
const CONSTRUCTION_KEYWORDS = ["construction", "progress", "site update"] as const;

const DOCUMENT_EXTENSIONS = new Set([".pdf"]);
const PHOTO_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov"]);

export interface ClassificationInput {
  readonly entry: WatcherRegistryEntry;
  readonly attachment: WatcherEventAttachment;
  readonly displayName: string;
  readonly sourceText: string | null;
  readonly duplicateState: DuplicateState;
}

export interface ClassificationResult {
  readonly classification: WatcherClassification;
  readonly recommendation: WatcherRecommendation;
  readonly matched_signals: readonly string[];
  readonly ambiguity: string | null;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot).toLowerCase();
}

function matchAny(haystack: string, keywords: readonly string[]): string[] {
  return keywords.filter((keyword) => haystack.includes(keyword));
}

export function classifyAttachment(input: ClassificationInput): ClassificationResult {
  const { entry, attachment, duplicateState } = input;
  const haystack = `${input.displayName} ${input.sourceText ?? ""}`.toLowerCase();
  const extension = extensionOf(input.displayName);
  const mime = (attachment.mime_type ?? "").toLowerCase();

  const isDocument = DOCUMENT_EXTENSIONS.has(extension) || mime === "application/pdf";
  const isPhoto = PHOTO_EXTENSIONS.has(extension) || mime.startsWith("image/");
  const isVideo = VIDEO_EXTENSIONS.has(extension) || mime.startsWith("video/");

  const priceHits = matchAny(haystack, PRICE_KEYWORDS);
  const planHits = matchAny(haystack, MASTER_PLAN_KEYWORDS);
  const constructionHits = matchAny(haystack, CONSTRUCTION_KEYWORDS);

  let classification: WatcherClassification;
  let ambiguity: string | null = null;
  let signals: string[] = [];

  const classCount = Number(isDocument) + Number(isPhoto) + Number(isVideo);
  if (classCount === 0) {
    classification = "unsupported_attachment";
  } else if (classCount > 1) {
    classification = "manual_review_required";
    ambiguity = "mime_extension_conflict";
  } else if (isDocument) {
    if (priceHits.length > 0 && planHits.length > 0) {
      classification = "manual_review_required";
      ambiguity = "price_and_master_plan_signals";
      signals = [...priceHits, ...planHits];
    } else if (priceHits.length > 0) {
      classification = "canonical_price_table";
      signals = priceHits;
    } else if (planHits.length > 0) {
      classification = "visual_master_plan";
      signals = planHits;
    } else {
      classification = "other_document";
    }
  } else if (isPhoto) {
    if (constructionHits.length > 0) {
      classification = "construction_photo";
      signals = constructionHits;
    } else {
      classification = "manual_review_required";
      ambiguity = "photo_without_bounded_signal";
    }
  } else {
    if (constructionHits.length > 0) {
      classification = "construction_video";
      signals = constructionHits;
    } else {
      classification = "manual_review_required";
      ambiguity = "video_without_bounded_signal";
    }
  }

  return {
    classification,
    recommendation: deriveRecommendation(classification, entry, duplicateState),
    matched_signals: signals,
    ambiguity,
  };
}

export function deriveRecommendation(
  classification: WatcherClassification,
  entry: WatcherRegistryEntry,
  duplicateState: DuplicateState,
): WatcherRecommendation {
  if (duplicateState !== "new_content") return "ignore_duplicate_content";
  const categories = entry.allowed_source_categories;
  switch (classification) {
    case "canonical_price_table":
      return entry.accept_price_lists && categories.includes("price_list")
        ? "route_to_sip_price_list"
        : "manual_review_required";
    case "visual_master_plan":
      return entry.accept_master_plans && categories.includes("master_plan")
        ? "register_visual_master_plan"
        : "manual_review_required";
    case "construction_photo":
    case "construction_video":
      return entry.accept_construction_media && categories.includes("construction_media")
        ? "register_construction_media"
        : "manual_review_required";
    case "other_document":
      return categories.includes("document") ? "retain_other_document" : "manual_review_required";
    case "unsupported_attachment":
    case "manual_review_required":
      return "manual_review_required";
  }
}
```

```ts
// state.ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { atomicWriteJson } from "@/intake/fs-utils";

import type { QuarantineLayout } from "./quarantine";
import {
  RECENT_MESSAGE_KEY_LIMIT,
  WatcherStateError,
  assertNoSecretMaterial,
} from "./types";

export type WatcherChannelHealth = "never_checked" | "ok" | "degraded" | "failed";

export interface WatcherChannelState {
  readonly watcher_state_schema_version: "1";
  readonly registry_id: string;
  readonly last_observed_message_id: number | null;
  readonly last_processed_message_id: number | null;
  readonly transport_cursor: string | null; // opaque, advisory only
  readonly last_check_at: string | null;
  readonly last_success_at: string | null;
  readonly health: WatcherChannelHealth;
  readonly recent_message_keys: readonly string[]; // bounded identity keys
  readonly receipt_refs: readonly string[];        // bounded, most recent first
}

export function emptyChannelState(registryId: string): WatcherChannelState {
  return {
    watcher_state_schema_version: "1",
    registry_id: registryId,
    last_observed_message_id: null,
    last_processed_message_id: null,
    transport_cursor: null,
    last_check_at: null,
    last_success_at: null,
    health: "never_checked",
    recent_message_keys: [],
    receipt_refs: [],
  };
}

export function channelStatePath(layout: QuarantineLayout, registryId: string): string {
  return join(layout.channelsRoot, registryId, "state.json");
}

export function readChannelState(layout: QuarantineLayout, registryId: string): WatcherChannelState {
  const path = channelStatePath(layout, registryId);
  if (!existsSync(path)) return emptyChannelState(registryId);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
  } catch {
    throw new WatcherStateError(`watcher_state_unreadable: ${path}`);
  }
  const record = parsed as Record<string, unknown>;
  if (record?.watcher_state_schema_version !== "1") {
    // Fail safely: never silently reset or migrate.
    throw new WatcherStateError(
      `watcher_state_migration_unsupported: ${String(record?.watcher_state_schema_version)}`,
    );
  }
  if (record.registry_id !== registryId) {
    throw new WatcherStateError(`watcher_state_unreadable: registry_id mismatch at ${path}`);
  }
  return record as unknown as WatcherChannelState;
}

export function writeChannelState(layout: QuarantineLayout, state: WatcherChannelState): void {
  assertNoSecretMaterial(state, "watcher_state_secret_rejected");
  atomicWriteJson(channelStatePath(layout, state.registry_id), state);
}

/** Advance the processed cursor. Call ONLY after receipt + finalization are durable. */
export function advanceProcessed(
  state: WatcherChannelState,
  messageId: number,
  identityKeys: readonly string[],
  receiptRefs: readonly string[],
  now: string,
): WatcherChannelState {
  if (state.last_processed_message_id !== null && messageId <= state.last_processed_message_id) {
    return state; // idempotent replay: never regress
  }
  return {
    ...state,
    last_observed_message_id: Math.max(state.last_observed_message_id ?? 0, messageId),
    last_processed_message_id: messageId,
    last_check_at: now,
    last_success_at: now,
    health: "ok",
    recent_message_keys: [...identityKeys, ...state.recent_message_keys].slice(0, RECENT_MESSAGE_KEY_LIMIT),
    receipt_refs: [...receiptRefs, ...state.receipt_refs].slice(0, RECENT_MESSAGE_KEY_LIMIT),
  };
}
```

### 11.8 `src/watcher/receipt.ts`

```ts
import { sha256OfJson } from "@/intake/sip/artifacts";

import type { WatcherRegistryEntry } from "./registry";
import type { WatcherSourceEvent, WatcherEventAttachment } from "./event";
import type { ClassificationResult } from "./classify";
import type { DuplicateState, MessageAttachmentIdentity } from "./dedupe";
import type { FinalizeResult } from "./quarantine";
import type { SanitizedDisplayName } from "./filename";

export interface WatcherAttachmentReceipt {
  readonly watcher_receipt_schema_version: "1";
  readonly project_slug: string;
  readonly developer_slug: string;
  readonly registry_id: string;
  readonly channel_username: string;
  readonly message_id: number;
  readonly published_at: string;
  readonly edited_at: string | null;
  readonly message_link: string | null;
  readonly attachment_index: number;
  readonly revision: number;
  readonly display_name: string;
  readonly original_filename: string | null;
  readonly mime_type: string | null;
  readonly sha256: string;
  readonly byte_size: number;
  readonly quarantine_content_ref: string;
  readonly classification: ClassificationResult["classification"];
  readonly duplicate_state: DuplicateState;
  readonly recommended_processor: ClassificationResult["recommendation"];
  readonly matched_signals: readonly string[];
  readonly warnings: readonly string[];
  readonly owner_review_required: boolean;
  readonly ingested_at: string;
  /** sha256OfJson of this receipt with receipt_content_sha256 = "" — tamper evidence. */
  readonly receipt_content_sha256: string;
}

export interface BuildAttachmentReceiptInput {
  readonly entry: WatcherRegistryEntry;
  readonly event: WatcherSourceEvent;
  readonly attachment: WatcherEventAttachment;
  readonly identity: MessageAttachmentIdentity;
  readonly sanitized: SanitizedDisplayName;
  readonly finalize: FinalizeResult;
  readonly classification: ClassificationResult;
  readonly duplicateState: DuplicateState;
  readonly warnings: readonly string[];
}

export function buildAttachmentReceipt(input: BuildAttachmentReceiptInput): WatcherAttachmentReceipt {
  const base: Omit<WatcherAttachmentReceipt, "receipt_content_sha256"> = {
    watcher_receipt_schema_version: "1",
    project_slug: input.entry.project_slug,
    developer_slug: input.entry.developer_slug,
    registry_id: input.entry.registry_id,
    channel_username: input.entry.channel_username,
    message_id: input.event.message_id,
    published_at: input.event.published_at,
    edited_at: input.event.edited_at,
    message_link: input.event.message_link,
    attachment_index: input.identity.attachment_index,
    revision: input.identity.revision,
    display_name: input.sanitized.display_name,
    original_filename: input.sanitized.original_filename,
    mime_type: input.attachment.mime_type,
    sha256: input.finalize.sha256,
    byte_size: input.finalize.byteSize,
    quarantine_content_ref: input.finalize.contentRef,
    classification: input.classification.classification,
    duplicate_state: input.duplicateState,
    recommended_processor: input.classification.recommendation,
    matched_signals: input.classification.matched_signals,
    warnings: input.warnings,
    owner_review_required: input.classification.recommendation !== "ignore_duplicate_content",
    ingested_at: input.event.ingested_at,
  };
  return {
    ...base,
    receipt_content_sha256: sha256OfJson({ ...base, receipt_content_sha256: "" }),
  };
}

export function receiptRelativePath(identity: MessageAttachmentIdentity): string {
  return `channels/${identity.registry_id}/receipts/${identity.message_id}/a${identity.attachment_index}-r${identity.revision}.receipt.json`;
}

export function renderOwnerSummaryLine(receipt: WatcherAttachmentReceipt): string {
  const review = receipt.owner_review_required ? "REVIEW" : "ok";
  return [
    review,
    receipt.project_slug,
    receipt.channel_username,
    `msg ${receipt.message_id}`,
    receipt.classification,
    receipt.duplicate_state,
    `→ ${receipt.recommended_processor}`,
    receipt.display_name,
  ].join("  |  ");
}
```

Marked uncertainties (do not invent — resolve during integration): repo-tree exclusion discovery for the quarantine root (§11.5); whether `hashFile` is exported from `src/intake/inventory.ts` instead of the watcher-owned copy (§2.2); the committed location of the real registry (§10); whether jsdom-environment Vitest needs a `// @vitest-environment node` pragma for the process-spawning lock test (the intake suite runs equivalent tests under the default config — follow whatever `src/intake/tests/lock-process.test.ts` does).

---

## 12. Codex integration packet (TG-WATCH-001A implementation)

**Task**: Implement TG-WATCH-001A exactly as specified in `docs/TG_WATCH_001A_OFFLINE_CORE_PACKAGE.md` (this file). Do not redo the architecture analysis.

**Scope**: New area `src/watcher/` per the file map (§10) + `package.json` script `watch:replay`. No changes to Project Detail, Navigator, Booth, database, import engine, production application code, or `src/intake/` (except the optional one-line `hashFile` export if you choose that over the watcher-owned copy — state your choice in the PR).

**Steps**:
1. Create `src/watcher/` from the drafts in §11, adapting to compile under the repo's strict TS; add `transport/replay.ts`, `run.ts`, `cli-args.ts`, `cli.ts`, `run-cli.mjs`, `index.ts` per §4/§10.
2. Wire the reuse points exactly as cited in §2.1 (`@/intake/paths`, `@/intake/fs-utils`, `@/intake/zip`, `@/intake/txn`, `@/intake/sip/artifacts`, `@/intake/sip/source-integrity`, `@/import/persistence-projection`). Report any cited export that does not integrate cleanly instead of working around it silently.
3. Build the synthetic fixtures (§9 fixture list) — hand-written magic-number blobs only; no real Telegram exports, media, client information, or developer PDFs.
4. Implement the 21-group Vitest matrix (§9), reusing intake test conventions (temp dirs, injected clock, fail-closed no-DB/no-network guards, real-process lock test).
5. Resolve the four marked uncertainties (§11 tail) with the smallest safe choice; document each in the PR.
6. Run on real Windows: `npx tsc --noEmit`-equivalent check, lint of changed files, and two consecutive full `npm test` suites (existing suites must remain green and unsharded, matching the SIP-001B evidence convention).
7. Fix integration defects found; keep the change the smallest safe one.
8. Open a **draft PR** titled `TG-WATCH-001A: transport-independent offline watcher core` summarizing: files added, primitives reused, uncertainty resolutions, test counts/timings, and the honest boundary statement (no Telegram authentication, no network, no import, no publication, Coralina unpublished, Rainpalm unimported, Factory A0). Never merge your own PR.

**Boundaries (fail closed)**: no Telegram client/library installation, no api_id/api_hash/phone/session anywhere (including tests), no network access, no database client, no automatic import/publication, no repository writes at watcher runtime, no OCR/AI/content parsing of attachments.
