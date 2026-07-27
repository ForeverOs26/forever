# Forever Package Factory

One reusable pipeline that turns almost any official project source set into a
physical publish-package the existing Direct Publish lane accepts.

The Factory does not publish. It **prepares**. Publication stays exactly where it
already was: `src/features/forever-direct-publish`, with its production-ref
guard, its Owner trust decision, its atomic create/update, its sanitizer, and its
idempotent replay.

```
Official Source Set  →  Source Resolver  →  Project Identity Resolver
  →  Document Classifier  →  Parser Selection  →  Fact Extraction
  →  Price and Availability Extraction  →  SOLD Reconciliation
  →  Media Classification and Sanitization  →  Publish-Package Builder
  →  Exception Report  →  (optional) explicit production publish
```

---

## Telegram is optional

This is the rule the whole design is built around: **no source type is
mandatory.** A project whose developer has no Telegram channel, or whose entire
dossier is one PDF on a laptop, is an ordinary project and not a degraded one.

A run works normally when Telegram is absent, when Google Drive is absent, when
only a local folder exists, when only an uploaded archive exists, when only one
official PDF exists, when there is no current price, and when the floor-plan set
is incomplete. Missing optional information stays `null`; a missing price never
blocks publication.

The only hard requirement is **at least one Owner-authorized official source
carrying enough information to identify the project.**

---

## The source-set schema

`forever-source-set.v1` — defined in
[`src/features/forever-package-factory/source-set.ts`](../src/features/forever-package-factory/source-set.ts).

```jsonc
{
  "schema_version": "forever-source-set.v1",
  "project_hint": {
    // every field optional
    "name": "The Title Sierra",
    "developer": "Rhom Bho Property",
    "area": "Bang Tao",
    "existing_slug": "the-title-sierra",
    "aliases": ["Sierra Bangtao", "SIB"]
  },
  "sources": [
    /* one or more; no type is required */
  ]
}
```

### Supported adapters

| `type` | Locator | Reads | Network |
|---|---|---|---|
| `local_folder` | `location` | every file under the folder | no |
| `uploaded_archive` | `location` | a `.zip` (store/deflate), read in memory | no |
| `official_document` | `location` | one file | no |
| `google_drive_folder` | `folder_id` | a public Drive dossier, recursively | yes — only with `--allow-network` |
| `telegram_channel` | `channel` (+ optional `archive_root`) | the **lean local archive** only | no |
| `official_website` | `url` | recorded as provenance; no fact is extracted | no |
| `existing_forever_record` | `slug` | names the production project to update | no |

Optional on every entry: `published_at` (when the source distributed it),
`effective_date` (what the document states about itself), `revision` (`"V2"`),
`authority`, `note`.

`location`, `folder_id`, `channel` and `url` are **private**. They are read at
generation time and never enter the payload, the manifest, or any public field.

The Telegram adapter never contacts Telegram and never restores the deleted full
mirror. It reads `<archive_root>/downloads/<slug>/<messageId>/<file>` plus the
archive's own `registry/current_price_sources.json`, and records only the channel
username — never an invite token.

---

## CLI

```bash
npm run package:factory -- --source-set <file.json> --output <dir>
```

```bash
npm run package:factory -- --batch <dir-of-source-sets> --output <dir> --allow-network
```

| Flag | Effect |
|---|---|
| *(none)* | **generate packages** — the default |
| `--dry-run` | plan only; write nothing |
| `--publish-production` | publish the generated packages (the only write path) |
| `--production-identity` | resolve identity against production, read-only |
| `--allow-network` | let the Drive/website adapters fetch |
| `--max-gallery <n>` | gallery cap (default 24) |
| `--max-plans <n>` | floor/unit plan cap (default 13) |
| `--report <path>` | write the exception report as JSON |

Rules the CLI enforces:

* generation is the default; publication requires the explicit flag;
* **staging is always refused** — the shared `assertProductionTarget` rejects the
  staging ref by ref, by name and by URL, and the CLI calls it before any write;
* credentials come only from the process environment
  (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STUDIO_OWNER_USER_ID`) and are
  never printed, logged or placed on a command line;
* a generate-only run constructs no client and reads no credential;
* one failed project in a batch never stops the valid ones.

On Windows use `npm.cmd run package:factory -- …`.

---

## Parser registry

A layout is chosen by **what the document's structure looks like** — never by the
developer's name and never by the filename.

| id | shape | how a row is validated |
|---|---|---|
| `condo-schedule-v1` | tower, floor, status, unit code, type code, room type, area, and two money columns | `area × price_per_sqm ≈ total_price`, with the **order of the two money columns derived**, plus unit-code/tower/floor agreement |
| `villa-schedule-v1` | plot code, villa type, land area in sq.wah and sq.m, built-up area, price | `sq.wah × 4 ≈ sq.m` and plot-code/type agreement |

`condo-schedule-v1` covers, as one layout: both money-column orders,
alphanumeric unit codes, room types beginning with a digit (`1 BEDROOM L`),
hyphenated penthouse names (`PH-3 BEDROOM C - GD`), parenthesised codes
(`1BS(M)`), multi-page tables with repeated headers, thousands groups split by
whitespace (`5,651,  585`), a missing building column, a missing floor column,
and schedules that enumerate only currently-available units.

### Price validation

* rounding tolerance: **0.5 %** of the total (`PRICE_INVARIANT_TOLERANCE`);
* when both column orders fit, or neither does, the row is **rejected** — never
  assigned a plausible reading;
* a rejected row is reported with its exact reason and never becomes a price;
* **a unit's absence from a schedule is never read as SOLD.**

A project may publish with no unit prices. A project must never publish prices
mapped to the wrong units.

### Adding a new layout

1. Write `detect(text): number` and `parse(text): ParseOutcome` in
   `src/features/forever-package-factory/parsers/`.
2. State the arithmetic invariant that a shifted row cannot satisfy, and reject
   rows that fail it.
3. Register the descriptor in `BUILT_IN_LAYOUTS`
   ([`parsers/registry.ts`](../src/features/forever-package-factory/parsers/registry.ts)).
4. Add a fixture in `tests/fixtures.ts` and a test asserting both an accepted row
   and a rejected one.

No other stage changes. Project-specific knowledge belongs in a layout descriptor
or in a source-set file — never in a per-project script.

---

## Source precedence

Deterministic and total, most significant first:

1. the explicit **effective date inside the source**;
2. the official **version / revision**;
3. the **publication date**;
4. the **SHA-256 fingerprint** — an arbitrary but stable final tie-break.

Consequences:

* a newer SOLD announcement overrides an older price list;
* a newer price or availability document may re-list a SOLD unit as available;
* a **byte-identical repost is not a new version**: it creates no new source
  version, no duplicate price row and no duplicate media object;
* decision evidence is preserved privately in the source manifest.

---

## Media selection

Automatic and deterministic; the Owner selects nothing.

Targets per project: one hero, up to 24 gallery images, master plan, site/location
plan, representative floor plans, unit plans, facilities and completed-project
photos where available.

The selector removes exact duplicates by SHA-256, identifies obvious
near-duplicates and keeps the largest, excludes AppleDouble `._*` files and other
junk, excludes material belonging to a different project, and **pre-flights every
candidate through the real sanitizer** so an image whose colour profile cannot be
proven plain sRGB (Display P3) is excluded here with a stated reason and retained
privately. No colour conversion is ever attempted. EXIF, XMP and private path
information are removed by the existing sanitizer at publish time.

Missing plans, renders or photos are never publication blockers.

---

## The generated package

```
<output>/<slug>/
  progressive/payload.json     a ProgressiveBatch with a real batch_fingerprint
  source-manifest.json         public-safe provenance
  images/<slug>-cover.jpg
  images/<slug>-gallery-NN.jpg
  master-plan/<slug>-master-plan-NN.jpg
  floor-plans/…  unit-plan/…  maps/…
```

Media files are written into their conventional folder so that
`readSourcePackage` → `classifyPath` re-derives exactly the media type each file
was selected as, independently of what words the project's slug contains.

The manifest carries kind, authority, ref, SHA-256, effective date, revision,
publication date and repost links — and **no local path, no Drive id, no Telegram
invite token, no credential.**

**Never hand-edit a generated payload.** When a package fails validation, fix the
Factory (or its declarative layout configuration) and regenerate.

---

## Exception report

Exception-only. Successful extraction is never listed, and a run with no real
exceptions needs no Owner decision at all.

`blocker` — ambiguous project identity, an unreadable source package, an invalid
schema, an invalid production target, missing production credentials, a database
/ storage / deployment failure, secret or private-path exposure, or price rows
that cannot be safely mapped to units.

`attention` — rejected price rows, unresolved contradictions, a missing current
price, unsupported media, no identifiable units, an unexpected existing
production record.

`ambiguous_identity` is the only identity outcome that stops a run. The Factory
does not guess when identity is genuinely ambiguous.

---

## Privacy and credential boundaries

* Server/CLI only. No Factory module may enter the browser bundle.
* Credentials are read from the process environment, never from source, never
  printed, never placed in a result object.
* Private locators (absolute paths, Drive ids, archive paths) exist only inside
  the process and the operator's local report.
* Public projections carry basenames, content hashes and channel usernames only.
* Staging (`garjibjhlzeljsnpzisu`) is refused by ref, by name and by URL. The
  Factory never contacts it, not even read-only.

---

## The 15-minute operator workflow

1. **Identify the sources** — write (or copy) a source-set JSON: the project
   hint plus whichever official sources exist. *(~2–5 min for a new project,
   ~1 min for a familiar one.)*
2. **Generate** — `npm run package:factory -- --batch … --output … --report …`
   and let it run. *(Owner time: 0. Machine time: seconds to tens of minutes,
   depending on how much official media has to be downloaded.)*
3. **Read the exception report** — only exceptions, usually none. *(~1–3 min.)*
4. **Confirm identity if asked** — only when the report says
   `ambiguous_identity`. *(~1–2 min, and only sometimes.)*
5. **Approve publication** — re-run with `--publish-production`. *(~1 min.)*

Owner active time is measured separately from automated processing time. The
Owner does not sort files, identify documents, repair price rows, rewrite payload
JSON, choose images, classify plans, write manifests, or update production rows
by hand.
