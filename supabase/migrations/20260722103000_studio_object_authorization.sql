-- FOREVER-STUDIO-001: durable per-object publisher authorization.
--
-- Studio calls use a service-role data layer, so publisher identity must be
-- persisted in an internal ACL table and checked by the app-server
-- boundary before returning any private data or issuing a mutation.  NULL is
-- intentionally legacy/unassigned and is Owner-only; it never grants a
-- Trusted Publisher access by omission.
BEGIN;

CREATE TABLE IF NOT EXISTS public.studio_object_owners (
  object_type TEXT NOT NULL CHECK (object_type IN ('project', 'listing')),
  object_id UUID NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (object_type, object_id)
);
COMMENT ON TABLE public.studio_object_owners IS
  'Private Studio project/listing ownership attribution. RLS on with no policies; legacy objects have no row and are Owner-only.';
REVOKE ALL ON TABLE public.studio_object_owners FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.studio_object_owners TO service_role;
ALTER TABLE public.studio_object_owners ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_studio_object_owners_created_by
  ON public.studio_object_owners(created_by, object_type);

-- Attribute a project exactly once, in the same transaction as its Studio
-- publication.  Existing attribution is immutable, including on enrich.
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
  v_summary JSONB;
  v_project_id UUID;
  v_public TEXT;
BEGIN
  SELECT * INTO v_job FROM public.studio_upload_jobs WHERE id = p_job_id FOR UPDATE;
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

  v_summary := public.forever_progressive_ingest(p_batch);
  v_project_id := (v_summary->>'project_id')::uuid;
  INSERT INTO public.studio_object_owners (object_type, object_id, created_by)
  VALUES ('project', v_project_id, v_job.created_by)
  ON CONFLICT (object_type, object_id) DO NOTHING;

  IF p_publish THEN
    UPDATE public.projects SET public_status = 'published', is_active = true, updated_at = now()
      WHERE id = v_project_id;
    v_public := 'published';
  ELSE
    v_public := v_summary->>'public_status';
  END IF;

  UPDATE public.studio_upload_jobs
    SET status = 'published', processing_token = NULL,
        project_slug = v_summary->>'project_slug', content_fingerprint = p_batch->>'batch_fingerprint',
        result_summary = p_result || jsonb_build_object(
          'projectId', v_project_id::text, 'publicStatus', v_public, 'counts', v_summary->'counts'),
        error = NULL, error_code = NULL, finished_at = now(), updated_at = now()
    WHERE id = p_job_id;
  RETURN jsonb_build_object(
    'project_id', v_project_id::text, 'project_slug', v_summary->>'project_slug',
    'public_status', v_public, 'counts', v_summary->'counts', 'replayed', false);
END;
$$;

-- Keep the existing resale transaction but persist the creator internally
-- and never transfer it on a deterministic-slug conflict.
CREATE OR REPLACE FUNCTION public.studio_publish_resale(
  p_job_id UUID, p_token UUID, p_listing JSONB, p_contact JSONB,
  p_warnings JSONB, p_result JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_job public.studio_upload_jobs; v_listing_id UUID; v_slug TEXT; v_item JSONB;
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
    photos=EXCLUDED.photos,field_provenance=EXCLUDED.field_provenance,publication_status='published',updated_at=now()
  RETURNING id INTO v_listing_id;

  INSERT INTO public.studio_object_owners (object_type, object_id, created_by)
  VALUES ('listing', v_listing_id, v_job.created_by)
  ON CONFLICT (object_type, object_id) DO NOTHING;

  INSERT INTO public.studio_listing_contacts (listing_id,contact_name,contact_phone,contact_email)
  VALUES (v_listing_id,NULLIF(trim(p_contact->>'contact_name'),''),NULLIF(trim(p_contact->>'contact_phone'),''),NULLIF(trim(p_contact->>'contact_email'),''))
  ON CONFLICT (listing_id) DO UPDATE SET contact_name=EXCLUDED.contact_name,contact_phone=EXCLUDED.contact_phone,
    contact_email=EXCLUDED.contact_email,updated_at=now();
  DELETE FROM public.ingestion_warnings WHERE listing_id=v_listing_id;
  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_warnings,'[]'::jsonb)) LOOP
    INSERT INTO public.ingestion_warnings (listing_id,entity,field,code,severity,message,payload)
    VALUES (v_listing_id,v_item->>'entity',v_item->>'field',v_item->>'code',COALESCE(v_item->>'severity','warning'),v_item->>'message',COALESCE(v_item->'payload','{}'::jsonb));
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

COMMIT;
