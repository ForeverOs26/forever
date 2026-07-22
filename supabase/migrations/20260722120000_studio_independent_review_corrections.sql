-- FOREVER-STUDIO-003: additive corrections from the independent Owner review.
-- Applied migrations are intentionally untouched. This migration adds a
-- durable processing-readiness boundary, corrects current-role ownership
-- authorization, and makes resale editing one service-role-only transaction.
BEGIN;

-- A received job is only an upload manifest until the browser explicitly
-- reports that every intended upload attempt has finished. Automatic resume
-- may claim a job only after this durable marker exists.
ALTER TABLE public.studio_upload_jobs
  ADD COLUMN IF NOT EXISTS processing_requested_at TIMESTAMPTZ;

-- Jobs that had already entered processing before this correction necessarily
-- crossed the old implicit boundary. Pristine received jobs are deliberately
-- left NULL because their uploads may still be in flight.
UPDATE public.studio_upload_jobs
SET processing_requested_at = COALESCE(
      processing_requested_at,
      finished_at,
      processing_started_at,
      updated_at,
      created_at
    )
WHERE processing_requested_at IS NULL
  AND status IN ('processing', 'published', 'failed');

CREATE INDEX IF NOT EXISTS idx_studio_upload_jobs_processing_ready_due
  ON public.studio_upload_jobs(status, processing_requested_at, processing_started_at)
  WHERE processing_requested_at IS NOT NULL;

-- The prior deterministic backfill intentionally represented a zero-Owner
-- installation with NULL attribution rows. Once exactly one active Owner is
-- enrolled, those rows are still legacy/unassigned and may deterministically
-- become that Owner's attribution. Preserve the strict validator behind a
-- wrapper so replay remains safe and never overwrites a non-NULL creator.
ALTER FUNCTION public.studio_backfill_existing_object_owners()
  RENAME TO studio_backfill_existing_object_owners_strict_20260722110000;

CREATE OR REPLACE FUNCTION public.studio_backfill_existing_object_owners()
RETURNS VOID
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_owner_count INTEGER;
  v_active_owner UUID;
BEGIN
  SELECT count(*) INTO v_owner_count
  FROM public.studio_members
  WHERE role = 'owner';
  SELECT user_id INTO v_active_owner
  FROM public.studio_members
  WHERE role = 'owner' AND is_active
  ORDER BY user_id
  LIMIT 1;

  IF v_owner_count = 1 AND v_active_owner IS NOT NULL THEN
    UPDATE public.studio_object_owners
    SET created_by = v_active_owner
    WHERE created_by IS NULL;
  END IF;

  PERFORM public.studio_backfill_existing_object_owners_strict_20260722110000();
END;
$$;

CREATE OR REPLACE FUNCTION public.studio_claim_job(
  p_job_id UUID,
  p_token UUID,
  p_stale_seconds INTEGER DEFAULT 900
) RETURNS SETOF public.studio_upload_jobs
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
    UPDATE public.studio_upload_jobs
    SET status = 'processing',
        processing_token = p_token,
        processing_started_at = now(),
        attempt_count = attempt_count + 1,
        error = NULL,
        error_code = NULL,
        updated_at = now()
    WHERE id = p_job_id
      AND processing_requested_at IS NOT NULL
      AND status <> 'published'
      AND (
        status = 'received'
        OR (status = 'failed' AND retryable IS TRUE)
        OR (status = 'processing'
            AND (processing_started_at IS NULL
                 OR processing_started_at < now() - make_interval(secs => p_stale_seconds)))
      )
    RETURNING *;
END;
$$;

-- The explicit process request records readiness and obtains the first claim
-- in the same transaction. A disconnected request therefore leaves either no
-- readiness marker or a durable, automatically resumable job.
CREATE OR REPLACE FUNCTION public.studio_request_job_processing(
  p_job_id UUID,
  p_token UUID,
  p_stale_seconds INTEGER DEFAULT 900
) RETURNS SETOF public.studio_upload_jobs
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  UPDATE public.studio_upload_jobs
  SET processing_requested_at = COALESCE(processing_requested_at, now()),
      updated_at = now()
  WHERE id = p_job_id
    AND status <> 'published';

  RETURN QUERY
    SELECT * FROM public.studio_claim_job(p_job_id, p_token, p_stale_seconds);
END;
$$;

-- Ownership is immutable creation attribution, not update authorization.
-- Resolve the actor's CURRENT active role from studio_members; creator_role is
-- retained audit history only and is never trusted for this decision.
CREATE OR REPLACE FUNCTION public.studio_publish_project(
  p_job_id UUID,
  p_token UUID,
  p_batch JSONB,
  p_publish BOOLEAN,
  p_result JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_job public.studio_upload_jobs;
  v_actor_role TEXT;
  v_summary JSONB;
  v_project_id UUID;
  v_existing_project_id UUID;
  v_existing_created_by UUID;
  v_had_owner_row BOOLEAN := false;
  v_slug TEXT;
  v_public TEXT;
BEGIN
  SELECT * INTO v_job
  FROM public.studio_upload_jobs
  WHERE id = p_job_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'studio_job_not_found'; END IF;
  IF v_job.status = 'published' THEN
    RETURN jsonb_build_object(
      'project_id', COALESCE(v_job.result_summary->>'projectId', ''),
      'project_slug', COALESCE(v_job.project_slug, ''),
      'public_status', COALESCE(v_job.result_summary->>'publicStatus', 'published'),
      'counts', COALESCE(v_job.result_summary->'counts', '{}'::jsonb),
      'replayed', true);
  END IF;
  IF v_job.processing_token IS DISTINCT FROM p_token THEN
    RAISE EXCEPTION 'studio_job_not_claimed';
  END IF;

  SELECT role INTO v_actor_role
  FROM public.studio_members
  WHERE user_id = v_job.created_by AND is_active
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'studio_membership_required'; END IF;

  v_slug := NULLIF(trim(p_batch->'project'->>'slug'), '');
  IF v_slug IS NULL THEN RAISE EXCEPTION 'studio_project_slug_required'; END IF;

  SELECT id INTO v_existing_project_id
  FROM public.projects
  WHERE slug = v_slug
  FOR UPDATE;

  IF v_existing_project_id IS NOT NULL THEN
    SELECT created_by INTO v_existing_created_by
    FROM public.studio_object_owners
    WHERE object_type = 'project' AND object_id = v_existing_project_id
    FOR UPDATE;
    v_had_owner_row := FOUND AND v_existing_created_by IS NOT NULL;

    IF v_actor_role = 'trusted_publisher'
       AND (NOT v_had_owner_row OR v_existing_created_by IS DISTINCT FROM v_job.created_by) THEN
      RAISE EXCEPTION 'studio_object_ownership_conflict';
    END IF;
  END IF;

  v_summary := public.forever_progressive_ingest(p_batch);
  v_project_id := (v_summary->>'project_id')::uuid;

  IF v_existing_project_id IS NULL THEN
    -- Creation attribution is written exactly once. A concurrent conflicting
    -- creation for the same slug aborts this whole transaction.
    INSERT INTO public.studio_object_owners (object_type, object_id, created_by)
    VALUES ('project', v_project_id, v_job.created_by)
    ON CONFLICT (object_type, object_id) DO UPDATE
      SET created_by = EXCLUDED.created_by
      WHERE public.studio_object_owners.created_by IS NULL;

    SELECT created_by INTO v_existing_created_by
    FROM public.studio_object_owners
    WHERE object_type = 'project' AND object_id = v_project_id
    FOR UPDATE;
    IF v_existing_created_by IS DISTINCT FROM v_job.created_by THEN
      RAISE EXCEPTION 'studio_object_ownership_conflict';
    END IF;
  ELSIF v_project_id IS DISTINCT FROM v_existing_project_id THEN
    RAISE EXCEPTION 'studio_project_target_conflict';
  ELSIF v_actor_role = 'owner' AND NOT v_had_owner_row THEN
    -- A truly unassigned legacy object remains Owner-only and may receive the
    -- sole active Owner attribution on its first Owner update.
    INSERT INTO public.studio_object_owners (object_type, object_id, created_by)
    VALUES ('project', v_project_id, v_job.created_by)
    ON CONFLICT (object_type, object_id) DO UPDATE
      SET created_by = EXCLUDED.created_by
      WHERE public.studio_object_owners.created_by IS NULL;
  END IF;

  IF p_publish THEN
    UPDATE public.projects
    SET public_status = 'published', is_active = true, updated_at = now()
    WHERE id = v_project_id;
    v_public := 'published';
  ELSE
    v_public := v_summary->>'public_status';
  END IF;

  UPDATE public.studio_upload_jobs
  SET status = 'published',
      processing_token = NULL,
      project_slug = v_summary->>'project_slug',
      content_fingerprint = p_batch->>'batch_fingerprint',
      result_summary = p_result || jsonb_build_object(
        'projectId', v_project_id::text,
        'publicStatus', v_public,
        'counts', v_summary->'counts'),
      error = NULL,
      error_code = NULL,
      finished_at = now(),
      updated_at = now()
  WHERE id = p_job_id;

  RETURN jsonb_build_object(
    'project_id', v_project_id::text,
    'project_slug', v_summary->>'project_slug',
    'public_status', v_public,
    'counts', v_summary->'counts',
    'replayed', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.studio_publish_resale(
  p_job_id UUID,
  p_token UUID,
  p_listing JSONB,
  p_contact JSONB,
  p_warnings JSONB,
  p_result JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_job public.studio_upload_jobs;
  v_actor_role TEXT;
  v_listing_id UUID;
  v_existing_listing_id UUID;
  v_existing_created_by UUID;
  v_had_owner_row BOOLEAN := false;
  v_slug TEXT;
  v_item JSONB;
BEGIN
  SELECT * INTO v_job FROM public.studio_upload_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'studio_job_not_found'; END IF;
  IF v_job.status = 'published' THEN
    RETURN jsonb_build_object(
      'listing_id', COALESCE(v_job.listing_id::text, ''),
      'slug', COALESCE(v_job.content_fingerprint, ''),
      'replayed', true);
  END IF;
  IF v_job.processing_token IS DISTINCT FROM p_token THEN
    RAISE EXCEPTION 'studio_job_not_claimed';
  END IF;

  SELECT role INTO v_actor_role
  FROM public.studio_members
  WHERE user_id = v_job.created_by AND is_active
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'studio_membership_required'; END IF;

  v_slug := NULLIF(trim(p_listing->>'slug'), '');
  IF v_slug IS NULL THEN RAISE EXCEPTION 'studio_resale_slug_required'; END IF;

  SELECT id INTO v_existing_listing_id
  FROM public.listings
  WHERE slug = v_slug
  FOR UPDATE;
  IF v_existing_listing_id IS NOT NULL THEN
    SELECT created_by INTO v_existing_created_by
    FROM public.studio_object_owners
    WHERE object_type = 'listing' AND object_id = v_existing_listing_id
    FOR UPDATE;
    v_had_owner_row := FOUND AND v_existing_created_by IS NOT NULL;
    IF v_actor_role = 'trusted_publisher'
       AND (NOT v_had_owner_row OR v_existing_created_by IS DISTINCT FROM v_job.created_by) THEN
      RAISE EXCEPTION 'studio_object_ownership_conflict';
    END IF;
  END IF;

  INSERT INTO public.listings (
    kind,title,slug,project_id,project_name_raw,location_id,location_name_raw,property_type,
    bedrooms,bathrooms,area_sqm,price,currency,availability_status,description,photos,
    field_provenance,publication_status
  ) VALUES (
    'resale',p_listing->>'title',v_slug,(p_listing->>'project_id')::uuid,
    p_listing->>'project_name_raw',(p_listing->>'location_id')::uuid,
    p_listing->>'location_name_raw',p_listing->>'property_type',
    (p_listing->>'bedrooms')::int,(p_listing->>'bathrooms')::int,
    (p_listing->>'area_sqm')::numeric,(p_listing->>'price')::numeric,
    NULLIF(trim(COALESCE(p_listing->>'currency','')),''),
    COALESCE(NULLIF(trim(p_listing->>'availability_status'),''),'available'),
    p_listing->>'description',
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_listing->'photos','[]'::jsonb))),
    COALESCE(p_listing->'field_provenance','{}'::jsonb),'published'
  ) ON CONFLICT (slug) DO UPDATE SET
    title=EXCLUDED.title,project_id=EXCLUDED.project_id,
    project_name_raw=EXCLUDED.project_name_raw,location_id=EXCLUDED.location_id,
    location_name_raw=EXCLUDED.location_name_raw,property_type=EXCLUDED.property_type,
    bedrooms=EXCLUDED.bedrooms,bathrooms=EXCLUDED.bathrooms,area_sqm=EXCLUDED.area_sqm,
    price=EXCLUDED.price,currency=EXCLUDED.currency,
    availability_status=EXCLUDED.availability_status,description=EXCLUDED.description,
    photos=EXCLUDED.photos,field_provenance=EXCLUDED.field_provenance,
    publication_status='published',updated_at=now()
  RETURNING id INTO v_listing_id;

  IF v_existing_listing_id IS NULL THEN
    INSERT INTO public.studio_object_owners (object_type, object_id, created_by)
    VALUES ('listing', v_listing_id, v_job.created_by)
    ON CONFLICT (object_type, object_id) DO UPDATE
      SET created_by = EXCLUDED.created_by
      WHERE public.studio_object_owners.created_by IS NULL;
    SELECT created_by INTO v_existing_created_by
    FROM public.studio_object_owners
    WHERE object_type = 'listing' AND object_id = v_listing_id
    FOR UPDATE;
    IF v_existing_created_by IS DISTINCT FROM v_job.created_by THEN
      RAISE EXCEPTION 'studio_object_ownership_conflict';
    END IF;
  ELSIF v_listing_id IS DISTINCT FROM v_existing_listing_id THEN
    RAISE EXCEPTION 'studio_listing_target_conflict';
  ELSIF v_actor_role = 'owner' AND NOT v_had_owner_row THEN
    INSERT INTO public.studio_object_owners (object_type, object_id, created_by)
    VALUES ('listing', v_listing_id, v_job.created_by)
    ON CONFLICT (object_type, object_id) DO UPDATE
      SET created_by = EXCLUDED.created_by
      WHERE public.studio_object_owners.created_by IS NULL;
  END IF;

  INSERT INTO public.studio_listing_contacts (
    listing_id,contact_name,contact_phone,contact_email
  ) VALUES (
    v_listing_id,NULLIF(trim(p_contact->>'contact_name'),''),
    NULLIF(trim(p_contact->>'contact_phone'),''),NULLIF(trim(p_contact->>'contact_email'),'')
  ) ON CONFLICT (listing_id) DO UPDATE SET
    contact_name=EXCLUDED.contact_name,contact_phone=EXCLUDED.contact_phone,
    contact_email=EXCLUDED.contact_email,updated_at=now();

  DELETE FROM public.ingestion_warnings WHERE listing_id = v_listing_id;
  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_warnings,'[]'::jsonb)) LOOP
    INSERT INTO public.ingestion_warnings (
      listing_id,entity,field,code,severity,message,payload
    ) VALUES (
      v_listing_id,v_item->>'entity',v_item->>'field',v_item->>'code',
      COALESCE(v_item->>'severity','warning'),v_item->>'message',
      COALESCE(v_item->'payload','{}'::jsonb));
  END LOOP;

  UPDATE public.studio_upload_jobs
  SET status='published',processing_token=NULL,listing_id=v_listing_id,
      content_fingerprint=v_slug,
      result_summary=p_result || jsonb_build_object('listingId',v_listing_id::text,'slug',v_slug),
      error=NULL,error_code=NULL,finished_at=now(),updated_at=now()
  WHERE id=p_job_id;

  RETURN jsonb_build_object('listing_id',v_listing_id::text,'slug',v_slug,'replayed',false);
END;
$$;

-- Atomic resale edit. Provenance is evaluated while the listing row is
-- locked, public facts/private contact/conflict warnings commit together, and
-- exact replay cannot duplicate a warning. p_inject_failure exists only for
-- transactional rollback verification through the service-role test client.
CREATE OR REPLACE FUNCTION public.studio_update_resale(
  p_listing_id UUID,
  p_actor_id UUID,
  p_fields JSONB,
  p_contact JSONB,
  p_supplied_at TIMESTAMPTZ,
  p_inject_failure BOOLEAN DEFAULT false
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_listing public.listings;
  v_actor_role TEXT;
  v_created_by UUID;
  v_had_owner_row BOOLEAN := false;
  v_fact_key TEXT;
  v_column TEXT;
  v_value JSONB;
  v_current JSONB;
  v_existing JSONB;
  v_existing_status TEXT;
  v_existing_rank INTEGER;
  v_incoming_status TEXT;
  v_incoming_rank INTEGER;
  v_patch JSONB := '{}'::jsonb;
  v_provenance JSONB;
  v_conflicts JSONB := '[]'::jsonb;
  v_warning JSONB;
  v_message TEXT;
BEGIN
  SELECT role INTO v_actor_role
  FROM public.studio_members
  WHERE user_id = p_actor_id AND is_active
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'studio_membership_required'; END IF;

  SELECT * INTO v_listing
  FROM public.listings
  WHERE id = p_listing_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'listing_not_found'; END IF;

  SELECT created_by INTO v_created_by
  FROM public.studio_object_owners
  WHERE object_type='listing' AND object_id=p_listing_id
  FOR UPDATE;
  v_had_owner_row := FOUND AND v_created_by IS NOT NULL;
  IF v_actor_role = 'trusted_publisher'
     AND (NOT v_had_owner_row OR v_created_by IS DISTINCT FROM p_actor_id) THEN
    RAISE EXCEPTION 'studio_object_ownership_conflict';
  END IF;
  IF v_actor_role = 'owner' AND NOT v_had_owner_row THEN
    INSERT INTO public.studio_object_owners(object_type,object_id,created_by)
    VALUES ('listing',p_listing_id,p_actor_id)
    ON CONFLICT (object_type,object_id) DO UPDATE
      SET created_by=EXCLUDED.created_by
      WHERE public.studio_object_owners.created_by IS NULL;
  END IF;

  v_incoming_status := CASE v_actor_role
    WHEN 'owner' THEN 'owner_provided'
    ELSE 'trusted_publisher_provided'
  END;
  v_incoming_rank := CASE v_incoming_status
    WHEN 'owner_provided' THEN 78
    ELSE 65
  END;
  v_provenance := COALESCE(v_listing.field_provenance, '{}'::jsonb);

  FOR v_fact_key, v_column IN
    SELECT * FROM (VALUES
      ('title','title'),
      ('projectName','project_name_raw'),
      ('locationText','location_name_raw'),
      ('propertyType','property_type'),
      ('bedrooms','bedrooms'),
      ('bathrooms','bathrooms'),
      ('areaSqm','area_sqm'),
      ('price','price'),
      ('currency','currency'),
      ('description','description')
    ) AS mapping(fact_key,column_name)
  LOOP
    IF NOT COALESCE(p_fields, '{}'::jsonb) ? v_fact_key THEN CONTINUE; END IF;
    v_value := p_fields->v_fact_key;
    v_current := to_jsonb(v_listing)->v_column;
    v_existing := v_provenance->v_fact_key;
    v_existing_status := v_existing->>'status';
    v_existing_rank := CASE v_existing_status
      WHEN 'owner_verified' THEN 100
      WHEN 'official_source' THEN 90
      WHEN 'developer_provided' THEN 80
      WHEN 'owner_provided' THEN 78
      WHEN 'partner_provided' THEN 70
      WHEN 'trusted_publisher_provided' THEN 65
      WHEN 'extracted' THEN 50
      WHEN 'inferred' THEN 30
      WHEN 'unverified' THEN 10
      ELSE 0
    END;

    IF v_current IS NULL OR v_current = 'null'::jsonb OR v_current = '""'::jsonb
       OR v_existing IS NULL
       OR (v_existing_status <> 'owner_verified' AND v_incoming_rank >= v_existing_rank) THEN
      v_patch := jsonb_set(v_patch, ARRAY[v_column], v_value, true);
      v_provenance := jsonb_set(
        v_provenance,
        ARRAY[v_fact_key],
        jsonb_build_object(
          'status',v_incoming_status,
          'supplied_at',p_supplied_at,
          'note','studio_manual_entry'),
        true);
    ELSE
      v_message := format(
        '%s: the current value was set by a stronger source (%s) and was preserved; the attempted change by %s was recorded, not applied.',
        v_column,COALESCE(v_existing_status,'unknown'),v_actor_role);
      v_warning := jsonb_build_object(
        'entity','listing','field',v_column,
        'code','listing_field_conflict_preserved','severity','warning',
        'message',v_message,
        'payload',jsonb_build_object(
          'attempted_by',v_actor_role,
          'attempted_status',v_incoming_status));
      v_conflicts := v_conflicts || jsonb_build_array(v_warning);

      INSERT INTO public.ingestion_warnings (
        listing_id,entity,field,code,severity,message,payload
      )
      SELECT p_listing_id,'listing',v_column,'listing_field_conflict_preserved',
             'warning',v_message,v_warning->'payload'
      WHERE NOT EXISTS (
        SELECT 1 FROM public.ingestion_warnings
        WHERE listing_id=p_listing_id
          AND entity='listing'
          AND field=v_column
          AND code='listing_field_conflict_preserved'
          AND message=v_message
          AND payload=v_warning->'payload');
    END IF;
  END LOOP;

  IF v_patch <> '{}'::jsonb THEN
    UPDATE public.listings SET
      title=CASE WHEN v_patch ? 'title' THEN v_patch->>'title' ELSE title END,
      project_name_raw=CASE WHEN v_patch ? 'project_name_raw' THEN v_patch->>'project_name_raw' ELSE project_name_raw END,
      location_name_raw=CASE WHEN v_patch ? 'location_name_raw' THEN v_patch->>'location_name_raw' ELSE location_name_raw END,
      property_type=CASE WHEN v_patch ? 'property_type' THEN v_patch->>'property_type' ELSE property_type END,
      bedrooms=CASE WHEN v_patch ? 'bedrooms' THEN (v_patch->>'bedrooms')::int ELSE bedrooms END,
      bathrooms=CASE WHEN v_patch ? 'bathrooms' THEN (v_patch->>'bathrooms')::int ELSE bathrooms END,
      area_sqm=CASE WHEN v_patch ? 'area_sqm' THEN (v_patch->>'area_sqm')::numeric ELSE area_sqm END,
      price=CASE WHEN v_patch ? 'price' THEN (v_patch->>'price')::numeric ELSE price END,
      currency=CASE WHEN v_patch ? 'currency' THEN v_patch->>'currency' ELSE currency END,
      description=CASE WHEN v_patch ? 'description' THEN v_patch->>'description' ELSE description END,
      field_provenance=v_provenance,
      updated_at=now()
    WHERE id=p_listing_id;
  END IF;

  IF COALESCE(p_contact, '{}'::jsonb) <> '{}'::jsonb THEN
    INSERT INTO public.studio_listing_contacts (
      listing_id,contact_name,contact_phone,contact_email
    ) VALUES (
      p_listing_id,
      CASE WHEN p_contact ? 'contact_name' THEN NULLIF(trim(p_contact->>'contact_name'),'') END,
      CASE WHEN p_contact ? 'contact_phone' THEN NULLIF(trim(p_contact->>'contact_phone'),'') END,
      CASE WHEN p_contact ? 'contact_email' THEN NULLIF(trim(p_contact->>'contact_email'),'') END
    ) ON CONFLICT (listing_id) DO UPDATE SET
      contact_name=CASE WHEN p_contact ? 'contact_name' THEN EXCLUDED.contact_name ELSE public.studio_listing_contacts.contact_name END,
      contact_phone=CASE WHEN p_contact ? 'contact_phone' THEN EXCLUDED.contact_phone ELSE public.studio_listing_contacts.contact_phone END,
      contact_email=CASE WHEN p_contact ? 'contact_email' THEN EXCLUDED.contact_email ELSE public.studio_listing_contacts.contact_email END,
      updated_at=now();
  END IF;

  IF p_inject_failure THEN RAISE EXCEPTION 'studio_resale_edit_injected_failure'; END IF;

  RETURN jsonb_build_object(
    'listing_id',p_listing_id::text,
    'warnings',v_conflicts,
    'applied_fields',COALESCE((SELECT jsonb_agg(key) FROM jsonb_object_keys(v_patch) key),'[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.studio_claim_job(uuid,uuid,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.studio_backfill_existing_object_owners_strict_20260722110000() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.studio_backfill_existing_object_owners() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.studio_request_job_processing(uuid,uuid,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.studio_publish_project(uuid,uuid,jsonb,boolean,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.studio_publish_resale(uuid,uuid,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.studio_update_resale(uuid,uuid,jsonb,jsonb,timestamptz,boolean) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.studio_claim_job(uuid,uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.studio_backfill_existing_object_owners_strict_20260722110000() TO service_role;
GRANT EXECUTE ON FUNCTION public.studio_backfill_existing_object_owners() TO service_role;
GRANT EXECUTE ON FUNCTION public.studio_request_job_processing(uuid,uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.studio_publish_project(uuid,uuid,jsonb,boolean,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.studio_publish_resale(uuid,uuid,jsonb,jsonb,jsonb,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.studio_update_resale(uuid,uuid,jsonb,jsonb,timestamptz,boolean) TO service_role;

COMMIT;
