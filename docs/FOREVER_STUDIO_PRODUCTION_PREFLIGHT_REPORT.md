# FOREVER-STUDIO-001 — Production Preflight Report

Status: **BLOCKED — read-only preflight complete; no production writes**

Date: 2026-07-23

Repository: `ForeverOs26/forever`

Reviewed main: `7963ceeb3e49f932153dd92afde0e5cb446b57f5`

Merged implementation: PR #95

Preflight branch: `codex/forever-studio-production-preflight`

## Executive verdict

The production database itself is ready for an Owner migration decision: its identity and TLS chain are verified, the pre-Studio foundation is healthy, no partial Studio state exists, and the official dry run proposes exactly the seven committed Studio migrations in order. Deterministic before/after inventories are identical.

End-to-end production readiness is **BLOCKED**. The deployed Lovable project/revision and required production secret-name presence could not be verified; the known public Lovable URL returns Cloudflare 404 for the root and representative routes; production Auth contains no Owner user; and public email signup is enabled. No migration, schema/data/Auth/Storage mutation, deployment, publication, or other production write was performed.

The exact next Owner decision is whether to authorize **configuration-and-identity readiness only**: verify the Lovable production project and deployed revision, verify the four required secret names without exposing values, create and confirm one Owner Auth identity, and disable public signup. This does not authorize Gate A migration application or any later gate.

## Authority and safety boundary

- Only Supabase project `abtvsrcnfwlbawvrjeed` was authorized and selected.
- The forbidden staging project `garjibjhlzeljsnpzisu` was not selected, linked, queried, or changed.
- All production SQL evidence ran inside explicit `BEGIN TRANSACTION READ ONLY` / `ROLLBACK` blocks.
- TLS used `sslmode=verify-full` with the official production CA.
- The official migration list and dry run used a fresh isolated workdir linked explicitly to the production ref; repository linkage was not reused.
- Secrets, access tokens, publishable-key values, service-role-key values, database URLs, signed URLs, and personal email addresses are excluded from this report.
- No production migration apply, DDL, DML, Auth mutation, Storage mutation, deployment, or publication was attempted.

## Repository gate

| Check                                    | Result                                      |
| ---------------------------------------- | ------------------------------------------- |
| `origin/main`                            | `7963ceeb3e49f932153dd92afde0e5cb446b57f5`  |
| PR #95                                   | Merged into that main commit                |
| Preflight base                           | Exact `origin/main`                         |
| Preflight branch                         | `codex/forever-studio-production-preflight` |
| History policy                           | No rebase, amend, squash, or force push     |
| Product/migration changes in this branch | None; documentation only                    |

## Sanitized production identity and TLS

| Field                  | Observed value                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| Project ref            | `abtvsrcnfwlbawvrjeed`                                                                            |
| Project name           | `ForeverOs26's Project`                                                                           |
| Region                 | `ap-northeast-1`                                                                                  |
| Health                 | `ACTIVE_HEALTHY`                                                                                  |
| API origin             | `https://abtvsrcnfwlbawvrjeed.supabase.co`                                                        |
| Database               | `postgres`                                                                                        |
| Server version         | PostgreSQL 17.6                                                                                   |
| Pooler host            | `aws-0-ap-northeast-1.pooler.supabase.com`                                                        |
| TLS                    | active, TLS 1.3, `TLS_AES_256_GCM_SHA384`                                                         |
| CA subject/issuer      | Supabase Root 2021 CA                                                                             |
| CA certificate SHA-256 | `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA` |
| CA validity            | 2021-04-28 through 2031-04-26                                                                     |
| SQL transaction state  | `transaction_read_only=on` during every evidence query                                            |

The exact project ref, API origin, isolated link ref, and pooler host all agree. No alternate or branch database identity was observed.

## Official production migration history

The official linked history contains these 13 applied versions, exactly once and in order:

1. `20260704055333`
2. `20260704060123`
3. `20260704060838`
4. `20260704114738`
5. `20260704132000_create_leads`
6. `20260707100000_fdb001_core_extensions_sources_audit`
7. `20260707101000_fdb001_inventory_facilities`
8. `20260707102000_fdb001_assets_intelligence`
9. `20260707103000_fdb001_seed_title_bang_tao_modeva`
10. `20260707104000_fdb002b_unit_price_history`
11. `20260707105000_fdb002c_import_modeva_units`
12. `20260715120000_rc55d_import_execution_boundary`
13. `20260718113000_progressive_ingestion_v1`

There are no duplicate, missing, unexpected, or out-of-order versions. Progressive ingestion is applied. No Studio version is recorded.

### Official isolated dry run

`supabase db push --linked --workdir <isolated-workdir> --dry-run --yes` succeeded and proposed exactly:

1. `20260721120000_forever_studio_v1.sql` — Studio core tables, private contact relocation, Storage bucket, functions, RLS, and grants.
2. `20260721123000_studio_internal_acl_hardening.sql` — internal ACL hardening.
3. `20260722103000_studio_object_authorization.sql` — project/listing object authorization.
4. `20260722110000_studio_object_ownership_backfill.sql` — deterministic ownership backfill.
5. `20260722120000_studio_independent_review_corrections.sql` — reviewed safety corrections and atomic resale behavior.
6. `20260722130000_studio_resume_principal_authorization.sql` — resume principal authorization.
7. `20260722140000_studio_durable_resume_eligibility.sql` — durable resume count/list eligibility boundaries.

This is the clean, expected path. There is no history-missing equivalent Studio state that would require migration repair.

## Foundation catalogue and security posture

The required foundation tables exist with RLS enabled: `projects`, `listings`, `project_media`, `ingestion_batches`, and `ingestion_warnings`. Their owners, columns, defaults, constraints, foreign keys, indexes, triggers, policies, and effective grants were inventoried read-only.

The progressive ingestion boundary `forever_progressive_ingest(jsonb)` exists, returns `jsonb`, is owned by `postgres`, is `SECURITY INVOKER`, has an empty locked search path, and is executable only by `postgres` and `service_role`. Its normalized definition fingerprint is `e036f13d88c5cfd4de7bd604cd6a8c60`.

Public reads remain constrained by RLS:

- projects require active + published;
- listings require published;
- project media requires an active + published parent project;
- ingestion batch/warning tables expose no anonymous/authenticated policy.

### Studio absence / partial-state check

Production contains no Studio relations, routines, indexes, triggers, policies, `studio-uploads` bucket, Storage objects, or Studio migration-history rows. This is a clean pre-Studio state, not a partial or mixed rollout.

### Listing-contact relocation

The legacy `listings.contact_name`, `contact_phone`, and `contact_email` columns exist, but all three contain zero non-null values. No production view, routine, trigger, policy, or other catalogue dependency references them. The Studio migration moves any legacy values to the private `studio_listing_contacts` table before dropping the public columns.

Tracked post-migration Studio code uses the private contact boundary. Remaining tracked legacy-column references are pre-migration ingestion/public-detail compatibility types and focused migration tests; bundle-boundary tests explicitly prohibit private contact identifiers in client code. With zero live contact values and zero catalogue dependants, the relocation has no current data-loss conflict. Gate A must still stop if a fresh pre-apply count is no longer zero or new dependants appear.

## Deterministic before/after inventory

| Surface                  | Before | After | Fingerprint                        |
| ------------------------ | -----: | ----: | ---------------------------------- |
| Projects                 |      8 |     8 | `b76e77d35415e9e6d5d672011116e1b2` |
| Listings                 |      0 |     0 | `d41d8cd98f00b204e9800998ecf8427e` |
| Developers               |      7 |     7 | `853dae41ba531f92800003e1e56eadd3` |
| Project media            |      6 |     6 | `a4ff3d37dbc2bf31efb7d51bcfd75a03` |
| Ingestion batches        |      1 |     1 | `41591ee2a660415509de38167d7a9ae6` |
| Ingestion warnings       |      6 |     6 | `aad78ee2becdf7a76a4d2720d463745a` |
| Auth users               |      0 |     0 | `d41d8cd98f00b204e9800998ecf8427e` |
| Storage buckets          |      0 |     0 | `d41d8cd98f00b204e9800998ecf8427e` |
| Storage objects          |      0 |     0 | `d41d8cd98f00b204e9800998ecf8427e` |
| Applied migrations       |     13 |    13 | `d100704f94886957f7277e092e5688bd` |
| Studio catalogue objects |      0 |     0 | absent                             |

The before/after snapshots are identical. The preflight performed zero production writes.

## Current production data facts

- Modeva: exactly one `modeva` project, active and published; no `the-modeva-bang-tao` legacy duplicate.
- Coralina: exactly one `coralina` project, active but draft; it remains unpublished.
- Rainpalm: zero projects and zero listings; it remains unimported and unpublished.
- Listings: zero.
- Project media: six rows; no URL or main-image duplicate group across projects.
- Ingestion: one batch and six open warnings.

### Known fictitious seeded data

Six known seeded projects remain active and published in the database, each with one media row and the known optimistic claim flags:

- `bangtao-garden-pool-villas`
- `kamala-beach-residences`
- `kata-cliff-residences`
- `layan-forest-villas`
- `rawai-courtyard-villas`
- `surin-ridge-villas`

The six associated seeded developer rows also remain. Of 22 discovered project-reference relationships, only `project_media` contains rows for these six projects; all other discovered dependent counts are zero.

### Truth-cleanup dependency conclusion

**Conclusion: Studio rollout is conditionally independent of the pending truth-data cleanup.** The Studio migrations do not publish these projects or change their `public_status`. PR #94's repository boundary quarantines the six known seeded slugs and suppresses unsupported public claims. Therefore Gate A does not need to wait for destructive cleanup if, and only if:

1. the Gate D release commit contains PR #94 as an ancestor and its fail-closed boundary is verified in the deployed app;
2. no Studio smoke or real publication selects Coralina, Rainpalm, or any quarantined seeded slug;
3. nobody edits, republishes, or creates ownership for quarantined rows through Studio; and
4. the Owner accepts the remaining database rows as a separate, explicitly gated cleanup obligation.

If any condition cannot be proven, Studio rollout stops until truth cleanup is resolved. This preflight does not authorize that cleanup.

## Deployment and Auth readiness

### Hosting/deployment

Tracked Lovable metadata identifies the TanStack Start template and its template revision, not a deployed application commit. The repository defaults to a Cloudflare/Nitro target. A local untracked build artifact names worker `foreveros26-forever`, but local output is not deployment evidence and was excluded from the branch.

The deployed Lovable project, current production release SHA, and production environment-secret presence could not be verified. The signed-in Lovable UI timed out during inspection. `https://forever-home-core.lovable.app`, `/studio`, representative public routes, and `/sitemap.xml` all returned the same Cloudflare 404 response. It is therefore unverified whether production serves reviewed main at all.

### Required production environment names

Presence is currently unknown for all four requirements:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — server only; never `VITE_`-prefixed or client-bundled
- exactly one of `STUDIO_OWNER_USER_ID` (preferred) or `STUDIO_OWNER_EMAIL` — server only

No value may be copied into a report, command line, client environment, screenshot, or tracked file. Validation is name/presence, server scope, exact project identity, and client-bundle absence only.

### Auth

Production exposes the expected key types, but values were neither recorded nor reported. Production has zero `auth.users`. Email Auth is enabled, public signup is enabled, and email confirmation is required. No confirmed Owner identity exists, so first-login bootstrap cannot be safely attempted. Public signup must be disabled before deployment even though Studio rejects non-members.

## Blocking findings

1. The Lovable production project and exact deployed release commit are unverified.
2. The known public production URL and representative routes return Cloudflare 404.
3. Required production environment name presence and server-only scope are unverified.
4. Production Auth has zero users; no confirmed Owner identity exists.
5. Public email signup is enabled.
6. Six known fictitious seeded projects remain active + published in the database. Repository quarantine makes this a conditional rather than automatic Studio blocker, but the separate cleanup obligation remains open.
7. No Owner has authorized any Gate A–F action.

The database migration/catalogue gate itself has no blocking drift.

## Owner-gated rollout plan

Every gate requires its own explicit Owner confirmation. Completion of one gate does not authorize the next. At each gate, record the production project ref, approved release SHA where relevant, operator, time, sanitized result, and before/after fingerprints.

### Gate A — Apply the seven Studio migrations

**Prerequisites:** resolve hosting/config/Auth evidence enough to identify the intended production deployment; rerun identity, official migration list, dry run, contact-value/dependant checks, and before snapshot. The dry run must still propose exactly the seven files listed above.

**Owner confirmation:** approve those exact seven migrations against only `abtvsrcnfwlbawvrjeed`.

**Operation:** in a fresh isolated workdir containing the committed migrations, link explicitly and apply with the official CLI:

```powershell
supabase link --project-ref abtvsrcnfwlbawvrjeed --workdir <isolated-workdir> --yes
supabase migration list --linked --workdir <isolated-workdir>
supabase db push --linked --workdir <isolated-workdir> --dry-run --yes
supabase db push --linked --workdir <isolated-workdir> --yes
```

Use the official production CA and `verify-full` for independent SQL validation. Never use repository default linkage.

**Expected effect:** seven history rows; Studio tables/functions/policies/indexes/triggers; private Storage bucket; contact relocation; deterministic ownership backfill. Existing public projects are not intentionally published or unpublished. With the current snapshot, ownership assignment affects no pre-existing Studio jobs and contact relocation moves zero values.

**Validate:** exact migration list, exact Studio catalogue, RLS/ACL/function security, bucket privacy, contact row/count reconciliation, ownership reconciliation, and unchanged non-Studio fingerprints.

**Stop conditions:** identity mismatch; unexpected dry-run file; missing/duplicate/out-of-order history; any pre-existing Studio object; nonzero/new contact state not explained; unknown dependant; catalogue/hash drift; any unexpected row/publication change.

**Recovery:** migration application is not safely reversible as a routine rollback because it drops public contact columns after relocation and creates durable ownership/audit boundaries. Prefer stop-and-forward-repair from a preserved snapshot. A reverse migration requires a separately reviewed plan that first restores contact columns/data and proves no Studio writes would be lost. Required confirmation: Owner + independent reviewer.

### Gate B — Configure production server environment

**Owner confirmation:** authorize secret configuration only, not deployment.

**UI operation:** in the exact Lovable production project, open project/deployment settings, select the production environment, and create the four required names above. Configure exactly one Owner selector, preferring user ID. Do not place service-role or Owner-selector values in client/public variables.

**Expected effect:** deployment configuration changes only; no database or public-site change until deployment.

**Validate:** name/presence and server-only scope without displaying values; `SUPABASE_URL` ref equals production; configuration contains exactly one Owner selector; deployment/build client bundle contains none of the server-only names or exact secret values.

**Stop conditions:** wrong project/environment, ambiguous Owner selectors, `VITE_` exposure, client-bundle match, screenshot/log leakage, or unverifiable deployment inheritance.

**Recovery:** unset or rotate the affected secret and rebuild before any deployment. Rotation is reversible operationally but may invalidate active sessions/jobs; record it. Required confirmation: Owner or authorized deployment administrator.

### Gate C — Provision the Owner Auth identity

**Owner confirmation:** authorize one production Auth identity and disabling public signup.

**UI operation:** in Supabase project `abtvsrcnfwlbawvrjeed`, open Authentication → Users, create/invite exactly one Owner identity, complete email confirmation, then open Auth signup/provider settings and disable public email signup. Set Gate B's preferred `STUDIO_OWNER_USER_ID` to the exact confirmed user ID.

**Expected effect:** one confirmed Auth row and closed public signup; no Studio membership until the first authorized login.

**Validate:** one intended confirmed user, no duplicate, exact configured user ID, signup disabled, and zero Studio members before first login.

**Stop conditions:** unconfirmed/duplicate/wrong identity, public signup still enabled, any unexpected member, or selector mismatch.

**Recovery:** disable the account and remove/rotate the selector before deployment. Deleting an identity after Studio activity may conflict with durable attribution and requires a separate data-retention review. Required confirmation: Owner.

### Gate D — Deploy one exact reviewed release

**Owner confirmation:** approve one recorded main release SHA that contains PR #94, PR #95, and the accepted preflight documentation as ancestors.

**UI operation:** in the verified Lovable production project, select/publish that exact revision to production. Record the release/deployment identifier before clicking Publish/Deploy.

**Expected effect:** public application changes to the reviewed Studio-capable build; no content publication by deployment itself.

**Validate:** root and representative public routes return the application; `/studio` presents Auth; response/build metadata maps to the approved SHA; Modeva remains public; Coralina/Rainpalm remain absent; quarantined seeded routes remain fail-closed; no client bundle exposes server-only identifiers or values; logs show only the production project ref.

**Stop conditions:** SHA mismatch, 404/5xx, wrong Supabase ref, leaked secret, quarantine regression, route regression, automatic content mutation, or inability to identify the deployed build.

**Recovery:** use Lovable's verified previous production release if rollback is supported and its safety boundary is known; otherwise deploy a reviewed forward fix. Never roll back to a release predating PR #94. Required confirmation: Owner.

### Gate E — Controlled synthetic production Studio smoke

**Owner confirmation:** separately authorize a brief synthetic publication and immediate unpublication. The product's new-development path publishes directly; there is no truly internal-only end-to-end UI path.

**Operation:** sign in as the configured Owner, confirm the one-time Owner bootstrap, then create a uniquely named, clearly noncommercial project such as `FOREVER Internal Studio Smoke <UTC timestamp>` with no personal/client data and at most one tiny generated nonconfidential image. Open its page, verify the job/audit/media path, then immediately use Studio **Unpublish**.

**Expected effect:** one Owner membership, one synthetic job, one synthetic project, optional one Storage object/media row, audit/ownership rows, then project status draft after unpublish. A brief public appearance is unavoidable and is why this is a separate gate.

**Validate:** Owner-only access, successful upload/resume behavior, exact object ownership, private raw Storage, safe derived public media only, audit attribution, no duplicate on retry, public route available only before unpublish and unavailable afterward, all unrelated fingerprints unchanged.

**Stop conditions:** any wrong-project access, private-path leakage, duplicate, retry non-idempotence, missing audit/ownership, unrelated mutation, inability to unpublish, or Coralina/Rainpalm/quarantined slug involvement.

**Recovery:** unpublish first; disable Studio deployment or Owner account if access boundaries fail; preserve audit evidence. Deleting the synthetic rows/objects is a separate destructive cleanup requiring its own reviewed plan and Owner approval. Required confirmation: Owner.

### Gate F — First real publication

**Owner confirmation:** name the exact real project and approve its immediate publication after reviewing facts, media rights, price currency/date, contact handling, and public route. Coralina and Rainpalm remain excluded unless the Owner explicitly selects one through its separate readiness process.

**Operation:** Owner uses `/studio` for the authorized workflow and source package, reviews the submitted facts/files, and selects **Publish now** once.

**Expected effect:** only the named project/listing, its job, permitted media, ownership, provenance, warnings, and audit rows change.

**Validate:** source-to-public reconciliation, publication status, route/sitemap behavior, media rights/path, contact privacy, job/audit ownership, warning visibility, idempotent retry, and unchanged unrelated inventory.

**Stop conditions:** scope ambiguity, missing source rights, wrong slug/project, unexplained value, secret/private path, duplicate, unrelated drift, or any request to include quarantined data without a separate cleanup decision.

**Recovery:** unpublish immediately, retain audit/source evidence, and use a separately approved forward correction. Data deletion is not implied. Required confirmation: Owner.

## Recommended decision

Do **not** authorize migration or deployment yet. Authorize only a bounded readiness checkpoint that resolves the Lovable project/revision, verifies required production secret-name presence and server-only scope, creates one confirmed Owner identity, and disables public signup. Then repeat the read-only preflight and present a fresh Gate A decision packet.

## Final preflight status

**BLOCKED — PRODUCTION PREFLIGHT FOUND UNSAFE OR INCOMPLETE STATE — NO PRODUCTION WRITES**
