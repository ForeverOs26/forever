-- =====================================================================
-- FOREVER CRM — SLICE 0: MEASURED READ-ONLY LEAD BASELINE
-- =====================================================================
--
-- Task ID:   FOREVER-CRM-SLICE0-MEASURED-BASELINE-001
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
-- HOW TO RUN IT
-- -------------
--   Supabase SQL Editor : paste this entire file and run it.
--   Supabase CLI        : supabase db query --linked -f scripts/crm/crm-slice0-lead-baseline.sql
--
-- Both surfaces return only the FINAL result set, which is why every section
-- below is emitted as labelled rows of one consolidated query rather than as
-- nine separate statements. Filter with the `section` column.
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
-- Grouped categories smaller than MIN_GROUP_SIZE (5) are never shown. They are
-- folded into `Other / suppressed`, and small null/blank counts are reported as
-- `SUPPRESSED_LT_5` rather than as a number.
--
-- HONESTY MODEL
-- -------------
-- A measurement the current schema cannot support returns
-- `NOT_MEASURABLE_FROM_CURRENT_SCHEMA` — never 0. A measurement the schema
-- supports but for which no rows exist returns `NOT_MEASURABLE_NO_DATA`.
-- Absence is never converted into a zero.
--
-- OUTPUT SHAPE
-- ------------
--   section       one of the nine sections below
--   metric        what is being measured
--   label         the grouped category, where the section groups
--   value_num     the numeric answer, when the answer is a number
--   value_text    the textual answer, incl. the NOT_MEASURABLE_* markers
--   pct_of_total  percentage of all leads, to two decimals, where meaningful
--   note          provenance or suppression note
--
-- SECTIONS
--   1 SAFETY_PROOF        6 BY_STATUS
--   2 SCHEMA_SNAPSHOT     7 DUPLICATION
--   3 LEAD_BASELINE       8 COMPLETENESS
--   4 BY_MONTH            9 CRM_READINESS
--   5 BY_SOURCE
-- =====================================================================

BEGIN;
SET TRANSACTION READ ONLY;

-- Required in-band proof. Must print `on` before the measurement is trusted.
SHOW transaction_read_only;

WITH
-- ---------------------------------------------------------------------
-- Parameters. MIN_GROUP_SIZE is the k-anonymity floor for grouped output.
-- ---------------------------------------------------------------------
params AS (
  SELECT 5::bigint AS min_group_size
),

-- ---------------------------------------------------------------------
-- PRIVACY BOUNDARY. Every personal column becomes a boolean here and never
-- travels further as a value. Only `source` and `status` — categorical
-- vocabulary the architecture permits reporting as aggregate counts — and the
-- calendar month survive as values.
-- ---------------------------------------------------------------------
leads_norm AS (
  SELECT
    date_trunc('month', l.created_at)                 AS created_month,
    lower(NULLIF(btrim(l.source), ''))                AS source_norm,
    lower(NULLIF(btrim(l.status), ''))                AS status_norm,
    (l.created_at IS NOT NULL)                        AS has_created_at,
    (NULLIF(btrim(l.name), '')         IS NOT NULL)   AS has_name,
    (NULLIF(btrim(l.email), '')        IS NOT NULL)   AS has_email,
    (NULLIF(btrim(l.phone), '')        IS NOT NULL)   AS has_phone,
    (NULLIF(btrim(l.project_slug), '') IS NOT NULL)   AS has_project_ctx,
    (NULLIF(btrim(l.country), '')      IS NOT NULL)   AS has_country,
    (NULLIF(btrim(l.budget), '')       IS NOT NULL)   AS has_budget,
    (NULLIF(btrim(l.interest), '')     IS NOT NULL)   AS has_interest,
    (NULLIF(btrim(l.message), '')      IS NOT NULL)   AS has_message
  FROM public.leads l
),

totals AS (
  SELECT count(*)::numeric AS total FROM leads_norm
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
-- Grouped sections, each with the k-anonymity floor applied.
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
  SELECT COALESCE(source_norm, '(null or blank)') AS label, count(*)::bigint AS n
  FROM leads_norm
  GROUP BY 1
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
  SELECT COALESCE(status_norm, '(null or blank)') AS label, count(*)::bigint AS n
  FROM leads_norm
  GROUP BY 1
),
status_supp AS (
  SELECT
    CASE WHEN n >= (SELECT min_group_size FROM params)
         THEN label ELSE 'Other / suppressed' END AS label,
    sum(n)::bigint AS n
  FROM status_raw
  GROUP BY 1
),

-- Browser-reachable role privileges on the table.
grant_probe AS (
  SELECT
    want.rolname AS role_name,
    p.priv       AS privilege,
    has_table_privilege(want.rolname, 'public.leads', p.priv) AS granted
  FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS want(rolname)
  JOIN pg_catalog.pg_roles r ON r.rolname = want.rolname
  CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS p(priv)
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
UNION ALL SELECT 103, '1_SAFETY_PROOF', 'leads_table_present', NULL, NULL,
       CASE WHEN to_regclass('public.leads') IS NULL THEN 'false' ELSE 'true' END, NULL,
       'measurement is meaningless if this is false'

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

UNION ALL SELECT 340, '2_SCHEMA_SNAPSHOT', 'policy', pol.policyname::text, NULL,
       pol.cmd::text || ' | roles ' || array_to_string(pol.roles, ','), NULL,
       'from pg_policies; policy name and command only'
FROM pg_catalog.pg_policies pol
WHERE pol.schemaname = 'public' AND pol.tablename = 'leads'

UNION ALL SELECT 350, '2_SCHEMA_SNAPSHOT', 'policy_count', NULL,
       (SELECT count(*) FROM pg_catalog.pg_policies
        WHERE schemaname = 'public' AND tablename = 'leads')::numeric,
       NULL, NULL, 'zero SELECT policies is the write-only-mailbox signature'

UNION ALL SELECT 360, '2_SCHEMA_SNAPSHOT', 'grant',
       (g.role_name || '.' || g.privilege)::text, NULL,
       CASE WHEN g.granted THEN 'granted' ELSE 'not granted' END, NULL,
       'has_table_privilege on public.leads'
FROM grant_probe g

-- ---------- 3. OVERALL LEAD BASELINE ----------
UNION ALL SELECT 400, '3_LEAD_BASELINE', 'total_leads', NULL,
       (SELECT total FROM totals), NULL, NULL, 'every row in public.leads'
UNION ALL SELECT 401, '3_LEAD_BASELINE', 'earliest_lead_month', NULL, NULL,
       COALESCE((SELECT to_char(min(created_month), 'YYYY-MM') FROM leads_norm),
                'NOT_MEASURABLE_NO_DATA'),
       NULL, 'calendar month only; no lead timestamp is emitted'
UNION ALL SELECT 402, '3_LEAD_BASELINE', 'latest_lead_month', NULL, NULL,
       COALESCE((SELECT to_char(max(created_month), 'YYYY-MM') FROM leads_norm),
                'NOT_MEASURABLE_NO_DATA'),
       NULL, 'calendar month only; no lead timestamp is emitted'
UNION ALL SELECT 403, '3_LEAD_BASELINE', 'months_containing_leads', NULL,
       (SELECT count(DISTINCT created_month)::numeric FROM leads_norm), NULL, NULL,
       'distinct calendar months with at least one lead'
UNION ALL SELECT 404, '3_LEAD_BASELINE', 'distinct_normalized_emails', NULL,
       (SELECT count(*)::numeric FROM email_groups), NULL, NULL,
       'lower(btrim(email)); no value or hash emitted'
UNION ALL SELECT 405, '3_LEAD_BASELINE', 'with_email', NULL,
       (SELECT (count(*) FILTER (WHERE has_email))::numeric FROM leads_norm), NULL,
       round(100.0 * (SELECT count(*) FILTER (WHERE has_email) FROM leads_norm)
             / NULLIF((SELECT total FROM totals), 0), 2), 'presence only'
UNION ALL SELECT 406, '3_LEAD_BASELINE', 'with_phone', NULL,
       (SELECT (count(*) FILTER (WHERE has_phone))::numeric FROM leads_norm), NULL,
       round(100.0 * (SELECT count(*) FILTER (WHERE has_phone) FROM leads_norm)
             / NULLIF((SELECT total FROM totals), 0), 2), 'presence only'
UNION ALL SELECT 407, '3_LEAD_BASELINE', 'with_email_and_phone', NULL,
       (SELECT (count(*) FILTER (WHERE has_email AND has_phone))::numeric FROM leads_norm), NULL,
       round(100.0 * (SELECT count(*) FILTER (WHERE has_email AND has_phone) FROM leads_norm)
             / NULLIF((SELECT total FROM totals), 0), 2), 'presence only'
UNION ALL SELECT 408, '3_LEAD_BASELINE', 'with_neither_email_nor_phone', NULL,
       (SELECT (count(*) FILTER (WHERE NOT has_email AND NOT has_phone))::numeric FROM leads_norm), NULL,
       round(100.0 * (SELECT count(*) FILTER (WHERE NOT has_email AND NOT has_phone) FROM leads_norm)
             / NULLIF((SELECT total FROM totals), 0), 2), 'presence only'

-- ---------- 4. LEADS BY MONTH ----------
UNION ALL SELECT 500, '4_BY_MONTH', 'leads_in_month', m.label::text, m.n::numeric, NULL,
       round(100.0 * m.n / NULLIF((SELECT total FROM totals), 0), 2),
       'groups smaller than 5 folded into "Other / suppressed"'
FROM month_supp m
UNION ALL SELECT 599, '4_BY_MONTH', 'leads_in_month', NULL, NULL,
       'NOT_MEASURABLE_NO_DATA', NULL, 'no leads exist, so there is nothing to group'
WHERE NOT EXISTS (SELECT 1 FROM month_supp)

-- ---------- 5. LEADS BY SOURCE ----------
UNION ALL SELECT 600, '5_BY_SOURCE', 'leads_from_source', s.label::text, s.n::numeric, NULL,
       round(100.0 * s.n / NULLIF((SELECT total FROM totals), 0), 2),
       'lower(btrim(source)); groups smaller than 5 folded into "Other / suppressed"'
FROM source_supp s
UNION ALL SELECT 690, '5_BY_SOURCE', 'source_null_or_blank', NULL,
       CASE WHEN (SELECT COALESCE(sum(n), 0) FROM source_raw WHERE label = '(null or blank)')
                 >= (SELECT min_group_size FROM params)
            THEN (SELECT sum(n) FROM source_raw WHERE label = '(null or blank)')::numeric END,
       CASE WHEN (SELECT COALESCE(sum(n), 0) FROM source_raw WHERE label = '(null or blank)')
                 >= (SELECT min_group_size FROM params)
            THEN NULL ELSE 'SUPPRESSED_LT_5' END,
       NULL, 'blank strings are treated as missing'
UNION ALL SELECT 699, '5_BY_SOURCE', 'leads_from_source', NULL, NULL,
       'NOT_MEASURABLE_NO_DATA', NULL, 'no leads exist, so there is nothing to group'
WHERE NOT EXISTS (SELECT 1 FROM source_supp)

-- ---------- 6. LEADS BY STATUS ----------
UNION ALL SELECT 700, '6_BY_STATUS', 'leads_with_status', st.label::text, st.n::numeric, NULL,
       round(100.0 * st.n / NULLIF((SELECT total FROM totals), 0), 2),
       'lower(btrim(status)); groups smaller than 5 folded into "Other / suppressed"'
FROM status_supp st
UNION ALL SELECT 790, '6_BY_STATUS', 'status_null_or_blank', NULL,
       CASE WHEN (SELECT COALESCE(sum(n), 0) FROM status_raw WHERE label = '(null or blank)')
                 >= (SELECT min_group_size FROM params)
            THEN (SELECT sum(n) FROM status_raw WHERE label = '(null or blank)')::numeric END,
       CASE WHEN (SELECT COALESCE(sum(n), 0) FROM status_raw WHERE label = '(null or blank)')
                 >= (SELECT min_group_size FROM params)
            THEN NULL ELSE 'SUPPRESSED_LT_5' END,
       NULL, 'blank strings are treated as missing'
UNION ALL SELECT 799, '6_BY_STATUS', 'leads_with_status', NULL, NULL,
       'NOT_MEASURABLE_NO_DATA', NULL, 'no leads exist, so there is nothing to group'
WHERE NOT EXISTS (SELECT 1 FROM status_supp)

-- ---------- 7. DUPLICATION INDICATORS ----------
UNION ALL SELECT 800, '7_DUPLICATION', 'normalized_emails_seen_more_than_once', NULL,
       (SELECT (count(*) FILTER (WHERE group_size > 1))::numeric FROM email_groups), NULL, NULL,
       'count of groups only; no address and no hash is emitted'
UNION ALL SELECT 801, '7_DUPLICATION', 'rows_in_duplicated_email_groups', NULL,
       (SELECT COALESCE(sum(group_size) FILTER (WHERE group_size > 1), 0)::numeric FROM email_groups),
       NULL,
       round(100.0 * (SELECT COALESCE(sum(group_size) FILTER (WHERE group_size > 1), 0) FROM email_groups)
             / NULLIF((SELECT total FROM totals), 0), 2),
       'no person identity resolution is attempted'
UNION ALL SELECT 802, '7_DUPLICATION', 'max_duplicate_group_size', NULL,
       (SELECT max(group_size)::numeric FROM email_groups WHERE group_size > 1), NULL, NULL,
       'null when no address repeats'
UNION ALL SELECT 803, '7_DUPLICATION', 'measurability', NULL, NULL,
       CASE WHEN (SELECT total FROM totals) = 0
            THEN 'NOT_MEASURABLE_NO_DATA' ELSE 'MEASURED' END,
       NULL, 'two different addresses are never inferred to be one person'

-- ---------- 8. DATA COMPLETENESS ----------
UNION ALL SELECT 900 + x.ord, '8_COMPLETENESS', 'null_or_blank_rate', x.field::text,
       x.missing::numeric, NULL,
       round(100.0 * x.missing / NULLIF((SELECT total FROM totals), 0), 2),
       'blank strings counted as missing; presence only, never a value'
FROM (
  SELECT 1 AS ord, 'name'         AS field, count(*) FILTER (WHERE NOT has_name)        AS missing FROM leads_norm
  UNION ALL SELECT 2, 'email',        count(*) FILTER (WHERE NOT has_email)        FROM leads_norm
  UNION ALL SELECT 3, 'phone',        count(*) FILTER (WHERE NOT has_phone)        FROM leads_norm
  UNION ALL SELECT 4, 'source',       count(*) FILTER (WHERE source_norm IS NULL)  FROM leads_norm
  UNION ALL SELECT 5, 'status',       count(*) FILTER (WHERE status_norm IS NULL)  FROM leads_norm
  UNION ALL SELECT 6, 'project_slug', count(*) FILTER (WHERE NOT has_project_ctx)  FROM leads_norm
  UNION ALL SELECT 7, 'country',      count(*) FILTER (WHERE NOT has_country)      FROM leads_norm
  UNION ALL SELECT 8, 'budget',       count(*) FILTER (WHERE NOT has_budget)       FROM leads_norm
  UNION ALL SELECT 9, 'interest',     count(*) FILTER (WHERE NOT has_interest)     FROM leads_norm
  UNION ALL SELECT 10, 'message',     count(*) FILTER (WHERE NOT has_message)      FROM leads_norm
  UNION ALL SELECT 11, 'created_at',  count(*) FILTER (WHERE NOT has_created_at)   FROM leads_norm
) x

UNION ALL SELECT 990, '8_COMPLETENESS', 'null_or_blank_rate', 'unit_context', NULL,
       'NOT_MEASURABLE_FROM_CURRENT_SCHEMA', NULL,
       'public.leads has no unit column; absence is not reported as zero'
WHERE (SELECT has_unit_ctx FROM col_probe) IS NOT TRUE

UNION ALL SELECT 991, '8_COMPLETENESS', 'measurability', NULL, NULL,
       CASE WHEN (SELECT total FROM totals) = 0
            THEN 'NOT_MEASURABLE_NO_DATA' ELSE 'MEASURED' END,
       NULL, 'rates require at least one row to be meaningful'

-- ---------- 9. CURRENT CRM READINESS ----------
UNION ALL SELECT 1000, '9_CRM_READINESS', 'status_has_meaningful_variation', NULL, NULL,
       CASE WHEN (SELECT total FROM totals) = 0 THEN 'NOT_MEASURABLE_NO_DATA'
            WHEN (SELECT count(DISTINCT status_norm) FROM leads_norm) > 1 THEN 'true'
            ELSE 'false' END,
       NULL, 'more than one distinct normalized status across all leads'
UNION ALL SELECT 1001, '9_CRM_READINESS', 'source_attribution_exists', NULL, NULL,
       CASE WHEN (SELECT total FROM totals) = 0 THEN 'NOT_MEASURABLE_NO_DATA'
            WHEN (SELECT count(*) FILTER (WHERE source_norm IS NOT NULL) FROM leads_norm) > 0
            THEN 'true' ELSE 'false' END,
       NULL, 'at least one lead carries a non-blank source'
UNION ALL SELECT 1002, '9_CRM_READINESS', 'project_context_exists', NULL, NULL,
       CASE WHEN (SELECT total FROM totals) = 0 THEN 'NOT_MEASURABLE_NO_DATA'
            WHEN (SELECT count(*) FILTER (WHERE has_project_ctx) FROM leads_norm) > 0
            THEN 'true' ELSE 'false' END,
       NULL, 'at least one lead carries a non-blank project_slug'
UNION ALL SELECT 1003, '9_CRM_READINESS', 'unit_context_exists', NULL, NULL,
       CASE WHEN (SELECT has_unit_ctx FROM col_probe) THEN 'true'
            ELSE 'NOT_MEASURABLE_FROM_CURRENT_SCHEMA' END,
       NULL, 'schema-level check: no unit column means the question cannot be asked'
UNION ALL SELECT 1004, '9_CRM_READINESS', 'assignment_fields_exist', NULL, NULL,
       CASE WHEN (SELECT has_assignment FROM col_probe) THEN 'true'
            ELSE 'NOT_MEASURABLE_FROM_CURRENT_SCHEMA' END,
       NULL, 'no assigned_to / assigned_at / advisor column on public.leads'
UNION ALL SELECT 1005, '9_CRM_READINESS', 'activity_history_exists', NULL, NULL,
       CASE WHEN (SELECT present FROM activity_tbl) THEN 'true'
            ELSE 'NOT_MEASURABLE_FROM_CURRENT_SCHEMA' END,
       NULL, 'no lead activity or interaction table in the public schema'
UNION ALL SELECT 1006, '9_CRM_READINESS', 'current_assignment_measurable', NULL, NULL,
       CASE WHEN (SELECT has_assignment FROM col_probe) THEN 'true'
            ELSE 'NOT_MEASURABLE_FROM_CURRENT_SCHEMA' END,
       NULL, 'requires an assignment column that does not exist'
UNION ALL SELECT 1007, '9_CRM_READINESS', 'permanent_attribution_exists', NULL, NULL,
       CASE WHEN (SELECT has_attribution FROM col_probe) THEN 'true'
            ELSE 'NOT_MEASURABLE_FROM_CURRENT_SCHEMA' END,
       NULL, 'source is a mutable label, not a permanent first-touch attribution'
UNION ALL SELECT 1008, '9_CRM_READINESS', 'twenty_one_day_rule_calculable', NULL, NULL,
       CASE WHEN (SELECT has_assignment FROM col_probe) AND (SELECT has_stage FROM col_probe)
            THEN 'true' ELSE 'NOT_MEASURABLE_FROM_CURRENT_SCHEMA' END,
       NULL, 'the Owner-approved 21-day holding period needs assigned_at and a stage transition'
UNION ALL SELECT 1009, '9_CRM_READINESS', 'response_time_calculable', NULL, NULL,
       CASE WHEN (SELECT has_response_ts FROM col_probe) THEN 'true'
            ELSE 'NOT_MEASURABLE_FROM_CURRENT_SCHEMA' END,
       NULL, 'created_at exists but nothing records a first human response'
UNION ALL SELECT 1010, '9_CRM_READINESS', 'any_select_policy_exists', NULL, NULL,
       CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_policies
                         WHERE schemaname = 'public' AND tablename = 'leads'
                           AND cmd IN ('SELECT', 'ALL'))
            THEN 'true' ELSE 'false' END,
       NULL, 'false confirms the write-only mailbox finding at the database level'

) sections
ORDER BY sort_key, label NULLS FIRST;

ROLLBACK;
