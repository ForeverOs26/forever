-- =====================================================================
-- FOREVER CRM — SLICE 0: MEASURED READ-ONLY LEAD BASELINE
-- =====================================================================
--
-- Task ID:   FOREVER-CRM-SLICE0-MEASURED-BASELINE-001
--            corrected by FOREVER-CRM-SLICE0-CORRECTION-001
-- Authority: docs/crm/CRM_FINAL_RECOMMENDATION.md §3 "Slice 0 — evidence,
--            not code"; docs/crm/FOREVER_CRM_INDEX.md "What to build first".
-- Risk:      none — this file is not code, creates nothing, and writes nothing.
--
-- WHAT THIS IS
-- ------------
-- The canonical CRM architecture (merged PR #122) requires that Forever
-- *counts* its existing enquiries before it builds anything to hold them.
-- docs/ROADMAP.md:228 gates the build-versus-buy decision on "lead volume
-- exceeds the simple internal workflow" — a trigger that cannot be evaluated,
-- because public.leads has one INSERT policy, no SELECT policy, and no code in
-- the repository ever reads a lead back. This script produces that number.
--
-- WHAT THIS IS NOT
-- ----------------
-- It creates no table, no migration, no view, no function, no temporary object
-- and no sequence. It performs no INSERT, UPDATE, DELETE, UPSERT, MERGE,
-- TRUNCATE, ALTER, CREATE, DROP, GRANT, REVOKE or COMMENT. It is Slice 0 only
-- and implements no part of Slice 1 or any later CRM phase.
--
-- WHAT A RESULT FROM THIS SCRIPT DOES AND DOES NOT PROVE
-- ------------------------------------------------------
-- This script measures the CURRENT CONTENTS of public.leads at the moment it
-- runs. That is the entire scope of its evidence.
--
-- A total of zero therefore supports exactly one statement:
--
--   "At the time of this read-only measurement, production public.leads
--    contained zero rows."
--
-- It does NOT prove that no lead was ever submitted, that no lead was ever
-- stored, that historical rows were never deleted, that production capture
-- definitely failed, or that another former environment was never used. This
-- script reads no audit log, no WAL history and no deleted row, and it cannot.
--
-- The only conclusion it licenses is:
--
--   "The current production table contains no evidence of retained leads, so
--    end-to-end capture remains unproven and requires a separate controlled
--    test."
--
-- HOW TO RUN IT
-- -------------
--   Supabase SQL Editor : paste this entire file and run it.
--   Supabase CLI        : supabase db query --linked -f scripts/crm/crm-slice0-lead-baseline.sql
--
-- Both surfaces return only the FINAL result set, which is why every section
-- below is emitted as labelled rows of one consolidated query rather than as
-- ten separate statements. Filter with the `section` column.
--
-- SAFETY MODEL
-- ------------
-- The read-only guarantee is enforced IN-BAND by `SET TRANSACTION READ ONLY`
-- inside the transaction that runs the measurement — deliberately not by
-- PGOPTIONS, which the Supavisor pooler may discard. `transaction_read_only`
-- is re-read inside the same transaction and reported as evidence, and the
-- transaction ends in ROLLBACK. PostgreSQL rejects every write statement in
-- such a transaction, so this file is safe to paste into a production editor.
--
-- PRIVACY MODEL
-- -------------
-- public.leads holds names, emails, phone numbers and free-text messages.
-- This script emits AGGREGATE COUNTS ONLY. No name, email, phone, message,
-- country, budget, interest, id or timestamp of any individual lead is ever
-- selected as an output value. Personal columns are converted to booleans at
-- the first CTE boundary, so no raw personal value exists as a column anywhere
-- downstream. Normalized email appears in exactly one CTE (`email_groups`)
-- whose only output is a group size — no email value and no hash is emitted.
-- Aggregation happens inside PostgreSQL; no lead row leaves the database.
--
-- CLOSED REPORTING VOCABULARY — why `source` is never echoed
-- ----------------------------------------------------------
-- `source` is an unconstrained TEXT column at the database level: the migration
-- gives it a DEFAULT and NOT NULL, but no CHECK constraint. Any string a caller
-- can write can therefore be stored, including an email address, a phone
-- number, a URL or free text a guest typed. Echoing a stored `source` value
-- back as a group label would make this script a PII disclosure path.
--
-- So `source` is CATEGORISED, never echoed. Every emitted label comes from the
-- closed vocabulary below or from one of two fixed constants. The vocabulary is
-- derived from the repository, not invented:
--
--   contact_form    migration 20260704132000_create_leads.sql:13 (column DEFAULT),
--                   src/lib/lead-service.ts (fallback when no source is supplied),
--                   src/components/ContactForm.tsx (default prop)
--   contact_page    src/routes/contact.tsx
--   home_page       src/routes/index.tsx
--   booth           src/features/navigator/core/lead.ts (BOOTH_LEAD_SOURCE),
--                   pinned by src/features/navigator/core/lead.test.ts
--   project_detail  emitted by src/features/project-detail/components/
--                   ProjectContactCTA.tsx while that component was on main;
--                   RETIRED by commit 1577207 (merged PR #123). Retained in the
--                   vocabulary because rows written before that commit can
--                   still carry it.
--
-- Anything else becomes the fixed constant `Other / unknown source`. NULL or
-- blank becomes the fixed constant `(missing source)`. Suppression is applied
-- AFTER categorisation, so a small category is folded by count, never revealed
-- by label.
--
-- `status` is intended to be constrained — migration :22-24 is
-- CHECK (status IN ('new','contacted','qualified','closed','spam')) — so only
-- those five values are emitted. Any other live value, which would mean the
-- constraint was bypassed or changed, becomes `Other / unknown status` rather
-- than being echoed.
--
-- No production data is modified to achieve any of this. Categorisation happens
-- in the SELECT, on a read-only transaction that ends in ROLLBACK.
--
-- Grouped categories smaller than MIN_GROUP_SIZE (5) are never shown. They are
-- folded into `Other / suppressed`, and a fold-in bucket that is itself below
-- the floor reports `SUPPRESSED_LT_5` rather than a number.
--
-- CALENDAR PRIVACY
-- ----------------
-- The group-size floor applies to every calendar output consistently, so a
-- one-to-four-row table cannot reveal its month through an unsuppressed
-- summary while the grouped month output is suppressed:
--
--   total = 0        every calendar output is NOT_MEASURABLE_NO_DATA
--   total 1..4       every calendar output is SUPPRESSED_LT_5
--   total >= 5       exact month values are disclosed
--
-- HONESTY MODEL — counts, rates, schema gaps and suppression
-- -----------------------------------------------------------
-- These four are distinct and are not interchangeable:
--
--   * A FACTUAL COUNT may truthfully be numeric zero. `total_leads = 0`,
--     `months_containing_leads = 0` and `with_email = 0` are honest answers to
--     "how many", not evasions.
--   * A RATIO, RATE, VARIATION, DUPLICATION SIGNIFICANCE or BEHAVIORAL
--     CONCLUSION requires data. With no rows these return
--     `NOT_MEASURABLE_NO_DATA` — `email_completeness_rate` and
--     `duplicate_rate` have no value at a denominator of zero, and reporting
--     them as 0 would assert something the data does not say.
--   * A fact the CURRENT SCHEMA CANNOT SUPPORT returns
--     `NOT_MEASURABLE_FROM_CURRENT_SCHEMA` — never 0.
--   * A fact withheld by the group-size floor returns `SUPPRESSED_LT_5`.
--
-- OUTPUT SHAPE
-- ------------
--   section       one of the ten sections below
--   metric        what is being measured
--   label         the grouped category, where the section groups
--   value_num     the numeric answer, when the answer is a number
--   value_text    the textual answer, incl. the NOT_MEASURABLE_* / SUPPRESSED_* markers
--   pct_of_total  percentage of all leads, to two decimals, where meaningful
--   note          provenance or suppression note
--
-- SECTIONS
--   1 SAFETY_PROOF         6 BY_SOURCE
--   2 SCHEMA_SNAPSHOT      7 BY_STATUS
--   3 SECURITY_SNAPSHOT    8 DUPLICATION
--   4 LEAD_BASELINE        9 COMPLETENESS
--   5 BY_MONTH            10 CRM_READINESS
-- =====================================================================

BEGIN;
SET TRANSACTION READ ONLY;

-- Required in-band proof. Must print `on` before the measurement is trusted.
SHOW transaction_read_only;

WITH
-- ---------------------------------------------------------------------
-- Parameters. MIN_GROUP_SIZE is the k-anonymity floor for grouped output
-- and for every calendar output.
-- ---------------------------------------------------------------------
params AS (
  SELECT 5::bigint AS min_group_size
),

-- ---------------------------------------------------------------------
-- PRIVACY BOUNDARY. Every personal column becomes a boolean here and never
-- travels further as a value. `source` and `status` survive only as
-- normalized keys used to look up a fixed label; neither is ever emitted.
-- ---------------------------------------------------------------------
leads_norm AS (
  SELECT
    date_trunc('month', l.created_at)                  AS created_month,
    lower(NULLIF(btrim(l.source), ''))                 AS source_key,
    lower(NULLIF(btrim(l.status), ''))                 AS status_key,
    (l.created_at IS NOT NULL)                         AS has_created_at,
    (NULLIF(btrim(l.name), '')         IS NOT NULL)    AS has_name,
    (NULLIF(btrim(l.email), '')        IS NOT NULL)    AS has_email,
    (NULLIF(btrim(l.phone), '')        IS NOT NULL)    AS has_phone,
    (NULLIF(btrim(l.project_slug), '') IS NOT NULL)    AS has_project_ctx,
    (NULLIF(btrim(l.country), '')      IS NOT NULL)    AS has_country,
    (NULLIF(btrim(l.budget), '')       IS NOT NULL)    AS has_budget,
    (NULLIF(btrim(l.interest), '')     IS NOT NULL)    AS has_interest,
    (NULLIF(btrim(l.message), '')      IS NOT NULL)    AS has_message
  FROM public.leads l
),

totals AS (
  SELECT count(*)::numeric AS total FROM leads_norm
),

-- ---------------------------------------------------------------------
-- Disclosure gate. One rule, applied to every calendar output so that the
-- summary can never be less suppressed than the grouped output.
-- ---------------------------------------------------------------------
disclosure AS (
  SELECT
    CASE
      WHEN (SELECT total FROM totals) = 0
        THEN 'NOT_MEASURABLE_NO_DATA'
      WHEN (SELECT total FROM totals) < (SELECT min_group_size FROM params)
        THEN 'SUPPRESSED_LT_5'
      ELSE 'DISCLOSE'
    END AS calendar_mode,
    CASE WHEN (SELECT total FROM totals) = 0
         THEN 'NOT_MEASURABLE_NO_DATA' ELSE 'MEASURED' END AS rate_mode
),

-- ---------------------------------------------------------------------
-- CLOSED REPORTING VOCABULARY. Repository-confirmed values only; see the
-- header for the file and symbol behind each one. A raw stored value is
-- never a label — it is only ever a lookup key.
-- ---------------------------------------------------------------------
source_vocab (source_key, source_label) AS (
  VALUES
    ('contact_form'::text,   'contact_form'::text),
    ('contact_page',         'contact_page'),
    ('home_page',            'home_page'),
    ('booth',                'booth'),
    ('project_detail',       'project_detail (retired surface)')
),

status_vocab (status_key, status_label) AS (
  VALUES
    ('new'::text,       'new'::text),
    ('contacted',       'contacted'),
    ('qualified',       'qualified'),
    ('closed',          'closed'),
    ('spam',            'spam')
),

-- Categorise BEFORE aggregating. Every label below is a fixed constant.
source_cat AS (
  SELECT
    CASE
      WHEN ln.source_key IS NULL THEN '(missing source)'
      ELSE COALESCE(
        (SELECT sv.source_label FROM source_vocab sv WHERE sv.source_key = ln.source_key),
        'Other / unknown source')
    END AS label
  FROM leads_norm ln
),

status_cat AS (
  SELECT
    CASE
      WHEN ln.status_key IS NULL THEN '(missing status)'
      ELSE COALESCE(
        (SELECT stv.status_label FROM status_vocab stv WHERE stv.status_key = ln.status_key),
        'Other / unknown status')
    END AS label
  FROM leads_norm ln
),

-- ---------------------------------------------------------------------
-- Duplication. Normalized email is confined to this CTE and only a group
-- size leaves it. No email value and no hash is emitted anywhere.
-- Two different addresses are never inferred to be one person.
-- ---------------------------------------------------------------------
email_groups AS (
  SELECT count(*)::bigint AS group_size
  FROM public.leads
  WHERE NULLIF(btrim(email), '') IS NOT NULL
  GROUP BY lower(btrim(email))
),

-- ---------------------------------------------------------------------
-- Schema introspection. Drives the readiness section so that a missing
-- column yields NOT_MEASURABLE_FROM_CURRENT_SCHEMA instead of a false zero.
-- ---------------------------------------------------------------------
cols AS (
  SELECT column_name, data_type, is_nullable, column_default, ordinal_position
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'leads'
),

col_probe AS (
  SELECT
    bool_or(column_name IN ('unit', 'unit_id', 'unit_slug', 'unit_code', 'unit_ref'))            AS has_unit_ctx,
    bool_or(column_name IN ('assigned_to', 'assigned_at', 'assignee_id', 'advisor_id', 'owner_id')) AS has_assignment,
    bool_or(column_name IN ('first_response_at', 'responded_at', 'contacted_at', 'updated_at'))  AS has_response_ts,
    bool_or(column_name IN ('stage', 'pipeline_stage', 'assignment_state'))                      AS has_stage,
    bool_or(column_name IN ('attribution', 'utm_source', 'first_touch_source', 'permanent_source')) AS has_attribution
  FROM cols
),

activity_tbl AS (
  SELECT count(*) > 0 AS present
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN ('lead_activities', 'lead_events', 'lead_notes',
                       'crm_activity', 'crm_activities', 'crm_interaction')
),

-- ---------------------------------------------------------------------
-- Grouped sections, each with the k-anonymity floor applied AFTER the
-- closed-vocabulary categorisation above.
-- ---------------------------------------------------------------------
month_raw AS (
  SELECT to_char(created_month, 'YYYY-MM') AS label, count(*)::bigint AS n
  FROM leads_norm
  WHERE created_month IS NOT NULL
  GROUP BY 1
),
month_supp AS (
  SELECT
    CASE WHEN n >= (SELECT min_group_size FROM params)
         THEN label ELSE 'Other / suppressed' END AS label,
    sum(n)::bigint AS n
  FROM month_raw
  GROUP BY 1
),

source_raw AS (
  SELECT label, count(*)::bigint AS n FROM source_cat GROUP BY 1
),
source_supp AS (
  SELECT
    CASE WHEN n >= (SELECT min_group_size FROM params)
         THEN label ELSE 'Other / suppressed' END AS label,
    sum(n)::bigint AS n
  FROM source_raw
  GROUP BY 1
),

status_raw AS (
  SELECT label, count(*)::bigint AS n FROM status_cat GROUP BY 1
),
status_supp AS (
  SELECT
    CASE WHEN n >= (SELECT min_group_size FROM params)
         THEN label ELSE 'Other / suppressed' END AS label,
    sum(n)::bigint AS n
  FROM status_raw
  GROUP BY 1
),

-- ---------------------------------------------------------------------
-- SECURITY SNAPSHOT — the relation, its full ACL, and its full policies.
--
-- Two complementary privilege views, because they answer different
-- questions and can disagree:
--
--   acl_safe  what the RELATION ACL itself records, with its grantor. The
--             privilege names come from the server via aclexplode(), so no
--             unsupported privilege name is ever issued.
--   eff_priv  what has_table_privilege() reports as EFFECTIVE, which also
--             accounts for role membership and PUBLIC. MAINTAIN is guarded
--             by server_version_num so it is never issued below PG 17.
--
-- Nothing here changes a privilege. The breadth of the live ACL is recorded
-- as a finding; hardening it is a separate, later, Owner-approved PR.
-- ---------------------------------------------------------------------
leads_rel AS (
  SELECT c.oid AS reloid, c.relacl
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'leads'
),

acl_rows AS (
  SELECT a.grantee, a.grantor, a.privilege_type, a.is_grantable
  FROM leads_rel, pg_catalog.aclexplode(leads_rel.relacl) AS a
),

acl_named AS (
  SELECT
    CASE WHEN ar.grantee = 0 THEN 'PUBLIC'
         ELSE COALESCE((SELECT rr.rolname FROM pg_catalog.pg_roles rr WHERE rr.oid = ar.grantee),
                       'UNKNOWN_ROLE_OID') END AS grantee_role,
    CASE WHEN ar.grantor = 0 THEN 'PUBLIC'
         ELSE COALESCE((SELECT rg.rolname FROM pg_catalog.pg_roles rg WHERE rg.oid = ar.grantor),
                       'UNKNOWN_ROLE_OID') END AS grantor_role,
    ar.privilege_type,
    ar.is_grantable
  FROM acl_rows ar
),

-- Platform roles Supabase and PostgreSQL define. Anything outside this set
-- could be an operator-created role carrying a personal identifier, so it is
-- reported as a fixed constant and the raw ACL is withheld entirely.
known_roles (rolname) AS (
  VALUES
    ('PUBLIC'::text), ('postgres'), ('anon'), ('authenticated'), ('service_role'),
    ('authenticator'), ('dashboard_user'), ('pgbouncer'),
    ('supabase_admin'), ('supabase_auth_admin'), ('supabase_storage_admin'),
    ('supabase_functions_admin'), ('supabase_read_only_user'),
    ('supabase_replication_admin'), ('supabase_realtime_admin'),
    ('pgsodium_keyholder'), ('pgsodium_keyiduser'), ('pgtle_admin')
),

acl_safe AS (
  SELECT
    CASE WHEN an.grantee_role IN (SELECT rolname FROM known_roles)
         THEN an.grantee_role ELSE 'Other / non-standard role' END AS grantee_label,
    CASE WHEN an.grantor_role IN (SELECT rolname FROM known_roles)
         THEN an.grantor_role ELSE 'Other / non-standard role' END AS grantor_label,
    an.privilege_type,
    an.is_grantable
  FROM acl_named an
),

acl_disclosable AS (
  SELECT NOT EXISTS (
    SELECT 1 FROM acl_named an
    WHERE an.grantee_role NOT IN (SELECT rolname FROM known_roles)
       OR an.grantor_role NOT IN (SELECT rolname FROM known_roles)
  ) AS ok
),

-- Version-safe effective probe. The CASE short-circuits, so a privilege name
-- the server does not know is never passed to has_table_privilege().
priv_candidates (priv, min_server_version) AS (
  VALUES
    ('SELECT'::text, 0), ('INSERT', 0), ('UPDATE', 0), ('DELETE', 0),
    ('TRUNCATE', 0), ('REFERENCES', 0), ('TRIGGER', 0), ('MAINTAIN', 170000)
),

eff_priv AS (
  SELECT
    want.rolname AS role_name,
    pc.priv      AS privilege,
    CASE
      WHEN current_setting('server_version_num')::int < pc.min_server_version
        THEN 'NOT_SUPPORTED_BY_SERVER_VERSION'
      WHEN has_table_privilege(want.rolname, 'public.leads', pc.priv)
        THEN 'granted'
      ELSE 'not granted'
    END AS state
  FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS want(rolname)
  JOIN pg_catalog.pg_roles r ON r.rolname = want.rolname
  CROSS JOIN priv_candidates pc
),

policies AS (
  SELECT p.policyname, p.cmd, p.permissive, p.roles, p.qual, p.with_check
  FROM pg_catalog.pg_policies p
  WHERE p.schemaname = 'public' AND p.tablename = 'leads'
)

-- =====================================================================
-- CONSOLIDATED RESULT SET
-- =====================================================================
SELECT section, metric, label, value_num, value_text, pct_of_total, note
FROM (

-- ---------- 1. SAFETY PROOF ----------
SELECT 100 AS sort_key, '1_SAFETY_PROOF' AS section, 'transaction_read_only' AS metric,
       NULL::text AS label, NULL::numeric AS value_num,
       current_setting('transaction_read_only') AS value_text,
       NULL::numeric AS pct_of_total,
       'must be "on"; enforced in-band, not via PGOPTIONS' AS note
UNION ALL SELECT 101, '1_SAFETY_PROOF', 'current_database', NULL, NULL,
       current_database(), NULL, 'no host, credential or connection detail is emitted'
UNION ALL SELECT 102, '1_SAFETY_PROOF', 'measured_at_utc', NULL, NULL,
       to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), NULL, 'server clock, UTC'
UNION ALL SELECT 103, '1_SAFETY_PROOF', 'server_version_num', NULL, NULL,
       current_setting('server_version_num'), NULL,
       'gates the version-safe privilege probe in section 3'
UNION ALL SELECT 104, '1_SAFETY_PROOF', 'leads_table_present', NULL, NULL,
       CASE WHEN to_regclass('public.leads') IS NULL THEN 'false' ELSE 'true' END, NULL,
       'measurement is meaningless if this is false'
UNION ALL SELECT 105, '1_SAFETY_PROOF', 'evidence_scope', NULL, NULL,
       'CURRENT_TABLE_CONTENTS_ONLY', NULL,
       'proves only what public.leads contains now; no deletion, submission or delivery history is readable here'

-- ---------- 2. SCHEMA SNAPSHOT ----------
UNION ALL SELECT 200 + c.ordinal_position, '2_SCHEMA_SNAPSHOT', 'column',
       c.column_name::text, NULL,
       c.data_type::text || ' | ' || CASE WHEN c.is_nullable = 'YES' THEN 'nullable' ELSE 'not null' END
                    || ' | default ' || COALESCE(c.column_default, '(none)'),
       NULL, 'from information_schema.columns'
FROM cols c

UNION ALL SELECT 300, '2_SCHEMA_SNAPSHOT', 'column_count', NULL,
       (SELECT count(*) FROM cols)::numeric, NULL, NULL, 'total columns on public.leads'

UNION ALL SELECT 310, '2_SCHEMA_SNAPSHOT', 'rls_enabled', NULL, NULL,
       (SELECT CASE WHEN c.relrowsecurity THEN 'true' ELSE 'false' END
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'leads'),
       NULL, 'pg_class.relrowsecurity'
UNION ALL SELECT 311, '2_SCHEMA_SNAPSHOT', 'rls_forced', NULL, NULL,
       (SELECT CASE WHEN c.relforcerowsecurity THEN 'true' ELSE 'false' END
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'leads'),
       NULL, 'pg_class.relforcerowsecurity'

UNION ALL SELECT 320, '2_SCHEMA_SNAPSHOT', 'index', i.indexname::text, NULL, i.indexdef::text, NULL,
       'from pg_indexes'
FROM pg_catalog.pg_indexes i
WHERE i.schemaname = 'public' AND i.tablename = 'leads'

UNION ALL SELECT 330, '2_SCHEMA_SNAPSHOT', 'constraint', con.conname::text, NULL,
       pg_catalog.pg_get_constraintdef(con.oid)::text, NULL, 'from pg_constraint'
FROM pg_catalog.pg_constraint con
JOIN pg_catalog.pg_class cl ON cl.oid = con.conrelid
JOIN pg_catalog.pg_namespace ns ON ns.oid = cl.relnamespace
WHERE ns.nspname = 'public' AND cl.relname = 'leads'

-- ---------- 3. SECURITY SNAPSHOT ----------
-- 3a. Complete RLS policy snapshot. Name and command alone would hide the
-- actual security boundary, so the predicate is part of the baseline.
UNION ALL SELECT 3400, '3_SECURITY_SNAPSHOT', 'policy_count', NULL,
       (SELECT count(*) FROM policies)::numeric, NULL, NULL,
       'zero SELECT policies is the write-only-mailbox signature'
UNION ALL SELECT 3410, '3_SECURITY_SNAPSHOT', 'policy_command', pol.policyname::text, NULL,
       pol.cmd::text, NULL, 'from pg_policies'
FROM policies pol
UNION ALL SELECT 3420, '3_SECURITY_SNAPSHOT', 'policy_mode', pol.policyname::text, NULL,
       pol.permissive::text, NULL, 'PERMISSIVE or RESTRICTIVE'
FROM policies pol
UNION ALL SELECT 3430, '3_SECURITY_SNAPSHOT', 'policy_roles', pol.policyname::text, NULL,
       array_to_string(pol.roles, ',')::text, NULL, 'roles the policy applies to'
FROM policies pol
UNION ALL SELECT 3440, '3_SECURITY_SNAPSHOT', 'policy_qual', pol.policyname::text, NULL,
       COALESCE(pol.qual::text, '(none)'), NULL,
       'USING predicate; (none) for an INSERT-only policy'
FROM policies pol
UNION ALL SELECT 3450, '3_SECURITY_SNAPSHOT', 'policy_with_check', pol.policyname::text, NULL,
       COALESCE(pol.with_check::text, '(none)'), NULL,
       'WITH CHECK predicate — the actual write boundary on public.leads'
FROM policies pol
UNION ALL SELECT 3460, '3_SECURITY_SNAPSHOT', 'policy_command', NULL, NULL,
       'NOT_MEASURABLE_FROM_CURRENT_SCHEMA', NULL,
       'no policy exists on public.leads'
WHERE NOT EXISTS (SELECT 1 FROM policies)

-- 3b. Relation-ACL privilege view, straight from the catalog.
UNION ALL SELECT 3500, '3_SECURITY_SNAPSHOT', 'acl_entry_count', NULL,
       (SELECT count(*) FROM acl_safe)::numeric, NULL, NULL,
       'rows returned by aclexplode(pg_class.relacl) for public.leads'
UNION ALL SELECT 3510, '3_SECURITY_SNAPSHOT', 'acl_privilege',
       (a.grantee_label || '.' || a.privilege_type)::text, NULL,
       'granted | grantor ' || a.grantor_label
       || ' | grantable ' || CASE WHEN a.is_grantable THEN 'yes' ELSE 'no' END
       || ' | from_relation_acl true',
       NULL, 'privilege name supplied by the server via aclexplode; nothing unsupported is issued'
FROM acl_safe a
UNION ALL SELECT 3520, '3_SECURITY_SNAPSHOT', 'acl_privilege', NULL, NULL,
       'NOT_MEASURABLE_FROM_CURRENT_SCHEMA', NULL,
       'public.leads has no explicit relation ACL; only owner and default privileges apply'
WHERE NOT EXISTS (SELECT 1 FROM acl_safe)

UNION ALL SELECT 3530, '3_SECURITY_SNAPSHOT', 'relation_acl_raw', NULL, NULL,
       CASE WHEN (SELECT ok FROM acl_disclosable)
            THEN COALESCE((SELECT relacl::text FROM leads_rel), '(no explicit ACL)')
            ELSE 'SUPPRESSED_NON_STANDARD_ROLE_IN_ACL' END,
       NULL,
       'raw ACL emitted only when every grantee and grantor is a known platform role'

-- 3c. Effective privilege view, version-safe.
UNION ALL SELECT 3600, '3_SECURITY_SNAPSHOT', 'effective_privilege',
       (e.role_name || '.' || e.privilege)::text, NULL,
       e.state || ' | from_relation_acl '
       || CASE WHEN EXISTS (SELECT 1 FROM acl_safe a2
                            WHERE a2.grantee_label = e.role_name
                              AND a2.privilege_type = e.privilege)
               THEN 'true' ELSE 'false' END,
       NULL,
       'has_table_privilege on public.leads; also reflects role membership and PUBLIC'
FROM eff_priv e

-- ---------- 4. OVERALL LEAD BASELINE ----------
UNION ALL SELECT 400, '4_LEAD_BASELINE', 'total_leads', NULL,
       (SELECT total FROM totals), NULL, NULL,
       'factual count; zero is an honest answer to "how many"'
UNION ALL SELECT 401, '4_LEAD_BASELINE', 'earliest_lead_month', NULL, NULL,
       CASE WHEN (SELECT calendar_mode FROM disclosure) <> 'DISCLOSE'
            THEN (SELECT calendar_mode FROM disclosure)
            ELSE (SELECT to_char(min(created_month), 'YYYY-MM') FROM leads_norm) END,
       NULL, 'calendar month only; disclosed only at 5 or more total leads'
UNION ALL SELECT 402, '4_LEAD_BASELINE', 'latest_lead_month', NULL, NULL,
       CASE WHEN (SELECT calendar_mode FROM disclosure) <> 'DISCLOSE'
            THEN (SELECT calendar_mode FROM disclosure)
            ELSE (SELECT to_char(max(created_month), 'YYYY-MM') FROM leads_norm) END,
       NULL, 'calendar month only; disclosed only at 5 or more total leads'
UNION ALL SELECT 403, '4_LEAD_BASELINE', 'lead_month_range', NULL, NULL,
       CASE WHEN (SELECT calendar_mode FROM disclosure) <> 'DISCLOSE'
            THEN (SELECT calendar_mode FROM disclosure)
            ELSE (SELECT to_char(min(created_month), 'YYYY-MM') || ' .. '
                       || to_char(max(created_month), 'YYYY-MM') FROM leads_norm) END,
       NULL, 'same floor as every other calendar output'
UNION ALL SELECT 404, '4_LEAD_BASELINE', 'months_containing_leads', NULL,
       (SELECT count(DISTINCT created_month)::numeric FROM leads_norm), NULL, NULL,
       'factual count of distinct months; identifies no month'
UNION ALL SELECT 405, '4_LEAD_BASELINE', 'distinct_normalized_emails', NULL,
       (SELECT count(*)::numeric FROM email_groups), NULL, NULL,
       'factual count; lower(btrim(email)); no value or hash emitted'
UNION ALL SELECT 406, '4_LEAD_BASELINE', 'with_email', NULL,
       (SELECT (count(*) FILTER (WHERE has_email))::numeric FROM leads_norm), NULL,
       round(100.0 * (SELECT count(*) FILTER (WHERE has_email) FROM leads_norm)
             / NULLIF((SELECT total FROM totals), 0), 2), 'factual count; presence only'
UNION ALL SELECT 407, '4_LEAD_BASELINE', 'with_phone', NULL,
       (SELECT (count(*) FILTER (WHERE has_phone))::numeric FROM leads_norm), NULL,
       round(100.0 * (SELECT count(*) FILTER (WHERE has_phone) FROM leads_norm)
             / NULLIF((SELECT total FROM totals), 0), 2), 'factual count; presence only'
UNION ALL SELECT 408, '4_LEAD_BASELINE', 'with_email_and_phone', NULL,
       (SELECT (count(*) FILTER (WHERE has_email AND has_phone))::numeric FROM leads_norm), NULL,
       round(100.0 * (SELECT count(*) FILTER (WHERE has_email AND has_phone) FROM leads_norm)
             / NULLIF((SELECT total FROM totals), 0), 2), 'factual count; presence only'
UNION ALL SELECT 409, '4_LEAD_BASELINE', 'with_neither_email_nor_phone', NULL,
       (SELECT (count(*) FILTER (WHERE NOT has_email AND NOT has_phone))::numeric FROM leads_norm), NULL,
       round(100.0 * (SELECT count(*) FILTER (WHERE NOT has_email AND NOT has_phone) FROM leads_norm)
             / NULLIF((SELECT total FROM totals), 0), 2), 'factual count; presence only'
UNION ALL SELECT 410, '4_LEAD_BASELINE', 'email_completeness_rate', NULL,
       CASE WHEN (SELECT rate_mode FROM disclosure) = 'MEASURED'
            THEN round(100.0 * (SELECT count(*) FILTER (WHERE has_email) FROM leads_norm)
                       / (SELECT total FROM totals), 2) END,
       CASE WHEN (SELECT rate_mode FROM disclosure) <> 'MEASURED'
            THEN (SELECT rate_mode FROM disclosure) END,
       NULL, 'a rate has no value at a denominator of zero and is not reported as 0'
UNION ALL SELECT 411, '4_LEAD_BASELINE', 'phone_completeness_rate', NULL,
       CASE WHEN (SELECT rate_mode FROM disclosure) = 'MEASURED'
            THEN round(100.0 * (SELECT count(*) FILTER (WHERE has_phone) FROM leads_norm)
                       / (SELECT total FROM totals), 2) END,
       CASE WHEN (SELECT rate_mode FROM disclosure) <> 'MEASURED'
            THEN (SELECT rate_mode FROM disclosure) END,
       NULL, 'a rate has no value at a denominator of zero and is not reported as 0'

-- ---------- 5. LEADS BY MONTH ----------
UNION ALL SELECT 500, '5_BY_MONTH', 'leads_in_month', m.label::text,
       CASE WHEN m.n >= (SELECT min_group_size FROM params) THEN m.n::numeric END,
       CASE WHEN m.n < (SELECT min_group_size FROM params) THEN 'SUPPRESSED_LT_5' END,
       CASE WHEN m.n >= (SELECT min_group_size FROM params)
            THEN round(100.0 * m.n / NULLIF((SELECT total FROM totals), 0), 2) END,
       'months below the floor are folded into "Other / suppressed"; a fold-in bucket below the floor reports its size as SUPPRESSED_LT_5'
FROM month_supp m
UNION ALL SELECT 599, '5_BY_MONTH', 'leads_in_month', NULL, NULL,
       'NOT_MEASURABLE_NO_DATA', NULL, 'no leads exist, so there is nothing to group'
WHERE NOT EXISTS (SELECT 1 FROM month_supp)

-- ---------- 6. LEADS BY SOURCE ----------
-- Every label here is a fixed constant from the closed vocabulary or one of
-- the two fixed catch-alls. A stored source value is never echoed.
UNION ALL SELECT 600, '6_BY_SOURCE', 'leads_from_source', s.label::text,
       CASE WHEN s.n >= (SELECT min_group_size FROM params) THEN s.n::numeric END,
       CASE WHEN s.n < (SELECT min_group_size FROM params) THEN 'SUPPRESSED_LT_5' END,
       CASE WHEN s.n >= (SELECT min_group_size FROM params)
            THEN round(100.0 * s.n / NULLIF((SELECT total FROM totals), 0), 2) END,
       'closed vocabulary; unrecognised values are categorised, never echoed'
FROM source_supp s
UNION ALL SELECT 690, '6_BY_SOURCE', 'source_vocabulary_size', NULL,
       (SELECT count(*) FROM source_vocab)::numeric, NULL, NULL,
       'repository-confirmed source values; see the file header for the evidence behind each'
UNION ALL SELECT 699, '6_BY_SOURCE', 'leads_from_source', NULL, NULL,
       'NOT_MEASURABLE_NO_DATA', NULL, 'no leads exist, so there is nothing to group'
WHERE NOT EXISTS (SELECT 1 FROM source_supp)

-- ---------- 7. LEADS BY STATUS ----------
UNION ALL SELECT 700, '7_BY_STATUS', 'leads_with_status', st.label::text,
       CASE WHEN st.n >= (SELECT min_group_size FROM params) THEN st.n::numeric END,
       CASE WHEN st.n < (SELECT min_group_size FROM params) THEN 'SUPPRESSED_LT_5' END,
       CASE WHEN st.n >= (SELECT min_group_size FROM params)
            THEN round(100.0 * st.n / NULLIF((SELECT total FROM totals), 0), 2) END,
       'closed vocabulary from the status CHECK constraint; unexpected live values are categorised, never echoed'
FROM status_supp st
UNION ALL SELECT 790, '7_BY_STATUS', 'status_vocabulary_size', NULL,
       (SELECT count(*) FROM status_vocab)::numeric, NULL, NULL,
       'the five values the migration CHECK constraint permits'
UNION ALL SELECT 799, '7_BY_STATUS', 'leads_with_status', NULL, NULL,
       'NOT_MEASURABLE_NO_DATA', NULL, 'no leads exist, so there is nothing to group'
WHERE NOT EXISTS (SELECT 1 FROM status_supp)

-- ---------- 8. DUPLICATION INDICATORS ----------
UNION ALL SELECT 800, '8_DUPLICATION', 'normalized_emails_seen_more_than_once', NULL,
       (SELECT (count(*) FILTER (WHERE group_size > 1))::numeric FROM email_groups), NULL, NULL,
       'factual count of groups only; no address and no hash is emitted'
UNION ALL SELECT 801, '8_DUPLICATION', 'rows_in_duplicated_email_groups', NULL,
       (SELECT COALESCE(sum(group_size) FILTER (WHERE group_size > 1), 0)::numeric FROM email_groups),
       NULL, NULL, 'factual count; no person identity resolution is attempted'
UNION ALL SELECT 802, '8_DUPLICATION', 'max_duplicate_group_size', NULL,
       (SELECT max(group_size)::numeric FROM email_groups WHERE group_size > 1), NULL, NULL,
       'null when no address repeats'
UNION ALL SELECT 803, '8_DUPLICATION', 'duplicate_rate', NULL,
       CASE WHEN (SELECT rate_mode FROM disclosure) = 'MEASURED'
            THEN round(100.0 * (SELECT COALESCE(sum(group_size) FILTER (WHERE group_size > 1), 0)
                                FROM email_groups) / (SELECT total FROM totals), 2) END,
       CASE WHEN (SELECT rate_mode FROM disclosure) <> 'MEASURED'
            THEN (SELECT rate_mode FROM disclosure) END,
       NULL, 'a duplication rate is not measurable without rows and is not reported as 0'
UNION ALL SELECT 804, '8_DUPLICATION', 'measurability', NULL, NULL,
       (SELECT rate_mode FROM disclosure), NULL,
       'two different addresses are never inferred to be one person'

-- ---------- 9. DATA COMPLETENESS ----------
UNION ALL SELECT 900 + x.ord, '9_COMPLETENESS', 'null_or_blank_count', x.field::text,
       x.missing::numeric, NULL,
       CASE WHEN (SELECT rate_mode FROM disclosure) = 'MEASURED'
            THEN round(100.0 * x.missing / (SELECT total FROM totals), 2) END,
       'factual count; blank strings counted as missing; presence only, never a value'
FROM (
  SELECT 1 AS ord, 'name'         AS field, count(*) FILTER (WHERE NOT has_name)        AS missing FROM leads_norm
  UNION ALL SELECT 2, 'email',        count(*) FILTER (WHERE NOT has_email)        FROM leads_norm
  UNION ALL SELECT 3, 'phone',        count(*) FILTER (WHERE NOT has_phone)        FROM leads_norm
  UNION ALL SELECT 4, 'source',       count(*) FILTER (WHERE source_key IS NULL)   FROM leads_norm
  UNION ALL SELECT 5, 'status',       count(*) FILTER (WHERE status_key IS NULL)   FROM leads_norm
  UNION ALL SELECT 6, 'project_slug', count(*) FILTER (WHERE NOT has_project_ctx)  FROM leads_norm
  UNION ALL SELECT 7, 'country',      count(*) FILTER (WHERE NOT has_country)      FROM leads_norm
  UNION ALL SELECT 8, 'budget',       count(*) FILTER (WHERE NOT has_budget)       FROM leads_norm
  UNION ALL SELECT 9, 'interest',     count(*) FILTER (WHERE NOT has_interest)     FROM leads_norm
  UNION ALL SELECT 10, 'message',     count(*) FILTER (WHERE NOT has_message)      FROM leads_norm
  UNION ALL SELECT 11, 'created_at',  count(*) FILTER (WHERE NOT has_created_at)   FROM leads_norm
) x

UNION ALL SELECT 985, '9_COMPLETENESS', 'null_or_blank_rate', NULL, NULL,
       (SELECT rate_mode FROM disclosure), NULL,
       'the counts above are factual; the RATE they imply is not measurable without rows'

UNION ALL SELECT 990, '9_COMPLETENESS', 'null_or_blank_count', 'unit_context', NULL,
       'NOT_MEASURABLE_FROM_CURRENT_SCHEMA', NULL,
       'public.leads has no unit column, so the question cannot be asked of any row'
WHERE (SELECT has_unit_ctx FROM col_probe) IS NOT TRUE

UNION ALL SELECT 991, '9_COMPLETENESS', 'measurability', NULL, NULL,
       (SELECT rate_mode FROM disclosure), NULL, 'rates require at least one row to be meaningful'

-- ---------- 10. CURRENT CRM READINESS ----------
UNION ALL SELECT 1000, '10_CRM_READINESS', 'status_has_meaningful_variation', NULL, NULL,
       CASE WHEN (SELECT rate_mode FROM disclosure) <> 'MEASURED'
            THEN (SELECT rate_mode FROM disclosure)
            WHEN (SELECT count(DISTINCT status_key) FROM leads_norm) > 1 THEN 'true'
            ELSE 'false' END,
       NULL, 'more than one distinct normalized status across all leads'
UNION ALL SELECT 1001, '10_CRM_READINESS', 'source_attribution_exists', NULL, NULL,
       CASE WHEN (SELECT rate_mode FROM disclosure) <> 'MEASURED'
            THEN (SELECT rate_mode FROM disclosure)
            WHEN (SELECT count(*) FILTER (WHERE source_key IS NOT NULL) FROM leads_norm) > 0
            THEN 'true' ELSE 'false' END,
       NULL, 'at least one lead carries a non-blank source'
UNION ALL SELECT 1002, '10_CRM_READINESS', 'project_context_exists', NULL, NULL,
       CASE WHEN (SELECT rate_mode FROM disclosure) <> 'MEASURED'
            THEN (SELECT rate_mode FROM disclosure)
            WHEN (SELECT count(*) FILTER (WHERE has_project_ctx) FROM leads_norm) > 0
            THEN 'true' ELSE 'false' END,
       NULL, 'at least one lead carries a non-blank project_slug'
UNION ALL SELECT 1003, '10_CRM_READINESS', 'unit_context_exists', NULL, NULL,
       CASE WHEN (SELECT has_unit_ctx FROM col_probe) THEN 'true'
            ELSE 'NOT_MEASURABLE_FROM_CURRENT_SCHEMA' END,
       NULL, 'schema-level check: no unit column means the question cannot be asked'
UNION ALL SELECT 1004, '10_CRM_READINESS', 'assignment_fields_exist', NULL, NULL,
       CASE WHEN (SELECT has_assignment FROM col_probe) THEN 'true'
            ELSE 'NOT_MEASURABLE_FROM_CURRENT_SCHEMA' END,
       NULL, 'no assigned_to / assigned_at / advisor column on public.leads'
UNION ALL SELECT 1005, '10_CRM_READINESS', 'activity_history_exists', NULL, NULL,
       CASE WHEN (SELECT present FROM activity_tbl) THEN 'true'
            ELSE 'NOT_MEASURABLE_FROM_CURRENT_SCHEMA' END,
       NULL, 'no lead activity or interaction table in the public schema'
UNION ALL SELECT 1006, '10_CRM_READINESS', 'current_assignment_measurable', NULL, NULL,
       CASE WHEN (SELECT has_assignment FROM col_probe) THEN 'true'
            ELSE 'NOT_MEASURABLE_FROM_CURRENT_SCHEMA' END,
       NULL, 'requires an assignment column that does not exist'
UNION ALL SELECT 1007, '10_CRM_READINESS', 'permanent_attribution_exists', NULL, NULL,
       CASE WHEN (SELECT has_attribution FROM col_probe) THEN 'true'
            ELSE 'NOT_MEASURABLE_FROM_CURRENT_SCHEMA' END,
       NULL, 'source is a mutable label, not a permanent first-touch attribution'
UNION ALL SELECT 1008, '10_CRM_READINESS', 'twenty_one_day_rule_calculable', NULL, NULL,
       CASE WHEN (SELECT has_assignment FROM col_probe) AND (SELECT has_stage FROM col_probe)
            THEN 'true' ELSE 'NOT_MEASURABLE_FROM_CURRENT_SCHEMA' END,
       NULL, 'the Owner-approved 21-day holding period needs assigned_at and a stage transition'
UNION ALL SELECT 1009, '10_CRM_READINESS', 'response_time_calculable', NULL, NULL,
       CASE WHEN (SELECT has_response_ts FROM col_probe) THEN 'true'
            ELSE 'NOT_MEASURABLE_FROM_CURRENT_SCHEMA' END,
       NULL, 'created_at exists but nothing records a first human response'
UNION ALL SELECT 1010, '10_CRM_READINESS', 'any_select_policy_exists', NULL, NULL,
       CASE WHEN EXISTS (SELECT 1 FROM policies WHERE cmd IN ('SELECT', 'ALL'))
            THEN 'true' ELSE 'false' END,
       NULL, 'false confirms the write-only mailbox finding at the database level'
UNION ALL SELECT 1011, '10_CRM_READINESS', 'end_to_end_capture_proven', NULL, NULL,
       'NOT_MEASURABLE_FROM_CURRENT_SCHEMA', NULL,
       'a row count cannot prove or disprove delivery history; a separate controlled capture test is required'

) sections
ORDER BY sort_key, label NULLS FIRST;

ROLLBACK;
