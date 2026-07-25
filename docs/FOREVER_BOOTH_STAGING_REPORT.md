# Forever Booth 2.0 — Staging Report (PR #102)

Status of the **corrective pass 5.1** build against the checks the architect
required. Read this together with §0e and §0f of
`docs/FOREVER_BOOTH_ASSISTED_DECISION_001.md`.

- Branch: `claude/forever-booth-assisted-decision-001`, PR #102 — **Draft, not merged**.
- Approved head this pass started from: `23a610dab158e6ff6c61677a31702c14252fbe4b`
  (corrective pass 5), which in turn built on `6ecfed88e34ad16bb5fd8cf479a4405f738f0d7b`.
- Factory autonomy: **A0**. Production: **untouched** — no deploy, no migration
  application, no production database access, no production credential used.

## Migration lineage — the correction this pass exists for

An earlier version of this report stated that the pilot migration "remains
unapplied everywhere except disposable local PostgreSQL clusters". **That was
wrong**, and correcting it is the whole point of pass 5.1.

| Migration                                           | Dedicated staging (`garjibjhlzeljsnpzisu`)                        | Production (`abtvsrcnfwlbawvrjeed`) |
| --------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------- |
| `20260725150000_booth_v2_pilot.sql`                 | **APPLIED** during the earlier staging gate, at PR head `6ecfed8` | **NEVER APPLIED**                   |
| `20260726120000_booth_v2_server_issued_session.sql` | **NOT YET APPLIED** — see §3                                      | **NEVER APPLIED**                   |

Because `20260725150000` is applied history, pass 5's rewrite of that file in
place was migration drift. Pass 5.1 restored it byte-for-byte to its `6ecfed8`
bytes (git blob `f785adc3181080e6d38695bef1054735a3b37585`) and moved every
pass 5 database change into the later additive migration. No non-migration
pass 5 application code was reverted.

---

## 1. The headline, stated plainly

**The code correction is complete, the migration lineage is restored, and both
migration paths are proven against real PostgreSQL 17. The staging recheck in §6
of the brief was NOT executed**, because this environment has Supabase
_Management API_ access but neither a staging **database password** nor any
**Cloudflare** credential — so no staging Worker can be deployed and no browser
run against a hosted staging database can take place.

Nothing in this report is a claim about a deployed staging Worker or a hosted
staging database. That is a missing input, not a finding.

---

## 2. What WAS verified, and against what

| Check                                                                                        | Ran against                                                 | Result |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------ |
| Applied pilot migration is byte-identical to `6ecfed8` (git blob pinned in the suite)        | `git hash-object` + `booth-v2-migration-contract.test.ts`   | PASS   |
| **Upgrade path**: staging's existing schema → additive migration alone                       | **Real PostgreSQL 17**, two-stage harness, 29 assertions    | PASS   |
| Upgrade changes **no row**: session/lead/event counts and full session fingerprint identical | Real PostgreSQL, before/after `md5(string_agg(...))`        | PASS   |
| Old creating `booth_ensure_session(TEXT,UUID,TEXT,TEXT)` existed, then is GONE               | Real PostgreSQL, `to_regprocedure` before and after         | PASS   |
| Exactly ONE `booth_ensure_session` overload survives the upgrade                             | Real PostgreSQL, `pg_proc` count                            | PASS   |
| Pre-upgrade browser-chosen references stay fully operable (ensure + transition RPC)          | Real PostgreSQL, sessions written through the OLD API first | PASS   |
| Consented pre-upgrade session keeps its guest data and linked lead; terminal stays frozen    | Real PostgreSQL                                             | PASS   |
| Re-applying the additive migration is a no-op, not an error                                  | Real PostgreSQL                                             | PASS   |
| **Fresh path**: whole committed chain applied to an empty cluster                            | **Real PostgreSQL 17**, `npm run studio:pg-test`            | PASS   |
| Server-issued create: no client reference in, random UUID out, one row, no guest data        | Real PostgreSQL, full committed migration chain             | PASS   |
| Two **concurrent** creates → two different references, two distinct rows                     | **Two real overlapping psql connections**                   | PASS   |
| Same Host replays operations on its own created session (no duplicate events)                | Real PostgreSQL                                             | PASS   |
| Host B cannot adopt Host A's reference; ownership never transferred                          | Real PostgreSQL                                             | PASS   |
| Unknown vs foreign reference — identical serialized refusal (constructor/name/code/message)  | Service boundary, both database exceptions                  | PASS   |
| Neither refusal creates a session (whole-table counts, 5 operations)                         | Real PostgreSQL                                             | PASS   |
| service_role-only EXECUTE survives, under hostile `DEFAULT PRIVILEGES`                       | Real PostgreSQL, both harnesses                             | PASS   |
| A Host claiming `guide_self_confirmed` is hard-refused and writes nothing                    | Real PostgreSQL                                             | PASS   |
| Terminal freeze and terminal-session ensure behaviour unchanged                              | Real PostgreSQL                                             | PASS   |
| Consent atomicity, cross-Host contention, mid-transaction rollback                           | Two real psql connections                                   | PASS   |
| Auth transport (real ES256 JWTs, real HTTP hop, real middleware)                             | Disposable local auth service                               | PASS   |
| Auth lifecycle (re-entrancy, generation counter, unmount cancellation)                       | Vitest, faked timers, real supabase-js event shape          | PASS   |
| Route SSR boundary                                                                           | Real `renderToString` in a real server environment          | PASS   |
| Legacy Booth, website Navigator, lead-service regression                                     | Vitest                                                      | PASS   |
| TypeScript, ESLint (Booth source), Prettier, production build, `git diff --check`            | Repository toolchain                                        | PASS   |
| Secret / public-bundle scan                                                                  | Built `.output/public`                                      | PASS   |

**Secret-scan detail.** Two greps match in the built public bundle, and neither
is a leak:

- `sb_secret_` — the Supabase client's own key-_prefix_ check,
  `startsWith("sb_secret_")`. A guard against a secret key, not a secret key.
- `studio_members` — matches only as a **substring** of the Studio error codes
  `studio_membership_required` and `studio_membership_disabled`. The table name
  itself does not appear; a word-exact grep returns those two codes and nothing
  else. Pre-existing, Studio-side, unrelated to Booth.

Absent entirely: any service-role key, `BOOTH_V2_ENABLED`,
`BOOTH_WHATSAPP_NUMBER`, `BOOTH_FX_RATES_JSON`, `BOOTH_ID`, `supabaseAdmin`,
`can_access_booth`, `booth_guides`, `host_email`, every `booth_*` RPC name
(`booth_create_session` and `booth_ensure_session` included), and both Supabase
project refs.

**One pre-existing failure, unrelated to Booth.** `src/import/importer-preflight.test.ts`
fails 3 tests (it expects a Coralina source archive that is not present in this
worktree). Confirmed pre-existing by re-running the same file at the pre-pass-5
base — it fails identically there. Not caused by, and not touched by, this pass.

---

## 3. What was NOT executed, and exactly why

Section 6 of the brief requires an **isolated staging Cloudflare Worker running
the exact new PR head**, the additive migration applied to the **hosted staging
database**, and then a **real browser run** against both. The access needed
splits three ways, and only the first exists here:

| Requirement                            | State in this environment                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase **Management API**            | **AVAILABLE.** The CLI (`node_modules/.bin/supabase`, v2.109.1) is authenticated. `supabase projects list` confirms `garjibjhlzeljsnpzisu` / `forever-staging` (ap-southeast-2) is `ACTIVE_HEALTHY` and **not linked**, and that the **linked** project is the production ref — as the brief warned.                                                                                                                  |
| Supabase staging **database password** | **ABSENT.** `supabase migration list` accepts only `--db-url`, `--linked`, `--local` or `--password`; there is no `--project-ref` form. `--linked` is forbidden here (it resolves to production). No `SUPABASE_DB_PASSWORD`, `PGPASSWORD`, `DATABASE_URL` or service-role key exists on this machine. Only the staging **CA certificate** from the earlier gate remains (`~/.supabase/certs/forever-staging-ca.crt`). |
| **Cloudflare** credentials             | **ABSENT.** `wrangler` is neither on PATH nor a project dependency; `~/.wrangler` does not exist; no `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`. No Worker can be deployed.                                                                                                                                                                                                                                     |

Consequently **none** of the 18 numbered browser checks in §6 was run, and none
is claimed: the Host sign-in, the permission-grant create, the two-create
distinctness through a browser, the retryable failed create, the external
refusal equivalence over the wire, session continuation and foreign refusal, the
Quick and Full flows, the no-contact route, automatic tablet clearing, terminal
immutability, Guide attribution, the `guide_self_confirmed` refusal, the
disabled-route 404, and the hosted public-bundle scan. **No synthetic sessions,
leads, guides or test users were created, so there is nothing to clean up and no
baseline to restore.** No WhatsApp message, real or synthetic, was sent.

**The additive migration was deliberately NOT applied to staging**, for two
independent reasons:

1. **It cannot be** — applying it needs the staging database password, which is
   not present, and the only credential that would reach a database here is the
   **linked production** one, which the brief forbids and which was not used.
2. **It should not be, alone.** Staging currently holds the `6ecfed8` Booth
   schema. Applying the additive migration drops
   `booth_ensure_session(TEXT,UUID,TEXT,TEXT)`. If a staging Worker built from
   `6ecfed8` is still deployed, it calls exactly that signature — so applying the
   migration without simultaneously deploying the pass 5 code would leave staging
   with new functions under old code. That is the same class of drift this pass
   exists to remove. **The migration and the Worker deploy must land together.**

---

## 4. To run the staging recheck (Owner action)

Supply, for a **staging** environment that is not production:

1. `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` (or an interactive
   `wrangler login`), and install `wrangler`.
2. The **staging** database password for `garjibjhlzeljsnpzisu`, so the additive
   migration can be applied with every operation hard-pinned to that project —
   never through the local link, which resolves to production:

   ```bash
   supabase db push --db-url "postgresql://postgres:<STAGING_DB_PASSWORD>@db.garjibjhlzeljsnpzisu.supabase.co:5432/postgres"
   ```

   First confirm `20260725150000` is already recorded and `20260726120000` is
   not:

   ```bash
   supabase migration list --db-url "postgresql://postgres:<STAGING_DB_PASSWORD>@db.garjibjhlzeljsnpzisu.supabase.co:5432/postgres"
   ```

   `db push` must report **exactly one** migration to apply. If it offers
   `20260725150000` as well, staging is not in the state this report describes —
   stop and reconcile before applying anything.

3. `SUPABASE_SERVICE_ROLE_KEY` for the staging project (Worker-side only; it must
   never reach the browser bundle).
4. Staging Worker vars: `BOOTH_V2_ENABLED=true`, `BOOTH_ID`, and — only if the
   WhatsApp leg is to be exercised — a synthetic `BOOTH_WHATSAPP_NUMBER`. No real
   WhatsApp delivery is required, and none should be claimed.
5. One staging staff account with an ACTIVE `public.studio_members` row **and**
   `can_access_booth = TRUE` (neither migration grants it to anybody).

**Order matters:** apply the additive migration and deploy the Worker built from
this PR head as one operation, because the old four-argument
`booth_ensure_session` disappears with the migration.

Then run the 18 checks in §6 of the brief, take baseline counts before any
synthetic work, delete every synthetic session, lead, guide and user afterwards,
and restore the exact baseline counts with evidence.

---

## 5. Verdict

**PR #102 corrective pass 5.1 — migration lineage RESTORED and both migration
paths (fresh application and in-place upgrade of the applied staging schema)
PROVEN against real PostgreSQL 17. Code correction COMPLETE and verified against
real PostgreSQL, real SSR and a real HTTP auth hop. Final staging recheck NOT RUN
— blocked by a missing staging database password and missing Cloudflare
credentials. The additive migration was NOT applied to staging. PR #102 remains
Draft. Production untouched. Real WhatsApp delivery remains operational and was
neither invoked nor claimed.**
