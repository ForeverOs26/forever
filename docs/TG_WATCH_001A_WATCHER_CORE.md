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

Data (watch root, default `forever-data/watch/`, gitignored except the
registry):

```
forever-data/watch/
  channel-registry.json          committed config: channel → developer → project
  object-index.json              SHA-256 → sightings across ALL channels
  channels/<channel_key>/
    media/<sha256><ext>          content-addressed quarantine (originals, immutable)
    channel-ledger.json          full message history; edits append versions
    state.json                   cursor: last processed message id, channel-id pin
    review/run-<stamp>.json      per-run Owner-review report (canonical JSON)
    review/LATEST.md             the same report rendered for the Owner
```

Key mechanics:

- **Quarantine is content-addressed.** A file is stored under its own SHA-256
  (plus a strictly allowlisted lowercase extension). Published filenames are
  ledger DATA only and never become filesystem paths — this removes the
  malicious-filename and collision surface entirely, and makes duplicate
  detection a directory-existence check.
- **The ledger is append-only history.** An edited post (or a re-export that
  now includes previously omitted bytes) appends a new version with its own
  content hash; nothing is overwritten or deleted. Messages absent from a
  later, narrower export are preserved untouched.
- **Duplicates are detected at two levels**: inside a channel (repost of
  byte-identical files) and across channels (the shared `object-index.json`),
  both by SHA-256 of content, never by filename.
- **Cursor semantics.** `last_processed_message_id` marks the review
  watermark; every run still re-verifies all posts present in the snapshot by
  version hash, so edits of OLD posts are always detected. The state pins the
  numeric Telegram channel id on first run and fails closed if a later export
  belongs to a different channel (wrong-folder protection).
- **Crash model.** Simpler than Fast Intake's journal and sufficient here:
  media blobs are temp+rename writes verified by re-hash; ledger, index,
  state, and reports are whole-document atomic writes committed in dependency
  order (media → ledger → index → state → report). A crash leaves at worst an
  unreferenced blob or a stale cursor; re-running the same export is
  idempotent and converges byte-identically.
- **Determinism and portability.** Same input + same `--run-at` ⇒
  byte-identical artifacts; no absolute Owner-machine path appears in any
  artifact (tested).

## 5. Classification and Owner review

Each attachment gets a review bucket — `price_table`, `visual_master_plan`,
`construction_media`, `document`, `other` — derived deterministically:
published filename through the shared intake classifier first; deterministic
English/Russian message-text keyword hints only for bare media and
unclassifiable files; unhinted photos default to construction media. Buckets
are routing for review, never facts about content (the same honesty rule as
`src/intake/classify.ts`).

The run report lists every new/edited post with excerpts, hashes, duplicate
flags, and a **recommended** next action per bucket — e.g. a price-table PDF
recommends a separately owner-run `npm run sip:price-list`, a master plan
recommends pairing via `npm run sip:package` after price-list review. The
report carries explicit no-extraction / no-import / no-publication statements.

## 6. Threat model (summary)

All channel content is **untrusted data, never instruction** (Factory
Constitution §18). Specific surfaces and mitigations:

| Surface | Mitigation |
| --- | --- |
| Malicious published filename (traversal, reserved names, homoglyph extensions) | Filenames never become paths; storage names are `sha256` + allowlisted extension; ledger stores the raw name as JSON data only |
| Hostile paths inside `result.json` (`../`, absolute, drive letter, backslash) | Fail-closed rejection; resolved paths must be strictly inside the export root (`isStrictlyInside`) |
| Wrong export folder for a channel | Numeric channel-id pin in `state.json`; mismatch fails closed before any merge |
| Quarantine/source tree overlap | Fail-closed boundary check between `--export` and `--out-root` |
| Concurrent runs corrupting the shared index | One watch-root lock with safe stale-lock reclaim (reused from Fast Intake) |
| Archive bombs / nested archives | Archives are quarantined as opaque bytes, never extracted by the watcher; extraction stays behind Fast Intake's hardened ZIP boundary |
| Prompt-injection text in posts | Text is stored and excerpted as data; no AI processing exists in the watcher |
| Fabrication pressure (captions "proving" facts) | Buckets/hints are routing only; facts can only enter Forever through the existing SIP/Fast Intake review gates |

## 7. Owner runbook (Windows)

One-time per channel: add a registry entry to
`forever-data/watch/channel-registry.json` (channel, developer, project slug,
`"status": "active"`).

Per update cycle:

1. In **Telegram Desktop**, open the channel → ⋮ menu → **Export chat
   history**. Format: **Machine-readable JSON**. Enable photos, videos, and
   files with a generous size limit. Choose the date range (a full re-export
   is safe — the watcher is idempotent; overlapping ranges are deduplicated).
2. Wait for the export to finish and note the export folder (it contains
   `result.json`).
3. Run, in PowerShell or cmd.exe:
   `npm.cmd run tg-watch -- --channel @coralinakamala --export "<export folder>"`
4. Read `forever-data/watch/channels/coralinakamala/review/LATEST.md` and act
   on recommendations (each is a separate, owner-authorized command).
5. Re-run any time; a run with no channel news reports zero changes.

Notes: attachments the export omitted are listed as `not_exported` with a
warning — re-export with files enabled to capture their bytes. The
`--run-at` flag exists for deterministic repeat proofs and tests.

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

## 11. Validation executed (Linux CI-like environment, Node 22)

- `npx vitest run src/intake/watch` — 6 files, 42 tests, all passing: export
  adapter (fail-closed shapes, traversal, placeholders, service messages),
  registry validation, classification, cli-args, full e2e (quarantine,
  dedupe in/cross channel, edit versioning, cursor, idempotency,
  byte-identical determinism, no-absolute-path portability, lock, channel-id
  pin, overlap rejection), and a strict local-only test with all
  network/process/database paths stubbed to throw.
- Full `npm test` (whole repository) — 2,975 tests passed across 311 files;
  the only failures (3 tests in `src/import/importer-preflight.test.ts` and a
  collection failure in
  `src/features/project-detail/partner-demo-data.test.ts`) were re-verified as
  IDENTICAL at the base commit with this change stashed: both require
  gitignored Owner-machine local data (Coralina dry-run receipt inputs and
  Modeva extracted data) that this environment does not have.
- `npm run build` — production build passed in this environment.
- `npx eslint src/intake/watch` and `npx prettier --check` — clean.
- `npx tsc --noEmit` — no errors from this change; one PRE-EXISTING,
  environment-specific error remains (`partner-demo-data.ts` imports
  gitignored Modeva extracted data that exists only on the Owner's machine);
  identical at the base commit.
- Real-Windows validation (PowerShell/cmd.exe `npm.cmd run tg-watch`, real
  Telegram Desktop export of `@coralinakamala`) has NOT been performed in
  this environment and remains for the Owner/Codex — see §12.

## 12. Next steps after this stage

1. Independent review of this PR; Owner approval; canonicalization
   (`docs/CURRENT_STAGE.md`, `docs/FOREVER_STATUS.md`, `docs/DECISIONS.md`)
   in the established ledger flow.
2. **Local Windows pilot (Owner + Codex):** real Telegram Desktop JSON export
   of `@coralinakamala`, run the watcher, verify the review report against
   the channel, and compare the quarantined 2026-07-17 price list/master plan
   hashes with the committed SIP-001B `source-bundle.json` fingerprints
   (`268c2fa3…`, `1f7d70c8…`) — a real-world provenance cross-check.
3. Owner selects and authorizes the second Title pilot channel; add its
   registry entry.
4. Only then, and behind its own gate: TG-WATCH-001B live-transport design
   (§8).
