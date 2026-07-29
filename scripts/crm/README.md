# CRM Slice 0 — measured read-only lead baseline

Task ID: `FOREVER-CRM-SLICE0-MEASURED-BASELINE-001`, corrected by
`FOREVER-CRM-SLICE0-CORRECTION-001`.
Authority: [`docs/crm/CRM_FINAL_RECOMMENDATION.md`](../../docs/crm/CRM_FINAL_RECOMMENDATION.md) §3, merged PR #122.

## What is here

| File | Purpose |
| ---- | ------- |
| `crm-slice0-lead-baseline.sql` | The read-only measurement. Safe to paste into the production SQL editor. |
| `crm-slice0-lead-baseline.test.mjs` | Static contract test: read-only, PII-free, closed vocabulary, suppressed. |
| `crm-slice0-lead-baseline.pg.test.mjs` | Executable fixtures: runs the real script against a disposable cluster and asserts on what it actually emits. |

## Why

The canonical CRM architecture refuses to build anything with a schema until
Forever knows how many enquiries it actually receives. `docs/ROADMAP.md:228`
gates the build-versus-buy decision on "lead volume exceeds the simple internal
workflow" — a trigger that could not be evaluated, because `public.leads` has
one INSERT policy, no SELECT policy, and no code in the repository reads a lead
back. This script produces the number, and nothing else.

Slice 0 is measurement only. It creates zero tables, zero migrations and zero
application code, and it implements no part of Slice 1.

## What a result from this script proves — and what it does not

This matters more than the number, so it is stated first.

The script measures **the current contents of `public.leads` at the moment it
runs**. That is the whole of its evidence. A total of zero therefore supports
exactly one statement:

> At the time of the read-only measurement, production `public.leads` contained
> zero rows.

It does **not** prove any of the following, and must never be quoted as if it
did:

- that no lead was ever submitted;
- that no lead was ever stored;
- that historical rows were never deleted;
- that production capture definitely failed;
- that another former environment was never used.

The script reads no audit log, no WAL history and no deleted row. The only
conclusion it licenses is:

> The current production table contains no evidence of retained leads, so
> end-to-end capture remains unproven and requires a separate controlled test.

That controlled test is a separate task. It is not implemented here, and Slice 0
does not authorize it, schedule it or perform it.

## Running it

The script returns **one consolidated result set**. Both the Supabase SQL
editor and the Management API return only the final result of a multi-statement
script, so every section is emitted as labelled rows rather than as ten
separate queries. Filter with the `section` column.

Supabase SQL editor — paste the whole file and run.

Via the CLI, against the linked project:

```bash
supabase db query --linked -f scripts/crm/crm-slice0-lead-baseline.sql
```

Against a disposable local cluster:

```bash
psql -h 127.0.0.1 -p 5432 -U postgres -d postgres -f scripts/crm/crm-slice0-lead-baseline.sql
```

## Sections

| # | Section | Answers |
| - | ------- | ------- |
| 1 | `1_SAFETY_PROOF` | Is this transaction actually read-only, and what is the scope of its evidence? |
| 2 | `2_SCHEMA_SNAPSHOT` | Columns, indexes, constraints, RLS flags |
| 3 | `3_SECURITY_SNAPSHOT` | Complete RLS policies including predicates, full table ACL, effective privileges |
| 4 | `4_LEAD_BASELINE` | Total leads, month range, distinct emails, contactability |
| 5 | `5_BY_MONTH` | Volume per calendar month |
| 6 | `6_BY_SOURCE` | Which capture surface produced them |
| 7 | `7_BY_STATUS` | Whether status is used at all |
| 8 | `8_DUPLICATION` | How much repeat contact exists |
| 9 | `9_COMPLETENESS` | Null/blank count per operationally important field |
| 10 | `10_CRM_READINESS` | What a CRM could and could not measure today |

## The four guarantees

**It cannot write.** The script opens a transaction, sets it read-only *in-band*
with `SET TRANSACTION READ ONLY`, re-reads `transaction_read_only` as evidence,
and ends in `ROLLBACK`. The read-only mode is deliberately not set via
`PGOPTIONS`, which the Supavisor pooler may discard. It contains no `INSERT`,
`UPDATE`, `DELETE`, `UPSERT`, `MERGE`, `TRUNCATE`, `ALTER`, `CREATE`, `DROP`,
`GRANT`, `REVOKE` or `COMMENT`, and creates no temporary table, view, function,
procedure or sequence.

**It cannot leak a person.** Every personal column is converted to a boolean at
the first CTE boundary, so no raw name, email, phone, message, country, budget
or interest value exists as a column anywhere downstream, and no lead `id` or
individual timestamp is ever emitted. Normalized email is confined to a single
CTE whose only output is a group size — no address and no hash leaves it.
Aggregation happens inside PostgreSQL; no lead row leaves the database.

**It cannot echo an unconstrained column.** `source` is `TEXT NOT NULL DEFAULT
'contact_form'` with **no CHECK constraint**, so any string a caller can write
can be stored there — including an email address, a phone number, a URL or free
text a guest typed. `source` is therefore treated as a *lookup key*, never as a
label. Every emitted category comes from a closed vocabulary derived from the
repository, or from one of two fixed constants:

| Emitted label | Where the value comes from |
| ------------- | -------------------------- |
| `contact_form` | migration `20260704132000_create_leads.sql:13` column DEFAULT; `src/lib/lead-service.ts` fallback; `src/components/ContactForm.tsx` default prop |
| `contact_page` | `src/routes/contact.tsx` |
| `home_page` | `src/routes/index.tsx` |
| `booth` | `src/features/navigator/core/lead.ts` `BOOTH_LEAD_SOURCE`, pinned by `lead.test.ts` |
| `project_detail (retired surface)` | `ProjectContactCTA.tsx`, on main until commit `1577207` (PR #123) retired it; rows written earlier can still carry it |
| `(missing source)` | fixed constant for NULL or blank |
| `Other / unknown source` | fixed constant for **everything else** |

`status` is intended to be constrained — the migration carries
`CHECK (status IN ('new','contacted','qualified','closed','spam'))` — so only
those five values are emitted, plus `(missing status)` and
`Other / unknown status` for any live value the constraint no longer prevents.

No production data is modified to achieve this. Categorisation happens in the
`SELECT`, inside the read-only transaction.

**It cannot expose a small group.** Any grouped category with fewer than five
leads is folded into `Other / suppressed`, and a fold-in bucket that is itself
below the floor reports `SUPPRESSED_LT_5` rather than a number.

The same floor governs **every calendar output** — earliest month, latest month
and month range — so a one-to-four-row table cannot reveal its month through an
unsuppressed summary while the grouped month output is suppressed:

| Total leads | Every calendar output |
| ----------- | --------------------- |
| 0 | `NOT_MEASURABLE_NO_DATA` |
| 1–4 | `SUPPRESSED_LT_5` |
| 5 or more | the exact month |

## Counts, rates, schema gaps and suppression are four different things

An earlier version of this file claimed "absence is never reported as zero".
That was false, and the claim is withdrawn: the script does return numeric zero,
correctly, for factual counts. The actual rule is:

| Kind of answer | On an empty table |
| -------------- | ----------------- |
| A **factual count** — `total_leads`, `months_containing_leads`, `with_email`, the per-field `null_or_blank_count` | numeric `0`. Zero is an honest answer to "how many". |
| A **ratio, rate, variation, duplication significance or behavioral conclusion** — `email_completeness_rate`, `duplicate_rate`, `status_has_meaningful_variation` | `NOT_MEASURABLE_NO_DATA`. A rate has no value at a denominator of zero, and reporting it as 0 would assert something the data does not say. |
| A fact the **current schema cannot support** — `unit_context_exists`, `response_time_calculable` | `NOT_MEASURABLE_FROM_CURRENT_SCHEMA`, never 0. |
| A fact withheld by the **group-size floor** | `SUPPRESSED_LT_5`. |

## Privilege and policy evidence

Section 3 reports the security boundary in full, because a baseline that
understates it is worse than none.

**Policies.** Name, command, `PERMISSIVE`/`RESTRICTIVE` mode, roles, the `USING`
predicate and the `WITH CHECK` predicate. The `WITH CHECK` predicate on
`public.leads` *is* the actual write boundary, so reporting only the policy name
and command would hide the thing worth reviewing.

**Privileges.** Two complementary views, because they answer different questions
and can disagree:

- **Relation ACL** — from `aclexplode(pg_class.relacl)`: grantee, privilege
  type, grantor, whether it is grantable, and the fact that it came from the
  relation ACL. The privilege names come from the server, so no unsupported
  privilege name is ever issued.
- **Effective** — from `has_table_privilege` over `SELECT`, `INSERT`, `UPDATE`,
  `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER` and `MAINTAIN`, which also
  reflects role membership and `PUBLIC`. `MAINTAIN` exists only in PostgreSQL 17
  and later, so it is gated on `server_version_num`; on an older server the row
  reports `NOT_SUPPORTED_BY_SERVER_VERSION` rather than failing the script.

Reported for `anon`, `authenticated` and `service_role` at minimum. The raw
`relacl` text is emitted only when every grantee and grantor in it is a known
platform role; otherwise it reports `SUPPRESSED_NON_STANDARD_ROLE_IN_ACL`, so an
operator-created role carrying a personal identifier cannot be printed.

**This script changes no privilege.** Whatever breadth the live ACL turns out to
have is recorded as a finding. Hardening it is a separate, later, Owner-approved
PR.

## Tests

Two, and neither replaces the other.

```bash
node scripts/crm/crm-slice0-lead-baseline.test.mjs
```

The **static contract test** reads the SQL as text: 17 positive rules and 27
negative fixtures. It pins the transaction discipline, the absence of write
verbs, the PII boundary, the closed source and status vocabulary, the calendar
floor, the full privilege and policy evidence, the count-versus-rate rule, and
the absence of any historical claim the measurement cannot support. It strips
comments and string literals before scanning, so the script can safely *name*
forbidden verbs and privilege names in its own documentation without tripping
the check, while a real write statement is still caught.

Every rule is proved to be capable of failing. The negative fixtures are
deliberately broken variants of the real script — a smuggled `UPDATE`,
`CREATE TABLE` and `GRANT`, a removed read-only guard, a `COMMIT` in place of
the `ROLLBACK`, a raw email or name selected as output, an emitted email hash, a
lowered suppression floor, an embedded project ref or connection string, a
second table read, a raw source or status value echoed instead of categorised, a
vocabulary widened with an invented value, an exact month emitted without the
calendar floor, a privilege probe narrowed back to four privileges, `MAINTAIN`
issued without a version guard, a raw ACL emitted without the known-role gate, a
dropped policy predicate, a rate reported as 0 on an empty table, and two
restored historical over-claims. Each must be rejected.

```bash
node scripts/crm/crm-slice0-lead-baseline.pg.test.mjs
```

The **executable fixtures** do what no text scan can: they run the exact
checked-in script against a disposable PostgreSQL cluster and assert on what it
actually emits. Fourteen table states — zero, one, four and five rows; known,
unknown, email-shaped and URL-shaped `source`; mixed known and unknown statuses;
one small month, one month at the floor, and five rows split across months; with
and without duplicate-email groups — proving that raw unknown source text,
email-shaped text and URL-shaped text never appear, that months stay suppressed
below five and are exact at five or more, that factual zeros stay zero while
rates report `NOT_MEASURABLE_NO_DATA`, and that the privilege and policy output
is present in every state. All fixture data is invented; addresses use the
RFC 2606 reserved `.invalid` TLD. No production lead is ever copied.

The runner proves the identity of the cluster it is talking to **before** it
issues any DDL: it asks the OS for a free port, verifies no process owns it,
`initdb`s a fresh cluster in a private temp directory, records the postmaster
PID, verifies `data_directory` over SQL, and creates and reads back a unique task
marker. Only then does it create the fixture table. It never uses a fixed port,
never connects to a cluster it did not start, and issues no `DROP` of any kind.
Set `FOREVER_PG_BIN` if the PostgreSQL binaries are not discovered; the runner
exits 2 and skips when none are available.

## What this script deliberately does not do

It does not repair anything it finds, does not read any table other than
`public.leads` and the system catalogs, and does not resolve two different email
addresses to one person. Phone numbers are not normalized, because the codebase
defines no canonical normalization rule beyond a format check — only presence is
counted. It does not change a privilege or a policy, and it does not decide
whether Slice 1 should be built. Repairs, hardening and that decision each
belong to their own task, behind Owner approval.
