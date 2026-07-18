\set ON_ERROR_STOP on
\set payload `cat /workspace/forever-data/projects/coralina/progressive/payload.json`

BEGIN;
SELECT set_config('app.coralina_payload', :'payload', true) AS payload_configured \gset
SET LOCAL ROLE service_role;

SELECT public.forever_progressive_ingest(:'payload'::jsonb) AS ingestion_summary \gset

DO $assertions$
DECLARE
  project_uuid uuid;
  replay jsonb;
BEGIN
  SELECT id INTO STRICT project_uuid
  FROM public.projects
  WHERE slug = 'coralina'
    AND name = 'The Title Coralina Kamala'
    AND public_status = 'draft'
    AND is_active = true
    AND forever_verified = false
    AND developer_id IS NULL
    AND location_id IS NULL
    AND developer_name_raw = 'Rhom Bho Property Public Company Limited'
    AND location_name_raw = 'Kamala, Phuket, Thailand';

  IF (SELECT count(*) FROM public.buildings WHERE project_id = project_uuid) <> 8 THEN RAISE EXCEPTION 'building_count_mismatch'; END IF;
  IF (SELECT count(*) FROM public.units WHERE project_id = project_uuid) <> 198 THEN RAISE EXCEPTION 'unit_count_mismatch'; END IF;
  IF (SELECT count(*) FROM public.unit_price_history ph JOIN public.units u ON u.id = ph.unit_id WHERE u.project_id = project_uuid) <> 198 THEN RAISE EXCEPTION 'price_count_mismatch'; END IF;
  IF (SELECT count(*) FROM public.project_media WHERE project_id = project_uuid) <> 0 THEN RAISE EXCEPTION 'media_count_mismatch'; END IF;
  IF (SELECT count(*) FROM public.documents WHERE project_id = project_uuid) <> 0 THEN RAISE EXCEPTION 'document_count_mismatch'; END IF;
  IF (SELECT count(*) FROM public.ingestion_warnings WHERE project_id = project_uuid) <> 6 THEN RAISE EXCEPTION 'warning_count_mismatch'; END IF;
  IF (SELECT count(*) FROM public.ingestion_batches WHERE project_id = project_uuid AND batch_fingerprint = '9ceb05d2daa5c2a174d37d4d92fb49c4bc39294fa1b5ab402a10ab526230631c') <> 1 THEN RAISE EXCEPTION 'batch_count_mismatch'; END IF;
  IF EXISTS (SELECT 1 FROM public.units u LEFT JOIN public.buildings b ON b.id = u.building_id AND b.project_id = project_uuid WHERE u.project_id = project_uuid AND b.id IS NULL) THEN RAISE EXCEPTION 'orphan_unit'; END IF;
  IF EXISTS (SELECT unit_code FROM public.units WHERE project_id = project_uuid GROUP BY unit_code HAVING count(*) > 1) THEN RAISE EXCEPTION 'duplicate_unit'; END IF;
  IF EXISTS (SELECT ph.unit_id, ph.price_source, ph.source_file, ph.source_page, ph.price_list_date FROM public.unit_price_history ph JOIN public.units u ON u.id = ph.unit_id WHERE u.project_id = project_uuid GROUP BY 1,2,3,4,5 HAVING count(*) > 1) THEN RAISE EXCEPTION 'duplicate_price'; END IF;
  IF EXISTS (SELECT 1 FROM public.unit_price_history ph JOIN public.units u ON u.id = ph.unit_id WHERE u.project_id = project_uuid AND (ph.currency <> 'THB' OR ph.metadata #>> '{currency_decision,status}' <> 'inferred_default' OR ph.metadata #>> '{currency_decision,inferenceRule}' <> 'project_country_default_currency' OR ph.metadata #>> '{currency_decision,inferenceRuleVersion}' <> '1.0.0')) THEN RAISE EXCEPTION 'currency_provenance_mismatch'; END IF;
  replay := public.forever_progressive_ingest(current_setting('app.coralina_payload')::jsonb);
  IF COALESCE((replay->>'replayed')::boolean, false) IS NOT true THEN RAISE EXCEPTION 'exact_replay_not_idempotent'; END IF;

  BEGIN
    PERFORM public.forever_progressive_ingest(
      jsonb_set(jsonb_set(current_setting('app.coralina_payload')::jsonb, '{batch_fingerprint}', to_jsonb(repeat('0', 64))), '{project,name}', '"Conflicting Coralina"'::jsonb)
    );
    RAISE EXCEPTION 'conflicting_identity_was_accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%project_slug_exists%' THEN RAISE; END IF;
  END;
END
$assertions$;

RESET ROLE;
SET LOCAL ROLE anon;
SELECT CASE WHEN count(*) = 0 THEN 'ANON_DRAFT_HIDDEN' ELSE (1 / LEAST(count(*) - 1, 0))::text END
FROM public.projects WHERE slug = 'coralina';
RESET ROLE;

ROLLBACK;

SET ROLE service_role;
SELECT CASE WHEN
  (SELECT count(*) FROM public.projects WHERE slug = 'coralina') = 0
  AND (SELECT count(*) FROM public.ingestion_batches WHERE batch_fingerprint = '9ceb05d2daa5c2a174d37d4d92fb49c4bc39294fa1b5ab402a10ab526230631c') = 0
THEN 'ZERO_RESIDUE_CONFIRMED' ELSE (1 / (SELECT count(*) - count(*) FROM public.projects))::text END AS zero_residue;
RESET ROLE;
