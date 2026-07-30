# Browser table privilege contract

The browser roles `anon` and `authenticated` may write to exactly one table in schema
`public`, and may not read that table at all:

```
INSERT ON public.leads          -- the only browser write in the schema
no SELECT ON public.leads       -- the only read this contract removes
```

Everything else in `public` is write-denied to them: no `INSERT`, `UPDATE`, `DELETE`,
`TRUNCATE`, `REFERENCES`, `TRIGGER` or `MAINTAIN`. Every other read is untouched —
all 23 remaining table-level `SELECT` grants and all 186 column-level `SELECT` grants
the public catalogue and project pages depend on stay exactly as they are.

`leads` is intake-only, and it is the one table in the schema that holds personal
data. Writing to it and reading from it are separate privileges, and the browser needs
only the first.

Established by `supabase/migrations/20260730090000_listings_browser_write_revoke.sql`.

## Why the contract needs its own migration

No migration in this repository ever granted a browser role a write privilege, with
one deliberate exception (`GRANT INSERT ON public.leads`, `20260704132000`). The
privileges arrived from the Supabase bootstrap default:

```
pg_default_acl:  postgres | public | r | anon=arwdDxtm/postgres
                                         authenticated=arwdDxtm/postgres
```

Every table a migration created in `public` inherited seven write privileges for both
browser roles automatically. That is why the condition was uniform across 29 of 37
tables rather than patchy, and why revoking on existing tables alone would not hold —
the next migration would recreate it. The migration corrects both the existing tables
and the default.

## What row-level security does and does not cover

RLS is enabled on all 37 tables and there is exactly one browser-facing write policy
in the whole schema (`leads` INSERT). It is a real barrier. It is not a complete one,
and the difference matters when reasoning about this contract:

| Privilege               | Governed by row policies? | What stopped it before this migration                                                       |
| ----------------------- | ------------------------- | ------------------------------------------------------------------------------------------- |
| `INSERT`                | Yes                       | no policy supplies a `WITH CHECK` → 42501                                                   |
| `UPDATE`, `DELETE`      | Yes, but silently         | RLS filters every candidate row first, so the statement **succeeds having matched nothing** |
| `TRUNCATE`              | **No**                    | only the absence of a transport — PostgREST and pg_graphql expose no TRUNCATE verb          |
| `REFERENCES`, `TRIGGER` | **No**                    | no transport, and `anon` holds `USAGE` but not `CREATE` on schema `public`                  |
| `MAINTAIN`              | **No**                    | no transport                                                                                |

RLS also never constrains the table owner, a superuser, or a role with `BYPASSRLS`.
In production both `postgres` and `service_role` carry `BYPASSRLS`.

So before this migration there was one control for the DML verbs and none inside the
database for the other four. After it, a browser role is refused by privilege before
RLS is consulted, and each barrier independently suffices. The migration adds a layer;
it removes none. It creates, alters and drops no policy, and it deliberately does not
enable `FORCE ROW LEVEL SECURITY` — that would subject the table owner to RLS and
break the `postgres`-owned SECURITY DEFINER projection functions
(`forever_project_media_semantic_projection`, `forever_project_cover_reconcile`,
`forever_project_cover_withdraw`).

## Why `leads` also loses its browser read

The same argument, applied to the one table where the asset is personal data rather
than a public listing.

`public.leads` holds `name`, `email`, `phone`, `country`, `budget`, `interest`,
`project_slug` and a free-text `message`. Both browser roles held table-level `SELECT`
on it — inherited from the very same bootstrap default as the writes — and the only
thing withholding those rows was that `leads` carries no `SELECT` policy. That is one
control, and the `anon` key ships in the browser bundle.

Measured in a disposable PostgreSQL 17 cluster:

| Situation                                                | Result for `anon`                         |
| -------------------------------------------------------- | ----------------------------------------- |
| table `SELECT` granted, no `SELECT` policy (before)      | permitted, 0 rows — RLS filters them      |
| table `SELECT` granted, **one permissive SELECT policy** | **every lead row readable**               |
| table `SELECT` revoked, same permissive policy (after)   | `42501 permission denied for table leads` |

Nothing in the browser reads leads. `src/lib/lead-service.ts` calls `.insert(payload)`
with no chained `.select()`, so supabase-js sends `Prefer: return=minimal`, the
statement carries no `RETURNING` clause, and `INSERT` alone is sufficient — proven for
both roles with the read privilege removed.

**Declared behavioural change.** PostgREST now answers `401`/`403` to a hypothetical
`GET /rest/v1/leads` where it previously answered `200` with an empty array. No
application path issues that request. If `.select()` is ever chained onto the lead
insert it will raise `42501` rather than returning the row; the disposable suite
asserts both halves, so that failure arrives explained.

Server-side reads are unaffected: `service_role` and the table owner still read
`leads` in full, which is what a future CRM slice or server handler would use.

The revoke is placed **first in the transaction**, ahead of the read-surface snapshot.
Placed next to the section 2 `GRANT` instead, it aborts the migration on its own
SELECT-preservation postcondition — measured, not reasoned about.

## Adding a table

New tables in `public` are now born browser-write-denied. Nothing is required of the
author. They are still born browser-**readable**, because the default `SELECT` grant
is intentionally unchanged; revoke it explicitly for a private table, as the Studio
migrations do:

```sql
REVOKE ALL ON TABLE public.my_private_table FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.my_private_table TO service_role;
```

## Adding a browser write

Don't, unless there is no server path. The house pattern is a service-role write
behind an app-server handler, or a `service_role`-only `SECURITY DEFINER` RPC. If a
second direct browser write is genuinely required, it needs three things together:

1. a table privilege `GRANT` naming only the verb required;
2. an RLS policy scoping which rows;
3. an entry in `APPROVED` in `scripts/security/run-browser-write-revoke-pg-tests.mjs`,
   or the suite fails — which is the point.

`leads` is the reference example: `INSERT` only, `WITH CHECK (status = 'new' AND …)`,
and `src/lib/lead-service.ts` calls `.insert(payload)` with no chained `.select()`, so
supabase-js sends `Prefer: return=minimal` and the statement needs no `RETURNING` and
therefore no `SELECT`.

## Verifying it

```bash
npm run security:pg-test
```

Two installation paths on a disposable PostgreSQL 17 cluster — a clean install of the
whole chain from zero, and the upgrade path from the 26 migrations production carries —
plus a leads-INSERT proof as both browser roles, a leads-read denial proof (catalogue,
behavioural, and `INSERT … RETURNING`), the permissive-policy leakage control, a
`listings` denial proof per verb, a SELECT-preservation proof against real rows that
allows exactly the two leads cells to move and nothing else, a service-role and owner
no-regression proof including `leads`, RLS/policy fingerprint equality, a default-ACL
canary per defining owner role, an executor-authority probe, and thirteen negative
controls that each mutate the database and require the suite to go red.

The leakage control is the one worth reading. It adds a permissive `SELECT` policy to
`leads` on purpose, proves the policy is genuinely permissive by having an
RLS-**subject** probe role read every row through it — `service_role` and the owner
cannot play that part, both bypass RLS — and then requires the browser roles to be
refused anyway. That is only possible because the table privilege is gone. One of the
thirteen negative controls deliberately substitutes a `USING (false)` policy to prove
this control cannot pass vacuously.

`src/lib/browser-write-privilege-contract.test.ts` owns the static half: atomicity, no
`REVOKE ALL`, exactly one `REVOKE … SELECT` (character for character, the leads
statement), its placement ahead of the read-surface snapshot, exactly one `GRANT`, no
row DML, no schema change, no credential.

## Known residual — OWNER_GATED_EXTERNAL_STEP_REQUIRED

Schema `public` carries **two** table default-ACL entries, one per defining owner role.
The migration discovers them from `pg_default_acl` and corrects every one it is
authorised to:

- **`postgres`** — the migration executor and the owner of all 37 tables. **Corrected.**
  This is the entry the migration chain actually exercises, so every table this
  repository creates from now on is born browser-write-denied.
- **`supabase_admin`** — the platform superuser. **Not corrected, and not correctable
  from here.** `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` requires membership in
  `supabase_admin`; production's `postgres` is not a superuser and holds no such
  membership, so the statement would raise 42501 and abort the migration. The migration
  raises a `WARNING` naming the role and the exact corrective statement instead of
  passing over it, and the disposable suite reports it as a **failing** canary rather
  than skipping it.

Stated precisely, so the release note can be accurate:

- this migration hardens **every existing application table** in `public`;
- this migration fixes the **`postgres`-owned future-table defaults**;
- a **separate privileged platform operation** is required to fix the `supabase_admin`
  default ACL — a session acting as `supabase_admin`, or a Supabase platform/support
  operation. No Management API, CLI or SQL-editor route available to this project can
  execute it;
- **a production release must not claim the full future-table invariant** until that
  external step is completed, or until the residual is formally accepted as such.

Current exposure is prospective, not present: 0 of the 37 tables in `public` were
created by `supabase_admin`, so that default has never been exercised in this schema.
The exposure would begin if a future Supabase platform operation created a table in
`public` as `supabase_admin`. Closing it:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON TABLES FROM anon, authenticated;
```

Until that runs, `npm run security:pg-test` exits non-zero on exactly that one check.
That is a finding, not a broken test — the summary line names it explicitly and
separates it from real regressions.

## Also outstanding, deliberately out of scope here

- **`audit_log`, `ingestion_batches`, `ingestion_warnings` and `price_updates`** are
  operational tables that no browser code reads, yet browser `SELECT` reaches them.
  Same reasoning, same separate decision.
- **`set_updated_at()`, `studio_archive_entry_guard()` and
  `studio_archive_lifecycle_guard()`** are `EXECUTE` to `PUBLIC`. All three are
  SECURITY INVOKER trigger functions and PostgreSQL refuses to invoke a trigger
  function directly, so they confer nothing — but they are needless surface.
