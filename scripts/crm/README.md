# CRM Slice 0 — measured read-only lead baseline

Task ID: `FOREVER-CRM-SLICE0-MEASURED-BASELINE-001`
Authority: [`docs/crm/CRM_FINAL_RECOMMENDATION.md`](../../docs/crm/CRM_FINAL_RECOMMENDATION.md) §3, merged PR #122.

## What is here

| File | Purpose |
| ---- | ------- |
| `crm-slice0-lead-baseline.sql` | The read-only measurement. Safe to paste into the production SQL editor. |
| `crm-slice0-lead-baseline.test.mjs` | The contract test that pins the script read-only, PII-free and suppressed. |

## Why

The canonical CRM architecture refuses to build anything with a schema until
Forever knows how many enquiries it actually receives. `docs/ROADMAP.md:228`
gates the build-versus-buy decision on "lead volume exceeds the simple internal
workflow" — a trigger that could not be evaluated, because `public.leads` has
one INSERT policy, no SELECT policy, and no code in the repository reads a lead
back. This script produces the number, and nothing else.

Slice 0 is measurement only. It creates zero tables, zero migrations and zero
application code, and it implements no part of Slice 1.

## Running it

The script returns **one consolidated result set**. Both the Supabase SQL
editor and the Management API return only the final result of a multi-statement
script, so every section is emitted as labelled rows rather than as nine
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
| 1 | `1_SAFETY_PROOF` | Is this transaction actually read-only? |
| 2 | `2_SCHEMA_SNAPSHOT` | Columns, indexes, constraints, RLS, policies, browser-role grants |
| 3 | `3_LEAD_BASELINE` | Total leads, month range, distinct emails, contactability |
| 4 | `4_BY_MONTH` | Volume per calendar month |
| 5 | `5_BY_SOURCE` | Which capture surface produced them |
| 6 | `6_BY_STATUS` | Whether status is used at all |
| 7 | `7_DUPLICATION` | How much repeat contact exists |
| 8 | `8_COMPLETENESS` | Null/blank rate per operationally important field |
| 9 | `9_CRM_READINESS` | What a CRM could and could not measure today |

## The three guarantees

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

**It cannot expose a small group.** Any grouped category with fewer than five
leads is folded into `Other / suppressed`, and small null/blank counts report
`SUPPRESSED_LT_5` instead of a number.

Where the schema cannot support a measurement the script returns
`NOT_MEASURABLE_FROM_CURRENT_SCHEMA`; where the schema supports it but no rows
exist it returns `NOT_MEASURABLE_NO_DATA`. Absence is never reported as zero.

## Contract test

```bash
node scripts/crm/crm-slice0-lead-baseline.test.mjs
```

Exits 0 when the contract holds, 1 otherwise. It strips comments and string
literals before scanning, so the script can safely *name* forbidden verbs in its
own documentation without tripping the check, while a real write statement is
still caught.

The test carries twelve negative fixtures — deliberately broken variants of the
real script, each of which must be rejected. A rule that cannot fail protects
nothing, so the fixtures cover a smuggled `UPDATE`, `CREATE TABLE` and `GRANT`,
a removed read-only guard, a `COMMIT` in place of the `ROLLBACK`, a raw email or
name selected as output, an emitted email hash, a lowered suppression floor, an
embedded project ref or connection string, and a second table being read.

## What this script deliberately does not do

It does not repair anything it finds, does not read any table other than
`public.leads` and the system catalogs, and does not resolve two different email
addresses to one person. Phone numbers are not normalized, because the codebase
defines no canonical normalization rule beyond a format check — only presence is
counted. Repairs belong to Slice 1, behind Owner approval.
