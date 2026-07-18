\set ON_ERROR_STOP on
\pset pager off

-- Progressive Ingestion production rollout preflight.
-- Read-only, rerunnable, and intentionally free of credentials and connection
-- strings. Invoke with psql after establishing a separately managed connection.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

\echo '[identity] database identity and PostgreSQL version'
SELECT current_database() AS database_name,
       current_user AS effective_role,
       current_setting('server_version') AS postgresql_version,
       current_setting('server_version_num') AS postgresql_version_num;

DO $check$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE EXCEPTION '[migration_history] supabase_migrations.schema_migrations is missing';
  END IF;
END
$check$;

\echo '[migration_history] applied migration inventory'
SELECT version, name
FROM supabase_migrations.schema_migrations
ORDER BY version;

SELECT EXISTS (
  SELECT 1 FROM supabase_migrations.schema_migrations
  WHERE version::text = '20260718113000'
) AS progressive_applied \gset

\echo '[migration_history] 20260718113000 applied = ' :progressive_applied

DO $check$
DECLARE
  missing text;
BEGIN
  FOR missing IN
    SELECT format('%I.%I', required.schema_name, required.relation_name)
    FROM (VALUES
      ('public','projects'), ('public','developers'), ('public','locations'),
      ('public','units'), ('public','project_media'), ('public','investment_data'),
      ('public','buildings'), ('public','unit_price_history'),
      ('public','project_facilities'), ('public','sources'),
      ('public','project_assets'), ('public','documents'), ('public','images'),
      ('public','videos'), ('public','project_intelligence'),
      ('public','project_translations'), ('public','project_status_history'),
      ('public','project_tags'), ('public','project_amenities'),
      ('public','nearby_places'), ('public','project_seo')
    ) AS required(schema_name, relation_name)
    WHERE to_regclass(format('%I.%I', required.schema_name, required.relation_name)) IS NULL
  LOOP
    RAISE EXCEPTION '[required_tables] missing relation %', missing;
  END LOOP;

  IF to_regprocedure('public.set_updated_at()') IS NULL THEN
    RAISE EXCEPTION '[required_functions] missing public.set_updated_at()';
  END IF;
END
$check$;

DO $check$
DECLARE
  missing text;
BEGIN
  FOR missing IN
    SELECT format('%I.%I.%I', required.schema_name, required.table_name, required.column_name)
    FROM (VALUES
      ('public','projects','id'), ('public','projects','name'), ('public','projects','slug'),
      ('public','projects','developer_id'), ('public','projects','location_id'),
      ('public','projects','location_area'), ('public','projects','project_type'),
      ('public','projects','address'), ('public','projects','short_description'),
      ('public','projects','full_description'), ('public','projects','construction_status'),
      ('public','projects','ownership_type'), ('public','projects','completion_date'),
      ('public','projects','latitude'), ('public','projects','longitude'),
      ('public','projects','main_image_url'), ('public','projects','brochure_url'),
      ('public','projects','starting_price_thb'), ('public','projects','price_range'),
      ('public','projects','public_status'), ('public','projects','is_active'),
      ('public','projects','forever_verified'), ('public','projects','last_data_review_at'),
      ('public','projects','updated_at'),
      ('public','buildings','id'), ('public','buildings','project_id'),
      ('public','buildings','building_code'), ('public','buildings','name'),
      ('public','buildings','floors_count'), ('public','buildings','units_count'),
      ('public','buildings','metadata'), ('public','buildings','updated_at'),
      ('public','units','id'), ('public','units','project_id'), ('public','units','building_id'),
      ('public','units','unit_code'), ('public','units','unit_type'),
      ('public','units','bedrooms'), ('public','units','bathrooms'),
      ('public','units','size_sqm'), ('public','units','floor'),
      ('public','units','availability_status'), ('public','units','metadata'),
      ('public','units','updated_at'),
      ('public','unit_price_history','id'), ('public','unit_price_history','unit_id'),
      ('public','unit_price_history','price'), ('public','unit_price_history','currency'),
      ('public','unit_price_history','price_source'), ('public','unit_price_history','source_file'),
      ('public','unit_price_history','source_page'), ('public','unit_price_history','price_list_date'),
      ('public','unit_price_history','metadata'), ('public','unit_price_history','updated_at'),
      ('public','project_media','id'), ('public','project_media','project_id'),
      ('public','project_media','media_type'), ('public','project_media','title'),
      ('public','project_media','url'), ('public','project_media','sort_order')
    ) AS required(schema_name, table_name, column_name)
    LEFT JOIN pg_namespace n ON n.nspname = required.schema_name
    LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = required.table_name
    LEFT JOIN pg_attribute a ON a.attrelid = c.oid
      AND a.attname = required.column_name AND a.attnum > 0 AND NOT a.attisdropped
    WHERE a.attname IS NULL
  LOOP
    RAISE EXCEPTION '[required_columns] missing column %', missing;
  END LOOP;
END
$check$;

DO $check$
DECLARE
  mismatch text;
BEGIN
  FOR mismatch IN
    SELECT format('%s on public.%s', required.policy_name, required.table_name)
    FROM (VALUES
      ('Active projects are viewable by everyone','projects'),
      ('Units of active projects are viewable by everyone','units'),
      ('Media of active projects is viewable by everyone','project_media'),
      ('Investment data of active projects is viewable by everyone','investment_data'),
      ('Buildings of active projects are viewable','buildings'),
      ('Price history of active project units is viewable','unit_price_history'),
      ('Facilities of active projects are viewable','project_facilities'),
      ('Public sources for active projects are viewable','sources'),
      ('Public assets of active projects are viewable','project_assets'),
      ('Public documents of active projects are viewable','documents'),
      ('Public images of active projects are viewable','images'),
      ('Public videos of active projects are viewable','videos'),
      ('Current published intelligence is viewable','project_intelligence'),
      ('Public read project translations','project_translations'),
      ('Public read status history','project_status_history'),
      ('Public read project tags','project_tags'),
      ('Public read project amenities','project_amenities'),
      ('Public read nearby places','nearby_places'),
      ('Public read project seo','project_seo')
    ) AS required(policy_name, table_name)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = required.table_name
        AND p.policyname = required.policy_name
    )
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM supabase_migrations.schema_migrations
      WHERE version::text = '20260718113000'
    ) THEN
      RAISE EXCEPTION '[drop_policy_targets] missing exact pre-migration policy %', mismatch;
    END IF;
  END LOOP;
END
$check$;

DO $check$
DECLARE duplicate_groups bigint;
BEGIN
  SELECT count(*) INTO duplicate_groups
  FROM (
    SELECT project_id, media_type, url
    FROM public.project_media
    GROUP BY project_id, media_type, url
    HAVING count(*) > 1
  ) duplicates;
  IF duplicate_groups <> 0 THEN
    RAISE EXCEPTION '[project_media_duplicates] % duplicate natural-key group(s)', duplicate_groups;
  END IF;
END
$check$;

DO $check$
DECLARE digest text;
BEGIN
  SELECT encode(sha256(''::bytea), 'hex') INTO digest;
  IF digest <> 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' THEN
    RAISE EXCEPTION '[sha256_bytea] sha256(bytea) returned an unexpected digest';
  END IF;
EXCEPTION WHEN undefined_function THEN
  RAISE EXCEPTION '[sha256_bytea] sha256(bytea) is unavailable';
END
$check$;

\echo '[currency_shape] unit_price_history.currency default and nullability'
SELECT column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'unit_price_history'
  AND column_name = 'currency';

DO $check$
DECLARE column_default text; nullable text; applied boolean;
BEGIN
  SELECT c.column_default, c.is_nullable INTO column_default, nullable
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'unit_price_history'
    AND c.column_name = 'currency';
  SELECT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version::text = '20260718113000'
  ) INTO applied;
  IF applied AND (column_default IS NOT NULL OR nullable <> 'YES') THEN
    RAISE EXCEPTION '[currency_shape] applied state requires no default and nullable currency';
  ELSIF NOT applied AND (column_default IS NULL OR nullable <> 'NO') THEN
    RAISE EXCEPTION '[currency_shape] pre-migration state unexpectedly differs from DEFAULT/NOT NULL baseline';
  END IF;
END
$check$;

\echo '[strict_currency_writers] database functions inserting price history'
SELECT n.nspname AS schema_name, p.proname AS function_name,
       p.prosrc ~* 'insert[[:space:]]+into[[:space:]]+public[.]unit_price_history[^;]*currency' AS supplies_currency
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.prosrc ~* 'insert[[:space:]]+into[[:space:]]+public[.]unit_price_history';

DO $check$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.prosrc ~* 'insert[[:space:]]+into[[:space:]]+public[.]unit_price_history'
      AND p.prosrc !~* 'insert[[:space:]]+into[[:space:]]+public[.]unit_price_history[^;]*currency'
  ) THEN
    RAISE EXCEPTION '[strict_currency_writers] a database writer does not explicitly supply currency';
  END IF;
END
$check$;

DO $check$
DECLARE marker_count integer; applied boolean;
BEGIN
  SELECT
    (to_regclass('public.listings') IS NOT NULL)::int +
    (to_regclass('public.ingestion_warnings') IS NOT NULL)::int +
    (to_regclass('public.ingestion_batches') IS NOT NULL)::int +
    (to_regprocedure('public.forever_progressive_ingest(jsonb)') IS NOT NULL)::int +
    (to_regclass('public.project_media_natural_key') IS NOT NULL)::int +
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='projects' AND column_name='developer_name_raw')::int +
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='projects' AND column_name='location_name_raw')::int +
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='projects' AND column_name='field_provenance')::int +
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='project_media' AND column_name='metadata')::int
  INTO marker_count;
  SELECT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version::text = '20260718113000'
  ) INTO applied;
  IF NOT applied AND marker_count <> 0 THEN
    RAISE EXCEPTION '[partial_progressive_state] migration absent but % of 9 markers exist', marker_count;
  ELSIF applied AND marker_count <> 9 THEN
    RAISE EXCEPTION '[partial_progressive_state] migration applied but only % of 9 markers exist', marker_count;
  END IF;
END
$check$;

\if :progressive_applied
DO $check$
DECLARE missing text;
BEGIN
  FOR missing IN
    SELECT object_name FROM (VALUES
      ('public.listings'), ('public.ingestion_warnings'), ('public.ingestion_batches')
    ) required(object_name)
    WHERE to_regclass(object_name) IS NULL
  LOOP
    RAISE EXCEPTION '[progressive_tables] missing %', missing;
  END LOOP;
  IF to_regprocedure('public.forever_progressive_ingest(jsonb)') IS NULL THEN
    RAISE EXCEPTION '[progressive_function] missing public.forever_progressive_ingest(jsonb)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.listings'::regclass AND tgname = 'trg_listings_updated_at'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION '[progressive_trigger] missing public.listings.trg_listings_updated_at';
  END IF;

  FOR missing IN
    SELECT format('public.%I.%I', required.table_name, required.column_name)
    FROM (VALUES
      ('projects','developer_name_raw'), ('projects','location_name_raw'),
      ('projects','field_provenance'), ('project_media','metadata'),
      ('listings','id'), ('listings','kind'), ('listings','title'), ('listings','slug'),
      ('listings','project_id'), ('listings','project_name_raw'), ('listings','location_id'),
      ('listings','location_name_raw'), ('listings','property_type'), ('listings','bedrooms'),
      ('listings','bathrooms'), ('listings','area_sqm'), ('listings','price'),
      ('listings','currency'), ('listings','availability_status'), ('listings','description'),
      ('listings','photos'), ('listings','contact_name'), ('listings','contact_phone'),
      ('listings','contact_email'), ('listings','field_provenance'),
      ('listings','publication_status'), ('listings','created_at'), ('listings','updated_at'),
      ('ingestion_warnings','id'), ('ingestion_warnings','project_id'),
      ('ingestion_warnings','listing_id'), ('ingestion_warnings','entity'),
      ('ingestion_warnings','field'), ('ingestion_warnings','code'),
      ('ingestion_warnings','severity'), ('ingestion_warnings','message'),
      ('ingestion_warnings','payload'), ('ingestion_warnings','status'),
      ('ingestion_warnings','created_at'), ('ingestion_warnings','resolved_at'),
      ('ingestion_batches','id'), ('ingestion_batches','project_id'),
      ('ingestion_batches','batch_fingerprint'), ('ingestion_batches','payload_hash'),
      ('ingestion_batches','mode'), ('ingestion_batches','summary'),
      ('ingestion_batches','created_at')
    ) required(table_name, column_name)
    LEFT JOIN pg_namespace n ON n.nspname = 'public'
    LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = required.table_name
    LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = required.column_name
      AND a.attnum > 0 AND NOT a.attisdropped
    WHERE a.attname IS NULL
  LOOP
    RAISE EXCEPTION '[progressive_columns] missing %', missing;
  END LOOP;

  FOR missing IN
    SELECT format('%s on public.%s', required.policy_name, required.table_name)
    FROM (VALUES
      ('Published projects are viewable by everyone','projects'),
      ('Units of published projects are viewable by everyone','units'),
      ('Media of published projects is viewable by everyone','project_media'),
      ('Investment data of published projects is viewable by everyone','investment_data'),
      ('Buildings of published projects are viewable','buildings'),
      ('Price history of published project units is viewable','unit_price_history'),
      ('Facilities of published projects are viewable','project_facilities'),
      ('Public sources for published projects are viewable','sources'),
      ('Public assets of published projects are viewable','project_assets'),
      ('Public documents of published projects are viewable','documents'),
      ('Public images of published projects are viewable','images'),
      ('Public videos of published projects are viewable','videos'),
      ('Current published intelligence of published projects is viewable','project_intelligence'),
      ('Translations of published projects are viewable','project_translations'),
      ('Status history of published projects is viewable','project_status_history'),
      ('Tags of published projects are viewable','project_tags'),
      ('Amenities of published projects are viewable','project_amenities'),
      ('Nearby places of published projects are viewable','nearby_places'),
      ('SEO of published projects is viewable','project_seo'),
      ('Published listings are viewable by everyone','listings')
    ) required(policy_name, table_name)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname='public' AND p.tablename=required.table_name
        AND p.policyname=left(required.policy_name, 63)
    )
  LOOP
    RAISE EXCEPTION '[progressive_policies] missing exact policy %', missing;
  END LOOP;
END
$check$;
\endif

\echo '[visibility] project visibility and grouped public_status counts'
SELECT public_status, is_active, count(*) AS projects
FROM public.projects
GROUP BY public_status, is_active
ORDER BY public_status, is_active;

\echo '[baseline_counts] business-table counts'
SELECT 'projects' AS relation, count(*) AS rows FROM public.projects
UNION ALL SELECT 'buildings', count(*) FROM public.buildings
UNION ALL SELECT 'units', count(*) FROM public.units
UNION ALL SELECT 'unit_price_history', count(*) FROM public.unit_price_history
UNION ALL SELECT 'project_media', count(*) FROM public.project_media
UNION ALL SELECT 'documents', count(*) FROM public.documents
ORDER BY relation;

\echo '[strict_execution_inventory] strict roles, schemas, tables, functions, and policies'
SELECT 'role' AS object_type, rolname AS object_name
FROM pg_roles WHERE rolname IN ('forever_import_executor','forever_import_execution_owner')
UNION ALL
SELECT 'schema', nspname FROM pg_namespace WHERE nspname IN ('forever_import','forever_execution')
UNION ALL
SELECT 'table', n.nspname || '.' || c.relname
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='forever_import' AND c.relkind IN ('r','p')
UNION ALL
SELECT 'function', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN ('forever_import','forever_execution')
UNION ALL
SELECT 'policy', schemaname || '.' || tablename || '.' || policyname
FROM pg_policies WHERE policyname LIKE 'forever_import_%'
ORDER BY object_type, object_name;

ROLLBACK;
\echo '[preflight_complete] all read-only checks passed'
