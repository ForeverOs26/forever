# FOREVER-STUDIO-001 — Implementation Report

Status: Implemented in an open, unmerged draft PR; pending independent review and Owner approval. Not merged, not applied to production.
Base commit: `50a79ad8e3584dc6d5569d3979c162fbd81b537e` (authoritative main)
Branch: `claude/forever-studio-upload-dfev75`
Date: 2026-07-21

## What was built

Forever Studio: an authenticated, mobile-first web tool through which the
Owner and invited Trusted Publishers add real projects and resale listings by
uploading the materials they have — brochures, price lists, plans, ZIP
archives, photos, videos, structured JSON artifacts, and a few typed facts —
and Forever extracts what it safely can, creates or updates the record, and
publishes the public page immediately.

The durable product rule implemented and recorded here:

> An upload by Owner or Trusted Publisher is direct publication
> authorization. Incomplete business data never creates a follow-on approval
> or publication gate.

No JSON, SQL, PowerShell, terminal, migration knowledge, or second approval
step is required from the publisher.

## Architecture selected

**TanStack Start server functions + Supabase Auth + a server-managed
`studio_members` role table + the existing progressive ingestion lane.**

The app already ships an SSR server (nitro) with pre-wired but previously
unused auth middleware (`requireSupabaseAuth`, `attachSupabaseAuth`) and a
service-role server client (`supabaseAdmin`). Studio adds one narrow
orchestration layer behind those primitives and reuses the progressive
ingestion lane end to end: `buildProgressiveBatch` (dependency resolution,
provenance precedence, currency doctrine), `fetchExistingProjectState`,
`buildListingDraft`, and the single atomic `forever_progressive_ingest` RPC
(service-role-only, fingerprint-idempotent, cross-project-safe). No second
intake or project database architecture was created.

### Alternatives considered and rejected

1. **Browser-side writes with per-role RLS policies** — would spread write
   authorization across ~20 tables, put batch building and precedence logic
   in the browser, and risk cross-project corruption; rejected.
2. **Supabase Edge Functions** — a second runtime and deployment surface when
   the repo already has a server with the ingestion code in-tree; rejected.
3. **Reusing the strict RC5.5D import-execution boundary** — it is an
   approval-package/receipt system, exactly the gate the product rule
   forbids for ordinary uploads; left untouched.
4. **Extending the CLI/PowerShell draft importer UX** — publishers must not
   need a terminal; the importer's RPC is reused, its UX is not.

### Why this fits Forever

It is the smallest coherent layer that turns already-validated machinery
(progressive RPC, SIP, Fast Intake primitives, publication isolation RLS)
into the required phone-first experience, while keeping every trust
boundary already established: service-role only on the server, publication
isolation in RLS, provenance precedence on every field, warnings instead of
blockers, and the strict lane untouched.

## Components added

### Migration (prepared, NOT applied): `supabase/migrations/20260721120000_forever_studio_v1.sql`

- `public.studio_members` — Owner / Trusted Publisher identity. RLS enabled
  with **zero policies** (internal-only; service-role access via the app
  server exclusively). No default role, no public grants — structurally no
  self-registration.
- `public.studio_upload_jobs` — durable, retryable upload job records
  (workflow, facts, files, status, attempts, result, error). Same
  internal-only pattern. Together with the existing `audit_log`, answers
  "who created or changed this record".
- Storage: NEW private bucket `studio-uploads` (raw sources: price lists,
  archives, unclassified files — retained, never public). Existing public
  buckets `project-images` / `project-documents` are ensured with
  `ON CONFLICT DO NOTHING` for fresh local databases.
- No approval/readiness/review/confirmation objects. No change to
  `forever_progressive_ingest` grants or the strict lane. A DOWN reference
  is included as comments.
- The static suite `src/features/forever-studio/tests/migration-contract.test.ts`
  pins this contract verbatim.

### Server boundary: `src/features/forever-studio/`

- `studio-auth.ts` — `requireStudioMember` middleware:
  `requireSupabaseAuth` (JWT) → active `studio_members` row via the service
  role → actor with server-stored role. Includes the one-time Owner
  bootstrap: with an **empty roster**, a signed-in account whose email
  equals `STUDIO_OWNER_EMAIL` becomes Owner (audited); any other account —
  including self-registered auth users — is rejected.
- `studio.functions.ts` — 9 server functions (overview, start job, process
  job, project publish/unpublish, project facts save, listing
  publish/unpublish, listing update, member invite, member enable/disable),
  every one behind `requireStudioMember`; owner-only operations additionally
  assert the owner role server-side. Server modules are reached only via
  dynamic import inside handlers.
- `server/contracts.ts` — injectable capability interfaces (data, storage,
  ingest, auth-admin, SIP, archive expansion) so the whole pipeline is
  testable against in-memory fakes.
- `server/service.ts` — the orchestrator (details below).
- `server/extraction.ts` — deterministic material gathering reusing Fast
  Intake primitives (`classifyPath`, `sanitizePriceList`,
  `usableIntakeFact`); no OCR, no AI interpretation.
- `server/membership.ts` — actor resolution and owner-only guards.
- `server/deps.server.ts` — the only Studio module touching
  `supabaseAdmin`: data access, storage (signed upload URLs, downloads,
  public URLs), the progressive RPC call, auth-admin invite, a compact
  dependency reader, best-effort SIP invocation in a temp workspace, and
  bounded in-memory ZIP expansion using the intake zip safety layer.

### Upload pipeline

1. `studioStartJob` validates the declaration (≤60 files, ≤1 GiB each,
   safe slug), classifies each filename with the existing Fast Intake
   classifier, routes it to a bucket (photos/videos → `project-images`;
   brochures/plans → `project-documents`; price lists, archives, facts,
   legal, unknown → private `studio-uploads`), creates the job row, and
   issues short-lived signed upload tokens for server-generated, job-scoped
   paths (no client-chosen paths).
2. The browser uploads each file straight to storage with
   `uploadToSignedUrl` (no large files through the app server).
3. `studioProcessJob` gathers materials (missing/unreadable files become
   warnings and stay retained), consumes structured artifacts
   (`ExtractedPriceList` JSON — the SIP output shape — and
   `project-facts.json`), attempts SIP extraction for price-list PDFs when
   a local `pdftotext` exists (otherwise retains the file with a clear
   warning), expands ZIPs safely, builds one progressive batch (create when
   the slug is new, presence-aware enrich when it exists — update, never a
   duplicate), executes the atomic RPC, and applies publication.
4. Direct publication: enrich batches carry `publish: true`; creates are
   followed by a deterministic tiny publish patch (the RPC never
   auto-publishes a create — Studio supplies the publisher's authorization
   explicitly). No follow-on gate of any kind.
5. Result actions: Open page, Share, Edit, Upload update, Unpublish.

Provenance: manual Owner entries are `owner_verified`; Trusted Publisher
entries are `partner_provided`; extracted facts are `extracted`; derived
display values are `inferred` with warnings. The existing precedence rule
means a publisher can always fill blanks but can never silently overwrite an
Owner-verified value.

Resale listings publish through `buildListingDraft` without requiring any
project record: photos + whatever facts exist; no price → NULL (rendered
"Price on request"); invalid currency → NULL with a warning, never a
default; deterministic per-job slug so retries update the same listing.

### UI (mobile-first responsive web)

Routes (all `noindex`, none in public navigation or the sitemap):

- `/studio` — sign-in (sign-in only; no sign-up surface) → dashboard:
  role, workflow cards, projects/listings with status and actions, recent
  jobs, publisher management entry (Owner).
- `/studio/upload` — the 2–5-minute flow: workflow → facts → files (phone
  file picker, photo library, and camera via `capture="environment"`;
  desktop multi-select) → Publish now → progress → result actions.
- `/studio/project/$slug`, `/studio/resale/$id` — later-enrichment editors
  plus publish/unpublish.
- `/studio/members` — Owner-only invite / disable / enable.
- `/resale/$slug` — NEW public resale page rendered fail-closed through the
  anonymous client (RLS serves only `publication_status = 'published'`).

### Existing Forever capabilities reused

`forever_progressive_ingest` RPC + `ingestion_batches`/`ingestion_warnings`;
`buildProgressiveBatch`, provenance precedence, dependency resolution,
`fetchExistingProjectState`, `buildListingDraft`, `slugify`; Fast Intake
`classifyPath`, `sanitizePriceList`, `usableIntakeFact`, zip safety layer;
SIP `runSipPriceListExtraction` + `preflightPdftotext`; `supabaseAdmin`,
`requireSupabaseAuth`, `attachSupabaseAuth`; existing storage buckets and
public-read policies; `audit_log`; the public truth boundary and Partner
Demo invariants (Studio server functions refuse to run in Partner Demo
mode; Studio appears nowhere on the public surface).

## Validation completed (this environment)

- `src/features/forever-studio/tests/` — 49 new tests, all passing:
  - **authorization** (13): unauthenticated/non-member/disabled rejected;
    publisher allowed to publish but rejected from member management;
    owner bootstrap exactly-once semantics (wrong email, non-empty roster,
    unset variable all rejected); invite/disable guards (self, last owner);
    static proof that every server function is behind `requireStudioMember`
    and that no sign-up call exists in Studio.
  - **orchestrator** (16): Coralina-like proof from the committed fixture
    (`forever-data/projects/coralina/extracted/price-list.json` → 8
    buildings, 198 units, 198 prices, published in one upload);
    Rainpalm-like incomplete proof (committed SIP fixture → 21 units, 9
    prices, 12 missing prices as warnings, still published); direct
    publication with no follow-on gate; update-not-duplicate; price/
    availability update; construction media; unreadable + missing files
    retained and non-blocking; unextractable price-list PDF retained;
    failed-job retry idempotency (rollback proven, retry publishes once,
    re-entry is a read); cross-project isolation; unpublish/republish;
    owner-verified field protection on later edits; ZIP routing; bucket
    routing and server-generated path safety; Partner Demo hard-off.
  - **resale** (6): synthetic complete listing with 3 photos published in
    one pass; no-project/no-price/no-title publication with derived title;
    canonical project linking; invalid currency → NULL; edit/unpublish/
    republish; retry never duplicates.
  - **migration contract** (9): RLS-on/no-policies, service-role-only
    grants, no default role, workflow vocabulary lockstep with TypeScript,
    private bucket, no approval/readiness objects, strict lane and RPC
    untouched, draft marker, no credential material.
  - **bundle boundary** (5): no client-reachable module statically imports
    server code; service-role client touched only by `deps.server.ts`;
    Studio absent from Header/sitemap; demo-mode guard present.
- Full repository suite: 3110 passed / 1 skipped; the only failures are the
  two suites already failing at the base commit in this environment
  (`src/import/importer-preflight.test.ts`,
  `src/features/project-detail/partner-demo-data.test.ts`) because they
  import real Owner source files that are not committed to the repository
  (Modeva brochure/price-list binaries, Coralina dossier). Unrelated to
  Studio; unchanged by this PR.
- TypeScript: clean except the same pre-existing missing-Modeva-files error
  in `partner-demo-data.ts`.
- ESLint: all new/changed Studio files clean (the repository baseline
  carries ~1119 pre-existing formatting errors that this PR deliberately
  does not touch).
- Production build: succeeds; client asset scan shows **zero** occurrences
  of `SUPABASE_SERVICE_ROLE_KEY`, `service_role`, `studio_members`, or
  `forever_progressive_ingest` in `.output/public`.

## Success-target measurement

- Manual JSON / SQL / terminal / extra approval for the publisher: **zero by
  construction** (asserted by tests).
- Publisher interaction time: the flow is one form + one confirmation
  screen; the 2–5-minute and 15-minute targets need a real-device pilot to
  be measured honestly.
- Phone/tablet/desktop: implemented mobile-first with responsive layouts and
  camera capture; real-device verification remains for the pilot.

## Remaining work (not performed here — requires environments this task must not touch)

1. **Supabase migration application** (Owner-gated, in order):
   `20260718113000_progressive_ingestion_v1.sql` then
   `20260721120000_forever_studio_v1.sql`, after Codex re-verifies the
   flagged statements against the live schema inventory. Studio's runtime
   depends on both.
2. **Environment configuration**: server-side `SUPABASE_SERVICE_ROLE_KEY`
   and `STUDIO_OWNER_EMAIL`; create the Owner's auth account (or use an
   existing one) and sign in once to bootstrap; recommended: disable public
   sign-ups in the Supabase dashboard (defense in depth — Studio rejects
   non-members regardless).
3. **Type regeneration**: `src/integrations/supabase/types.ts` predates the
   progressive/Studio tables; regenerate after migrations apply and tighten
   the deliberately untyped data-access casts.
4. **Real-device pilot** (Owner): phone camera/file-picker behavior, the
   interaction-time targets, real PDF price lists through server-side SIP
   (requires `pdftotext` on the deployment host — otherwise files are
   retained with a clear warning), large-video upload behavior.
5. **Coralina / Rainpalm production publication** — explicitly NOT done and
   not authorized by this PR.
6. Background processing for very large jobs, richer public resale index
   page, and listing sitemap entries — deliberate v1 omissions.

## Risks and deliberate limitations

- SIP requires a local `pdftotext`; on hosts without it, price-list PDFs are
  retained with a warning instead of extracted (progressive enrichment, not
  failure).
- `studioProcessJob` runs synchronously within one request; very large
  dossiers may need a background job runner later. The job record already
  supports retry, so a timeout is recoverable.
- Republishing behavior: any authorized upload publishes (per the canonical
  rule) — an Owner who wants a project hidden must unpublish after, or ask
  publishers not to upload to it; the result screen makes Unpublish one tap.
- The invite flow hands a temporary password to the Owner to share
  out-of-band; email-based invitations can replace it once SMTP is
  configured.
- `deps.server.ts` talks to PostgREST untyped until types are regenerated.

## Confirmations

- No production connection occurred; no production credentials were used.
- No migration was applied; no production data was mutated.
- Coralina and Rainpalm were not published (in production or anywhere).
- No real lead was created or changed; no Telegram authentication occurred.
- Partner Demo and the public truth boundary are preserved (tested).
- Factory remains A0 — Propose only.
