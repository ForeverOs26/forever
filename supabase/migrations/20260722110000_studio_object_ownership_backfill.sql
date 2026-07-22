-- FOREVER-STUDIO-002: deterministic attribution for objects that existed
-- before FOREVER-STUDIO-001 installed the private ownership boundary.
--
-- This is deliberately a new additive corrective migration. It never alters
-- the already-applied ownership migration or application data outside
-- studio_object_owners. A successful Studio creation is authoritative only
-- when its persisted target references resolve to exactly one object. All
-- other pre-Studio objects are explicitly Owner-managed.
BEGIN;

CREATE OR REPLACE FUNCTION public.studio_backfill_existing_object_owners()
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_job public.studio_upload_jobs;
  v_object_id UUID;
  v_id_target UUID;
  v_slug_target UUID;
  v_owner_id UUID;
  v_owner_count INTEGER;
  v_conflict_type TEXT;
  v_conflict_id UUID;
  v_existing_created_by UUID;
BEGIN
  -- Freeze precisely the four relations used to derive and write attribution.
  -- This keeps a concurrent publication from racing the inventory.
  LOCK TABLE public.projects, public.listings, public.studio_upload_jobs,
             public.studio_object_owners IN SHARE ROW EXCLUSIVE MODE;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.studio_owner_backfill_candidates (
    object_type TEXT NOT NULL,
    object_id UUID NOT NULL,
    created_by UUID NOT NULL,
    job_id UUID NOT NULL,
    job_created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (object_type, object_id, job_id)
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.studio_owner_backfill_candidates;

  -- A project creation job records both its result id and final slug. Either
  -- may identify the target, but if both are present they must identify the
  -- same row. A malformed or dangling successful job is unsafe to guess.
  FOR v_job IN
    SELECT * FROM public.studio_upload_jobs
    WHERE status = 'published' AND workflow = 'new_development'
    ORDER BY created_at ASC, id ASC
  LOOP
    v_id_target := NULL;
    v_slug_target := NULL;
    IF NULLIF(trim(v_job.result_summary->>'projectId'), '') IS NOT NULL THEN
      IF (v_job.result_summary->>'projectId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'studio_owner_backfill_project_id_invalid';
      END IF;
      SELECT id INTO v_id_target FROM public.projects
        WHERE id = (v_job.result_summary->>'projectId')::uuid;
      IF NOT FOUND THEN RAISE EXCEPTION 'studio_owner_backfill_project_id_missing'; END IF;
    END IF;
    IF NULLIF(trim(v_job.project_slug), '') IS NOT NULL THEN
      SELECT id INTO v_slug_target FROM public.projects WHERE slug = v_job.project_slug;
      IF NOT FOUND THEN RAISE EXCEPTION 'studio_owner_backfill_project_slug_missing'; END IF;
    END IF;
    IF v_id_target IS NULL AND v_slug_target IS NULL THEN
      RAISE EXCEPTION 'studio_owner_backfill_project_target_missing';
    END IF;
    IF v_id_target IS NOT NULL AND v_slug_target IS NOT NULL AND v_id_target <> v_slug_target THEN
      RAISE EXCEPTION 'studio_owner_backfill_project_target_conflict';
    END IF;
    v_object_id := COALESCE(v_id_target, v_slug_target);
    IF v_job.created_by IS NOT NULL THEN
      INSERT INTO pg_temp.studio_owner_backfill_candidates
        (object_type, object_id, created_by, job_id, job_created_at)
      VALUES ('project', v_object_id, v_job.created_by, v_job.id, v_job.created_at);
    END IF;
  END LOOP;

  -- Resale jobs persist the listing foreign key and result id; their result
  -- slug and deterministic content fingerprint are independent cross-checks.
  FOR v_job IN
    SELECT * FROM public.studio_upload_jobs
    WHERE status = 'published' AND workflow = 'resale_listing'
    ORDER BY created_at ASC, id ASC
  LOOP
    v_id_target := NULL;
    v_slug_target := NULL;
    IF v_job.listing_id IS NOT NULL THEN
      SELECT id INTO v_id_target FROM public.listings WHERE id = v_job.listing_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'studio_owner_backfill_listing_id_missing'; END IF;
    END IF;
    IF NULLIF(trim(v_job.result_summary->>'listingId'), '') IS NOT NULL THEN
      IF (v_job.result_summary->>'listingId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'studio_owner_backfill_listing_result_id_invalid';
      END IF;
      SELECT id INTO v_object_id FROM public.listings
        WHERE id = (v_job.result_summary->>'listingId')::uuid;
      IF NOT FOUND THEN RAISE EXCEPTION 'studio_owner_backfill_listing_result_id_missing'; END IF;
      IF v_id_target IS NOT NULL AND v_id_target <> v_object_id THEN
        RAISE EXCEPTION 'studio_owner_backfill_listing_id_conflict';
      END IF;
      v_id_target := v_object_id;
    END IF;
    IF NULLIF(trim(v_job.result_summary->>'slug'), '') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.listings WHERE slug = v_job.result_summary->>'slug') THEN
      RAISE EXCEPTION 'studio_owner_backfill_listing_result_slug_missing';
    END IF;
    IF NULLIF(trim(v_job.content_fingerprint), '') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.listings WHERE slug = v_job.content_fingerprint) THEN
      RAISE EXCEPTION 'studio_owner_backfill_listing_fingerprint_missing';
    END IF;
    FOR v_object_id IN
      SELECT id FROM public.listings
      WHERE slug IN (
        NULLIF(trim(v_job.result_summary->>'slug'), ''),
        NULLIF(trim(v_job.content_fingerprint), '')
      )
    LOOP
      IF v_slug_target IS NOT NULL AND v_slug_target <> v_object_id THEN
        RAISE EXCEPTION 'studio_owner_backfill_listing_slug_conflict';
      END IF;
      v_slug_target := v_object_id;
    END LOOP;
    IF v_id_target IS NULL AND v_slug_target IS NULL THEN
      RAISE EXCEPTION 'studio_owner_backfill_listing_target_missing';
    END IF;
    IF v_id_target IS NOT NULL AND v_slug_target IS NOT NULL AND v_id_target <> v_slug_target THEN
      RAISE EXCEPTION 'studio_owner_backfill_listing_target_conflict';
    END IF;
    v_object_id := COALESCE(v_id_target, v_slug_target);
    IF v_job.created_by IS NOT NULL THEN
      INSERT INTO pg_temp.studio_owner_backfill_candidates
        (object_type, object_id, created_by, job_id, job_created_at)
      VALUES ('listing', v_object_id, v_job.created_by, v_job.id, v_job.created_at);
    END IF;
  END LOOP;

  -- Creation is immutable: two different successful authenticated creators
  -- are an ambiguity, never a reason to select the most recently updated row.
  SELECT object_type, object_id INTO v_conflict_type, v_conflict_id
  FROM pg_temp.studio_owner_backfill_candidates
  GROUP BY object_type, object_id
  HAVING count(DISTINCT created_by) > 1
  ORDER BY object_type, object_id
  LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'studio_owner_backfill_creator_conflict'; END IF;

  SELECT count(*) INTO v_owner_count
  FROM public.studio_members
  WHERE role = 'owner';
  SELECT user_id INTO v_owner_id
  FROM public.studio_members
  WHERE role = 'owner' AND is_active
  ORDER BY user_id
  LIMIT 1;
  IF v_owner_count > 1 THEN RAISE EXCEPTION 'studio_owner_backfill_multiple_owners'; END IF;

  -- A zero-Owner fresh installation is valid: NULL remains the established
  -- explicit Owner-only interpretation until bootstrap creates its Owner.
  -- Multiple Owner rows are never safe to resolve by guessing.

  -- Reject rather than silently replace any persisted attribution that does
  -- not equal the deterministic earliest successful creator (or the sole
  -- active Owner for a pre-Studio object).
  WITH candidates AS (
    SELECT DISTINCT ON (object_type, object_id) object_type, object_id, created_by
    FROM pg_temp.studio_owner_backfill_candidates
    ORDER BY object_type, object_id, job_created_at ASC, job_id ASC
  ), expected AS (
    SELECT object_type, object_id, created_by FROM candidates
    UNION ALL
    SELECT 'project', p.id, v_owner_id FROM public.projects p
    WHERE NOT EXISTS (SELECT 1 FROM candidates c WHERE c.object_type = 'project' AND c.object_id = p.id)
    UNION ALL
    SELECT 'listing', l.id, v_owner_id FROM public.listings l
    WHERE NOT EXISTS (SELECT 1 FROM candidates c WHERE c.object_type = 'listing' AND c.object_id = l.id)
  )
  SELECT e.created_by INTO v_existing_created_by
  FROM expected e JOIN public.studio_object_owners o
    ON o.object_type = e.object_type AND o.object_id = e.object_id
  WHERE o.created_by IS DISTINCT FROM e.created_by
  ORDER BY e.object_type, e.object_id
  LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'studio_owner_backfill_existing_owner_conflict'; END IF;

  WITH candidates AS (
    SELECT DISTINCT ON (object_type, object_id) object_type, object_id, created_by
    FROM pg_temp.studio_owner_backfill_candidates
    ORDER BY object_type, object_id, job_created_at ASC, job_id ASC
  ), expected AS (
    SELECT object_type, object_id, created_by FROM candidates
    UNION ALL
    SELECT 'project', p.id, v_owner_id FROM public.projects p
    WHERE NOT EXISTS (SELECT 1 FROM candidates c WHERE c.object_type = 'project' AND c.object_id = p.id)
    UNION ALL
    SELECT 'listing', l.id, v_owner_id FROM public.listings l
    WHERE NOT EXISTS (SELECT 1 FROM candidates c WHERE c.object_type = 'listing' AND c.object_id = l.id)
  )
  INSERT INTO public.studio_object_owners (object_type, object_id, created_by)
  SELECT e.object_type, e.object_id, e.created_by
  FROM expected e
  LEFT JOIN public.studio_object_owners o
    ON o.object_type = e.object_type AND o.object_id = e.object_id
  WHERE o.object_id IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.studio_backfill_existing_object_owners() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.studio_backfill_existing_object_owners() TO service_role;

-- Future creation already writes ownership in the same transaction. Tighten
-- that existing mechanism so a conflicting pre-existing attribution aborts
-- the whole transaction instead of being silently ignored.
CREATE OR REPLACE FUNCTION public.studio_publish_project(
  p_job_id UUID, p_token UUID, p_batch JSONB, p_publish BOOLEAN, p_result JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_job public.studio_upload_jobs; v_summary JSONB; v_project_id UUID;
  v_public TEXT; v_existing_created_by UUID;
BEGIN
  SELECT * INTO v_job FROM public.studio_upload_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'studio_job_not_found'; END IF;
  IF v_job.status = 'published' THEN
    RETURN jsonb_build_object('project_id', COALESCE(v_job.result_summary->>'projectId', ''),
      'project_slug', COALESCE(v_job.project_slug, ''),
      'public_status', COALESCE(v_job.result_summary->>'publicStatus', 'published'),
      'counts', COALESCE(v_job.result_summary->'counts', '{}'::jsonb), 'replayed', true);
  END IF;
  IF v_job.processing_token IS DISTINCT FROM p_token THEN RAISE EXCEPTION 'studio_job_not_claimed'; END IF;
  v_summary := public.forever_progressive_ingest(p_batch);
  v_project_id := (v_summary->>'project_id')::uuid;
  INSERT INTO public.studio_object_owners (object_type, object_id, created_by)
  VALUES ('project', v_project_id, v_job.created_by)
  ON CONFLICT (object_type, object_id) DO NOTHING;
  SELECT created_by INTO v_existing_created_by FROM public.studio_object_owners
    WHERE object_type = 'project' AND object_id = v_project_id FOR UPDATE;
  IF v_existing_created_by IS DISTINCT FROM v_job.created_by THEN
    RAISE EXCEPTION 'studio_object_ownership_conflict';
  END IF;
  IF p_publish THEN
    UPDATE public.projects SET public_status = 'published', is_active = true, updated_at = now()
      WHERE id = v_project_id;
    v_public := 'published';
  ELSE
    v_public := v_summary->>'public_status';
  END IF;
  UPDATE public.studio_upload_jobs SET status = 'published', processing_token = NULL,
    project_slug = v_summary->>'project_slug', content_fingerprint = p_batch->>'batch_fingerprint',
    result_summary = p_result || jsonb_build_object('projectId', v_project_id::text,
      'publicStatus', v_public, 'counts', v_summary->'counts'), error = NULL,
    error_code = NULL, finished_at = now(), updated_at = now() WHERE id = p_job_id;
  RETURN jsonb_build_object('project_id', v_project_id::text,
    'project_slug', v_summary->>'project_slug', 'public_status', v_public,
    'counts', v_summary->'counts', 'replayed', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.studio_publish_resale(
  p_job_id UUID, p_token UUID, p_listing JSONB, p_contact JSONB,
  p_warnings JSONB, p_result JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_job public.studio_upload_jobs; v_listing_id UUID; v_slug TEXT; v_item JSONB;
  v_existing_created_by UUID;
BEGIN
  SELECT * INTO v_job FROM public.studio_upload_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'studio_job_not_found'; END IF;
  IF v_job.status = 'published' THEN
    RETURN jsonb_build_object('listing_id', COALESCE(v_job.listing_id::text, ''),
      'slug', COALESCE(v_job.content_fingerprint, ''), 'replayed', true);
  END IF;
  IF v_job.processing_token IS DISTINCT FROM p_token THEN RAISE EXCEPTION 'studio_job_not_claimed'; END IF;
  v_slug := NULLIF(trim(p_listing->>'slug'), '');
  IF v_slug IS NULL THEN RAISE EXCEPTION 'studio_resale_slug_required'; END IF;
  INSERT INTO public.listings (
    kind,title,slug,project_id,project_name_raw,location_id,location_name_raw,property_type,
    bedrooms,bathrooms,area_sqm,price,currency,availability_status,description,photos,
    field_provenance,publication_status
  ) VALUES (
    'resale',p_listing->>'title',v_slug,(p_listing->>'project_id')::uuid,p_listing->>'project_name_raw',
    (p_listing->>'location_id')::uuid,p_listing->>'location_name_raw',p_listing->>'property_type',
    (p_listing->>'bedrooms')::int,(p_listing->>'bathrooms')::int,(p_listing->>'area_sqm')::numeric,
    (p_listing->>'price')::numeric,NULLIF(trim(COALESCE(p_listing->>'currency','')),''),
    COALESCE(NULLIF(trim(p_listing->>'availability_status'),''),'available'),p_listing->>'description',
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_listing->'photos','[]'::jsonb))),
    COALESCE(p_listing->'field_provenance','{}'::jsonb),'published'
  ) ON CONFLICT (slug) DO UPDATE SET
    title=EXCLUDED.title,project_id=EXCLUDED.project_id,project_name_raw=EXCLUDED.project_name_raw,
    location_id=EXCLUDED.location_id,location_name_raw=EXCLUDED.location_name_raw,
    property_type=EXCLUDED.property_type,bedrooms=EXCLUDED.bedrooms,bathrooms=EXCLUDED.bathrooms,
    area_sqm=EXCLUDED.area_sqm,price=EXCLUDED.price,currency=EXCLUDED.currency,
    availability_status=EXCLUDED.availability_status,description=EXCLUDED.description,
    photos=EXCLUDED.photos,field_provenance=EXCLUDED.field_provenance,
    publication_status='published',updated_at=now()
  RETURNING id INTO v_listing_id;
  INSERT INTO public.studio_object_owners (object_type, object_id, created_by)
  VALUES ('listing', v_listing_id, v_job.created_by)
  ON CONFLICT (object_type, object_id) DO NOTHING;
  SELECT created_by INTO v_existing_created_by FROM public.studio_object_owners
    WHERE object_type = 'listing' AND object_id = v_listing_id FOR UPDATE;
  IF v_existing_created_by IS DISTINCT FROM v_job.created_by THEN
    RAISE EXCEPTION 'studio_object_ownership_conflict';
  END IF;
  INSERT INTO public.studio_listing_contacts (listing_id,contact_name,contact_phone,contact_email)
  VALUES (v_listing_id,NULLIF(trim(p_contact->>'contact_name'),''),NULLIF(trim(p_contact->>'contact_phone'),''),NULLIF(trim(p_contact->>'contact_email'),''))
  ON CONFLICT (listing_id) DO UPDATE SET contact_name=EXCLUDED.contact_name,
    contact_phone=EXCLUDED.contact_phone,contact_email=EXCLUDED.contact_email,updated_at=now();
  DELETE FROM public.ingestion_warnings WHERE listing_id = v_listing_id;
  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_warnings,'[]'::jsonb)) LOOP
    INSERT INTO public.ingestion_warnings (listing_id,entity,field,code,severity,message,payload)
    VALUES (v_listing_id,v_item->>'entity',v_item->>'field',v_item->>'code',
      COALESCE(v_item->>'severity','warning'),v_item->>'message',COALESCE(v_item->'payload','{}'::jsonb));
  END LOOP;
  UPDATE public.studio_upload_jobs SET status='published',processing_token=NULL,listing_id=v_listing_id,
    content_fingerprint=v_slug,result_summary=p_result || jsonb_build_object('listingId',v_listing_id::text,'slug',v_slug),
    error=NULL,error_code=NULL,finished_at=now(),updated_at=now() WHERE id=p_job_id;
  RETURN jsonb_build_object('listing_id',v_listing_id::text,'slug',v_slug,'replayed',false);
END;
$$;

REVOKE ALL ON FUNCTION public.studio_publish_project(uuid, uuid, jsonb, boolean, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.studio_publish_resale(uuid, uuid, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.studio_publish_project(uuid, uuid, jsonb, boolean, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.studio_publish_resale(uuid, uuid, jsonb, jsonb, jsonb, jsonb) TO service_role;

SELECT public.studio_backfill_existing_object_owners();

COMMIT;
