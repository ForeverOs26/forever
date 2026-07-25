-- ============================================================================
-- FOREVER BOOTH MODE 2.0 — SERVER-ISSUED SESSION IDENTITY (additive)
--
-- FOREVER-BOOTH-ASSISTED-DECISION-001, PR #102 corrective pass 5, delivered as
-- a SEPARATE migration by corrective pass 5.1.
--
-- WHY THIS IS A NEW FILE AND NOT AN EDIT TO 20260725150000_booth_v2_pilot.sql
--   The pilot migration 20260725150000_booth_v2_pilot.sql WAS APPLIED to the
--   dedicated Booth staging Supabase project during the earlier staging gate,
--   at PR #102 head 6ecfed8. It has NEVER been applied to production.
--
--   That file's own header still says it "has never been applied to any
--   environment". That sentence was true when it was written and is now known
--   to be wrong; it was not corrected, because the file is deliberately frozen.
--   The timestamp 20260725150000 already exists in staging's migration history,
--   so rewriting the file in place would produce two different definitions of
--   the same version: staging would keep the OLD database functions while a
--   freshly provisioned environment would get the NEW ones, and the application
--   would expect the pass 5 contract from both. Corrective pass 5 rewrote it in
--   place; corrective pass 5.1 restored it byte-for-byte to its 6ecfed8 state
--   (blob f785adc3181080e6d38695bef1054735a3b37585) and moved every pass 5
--   database change here.
--
--   An applied migration is history. Corrections layer on top of it.
--
-- WHAT THIS MIGRATION CHANGES, AND NOTHING ELSE
--   Creation of a Booth session becomes its own operation, performed entirely
--   by the server:
--
--     1. DROP public.booth_ensure_session(TEXT, UUID, TEXT, TEXT) — the old
--        four-argument signature that CREATED a session for an unknown
--        reference.
--     2. CREATE public.booth_create_session(UUID, TEXT, TEXT) — takes NO client
--        reference, mints one with pg_catalog.gen_random_uuid(), inserts
--        exactly one session shell and returns the reference.
--     3. CREATE public.booth_ensure_session(TEXT, UUID) — the non-creating
--        replacement, which only opens a session that already exists.
--     4. Re-establish least privilege on both: explicit REVOKE from PUBLIC,
--        anon and authenticated, EXECUTE granted to service_role alone.
--
--   It creates no table, drops no column, touches no constraint, no trigger, no
--   policy and no other function. It executes NO DML: no Booth session, guest
--   record, lead, guide or funnel event is created, updated or deleted here.
--   Sessions that already exist in staging keep their rows, their references,
--   their ownership and their outcomes exactly as they are.
--
-- THE DEFECT THIS CLOSES
--   booth_ensure_session used to INSERT when the client reference was unknown,
--   and refuse when the reference belonged to a different Host. A success and a
--   refusal are a louder difference than any wording, so an authorized staff
--   account could walk references and learn which ones belong to somebody else
--   — and could mint arbitrary empty sessions from references it invented.
--
--   After this migration, creation lives ONLY in booth_create_session, which
--   accepts no reference to create from. booth_ensure_session delegates
--   straight to booth_lock_owned_session, so an unknown reference and a foreign
--   reference are refused the same way and NEITHER inserts or changes a row.
--   The TypeScript boundary already collapses both refusals into one
--   indistinguishable external response.
--
-- ORDERING AND PRECONDITIONS
--   Requires 20260725150000_booth_v2_pilot.sql, which creates public.booth_sessions
--   and public.booth_lock_owned_session. The filename timestamp guarantees that
--   order in every environment. Applies identically to:
--     A. staging, which already has 20260725150000 recorded and applied;
--     B. a fresh database, which applies 20260725150000 and then this file.
--   Every statement is idempotent (DROP ... IF EXISTS, CREATE OR REPLACE,
--   REVOKE/GRANT), so a replay is safe.
--
-- SECURITY MODEL — UNCHANGED BY THIS FILE
--   Both functions are SECURITY DEFINER with SET search_path = '', every object
--   fully qualified, no dynamic SQL. RLS, the booth table grants, the terminal
--   freeze trigger, the pre-consent CHECK and the ownership gate are exactly as
--   20260725150000 left them. This migration adds no privilege to any browser
--   role.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Remove the creating ensure signature.
--
--    Dropped outright, not merely left unused: while it exists, a direct
--    service_role call could still bring a session into existence from a
--    caller-supplied reference. Nothing depends on it — no other function calls
--    it, and it is referenced by no view, trigger or constraint — so the drop
--    cannot cascade. IF EXISTS keeps the migration replayable.
-- ----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.booth_ensure_session(TEXT, UUID, TEXT, TEXT);

-- ----------------------------------------------------------------------------
-- 2. THE ONLY WAY A BOOTH SESSION COMES INTO EXISTENCE.
--
--    It takes NO client reference. The reference is minted HERE with
--    pg_catalog.gen_random_uuid() — a cryptographically random server-side
--    value — so the browser can neither choose the identity of a new session
--    nor guess an existing one. The Host comes from the authenticated actor
--    resolved at the server boundary and the booth id from server
--    configuration; neither is a client-supplied label.
--
--    One invocation creates EXACTLY one session. There is deliberately no
--    ON CONFLICT clause: a reference this function issues must be new, so a
--    collision is a hard error rather than a silent adoption of a session that
--    already exists. Two concurrent calls therefore return two different
--    references and insert two distinct rows.
--
--    Nothing about a guest is written: only the operational shell (the
--    reference, the Host, the booth id), which is exactly what
--    booth_sessions_pre_consent_minimal permits before the consultation
--    consent. Creating a session is therefore not a persistence event.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.booth_create_session(
  p_host_user_id UUID,
  p_host_email TEXT,
  p_booth_id TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_client_ref TEXT;
BEGIN
  IF p_host_user_id IS NULL THEN
    RAISE EXCEPTION 'booth_session_forbidden';
  END IF;

  v_client_ref := pg_catalog.gen_random_uuid()::TEXT;

  INSERT INTO public.booth_sessions (client_ref, host_user_id, host_email, booth_id)
  VALUES (v_client_ref, p_host_user_id, NULLIF(btrim(p_host_email), ''), p_booth_id);

  RETURN v_client_ref;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Open an EXISTING session for a client reference the server previously
--    issued.
--
--    CREATES NOTHING. Creation now lives ONLY in booth_create_session.
--
--    Replay rules: an existing session owned by the acting Host succeeds
--    idempotently; an unknown reference raises booth_session_not_found and a
--    foreign one raises booth_session_forbidden. The two exceptions stay
--    distinct HERE so an ownership bug is diagnosable in the PostgreSQL suite;
--    the TypeScript boundary collapses both into one indistinguishable wire
--    response. Neither refusal creates a row and neither changes any row.
--
--    READ-ONLY (documented terminal-state exception): it only locks and returns
--    the row, so it is permitted on a terminal session — FOR UPDATE does not
--    fire the BEFORE UPDATE freeze trigger.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.booth_ensure_session(
  p_client_ref TEXT,
  p_actor_user_id UUID
)
RETURNS public.booth_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.booth_sessions;
BEGIN
  SELECT * INTO v_session
    FROM public.booth_lock_owned_session(p_client_ref, p_actor_user_id);
  RETURN v_session;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. Least privilege, restated for both functions.
--
--    A function created here is born with whatever DEFAULT PRIVILEGES the
--    project has for functions in public — on a Supabase project that can
--    include EXECUTE for anon and authenticated. Revoke explicitly first, then
--    grant service_role alone, exactly as 20260725150000 does for every other
--    Booth RPC. No anonymous or merely-authenticated caller can execute either
--    function even with a valid Supabase session.
-- ----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.booth_create_session(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booth_ensure_session(TEXT, UUID) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.booth_create_session(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.booth_ensure_session(TEXT, UUID) TO service_role;

-- ----------------------------------------------------------------------------
-- 5. Record the contract in the catalog, so an operator inspecting the hosted
--    database sees the same truth as this file.
-- ----------------------------------------------------------------------------

COMMENT ON FUNCTION public.booth_create_session(UUID, TEXT, TEXT) IS
  'Booth V2: the ONLY function that creates a session. Takes no client reference, '
  'mints one with pg_catalog.gen_random_uuid(), inserts exactly one operational '
  'shell (no guest data) and returns the reference. service_role only.';

COMMENT ON FUNCTION public.booth_ensure_session(TEXT, UUID) IS
  'Booth V2: opens an EXISTING session the acting staff account owns. Creates '
  'nothing; an unknown reference and a foreign reference are both refused and '
  'neither changes a row. Read-only, so it is permitted on a terminal session. '
  'service_role only.';

COMMIT;

-- ============================================================================
-- DOWN (reversal REFERENCE only — verify each precondition before running):
--
--   Reverting restores the pre-pass-5 defect (an unknown reference silently
--   creates a session, and creation is distinguishable from refusal). Do it
--   only to roll back to the 6ecfed8 application code, which calls the
--   four-argument ensure and supplies its own client reference.
--
--   Sessions created by booth_create_session survive the reversal unchanged:
--   their references are ordinary UUID strings and the restored ensure accepts
--   them for the owning Host.
--
--     DROP FUNCTION IF EXISTS public.booth_ensure_session(TEXT, UUID);
--     DROP FUNCTION IF EXISTS public.booth_create_session(UUID, TEXT, TEXT);
--
--   Then re-create the four-argument ensure exactly as
--   20260725150000_booth_v2_pilot.sql defines it, and restore its grants:
--
--     REVOKE ALL ON FUNCTION public.booth_ensure_session(TEXT, UUID, TEXT, TEXT)
--       FROM PUBLIC, anon, authenticated;
--     GRANT EXECUTE ON FUNCTION public.booth_ensure_session(TEXT, UUID, TEXT, TEXT)
--       TO service_role;
-- ============================================================================
