-- ============================================================================
-- FOREVER-STUDIO-LARGE-ARCHIVE-001 — durable large-archive intake (v1)
--
-- MIGRATION DRAFT (pending; not applied here). PURELY ADDITIVE: two new
-- internal tables, one lifecycle trigger, and five new service-role-only
-- functions, layered after the pending Studio chain
-- (20260721120000..20260723130000). It has NOT been applied by this task; it
-- is exercised end-to-end by the disposable PostgreSQL test harness only.
-- Nothing existing is altered, dropped, re-applied, or re-scheduled. Never
-- re-apply any earlier migration.
--
-- Purpose. Studio's synchronous 16 MiB ZIP path buffers a whole archive in
-- one request. This migration adds the durable state a 300 MiB chunked-upload
-- archive needs instead:
--   * studio_archives         — one row per uploaded ZIP: the complete
--                               per-part SHA-256 manifest (bound at PLAN
--                               time; the resume identity), the
--                               server-derived manifest identity digest, the
--                               exact whole-archive SHA-256, a TRUTHFUL
--                               DB-ENFORCED lifecycle (transition matrix +
--                               state evidence via trigger), and adopted
--                               structured artifacts (price list / facts) so
--                               a later slice finalizes from durable state.
--   * studio_archive_entries  — one row per archive entry: the durable
--                               entry-level inventory (identity, sizes,
--                               verified SHA-256, byte class, routing outcome,
--                               public derivative location, and the private
--                               evidence manifest for independently retained
--                               entries). Completion is derived from these
--                               rows, never from an in-memory loop. A
--                               COMPOSITE foreign key (archive_id, job_id)
--                               makes cross-job archive/entry pairs
--                               unrepresentable at the constraint layer.
--
-- Concurrency contract (same one-winner model as studio_upload_jobs):
--   * Every processing-phase write is guarded by the JOB's live processing
--     claim (status = 'processing' AND processing_token matches) inside one
--     transaction, AND by a locked proof that the target archive belongs to
--     that job — a valid claim on job B can never write into job A's archive.
--   * Entry settlement is additionally pending-only: an entry leaves
--     'pending' exactly once. Retries and repeated processing are idempotent.
--   * studio_release_job ends a bounded processing slice by returning the job
--     to 'received' (readiness marker preserved) so the next poll continues
--     promptly instead of waiting out the stale-claim window.
--
-- Lifecycle (DB-enforced by studio_archive_lifecycle_guard, never only by
-- TypeScript callers):
--     planned             -> uploaded_unverified | rejected
--     uploaded_unverified -> byte_verifying      | rejected
--     byte_verifying      -> byte_verified       | rejected
--     byte_verified       -> processing_entries  | rejected
--     processing_entries  -> completed           | rejected
--     completed           -> (terminal)
--     rejected            -> (terminal)
--   EVERY insert and update — including a same-state update — must satisfy
--   the complete invariants of the state the row lands in; there is no
--   idempotency bypass. The client part manifest is cryptographically bound
--   to the immutable manifest identity on every row version (sha256 over the
--   domain prefix, the declared size, the part geometry, and the ordered
--   declared digests), so a fabricated or rewritten manifest can never
--   satisfy any state. Entering — or remaining in — byte_verified,
--   processing_entries, or completed requires every part present in order
--   with verified=true, a server SHA-256 equal to the plan-time claim, exact
--   per-part sizes (final part = exact remainder) summing to the declared
--   size, observed_size equal to declared_size, the exact archive SHA-256,
--   and the recomputed composite digest. Once a row has been byte_verified
--   its verification evidence (parts, observed_size, composite_sha256,
--   archive_sha256) is immutable; once processing_entries, entry_count and
--   total_uncompressed are too. processing_entries and completed revalidate
--   the durable inventory (row count, job ownership, zero pending for
--   completed) on every write. Terminal states accept only strict no-op
--   updates. INSERTs must start at 'planned' with no verification evidence.
--
-- Privacy: both tables carry ORIGINAL client filenames / raw entry paths and
-- full media-truth evidence (including extracted claims). They are internal
-- only: RLS enabled with NO policies, all grants revoked except service_role.
-- Public projections use neutral labels; these rows never reach the browser.
--
-- DOWN (manual, destructive — NOT a complete automatic rollback):
--   DROP FUNCTION IF EXISTS public.studio_release_job(UUID, UUID);
--   DROP FUNCTION IF EXISTS public.studio_update_archive_claimed(UUID, UUID, UUID, JSONB);
--   DROP FUNCTION IF EXISTS public.studio_index_archive_entries(UUID, UUID, UUID, JSONB);
--   DROP FUNCTION IF EXISTS public.studio_settle_archive_entry(UUID, UUID, UUID, JSONB);
--   DROP FUNCTION IF EXISTS public.studio_job_archive_entry_counts(UUID);
--   DROP TABLE IF EXISTS public.studio_archive_entries;
--   DROP TABLE IF EXISTS public.studio_archives;
--   DROP FUNCTION IF EXISTS public.studio_archive_lifecycle_guard();
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. studio_archives — one uploaded ZIP archive (chunked, part-verified)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.studio_archives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.studio_upload_jobs(id) ON DELETE CASCADE,
  -- Plan-order sequence within the job: the deterministic processing order
  -- (first archive wins fact/price adoption regardless of clock resolution).
  ordinal INTEGER NOT NULL DEFAULT 0 CHECK (ordinal >= 0),
  -- PRIVATE original filename (service-role only; never projected publicly).
  file_name TEXT NOT NULL,
  -- Server-derived manifest identity: SHA-256 over a domain/version prefix,
  -- the exact declared size, the fixed part size, the part count, and the
  -- ordered raw per-part digests. Resume identity ONLY: re-planning resumes
  -- an archive exclusively when the COMPLETE per-part manifest (stored in
  -- parts[].declaredSha256, bound at plan time) matches digest-for-digest —
  -- never the filename, never a sampled digest (the v1 four-window
  -- fingerprint contract is retired). PRIVATE; never a substitute for server
  -- verification of the actual stored bytes.
  manifest_sha256 TEXT NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  declared_size BIGINT NOT NULL CHECK (declared_size > 0),
  part_size INTEGER NOT NULL CHECK (part_size > 0),
  part_count INTEGER NOT NULL CHECK (part_count > 0),
  -- [{index, size, declaredSha256, sha256, verified}] — bounded (≤ 64 parts).
  -- declaredSha256 is the client's plan-time manifest digest; sha256/verified
  -- are server-observed from the ACTUAL stored bytes and preserved after
  -- completion.
  parts JSONB NOT NULL DEFAULT '[]',
  observed_size BIGINT,
  -- Digest OVER the ordered per-part digests. NOT the file's SHA-256 — the
  -- exact one is archive_sha256 below and the two are never conflated.
  composite_sha256 TEXT CHECK (composite_sha256 IS NULL OR composite_sha256 ~ '^[0-9a-f]{64}$'),
  -- EXACT SHA-256 of the whole archive, streamed across the ordered verified
  -- parts (bounded reads, never a whole-file buffer). Required BEFORE the row
  -- may enter byte_verified (trigger-enforced).
  archive_sha256 TEXT CHECK (archive_sha256 IS NULL OR archive_sha256 ~ '^[0-9a-f]{64}$'),
  -- Truthful lifecycle: 'uploaded_unverified' = every part stored with its
  -- exact planned size, NOTHING hash-verified yet; 'byte_verified' = every
  -- stored part's actual bytes matched its recorded claim. Nothing expands
  -- before byte_verified. Membership is checked here; the TRANSITION MATRIX
  -- and state evidence are enforced by studio_archive_lifecycle_guard.
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','uploaded_unverified','byte_verifying','byte_verified',
                      'processing_entries','completed','rejected')),
  entry_count INTEGER,
  total_uncompressed BIGINT,
  -- Durable adopted structured artifacts (sanitized price list, fact fields).
  extracted JSONB,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Composite identity target for the entries' cross-job constraint: an
  -- (archive id, job id) pair is referencable ONLY when it is the real pair.
  UNIQUE (id, job_id)
);

CREATE INDEX IF NOT EXISTS idx_studio_archives_job
  ON public.studio_archives (job_id, ordinal, created_at, id);
-- Resume-identity candidate lookup: manifest identity + declared size within
-- one job (the full manifest is then compared digest-for-digest).
CREATE INDEX IF NOT EXISTS idx_studio_archives_job_manifest
  ON public.studio_archives (job_id, manifest_sha256, declared_size);

ALTER TABLE public.studio_archives ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.studio_archives FROM PUBLIC;
REVOKE ALL ON public.studio_archives FROM anon;
REVOKE ALL ON public.studio_archives FROM authenticated;
GRANT ALL ON public.studio_archives TO service_role;

-- ----------------------------------------------------------------------------
-- 2. studio_archive_lifecycle_guard — DB-enforced transition matrix + evidence
--
-- Runs on EVERY insert/update regardless of caller (RPC, PostgREST, SQL), so
-- the truthful lifecycle can never be skipped, regressed, or asserted without
-- its evidence by any TypeScript caller. There is NO same-state bypass: every
-- row version — insert, transition, or idempotent re-write — must satisfy the
-- complete invariants of the state it lands in, and once a row has been
-- byte_verified its verification evidence is immutable (OLD vs NEW). The
-- client part manifest is cryptographically bound to the immutable
-- manifest_sha256 identity on every version, so a fabricated manifest can
-- never satisfy any state. Violations raise and roll back the offending
-- statement — state is never partially changed.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.studio_archive_lifecycle_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_part JSONB;
  v_key TEXT;
  v_position INTEGER := 0;
  v_expected_size BIGINT;
  v_size_sum BIGINT := 0;
  v_sizes_missing BOOLEAN := FALSE;
  v_preimage BYTEA;
  v_server_concat TEXT := '';
  v_verified_state BOOLEAN;
  v_rows BIGINT;
BEGIN
  v_verified_state := NEW.status IN ('byte_verified','processing_entries','completed');

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'planned' THEN
      RAISE EXCEPTION 'studio_archive_invalid_initial_status: %', NEW.status;
    END IF;
    -- A planned row carries the client's declared manifest and NO unproven
    -- verification evidence.
    IF NEW.observed_size IS NOT NULL
       OR NEW.composite_sha256 IS NOT NULL
       OR NEW.archive_sha256 IS NOT NULL
       OR NEW.entry_count IS NOT NULL
       OR NEW.total_uncompressed IS NOT NULL THEN
      RAISE EXCEPTION 'studio_archive_planned_carries_evidence';
    END IF;
  ELSE
    -- The archive's identity is immutable once planned.
    IF NEW.id <> OLD.id
       OR NEW.job_id <> OLD.job_id
       OR NEW.manifest_sha256 <> OLD.manifest_sha256
       OR NEW.declared_size <> OLD.declared_size
       OR NEW.part_size <> OLD.part_size
       OR NEW.part_count <> OLD.part_count
       OR NEW.ordinal <> OLD.ordinal
       OR NEW.file_name <> OLD.file_name
       OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'studio_archive_identity_immutable';
    END IF;

    -- Transition matrix applies to state CHANGES; a same-state update is
    -- permitted but still runs every landing-state validation below.
    IF NEW.status <> OLD.status AND NOT (
         (OLD.status = 'planned'             AND NEW.status IN ('uploaded_unverified','rejected'))
      OR (OLD.status = 'uploaded_unverified' AND NEW.status IN ('byte_verifying','rejected'))
      OR (OLD.status = 'byte_verifying'      AND NEW.status IN ('byte_verified','rejected'))
      OR (OLD.status = 'byte_verified'       AND NEW.status IN ('processing_entries','rejected'))
      OR (OLD.status = 'processing_entries'  AND NEW.status IN ('completed','rejected'))
    ) THEN
      RAISE EXCEPTION 'studio_archive_invalid_transition: % -> %', OLD.status, NEW.status;
    END IF;

    -- Terminal states accept only a strict no-op re-write: the matrix above
    -- already forbids leaving them, and no column may change.
    IF OLD.status IN ('completed','rejected') THEN
      IF NEW.parts IS DISTINCT FROM OLD.parts
         OR NEW.observed_size IS DISTINCT FROM OLD.observed_size
         OR NEW.composite_sha256 IS DISTINCT FROM OLD.composite_sha256
         OR NEW.archive_sha256 IS DISTINCT FROM OLD.archive_sha256
         OR NEW.entry_count IS DISTINCT FROM OLD.entry_count
         OR NEW.total_uncompressed IS DISTINCT FROM OLD.total_uncompressed
         OR NEW.extracted IS DISTINCT FROM OLD.extracted
         OR NEW.error_code IS DISTINCT FROM OLD.error_code THEN
        RAISE EXCEPTION 'studio_archive_terminal_immutable: %', OLD.status;
      END IF;
    END IF;

    -- Once byte-verified, the verification evidence is frozen — a worker
    -- holding a live processing claim may advance the lifecycle but can never
    -- rewrite what was proven, in ANY later state (same-state included).
    IF OLD.status IN ('byte_verified','processing_entries','completed') THEN
      IF NEW.parts IS DISTINCT FROM OLD.parts THEN
        RAISE EXCEPTION 'studio_archive_verified_evidence_immutable: parts';
      END IF;
      IF NEW.observed_size IS DISTINCT FROM OLD.observed_size THEN
        RAISE EXCEPTION 'studio_archive_verified_evidence_immutable: observed_size';
      END IF;
      IF NEW.composite_sha256 IS DISTINCT FROM OLD.composite_sha256 THEN
        RAISE EXCEPTION 'studio_archive_verified_evidence_immutable: composite_sha256';
      END IF;
      IF NEW.archive_sha256 IS DISTINCT FROM OLD.archive_sha256 THEN
        RAISE EXCEPTION 'studio_archive_verified_evidence_immutable: archive_sha256';
      END IF;
    END IF;

    -- Once the durable inventory is recorded, its numbers are frozen too.
    IF OLD.status IN ('processing_entries','completed') THEN
      IF NEW.entry_count IS DISTINCT FROM OLD.entry_count
         OR NEW.total_uncompressed IS DISTINCT FROM OLD.total_uncompressed THEN
        RAISE EXCEPTION 'studio_archive_verified_evidence_immutable: inventory';
      END IF;
    END IF;
  END IF;

  -- --------------------------------------------------------------------------
  -- Manifest binding + structural part validation (EVERY row version).
  -- The parts array must always be the plan-bound declared manifest: exactly
  -- part_count ordered part objects whose declared digests hash — together
  -- with the declared size and part geometry — to the immutable
  -- manifest_sha256 identity. Server-observed fields (size, sha256, verified)
  -- may only ever be absent/null or exactly correct.
  -- --------------------------------------------------------------------------
  IF NEW.parts IS NULL OR jsonb_typeof(NEW.parts) <> 'array' THEN
    RAISE EXCEPTION 'studio_archive_manifest_binding_violation: parts_not_array';
  END IF;
  IF jsonb_array_length(NEW.parts) <> NEW.part_count THEN
    RAISE EXCEPTION 'studio_archive_manifest_binding_violation: part_count';
  END IF;
  -- The declared size implies the exact part count (last part may be short).
  IF NEW.part_count <> (NEW.declared_size + NEW.part_size - 1) / NEW.part_size THEN
    RAISE EXCEPTION 'studio_archive_manifest_binding_violation: geometry';
  END IF;

  v_preimage := convert_to('forever-upload-part-manifest-v2', 'UTF8')
                || int8send(NEW.declared_size)
                || int4send(NEW.part_size)
                || int4send(NEW.part_count);

  FOR v_part IN SELECT jsonb_array_elements(NEW.parts) LOOP
    IF jsonb_typeof(v_part) <> 'object' THEN
      RAISE EXCEPTION 'studio_archive_manifest_binding_violation: part_shape';
    END IF;
    FOR v_key IN SELECT jsonb_object_keys(v_part) LOOP
      IF v_key NOT IN ('index','size','declaredSha256','sha256','verified') THEN
        RAISE EXCEPTION 'studio_archive_manifest_binding_violation: part_field %', v_key;
      END IF;
    END LOOP;
    -- Part indexes are integers covering exactly 0..part_count-1 in order:
    -- no duplicate, no gap, no reorder, no extra.
    IF jsonb_typeof(v_part->'index') <> 'number'
       OR (v_part->'index')::text !~ '^[0-9]+$'
       OR (v_part->>'index')::INTEGER <> v_position THEN
      RAISE EXCEPTION 'studio_archive_manifest_binding_violation: part_index';
    END IF;
    IF jsonb_typeof(v_part->'declaredSha256') <> 'string'
       OR (v_part->>'declaredSha256') !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'studio_archive_manifest_binding_violation: declared_sha256';
    END IF;
    v_preimage := v_preimage || decode(v_part->>'declaredSha256', 'hex');

    -- Server-observed size: absent until stored, and EXACT when present —
    -- part_size for every part but the last, the exact remainder for the
    -- last (so sizes always sum to declared_size).
    v_expected_size := CASE
      WHEN v_position < NEW.part_count - 1 THEN NEW.part_size::BIGINT
      ELSE NEW.declared_size - NEW.part_size::BIGINT * (NEW.part_count - 1)
    END;
    IF v_part ? 'size' AND jsonb_typeof(v_part->'size') <> 'null' THEN
      IF jsonb_typeof(v_part->'size') <> 'number'
         OR (v_part->'size')::text !~ '^[0-9]+$'
         OR (v_part->>'size')::BIGINT <> v_expected_size THEN
        RAISE EXCEPTION 'studio_archive_manifest_binding_violation: part_size';
      END IF;
      v_size_sum := v_size_sum + (v_part->>'size')::BIGINT;
    ELSE
      v_sizes_missing := TRUE;
    END IF;

    -- Server hash: null until verified, well-formed hex when present.
    IF v_part ? 'sha256' AND jsonb_typeof(v_part->'sha256') <> 'null' THEN
      IF jsonb_typeof(v_part->'sha256') <> 'string'
         OR (v_part->>'sha256') !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'studio_archive_manifest_binding_violation: server_sha256';
      END IF;
    END IF;
    IF NOT (v_part ? 'verified') OR jsonb_typeof(v_part->'verified') <> 'boolean' THEN
      RAISE EXCEPTION 'studio_archive_manifest_binding_violation: verified_flag';
    END IF;
    IF (v_part->>'verified')::BOOLEAN
       AND (NOT (v_part ? 'sha256') OR jsonb_typeof(v_part->'sha256') = 'null') THEN
      RAISE EXCEPTION 'studio_archive_manifest_binding_violation: verified_without_hash';
    END IF;
    -- A freshly planned row records claims only — nothing server-verified.
    IF TG_OP = 'INSERT'
       AND ((v_part ? 'sha256' AND jsonb_typeof(v_part->'sha256') <> 'null')
            OR (v_part->>'verified')::BOOLEAN) THEN
      RAISE EXCEPTION 'studio_archive_planned_carries_evidence';
    END IF;

    IF v_verified_state THEN
      -- Full byte-verification evidence: every part server-verified with a
      -- stored size, and the server hash EQUAL to the plan-time client claim.
      IF NOT (v_part->>'verified')::BOOLEAN
         OR COALESCE(v_part->>'sha256','') !~ '^[0-9a-f]{64}$'
         OR jsonb_typeof(v_part->'size') <> 'number' THEN
        RAISE EXCEPTION 'studio_archive_byte_verification_evidence_missing: part';
      END IF;
      IF v_part->>'sha256' <> v_part->>'declaredSha256' THEN
        RAISE EXCEPTION 'studio_archive_byte_verification_evidence_missing: part';
      END IF;
      v_server_concat := v_server_concat || (v_part->>'sha256');
    END IF;

    v_position := v_position + 1;
  END LOOP;

  -- The ordered declared digests + declared size + part geometry must hash to
  -- the immutable manifest identity (malformed identity values are left to
  -- the column CHECK, which also aborts the statement).
  IF NEW.manifest_sha256 ~ '^[0-9a-f]{64}$'
     AND encode(sha256(v_preimage), 'hex') <> NEW.manifest_sha256 THEN
    RAISE EXCEPTION 'studio_archive_manifest_binding_violation: identity_digest';
  END IF;

  -- observed_size can only ever be the declared size (acceptance requires
  -- every part stored at its exact planned size).
  IF NEW.observed_size IS NOT NULL AND NEW.observed_size <> NEW.declared_size THEN
    RAISE EXCEPTION 'studio_archive_manifest_binding_violation: observed_size';
  END IF;

  -- --------------------------------------------------------------------------
  -- Byte-verification state evidence (byte_verified, processing_entries,
  -- completed — transition AND same-state).
  -- --------------------------------------------------------------------------
  IF v_verified_state THEN
    IF v_sizes_missing OR v_size_sum <> NEW.declared_size THEN
      RAISE EXCEPTION 'studio_archive_byte_verification_evidence_missing: part_sizes';
    END IF;
    IF NEW.observed_size IS NULL THEN
      RAISE EXCEPTION 'studio_archive_byte_verification_evidence_missing: observed_size';
    END IF;
    IF NEW.archive_sha256 IS NULL OR NEW.archive_sha256 !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'studio_archive_byte_verification_evidence_missing: archive_sha256';
    END IF;
    -- The digest-of-part-digests must be exactly the recomputation over the
    -- ordered server hashes (never conflated with the file hash above).
    IF NEW.composite_sha256 IS NULL
       OR NEW.composite_sha256 <> encode(sha256(convert_to(v_server_concat, 'UTF8')), 'hex') THEN
      RAISE EXCEPTION 'studio_archive_byte_verification_evidence_missing: composite_sha256';
    END IF;
  END IF;

  -- --------------------------------------------------------------------------
  -- Durable inventory evidence (processing_entries AND completed — transition
  -- AND same-state): entry_count/total_uncompressed recorded, exactly
  -- entry_count inventory rows present (a truthful zero-entry result is
  -- entry_count = 0 with no rows), and every row owned by this archive's job.
  -- --------------------------------------------------------------------------
  IF NEW.status IN ('processing_entries','completed') THEN
    IF NEW.entry_count IS NULL OR NEW.entry_count < 0
       OR NEW.total_uncompressed IS NULL OR NEW.total_uncompressed < 0 THEN
      RAISE EXCEPTION 'studio_archive_inventory_evidence_missing';
    END IF;
    SELECT count(*) INTO v_rows FROM public.studio_archive_entries e
     WHERE e.archive_id = NEW.id;
    IF v_rows <> NEW.entry_count THEN
      RAISE EXCEPTION 'studio_archive_inventory_incomplete: % of %', v_rows, NEW.entry_count;
    END IF;
    -- Composite-FK-guaranteed; revalidated so the state evidence is
    -- self-contained even if constraints are ever weakened.
    SELECT count(*) INTO v_rows FROM public.studio_archive_entries e
     WHERE e.archive_id = NEW.id AND e.job_id <> NEW.job_id;
    IF v_rows > 0 THEN
      RAISE EXCEPTION 'studio_archive_inventory_foreign_rows: %', v_rows;
    END IF;
  END IF;

  -- completed additionally requires every entry settled (no pending rows).
  IF NEW.status = 'completed' THEN
    SELECT count(*) INTO v_rows FROM public.studio_archive_entries e
     WHERE e.archive_id = NEW.id AND e.state = 'pending';
    IF v_rows > 0 THEN
      RAISE EXCEPTION 'studio_archive_completed_with_pending_entries: %', v_rows;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER studio_archives_lifecycle_guard
  BEFORE INSERT OR UPDATE ON public.studio_archives
  FOR EACH ROW EXECUTE FUNCTION public.studio_archive_lifecycle_guard();

-- ----------------------------------------------------------------------------
-- 3. studio_archive_entries — durable per-entry inventory and outcomes
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.studio_archive_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id UUID NOT NULL REFERENCES public.studio_archives(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.studio_upload_jobs(id) ON DELETE CASCADE,
  entry_index INTEGER NOT NULL CHECK (entry_index >= 0),
  -- PRIVATE raw entry path (service-role only; never projected publicly).
  entry_name TEXT NOT NULL,
  -- Neutral public-safe label used by warnings and progress UI.
  display_label TEXT NOT NULL,
  category TEXT NOT NULL,
  compressed_size BIGINT NOT NULL CHECK (compressed_size >= 0),
  uncompressed_size BIGINT NOT NULL CHECK (uncompressed_size >= 0),
  observed_size BIGINT,
  sha256 TEXT CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  media_class TEXT,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','published_public','retained_private','skipped_duplicate','failed')),
  outcome_code TEXT,
  public_bucket TEXT,
  public_path TEXT,
  public_url TEXT,
  media_type TEXT,
  media_title TEXT,
  -- Full private evidence (claims allowed here — internal table only).
  media_truth JSONB,
  -- Independently addressable PRIVATE evidence manifest for retained entries:
  -- {bucket, prefix, partSize, partCount, parts:[{index,size,sha256}],
  --  totalSize, crc32Verified}. The entry's uncompressed bytes re-staged as
  -- fixed-size private objects so videos, HEIC, large PDFs and unknown
  -- documents are retrievable and hash-verifiable WITHOUT the parent archive
  -- (which remains the immutable parent evidence).
  evidence JSONB,
  attempt TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (archive_id, entry_index),
  -- CROSS-JOB OWNERSHIP AT THE CONSTRAINT LAYER: the (archive_id, job_id)
  -- pair must be the archive's REAL pair — an entry that names archive A
  -- under job B is unrepresentable, whatever the caller.
  FOREIGN KEY (archive_id, job_id)
    REFERENCES public.studio_archives (id, job_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_studio_archive_entries_job_state
  ON public.studio_archive_entries (job_id, state);
CREATE INDEX IF NOT EXISTS idx_studio_archive_entries_archive_state
  ON public.studio_archive_entries (archive_id, state, entry_index);
CREATE INDEX IF NOT EXISTS idx_studio_archive_entries_job_sha
  ON public.studio_archive_entries (job_id, sha256);

ALTER TABLE public.studio_archive_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.studio_archive_entries FROM PUBLIC;
REVOKE ALL ON public.studio_archive_entries FROM anon;
REVOKE ALL ON public.studio_archive_entries FROM authenticated;
GRANT ALL ON public.studio_archive_entries TO service_role;

-- ----------------------------------------------------------------------------
-- 4. studio_release_job: end one bounded slice, keep the job promptly due
--
-- Compare-and-set on the live claim. The readiness marker
-- (processing_requested_at) and attempt_count are preserved so the job stays
-- eligible for the very next resume poll. A stale token is a no-op.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.studio_release_job(
  p_job_id UUID,
  p_token UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  UPDATE public.studio_upload_jobs
  SET status = 'received',
      processing_token = NULL,
      updated_at = now()
  WHERE id = p_job_id
    AND status = 'processing'
    AND processing_token = p_token;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. studio_update_archive_claimed: claim-checked, ownership-proved patch
--
-- Whitelisted fields only — an unknown field is rejected outright. Inside one
-- transaction the function (a) validates every supplied patch field's JSON
-- type/shape BEFORE casting, so a malformed patch fails safely without
-- partially changing state, (b) locks the job row and proves the caller still
-- holds the live processing claim, (c) locks the target archive and proves it
-- belongs to that job, and (d) shrinks the writable whitelist by lifecycle
-- position: once an archive is byte_verified its verification evidence
-- (parts, observed_size, composite_sha256, archive_sha256) cannot even be
-- presented in a patch; once processing_entries, neither can the inventory
-- numbers; terminal rows accept status-only (no-op) patches. The lifecycle
-- trigger independently enforces the transition matrix, per-state evidence,
-- and value-level immutability. Claim loss and foreign ownership return FALSE
-- (no write); malformed input, forbidden fields, and forbidden transitions
-- raise.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.studio_update_archive_claimed(
  p_job_id UUID,
  p_token UUID,
  p_archive_id UUID,
  p_patch JSONB
) RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_claimed INTEGER;
  v_archive_job UUID;
  v_archive_status TEXT;
  v_updated INTEGER;
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'studio_archive_patch_invalid: patch';
  END IF;
  -- Explicit whitelist: any field outside it is rejected, never ignored.
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_patch) AS k(key)
    WHERE k.key NOT IN ('status','parts','observed_size','composite_sha256',
                        'archive_sha256','entry_count','total_uncompressed',
                        'extracted','error_code')
  ) THEN
    RAISE EXCEPTION 'studio_archive_patch_invalid: unknown_field';
  END IF;
  -- Validate every supplied field BEFORE any cast or write.
  IF p_patch ? 'status' AND (
       jsonb_typeof(p_patch->'status') <> 'string'
    OR p_patch->>'status' NOT IN ('planned','uploaded_unverified','byte_verifying',
                                  'byte_verified','processing_entries','completed','rejected')
  ) THEN
    RAISE EXCEPTION 'studio_archive_patch_invalid: status';
  END IF;
  IF p_patch ? 'parts' AND jsonb_typeof(p_patch->'parts') <> 'array' THEN
    RAISE EXCEPTION 'studio_archive_patch_invalid: parts';
  END IF;
  IF p_patch ? 'observed_size' AND (
       jsonb_typeof(p_patch->'observed_size') <> 'number'
    OR (p_patch->'observed_size')::text !~ '^[0-9]+$'
  ) THEN
    RAISE EXCEPTION 'studio_archive_patch_invalid: observed_size';
  END IF;
  IF p_patch ? 'entry_count' AND (
       jsonb_typeof(p_patch->'entry_count') <> 'number'
    OR (p_patch->'entry_count')::text !~ '^[0-9]+$'
  ) THEN
    RAISE EXCEPTION 'studio_archive_patch_invalid: entry_count';
  END IF;
  IF p_patch ? 'total_uncompressed' AND (
       jsonb_typeof(p_patch->'total_uncompressed') <> 'number'
    OR (p_patch->'total_uncompressed')::text !~ '^[0-9]+$'
  ) THEN
    RAISE EXCEPTION 'studio_archive_patch_invalid: total_uncompressed';
  END IF;
  IF p_patch ? 'composite_sha256' AND (
       jsonb_typeof(p_patch->'composite_sha256') <> 'string'
    OR p_patch->>'composite_sha256' !~ '^[0-9a-f]{64}$'
  ) THEN
    RAISE EXCEPTION 'studio_archive_patch_invalid: composite_sha256';
  END IF;
  IF p_patch ? 'archive_sha256' AND (
       jsonb_typeof(p_patch->'archive_sha256') <> 'string'
    OR p_patch->>'archive_sha256' !~ '^[0-9a-f]{64}$'
  ) THEN
    RAISE EXCEPTION 'studio_archive_patch_invalid: archive_sha256';
  END IF;
  IF p_patch ? 'extracted' AND jsonb_typeof(p_patch->'extracted') <> 'object' THEN
    RAISE EXCEPTION 'studio_archive_patch_invalid: extracted';
  END IF;
  IF p_patch ? 'error_code' AND jsonb_typeof(p_patch->'error_code') <> 'string' THEN
    RAISE EXCEPTION 'studio_archive_patch_invalid: error_code';
  END IF;

  -- Lock the job claim.
  PERFORM 1 FROM public.studio_upload_jobs
   WHERE id = p_job_id AND status = 'processing' AND processing_token = p_token
   FOR UPDATE;
  GET DIAGNOSTICS v_claimed = ROW_COUNT;
  IF v_claimed = 0 THEN
    RETURN FALSE;
  END IF;

  -- Lock the target archive and PROVE it belongs to the claimed job.
  SELECT job_id, status INTO v_archive_job, v_archive_status
    FROM public.studio_archives
   WHERE id = p_archive_id
   FOR UPDATE;
  IF v_archive_job IS NULL OR v_archive_job <> p_job_id THEN
    RETURN FALSE;
  END IF;

  -- Post-verification whitelist reduction: fields that can no longer need
  -- mutation cannot even be presented, whatever their value — a scheduled
  -- worker with a live claim may advance the lifecycle but can never patch
  -- proven evidence (the trigger additionally freezes the stored values).
  IF v_archive_status IN ('byte_verified','processing_entries','completed','rejected')
     AND p_patch ?| ARRAY['parts','observed_size','composite_sha256','archive_sha256'] THEN
    RAISE EXCEPTION 'studio_archive_patch_forbidden: verified_evidence';
  END IF;
  IF v_archive_status IN ('processing_entries','completed','rejected')
     AND p_patch ?| ARRAY['entry_count','total_uncompressed'] THEN
    RAISE EXCEPTION 'studio_archive_patch_forbidden: inventory';
  END IF;
  IF v_archive_status IN ('completed','rejected')
     AND p_patch ?| ARRAY['extracted','error_code'] THEN
    RAISE EXCEPTION 'studio_archive_patch_forbidden: terminal';
  END IF;

  UPDATE public.studio_archives
  SET status = COALESCE(p_patch->>'status', status),
      parts = COALESCE(p_patch->'parts', parts),
      observed_size = COALESCE((p_patch->>'observed_size')::BIGINT, observed_size),
      composite_sha256 = COALESCE(p_patch->>'composite_sha256', composite_sha256),
      archive_sha256 = COALESCE(p_patch->>'archive_sha256', archive_sha256),
      entry_count = COALESCE((p_patch->>'entry_count')::INTEGER, entry_count),
      total_uncompressed = COALESCE((p_patch->>'total_uncompressed')::BIGINT, total_uncompressed),
      extracted = COALESCE(p_patch->'extracted', extracted),
      error_code = COALESCE(p_patch->>'error_code', error_code),
      updated_at = now()
  WHERE id = p_archive_id AND job_id = p_job_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. studio_index_archive_entries: claim-checked, ownership-proved insert
--
-- Inserts the durable entry inventory in one transaction with the claim
-- check AND a locked proof that the target archive belongs to the claimed
-- job. ON CONFLICT (archive_id, entry_index) DO NOTHING makes a re-run after
-- a crashed indexing slice fill only the missing rows — never duplicates,
-- never an overwrite of settled outcomes. The composite FK independently
-- rejects any cross-job (archive_id, job_id) pair.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.studio_index_archive_entries(
  p_job_id UUID,
  p_token UUID,
  p_archive_id UUID,
  p_entries JSONB
) RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_claimed INTEGER;
  v_archive_job UUID;
  v_archive_status TEXT;
  v_entry JSONB;
BEGIN
  IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array' THEN
    RAISE EXCEPTION 'studio_archive_entries_invalid: payload';
  END IF;
  FOR v_entry IN SELECT jsonb_array_elements(p_entries) LOOP
    IF jsonb_typeof(v_entry->'entry_index') <> 'number'
       OR (v_entry->'entry_index')::text !~ '^[0-9]+$'
       OR jsonb_typeof(v_entry->'entry_name') <> 'string'
       OR jsonb_typeof(v_entry->'display_label') <> 'string'
       OR jsonb_typeof(v_entry->'category') <> 'string'
       OR jsonb_typeof(v_entry->'compressed_size') <> 'number'
       OR (v_entry->'compressed_size')::text !~ '^[0-9]+$'
       OR jsonb_typeof(v_entry->'uncompressed_size') <> 'number'
       OR (v_entry->'uncompressed_size')::text !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'studio_archive_entries_invalid: entry';
    END IF;
  END LOOP;

  -- Lock the job claim.
  PERFORM 1 FROM public.studio_upload_jobs
   WHERE id = p_job_id AND status = 'processing' AND processing_token = p_token
   FOR UPDATE;
  GET DIAGNOSTICS v_claimed = ROW_COUNT;
  IF v_claimed = 0 THEN
    RETURN FALSE;
  END IF;

  -- Lock the target archive and PROVE it belongs to the claimed job: a valid
  -- claim on job B can never index entries into job A's archive.
  SELECT job_id, status INTO v_archive_job, v_archive_status
    FROM public.studio_archives
   WHERE id = p_archive_id
   FOR UPDATE;
  IF v_archive_job IS NULL OR v_archive_job <> p_job_id THEN
    RETURN FALSE;
  END IF;

  -- Inventory rows may only be recorded during the indexing phase — never
  -- into an archive already processing or settled, so the entry count an
  -- archive transitioned with can never be diluted afterwards.
  IF v_archive_status <> 'byte_verified' THEN
    RAISE EXCEPTION 'studio_archive_entries_invalid: archive_state %', v_archive_status;
  END IF;

  INSERT INTO public.studio_archive_entries (
    archive_id, job_id, entry_index, entry_name, display_label, category,
    compressed_size, uncompressed_size
  )
  SELECT
    p_archive_id,
    p_job_id,
    (e->>'entry_index')::INTEGER,
    e->>'entry_name',
    e->>'display_label',
    e->>'category',
    (e->>'compressed_size')::BIGINT,
    (e->>'uncompressed_size')::BIGINT
  FROM jsonb_array_elements(p_entries) AS e
  ON CONFLICT (archive_id, entry_index) DO NOTHING;
  RETURN TRUE;
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. studio_settle_archive_entry: claim-checked, ownership-proved,
--    pending-only settlement
--
-- The ONLY transition out of 'pending'. Guarded by the job claim, a locked
-- proof that the entry AND its parent archive belong to the claimed job, the
-- parent archive actually being in processing_entries, and the pending state
-- in one statement: a stale worker (or a duplicate slice) matches zero rows,
-- learns it lost, and must treat its own uploaded objects as orphans. Settled
-- outcomes are immutable. Malformed outcome payloads raise before any write.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.studio_settle_archive_entry(
  p_job_id UUID,
  p_token UUID,
  p_entry_id UUID,
  p_outcome JSONB
) RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_claimed INTEGER;
  v_entry_job UUID;
  v_archive_id UUID;
  v_archive_job UUID;
  v_archive_status TEXT;
  v_updated INTEGER;
BEGIN
  IF p_outcome IS NULL OR jsonb_typeof(p_outcome) <> 'object' THEN
    RAISE EXCEPTION 'studio_archive_outcome_invalid: payload';
  END IF;
  IF jsonb_typeof(p_outcome->'state') <> 'string'
     OR p_outcome->>'state' NOT IN ('published_public','retained_private',
                                    'skipped_duplicate','failed') THEN
    RAISE EXCEPTION 'studio_archive_outcome_invalid: state';
  END IF;
  IF p_outcome ? 'observedSize'
     AND jsonb_typeof(p_outcome->'observedSize') NOT IN ('number','null') THEN
    RAISE EXCEPTION 'studio_archive_outcome_invalid: observedSize';
  END IF;
  IF p_outcome ? 'sha256' AND jsonb_typeof(p_outcome->'sha256') <> 'null'
     AND (jsonb_typeof(p_outcome->'sha256') <> 'string'
          OR p_outcome->>'sha256' !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'studio_archive_outcome_invalid: sha256';
  END IF;
  IF p_outcome ? 'processedAt' AND jsonb_typeof(p_outcome->'processedAt') <> 'null' THEN
    BEGIN
      PERFORM (p_outcome->>'processedAt')::TIMESTAMPTZ;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'studio_archive_outcome_invalid: processedAt';
    END;
  END IF;
  IF p_outcome ? 'mediaTruth'
     AND jsonb_typeof(p_outcome->'mediaTruth') NOT IN ('object','null') THEN
    RAISE EXCEPTION 'studio_archive_outcome_invalid: mediaTruth';
  END IF;
  IF p_outcome ? 'evidence'
     AND jsonb_typeof(p_outcome->'evidence') NOT IN ('object','null') THEN
    RAISE EXCEPTION 'studio_archive_outcome_invalid: evidence';
  END IF;

  -- Lock the job claim.
  PERFORM 1 FROM public.studio_upload_jobs
   WHERE id = p_job_id AND status = 'processing' AND processing_token = p_token
   FOR UPDATE;
  GET DIAGNOSTICS v_claimed = ROW_COUNT;
  IF v_claimed = 0 THEN
    RETURN FALSE;
  END IF;

  -- Lock the entry and PROVE the entry and its parent archive belong to the
  -- claimed job.
  SELECT job_id, archive_id INTO v_entry_job, v_archive_id
    FROM public.studio_archive_entries
   WHERE id = p_entry_id
   FOR UPDATE;
  IF v_entry_job IS NULL OR v_entry_job <> p_job_id THEN
    RETURN FALSE;
  END IF;
  SELECT job_id, status INTO v_archive_job, v_archive_status
    FROM public.studio_archives
   WHERE id = v_archive_id;
  IF v_archive_job IS NULL OR v_archive_job <> p_job_id THEN
    RETURN FALSE;
  END IF;
  -- An entry settles only while its parent archive is actually processing —
  -- a late worker (or one holding a completed/rejected archive) learns it
  -- lost instead of writing.
  IF v_archive_status <> 'processing_entries' THEN
    RETURN FALSE;
  END IF;

  UPDATE public.studio_archive_entries
  SET state = p_outcome->>'state',
      outcome_code = p_outcome->>'outcomeCode',
      observed_size = (p_outcome->>'observedSize')::BIGINT,
      sha256 = p_outcome->>'sha256',
      media_class = p_outcome->>'mediaClass',
      public_bucket = p_outcome->>'publicBucket',
      public_path = p_outcome->>'publicPath',
      public_url = p_outcome->>'publicUrl',
      media_type = p_outcome->>'mediaType',
      media_title = p_outcome->>'mediaTitle',
      media_truth = p_outcome->'mediaTruth',
      evidence = p_outcome->'evidence',
      attempt = p_outcome->>'attempt',
      processed_at = COALESCE((p_outcome->>'processedAt')::TIMESTAMPTZ, now())
  WHERE id = p_entry_id
    AND job_id = p_job_id
    AND state = 'pending';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. studio_job_archive_entry_counts: aggregate progress (read-only)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.studio_job_archive_entry_counts(
  p_job_id UUID
) RETURNS TABLE (state TEXT, entries BIGINT)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT e.state, COUNT(*)::BIGINT
  FROM public.studio_archive_entries e
  WHERE e.job_id = p_job_id
  GROUP BY e.state;
$$;

-- ----------------------------------------------------------------------------
-- 9. Function grants: service_role only (same posture as every Studio RPC)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  fn TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.studio_release_job(uuid, uuid)',
    'public.studio_update_archive_claimed(uuid, uuid, uuid, jsonb)',
    'public.studio_index_archive_entries(uuid, uuid, uuid, jsonb)',
    'public.studio_settle_archive_entry(uuid, uuid, uuid, jsonb)',
    'public.studio_job_archive_entry_counts(uuid)'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END;
$$;

COMMIT;
