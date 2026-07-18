-- RC5.6P: single-use controlled canonical prerequisite boundary.
-- Scope is deliberately limited to coralina-prerequisites-v1 and can create
-- at most one exact developer and one exact location. It cannot write Coralina
-- projects, buildings, units, or price history and exposes no update/delete path.

BEGIN;

CREATE TABLE IF NOT EXISTS forever_import.prerequisite_execution_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_digest TEXT NOT NULL UNIQUE CHECK (approval_digest ~ '^[0-9a-f]{64}$'),
  package_id TEXT NOT NULL UNIQUE CHECK (package_id = 'coralina-prerequisites-v1'),
  target TEXT NOT NULL CHECK (target = 'production'),
  target_project_id TEXT NOT NULL CHECK (target_project_id = 'abtvsrcnfwlbawvrjeed'),
  repository_head TEXT NOT NULL CHECK (repository_head ~ '^[0-9a-f]{40}$'),
  operation_count INTEGER NOT NULL CHECK (operation_count BETWEEN 0 AND 2),
  approved_request JSONB NOT NULL,
  approved_request_digest TEXT NOT NULL CHECK (approved_request_digest ~ '^[0-9a-f]{64}$'),
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  execution_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (expires_at > issued_at AND expires_at <= issued_at + INTERVAL '1 hour'),
  CHECK ((consumed_at IS NULL) = (execution_id IS NULL)),
  CHECK (approval_digest = approved_request->>'approvalDigest'),
  CHECK (package_id = approved_request->>'packageId'),
  CHECK (target = approved_request->>'target'),
  CHECK (target_project_id = approved_request->>'targetProjectId'),
  CHECK (repository_head = approved_request->>'repositoryHead'),
  CHECK (operation_count = (approved_request->'operationCounts'->>'operations')::INTEGER)
);

CREATE TABLE IF NOT EXISTS forever_import.prerequisite_execution_receipts (
  execution_id UUID PRIMARY KEY,
  approval_digest TEXT NOT NULL UNIQUE CHECK (approval_digest ~ '^[0-9a-f]{64}$'),
  approved_request_digest TEXT NOT NULL CHECK (approved_request_digest ~ '^[0-9a-f]{64}$'),
  package_id TEXT NOT NULL UNIQUE CHECK (package_id = 'coralina-prerequisites-v1'),
  developer_slug TEXT,
  location_slug TEXT,
  developers_written INTEGER NOT NULL CHECK (developers_written BETWEEN 0 AND 1),
  locations_written INTEGER NOT NULL CHECK (locations_written BETWEEN 0 AND 1),
  writes_performed INTEGER NOT NULL CHECK (writes_performed = developers_written + locations_written),
  outcome TEXT NOT NULL CHECK (outcome = 'committed'),
  committed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE forever_import.prerequisite_execution_approvals FROM PUBLIC;
REVOKE ALL ON TABLE forever_import.prerequisite_execution_receipts FROM PUBLIC;
ALTER TABLE forever_import.prerequisite_execution_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE forever_import.prerequisite_execution_receipts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION forever_import.validate_prerequisite_request(request JSONB)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_keys TEXT[];
  v_counts JSONB;
  v_entities JSONB;
  v_developer JSONB;
  v_location JSONB;
  v_developers INTEGER;
  v_locations INTEGER;
  v_operations INTEGER;
  v_text TEXT;
BEGIN
  IF request IS NULL OR jsonb_typeof(request) <> 'object' OR pg_column_size(request) > 32768 THEN
    RAISE EXCEPTION 'forever_prerequisite_execution: request_malformed';
  END IF;
  SELECT coalesce(array_agg(k ORDER BY k), ARRAY[]::TEXT[]) INTO v_keys
    FROM jsonb_object_keys(request) AS t(k);
  IF v_keys <> ARRAY[
    'approvalDigest','entities','manifestFingerprint','operationCounts','operationType',
    'packageId','repositoryHead','requestFingerprint','schemaVersion','target','targetProjectId'
  ] THEN RAISE EXCEPTION 'forever_prerequisite_execution: request_unsupported_property'; END IF;
  IF request->>'schemaVersion' IS DISTINCT FROM '1'
    OR request->>'operationType' IS DISTINCT FROM 'canonical_prerequisites'
    OR request->>'packageId' IS DISTINCT FROM 'coralina-prerequisites-v1'
    OR request->>'target' IS DISTINCT FROM 'production'
    OR request->>'targetProjectId' IS DISTINCT FROM 'abtvsrcnfwlbawvrjeed'
    OR request->>'repositoryHead' !~ '^[0-9a-f]{40}$'
    OR request->>'approvalDigest' !~ '^[0-9a-f]{64}$'
    OR request->>'requestFingerprint' !~ '^[0-9a-f]{64}$'
    OR request->>'manifestFingerprint' !~ '^[0-9a-f]{64}$'
  THEN RAISE EXCEPTION 'forever_prerequisite_execution: request_invalid_field'; END IF;

  v_counts := request->'operationCounts';
  IF jsonb_typeof(v_counts) <> 'object' THEN RAISE EXCEPTION 'forever_prerequisite_execution: request_counts_invalid'; END IF;
  SELECT coalesce(array_agg(k ORDER BY k), ARRAY[]::TEXT[]) INTO v_keys
    FROM jsonb_object_keys(v_counts) AS t(k);
  IF v_keys <> ARRAY['developers','locations','operations']
    OR jsonb_typeof(v_counts->'developers') <> 'number'
    OR jsonb_typeof(v_counts->'locations') <> 'number'
    OR jsonb_typeof(v_counts->'operations') <> 'number'
    OR v_counts->>'developers' !~ '^[0-1]$'
    OR v_counts->>'locations' !~ '^[0-1]$'
    OR v_counts->>'operations' !~ '^[0-2]$'
  THEN RAISE EXCEPTION 'forever_prerequisite_execution: request_counts_invalid'; END IF;
  v_developers := (v_counts->>'developers')::INTEGER;
  v_locations := (v_counts->>'locations')::INTEGER;
  v_operations := (v_counts->>'operations')::INTEGER;
  IF v_operations <> v_developers + v_locations THEN
    RAISE EXCEPTION 'forever_prerequisite_execution: request_counts_invalid';
  END IF;

  v_entities := request->'entities';
  IF jsonb_typeof(v_entities) <> 'object' THEN RAISE EXCEPTION 'forever_prerequisite_execution: request_malformed'; END IF;
  SELECT coalesce(array_agg(k ORDER BY k), ARRAY[]::TEXT[]) INTO v_keys
    FROM jsonb_object_keys(v_entities) AS t(k);
  IF v_keys <> ARRAY['developer','location'] THEN RAISE EXCEPTION 'forever_prerequisite_execution: request_unsupported_property'; END IF;
  v_developer := v_entities->'developer';
  v_location := v_entities->'location';

  IF v_developers = 1 THEN
    IF jsonb_typeof(v_developer) <> 'object' THEN RAISE EXCEPTION 'forever_prerequisite_execution: developer_invalid'; END IF;
    SELECT coalesce(array_agg(k ORDER BY k), ARRAY[]::TEXT[]) INTO v_keys FROM jsonb_object_keys(v_developer) AS t(k);
    IF v_keys <> ARRAY['country','legal_name','name','slug','verification_status']
      OR v_developer->>'slug' IS DISTINCT FROM 'rhom-bho-property-public-company-limited'
      OR v_developer->>'name' IS DISTINCT FROM 'Rhom Bho Property Public Company Limited'
      OR v_developer->>'legal_name' IS DISTINCT FROM 'Rhom Bho Property Public Company Limited'
      OR v_developer->>'country' IS DISTINCT FROM 'Thailand'
      OR v_developer->>'verification_status' IS DISTINCT FROM 'verified'
    THEN RAISE EXCEPTION 'forever_prerequisite_execution: developer_invalid'; END IF;
  ELSIF jsonb_typeof(v_developer) <> 'null' THEN
    RAISE EXCEPTION 'forever_prerequisite_execution: developer_invalid';
  END IF;

  IF v_locations = 1 THEN
    IF jsonb_typeof(v_location) <> 'object' THEN RAISE EXCEPTION 'forever_prerequisite_execution: location_invalid'; END IF;
    SELECT coalesce(array_agg(k ORDER BY k), ARRAY[]::TEXT[]) INTO v_keys FROM jsonb_object_keys(v_location) AS t(k);
    IF v_keys <> ARRAY['area_name','country','province','slug']
      OR v_location->>'slug' IS DISTINCT FROM 'kamala'
      OR v_location->>'area_name' IS DISTINCT FROM 'Kamala'
      OR v_location->>'country' IS DISTINCT FROM 'Thailand'
      OR v_location->>'province' IS DISTINCT FROM 'Phuket'
    THEN RAISE EXCEPTION 'forever_prerequisite_execution: location_invalid'; END IF;
  ELSIF jsonb_typeof(v_location) <> 'null' THEN
    RAISE EXCEPTION 'forever_prerequisite_execution: location_invalid';
  END IF;

  v_text := request::text;
  IF position('postgres://' in v_text) > 0 OR position('postgresql://' in v_text) > 0
    OR position('sb_secret_' in v_text) > 0 OR position('Bearer ' in v_text) > 0
  THEN RAISE EXCEPTION 'forever_prerequisite_execution: credential_material'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION forever_import.validate_prerequisite_request(JSONB) FROM PUBLIC;

CREATE OR REPLACE FUNCTION forever_import.register_prerequisite_approval(
  p_issued_at TIMESTAMPTZ, p_expires_at TIMESTAMPTZ, p_request JSONB
) RETURNS UUID
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE v_id UUID;
BEGIN
  PERFORM forever_import.validate_prerequisite_request(p_request);
  BEGIN
    INSERT INTO forever_import.prerequisite_execution_approvals (
      approval_digest, package_id, target, target_project_id, repository_head,
      operation_count, approved_request, approved_request_digest, issued_at, expires_at
    ) VALUES (
      p_request->>'approvalDigest', p_request->>'packageId', p_request->>'target',
      p_request->>'targetProjectId', p_request->>'repositoryHead',
      (p_request->'operationCounts'->>'operations')::INTEGER, p_request,
      forever_import.request_digest(p_request), p_issued_at, p_expires_at
    ) RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'forever_prerequisite_execution: approval_already_registered';
  END;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION forever_import.register_prerequisite_approval(TIMESTAMPTZ,TIMESTAMPTZ,JSONB) FROM PUBLIC;

CREATE OR REPLACE FUNCTION forever_import.run_approved_prerequisites(request JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_approval forever_import.prerequisite_execution_approvals%ROWTYPE;
  v_execution_id UUID := gen_random_uuid();
  v_developer JSONB := request->'entities'->'developer';
  v_location JSONB := request->'entities'->'location';
  v_developers INTEGER := (request->'operationCounts'->>'developers')::INTEGER;
  v_locations INTEGER := (request->'operationCounts'->>'locations')::INTEGER;
  v_operations INTEGER := (request->'operationCounts'->>'operations')::INTEGER;
  v_count INTEGER;
BEGIN
  PERFORM forever_import.validate_prerequisite_request(request);
  SELECT * INTO v_approval FROM forever_import.prerequisite_execution_approvals
    WHERE approval_digest=request->>'approvalDigest' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'forever_prerequisite_execution: approval_unknown'; END IF;
  IF v_approval.consumed_at IS NOT NULL THEN RAISE EXCEPTION 'forever_prerequisite_execution: approval_already_consumed'; END IF;
  IF now() < v_approval.issued_at THEN RAISE EXCEPTION 'forever_prerequisite_execution: approval_not_yet_valid'; END IF;
  IF now() >= v_approval.expires_at THEN RAISE EXCEPTION 'forever_prerequisite_execution: approval_expired'; END IF;
  IF request IS DISTINCT FROM v_approval.approved_request
    OR forever_import.request_digest(request) IS DISTINCT FROM v_approval.approved_request_digest
    OR v_approval.operation_count IS DISTINCT FROM v_operations
  THEN RAISE EXCEPTION 'forever_prerequisite_execution: approval_request_mismatch'; END IF;

  UPDATE forever_import.prerequisite_execution_approvals
    SET consumed_at=now(), execution_id=v_execution_id
    WHERE id=v_approval.id AND consumed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'forever_prerequisite_execution: approval_already_consumed'; END IF;
  IF EXISTS (SELECT 1 FROM forever_import.prerequisite_execution_receipts WHERE package_id=request->>'packageId') THEN
    RAISE EXCEPTION 'forever_prerequisite_execution: package_already_executed';
  END IF;
  IF (SELECT count(*) FROM public.projects WHERE slug='coralina') <> 0 THEN
    RAISE EXCEPTION 'forever_prerequisite_execution: coralina_target_not_empty';
  END IF;

  SELECT count(*) INTO v_count FROM public.developers WHERE slug='rhom-bho-property-public-company-limited';
  IF v_developers = 1 THEN
    IF v_count <> 0 OR EXISTS (
      SELECT 1 FROM public.developers
      WHERE regexp_replace(lower(coalesce(legal_name,name,'')),'[^a-z0-9]+','','g') =
        'rhombhopropertypubliccompanylimited'
    ) THEN RAISE EXCEPTION 'forever_prerequisite_execution: developer_state_changed'; END IF;
    INSERT INTO public.developers (slug,name,legal_name,country,verification_status)
    VALUES (v_developer->>'slug',v_developer->>'name',v_developer->>'legal_name',v_developer->>'country',v_developer->>'verification_status');
  ELSIF v_count <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.developers WHERE slug='rhom-bho-property-public-company-limited'
      AND name='Rhom Bho Property Public Company Limited'
      AND legal_name='Rhom Bho Property Public Company Limited' AND country='Thailand'
  ) THEN RAISE EXCEPTION 'forever_prerequisite_execution: developer_dependency_invalid'; END IF;

  SELECT count(*) INTO v_count FROM public.locations WHERE slug='kamala';
  IF v_locations = 1 THEN
    IF v_count <> 0 OR EXISTS (SELECT 1 FROM public.locations WHERE lower(area_name)=lower('Kamala')) THEN
      RAISE EXCEPTION 'forever_prerequisite_execution: location_state_changed';
    END IF;
    INSERT INTO public.locations (slug,area_name,country,province)
    VALUES (v_location->>'slug',v_location->>'area_name',v_location->>'country',v_location->>'province');
  ELSIF v_count <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.locations WHERE slug='kamala' AND area_name='Kamala'
      AND country='Thailand' AND province='Phuket'
  ) THEN RAISE EXCEPTION 'forever_prerequisite_execution: location_dependency_invalid'; END IF;

  IF (SELECT count(*) FROM public.developers WHERE slug='rhom-bho-property-public-company-limited'
      AND name='Rhom Bho Property Public Company Limited'
      AND legal_name='Rhom Bho Property Public Company Limited' AND country='Thailand') <> 1
    OR (SELECT count(*) FROM public.locations WHERE slug='kamala' AND area_name='Kamala'
      AND country='Thailand' AND province='Phuket') <> 1
    OR (SELECT count(*) FROM public.projects WHERE slug='coralina') <> 0
  THEN RAISE EXCEPTION 'forever_prerequisite_execution: postwrite_verification_failed'; END IF;

  INSERT INTO forever_import.prerequisite_execution_receipts (
    execution_id,approval_digest,approved_request_digest,package_id,developer_slug,
    location_slug,developers_written,locations_written,writes_performed,outcome
  ) VALUES (
    v_execution_id,v_approval.approval_digest,v_approval.approved_request_digest,
    request->>'packageId','rhom-bho-property-public-company-limited','kamala',
    v_developers,v_locations,v_operations,'committed'
  );
  RETURN jsonb_build_object(
    'schemaVersion','1','outcome','committed','executionId',v_execution_id::TEXT,
    'approvalDigest',v_approval.approval_digest,'requestFingerprint',request->>'requestFingerprint',
    'packageId',request->>'packageId','developersWritten',v_developers,
    'locationsWritten',v_locations,'writesPerformed',v_operations,'commitConfirmed',true
  );
END;
$$;

REVOKE ALL ON FUNCTION forever_import.run_approved_prerequisites(JSONB) FROM PUBLIC;

CREATE OR REPLACE FUNCTION forever_execution.forever_execute_approved_prerequisites(request JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STRICT SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN forever_import.run_approved_prerequisites(request);
END;
$$;

REVOKE ALL ON FUNCTION forever_execution.forever_execute_approved_prerequisites(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION forever_execution.forever_execute_approved_prerequisites(JSONB) FROM anon;
REVOKE ALL ON FUNCTION forever_execution.forever_execute_approved_prerequisites(JSONB) FROM authenticated;
REVOKE ALL ON FUNCTION forever_execution.forever_execute_approved_prerequisites(JSONB) FROM service_role;
GRANT EXECUTE ON FUNCTION forever_execution.forever_execute_approved_prerequisites(JSONB) TO forever_import_executor;

ALTER TABLE forever_import.prerequisite_execution_approvals OWNER TO forever_import_execution_owner;
ALTER TABLE forever_import.prerequisite_execution_receipts OWNER TO forever_import_execution_owner;
ALTER FUNCTION forever_import.validate_prerequisite_request(JSONB) OWNER TO forever_import_execution_owner;
ALTER FUNCTION forever_import.register_prerequisite_approval(TIMESTAMPTZ,TIMESTAMPTZ,JSONB) OWNER TO forever_import_execution_owner;
ALTER FUNCTION forever_import.run_approved_prerequisites(JSONB) OWNER TO forever_import_execution_owner;
ALTER FUNCTION forever_execution.forever_execute_approved_prerequisites(JSONB) OWNER TO forever_import_execution_owner;

GRANT INSERT ON public.developers TO forever_import_execution_owner;
GRANT INSERT ON public.locations TO forever_import_execution_owner;

DROP POLICY IF EXISTS forever_import_owner_insert_developers ON public.developers;
CREATE POLICY forever_import_owner_insert_developers ON public.developers
  AS PERMISSIVE FOR INSERT TO forever_import_execution_owner WITH CHECK (
    slug='rhom-bho-property-public-company-limited'
    AND name='Rhom Bho Property Public Company Limited'
    AND legal_name='Rhom Bho Property Public Company Limited'
    AND country='Thailand' AND verification_status='verified'
  );
DROP POLICY IF EXISTS forever_import_owner_insert_locations ON public.locations;
CREATE POLICY forever_import_owner_insert_locations ON public.locations
  AS PERMISSIVE FOR INSERT TO forever_import_execution_owner WITH CHECK (
    slug='kamala' AND area_name='Kamala' AND country='Thailand' AND province='Phuket'
  );

REVOKE ALL ON TABLE forever_import.prerequisite_execution_approvals FROM forever_import_executor;
REVOKE ALL ON TABLE forever_import.prerequisite_execution_receipts FROM forever_import_executor;
REVOKE ALL ON FUNCTION forever_import.validate_prerequisite_request(JSONB) FROM forever_import_executor;
REVOKE ALL ON FUNCTION forever_import.register_prerequisite_approval(TIMESTAMPTZ,TIMESTAMPTZ,JSONB) FROM forever_import_executor;
REVOKE ALL ON FUNCTION forever_import.run_approved_prerequisites(JSONB) FROM forever_import_executor;

COMMIT;
