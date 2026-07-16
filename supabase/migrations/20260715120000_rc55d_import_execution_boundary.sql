-- RC5.5D: Server-side atomic import execution boundary (PREPARATION ONLY).
--
-- STATUS: COMMITTED BUT NOT APPLIED. Applying this migration to any database —
-- local, staging, or production — is a separate, explicit Owner checkpoint.
-- Nothing in the repository invokes, applies, or depends on this migration at
-- runtime; the RC5.5D live adapter stays disabled and no execution role grant
-- is exercised.
--
-- Purpose: define the single PostgreSQL transaction boundary a future first
-- real Coralina import must use. A real import must never be implemented as
-- multiple independent Supabase REST insert calls; instead, one RPC call runs
-- one server-side function inside one transaction that performs
--   approved-request binding verification (the exact Owner-approved payload),
--   approval consumption (atomic compare-and-set on the durable approval row),
--   fresh-state verification,
--   all entity writes in canonical dependency order,
--   persisted-row verification, and
--   durable receipt creation,
-- and either all of it commits together or all of it rolls back together.
-- Partial import is impossible: any mismatch raises, and a raise inside a
-- PostgreSQL function aborts the whole surrounding transaction.
--
-- Approved-request binding (RC5.5D review blocker 1):
--   The server NEVER trusts a client-supplied fingerprint or plan hash as
--   proof of payload identity. Approval registration receives the COMPLETE
--   bounded approved request, validates it with the same shared server-side
--   validator the execution path uses, stores it as an immutable canonical
--   JSONB body (`approved_request`), and computes and stores a digest of that
--   body INSIDE PostgreSQL (`approved_request_digest`, sha256 over the
--   canonical jsonb text). CHECK constraints structurally bind every scope
--   column (approval digest, slug, target, target identity, plan hash,
--   collision fingerprint, operation count) to the stored body, so the
--   columns can never disagree with the payload. At execution, BEFORE any
--   durable approval consumption and before any write, the incoming request
--   must be structurally identical to the stored approved request (jsonb
--   equality: key-order-insensitive, array-order-SENSITIVE, covering the
--   project entity and every stable field, every building, every unit, every
--   price-history entity, entity order, operation counts, project slug,
--   target identity, plan hash, collision fingerprint, approval digest,
--   schema version, and the request fingerprint field itself), and the
--   PostgreSQL-recomputed digest of the incoming request must equal the
--   stored digest. A self-consistent malicious client that alters any entity
--   field, reorders arrays, adds or removes an entity, or recomputes its own
--   fingerprint after changing data therefore fails closed
--   (`approval_request_mismatch`) with zero consumption and zero writes.
--
-- Approval-consumption rollback policy (explicit, tested):
--   The approval CAS runs INSIDE the import transaction. On commit the
--   approval is durably consumed exactly when the import is durably applied;
--   on rollback the CAS is undone with everything else, so a rolled-back
--   import never leaves a falsely consumed approval. Exactly-one-winner still
--   holds under concurrency: the row-level lock taken by the CAS UPDATE
--   serializes concurrent attempts, the loser re-evaluates `consumed_at IS
--   NULL` after the winner commits, and at most one attempt can ever commit —
--   `plan_already_executed` and the fresh-state check close the remaining
--   window. Client-side, the RC5.5C local registry additionally burns the
--   artifact on any execution attempt and no retry is ever automatic, so a
--   rolled-back approval is only ever re-presented by a new explicit Owner
--   decision.
--
-- Privilege model (every decision documented):
--   * `forever_import` is a PRIVATE schema: it is not in the PostgREST
--     exposed-schema list, and USAGE is revoked from PUBLIC and never granted
--     to anon or authenticated. Nothing in it is reachable over the Data API.
--   * Tables grant nothing to PUBLIC/anon/authenticated and have RLS enabled
--     with no policies (default-deny for any non-owner role that ever gains
--     USAGE by mistake). The function owner (migration role) bypasses RLS as
--     table owner; that is the only access path.
--   * `forever_execution.forever_execute_approved_import(jsonb)` is the ONLY
--     callable surface, and it lives in its OWN dedicated closed schema
--     `forever_execution` — NOT in `public`. This dedicated closed schema is the
--     PRIMARY isolation boundary, and it does NOT depend on the wrapper being in
--     `public` or on the executor lacking `public` USAGE: `forever_execution`
--     has PUBLIC revoked and its default function EXECUTE for PUBLIC reversed, so
--     a future accidental function there cannot silently become
--     PUBLIC-executable, and the executor is granted USAGE on `forever_execution`
--     plus EXECUTE on this one wrapper — and nothing else in that schema.
--     IMPORTANT — PostgreSQL PUBLIC semantics: effective privileges are the
--     UNION of direct grants, inherited-role grants, and grants to the implicit
--     PUBLIC pseudo-group (every role is implicitly part of PUBLIC). A stock
--     database commonly carries a default USAGE grant on schema `public` to the
--     PUBLIC pseudo-group, so a
--     direct `REVOKE ... ON SCHEMA public FROM forever_import_executor` does NOT
--     remove a PUBLIC-derived USAGE — the executor MAY still have effective USAGE
--     on `public`. This migration does NOT claim otherwise, and deliberately does
--     NOT globally `REVOKE USAGE ON SCHEMA public FROM PUBLIC` (that could affect
--     existing Supabase, PostgREST, website, migration, or application behavior
--     and requires a separate impact audit and Owner decision). The executor's
--     ACTUAL effective public-schema access is determined ONLY by the effective-
--     privilege audit against the real target (see below), which classifies any
--     PUBLIC-derived public-schema USAGE as blocking pending a separate
--     Owner-approved reconciliation (option B). The wrapper is SECURITY DEFINER —
--     strictly required so the calling role needs ZERO direct privileges on
--     `forever_import.*` or on the imported tables; it performs the import as its
--     owner. Every function pins `search_path = ''` and schema-qualifies every
--     reference, closing search-path hijacking. The direct-PostgreSQL transport
--     calls exactly one fixed statement,
--     `SELECT forever_execution.forever_execute_approved_import($1::jsonb)`
--     — never PostgREST, and never a caller-supplied schema/table/function name.
--   * EXECUTE on the wrapper is revoked from PUBLIC (PostgreSQL grants function
--     EXECUTE to PUBLIC by default — that default is explicitly reversed here),
--     from anon, from authenticated, AND from `service_role`. service_role is
--     deliberately NOT an execution principal: it already holds broad direct
--     privileges on the public target tables under the existing conventions, so
--     granting it the wrapper would narrow nothing, and a caller holding the
--     service-role key could bypass the entire approved-execution boundary
--     (approved-request binding, durable consumption, state verification, the
--     one-transaction wrapper, receipts, project scoping, no-update/no-delete).
--   * The ONE execution principal is `forever_import_executor`, a dedicated
--     LEAST-PRIVILEGE LOGIN role (design A): a FUTURE direct database transport
--     authenticates AS this role. Its two REQUIRED capabilities are USAGE on the
--     dedicated `forever_execution` schema and EXECUTE on the SECURITY DEFINER
--     wrapper. It is granted NO direct SELECT/INSERT/UPDATE/DELETE on
--     public.projects / public.buildings / public.units / public.unit_price_history,
--     NO direct access to the forever_import.* approval or receipt storage, NO
--     direct USAGE on the private schema, NO direct EXECUTE on any internal
--     function, NO membership in service_role (so it cannot SET ROLE to it),
--     NOINHERIT, and no ambient authority (NOSUPERUSER / NOCREATEDB /
--     NOCREATEROLE / NOREPLICATION / NOBYPASSRLS). The migration additionally
--     REVOKEs the public target tables, the private schema/tables/functions, and
--     `public`-schema privileges from the executor as DEFENSIVE HYGIENE — but a
--     direct REVOKE does NOT override a PUBLIC-derived grant, so these revokes do
--     NOT by themselves prove the executor lacks effective `public` USAGE or any
--     other PUBLIC-inherited right. Because the wrapper is SECURITY DEFINER, the
--     executor performs the bounded import WITHOUT ever holding table privileges
--     of its own. NO password is committed here: the role cannot authenticate
--     until the Owner provisions a secret separately, so the live path is
--     fail-closed by default. The transport credential is a dedicated database
--     connection URL (`FOREVER_IMPORT_EXECUTOR_DATABASE_URL`), never the
--     service-role key.
--   * Direct GRANT/REVOKE enumeration is NOT sufficient proof of least
--     privilege — PostgreSQL effective privileges include PUBLIC-inherited and
--     inherited-role rights, and OWNERSHIP confers authority beyond ordinary ACL
--     privileges. The migration is therefore accompanied by an effective-
--     privilege & PUBLIC-ACL audit (`src/import/effective-privilege-audit.ts`) of
--     read-only, single-SELECT catalog checks that MUST be run against the real
--     target AFTER migration application and BEFORE any approval issuance. It
--     measures the executor's EFFECTIVE privileges (direct + inherited + PUBLIC)
--     with `has_schema_privilege` / `has_function_privilege` / `has_table_privilege`
--     / `has_sequence_privilege` / `has_database_privilege` (role and object
--     resolved to OIDs, so a missing role/object fails closed), and inspects the
--     ACL granted specifically to the PUBLIC pseudo-group through the ACL
--     catalogs (`pg_namespace.nspacl`, `pg_proc.proacl`) expanded with
--     `aclexplode` over `COALESCE(<acl>, acldefault(...))` and matched on the
--     PUBLIC grantee OID `0` — NEVER by passing the string 'public' as a role to
--     `has_*_privilege` (PUBLIC is a pseudo-group, not a `pg_roles` role). It
--     also audits ownership (`pg_database.datdba`, `pg_namespace.nspowner`,
--     `pg_class.relowner`, `pg_proc.proowner`) and sequence privileges. Crucially
--     the capability checks span the ENTIRE non-system database surface, not a
--     fixed short list of schemas: table DML (SELECT/INSERT/UPDATE/DELETE/TRUNCATE
--     /REFERENCES/TRIGGER on tables, partitioned tables, views, materialized
--     views, and foreign tables), sequence privileges, schema CREATE, schema
--     USAGE, and EXECUTE on ANY routine — function, procedure, aggregate, or
--     window, SECURITY DEFINER or SECURITY INVOKER, overloaded or extension
--     routines included, not only SECURITY DEFINER — are checked across EVERY
--     schema that is not an explicitly-allowlisted system schema (`pg_catalog`,
--     `information_schema`, `pg_toast`, `pg_temp_*`, `pg_toast_temp_*`). Arbitrary
--     Supabase or extension schemas (`auth`, `storage`, `extensions`, `graphql`,
--     `vault`, …) are NEVER treated as trusted system schemas, and a deceptive
--     name such as `pg_catalog_evil` is not excluded. Every non-system schema is
--     explicitly classified as approved_required_surface, explicitly_prohibited_
--     surface, or unexpected_surface; a newly introduced schema is
--     unexpected_surface and BLOCKS readiness until the Owner classifies it. The
--     audit also validates the COMPLETE execution chain: because the wrapper is
--     SECURITY DEFINER it runs as its OWNER (and the internal routines it calls
--     run in that definer context), the chain is bound to ONE EXACT dedicated
--     owner — `forever_import_execution_owner` (NOLOGIN, minimal flags) — created
--     and assigned by this migration. The audit proves the wrapper and every
--     internal routine are owned by EXACTLY that role (not `postgres`,
--     `service_role`, a platform role, the executor, or any other role), that the
--     owner has an empty direct-and-recursive membership / SET ROLE closure, that
--     it owns nothing outside the approved boundary inventory (two schemas, two
--     tables, six routines, zero sequences), and that its effective capabilities
--     reduce to the exact target allowlist (USAGE on public; SELECT on the two
--     dependency tables; SELECT + INSERT on the four import tables; nothing else).
--     The weaker "owner is not broad" check is retained as a complementary signal,
--     and the executor itself must be a dedicated LOGIN role with no ambient
--     authority and no membership / SET ROLE path. Any unexpected effective privilege, ownership, role membership, CREATE
--     right, sequence privilege, table privilege in any non-system schema, USAGE
--     on an unexpected non-system schema, unexpected schema, broad chain owner, or
--     executor-reachable routine other than exactly
--     `forever_execution.forever_execute_approved_import(jsonb)` blocks readiness;
--     a PUBLIC-derived public-schema USAGE (or database TEMP) is classified
--     explicitly as blocking pending a separate Owner-approved target-ACL
--     reconciliation (option B), never silently assumed absent.
--   * `forever_import.register_import_approval` (approval issuance) is
--     granted to NO role at all — approval issuance remains a separate
--     Owner-gated checkpoint; the Owner would run it as the database owner.
--   * The internal helpers (`validate_import_request`, `request_digest`,
--     `has_unsafe_source_file`) and `forever_import.run_approved_import` are
--     not SECURITY DEFINER, are granted to no role, and cannot be called
--     directly by any non-owner: callers cannot bypass the public wrapper's
--     guards.
--   * No dynamic SQL anywhere: no EXECUTE-of-a-string, no format()-built
--     statements. Every statement is static with bound values, so there is no
--     SQL injection surface and no way to reach tables, columns, or projects
--     other than the fixed whitelisted ones.
--   * The function can only mutate the project created inside its own
--     transaction: it refuses to run unless the requested slug is absent,
--     inserts children only under the freshly created ids, and never updates
--     or deletes anything.
--
-- No secret or credential material is defined, read, or stored anywhere in
-- this migration. Approvals are stored as a domain-separated SHA-256 digest
-- only — never a raw approval id or token.

-- ---------------------------------------------------------------------------
-- Schema and execution role
-- ---------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS forever_import;

REVOKE ALL ON SCHEMA forever_import FROM PUBLIC;

-- Dedicated least-privilege execution principal (design A). LOGIN so a FUTURE
-- direct database transport can authenticate AS this role, but with NO password
-- committed here — it cannot authenticate until the Owner provisions a secret
-- separately, so the role is fail-closed by default. NOINHERIT so it never
-- automatically gains privileges of any role it might later be a member of;
-- NOSUPERUSER / NOCREATEDB / NOCREATEROLE / NOREPLICATION / NOBYPASSRLS so it
-- holds no ambient authority. Its concrete grants (USAGE on the dedicated
-- `forever_execution` schema + wrapper EXECUTE only) and its explicit defensive
-- revocations are applied after every object exists, at the end of this
-- migration.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'forever_import_executor') THEN
    CREATE ROLE forever_import_executor
      LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  ELSE
    ALTER ROLE forever_import_executor
      LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;

-- Dedicated EXECUTION-BOUNDARY OWNER role (RC5.5D review 9). The SECURITY
-- DEFINER wrapper runs as its OWNER, and the internal routines it calls run in
-- that same definer context, so the execution chain's real authority IS the
-- wrapper owner. Binding the chain to an explicit, narrow, dedicated owner —
-- rather than leaving it owned by whatever platform role applied the migration
-- (`postgres` / `supabase_admin`) — is what stops the SECURITY DEFINER
-- transition from escalating into a broad identity. This role:
--   * is NOLOGIN — it is never authenticated; only the SECURITY DEFINER
--     transition ever assumes it, so no password is (or can be) committed;
--   * is NOINHERIT and holds no ambient authority
--     (NOSUPERUSER / NOCREATEDB / NOCREATEROLE / NOREPLICATION / NOBYPASSRLS);
--   * is granted membership in NO role (it is a member of nothing, directly or
--     transitively, so it has no SET ROLE path to any broader identity);
--   * owns ONLY the exact RC5.5D boundary objects (the two boundary schemas,
--     the two durable tables, and the six routines — see the ownership section
--     at the end of this migration); it owns no target/application table, no
--     database, and nothing outside the approved inventory;
--   * is granted ONLY the exact capabilities the bounded import needs on the
--     existing target tables (USAGE on `public`; SELECT on the two dependency
--     tables; SELECT + INSERT on the four import tables) and NOTHING else — no
--     UPDATE/DELETE/TRUNCATE, no sequence privileges (the target tables use UUID
--     primary keys, so no sequence is involved), no unrelated access.
-- The effective-privilege audit proves every one of these properties against
-- the real target before any approval issuance.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'forever_import_execution_owner') THEN
    CREATE ROLE forever_import_execution_owner
      NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  ELSE
    ALTER ROLE forever_import_execution_owner
      NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;

-- Ownership reassignment (below) requires the role APPLYING this migration to be
-- able to assign objects to `forever_import_execution_owner`. Under PostgreSQL
-- semantics a non-superuser can `ALTER ... OWNER TO <role>` only if it owns the
-- object AND is a (direct or indirect) member of that role. Supabase applies
-- migrations as the non-superuser `postgres`, which holds ADMIN on the role it
-- just created, so it grants itself membership here. IMPORTANT — direction: this
-- makes the MIGRATION role a member of the owner (migration-role → owner, so the
-- platform admin can assume the owner to manage the boundary); it does NOT make
-- the owner a member of anything, so the owner gains no privilege and no SET ROLE
-- path from this grant. The audit checks the owner's OWN memberships (member =
-- owner), which stay empty.
GRANT forever_import_execution_owner TO postgres;

-- Never let future objects in this schema default to PUBLIC execute/select.
ALTER DEFAULT PRIVILEGES IN SCHEMA forever_import REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA forever_import REVOKE ALL ON TABLES FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Durable approval storage
-- ---------------------------------------------------------------------------
-- One row per issued Owner approval. The row stores a domain-separated digest
-- (`forever-import-approval:v1` SHA-256, hex) — no raw approval id, token, or
-- secret material is ever stored — PLUS the immutable canonical approved
-- request body and its PostgreSQL-computed digest. One-time consumption is an
-- atomic compare-and-set on `consumed_at IS NULL`; the UNIQUE digest prevents
-- re-registration; the CHECK constraints prevent malformed, over-lifetime, or
-- scope/payload-inconsistent approvals from ever existing durably. Expiry is
-- evaluated against database time (`now()`), never a client clock.

CREATE TABLE IF NOT EXISTS forever_import.import_execution_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_digest TEXT NOT NULL,
  schema_version TEXT NOT NULL DEFAULT '1',
  project_slug TEXT NOT NULL,
  target TEXT NOT NULL,
  target_project_id TEXT NOT NULL,
  plan_hash TEXT NOT NULL,
  collision_report_fingerprint TEXT NOT NULL,
  operation_count INTEGER NOT NULL,
  approved_request JSONB NOT NULL,
  approved_request_digest TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  execution_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT import_execution_approvals_digest_format
    CHECK (approval_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT import_execution_approvals_schema_version
    CHECK (schema_version = '1'),
  CONSTRAINT import_execution_approvals_slug_format
    CHECK (project_slug ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  CONSTRAINT import_execution_approvals_target_format
    CHECK (target ~ '^[a-z][a-z-]{0,31}$'),
  CONSTRAINT import_execution_approvals_target_project_id_format
    CHECK (target_project_id ~ '^[A-Za-z0-9._-]{1,64}$'),
  CONSTRAINT import_execution_approvals_plan_hash_format
    CHECK (plan_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT import_execution_approvals_collision_fingerprint_format
    CHECK (collision_report_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT import_execution_approvals_operation_count_bounds
    CHECK (operation_count >= 0 AND operation_count <= 1000),
  CONSTRAINT import_execution_approvals_lifetime
    CHECK (expires_at > issued_at AND expires_at <= issued_at + INTERVAL '1 hour'),
  CONSTRAINT import_execution_approvals_consumption_pairing
    CHECK ((consumed_at IS NULL) = (execution_id IS NULL)),
  CONSTRAINT import_execution_approvals_request_digest_format
    CHECK (approved_request_digest ~ '^[0-9a-f]{64}$'),
  -- Structural binding: the scope columns can never disagree with the stored
  -- immutable approved request body.
  CONSTRAINT import_execution_approvals_body_binds_approval_digest
    CHECK (approval_digest = approved_request->>'approvalDigest'),
  CONSTRAINT import_execution_approvals_body_binds_schema_version
    CHECK (schema_version = approved_request->>'schemaVersion'),
  CONSTRAINT import_execution_approvals_body_binds_slug
    CHECK (project_slug = approved_request->>'projectSlug'),
  CONSTRAINT import_execution_approvals_body_binds_target
    CHECK (target = approved_request->>'target'),
  CONSTRAINT import_execution_approvals_body_binds_target_project_id
    CHECK (target_project_id = approved_request->>'targetProjectId'),
  CONSTRAINT import_execution_approvals_body_binds_plan_hash
    CHECK (plan_hash = approved_request->>'planHash'),
  CONSTRAINT import_execution_approvals_body_binds_collision_fingerprint
    CHECK (collision_report_fingerprint = approved_request->>'collisionReportFingerprint'),
  CONSTRAINT import_execution_approvals_body_binds_operation_count
    CHECK (
      operation_count = (approved_request->'operationCounts'->>'operations')::INTEGER
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS import_execution_approvals_digest_key
  ON forever_import.import_execution_approvals(approval_digest);

REVOKE ALL ON TABLE forever_import.import_execution_approvals FROM PUBLIC;
ALTER TABLE forever_import.import_execution_approvals ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Durable execution receipts
-- ---------------------------------------------------------------------------
-- One row per committed import, written inside the same transaction as the
-- import itself. UNIQUE (project_slug, plan_hash) permanently prevents a
-- second execution of an already-imported plan — even with a different,
-- otherwise-valid approval, and even if the imported rows were later removed.
-- Contains sanitized non-secret identifiers and counts only.

CREATE TABLE IF NOT EXISTS forever_import.import_execution_receipts (
  execution_id UUID PRIMARY KEY,
  approval_digest TEXT NOT NULL,
  approved_request_digest TEXT NOT NULL,
  project_slug TEXT NOT NULL,
  target TEXT NOT NULL,
  target_project_id TEXT NOT NULL,
  plan_hash TEXT NOT NULL,
  collision_report_fingerprint TEXT NOT NULL,
  projects_written INTEGER NOT NULL,
  buildings_written INTEGER NOT NULL,
  units_written INTEGER NOT NULL,
  price_history_rows_written INTEGER NOT NULL,
  writes_performed INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT import_execution_receipts_outcome CHECK (outcome = 'committed'),
  CONSTRAINT import_execution_receipts_approval_digest_format
    CHECK (approval_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT import_execution_receipts_request_digest_format
    CHECK (approved_request_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT import_execution_receipts_counts CHECK (
    projects_written >= 0 AND buildings_written >= 0 AND units_written >= 0
    AND price_history_rows_written >= 0
    AND writes_performed
      = projects_written + buildings_written + units_written + price_history_rows_written
  ),
  CONSTRAINT import_execution_receipts_approval_unique UNIQUE (approval_digest),
  CONSTRAINT import_execution_receipts_plan_unique UNIQUE (project_slug, plan_hash)
);

REVOKE ALL ON TABLE forever_import.import_execution_receipts FROM PUBLIC;
ALTER TABLE forever_import.import_execution_receipts ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Internal helpers (granted to no role)
-- ---------------------------------------------------------------------------

-- Deterministic digest of a jsonb document, computed entirely inside
-- PostgreSQL from PostgreSQL's own canonical jsonb text form. Never supplied
-- by, and never comparable with, any client-computed fingerprint.
CREATE OR REPLACE FUNCTION forever_import.request_digest(doc JSONB)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT encode(sha256(convert_to(doc::text, 'UTF8')), 'hex');
$$;

REVOKE ALL ON FUNCTION forever_import.request_digest(JSONB) FROM PUBLIC;

-- True when any `source_file` string anywhere in the document carries a raw
-- local path (a path separator or a drive prefix). Iterative jsonb walk; no
-- dynamic SQL.
CREATE OR REPLACE FUNCTION forever_import.has_unsafe_source_file(doc JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_stack JSONB := jsonb_build_array(doc);
  v_node JSONB;
  v_key TEXT;
  v_child JSONB;
  v_text TEXT;
BEGIN
  WHILE jsonb_array_length(v_stack) > 0 LOOP
    v_node := v_stack->-1;
    v_stack := v_stack - (jsonb_array_length(v_stack) - 1);
    IF jsonb_typeof(v_node) = 'object' THEN
      FOR v_key, v_child IN SELECT key, value FROM jsonb_each(v_node)
      LOOP
        IF v_key = 'source_file' AND jsonb_typeof(v_child) = 'string' THEN
          v_text := v_child #>> '{}';
          IF position('/' in v_text) > 0
            OR position('\' in v_text) > 0
            OR v_text ~ '^[A-Za-z]:'
          THEN
            RETURN TRUE;
          END IF;
        END IF;
        IF jsonb_typeof(v_child) IN ('object', 'array') THEN
          v_stack := v_stack || jsonb_build_array(v_child);
        END IF;
      END LOOP;
    ELSIF jsonb_typeof(v_node) = 'array' THEN
      FOR v_child IN SELECT value FROM jsonb_array_elements(v_node)
      LOOP
        IF jsonb_typeof(v_child) IN ('object', 'array') THEN
          v_stack := v_stack || jsonb_build_array(v_child);
        END IF;
      END LOOP;
    END IF;
  END LOOP;
  RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION forever_import.has_unsafe_source_file(JSONB) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Shared server-side request validation
-- ---------------------------------------------------------------------------
-- The ONE validator used by BOTH approval registration and execution, so a
-- request that registration accepted and execution runs are validated by the
-- same rules and neither path can drift. Raises a static stable reason code
-- on the first violation; returns silently when the request is valid.

CREATE OR REPLACE FUNCTION forever_import.validate_import_request(request JSONB)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_keys TEXT[];
  v_counts JSONB;
  v_entities JSONB;
  v_project JSONB;
  v_buildings JSONB;
  v_units JSONB;
  v_prices JSONB;
  v_item JSONB;
  v_text TEXT;
  v_expected_projects INTEGER;
  v_expected_buildings INTEGER;
  v_expected_units INTEGER;
  v_expected_prices INTEGER;
  v_expected_operations INTEGER;
  v_count INTEGER;
  v_distinct INTEGER;
BEGIN
  -- ----- Envelope ----------------------------------------------------------
  IF request IS NULL OR jsonb_typeof(request) <> 'object' THEN
    RAISE EXCEPTION 'forever_import_execution: request_malformed';
  END IF;
  IF pg_column_size(request) > 4194304 THEN
    RAISE EXCEPTION 'forever_import_execution: request_too_large';
  END IF;
  IF request->>'schemaVersion' IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'forever_import_execution: request_schema_unsupported';
  END IF;

  SELECT coalesce(array_agg(k ORDER BY k), ARRAY[]::TEXT[])
    INTO v_keys FROM jsonb_object_keys(request) AS t(k);
  IF v_keys <> ARRAY[
    'approvalDigest', 'collisionReportFingerprint', 'entities', 'operationCounts',
    'planHash', 'projectSlug', 'requestFingerprint', 'schemaVersion', 'target',
    'targetProjectId'
  ] THEN
    RAISE EXCEPTION 'forever_import_execution: request_unsupported_property';
  END IF;

  IF request->>'projectSlug' IS NULL
    OR (request->>'projectSlug') !~ '^[a-z0-9][a-z0-9-]{0,63}$'
    OR request->>'target' IS NULL OR (request->>'target') !~ '^[a-z][a-z-]{0,31}$'
    OR request->>'targetProjectId' IS NULL
    OR (request->>'targetProjectId') !~ '^[A-Za-z0-9._-]{1,64}$'
    OR request->>'planHash' IS NULL OR (request->>'planHash') !~ '^[0-9a-f]{64}$'
    OR request->>'collisionReportFingerprint' IS NULL
    OR (request->>'collisionReportFingerprint') !~ '^[0-9a-f]{64}$'
    OR request->>'approvalDigest' IS NULL
    OR (request->>'approvalDigest') !~ '^[0-9a-f]{64}$'
    OR request->>'requestFingerprint' IS NULL
    OR (request->>'requestFingerprint') !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION 'forever_import_execution: request_invalid_field';
  END IF;

  -- ----- Operation counts --------------------------------------------------
  v_counts := request->'operationCounts';
  IF v_counts IS NULL OR jsonb_typeof(v_counts) <> 'object' THEN
    RAISE EXCEPTION 'forever_import_execution: request_operation_counts_invalid';
  END IF;
  SELECT coalesce(array_agg(k ORDER BY k), ARRAY[]::TEXT[])
    INTO v_keys FROM jsonb_object_keys(v_counts) AS t(k);
  IF v_keys <> ARRAY['buildings', 'operations', 'priceHistoryRows', 'projects', 'units'] THEN
    RAISE EXCEPTION 'forever_import_execution: request_operation_counts_invalid';
  END IF;
  IF jsonb_typeof(v_counts->'projects') <> 'number'
    OR jsonb_typeof(v_counts->'buildings') <> 'number'
    OR jsonb_typeof(v_counts->'units') <> 'number'
    OR jsonb_typeof(v_counts->'priceHistoryRows') <> 'number'
    OR jsonb_typeof(v_counts->'operations') <> 'number'
    OR (v_counts->>'projects') !~ '^[0-9]+$'
    OR (v_counts->>'buildings') !~ '^[0-9]+$'
    OR (v_counts->>'units') !~ '^[0-9]+$'
    OR (v_counts->>'priceHistoryRows') !~ '^[0-9]+$'
    OR (v_counts->>'operations') !~ '^[0-9]+$'
  THEN
    RAISE EXCEPTION 'forever_import_execution: request_operation_counts_invalid';
  END IF;

  v_expected_projects := (v_counts->>'projects')::INTEGER;
  v_expected_buildings := (v_counts->>'buildings')::INTEGER;
  v_expected_units := (v_counts->>'units')::INTEGER;
  v_expected_prices := (v_counts->>'priceHistoryRows')::INTEGER;
  v_expected_operations := (v_counts->>'operations')::INTEGER;

  IF v_expected_projects <> 1
    OR v_expected_operations
      <> v_expected_projects + v_expected_buildings + v_expected_units + v_expected_prices
  THEN
    RAISE EXCEPTION 'forever_import_execution: request_operation_counts_invalid';
  END IF;
  IF v_expected_operations > 1000 THEN
    RAISE EXCEPTION 'forever_import_execution: request_operation_count_exceeded';
  END IF;

  -- ----- Entities ------------------------------------------------------------
  v_entities := request->'entities';
  IF v_entities IS NULL OR jsonb_typeof(v_entities) <> 'object' THEN
    RAISE EXCEPTION 'forever_import_execution: request_malformed';
  END IF;
  SELECT coalesce(array_agg(k ORDER BY k), ARRAY[]::TEXT[])
    INTO v_keys FROM jsonb_object_keys(v_entities) AS t(k);
  IF v_keys <> ARRAY['buildings', 'priceHistory', 'project', 'units'] THEN
    RAISE EXCEPTION 'forever_import_execution: request_unsupported_property';
  END IF;

  v_project := v_entities->'project';
  v_buildings := v_entities->'buildings';
  v_units := v_entities->'units';
  v_prices := v_entities->'priceHistory';

  IF jsonb_typeof(v_project) <> 'object'
    OR jsonb_typeof(v_buildings) <> 'array'
    OR jsonb_typeof(v_units) <> 'array'
    OR jsonb_typeof(v_prices) <> 'array'
  THEN
    RAISE EXCEPTION 'forever_import_execution: request_malformed';
  END IF;
  IF jsonb_array_length(v_buildings) <> v_expected_buildings
    OR jsonb_array_length(v_units) <> v_expected_units
    OR jsonb_array_length(v_prices) <> v_expected_prices
  THEN
    RAISE EXCEPTION 'forever_import_execution: request_operation_counts_invalid';
  END IF;

  -- Project entity: exact key set and shapes.
  SELECT coalesce(array_agg(k ORDER BY k), ARRAY[]::TEXT[])
    INTO v_keys FROM jsonb_object_keys(v_project) AS t(k);
  IF v_keys <> ARRAY[
    'address', 'developer_slug', 'full_description', 'is_active', 'location_area',
    'location_slug', 'name', 'project_code', 'project_type', 'public_status',
    'sales_status', 'short_description', 'slug'
  ] THEN
    RAISE EXCEPTION 'forever_import_execution: request_unsupported_property';
  END IF;
  IF v_project->>'slug' IS DISTINCT FROM request->>'projectSlug'
    OR jsonb_typeof(v_project->'name') <> 'string'
    OR jsonb_typeof(v_project->'developer_slug') <> 'string'
    OR jsonb_typeof(v_project->'location_slug') <> 'string'
    OR jsonb_typeof(v_project->'project_code') <> 'string'
    OR jsonb_typeof(v_project->'project_type') <> 'string'
    OR jsonb_typeof(v_project->'location_area') <> 'string'
    OR jsonb_typeof(v_project->'address') <> 'string'
    OR jsonb_typeof(v_project->'short_description') <> 'string'
    OR jsonb_typeof(v_project->'full_description') <> 'string'
    OR jsonb_typeof(v_project->'is_active') <> 'boolean'
    OR jsonb_typeof(v_project->'public_status') <> 'string'
    OR jsonb_typeof(v_project->'sales_status') <> 'string'
  THEN
    RAISE EXCEPTION 'forever_import_execution: request_invalid_field';
  END IF;

  -- Building entities: exact key set, shapes, and unique natural keys.
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_buildings)
  LOOP
    SELECT coalesce(array_agg(k ORDER BY k), ARRAY[]::TEXT[])
      INTO v_keys FROM jsonb_object_keys(v_item) AS t(k);
    IF v_keys <> ARRAY[
      'building_code', 'building_type', 'floors_count', 'metadata', 'name', 'units_count'
    ] THEN
      RAISE EXCEPTION 'forever_import_execution: request_unsupported_property';
    END IF;
    IF jsonb_typeof(v_item->'building_code') <> 'string'
      OR jsonb_typeof(v_item->'name') <> 'string'
      OR jsonb_typeof(v_item->'building_type') <> 'string'
      OR jsonb_typeof(v_item->'floors_count') NOT IN ('number', 'null')
      OR jsonb_typeof(v_item->'units_count') NOT IN ('number', 'null')
      OR jsonb_typeof(v_item->'metadata') <> 'object'
    THEN
      RAISE EXCEPTION 'forever_import_execution: request_invalid_field';
    END IF;
  END LOOP;
  SELECT count(*), count(DISTINCT value->>'building_code')
    INTO v_count, v_distinct FROM jsonb_array_elements(v_buildings);
  IF v_count <> v_distinct THEN
    RAISE EXCEPTION 'forever_import_execution: request_duplicate_natural_key';
  END IF;

  -- Unit entities: exact key set, shapes, and unique natural keys.
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_units)
  LOOP
    SELECT coalesce(array_agg(k ORDER BY k), ARRAY[]::TEXT[])
      INTO v_keys FROM jsonb_object_keys(v_item) AS t(k);
    IF v_keys <> ARRAY[
      'availability_status', 'base_price_thb', 'bathrooms', 'bedrooms', 'building_code',
      'floor', 'metadata', 'price_per_sqm', 'size_sqm', 'unit_code', 'unit_status',
      'unit_type'
    ] THEN
      RAISE EXCEPTION 'forever_import_execution: request_unsupported_property';
    END IF;
    IF jsonb_typeof(v_item->'unit_code') <> 'string'
      OR jsonb_typeof(v_item->'building_code') NOT IN ('string', 'null')
      OR jsonb_typeof(v_item->'unit_type') NOT IN ('string', 'null')
      OR jsonb_typeof(v_item->'bedrooms') NOT IN ('number', 'null')
      OR jsonb_typeof(v_item->'bathrooms') NOT IN ('number', 'null')
      OR jsonb_typeof(v_item->'size_sqm') NOT IN ('number', 'null')
      OR jsonb_typeof(v_item->'floor') NOT IN ('number', 'null')
      OR jsonb_typeof(v_item->'base_price_thb') NOT IN ('number', 'null')
      OR jsonb_typeof(v_item->'price_per_sqm') NOT IN ('number', 'null')
      OR jsonb_typeof(v_item->'availability_status') <> 'string'
      OR jsonb_typeof(v_item->'unit_status') <> 'string'
      OR jsonb_typeof(v_item->'metadata') <> 'object'
    THEN
      RAISE EXCEPTION 'forever_import_execution: request_invalid_field';
    END IF;
  END LOOP;
  SELECT count(*), count(DISTINCT value->>'unit_code')
    INTO v_count, v_distinct FROM jsonb_array_elements(v_units);
  IF v_count <> v_distinct THEN
    RAISE EXCEPTION 'forever_import_execution: request_duplicate_natural_key';
  END IF;

  -- Price-history entities: exact key set, shapes, and unique persistence keys
  -- (unit_code, price_source, source_file, source_page, price_list_date).
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_prices)
  LOOP
    SELECT coalesce(array_agg(k ORDER BY k), ARRAY[]::TEXT[])
      INTO v_keys FROM jsonb_object_keys(v_item) AS t(k);
    IF v_keys <> ARRAY[
      'currency', 'metadata', 'price', 'price_list_date', 'price_source', 'recorded_at',
      'source_file', 'source_page', 'unit_code'
    ] THEN
      RAISE EXCEPTION 'forever_import_execution: request_unsupported_property';
    END IF;
    IF jsonb_typeof(v_item->'unit_code') <> 'string'
      OR jsonb_typeof(v_item->'price') <> 'number'
      OR jsonb_typeof(v_item->'currency') <> 'string'
      OR jsonb_typeof(v_item->'price_source') <> 'string'
      OR jsonb_typeof(v_item->'source_file') NOT IN ('string', 'null')
      OR jsonb_typeof(v_item->'source_page') NOT IN ('number', 'null')
      OR jsonb_typeof(v_item->'price_list_date') NOT IN ('string', 'null')
      OR jsonb_typeof(v_item->'recorded_at') <> 'string'
      OR jsonb_typeof(v_item->'metadata') <> 'object'
    THEN
      RAISE EXCEPTION 'forever_import_execution: request_invalid_field';
    END IF;
  END LOOP;
  SELECT count(*) INTO v_count FROM jsonb_array_elements(v_prices);
  SELECT count(*) INTO v_distinct FROM (
    SELECT DISTINCT value->>'unit_code', value->>'price_source', value->>'source_file',
      value->>'source_page', value->>'price_list_date'
    FROM jsonb_array_elements(v_prices)
  ) AS d;
  IF v_count <> v_distinct THEN
    RAISE EXCEPTION 'forever_import_execution: request_duplicate_persistence_key';
  END IF;

  -- ----- Unsafe paths and credential material --------------------------------
  IF forever_import.has_unsafe_source_file(request) THEN
    RAISE EXCEPTION 'forever_import_execution: request_unsafe_path';
  END IF;
  v_text := request::text;
  IF position('sb_secret_' in v_text) > 0
    OR position('sb_publishable_' in v_text) > 0
    OR position('eyJhbGciOi' in v_text) > 0
    OR position('postgres://' in v_text) > 0
    OR position('postgresql://' in v_text) > 0
    OR position('Bearer ' in v_text) > 0
    OR position('SUPABASE_' in v_text) > 0
  THEN
    RAISE EXCEPTION 'forever_import_execution: request_credential_material';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION forever_import.validate_import_request(JSONB) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Approval registration (issuance) — granted to NO role in this slice
-- ---------------------------------------------------------------------------
-- Receives the COMPLETE bounded approved request, validates it with the same
-- shared validator the execution path uses (fail closed on malformed payload,
-- unsupported property, payload/count mismatch, duplicate key, oversized
-- request, unsafe path, credential material, malformed fingerprint field),
-- extracts every scope column from the request itself (no separately supplied
-- scope can disagree with the body), stores the immutable canonical body, and
-- computes and stores its digest INSIDE PostgreSQL. TypeScript-side, approval
-- issuance additionally recomputes the domain-separated request fingerprint
-- and fails closed on mismatch before ever calling this function; the
-- server-side binding below never relies on that client fingerprint.

CREATE OR REPLACE FUNCTION forever_import.register_import_approval(
  p_issued_at TIMESTAMPTZ,
  p_expires_at TIMESTAMPTZ,
  p_request JSONB
) RETURNS UUID
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_id UUID;
BEGIN
  PERFORM forever_import.validate_import_request(p_request);

  -- Table CHECK constraints additionally enforce formats, bounds, lifetime,
  -- and the column↔body binding; the unique digest index enforces one
  -- registration per approval.
  BEGIN
    INSERT INTO forever_import.import_execution_approvals (
      approval_digest, project_slug, target, target_project_id, plan_hash,
      collision_report_fingerprint, operation_count, approved_request,
      approved_request_digest, issued_at, expires_at
    ) VALUES (
      p_request->>'approvalDigest',
      p_request->>'projectSlug',
      p_request->>'target',
      p_request->>'targetProjectId',
      p_request->>'planHash',
      p_request->>'collisionReportFingerprint',
      (p_request->'operationCounts'->>'operations')::INTEGER,
      p_request,
      forever_import.request_digest(p_request),
      p_issued_at,
      p_expires_at
    ) RETURNING id INTO v_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'forever_import_execution: approval_already_registered';
  END;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION forever_import.register_import_approval(
  TIMESTAMPTZ, TIMESTAMPTZ, JSONB
) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Internal atomic execution function (not callable by any non-owner role)
-- ---------------------------------------------------------------------------
-- Runs entirely inside the caller's single transaction. Every failure path is
-- a static RAISE with a stable machine-readable reason code and no dynamic
-- content beyond that code, so no SQL text, row data, or identifier detail
-- can leak through an error surface. Any raise rolls back approval
-- consumption, all writes, and the receipt together.
--
-- Approved-request binding order (review blocker 1): the incoming request is
-- compared against the stored immutable approved request — full structural
-- jsonb equality plus a PostgreSQL-recomputed digest comparison — BEFORE the
-- durable approval CAS and before any entity write. A tampered payload is
-- rejected with `approval_request_mismatch` having consumed nothing and
-- written nothing.

CREATE OR REPLACE FUNCTION forever_import.run_approved_import(request JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_counts JSONB;
  v_entities JSONB;
  v_project JSONB;
  v_buildings JSONB;
  v_units JSONB;
  v_prices JSONB;
  v_item JSONB;
  v_approval forever_import.import_execution_approvals%ROWTYPE;
  v_execution_id UUID;
  v_project_slug TEXT;
  v_target TEXT;
  v_target_project_id TEXT;
  v_plan_hash TEXT;
  v_collision_fingerprint TEXT;
  v_approval_digest TEXT;
  v_expected_projects INTEGER;
  v_expected_buildings INTEGER;
  v_expected_units INTEGER;
  v_expected_prices INTEGER;
  v_expected_operations INTEGER;
  v_count INTEGER;
  v_distinct INTEGER;
  v_developer_id UUID;
  v_location_id UUID;
  v_project_id UUID;
  v_building_ids JSONB := '{}'::jsonb;
  v_unit_ids JSONB := '{}'::jsonb;
  v_id UUID;
  v_building_id UUID;
  v_unit_id UUID;
  v_code TEXT;
  v_row_project public.projects%ROWTYPE;
  v_row_building public.buildings%ROWTYPE;
  v_row_unit public.units%ROWTYPE;
  v_row_price public.unit_price_history%ROWTYPE;
  v_writes INTEGER := 0;
BEGIN
  -- ----- Full shared validation (same rules as approval registration) ------
  PERFORM forever_import.validate_import_request(request);

  v_project_slug := request->>'projectSlug';
  v_target := request->>'target';
  v_target_project_id := request->>'targetProjectId';
  v_plan_hash := request->>'planHash';
  v_collision_fingerprint := request->>'collisionReportFingerprint';
  v_approval_digest := request->>'approvalDigest';
  v_counts := request->'operationCounts';
  v_expected_projects := (v_counts->>'projects')::INTEGER;
  v_expected_buildings := (v_counts->>'buildings')::INTEGER;
  v_expected_units := (v_counts->>'units')::INTEGER;
  v_expected_prices := (v_counts->>'priceHistoryRows')::INTEGER;
  v_expected_operations := (v_counts->>'operations')::INTEGER;
  v_entities := request->'entities';
  v_project := v_entities->'project';
  v_buildings := v_entities->'buildings';
  v_units := v_entities->'units';
  v_prices := v_entities->'priceHistory';

  -- ----- Approved-request binding (BEFORE any durable consumption) ----------
  SELECT * INTO v_approval FROM forever_import.import_execution_approvals
    WHERE approval_digest = v_approval_digest;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forever_import_execution: approval_unknown';
  END IF;
  IF v_approval.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'forever_import_execution: approval_already_consumed';
  END IF;

  -- Temporal validity against DATABASE time only, before consumption; an
  -- expired approval is never burned.
  IF now() < v_approval.issued_at THEN
    RAISE EXCEPTION 'forever_import_execution: approval_not_yet_valid';
  END IF;
  IF now() >= v_approval.expires_at THEN
    RAISE EXCEPTION 'forever_import_execution: approval_expired';
  END IF;

  -- Exact scope binding, field by field (the CHECK constraints already bind
  -- these columns to the stored body; this re-checks against the request).
  IF v_approval.project_slug IS DISTINCT FROM v_project_slug
    OR v_approval.target IS DISTINCT FROM v_target
    OR v_approval.target_project_id IS DISTINCT FROM v_target_project_id
    OR v_approval.plan_hash IS DISTINCT FROM v_plan_hash
    OR v_approval.collision_report_fingerprint IS DISTINCT FROM v_collision_fingerprint
    OR v_approval.operation_count IS DISTINCT FROM v_expected_operations
  THEN
    RAISE EXCEPTION 'forever_import_execution: approval_scope_mismatch';
  END IF;

  -- The executed payload must BE the Owner-approved payload: full structural
  -- equality (covers every entity and field, array order, counts, digests,
  -- schema version, and the request fingerprint field itself), plus an
  -- independent PostgreSQL-recomputed digest comparison. A self-consistent
  -- client-side fingerprint proves nothing here.
  IF request IS DISTINCT FROM v_approval.approved_request THEN
    RAISE EXCEPTION 'forever_import_execution: approval_request_mismatch';
  END IF;
  IF forever_import.request_digest(request)
    IS DISTINCT FROM v_approval.approved_request_digest
  THEN
    RAISE EXCEPTION 'forever_import_execution: approval_request_mismatch';
  END IF;

  -- ----- Atomic approval consumption (same transaction as all writes) ------
  v_execution_id := gen_random_uuid();

  UPDATE forever_import.import_execution_approvals
    SET consumed_at = now(), execution_id = v_execution_id
    WHERE approval_digest = v_approval_digest AND consumed_at IS NULL
    RETURNING * INTO v_approval;
  IF NOT FOUND THEN
    -- Lost a concurrent race after the read above; exactly one winner exists.
    RAISE EXCEPTION 'forever_import_execution: approval_already_consumed';
  END IF;

  -- ----- Repeat-import boundary -------------------------------------------
  SELECT count(*) INTO v_count FROM forever_import.import_execution_receipts
    WHERE project_slug = v_project_slug AND plan_hash = v_plan_hash;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'forever_import_execution: plan_already_executed';
  END IF;

  -- ----- Fresh-state verification inside the transaction -------------------
  -- The earlier client-side collision report is never trusted alone. The
  -- project anchor row must still be absent; because every child row is
  -- keyed under the fresh project id created below, building natural keys,
  -- unit natural keys, and price-history persistence keys are structurally
  -- absent whenever the anchor is absent, and the post-write verification
  -- re-proves exact counts and uniqueness before commit.
  SELECT count(*) INTO v_count FROM public.projects WHERE slug = v_project_slug;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'forever_import_execution: target_state_changed';
  END IF;

  -- ----- Dependencies (never written by execution) --------------------------
  SELECT count(*) INTO v_count FROM public.developers
    WHERE slug = v_project->>'developer_slug';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'forever_import_execution: dependency_developer_unresolved';
  END IF;
  SELECT id INTO v_developer_id FROM public.developers
    WHERE slug = v_project->>'developer_slug';

  SELECT count(*) INTO v_count FROM public.locations
    WHERE slug = v_project->>'location_slug';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'forever_import_execution: dependency_location_unresolved';
  END IF;
  SELECT id INTO v_location_id FROM public.locations
    WHERE slug = v_project->>'location_slug';

  -- ----- Writes in canonical dependency order -------------------------------
  INSERT INTO public.projects (
    slug, name, developer_id, location_id, project_code, project_type,
    location_area, address, short_description, full_description, is_active,
    public_status, sales_status
  ) VALUES (
    v_project->>'slug', v_project->>'name', v_developer_id, v_location_id,
    v_project->>'project_code', v_project->>'project_type',
    v_project->>'location_area', v_project->>'address',
    v_project->>'short_description', v_project->>'full_description',
    (v_project->>'is_active')::BOOLEAN, v_project->>'public_status',
    v_project->>'sales_status'
  ) RETURNING id INTO v_project_id;
  v_writes := v_writes + 1;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(v_buildings) WITH ORDINALITY ORDER BY ordinality
  LOOP
    INSERT INTO public.buildings (
      project_id, name, building_code, building_type, floors_count, units_count, metadata
    ) VALUES (
      v_project_id, v_item->>'name', v_item->>'building_code', v_item->>'building_type',
      (v_item->>'floors_count')::INTEGER, (v_item->>'units_count')::INTEGER,
      v_item->'metadata'
    ) RETURNING id INTO v_id;
    v_building_ids := jsonb_set(
      v_building_ids, ARRAY[v_item->>'building_code'], to_jsonb(v_id::TEXT), true
    );
    v_writes := v_writes + 1;
  END LOOP;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(v_units) WITH ORDINALITY ORDER BY ordinality
  LOOP
    v_code := v_item->>'building_code';
    IF v_code IS NULL THEN
      v_building_id := NULL;
    ELSE
      IF v_building_ids->>v_code IS NULL THEN
        RAISE EXCEPTION 'forever_import_execution: missing_parent_reference';
      END IF;
      v_building_id := (v_building_ids->>v_code)::UUID;
    END IF;
    INSERT INTO public.units (
      project_id, building_id, unit_code, unit_type, bedrooms, bathrooms, size_sqm,
      floor, base_price_thb, price_per_sqm, availability_status, unit_status, metadata
    ) VALUES (
      v_project_id, v_building_id, v_item->>'unit_code', v_item->>'unit_type',
      (v_item->>'bedrooms')::INTEGER, (v_item->>'bathrooms')::INTEGER,
      (v_item->>'size_sqm')::NUMERIC, (v_item->>'floor')::INTEGER,
      (v_item->>'base_price_thb')::NUMERIC, (v_item->>'price_per_sqm')::NUMERIC,
      v_item->>'availability_status', v_item->>'unit_status', v_item->'metadata'
    ) RETURNING id INTO v_id;
    v_unit_ids := jsonb_set(
      v_unit_ids, ARRAY[v_item->>'unit_code'], to_jsonb(v_id::TEXT), true
    );
    v_writes := v_writes + 1;
  END LOOP;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(v_prices) WITH ORDINALITY ORDER BY ordinality
  LOOP
    v_code := v_item->>'unit_code';
    IF v_unit_ids->>v_code IS NULL THEN
      RAISE EXCEPTION 'forever_import_execution: missing_parent_reference';
    END IF;
    v_unit_id := (v_unit_ids->>v_code)::UUID;
    INSERT INTO public.unit_price_history (
      unit_id, price, currency, price_source, source_file, source_page,
      price_list_date, recorded_at, metadata
    ) VALUES (
      v_unit_id, (v_item->>'price')::NUMERIC, v_item->>'currency',
      v_item->>'price_source', v_item->>'source_file',
      (v_item->>'source_page')::INTEGER, (v_item->>'price_list_date')::DATE,
      (v_item->>'recorded_at')::TIMESTAMPTZ, v_item->'metadata'
    );
    v_writes := v_writes + 1;
  END LOOP;

  IF v_writes <> v_expected_operations THEN
    RAISE EXCEPTION 'forever_import_execution: verification_count_mismatch';
  END IF;

  -- ----- Verification before commit -----------------------------------------
  -- Every persisted row is re-read and compared against the approved request.
  -- Any discrepancy aborts the whole transaction.

  -- Project: exactly one row, exact stable fields, exact relationships.
  SELECT count(*) INTO v_count FROM public.projects WHERE slug = v_project_slug;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'forever_import_execution: verification_row_missing';
  END IF;
  IF v_count > 1 THEN
    RAISE EXCEPTION 'forever_import_execution: verification_duplicate_persistence_key';
  END IF;
  SELECT * INTO v_row_project FROM public.projects WHERE slug = v_project_slug;
  IF v_row_project.id IS DISTINCT FROM v_project_id THEN
    RAISE EXCEPTION 'forever_import_execution: verification_parent_mismatch';
  END IF;
  IF v_row_project.developer_id IS DISTINCT FROM v_developer_id
    OR v_row_project.location_id IS DISTINCT FROM v_location_id
  THEN
    RAISE EXCEPTION 'forever_import_execution: verification_parent_mismatch';
  END IF;
  IF v_row_project.name IS DISTINCT FROM v_project->>'name'
    OR v_row_project.project_code IS DISTINCT FROM v_project->>'project_code'
    OR v_row_project.project_type IS DISTINCT FROM v_project->>'project_type'
    OR v_row_project.location_area IS DISTINCT FROM v_project->>'location_area'
    OR v_row_project.address IS DISTINCT FROM v_project->>'address'
    OR v_row_project.short_description IS DISTINCT FROM v_project->>'short_description'
    OR v_row_project.full_description IS DISTINCT FROM v_project->>'full_description'
    OR v_row_project.is_active IS DISTINCT FROM (v_project->>'is_active')::BOOLEAN
    OR v_row_project.public_status IS DISTINCT FROM v_project->>'public_status'
    OR v_row_project.sales_status IS DISTINCT FROM v_project->>'sales_status'
  THEN
    RAISE EXCEPTION 'forever_import_execution: verification_field_mismatch';
  END IF;

  -- Buildings: exact count, unique codes, exact fields, exact parent.
  SELECT count(*) INTO v_count FROM public.buildings WHERE project_id = v_project_id;
  IF v_count < v_expected_buildings THEN
    RAISE EXCEPTION 'forever_import_execution: verification_row_missing';
  END IF;
  IF v_count > v_expected_buildings THEN
    RAISE EXCEPTION 'forever_import_execution: verification_extra_rows';
  END IF;
  SELECT count(DISTINCT building_code) INTO v_distinct
    FROM public.buildings WHERE project_id = v_project_id;
  IF v_distinct <> v_expected_buildings THEN
    RAISE EXCEPTION 'forever_import_execution: verification_duplicate_persistence_key';
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_buildings)
  LOOP
    SELECT * INTO v_row_building FROM public.buildings
      WHERE project_id = v_project_id AND building_code = v_item->>'building_code';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'forever_import_execution: verification_row_missing';
    END IF;
    IF v_row_building.id::TEXT IS DISTINCT FROM v_building_ids->>(v_item->>'building_code') THEN
      RAISE EXCEPTION 'forever_import_execution: verification_parent_mismatch';
    END IF;
    IF v_row_building.name IS DISTINCT FROM v_item->>'name'
      OR v_row_building.building_type IS DISTINCT FROM v_item->>'building_type'
      OR v_row_building.floors_count IS DISTINCT FROM (v_item->>'floors_count')::INTEGER
      OR v_row_building.units_count IS DISTINCT FROM (v_item->>'units_count')::INTEGER
      OR v_row_building.metadata IS DISTINCT FROM v_item->'metadata'
    THEN
      RAISE EXCEPTION 'forever_import_execution: verification_field_mismatch';
    END IF;
  END LOOP;

  -- Units: exact count, unique codes, exact fields, exact parents.
  SELECT count(*) INTO v_count FROM public.units WHERE project_id = v_project_id;
  IF v_count < v_expected_units THEN
    RAISE EXCEPTION 'forever_import_execution: verification_row_missing';
  END IF;
  IF v_count > v_expected_units THEN
    RAISE EXCEPTION 'forever_import_execution: verification_extra_rows';
  END IF;
  SELECT count(DISTINCT unit_code) INTO v_distinct
    FROM public.units WHERE project_id = v_project_id;
  IF v_distinct <> v_expected_units THEN
    RAISE EXCEPTION 'forever_import_execution: verification_duplicate_persistence_key';
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_units)
  LOOP
    SELECT * INTO v_row_unit FROM public.units
      WHERE project_id = v_project_id AND unit_code = v_item->>'unit_code';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'forever_import_execution: verification_row_missing';
    END IF;
    IF v_row_unit.id::TEXT IS DISTINCT FROM v_unit_ids->>(v_item->>'unit_code') THEN
      RAISE EXCEPTION 'forever_import_execution: verification_parent_mismatch';
    END IF;
    IF v_item->>'building_code' IS NULL THEN
      IF v_row_unit.building_id IS NOT NULL THEN
        RAISE EXCEPTION 'forever_import_execution: verification_parent_mismatch';
      END IF;
    ELSE
      IF v_row_unit.building_id::TEXT
        IS DISTINCT FROM v_building_ids->>(v_item->>'building_code')
      THEN
        RAISE EXCEPTION 'forever_import_execution: verification_parent_mismatch';
      END IF;
    END IF;
    IF v_row_unit.unit_type IS DISTINCT FROM v_item->>'unit_type'
      OR v_row_unit.bedrooms IS DISTINCT FROM (v_item->>'bedrooms')::INTEGER
      OR v_row_unit.bathrooms IS DISTINCT FROM (v_item->>'bathrooms')::INTEGER
      OR v_row_unit.size_sqm IS DISTINCT FROM (v_item->>'size_sqm')::NUMERIC
      OR v_row_unit.floor IS DISTINCT FROM (v_item->>'floor')::INTEGER
      OR v_row_unit.base_price_thb IS DISTINCT FROM (v_item->>'base_price_thb')::NUMERIC
      OR v_row_unit.price_per_sqm IS DISTINCT FROM (v_item->>'price_per_sqm')::NUMERIC
      OR v_row_unit.availability_status IS DISTINCT FROM v_item->>'availability_status'
      OR v_row_unit.unit_status IS DISTINCT FROM v_item->>'unit_status'
      OR v_row_unit.metadata IS DISTINCT FROM v_item->'metadata'
    THEN
      RAISE EXCEPTION 'forever_import_execution: verification_field_mismatch';
    END IF;
  END LOOP;

  -- Price history: exact count per fresh unit set, unique persistence keys,
  -- exact fields, exact parent unit.
  SELECT count(*) INTO v_count FROM public.unit_price_history h
    WHERE h.unit_id IN (SELECT u.id FROM public.units u WHERE u.project_id = v_project_id);
  IF v_count < v_expected_prices THEN
    RAISE EXCEPTION 'forever_import_execution: verification_row_missing';
  END IF;
  IF v_count > v_expected_prices THEN
    RAISE EXCEPTION 'forever_import_execution: verification_extra_rows';
  END IF;
  SELECT count(*) INTO v_distinct FROM (
    SELECT DISTINCT h.unit_id, h.price_source, h.source_file, h.source_page, h.price_list_date
    FROM public.unit_price_history h
    WHERE h.unit_id IN (SELECT u.id FROM public.units u WHERE u.project_id = v_project_id)
  ) AS d;
  IF v_distinct <> v_expected_prices THEN
    RAISE EXCEPTION 'forever_import_execution: verification_duplicate_persistence_key';
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_prices)
  LOOP
    v_unit_id := (v_unit_ids->>(v_item->>'unit_code'))::UUID;
    SELECT count(*) INTO v_count FROM public.unit_price_history h
      WHERE h.unit_id = v_unit_id
        AND h.price_source IS NOT DISTINCT FROM v_item->>'price_source'
        AND h.source_file IS NOT DISTINCT FROM v_item->>'source_file'
        AND h.source_page IS NOT DISTINCT FROM (v_item->>'source_page')::INTEGER
        AND h.price_list_date IS NOT DISTINCT FROM (v_item->>'price_list_date')::DATE;
    IF v_count = 0 THEN
      RAISE EXCEPTION 'forever_import_execution: verification_row_missing';
    END IF;
    IF v_count > 1 THEN
      RAISE EXCEPTION 'forever_import_execution: verification_duplicate_persistence_key';
    END IF;
    SELECT * INTO v_row_price FROM public.unit_price_history h
      WHERE h.unit_id = v_unit_id
        AND h.price_source IS NOT DISTINCT FROM v_item->>'price_source'
        AND h.source_file IS NOT DISTINCT FROM v_item->>'source_file'
        AND h.source_page IS NOT DISTINCT FROM (v_item->>'source_page')::INTEGER
        AND h.price_list_date IS NOT DISTINCT FROM (v_item->>'price_list_date')::DATE;
    IF v_row_price.price IS DISTINCT FROM (v_item->>'price')::NUMERIC
      OR v_row_price.currency IS DISTINCT FROM v_item->>'currency'
      OR v_row_price.recorded_at IS DISTINCT FROM (v_item->>'recorded_at')::TIMESTAMPTZ
      OR v_row_price.metadata IS DISTINCT FROM v_item->'metadata'
    THEN
      RAISE EXCEPTION 'forever_import_execution: verification_field_mismatch';
    END IF;
  END LOOP;

  -- ----- Durable receipt (same transaction) ---------------------------------
  INSERT INTO forever_import.import_execution_receipts (
    execution_id, approval_digest, approved_request_digest, project_slug, target,
    target_project_id, plan_hash, collision_report_fingerprint, projects_written,
    buildings_written, units_written, price_history_rows_written, writes_performed,
    outcome
  ) VALUES (
    v_execution_id, v_approval_digest, v_approval.approved_request_digest,
    v_project_slug, v_target, v_target_project_id, v_plan_hash,
    v_collision_fingerprint, v_expected_projects, v_expected_buildings,
    v_expected_units, v_expected_prices, v_writes, 'committed'
  );

  -- ----- Single typed sanitized result --------------------------------------
  -- Contains only display-safe identifiers, digests, counts, and confirmations
  -- — no SQL, no rows, no credentials, no raw approval id, no provider detail.
  RETURN jsonb_build_object(
    'schemaVersion', '1',
    'outcome', 'committed',
    'executionId', v_execution_id::TEXT,
    'approvalDigest', v_approval_digest,
    'requestFingerprint', request->>'requestFingerprint',
    'projectSlug', v_project_slug,
    'target', v_target,
    'targetProjectId', v_target_project_id,
    'planHash', v_plan_hash,
    'collisionReportFingerprint', v_collision_fingerprint,
    'operationCounts', jsonb_build_object(
      'projects', v_expected_projects,
      'buildings', v_expected_buildings,
      'units', v_expected_units,
      'priceHistoryRows', v_expected_prices,
      'operations', v_expected_operations
    ),
    'writesPerformed', v_writes,
    'commitConfirmed', true
  );
END;
$$;

REVOKE ALL ON FUNCTION forever_import.run_approved_import(JSONB) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Dedicated closed execution schema and the ONLY callable execution surface
-- ---------------------------------------------------------------------------
-- The external wrapper lives in its OWN schema `forever_execution`, NOT in
-- `public`. This dedicated closed schema is the primary isolation boundary and
-- does NOT rely on the wrapper being in `public` (it is not) nor on the executor
-- lacking `public` USAGE: `forever_execution` is closed to PUBLIC completely and
-- its default function EXECUTE for PUBLIC is reversed, so no PUBLIC-derived
-- EXECUTE ever lands on the wrapper and a future accidental function in the
-- schema cannot silently become PUBLIC-executable. The executor is granted USAGE
-- on `forever_execution` plus EXECUTE on this one wrapper, and nothing else in
-- the schema. NOTE: the executor MAY still hold PUBLIC-derived USAGE on `public`
-- (a stock database grants `public` USAGE to PUBLIC, and a direct REVOKE cannot
-- remove that); the effective-privilege & PUBLIC-ACL audit classifies any such
-- reachable `public` access explicitly before live execution is permitted. The
-- wrapper's isolation does not depend on that reconciliation.

CREATE SCHEMA IF NOT EXISTS forever_execution;
REVOKE ALL ON SCHEMA forever_execution FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA forever_execution REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA forever_execution REVOKE ALL ON TABLES FROM PUBLIC;

CREATE OR REPLACE FUNCTION forever_execution.forever_execute_approved_import(request JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STRICT
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF jsonb_typeof(request) <> 'object' THEN
    RAISE EXCEPTION 'forever_import_execution: request_malformed';
  END IF;
  IF pg_column_size(request) > 4194304 THEN
    RAISE EXCEPTION 'forever_import_execution: request_too_large';
  END IF;
  RETURN forever_import.run_approved_import(request);
END;
$$;

-- Reverse PostgreSQL's default PUBLIC EXECUTE on the wrapper, and defensively
-- revoke every API-facing role. The wrapper is reachable ONLY by the dedicated
-- executor below.
REVOKE ALL ON FUNCTION forever_execution.forever_execute_approved_import(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION forever_execution.forever_execute_approved_import(JSONB) FROM anon;
REVOKE ALL ON FUNCTION forever_execution.forever_execute_approved_import(JSONB) FROM authenticated;
-- service_role is deliberately NOT an execution principal: it already holds
-- broad direct table privileges, so the wrapper would narrow nothing. Revoke
-- defensively even though it was never granted.
REVOKE ALL ON FUNCTION forever_execution.forever_execute_approved_import(JSONB) FROM service_role;

-- ---------------------------------------------------------------------------
-- Least-privilege execution principal: grants and explicit revocations
-- ---------------------------------------------------------------------------
-- The dedicated executor's two DIRECT grants are exactly: USAGE on the dedicated
-- `forever_execution` schema and EXECUTE on the single SECURITY DEFINER wrapper.
-- It is granted NO direct USAGE on `public`, NO direct USAGE on the private
-- `forever_import` schema, and no other grant anywhere. This does NOT by itself
-- guarantee the executor lacks EFFECTIVE `public` USAGE — a stock database grants
-- USAGE on `public` to PUBLIC, and every role is implicitly part of PUBLIC — so
-- the effective public-schema access is determined only by the effective-
-- privilege audit against the real target (option B: a PUBLIC-derived public
-- USAGE blocks readiness pending a separate Owner-approved reconciliation).
GRANT USAGE ON SCHEMA forever_execution TO forever_import_executor;
GRANT EXECUTE ON FUNCTION forever_execution.forever_execute_approved_import(JSONB)
  TO forever_import_executor;

-- Everything below is DEFENSIVE HYGIENE: it strips any DIRECT grant the executor
-- might hold on the target tables, the durable approval/receipt storage, the
-- public or private schemas, or the internal functions — even against a future
-- accidental grant. These REVOKEs are idempotent. CRUCIALLY, a direct REVOKE
-- from the executor does NOT override a grant made to PUBLIC: PostgreSQL
-- effective privileges are the union of direct, inherited, and PUBLIC grants, so
-- `REVOKE ALL ON SCHEMA public FROM forever_import_executor` does NOT remove a
-- PUBLIC-derived USAGE on `public`. This migration deliberately does NOT run a
-- global `REVOKE USAGE ON SCHEMA public FROM PUBLIC` (that would affect existing
-- Supabase / PostgREST / website / migration behavior and needs a separate
-- impact audit and Owner decision). The executor's actual effective privileges
-- — including any inherited through PUBLIC — are proven only by the effective-
-- privilege & PUBLIC-ACL audit at the future migration-application checkpoint.
REVOKE ALL ON SCHEMA public FROM forever_import_executor;
REVOKE ALL ON public.projects FROM forever_import_executor;
REVOKE ALL ON public.buildings FROM forever_import_executor;
REVOKE ALL ON public.units FROM forever_import_executor;
REVOKE ALL ON public.unit_price_history FROM forever_import_executor;
REVOKE ALL ON forever_import.import_execution_approvals FROM forever_import_executor;
REVOKE ALL ON forever_import.import_execution_receipts FROM forever_import_executor;
REVOKE ALL ON SCHEMA forever_import FROM forever_import_executor;
REVOKE ALL ON FUNCTION forever_import.register_import_approval(TIMESTAMPTZ, TIMESTAMPTZ, JSONB)
  FROM forever_import_executor;
REVOKE ALL ON FUNCTION forever_import.run_approved_import(JSONB) FROM forever_import_executor;
REVOKE ALL ON FUNCTION forever_import.validate_import_request(JSONB) FROM forever_import_executor;
REVOKE ALL ON FUNCTION forever_import.request_digest(JSONB) FROM forever_import_executor;
REVOKE ALL ON FUNCTION forever_import.has_unsafe_source_file(JSONB) FROM forever_import_executor;

-- ---------------------------------------------------------------------------
-- Execution-boundary ownership and the exact target-capability allowlist
-- ---------------------------------------------------------------------------
-- Bind the whole execution chain to the dedicated `forever_import_execution_owner`
-- role. Every EXACT RC5.5D boundary object — the two boundary schemas, the two
-- durable tables, and the six routines (the external wrapper + five internal
-- routines) — is reassigned to that owner, so the SECURITY DEFINER transition
-- lands on a narrow dedicated identity, never `postgres` / `service_role` / a
-- platform role. Ordering matters: the SCHEMAS are reassigned first, so the new
-- owner holds CREATE on them, which PostgreSQL requires before the contained
-- tables and routines can be reassigned. Every GRANT above already ran while the
-- migration role still owned these objects, and grants survive an ownership
-- change, so reassigning ownership last is safe. No UNRELATED object is touched:
-- the existing target/application tables keep their current owners and are only
-- GRANTed the exact privileges below.
ALTER SCHEMA forever_import OWNER TO forever_import_execution_owner;
ALTER SCHEMA forever_execution OWNER TO forever_import_execution_owner;

ALTER TABLE forever_import.import_execution_approvals OWNER TO forever_import_execution_owner;
ALTER TABLE forever_import.import_execution_receipts OWNER TO forever_import_execution_owner;

ALTER FUNCTION forever_import.request_digest(JSONB)
  OWNER TO forever_import_execution_owner;
ALTER FUNCTION forever_import.has_unsafe_source_file(JSONB)
  OWNER TO forever_import_execution_owner;
ALTER FUNCTION forever_import.validate_import_request(JSONB)
  OWNER TO forever_import_execution_owner;
ALTER FUNCTION forever_import.register_import_approval(TIMESTAMPTZ, TIMESTAMPTZ, JSONB)
  OWNER TO forever_import_execution_owner;
ALTER FUNCTION forever_import.run_approved_import(JSONB)
  OWNER TO forever_import_execution_owner;
ALTER FUNCTION forever_execution.forever_execute_approved_import(JSONB)
  OWNER TO forever_import_execution_owner;

-- Exact target-capability allowlist for the execution owner. Because the wrapper
-- runs as this owner, these are the ONLY privileges the bounded import can use on
-- pre-existing objects. USAGE on `public` is needed to resolve the fully-qualified
-- target tables (the routines pin `search_path = ''` and schema-qualify every
-- reference). The two dependency tables are read-only (SELECT); the four import
-- tables are SELECT (fresh-state + verification reads) and INSERT (the writes) —
-- no UPDATE, DELETE, TRUNCATE, REFERENCES, or TRIGGER, and no sequence privilege
-- (every target table uses a UUID primary key, so no sequence participates in an
-- insert). The owner owns the durable approval/receipt tables outright, so it
-- needs no explicit grant on them.
GRANT USAGE ON SCHEMA public TO forever_import_execution_owner;
GRANT SELECT ON public.developers TO forever_import_execution_owner;
GRANT SELECT ON public.locations TO forever_import_execution_owner;
GRANT SELECT, INSERT ON public.projects TO forever_import_execution_owner;
GRANT SELECT, INSERT ON public.buildings TO forever_import_execution_owner;
GRANT SELECT, INSERT ON public.units TO forever_import_execution_owner;
GRANT SELECT, INSERT ON public.unit_price_history TO forever_import_execution_owner;

-- ---------------------------------------------------------------------------
-- Row-Level-Security operability for the execution owner (RC5.5D review 10)
-- ---------------------------------------------------------------------------
-- The six target tables have RLS ENABLED (not FORCED) with SELECT-only policies
-- and NO INSERT policy. The execution owner is NOBYPASSRLS and is deliberately
-- NOT the target-table owner, so under RLS it could neither read every row (the
-- existing SELECT policies filter on `is_active`) nor INSERT at all — the bounded
-- import would fail with a permission error even though every ACL grant is
-- present. The GRANTs above are necessary but NOT sufficient under RLS.
--
-- The narrowest secure correction: owner-scoped policies that apply to EXACTLY
-- `forever_import_execution_owner` and nothing else — SELECT on all six tables
-- (so the fresh-state and verification reads see every row, unfiltered) and
-- INSERT on the four import tables. NO UPDATE or DELETE policy. This does NOT
-- grant BYPASSRLS, does NOT make the owner a target-table owner, does NOT touch
-- `service_role`/`anon`/`authenticated`/`public`, and leaves every existing
-- policy for other roles unchanged.
--
-- Why the permissive `USING (true)` / `WITH CHECK (true)` predicate is SAFE here:
-- the owner is NOLOGIN with no committed password and is assumable ONLY through
-- the SECURITY DEFINER wrapper's definer transition. The wrapper validates the
-- ENTIRE request against the immutable Owner-approved request (approved-request
-- binding, exact structural + digest comparison, fresh-state re-check, and
-- per-row verification) BEFORE any write. Therefore the ONLY rows that can ever
-- be written as this role are the exact approved rows: the policy delegates
-- row-content validation to the sole possible writer, and role-scoping ensures no
-- other principal is affected. The predicate is the constant `true` — no helper
-- routine, no dynamic SQL, no session coupling, no drift risk.
--
-- DETERMINISTIC NORMALIZATION (RC5.5D review 11): a policy is a security
-- boundary, so its post-migration state must be EXACT, not merely present. An
-- `IF NOT EXISTS` guard would preserve a pre-existing SAME-NAME policy with
-- different semantics (wrong command, AS RESTRICTIVE, extra roles, PUBLIC,
-- `USING (false)`, a helper-function predicate, ALL instead of SELECT/INSERT),
-- leaving the boundary silently broken or broadened. Each RC5.5D-owned policy
-- name below is therefore DROPped (IF EXISTS) and re-CREATEd with its exact
-- intended definition. This is deterministic and idempotent: rerunning the
-- migration always converges on the identical ten policy definitions.
--   * Only the ten uniquely-named RC5.5D dedicated policies are dropped —
--     never an unrelated application policy (the existing public website
--     SELECT policies keep their names and are untouched).
--   * The names are per-table dedicated names, so a DROP can never span
--     tables, and DROP POLICY targets exactly one (name, table) pair.
--   * Authority: CREATE/DROP POLICY require table ownership. The migration
--     role (`postgres` on Supabase) owns the six pre-existing target tables
--     (created by earlier migrations under the same role), so both statements
--     are valid; target-table ownership is never transferred.
-- The runtime audit (effective-privilege-audit.ts) then proves the EXACT
-- post-migration definitions — name, table, command, PERMISSIVE, exact role
-- set (the owner only, never PUBLIC), and exact constant-true expressions —
-- and classifies every policy applicable to the owner on these six tables.

DROP POLICY IF EXISTS forever_import_owner_select_developers ON public.developers;
CREATE POLICY forever_import_owner_select_developers
  ON public.developers
  AS PERMISSIVE
  FOR SELECT
  TO forever_import_execution_owner
  USING (true);

DROP POLICY IF EXISTS forever_import_owner_select_locations ON public.locations;
CREATE POLICY forever_import_owner_select_locations
  ON public.locations
  AS PERMISSIVE
  FOR SELECT
  TO forever_import_execution_owner
  USING (true);

DROP POLICY IF EXISTS forever_import_owner_select_projects ON public.projects;
CREATE POLICY forever_import_owner_select_projects
  ON public.projects
  AS PERMISSIVE
  FOR SELECT
  TO forever_import_execution_owner
  USING (true);

DROP POLICY IF EXISTS forever_import_owner_select_buildings ON public.buildings;
CREATE POLICY forever_import_owner_select_buildings
  ON public.buildings
  AS PERMISSIVE
  FOR SELECT
  TO forever_import_execution_owner
  USING (true);

DROP POLICY IF EXISTS forever_import_owner_select_units ON public.units;
CREATE POLICY forever_import_owner_select_units
  ON public.units
  AS PERMISSIVE
  FOR SELECT
  TO forever_import_execution_owner
  USING (true);

DROP POLICY IF EXISTS forever_import_owner_select_unit_price_history ON public.unit_price_history;
CREATE POLICY forever_import_owner_select_unit_price_history
  ON public.unit_price_history
  AS PERMISSIVE
  FOR SELECT
  TO forever_import_execution_owner
  USING (true);

DROP POLICY IF EXISTS forever_import_owner_insert_projects ON public.projects;
CREATE POLICY forever_import_owner_insert_projects
  ON public.projects
  AS PERMISSIVE
  FOR INSERT
  TO forever_import_execution_owner
  WITH CHECK (true);

DROP POLICY IF EXISTS forever_import_owner_insert_buildings ON public.buildings;
CREATE POLICY forever_import_owner_insert_buildings
  ON public.buildings
  AS PERMISSIVE
  FOR INSERT
  TO forever_import_execution_owner
  WITH CHECK (true);

DROP POLICY IF EXISTS forever_import_owner_insert_units ON public.units;
CREATE POLICY forever_import_owner_insert_units
  ON public.units
  AS PERMISSIVE
  FOR INSERT
  TO forever_import_execution_owner
  WITH CHECK (true);

DROP POLICY IF EXISTS forever_import_owner_insert_unit_price_history ON public.unit_price_history;
CREATE POLICY forever_import_owner_insert_unit_price_history
  ON public.unit_price_history
  AS PERMISSIVE
  FOR INSERT
  TO forever_import_execution_owner
  WITH CHECK (true);

-- Default privileges must never later broaden the executor: the schema-level
-- ALTER DEFAULT PRIVILEGES revocations (for both forever_import and
-- forever_execution) target PUBLIC, and no default privilege anywhere grants
-- the executor anything. It is a member of no role (no
-- `GRANT <role> TO forever_import_executor`), so it inherits nothing from
-- another role. It MAY still hold PUBLIC-derived privileges on `public` objects
-- (see above) — whether it does, and whether any such privilege is reachable and
-- dangerous, is determined only by the effective-privilege & PUBLIC-ACL audit —
-- the wrapper's isolation stands regardless, because the wrapper is in the
-- closed `forever_execution` schema, not `public`.
