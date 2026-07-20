# TG-WATCH-001A — Universal Read-Only Telegram Source Watcher: Transport-Independent Core and Offline Pilot

Status: Implemented, pending independent review and Owner approval
Task: TG-WATCH-001A (first implementation step of the TG-WATCH-001 checkpoint in `docs/CURRENT_STAGE.md`)
Derives from: `docs/CURRENT_STAGE.md` — "TG-WATCH-001 — Universal Read-Only Telegram Source Watcher Design and Safe Pilot"
Date: 2026-07-20

---

## 1. What this is

One universal local watcher for the public Telegram channels of The Title
projects (first: `@coralinakamala`) and, later, other developers' channels —
implemented as ONE system with a channel registry, not one agent per channel.

TG-WATCH-001 is delivered in two stages:

- **TG-WATCH-001A (this stage)** — the complete transport-independent watcher
  core plus an **offline transport**: the official Telegram Desktop
  "Export chat history" JSON format, produced manually by the Owner on their
  Windows laptop. No Telegram authentication, session, credential, or network
  access exists anywhere in this stage.
- **TG-WATCH-001B (later, separately gated)** — a live read-only transport
  behind the same normalized contract. It requires its own Owner review gate
  because it introduces Telegram authentication and credential storage
  (see §8). Nothing in 001A presumes 001B's approval.

The watcher **prepares and recommends only**. It quarantines sources,
preserves history, detects duplicates and edits, classifies for review, and
writes Owner-review output. It never runs SIP extraction, Fast Intake, a
database client, an import, a lead, or a publication. Coralina remains
unpublished; Rainpalm remains unimported and unpublished; Factory remains A0.

## 2. Why this architecture (decision record)

The stage wording in `docs/CURRENT_STAGE.md` assumed "one protected Telegram
user session" from the start. This implementation deliberately reorders that:
the **transport-independent core comes first**, and the user session is
deferred to a separately gated stage. Reasons:

1. **Every hard requirement of TG-WATCH-001 except "live" is
   transport-independent.** Registry, quarantine, SHA-256 duplicate
   protection, edit history, per-channel cursor, classification, and
   Owner-review output are pure local mechanics. They are the durable 80% of
   the system and can be built, tested, and piloted today with zero credential
   risk.
2. **The offline transport is not disposable work — it is the official
   fallback forever.** Telegram Desktop's export (documented by Telegram at
   `https://core.telegram.org/import-export`) is produced by the Owner's
   ordinary logged-in desktop app. Even after a live transport exists, the
   export path remains the recovery/backfill mechanism and the
   credential-free operating mode.
3. **The hard safety boundaries of this checkpoint forbid everything a live
   transport needs** (no Telegram authentication, no api_id/api_hash/phone/
   session storage, no downloading real channel history). Designing only — or
   worse, half-implementing a live client that cannot be run — would have
   produced another theoretical document instead of a working, testable
   system.

### Alternatives considered and rejected

- **Telegram Bot API** — rejected as the transport. A bot cannot read the
  history of a channel it does not administer; The Title's channels belong to
  the developer, so a Forever bot can never be added to them. Fundamentally
  unfit, not merely inconvenient.
- **Scraping `t.me/s/<channel>` web previews** — rejected. Unofficial,
  incomplete (documents and full-size media are not reliably available),
  fragile against markup changes, and still requires network access that this
  checkpoint does not authorize.
- **Immediate MTProto user-session implementation** — rejected for this stage.
  Violates the checkpoint's explicit boundaries (authentication, credential
  storage, real history download) and couples all core logic to the riskiest,
  least-testable component.
- **One agent/script per channel** — rejected by the business requirement
  itself; the registry plus one engine scales from 1 to 15+ channels by
  adding registry entries only.
- **Databases, queues, daemons, dashboards, OCR, AI classification** —
  rejected as premature. 12–15 channels at channel-post cadence is trivially
  handled by deterministic CLI runs over canonical JSON artifacts, exactly
  like the rest of the Forever intake family. Nothing prevents adding a
  scheduler later; nothing here would need rework.

## 3. What was reused (no second intake platform)

The watcher is a sibling of SIP inside the existing intake family
(`src/intake/watch/`, alongside `src/intake/sip/`), reusing:

- `src/intake/paths.ts` — path-safety guards (`isStrictlyInside`,
  `isFilesystemRoot`, `IntakePathError`) for export/quarantine boundary
  enforcement;
- `src/intake/fs-utils.ts` — canonical JSON form and atomic temp+rename
  writes for every artifact;
- `src/intake/txn.ts` — the per-directory lock with safe stale-lock reclaim
  (`acquireProjectLock`/`releaseProjectLock`), taken once on the watch root;
- `src/intake/classify.ts` — the shared deterministic classifier, applied to
  published filenames (routing only, never facts);
- `src/intake/sip/source-integrity.ts` — `fingerprintSourceFile` for SHA-256 +
  byte-size fingerprints;
- the SIP-001B `origin_channel` convention and public-channel pattern
  (`^@[A-Za-z][A-Za-z0-9_]{4,31}$`), so watcher provenance aligns with
  `sip:package` update bundles;
- jiti CLI bootstrap pattern (`run-cli.mjs`) and the exception-style CLI
  summary conventions of Fast Intake/SIP.

Zero new dependencies. Zero paid dependencies. No lockfile change.

## 4. Module and data layout

Code: `src/intake/watch/` — `types.ts`, `registry.ts`, `export-adapter.ts`
(the only transport-specific file), `classify.ts`, `store.ts`, `review.ts`,
`run.ts`, `cli-args.ts`, `cli.ts`, `run-cli.mjs`. Owner command:

```
npm.cmd run tg-watch -- --channel @coralinakamala --export "C:\forever-incoming\tg-export\coralinakamala"
```

**Committed configuration vs runtime data are strictly separate.** The only
committed watch file is the channel registry
(`forever-data/watch/channel-registry.json`). All runtime data — quarantine
objects, ledgers, state, the duplicate index, reports, locks, and temp files —
lives OUTSIDE the repository working tree in the runtime root: default
`<home>/forever-watch` (e.g. `C:\Users\<owner>\forever-watch` on Windows),
overridable with `--out-root`. The watcher rejects, before writing anything, a
runtime root that is a filesystem root, is inside the repository, contains the
repository, is a symlink/junction, or overlaps the export source; it likewise
rejects a symlinked export directory.

```
<home>/forever-watch/               runtime root (never committed, never in-repo)
  object-index.json                 SHA-256 → sightings across ALL channels
  channels/<channel_key>/
    media/<sha256><ext>             content-addressed quarantine (originals, immutable)
    channel-ledger.json             full message history; edits append versions
    state.json                      cursor: last processed id, channel-id pin
    review/run-<stamp>.json         per-run Owner-review report (canonical JSON)
    review/LATEST.md                the same report rendered for the Owner
```

Key mechanics:

- **Channel identity is proven, never assumed.** The CLI flag and the export's
  display name prove nothing. Each registry entry carries an Owner-approved
  `telegram_channel_id` binding to the channel's stable numeric id. An
  UNBOUND entry (`null`) fails closed on the first run: the watcher reports
  the id and display name the export claims, ingests nothing, and instructs
  the Owner to verify (export the channel themselves from Telegram Desktop)
  and set the binding in the committed registry. Every later run re-verifies
  the binding, and `state.json` additionally pins the id seen by this channel
  directory's history, so even a silently re-edited registry fails closed.
- **Quarantine is content-addressed and verified.** A file is stored under
  its own SHA-256 (plus a strictly allowlisted lowercase extension).
  Published filenames are ledger DATA only and never become filesystem paths.
  An already-existing object is accepted as a duplicate ONLY after its actual
  bytes re-verify against the expected hash and size; corruption,
  substitution, truncation, a directory, a symlink, or any non-regular file
  in an object slot fails the run closed.
- **All hashing is streaming and size-bounded.** Files are never loaded fully
  into memory; a per-attachment ceiling (default 512 MiB,
  `--max-attachment-mb`) is enforced against the observed size before any
  copy and against the actual bytes during reads and copies, so disk
  consumption is bounded and partial staging files are always cleaned up
  (including stale `.tmp-*` residue from a crashed run, removed under the
  lock at run start). Oversized attachments are recorded honestly
  (`presence: "oversized"`, observed size, no bytes stored) and re-ingested
  automatically as new versions once the Owner raises the limit. A declared
  export size that contradicts the actual bytes is stored (actual bytes win)
  but flagged `declared_mismatch` and warned.
- **The ledger is append-only history, including excluded events.** An edited
  post (or a re-export that now includes previously omitted or
  previously-oversized bytes) appends a new version with its own content
  hash; nothing is overwritten or deleted. Service messages and unrecognized
  message types are recorded durably in the ledger as excluded events with
  their raw type — never interpreted, never silently dropped. An excluded
  event without a usable id fails the run closed.
- **Duplicates are detected at two levels**: inside a channel (repost of
  byte-identical files) and across channels (the shared `object-index.json`),
  both by SHA-256 of content, never by filename.
- **Cursor rule.** `last_processed_message_id` advances only past events that
  are durably recorded — processed posts (ledger versions) or excluded events
  (ledger `excluded_messages`). Nothing is skipped and then passed over.
  Every run still re-verifies all posts present in the snapshot by version
  hash, so edits of OLD posts are always detected. Previously recorded
  messages missing from the current snapshot's id span are surfaced as
  `possibly_deleted_message_ids` (deletion on Telegram, or a narrower export
  range); the ledger keeps their full history either way.
- **Symlink/reparse-point policy.** Every boundary uses real-path containment
  (existing intake guards resolve through links) PLUS explicit lstat
  rejection of links at the export root, the runtime root, every managed
  directory the watcher writes through, every media source file, and every
  stored object. Node reports Windows junctions/reparse points as symbolic
  links to `lstat`, so the same checks apply there; a real-Windows
  reparse-point validation step is part of the Codex audit (§12).
- **Crash model.** Simpler than Fast Intake's journal and sufficient here:
  media blobs are staged temp+rename and verified by re-hash of the copied
  bytes (a source mutated during the copy fails closed); ledger, index,
  state, and reports are whole-document atomic writes committed in dependency
  order (media → ledger → index → state → report). A crash leaves at worst an
  unreferenced staging/orphan blob or a cursor older than the ledger;
  re-running the same export is idempotent and converges byte-identically.
- **Determinism and portability.** Same input + same `--run-at` ⇒
  byte-identical artifacts; no absolute Owner-machine path appears in any
  artifact (tested, including a real double-run CLI replay).
- **Privacy.** The ledger retains the full text of channel posts — public
  channel content, kept locally on the Owner's machine for provenance and
  edit history; reports carry excerpts only; nothing is transmitted anywhere.

## 5. Classification and Owner review

Each attachment gets a review bucket — `price_table`, `visual_master_plan`,
`construction_media`, `document`, `manual_review_required`, `other` — derived
deterministically and CONSERVATIVELY: the published filename through the
shared intake classifier first, then deterministic English/Russian keyword
hints in the filename itself, then the same hints in the message caption
(bare media and unclassifiable files only — a named document or archive is
never re-routed by a caption). **Media with no deterministic signal at all is
`manual_review_required`, never assumed to be construction media**; archives
are opaque containers routed to `other` and never opened by the watcher.
Buckets are routing for review, never facts about content (the same honesty
rule as `src/intake/classify.ts`).

The run report lists every new/edited post with excerpts, hashes, duplicate
flags, and a **recommended** next action per bucket — e.g. a price-table PDF
recommends a separately owner-run `npm run sip:price-list` (non-PDF price
candidates are flagged for manual handling instead, since SIP-001A extraction
supports qualified text PDFs only), a master plan recommends pairing via
`npm run sip:package` after price-list review. The report carries explicit
no-extraction / no-import / no-publication statements.

## 6. Threat model (summary)

All channel content is **untrusted data, never instruction** (Factory
Constitution §18). Specific surfaces and mitigations:

| Surface                                                                        | Mitigation                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Malicious published filename (traversal, reserved names, homoglyph extensions) | Filenames never become paths; storage names are `sha256` + allowlisted extension; ledger stores the raw name as JSON data only                                                                                          |
| Hostile paths inside `result.json` (`../`, absolute, drive letter, backslash)  | Fail-closed rejection; resolved paths must be strictly inside the export root (`isStrictlyInside`, real-path based)                                                                                                     |
| Symlink / Windows junction escapes                                             | lstat rejection of links at the export dir, runtime root, managed dirs, media files, and object slots, on top of real-path containment; real-Windows reparse validation assigned to the Codex audit                     |
| Impersonated channel export (wrong or hostile source folder)                   | Owner-approved `telegram_channel_id` registry binding verified every run; unbound channels fail closed on first run; `state.json` id pin catches later registry tampering                                               |
| Quarantine corruption or substitution                                          | Existing objects re-verified byte-for-byte (streaming SHA-256 + size) before being accepted as duplicates; mismatch fails closed                                                                                        |
| Disk exhaustion via huge attachments                                           | Streaming, size-bounded hashing/copying with a 512 MiB default ceiling (`--max-attachment-mb`); oversized files recorded honestly, no partial writes, stale temp files cleaned under the lock                           |
| Quarantine/source tree overlap; runtime data inside the repo                   | Fail-closed boundary checks: export vs runtime root overlap, runtime root inside/containing the repository, filesystem roots                                                                                            |
| Secrets or personal data creeping into committed config                        | Registry schema rejects unknown properties and secret-shaped values (token/hex/base64/phone/credential-keyword patterns)                                                                                                |
| Concurrent runs corrupting the shared index                                    | One watch-root lock with safe stale-lock reclaim (reused from Fast Intake)                                                                                                                                              |
| Archive bombs / nested archives                                                | Archives are quarantined as opaque bytes, never extracted or hint-routed by the watcher; extraction stays behind Fast Intake's hardened ZIP boundary                                                                    |
| Silently lost source events                                                    | Service/unrecognized messages are recorded durably as excluded ledger events (fail closed if id-less); the cursor advances only past recorded events; missing previously-seen messages are surfaced as possibly deleted |
| Prompt-injection text in posts                                                 | Text is stored and excerpted as data; no AI processing exists in the watcher                                                                                                                                            |
| Fabrication pressure (captions "proving" facts)                                | Buckets/hints are routing only, conservative by default (`manual_review_required`); facts can only enter Forever through the existing SIP/Fast Intake review gates                                                      |

## 7. Owner runbook (Windows)

One-time per channel:

1. Add a registry entry to `forever-data/watch/channel-registry.json`
   (channel, developer, project slug, `"telegram_channel_id": null`,
   `"status": "active"`).
2. **First-run binding.** Export the channel yourself (step A below) and run
   the watcher. It will refuse to ingest and print the numeric channel id the
   export claims. Verify the export really is the right channel (you opened
   it yourself in Telegram Desktop), then set that id as
   `telegram_channel_id` in the registry and re-run. From then on every run
   verifies this binding automatically.

Per update cycle:

A. In **Telegram Desktop**, open the channel → ⋮ menu → **Export chat
history**. Format: **Machine-readable JSON**. Enable photos, videos, and
files with a generous size limit. Choose the date range (a full re-export
is safe — the watcher is idempotent; overlapping ranges are deduplicated).
B. Wait for the export to finish and note the export folder (it contains
`result.json`).
C. Run, in PowerShell or cmd.exe:
`npm.cmd run tg-watch -- --channel @coralinakamala --export "<export folder>"`
Runtime data goes to `C:\Users\<you>\forever-watch` by default; use
`--out-root` to choose another location OUTSIDE the repository. For videos
larger than 512 MiB, raise the ceiling, e.g. `--max-attachment-mb 2048`.
D. Read `<runtime root>\channels\coralinakamala\review\LATEST.md` and act on
recommendations (each is a separate, owner-authorized command).
E. Re-run any time; a run with no channel news reports zero changes.

Notes: attachments the export omitted are listed as `not_exported`, and
attachments over the size ceiling as `oversized`, each with a warning —
re-export with files enabled or raise `--max-attachment-mb` to capture their
bytes on the next run. The `--run-at` flag exists for deterministic repeat
proofs and tests.

## 8. Live transport recommendation (TG-WATCH-001B — not implemented, not authorized here)

Recommendation for the later live phase, to be re-validated at its own gate:

- **Primary: an MTProto user-session client library maintained for Node.js
  (GramJS, npm package `telegram`)** driving the SAME normalized
  `ChannelSnapshot` contract as the export adapter. Rationale: read-only
  access to public channels the account follows, full history and media
  access, edit timestamps, single-language stack (TypeScript, matching this
  repository), no native binary.
- **Alternative: TDLib** (Telegram's official client library) if GramJS
  reliability disappoints; heavier (native binary + JSON bridge) but
  first-party.
- **Rejected: Bot API** (cannot read third-party channels; see §2).
- 001B must separately design: api_id/api_hash issuance by the Owner, session
  encryption at rest on the Owner's laptop, scope limitation to registry
  channels, rate limiting, and an explicit kill switch. None of that is
  needed for 001A operation.

Library choice must be re-verified against current maintenance status when
001B is actually scheduled — it is a recommendation, not a canonical decision.

## 9. Scaling from Coralina to all Title projects

Adding a channel = adding one registry entry (plus, per TG-WATCH-001, Owner
authorization for pilot channels). The second authorized Title pilot channel
is deliberately NOT pre-selected here — `docs/CURRENT_STAGE.md` assigns that
selection to the Owner during TG-WATCH-001. Multiple channels share the
duplicate index automatically; a developer-wide channel may carry
`"project_slug": null`, and its material is routed to review with explicit
Owner project assignment.

## 10. Explicitly out of scope in 001A

No Telegram authentication or credentials; no network access; no live or
scheduled monitoring; no automatic SIP/Fast Intake execution; no database
connection, import, lead, or publication; no OCR/AI classification; no
archive extraction; no admin UI; no Factory autonomy change; no
modification of Coralina's existing draft or of SIP/Fast Intake behavior.

## 10a. Self-review hardening (2026-07-20, second pass on PR #91)

An independent self-review pass hardened the initial implementation. In brief:
runtime storage moved out of the repository (default `<home>/forever-watch`,
strict boundary validation); channel identity now requires an Owner-approved
numeric registry binding with fail-closed first-run behavior; existing
content-addressed objects are byte-verified before dedupe; symlink/junction
rejection was added at every read/write boundary; attachment handling became
streaming and size-bounded with honest oversized reporting; classification
became conservative (`manual_review_required` instead of assumed construction
media; archives never hint-routed); excluded source events are recorded
durably in the ledger and the cursor advances only past recorded events;
candidate deletions are surfaced; the registry rejects unknown properties and
secret-shaped values; stale staging files are cleaned under the lock.

## 11. Validation executed (Linux CI-like environment, Node 22)

After the self-review hardening pass (§10a):

- `npx vitest run src/intake/watch` — 7 files, 70 tests, all passing: export
  adapter (fail-closed shapes, traversal, symlinks, placeholders,
  service/unknown message recording), registry validation (unknown
  properties, binding ids, secret-shaped values), conservative
  classification, cli-args (incl. `--max-attachment-mb`), object integrity
  (substitution, corruption, directory/symlink slots), bounded attachments
  (oversized, limit-raise upgrade, declared-size mismatch, temp cleanup),
  runtime-root policy (in-repo, contains-repo, symlinked roots/dirs),
  channel-identity binding (unbound first run, mismatch, state pin),
  cursor durability with excluded events, possibly-deleted detection, full
  e2e (quarantine, dedupe in/cross channel, edit versioning, idempotency,
  byte-identical determinism, no-absolute-path portability, lock), and a
  strict local-only test with all network/process/database paths stubbed to
  throw.
- Deterministic replay via the real CLI: two `npm run tg-watch` runs into
  fresh runtime roots with the same `--run-at` produced byte-identical trees
  (`diff -r`), with no absolute path in any artifact.
- Full `npm test`, `npm run build`, `npx eslint`, `npx prettier --check`,
  `npx tsc --noEmit` — see the PR record for exact counts; the only failures
  are the two PRE-EXISTING baseline items (importer-preflight tests and the
  partner-demo-data collection failure) that require gitignored Owner-machine
  local data and reproduce identically at the base commit.
- Real-Windows validation (PowerShell/cmd.exe `npm.cmd run tg-watch`, real
  Telegram Desktop export of `@coralinakamala`, junction/reparse-point
  boundary checks) has NOT been performed in this environment and remains for
  the Owner/Codex — see §12.

## 12. Next steps after this stage

1. Independent review of this PR; Owner approval; canonicalization
   (`docs/CURRENT_STAGE.md`, `docs/FOREVER_STATUS.md`, `docs/DECISIONS.md`)
   in the established ledger flow.
2. **Local Windows pilot (Owner + Codex):** real Telegram Desktop JSON export
   of `@coralinakamala`; perform the first-run binding (§7); run the watcher;
   verify the review report against the channel; and compare the quarantined
   2026-07-17 price list/master plan hashes with the committed SIP-001B
   `source-bundle.json` fingerprints (`268c2fa3…`, `1f7d70c8…`) — a
   real-world provenance cross-check.
3. **Real-Windows reparse-point audit (Codex):** on the Owner's machine,
   verify the lstat-based link rejection against actual NTFS junctions and
   symbolic links — (a) a junction as `--out-root`, (b) a junction as the
   export folder, (c) a junction planted as `channels\<key>\media`, and (d) a
   symlinked media file inside an export — each must fail closed with the
   corresponding `*_symlink` / `media_path_unsafe` error and write nothing.
4. Owner selects and authorizes the second Title pilot channel; add its
   registry entry and perform its first-run binding.
5. Only then, and behind its own gate: TG-WATCH-001B live-transport design
   (§8).
