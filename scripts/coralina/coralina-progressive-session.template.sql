\set ON_ERROR_STOP on
\pset pager off

-- Generated only by New-CoralinaProgressiveSession.ps1. The payload table is
-- owned by the database-session owner; the RPC remains an invoker-rights call
-- made after the local role switch.
CREATE TEMP TABLE pg_temp.coralina_exact_payload (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  payload jsonb NOT NULL,
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$')
) ON COMMIT PRESERVE ROWS;

INSERT INTO pg_temp.coralina_exact_payload (payload, source_sha256)
VALUES (
  $coralina_payload$__CORALINA_EXACT_PAYLOAD__$coralina_payload$::jsonb,
  '2d5613a35705b251f20208aa4273038c2d8001bebe5d2c5bab5e55cb653e6605'
);

DO $owner_payload_gate$
BEGIN
  IF current_user <> session_user THEN
    RAISE EXCEPTION 'payload_table_not_created_as_session_owner';
  END IF;
  IF (SELECT count(*) FROM pg_temp.coralina_exact_payload) <> 1 THEN
    RAISE EXCEPTION 'payload_cardinality_mismatch';
  END IF;
  IF (SELECT source_sha256 FROM pg_temp.coralina_exact_payload) <>
      '2d5613a35705b251f20208aa4273038c2d8001bebe5d2c5bab5e55cb653e6605' THEN
    RAISE EXCEPTION 'payload_sha256_attestation_mismatch';
  END IF;
  IF (SELECT payload->>'batch_fingerprint' FROM pg_temp.coralina_exact_payload) <>
      '9ceb05d2daa5c2a174d37d4d92fb49c4bc39294fa1b5ab402a10ab526230631c' THEN
    RAISE EXCEPTION 'batch_fingerprint_mismatch';
  END IF;
  IF (SELECT jsonb_array_length(payload->'buildings') FROM pg_temp.coralina_exact_payload) <> 8
     OR (SELECT jsonb_array_length(payload->'units') FROM pg_temp.coralina_exact_payload) <> 198
     OR (SELECT jsonb_array_length(payload->'prices') FROM pg_temp.coralina_exact_payload) <> 198
     OR (SELECT jsonb_array_length(payload->'warnings') FROM pg_temp.coralina_exact_payload) <> 6 THEN
    RAISE EXCEPTION 'payload_graph_cardinality_mismatch';
  END IF;
END
$owner_payload_gate$;

-- PostgreSQL 17.6 exposes the session's pg_temp schema across SET ROLE. Table
-- ACLs remain enforced, so SELECT is the only privilege service_role needs.
REVOKE ALL ON TABLE pg_temp.coralina_exact_payload
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE pg_temp.coralina_exact_payload TO service_role;

DO $payload_acl_gate$
BEGIN
  IF NOT has_schema_privilege('service_role', pg_my_temp_schema(), 'USAGE') THEN
    RAISE EXCEPTION 'service_role_temp_schema_usage_missing';
  END IF;
  IF NOT has_table_privilege('service_role', 'pg_temp.coralina_exact_payload', 'SELECT') THEN
    RAISE EXCEPTION 'service_role_payload_select_missing';
  END IF;
  IF has_table_privilege('anon', 'pg_temp.coralina_exact_payload', 'SELECT')
     OR has_table_privilege('authenticated', 'pg_temp.coralina_exact_payload', 'SELECT') THEN
    RAISE EXCEPTION 'untrusted_role_payload_select_present';
  END IF;
  IF EXISTS (
    SELECT 1 FROM aclexplode(COALESCE(
      (SELECT relacl FROM pg_class WHERE oid = 'pg_temp.coralina_exact_payload'::regclass),
      acldefault('r', (SELECT relowner FROM pg_class WHERE oid = 'pg_temp.coralina_exact_payload'::regclass))
    )) acl
    WHERE acl.grantee = 0 AND acl.privilege_type = 'SELECT'
  ) THEN
    RAISE EXCEPTION 'public_payload_select_present';
  END IF;
END
$payload_acl_gate$;

BEGIN;
SET LOCAL ROLE service_role;

DO $service_payload_gate$
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'rpc_caller_role_mismatch';
  END IF;
  IF (SELECT count(*) FROM pg_temp.coralina_exact_payload) <> 1 THEN
    RAISE EXCEPTION 'service_role_payload_read_mismatch';
  END IF;
  IF (SELECT prosecdef FROM pg_proc
      WHERE oid = 'public.forever_progressive_ingest(jsonb)'::regprocedure) THEN
    RAISE EXCEPTION 'progressive_rpc_must_remain_invoker_rights';
  END IF;
END
$service_payload_gate$;

SELECT public.forever_progressive_ingest(payload) AS ingestion_summary
FROM pg_temp.coralina_exact_payload;

DO $graph_assertions$
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

  IF (SELECT count(*) FROM public.projects WHERE slug = 'coralina') <> 1 THEN RAISE EXCEPTION 'coralina_project_count_mismatch'; END IF;
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

  SELECT public.forever_progressive_ingest(payload) INTO replay
  FROM pg_temp.coralina_exact_payload;
  IF COALESCE((replay->>'replayed')::boolean, false) IS NOT true THEN
    RAISE EXCEPTION 'exact_replay_not_idempotent';
  END IF;
END
$graph_assertions$;

RESET ROLE;
SET LOCAL ROLE anon;
DO $visibility$
BEGIN
  IF EXISTS (SELECT 1 FROM public.projects WHERE slug = 'coralina') THEN
    RAISE EXCEPTION 'anon_can_see_coralina_draft';
  END IF;
END
$visibility$;
RESET ROLE;

__TRANSACTION_END__
\echo CORALINA_SESSION_TRANSACTION_COMPLETE

__POST_TRANSACTION_CHECK__

DROP TABLE pg_temp.coralina_exact_payload;
\echo CORALINA_TEMP_PAYLOAD_DROPPED
