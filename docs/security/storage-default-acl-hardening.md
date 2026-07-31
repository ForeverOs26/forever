# Storage future-table default ACL hardening

**Task:** FOREVER-STORAGE-DEFAULT-ACL-HARDENING-001
**Migration:** `supabase/migrations/20260731100000_storage_default_acl_hardening.sql`
**Source finding:** F-03 (P2), from
`FOREVER_SUPABASE_ADMIN_DEFAULT_ACL_RESOLUTION_RESEARCH_001`
**Status:** implemented in a migration; **not applied to production by this
change**. Applying it is a separately authorised step.

---

## 1. The defect

`pg_default_acl` stores, per defining role and per schema, the privileges a table
is _born with_. Measured read-only against production on 2026-07-31:

```
postgres | storage | r (TABLES)
  {postgres=arwdDxtm/postgres,       anon=arwdDxtm/postgres,
   authenticated=arwdDxtm/postgres,  service_role=arwdDxtm/postgres}
```

`arwdDxtm` is all eight table privileges: INSERT, SELECT, UPDATE, DELETE,
TRUNCATE, REFERENCES, TRIGGER and MAINTAIN. So a table created by `postgres` in
schema `storage` would be born granting both browser roles every one of them.
`anon` is the role behind the publishable key that ships in the browser bundle,
and both browser roles hold USAGE on schema `storage`, which is the reach needed
to use such a grant.

The equivalent row in schema `public` was corrected by migration
`20260730090000`, which was scoped to `public` and did not look at any other
schema:

```
postgres | public | r (TABLES)
  {postgres=arwdDxtm/postgres,  anon=r/postgres,
   authenticated=r/postgres,    service_role=arwdDxtm/postgres}
```

This migration brings the `storage` row to that same shape.

## 2. Why this affects future tables only

A default ACL is consulted at `CREATE TABLE` time and at no other time. It is not
a policy, not an inherited grant, and not consulted on access. Changing it cannot
reach an object that already exists, in either direction: a table created before
the change keeps exactly the ACL it was born with.

That is the whole safety argument, and the migration proves it rather than
asserting it — see §6.

## 3. Current exposure: none, and precisely why

The honest reading is weaker than "this is live" and stronger than "this is
impossible". Measured read-only:

| Fact                                                                     | Measured         |
| ------------------------------------------------------------------------ | ---------------- |
| Relations in schema `storage`                                            | 25               |
| Owned by `supabase_storage_admin`                                        | 25               |
| **Owned by `postgres`**                                                  | **0**            |
| `has_schema_privilege('postgres','storage','CREATE')`                    | **false**        |
| Owner of schema `storage`                                                | `supabase_admin` |
| `postgres` has privileges of `supabase_admin` / `supabase_storage_admin` | false / false    |
| Repository code paths creating a table in schema `storage`               | 0                |

So the defect is **latent, not live**: the default has never produced an object,
and `postgres` cannot presently create a table in schema `storage` at all. It
becomes live the moment `postgres` is granted CREATE on schema `storage` — a
platform-side change Forever does not control and would not necessarily be told
about — at which point the very next table created there is born fully
browser-writable, with no further warning.

Correcting the default now costs nothing and removes that trap permanently. This
is defence in depth, not incident response. The severity stays **P2**.

## 4. Why existing Supabase Storage behaviour is unchanged

`storage.objects` and `storage.buckets` grant `anon` and `authenticated`
`arwdDxtm` **directly in their own relation ACLs**, granted by
`supabase_storage_admin` — not inherited from any default:

```
storage.objects  {supabase_storage_admin=a*r*w*d*D*x*t*m*/supabase_storage_admin,
                  service_role=arwdDxtm/…, authenticated=arwdDxtm/…,
                  anon=arwdDxtm/…, postgres=a*r*w*d*D*x*t*m*/…}
```

Those grants are what the Storage API and the browser actually use, and this
migration does not touch a single existing relation ACL. It contains no `REVOKE`
against any table, no `GRANT`, no ownership change, no RLS or policy change, no
schema grant and no row DML.

Unchanged and proven unchanged: the three `storage.objects` public-read policies,
every storage relation ACL, schema-level privileges on `storage`, object
ownership, `service_role` access, the 4 buckets and 810 objects (counted only —
no object path, metadata or owner was read), and all Storage API code and
configuration. No dependency or lockfile changed.

## 5. Exactly what changes

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON TABLES FROM anon, authenticated;
```

One defining role, one schema, one object type, two named grantees, seven named
write privileges.

**SELECT is deliberately preserved.** Removing it would change the birth state of
a future storage table from readable to unreadable — a different contract with its
own visible consequences, and not what this task set out to change. The end state
for the browser roles is `r`: read, and nothing else.

**`REVOKE ALL` is deliberately not used.** It would take SELECT with it. Naming
the seven privileges is the entire safety property, and negative control 17 exists
specifically because a `REVOKE ALL` substitution leaves the write-detector green
and is caught _only_ by the SELECT-preservation check.

`MAINTAIN` is a PostgreSQL 17 privilege; naming it on 16 or earlier is a syntax
error. The privilege list is therefore assembled from `server_version_num` at run
time. Production is PostgreSQL 17.6. Every privilege check in the migration and
the harness reads `pg_default_acl` through `aclexplode`, never
`information_schema.role_table_grants`, which does not expose MAINTAIN (finding
F-05) and would report a default carrying it as clean.

## 6. Preservation postconditions

The migration snapshots the state before it changes anything and, before `COMMIT`,
requires each property to be byte-identical. Any failure raises and rolls the
whole transaction back.

| #   | Property                                                                                                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1–2 | No INSERT / UPDATE / DELETE / TRUNCATE / REFERENCES / TRIGGER / MAINTAIN survives for `anon` or `authenticated` in the targeted default |
| 3   | Default SELECT unchanged for both browser roles                                                                                         |
| 4   | `service_role` and `postgres` cells inside the targeted default unchanged                                                               |
| 5   | `postgres` / `public` TABLES default unchanged                                                                                          |
| 6   | Every `supabase_admin` default, in every schema, unchanged                                                                              |
| 7   | TABLE defaults in every schema other than `storage` unchanged                                                                           |
| 8   | SEQUENCE defaults unchanged                                                                                                             |
| 9   | FUNCTION defaults unchanged                                                                                                             |
| 10  | Existing `storage` relation ACLs unchanged                                                                                              |
| 11  | Existing `public` relation ACLs unchanged                                                                                               |
| 12  | RLS enabled/forced state and the full policy set unchanged                                                                              |
| 13  | Relation ownership unchanged                                                                                                            |
| 14  | Schema-level privileges unchanged                                                                                                       |

Properties 1–4 are proven as a single **equality** against an end state computed
from the pre-change row minus exactly the cells the migration is permitted to
remove. That closes both directions at once: no privilege may survive that should
have gone, and none may appear or disappear that was not named.

## 7. Authority — why this one is self-service

`ALTER DEFAULT PRIVILEGES FOR ROLE postgres` requires the caller to hold the
privileges of `postgres`. The migration executor _is_ `postgres`, altering its own
defaults, which a role may always do.

This was measured rather than assumed, on a disposable PostgreSQL 17 cluster
reproducing production's authority exactly — a non-superuser role holding **USAGE
but not CREATE** on the target schema:

| Attempt                                              | Result              |
| ---------------------------------------------------- | ------------------- |
| Revoke its **own** default in that schema            | **PERMITTED**       |
| Revoke **another role's** default in the same schema | **REFUSED — 42501** |

Holding CREATE on the schema is not a requirement, which matters here because
`postgres` has USAGE and not CREATE on `storage`.

## 8. What this does NOT close

**The `supabase_admin` residual (F-01) is not addressed and is not fixed.**
`supabase_admin`'s schema-`public` TABLES default still grants both browser roles
all eight privileges. `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` requires
membership in `supabase_admin`; `postgres` is not a superuser, holds no such
membership, and Supabase's `supautils` lists `supabase_admin` in both
`reserved_memberships` and `reserved_roles`. That residual requires a session
acting as `supabase_admin` and remains **OWNER_GATED_EXTERNAL_STEP_REQUIRED**.

`supabase_admin` has no default-ACL entry in schema `storage` at all, so there is
nothing of its to correct here. The suite asserts that it still has none
afterwards.

**Complete default-ACL closure is not claimed.** SEQUENCE and FUNCTION defaults in
`storage` and `public` remain broad (finding F-04) and are out of scope; they are
asserted _unchanged_ rather than corrected.

Residual statement after this migration:

> EXISTING TABLES HARDENED;
> POSTGRES FUTURE-TABLE DEFAULT HARDENED IN `public` AND `storage`;
> SUPABASE_ADMIN FUTURE-TABLE DEFAULT REMAINS OWNER_GATED_EXTERNAL_STEP_REQUIRED;
> SEQUENCE AND FUNCTION DEFAULTS UNCHANGED;
> FULL FUTURE-TABLE INVARIANT NOT CLAIMED.

## 9. How it is tested

`npm run security:storage-pg-test` — a disposable PostgreSQL 17 cluster on a
dynamically reserved port under a private data directory, removed in `finally`.
No production or staging credential is read.

- **Starting defect proved first.** The pre-migration canary must show a table born
  in schema `storage` inheriting all seven writes for both browser roles. A canary
  that shows nothing before proves nothing after.
- **Clean install** (Path A): the whole chain from zero on production-faithful
  bootstrap defaults.
- **Upgrade** (Path B): production's 27 applied migrations, capture, then _only_
  the new migration, then capture again. Both paths must converge.
- **Future-table canary**: after the migration a new storage table inherits SELECT
  and no write, for both roles, checked in the catalogue _and_ behaviourally — the
  roles are made to attempt a real INSERT and must be refused with 42501, and a
  real SELECT and must succeed. `service_role` and `postgres` keep all eight.
- **Idempotence**: applied twice; every fingerprint byte-identical after the second.
- **Authority boundary**: measured, not assumed (§7).
- **18 negative controls**, each mutating the database, requiring the detector that
  owns the invariant to go red, then restoring: one per retained write privilege
  (7), SELECT accidentally revoked, an existing storage table ACL changed, the
  public default changed, a `supabase_admin` default changed, a SEQUENCE default
  changed, a FUNCTION default changed, `service_role` access removed, the migration
  targeting another schema, targeting another owner role, `REVOKE ALL` substituted,
  and a failure after a real modification proving full rollback.

`src/lib/storage-default-acl-contract.test.ts` pins the static half: one
`ALTER DEFAULT PRIVILEGES` target, seven named privileges, exactly two grantees, no
SELECT revoke, no `REVOKE ALL`, no `public` or `supabase_admin` mutation, no
sequence/function default mutation, no existing-table mutation, no row DML, one
`BEGIN` and one `COMMIT`, no swallowed permission error, and the preservation
postconditions present by name.

## 10. Application to production

**Not applied by this change.** Production remains at 27 applied migrations, 0
pending. Applying `20260731100000` is a separate, separately authorised step.

Rollback, should it ever be wanted, is the symmetric statement and carries no data
risk:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage
  GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON TABLES TO anon, authenticated;
```
