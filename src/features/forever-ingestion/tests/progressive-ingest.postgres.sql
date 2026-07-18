\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.assert_true(ok boolean, message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE(ok, false) THEN RAISE EXCEPTION 'postgres_test_failed: %', message; END IF;
END;
$$;

-- 2-5: minimal partial draft, nullable dependencies, raw names, warnings.
SELECT public.forever_progressive_ingest(jsonb_build_object(
  'schema_version','1','mode','create','batch_fingerprint',repeat('1',64),
  'project',jsonb_build_object('slug','pg-minimal','name','Name only','developer_id',null,
    'location_id',null,'developer_name_raw','Unknown, Dev (100%)','location_name_raw','Somewhere'),
  'warnings',jsonb_build_array(jsonb_build_object('entity','developer','code','developer_unresolved',
    'severity','warning','message','unresolved but accepted'))
));
SELECT pg_temp.assert_true((SELECT developer_id IS NULL AND location_id IS NULL
  AND developer_name_raw='Unknown, Dev (100%)' AND location_name_raw='Somewhere'
  AND public_status='draft' FROM public.projects WHERE slug='pg-minimal'), 'minimal/raw/null draft');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.ingestion_warnings w
  JOIN public.projects p ON p.id=w.project_id WHERE p.slug='pg-minimal'), 'unresolved warning persisted');

-- 6-8: rich 1 + 8 + 198 + 198, exact replay, fingerprint mismatch.
DO $$
DECLARE b jsonb; first_summary jsonb; replay_summary jsonb; before_counts int[]; after_counts int[];
BEGIN
  SELECT jsonb_build_object(
    'schema_version','1','mode','create','batch_fingerprint',repeat('2',64),
    'project',jsonb_build_object('slug','pg-rich','name','Rich project'),
    'buildings',(SELECT jsonb_agg(jsonb_build_object('building_code','B'||i)) FROM generate_series(1,8) i),
    'units',(SELECT jsonb_agg(jsonb_build_object('unit_code','U'||i,'building_code','B'||(((i-1)%8)+1))) FROM generate_series(1,198) i),
    'prices',(SELECT jsonb_agg(jsonb_build_object('unit_code','U'||i,'price',1000000+i,
      'currency',null,'price_source','test','source_file','rich.csv','source_page',i,'price_list_date','2026-07-18')) FROM generate_series(1,198) i),
    'media',(SELECT jsonb_agg(jsonb_build_object('media_type','gallery','url','https://example.test/'||i||'.jpg')) FROM generate_series(1,198) i)
  ) INTO b;
  first_summary := public.forever_progressive_ingest(b);
  PERFORM pg_temp.assert_true((first_summary#>>'{counts,buildings}')::int=8
    AND (first_summary#>>'{counts,units}')::int=198
    AND (first_summary#>>'{counts,prices}')::int=198
    AND (first_summary#>>'{counts,media}')::int=198, 'rich summary counts');
  SELECT ARRAY[count(DISTINCT bd.id),count(DISTINCT u.id),count(DISTINCT ph.id),count(DISTINCT m.id)]
    INTO before_counts FROM public.projects p
    LEFT JOIN public.buildings bd ON bd.project_id=p.id LEFT JOIN public.units u ON u.project_id=p.id
    LEFT JOIN public.unit_price_history ph ON ph.unit_id=u.id LEFT JOIN public.project_media m ON m.project_id=p.id
    WHERE p.slug='pg-rich';
  replay_summary := public.forever_progressive_ingest(b);
  PERFORM pg_temp.assert_true((replay_summary->>'replayed')::boolean, 'exact replay flag');
  SELECT ARRAY[count(DISTINCT bd.id),count(DISTINCT u.id),count(DISTINCT ph.id),count(DISTINCT m.id)]
    INTO after_counts FROM public.projects p
    LEFT JOIN public.buildings bd ON bd.project_id=p.id LEFT JOIN public.units u ON u.project_id=p.id
    LEFT JOIN public.unit_price_history ph ON ph.unit_id=u.id LEFT JOIN public.project_media m ON m.project_id=p.id
    WHERE p.slug='pg-rich';
  PERFORM pg_temp.assert_true(before_counts=after_counts, 'exact replay wrote nothing');
  BEGIN
    PERFORM public.forever_progressive_ingest(b || jsonb_build_object('warnings','[]'::jsonb));
    RAISE EXCEPTION 'expected fingerprint mismatch';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%fingerprint_payload_mismatch%' THEN RAISE; END IF;
  END;
END $$;

-- 9-10 and schema/shape gates: unrelated slug, rollback, unsupported/malformed.
DO $$
BEGIN
  BEGIN
    PERFORM public.forever_progressive_ingest(jsonb_build_object('schema_version','1','mode','create',
      'batch_fingerprint',repeat('3',64),'project',jsonb_build_object('slug','pg-rich','name','Other')));
    RAISE EXCEPTION 'expected project_slug_exists';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%project_slug_exists%' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.forever_progressive_ingest(jsonb_build_object('schema_version','1','mode','create',
      'batch_fingerprint',repeat('4',64),'project',jsonb_build_object('slug','pg-rollback','name','Rollback'),
      'units',jsonb_build_array(jsonb_build_object('unit_code','R1')),
      'prices',jsonb_build_array(jsonb_build_object('unit_code','MISSING','price',1))));
    RAISE EXCEPTION 'expected invalid child';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%price_unit_unknown%' THEN RAISE; END IF; END;
  PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.projects WHERE slug='pg-rollback'), 'invalid child rollback');
  BEGIN
    PERFORM public.forever_progressive_ingest(jsonb_build_object('schema_version','2','mode','create',
      'batch_fingerprint',repeat('5',64),'project',jsonb_build_object('slug','pg-version','name','Bad')));
    RAISE EXCEPTION 'expected schema version failure';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%schema_version_unsupported%' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.forever_progressive_ingest(jsonb_build_object('schema_version','1','mode','create',
      'batch_fingerprint',repeat('6',64),'project',jsonb_build_object('slug','pg-shape','name','Bad'),'units','{}'::jsonb));
    RAISE EXCEPTION 'expected shape failure';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%units_malformed%' THEN RAISE; END IF; END;
  PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.projects WHERE slug IN ('pg-version','pg-shape')), 'envelope rollback');
END $$;

-- 11-13: existing building resolution, price-only isolation, NULL currency.
SELECT public.forever_progressive_ingest(jsonb_build_object('schema_version','1','mode','enrich',
  'batch_fingerprint',repeat('7',64),'project',jsonb_build_object('slug','pg-rich'),
  'units',jsonb_build_array(jsonb_build_object('unit_code','LATE','building_code','B1'))));
SELECT pg_temp.assert_true((SELECT b.building_code='B1' FROM public.units u JOIN public.buildings b ON b.id=u.building_id
  JOIN public.projects p ON p.id=u.project_id WHERE p.slug='pg-rich' AND u.unit_code='LATE'), 'unit-only existing building');
DO $$
DECLARE b_count int; u_count int; m_count int;
BEGIN
  SELECT count(*) INTO b_count FROM public.buildings b JOIN public.projects p ON p.id=b.project_id WHERE p.slug='pg-rich';
  SELECT count(*) INTO u_count FROM public.units u JOIN public.projects p ON p.id=u.project_id WHERE p.slug='pg-rich';
  SELECT count(*) INTO m_count FROM public.project_media m JOIN public.projects p ON p.id=m.project_id WHERE p.slug='pg-rich';
  PERFORM public.forever_progressive_ingest(jsonb_build_object('schema_version','1','mode','enrich',
    'batch_fingerprint',repeat('8',64),'project',jsonb_build_object('slug','pg-rich'),
    'prices',jsonb_build_array(jsonb_build_object('unit_code','U1','price',1234567,'currency',null,
      'price_source','test','source_file','new.csv','source_page',1,'price_list_date','2026-08-01'))));
  PERFORM pg_temp.assert_true(b_count=(SELECT count(*) FROM public.buildings b JOIN public.projects p ON p.id=b.project_id WHERE p.slug='pg-rich')
    AND u_count=(SELECT count(*) FROM public.units u JOIN public.projects p ON p.id=u.project_id WHERE p.slug='pg-rich')
    AND m_count=(SELECT count(*) FROM public.project_media m JOIN public.projects p ON p.id=m.project_id WHERE p.slug='pg-rich'), 'price-only isolation');
  PERFORM pg_temp.assert_true((SELECT ph.currency IS NULL FROM public.unit_price_history ph JOIN public.units u ON u.id=ph.unit_id
    JOIN public.projects p ON p.id=u.project_id WHERE p.slug='pg-rich' AND ph.source_file='new.csv'), 'unknown currency NULL');
END $$;

-- Stored provenance merge: accepted metadata cannot erase owner_verified.
UPDATE public.projects SET field_provenance='{"name":{"status":"owner_verified"}}'::jsonb WHERE slug='pg-rich';
SELECT public.forever_progressive_ingest(jsonb_build_object('schema_version','1','mode','enrich',
  'batch_fingerprint',repeat('9',64),'project',jsonb_build_object('slug','pg-rich',
    'set',jsonb_build_object('price_range','1m+'),'field_provenance',jsonb_build_object('price_range',jsonb_build_object('status','extracted')))));
SELECT pg_temp.assert_true((SELECT field_provenance @> '{"name":{"status":"owner_verified"},"price_range":{"status":"extracted"}}'::jsonb
  FROM public.projects WHERE slug='pg-rich'), 'project provenance merge');

-- 14-17: real RLS draft/child visibility, explicit publish, unpublish.
INSERT INTO public.documents(project_id,title,url) SELECT id,'Draft doc','https://example.test/draft.pdf' FROM public.projects WHERE slug='pg-minimal';
SET ROLE anon;
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.projects WHERE slug='pg-minimal'), 'anon draft parent hidden');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.units u JOIN public.projects p ON p.id=u.project_id WHERE p.slug='pg-minimal'), 'anon units hidden');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.project_media m JOIN public.projects p ON p.id=m.project_id WHERE p.slug='pg-minimal'), 'anon media hidden');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.unit_price_history ph JOIN public.units u ON u.id=ph.unit_id JOIN public.projects p ON p.id=u.project_id WHERE p.slug='pg-minimal'), 'anon prices hidden');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.documents d JOIN public.projects p ON p.id=d.project_id WHERE p.slug='pg-minimal'), 'anon documents hidden');
RESET ROLE;
SET ROLE service_role;
SELECT public.forever_progressive_ingest(jsonb_build_object('schema_version','1','mode','enrich','batch_fingerprint',repeat('a',64),
  'project',jsonb_build_object('slug','pg-minimal','publish',true)));
RESET ROLE;
SET ROLE anon;
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.projects WHERE slug='pg-minimal'), 'anon published parent visible');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.documents d JOIN public.projects p ON p.id=d.project_id WHERE p.slug='pg-minimal'), 'anon published child visible');
RESET ROLE;
SET ROLE service_role;
SELECT public.forever_progressive_ingest(jsonb_build_object('schema_version','1','mode','enrich','batch_fingerprint',repeat('b',64),
  'project',jsonb_build_object('slug','pg-minimal','publish',false)));
RESET ROLE;
SET ROLE anon;
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.projects WHERE slug='pg-minimal'), 'anon unpublished parent hidden again');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.documents d JOIN public.projects p ON p.id=d.project_id WHERE p.slug='pg-minimal'), 'anon unpublished child hidden again');
RESET ROLE;

-- 20: another project's child cannot be targeted through this project.
SELECT public.forever_progressive_ingest(jsonb_build_object('schema_version','1','mode','create','batch_fingerprint',repeat('c',64),
  'project',jsonb_build_object('slug','pg-other','name','Other'),'units',jsonb_build_array(jsonb_build_object('unit_code','FOREIGN'))));
DO $$ BEGIN
  BEGIN
    PERFORM public.forever_progressive_ingest(jsonb_build_object('schema_version','1','mode','enrich','batch_fingerprint',repeat('d',64),
      'project',jsonb_build_object('slug','pg-rich'),'prices',jsonb_build_array(jsonb_build_object('unit_code','FOREIGN','price',999))));
    RAISE EXCEPTION 'expected cross-project rejection';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%price_unit_unknown%' THEN RAISE; END IF; END;
END $$;

SELECT pg_temp.assert_true(has_function_privilege('service_role','public.forever_progressive_ingest(jsonb)','EXECUTE'), 'service_role execute grant');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.forever_progressive_ingest(jsonb)','EXECUTE'), 'anon execute revoked');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated','public.forever_progressive_ingest(jsonb)','EXECUTE'), 'authenticated execute revoked');
