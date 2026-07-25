# Forever Booth 2.0 — Staging Report (PR #102)

Status of the **corrective pass 5** build against the checks the architect
required. Read this together with §0e of
`docs/FOREVER_BOOTH_ASSISTED_DECISION_001.md`.

- Branch: `claude/forever-booth-assisted-decision-001`, PR #102 — **Draft, not merged**.
- Approved head this pass started from: `6ecfed88e34ad16bb5fd8cf479a4405f738f0d7b`.
- Factory autonomy: **A0**. Production: **untouched** — no deploy, no migration
  application, no production database access, no production credential used.
- The pilot migration remains **unapplied everywhere** except disposable local
  PostgreSQL clusters.

---

## 1. The headline, stated plainly

**The code correction is complete and verified. The staging recheck in §6 of the
brief was NOT executed, because this environment has no staging credentials of
any kind.** Nothing in this report is a claim about a deployed staging Worker or
a hosted staging database, and no browser run against one took place.

That is a missing input, not a finding: everything that could be verified without
a hosted environment was verified, against real software rather than mocks.

---

## 2. What WAS verified, and against what

| Check                                                                                       | Ran against                                                                | Result |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------ |
| Booth V2 + core V2 suites (300 tests)                                                       | Vitest                                                                     | PASS   |
| Server-issued create: no client reference in, random UUID out, one row, no guest data       | **Real PostgreSQL 17**, disposable cluster, full committed migration chain | PASS   |
| Two **concurrent** creates → two different references, two distinct rows                    | **Two real overlapping psql connections**                                  | PASS   |
| Same Host replays operations on its own created session (no duplicate events)               | Real PostgreSQL                                                            | PASS   |
| Host B cannot adopt Host A's reference; ownership never transferred                         | Real PostgreSQL                                                            | PASS   |
| Unknown vs foreign reference — identical serialized refusal (constructor/name/code/message) | Service boundary, both database exceptions                                 | PASS   |
| Neither refusal creates a session (whole-table counts, 5 operations)                        | Real PostgreSQL                                                            | PASS   |
| A Host claiming `guide_self_confirmed` is hard-refused and writes nothing                   | Real PostgreSQL                                                            | PASS   |
| Terminal freeze and terminal-session ensure behaviour unchanged                             | Real PostgreSQL                                                            | PASS   |
| Consent atomicity, cross-Host contention, mid-transaction rollback                          | Two real psql connections                                                  | PASS   |
| Auth transport (real ES256 JWTs, real HTTP hop, real middleware)                            | Disposable local auth service                                              | PASS   |
| Auth lifecycle (re-entrancy, generation counter, unmount cancellation)                      | Vitest, faked timers, real supabase-js event shape                         | PASS   |
| Route SSR boundary                                                                          | Real `renderToString` in a real server environment                         | PASS   |
| Legacy Booth, website Navigator, lead-service regression                                    | Vitest                                                                     | PASS   |
| TypeScript, ESLint (Booth source), Prettier, production build, `git diff --check`           | Repository toolchain                                                       | PASS   |
| Secret / public-bundle scan                                                                 | Built `.output/public`                                                     | PASS   |

**Secret-scan detail.** The only match in the built public bundle is the string
literal `sb_secret_` inside the Supabase client's own key-_prefix_ check
(`startsWith("sb_secret_")`). No service-role key, no `BOOTH_V2_ENABLED`, no
`BOOTH_WHATSAPP_NUMBER`, no `BOOTH_FX_RATES_JSON`, no `studio_members` and no
`supabaseAdmin` reaches the browser bundle.

**One pre-existing failure, unrelated to Booth.** `src/import/importer-preflight.test.ts`
fails 3 tests (it expects a Coralina source archive that is not present in this
worktree). Confirmed pre-existing by stashing this pass's changes and re-running
at `6ecfed88` — it fails identically there. Not caused by, and not touched by,
this pass.

---

## 3. What was NOT executed, and exactly why

Section 6 of the brief requires an **isolated staging Cloudflare Worker** and a
**staging Supabase database**, then a real browser run against them. None of the
three ways to obtain that exists here:

| Requirement                    | State in this environment                                                                                                                                                                                                                                                                 |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare credentials         | `~/.wrangler/config/` is empty (no OAuth token); no `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` in the environment; `wrangler` is not installed. No Worker can be deployed.                                                                                                          |
| Staging Supabase project       | No Supabase access token (the CLI is unauthenticated), and no `SUPABASE_SERVICE_ROLE_KEY` anywhere. The only `.env` on this machine holds the **production** project's URL and anon key, and `supabase/config.toml` points at the **production** project ref — which must stay untouched. |
| Local Supabase container stack | The Docker daemon is not running (`dockerDesktopLinuxEngine` pipe absent), so `supabase start` cannot substitute. This is the same limitation recorded in §0c of the architecture record.                                                                                                 |

Consequently these were not run and are **not claimed**: server-issued create
through a real browser; the Quick contacted flow end-to-end in a browser;
automatic tablet clearing after completion observed in a browser; exact retry
against a hosted database; the no-contact and funnel regressions in a browser;
and the auth lifecycle against a hosted Supabase. There were also **no synthetic
staging rows or users to clean up**, because none were created.

The closest available substitutes were used instead and are reported as such:
the disposable PostgreSQL cluster for every database behaviour, the disposable
local auth service for the credential transport, and real SSR rendering for the
route boundary.

---

## 4. To run the staging recheck (Owner action)

Supply, for a **staging** environment that is not production:

1. `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` (or an interactive
   `wrangler login`), and install `wrangler`.
2. A separate staging Supabase project: `SUPABASE_URL`,
   `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and a Supabase
   access token to apply `supabase/migrations/20260725150000_booth_v2_pilot.sql`
   to it. Do **not** point this at the production project ref.
3. Staging Worker vars: `BOOTH_V2_ENABLED=true`, `BOOTH_ID`, and — only if the
   WhatsApp leg is to be exercised — a synthetic `BOOTH_WHATSAPP_NUMBER`. No real
   WhatsApp delivery is required, and none should be claimed.
4. One staging staff account with an ACTIVE `public.studio_members` row **and**
   `can_access_booth = TRUE` (the migration grants it to nobody).

Then run, in order: server-issued create through the real browser; unknown vs
foreign wire comparison; cross-Host adoption refusal; the Quick contacted flow
without pausing for manual database inspection; valid contacted completion
end-to-end; automatic tablet clearing after completion; exact retry with zero
duplicate lead/event/session; the no-contact flow; the funnel regression; the
auth lifecycle regression; terminal freeze; and the privacy and bundle scans.
Delete every synthetic row and user afterwards.

---

## 5. Verdict

**PR #102 corrective pass 5 — code correction COMPLETE and verified against real
PostgreSQL, real SSR and a real HTTP auth hop. Staging recheck NOT RUN (no
staging credentials in this environment). PR #102 remains Draft. Production
untouched. Real WhatsApp delivery remains operational and was neither invoked
nor claimed.**
