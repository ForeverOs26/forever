-- ============================================================================
-- FOREVER BOOTH MODE 2.0 — PILOT MIGRATION DRAFT (pending; NOT applied)
--
-- FOREVER-BOOTH-ASSISTED-DECISION-001 + PR #102 corrective passes 1 and 2.
-- This file has never been applied to any environment (it is unmerged and
-- unapplied), so each corrective pass rewrites it IN PLACE rather than layering
-- a second migration on an imaginary applied state. It is exercised only by
-- the disposable PostgreSQL harness (npm run studio:pg-test).
--
-- TRUST MODEL
--   The booth tablet is NOT an anonymous kiosk. Every Booth V2 server function
--   runs behind an authenticated staff identity that holds an ACTIVE row in
--   public.studio_members (the existing staff roster; no second identity system
--   is introduced) AND the explicit least-privilege capability
--   studio_members.can_access_booth, AND a default-disabled server-side
--   enablement flag. Active membership alone is NOT sufficient. No user
--   receives the capability automatically and no staff row is seeded here.
--   The booth tables carry NO anonymous or authenticated grants at all: RLS is
--   enabled with no policies, every privilege is explicitly REVOKEd from
--   PUBLIC / anon / authenticated, and only service_role — reachable solely
--   through the authenticated server boundary — may touch them.
--
-- CONSENT BOUNDARY (corrective pass 2, item 1)
--   NOTHING about the guest is persisted before the guest gives the required
--   acknowledgement (permission to save the Decision Profile and provide the
--   requested consultation). Before that moment the server stores only the
--   minimum operational session shell: a random client reference, the
--   authorized Host, the booth identifier, the flow mode, and non-personal
--   funnel events. The confirmed Decision Profile and the shortlist live ONLY
--   in the tablet's versioned local session until consent. This is enforced by
--   the database itself (booth_sessions_pre_consent_minimal), not only by the
--   application: a row without consultation_consent physically cannot carry a
--   profile, a shortlist, answers, a note, a language, contact data, or a lead.
--   booth_commit_consent is the ONE locked operation that turns consent into
--   persisted truth: profile + shortlist + contact bundle + consent + exactly
--   one lead + the funnel facts, atomically.
--
-- SESSION OWNERSHIP (corrective pass 2, item 4)
--   Knowing a client_ref is not authorization. Every session RPC takes the
--   acting staff account and refuses unless booth_sessions.host_user_id equals
--   it. The single exception is deliberately narrow: the session's currently
--   assigned Guide, matched through booth_guides.staff_user_id, may confirm
--   THEIR OWN acknowledgement and THEIR OWN first contact — nothing else. A
--   Guide can never edit the profile, shortlist, contact, consent, WhatsApp
--   verification, Guide assignment or completion. Ownership is never
--   transferred silently.
--
-- SERVER-ISSUED SESSION IDENTITY (corrective pass 5)
--   The browser no longer chooses the identity of a new Booth session, and no
--   operation creates one implicitly. booth_create_session is the ONE way a row
--   comes into existence: it takes NO client reference, mints a cryptographically
--   random one with pg_catalog.gen_random_uuid(), takes the Host from the
--   authenticated actor and the booth id from server configuration, and returns
--   the new reference. One invocation creates exactly one session and persists
--   nothing about a guest, so the pre-consent-minimal CHECK is satisfied by
--   construction.
--
--   booth_ensure_session consequently CREATES NOTHING. It accepts an existing
--   reference and succeeds idempotently for the owning Host; an unknown
--   reference and a reference owned by another Host are both refused, neither
--   creates a row, and a rejected call changes zero rows. Previously ensure
--   INSERTed on an unknown reference, which let an authorized staff account
--   distinguish an unused reference from an existing foreign one — and create
--   arbitrary empty sessions. Both are closed.
--
-- TERMINAL IMMUTABILITY (corrective pass 2, item 6)
--   Once a session reaches contacted_complete, no_contact_qr or abandoned it is
--   frozen at the DATABASE level by booth_sessions_freeze_terminal — even a
--   direct service_role UPDATE is refused. Every transition RPC additionally
--   requires outcome = 'active'; the only accepted terminal calls are an exact
--   idempotent replay of the already-established outcome (which performs no
--   write at all) and the documented read-only booth_ensure_session.
--
-- NO-CONTACT DATA MINIMIZATION (corrective pass 2, item 2)
--   STRATEGY: clear-in-place, not delete. A no_contact_qr session is retained
--   as an ANONYMOUS funnel shell so pilot conversion can be measured honestly,
--   and booth_complete_session atomically clears every guest-specific value:
--   profile, profile version, confirmation timestamp, flow mode, shortlist and
--   its mode, every contact field, preferred language, both consents, the
--   WhatsApp state and all its evidence, the Guide assignment and reserve,
--   every acknowledgement/first-contact actor and method, the fallback reason,
--   the scheduled instant and its timezone, and the next step; any lead created
--   for the session is DELETED and unlinked. What may remain is only: a random
--   session identity, Host/booth attribution, timestamps, the no_contact_qr
--   outcome, and non-personal funnel events. booth_sessions_no_contact_retains_nothing
--   proves every one of those fields is clear.
--
-- WHAT THIS MIGRATION DOES — exact, in order:
--   1. public.studio_members gains can_access_booth (NOT NULL DEFAULT FALSE).
--      Purely additive: no existing row's Studio behaviour changes, and every
--      existing and future member starts WITHOUT Booth access.
--   2. booth_guides — operator-maintained Guide roster, optionally linked to an
--      auth user so a Guide can confirm their own acknowledgement. NO seed rows.
--   3. booth_sessions — the authoritative structured record, with the consent
--      boundary, the ownership column, the truthful completion gates, the
--      no-contact minimization gate and a UNIQUE lead link.
--   4. booth_funnel_events — once-only structured pilot events, split by who
--      may establish them: booth_record_event accepts ONLY the three
--      client-observed events, and every transition event is emitted by the RPC
--      that performs the transition.
--   5. The terminal-immutability trigger.
--   6. Atomic SECURITY DEFINER RPCs (service_role EXECUTE only, search_path='')
--      so creation, consent, verification, assignment, handoff and completion
--      are single transactions with the session row locked and ownership proven.
--      booth_create_session is the only one that brings a session into
--      existence, and it issues the reference itself.
--   7. public.leads: email becomes nullable with a NULL-tolerant format CHECK
--      so the trusted server can mirror a booth lead that has no email. The
--      anonymous INSERT policy is NOT modified: it still requires a non-blank
--      email, so the website's browser-side contract is unchanged and a
--      NULL-email lead can only originate from the trusted server boundary.
--
-- ROLLBACK TRUTH: see the DOWN reference at the end. The booth objects are new;
-- dropping them destroys only pilot data. studio_members.can_access_booth is an
-- additive column. Restoring leads.email NOT NULL is safe only after verifying
-- no NULL-email rows exist.
--
-- The static suite
-- src/features/navigator/core/v2/booth-v2-migration-contract.test.ts pins this
-- file's security contract; src/features/navigator/booth-v2/tests/booth.postgres.sql
-- exercises its behaviour against a disposable PostgreSQL instance.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. studio_members — an EXPLICIT, least-privilege Booth capability
--
--    Reuses the existing staff roster rather than introducing a second identity
--    table. Active membership is deliberately NOT sufficient for Booth: this
--    column must additionally be TRUE. It defaults to FALSE, so this migration
--    grants Booth access to nobody — not even the Owner. Turning it on for a
--    real operator is a separate, controlled staging action taken by the Owner.
--    Nothing else about studio_members changes, so every existing Studio
--    authorization path behaves exactly as before.
-- ----------------------------------------------------------------------------

ALTER TABLE public.studio_members
  ADD COLUMN IF NOT EXISTS can_access_booth BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.studio_members.can_access_booth IS
  'Least-privilege Booth Mode 2.0 capability. Booth requires is_active AND this flag; Studio ignores it.';

-- ----------------------------------------------------------------------------
-- 2. booth_guides — operator-maintained roster (NO seed data)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.booth_guides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  display_name TEXT NOT NULL,
  -- Optional link to an authenticated staff account: when present, that Guide
  -- can confirm their OWN acknowledgement and first contact
  -- ('guide_self_confirmed'); otherwise only a disclosed Host observation is
  -- possible. This link is also the ONLY route by which a non-Host staff
  -- account may touch a session at all, and then only for those two facts.
  staff_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  languages TEXT[] NOT NULL DEFAULT '{}',
  specializations TEXT[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  on_duty BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT booth_guides_name_not_empty CHECK (length(btrim(display_name)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS booth_guides_staff_user_id_key
  ON public.booth_guides(staff_user_id)
  WHERE staff_user_id IS NOT NULL;

ALTER TABLE public.booth_guides ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 3. booth_sessions — authoritative structured Booth V2 session record
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.booth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Idempotency: booth_create_session mints one cryptographically random
  -- reference per guest session and hands it to the tablet, which replays it on
  -- every subsequent write — so retries never duplicate a session. The browser
  -- neither chooses nor guesses it. A client_ref is an idempotency key, NEVER a
  -- capability: every RPC also proves the caller owns the session.
  client_ref TEXT NOT NULL UNIQUE,
  CONSTRAINT booth_sessions_client_ref_not_empty CHECK (length(btrim(client_ref)) > 0),

  -- Host identity is SERVER-DERIVED from the authenticated staff account that
  -- opened the session. There is no client-supplied host label anywhere, and
  -- this column is the ownership anchor for every subsequent transition.
  host_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  host_email TEXT,
  booth_id TEXT NOT NULL DEFAULT 'unconfigured',

  -- Flow mode is part of the pre-consent operational shell (which journey the
  -- Host opened); the profile CONTENT is not.
  flow_mode TEXT CHECK (flow_mode IN ('quick', 'full')),

  -- Versioned confirmed Decision Profile. Persisted ONLY at consent. The jsonb
  -- payload is authoritative; profile_version lets consumers fail closed on
  -- obsolete payloads.
  profile JSONB,
  profile_version INTEGER,
  profile_confirmed_at TIMESTAMPTZ,
  CONSTRAINT booth_sessions_profile_versioned CHECK (
    (profile IS NULL AND profile_version IS NULL AND profile_confirmed_at IS NULL)
    OR (profile IS NOT NULL AND profile_version IS NOT NULL AND profile_confirmed_at IS NOT NULL)
  ),

  -- Shortlist of ZERO to FOUR directions — enforced here, not only in the UI.
  -- Persisted ONLY at consent.
  shortlist JSONB NOT NULL DEFAULT '[]'::jsonb,
  shortlist_mode TEXT NOT NULL DEFAULT 'none'
    CHECK (shortlist_mode IN ('none', 'guest_selected', 'guide_prepares')),
  CONSTRAINT booth_sessions_shortlist_max_four CHECK (
    jsonb_typeof(shortlist) = 'array' AND jsonb_array_length(shortlist) <= 4
  ),
  CONSTRAINT booth_sessions_shortlist_mode_coherent CHECK (
    (shortlist_mode = 'guest_selected' AND jsonb_array_length(shortlist) > 0)
    OR (shortlist_mode <> 'guest_selected' AND jsonb_array_length(shortlist) = 0)
  ),

  -- Preferred language is a PROFILE fact captured before the Decision Summary,
  -- so it travels with the confirmed profile at consent. It must agree with the
  -- persisted profile payload (checked below) and is cleared on a no-contact
  -- outcome.
  preferred_language TEXT,

  -- Light contact bundle: present as a WHOLE or not at all (checked below).
  first_name TEXT,
  whatsapp TEXT,
  last_name TEXT,
  email TEXT,
  country TEXT,
  preferred_contact_time TEXT,
  host_note TEXT,

  -- Two DELIBERATELY separate consents. Consultation consent is the required
  -- acknowledgement and the gate for ALL guest persistence; marketing is
  -- opt-in only and defaults to FALSE.
  consultation_consent BOOLEAN NOT NULL DEFAULT FALSE,
  consent_recorded_at TIMESTAMPTZ,
  marketing_opt_in BOOLEAN NOT NULL DEFAULT FALSE,

  -- THE CONSENT BOUNDARY, enforced by the database.
  -- Without the consultation consent this row may hold ONLY the operational
  -- shell: identity, Host/booth attribution, flow mode, outcome, abandonment
  -- context and timestamps. No profile, no shortlist, no answers, no note, no
  -- language, no contact data, no lead. A bug in the application layer cannot
  -- write guest data ahead of consent, because this CHECK would reject it.
  CONSTRAINT booth_sessions_pre_consent_minimal CHECK (
    consultation_consent
    OR (
      profile IS NULL
      AND profile_version IS NULL
      AND profile_confirmed_at IS NULL
      AND jsonb_array_length(shortlist) = 0
      AND shortlist_mode = 'none'
      AND preferred_language IS NULL
      AND first_name IS NULL AND whatsapp IS NULL AND last_name IS NULL
      AND email IS NULL AND country IS NULL AND preferred_contact_time IS NULL
      AND host_note IS NULL
      AND lead_id IS NULL
    )
  ),

  -- A contact bundle is either COMPLETELY absent, or complete and coherent:
  -- nonblank first name, a valid WhatsApp number, a nonblank preferred
  -- language, an explicit consultation consent and its timestamp.
  CONSTRAINT booth_sessions_contact_bundle CHECK (
    (
      first_name IS NULL AND whatsapp IS NULL AND last_name IS NULL
      AND email IS NULL AND country IS NULL AND preferred_contact_time IS NULL
      AND host_note IS NULL AND consultation_consent = FALSE
      AND consent_recorded_at IS NULL AND marketing_opt_in = FALSE
    )
    OR (
      length(btrim(first_name)) > 0
      AND whatsapp ~ '^\+?[0-9][0-9 ()\-]{6,24}[0-9]$'
      AND length(btrim(preferred_language)) > 0
      AND consultation_consent
      AND consent_recorded_at IS NOT NULL
    )
  ),
  -- Optional fields, when present, are real values in a valid shape.
  CONSTRAINT booth_sessions_email_format CHECK (
    email IS NULL OR email ~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$'
  ),
  CONSTRAINT booth_sessions_optional_text_nonblank CHECK (
    (last_name IS NULL OR length(btrim(last_name)) > 0)
    AND (country IS NULL OR length(btrim(country)) > 0)
    AND (preferred_contact_time IS NULL OR length(btrim(preferred_contact_time)) > 0)
    AND (host_note IS NULL OR length(btrim(host_note)) > 0)
    AND (preferred_language IS NULL OR length(btrim(preferred_language)) > 0)
    AND (host_email IS NULL OR length(btrim(host_email)) > 0)
  ),
  -- The persisted profile and the dedicated column can never disagree about
  -- the guest's preferred language.
  CONSTRAINT booth_sessions_profile_language_agrees CHECK (
    profile IS NULL
    OR (profile ->> 'preferredLanguage') IS NOT DISTINCT FROM preferred_language
  ),

  -- Manual pilot WhatsApp verification (no Business API integration).
  whatsapp_verification_state TEXT NOT NULL DEFAULT 'unverified'
    CHECK (whatsapp_verification_state IN ('unverified', 'pending', 'verified', 'unavailable')),
  whatsapp_verified_at TIMESTAMPTZ,
  whatsapp_verification_method TEXT
    CHECK (whatsapp_verification_method IN ('wa_me_host_confirmed', 'qr_host_confirmed')),
  -- A verified number requires a stored number, the consultation consent, the
  -- timestamp and the method — a verification can never be a bare flag.
  CONSTRAINT booth_sessions_verified_requires_evidence CHECK (
    whatsapp_verification_state <> 'verified'
    OR (
      whatsapp IS NOT NULL
      AND consultation_consent
      AND whatsapp_verified_at IS NOT NULL
      AND whatsapp_verification_method IS NOT NULL
    )
  ),
  CONSTRAINT booth_sessions_unverified_has_no_evidence CHECK (
    whatsapp_verification_state = 'verified'
    OR (whatsapp_verified_at IS NULL AND whatsapp_verification_method IS NULL)
  ),

  -- Guide assignment + warm-handoff attribution (server boundary only).
  assigned_guide_id UUID REFERENCES public.booth_guides(id) ON DELETE RESTRICT,
  reserve_guide_id UUID REFERENCES public.booth_guides(id) ON DELETE RESTRICT,
  guide_assigned_at TIMESTAMPTZ,
  guide_acknowledged_at TIMESTAMPTZ,
  guide_acknowledged_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  guide_acknowledged_method TEXT
    CHECK (guide_acknowledged_method IN ('guide_self_confirmed', 'host_observed')),
  guide_first_contact_at TIMESTAMPTZ,
  guide_first_contact_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  guide_first_contact_method TEXT
    CHECK (guide_first_contact_method IN ('guide_self_confirmed', 'host_observed')),
  guide_fallback_reason TEXT,
  next_step TEXT,

  -- The exact consultation instant is STRUCTURED, never free text. The label
  -- carries only display context (the timezone the time was agreed in).
  consultation_scheduled_at TIMESTAMPTZ,
  consultation_timezone TEXT,

  CONSTRAINT booth_sessions_assignment_coherent CHECK (
    (assigned_guide_id IS NULL AND guide_assigned_at IS NULL)
    OR (assigned_guide_id IS NOT NULL AND guide_assigned_at IS NOT NULL)
  ),
  CONSTRAINT booth_sessions_reserve_requires_primary CHECK (
    reserve_guide_id IS NULL OR assigned_guide_id IS NOT NULL
  ),
  CONSTRAINT booth_sessions_reserve_differs CHECK (
    reserve_guide_id IS NULL OR reserve_guide_id <> assigned_guide_id
  ),
  -- An acknowledgement or a first contact requires an assigned Guide AND full
  -- attribution: who recorded it and by which disclosed method.
  CONSTRAINT booth_sessions_ack_attributed CHECK (
    guide_acknowledged_at IS NULL
    OR (
      assigned_guide_id IS NOT NULL
      AND guide_acknowledged_by IS NOT NULL
      AND guide_acknowledged_method IS NOT NULL
    )
  ),
  CONSTRAINT booth_sessions_first_contact_attributed CHECK (
    guide_first_contact_at IS NULL
    OR (
      assigned_guide_id IS NOT NULL
      AND guide_first_contact_by IS NOT NULL
      AND guide_first_contact_method IS NOT NULL
    )
  ),
  CONSTRAINT booth_sessions_next_step_nonblank CHECK (
    next_step IS NULL OR length(btrim(next_step)) > 0
  ),
  CONSTRAINT booth_sessions_consultation_structured CHECK (
    (consultation_scheduled_at IS NULL AND consultation_timezone IS NULL)
    OR (consultation_scheduled_at IS NOT NULL AND consultation_timezone IS NOT NULL
        AND length(btrim(consultation_timezone)) > 0)
  ),
  CONSTRAINT booth_sessions_fallback_reason_nonblank CHECK (
    guide_fallback_reason IS NULL OR length(btrim(guide_fallback_reason)) > 0
  ),

  -- Outcome + truthful completion gates.
  outcome TEXT NOT NULL DEFAULT 'active'
    CHECK (outcome IN ('active', 'contacted_complete', 'no_contact_qr', 'abandoned')),
  abandonment_step TEXT,
  abandonment_reason TEXT,

  -- Human-readable mirror (leads list); structured columns stay authoritative.
  -- UNIQUE: one lead per booth session, and one booth session per lead.
  lead_id UUID UNIQUE REFERENCES public.leads(id) ON DELETE SET NULL,

  -- A contacted session is COMPLETE only with every fact present.
  CONSTRAINT booth_sessions_contacted_complete_gate CHECK (
    outcome <> 'contacted_complete'
    OR (
      profile IS NOT NULL
      AND profile_version IS NOT NULL
      AND profile_confirmed_at IS NOT NULL
      AND first_name IS NOT NULL
      AND whatsapp IS NOT NULL
      AND preferred_language IS NOT NULL
      AND consultation_consent
      AND consent_recorded_at IS NOT NULL
      AND whatsapp_verification_state = 'verified'
      AND whatsapp_verified_at IS NOT NULL
      AND whatsapp_verification_method IS NOT NULL
      AND assigned_guide_id IS NOT NULL
      AND guide_assigned_at IS NOT NULL
      AND next_step IS NOT NULL
      AND (consultation_scheduled_at IS NOT NULL OR guide_first_contact_at IS NOT NULL)
    )
  ),
  -- A no-contact session retains NOTHING about the guest: no Decision Profile,
  -- no shortlist, no flow mode, no contact bundle, no consents, no
  -- verification, no Guide, no handoff attribution, no schedule, no next step,
  -- and no lead. Only the anonymous funnel shell survives.
  CONSTRAINT booth_sessions_no_contact_retains_nothing CHECK (
    outcome <> 'no_contact_qr'
    OR (
      profile IS NULL AND profile_version IS NULL AND profile_confirmed_at IS NULL
      AND flow_mode IS NULL
      AND jsonb_array_length(shortlist) = 0 AND shortlist_mode = 'none'
      AND first_name IS NULL AND whatsapp IS NULL AND last_name IS NULL
      AND email IS NULL AND country IS NULL AND preferred_contact_time IS NULL
      AND host_note IS NULL AND preferred_language IS NULL
      AND consultation_consent = FALSE AND consent_recorded_at IS NULL
      AND marketing_opt_in = FALSE
      AND whatsapp_verification_state = 'unverified'
      AND whatsapp_verified_at IS NULL AND whatsapp_verification_method IS NULL
      AND assigned_guide_id IS NULL AND reserve_guide_id IS NULL
      AND guide_assigned_at IS NULL
      AND guide_acknowledged_at IS NULL AND guide_acknowledged_by IS NULL
      AND guide_acknowledged_method IS NULL
      AND guide_first_contact_at IS NULL AND guide_first_contact_by IS NULL
      AND guide_first_contact_method IS NULL
      AND guide_fallback_reason IS NULL
      AND consultation_scheduled_at IS NULL AND consultation_timezone IS NULL
      AND next_step IS NULL
      AND lead_id IS NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_booth_sessions_created_at
  ON public.booth_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_booth_sessions_outcome
  ON public.booth_sessions(outcome);
CREATE INDEX IF NOT EXISTS idx_booth_sessions_host
  ON public.booth_sessions(host_user_id);

ALTER TABLE public.booth_sessions ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 4. booth_funnel_events — once-only structured pilot events
--
--    The CHECK below is the COMPLETE vocabulary, which is not the same thing as
--    the set a browser may record. Only three of these are client-observed
--    (meaningful_conversation, profile_started, session_abandoned) and only
--    those three are reachable through booth_record_event; the remainder are
--    fact-establishing transitions written by booth_emit_event from inside the
--    RPC that performs the transition. See booth_record_event's allowlist.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.booth_funnel_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  session_id UUID NOT NULL REFERENCES public.booth_sessions(id) ON DELETE CASCADE,
  event TEXT NOT NULL CHECK (event IN (
    'meaningful_conversation',
    'profile_started',
    'profile_confirmed',
    'whatsapp_verified',
    'guide_assigned',
    'guide_acknowledged',
    'guide_contacted',
    'consultation_booked',
    'qr_continuation',
    'session_abandoned',
    'viewing_booked'
  )),
  step TEXT,
  reason TEXT,
  -- Each funnel event is recorded at most once per session. Events whose
  -- evidence is invalidated (a replaced WhatsApp number, a genuine Guide
  -- reassignment) are DELETED by the operation that invalidates them, so the
  -- event can be re-earned truthfully rather than left standing as a lie.
  CONSTRAINT booth_funnel_events_once UNIQUE (session_id, event)
);

CREATE INDEX IF NOT EXISTS idx_booth_funnel_events_session
  ON public.booth_funnel_events(session_id);

ALTER TABLE public.booth_funnel_events ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 5. Terminal immutability — enforced by the database, not by convention.
--    A session that has reached any terminal outcome can never be updated
--    again, by ANY caller including service_role and including a direct SQL
--    statement that bypasses the RPCs entirely. The legitimate transitions
--    into a terminal outcome all read OLD.outcome = 'active', so they pass;
--    an idempotent replay performs no UPDATE at all.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.booth_sessions_freeze_terminal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.outcome <> 'active' THEN
    RAISE EXCEPTION 'booth_session_terminal_immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS booth_sessions_freeze_terminal ON public.booth_sessions;
CREATE TRIGGER booth_sessions_freeze_terminal
  BEFORE UPDATE ON public.booth_sessions
  FOR EACH ROW EXECUTE FUNCTION public.booth_sessions_freeze_terminal();

-- ----------------------------------------------------------------------------
-- 6. Privileges — service_role ONLY, with explicit REVOKEs.
--    No policies exist on these tables, and no anon/authenticated privilege is
--    granted or inherited: an anonymous or merely-signed-in client has no path
--    to booth data even if a default privilege changed upstream.
-- ----------------------------------------------------------------------------

REVOKE ALL ON TABLE public.booth_guides FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.booth_sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.booth_funnel_events FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.booth_guides TO service_role;
GRANT ALL ON TABLE public.booth_sessions TO service_role;
GRANT ALL ON TABLE public.booth_funnel_events TO service_role;

-- ----------------------------------------------------------------------------
-- 7. Atomic transaction functions.
--    Every one of these locks the session row through booth_lock_owned_session
--    (which also proves the caller owns it) and performs the whole state
--    transition — including its funnel events — in ONE transaction, so a retry
--    or a concurrent call can never produce a duplicate lead, a duplicate
--    event, or a partially-applied handoff. SECURITY DEFINER + SET search_path
--    = '' + fully qualified objects + no dynamic SQL; EXECUTE is service_role
--    only.
-- ----------------------------------------------------------------------------

-- Internal helper: record a funnel event at most once (same transaction).
CREATE OR REPLACE FUNCTION public.booth_emit_event(
  p_session_id UUID,
  p_event TEXT,
  p_step TEXT DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  INSERT INTO public.booth_funnel_events (session_id, event, step, reason)
  VALUES (p_session_id, p_event, p_step, p_reason)
  ON CONFLICT (session_id, event) DO NOTHING;
$$;

-- THE ownership gate. Locks the session row and proves the acting staff
-- account may touch it at all:
--   * the session's Host always may;
--   * with p_allow_assigned_guide, the session's currently assigned Guide —
--     matched through booth_guides.staff_user_id — may too, and the CALLER
--     then restricts WHICH facts that Guide is permitted to establish.
-- Anyone else is refused deterministically, before any write, so a rejected
-- operation changes zero rows.
CREATE OR REPLACE FUNCTION public.booth_lock_owned_session(
  p_client_ref TEXT,
  p_actor_user_id UUID,
  p_allow_assigned_guide BOOLEAN DEFAULT FALSE
)
RETURNS public.booth_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.booth_sessions;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'booth_session_forbidden';
  END IF;

  SELECT * INTO v_session FROM public.booth_sessions
    WHERE client_ref = p_client_ref FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booth_session_not_found';
  END IF;

  IF v_session.host_user_id = p_actor_user_id THEN
    RETURN v_session;
  END IF;

  IF p_allow_assigned_guide
     AND v_session.assigned_guide_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.booth_guides
        WHERE id = v_session.assigned_guide_id
          AND staff_user_id = p_actor_user_id
     ) THEN
    RETURN v_session;
  END IF;

  RAISE EXCEPTION 'booth_session_forbidden';
END;
$$;

-- THE ONLY WAY A BOOTH SESSION COMES INTO EXISTENCE (corrective pass 5).
--
-- It takes NO client reference. The reference is minted HERE with
-- pg_catalog.gen_random_uuid() — a cryptographically random server-side value —
-- so the browser can neither choose the identity of a new session nor guess an
-- existing one. The Host comes from the authenticated actor resolved at the
-- server boundary and the booth id from server configuration; neither is a
-- client-supplied label.
--
-- One invocation creates EXACTLY one session. There is deliberately no
-- ON CONFLICT clause: a reference this function issues must be new, so a
-- collision is a hard error rather than a silent adoption of a session that
-- already exists. Two concurrent calls therefore return two different
-- references and insert two distinct rows.
--
-- Nothing about a guest is written: only the operational shell (the reference,
-- the Host, the booth id), which is exactly what booth_sessions_pre_consent_minimal
-- permits before the consultation consent.
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

-- Open an EXISTING session for a client reference the server previously issued.
--
-- CREATES NOTHING (corrective pass 5). This function used to INSERT when the
-- reference was unknown, which meant an authorized staff account could tell an
-- unused reference (silently created, success) apart from a reference owned by
-- another Host (refused) — and could mint arbitrary empty sessions by presenting
-- invented references. Creation now lives ONLY in booth_create_session.
--
-- Replay rules: an existing session owned by the acting Host succeeds
-- idempotently; an unknown reference raises booth_session_not_found and a
-- foreign one raises booth_session_forbidden. The two exceptions stay distinct
-- HERE so an ownership bug is diagnosable in this suite; the TypeScript boundary
-- collapses both into one indistinguishable wire response. Neither refusal
-- creates a row and neither changes any row.
--
-- READ-ONLY (documented terminal-state exception): it only locks and returns the
-- row, so it is permitted on a terminal session — FOR UPDATE does not fire the
-- BEFORE UPDATE freeze trigger.
DROP FUNCTION IF EXISTS public.booth_ensure_session(TEXT, UUID, TEXT, TEXT);

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

-- Record a CLIENT-OBSERVED funnel event (and settle abandonment) atomically.
--
-- THIS FUNCTION IS THE BROWSER'S EVENT ENTRY POINT, AND IT ACCEPTS ONLY THE
-- THREE EVENTS THE TABLET IS THE SOLE WITNESS TO (PR #102 corrective pass 3,
-- item 3). Every fact-establishing transition event — profile_confirmed,
-- whatsapp_verified, guide_assigned, guide_acknowledged, guide_contacted,
-- consultation_booked, qr_continuation, viewing_booked — is emitted through
-- booth_emit_event by the RPC that performs the transition, in the same
-- transaction as the fact itself. Presenting one of them here is refused as the
-- FIRST statement of the function, before the session row is even located, so a
-- rejected call — including a direct service_role call that has bypassed every
-- application layer — cannot insert an event, settle an outcome, or touch any
-- session row.
--
-- A terminal session accepts ONLY an exact replay of the event its own outcome
-- already established; that replay is a no-op thanks to the once-only
-- constraint, so no funnel transition inconsistent with the terminal state can
-- ever be recorded.
CREATE OR REPLACE FUNCTION public.booth_record_event(
  p_client_ref TEXT,
  p_actor_user_id UUID,
  p_event TEXT,
  p_step TEXT,
  p_reason TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.booth_sessions;
BEGIN
  -- The client-observed allowlist, enforced before anything is read or written.
  IF p_event IS NULL OR p_event NOT IN (
    'meaningful_conversation',
    'profile_started',
    'session_abandoned'
  ) THEN
    RAISE EXCEPTION 'booth_event_not_client_observed';
  END IF;

  SELECT * INTO v_session FROM public.booth_lock_owned_session(p_client_ref, p_actor_user_id);

  IF v_session.outcome <> 'active' THEN
    IF v_session.outcome <> 'abandoned' OR p_event <> 'session_abandoned' THEN
      RAISE EXCEPTION 'booth_session_not_active';
    END IF;
    RETURN TRUE; -- idempotent replay of the terminal state's own event
  END IF;

  PERFORM public.booth_emit_event(v_session.id, p_event, p_step, p_reason);

  IF p_event = 'session_abandoned' THEN
    UPDATE public.booth_sessions
       SET outcome = 'abandoned',
           abandonment_step = p_step,
           abandonment_reason = p_reason,
           updated_at = now()
     WHERE id = v_session.id;
  END IF;
  RETURN TRUE;
END;
$$;

-- Mark that the guest confirmed a Decision Profile, WITHOUT persisting it.
-- Before consent the server learns only WHICH journey was completed (the flow
-- mode, part of the operational shell) and the non-personal funnel fact. The
-- profile content, the answers, the note, the budget, the areas, the concerns
-- and the language stay in the tablet's local session until
-- booth_commit_consent.
CREATE OR REPLACE FUNCTION public.booth_mark_profile_confirmed(
  p_client_ref TEXT,
  p_actor_user_id UUID,
  p_flow_mode TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.booth_sessions;
BEGIN
  SELECT * INTO v_session FROM public.booth_lock_owned_session(p_client_ref, p_actor_user_id);
  IF v_session.outcome <> 'active' THEN
    RAISE EXCEPTION 'booth_session_not_active';
  END IF;

  UPDATE public.booth_sessions
     SET flow_mode = p_flow_mode,
         updated_at = now()
   WHERE id = v_session.id;

  PERFORM public.booth_emit_event(v_session.id, 'profile_confirmed', p_flow_mode);
  RETURN TRUE;
END;
$$;

-- THE consent transaction. This is the ONLY operation that turns the guest's
-- acknowledgement into persisted truth, and it does the whole thing at once
-- under the session row lock:
--   * the confirmed Decision Profile, its version and its confirmation instant;
--   * the shortlist and its mode;
--   * the complete contact bundle and the preferred language;
--   * the consultation consent (and its timestamp) plus the marketing opt-in;
--   * exactly ONE lead, created if absent and UPDATED in place on every
--     accepted replay so the session, the lead and the summary can never drift
--     apart;
--   * the profile_confirmed funnel fact.
-- A failure anywhere rolls back BOTH the session and the lead: no orphan lead,
-- no stale mirror, no half-applied consent.
--
-- Correcting the WhatsApp number is a genuine identity change, so it
-- invalidates everything that was evidence about the OLD number: the
-- verification state, its timestamp and method, the first-contact evidence and
-- its attribution, and the whatsapp_verified / guide_contacted funnel events.
-- 'verified' is NEVER carried over to a replacement number, so completion
-- becomes blocked until the new number is verified afresh. The Guide
-- assignment and an already-agreed consultation instant SURVIVE: they are
-- facts about the people and the appointment, not about the number.
CREATE OR REPLACE FUNCTION public.booth_commit_consent(
  p_client_ref TEXT,
  p_actor_user_id UUID,
  p_flow_mode TEXT,
  p_profile JSONB,
  p_profile_version INTEGER,
  p_profile_confirmed_at TIMESTAMPTZ,
  p_shortlist JSONB,
  p_shortlist_mode TEXT,
  p_contact JSONB,
  p_lead JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.booth_sessions;
  v_lead_id UUID;
  v_updated INTEGER;
  v_now TIMESTAMPTZ := now();
  v_whatsapp TEXT := p_contact ->> 'whatsapp';
  v_number_changed BOOLEAN;
BEGIN
  SELECT * INTO v_session FROM public.booth_lock_owned_session(p_client_ref, p_actor_user_id);
  IF v_session.outcome <> 'active' THEN
    RAISE EXCEPTION 'booth_session_not_active';
  END IF;
  IF p_profile IS NULL OR p_profile_version IS NULL OR p_profile_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'booth_profile_required';
  END IF;

  v_number_changed := v_session.whatsapp IS NOT NULL
                      AND v_session.whatsapp IS DISTINCT FROM v_whatsapp;

  UPDATE public.booth_sessions
     SET flow_mode = p_flow_mode,
         profile = p_profile,
         profile_version = p_profile_version,
         profile_confirmed_at = p_profile_confirmed_at,
         shortlist = p_shortlist,
         shortlist_mode = p_shortlist_mode,
         first_name = p_contact ->> 'first_name',
         whatsapp = v_whatsapp,
         preferred_language = p_contact ->> 'preferred_language',
         last_name = p_contact ->> 'last_name',
         email = p_contact ->> 'email',
         country = p_contact ->> 'country',
         preferred_contact_time = p_contact ->> 'preferred_contact_time',
         host_note = p_contact ->> 'host_note',
         consultation_consent = TRUE,
         consent_recorded_at = COALESCE(v_session.consent_recorded_at, v_now),
         marketing_opt_in = COALESCE((p_contact ->> 'marketing_opt_in')::BOOLEAN, FALSE),
         -- A replacement number is never born verified.
         whatsapp_verification_state = CASE
           WHEN v_number_changed THEN 'unverified'
           ELSE v_session.whatsapp_verification_state END,
         whatsapp_verified_at = CASE
           WHEN v_number_changed THEN NULL ELSE v_session.whatsapp_verified_at END,
         whatsapp_verification_method = CASE
           WHEN v_number_changed THEN NULL ELSE v_session.whatsapp_verification_method END,
         -- Evidence of a message sent to the OLD number proves nothing here.
         guide_first_contact_at = CASE
           WHEN v_number_changed THEN NULL ELSE v_session.guide_first_contact_at END,
         guide_first_contact_by = CASE
           WHEN v_number_changed THEN NULL ELSE v_session.guide_first_contact_by END,
         guide_first_contact_method = CASE
           WHEN v_number_changed THEN NULL ELSE v_session.guide_first_contact_method END,
         updated_at = v_now
   WHERE id = v_session.id;

  IF v_number_changed THEN
    DELETE FROM public.booth_funnel_events
     WHERE session_id = v_session.id
       AND event IN ('whatsapp_verified', 'guide_contacted');
  END IF;

  -- Exactly one lead per session: the locked row's link is authoritative.
  -- Every accepted replay refreshes it, so the lead mirror never goes stale.
  v_lead_id := v_session.lead_id;
  IF v_lead_id IS NOT NULL THEN
    UPDATE public.leads
       SET name = p_lead ->> 'name',
           email = p_lead ->> 'email',
           phone = p_lead ->> 'phone',
           country = p_lead ->> 'country',
           budget = p_lead ->> 'budget',
           interest = p_lead ->> 'interest',
           project_slug = p_lead ->> 'project_slug',
           message = p_lead ->> 'message',
           source = p_lead ->> 'source'
     WHERE id = v_lead_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    -- The linked lead vanished (ON DELETE SET NULL races an operator delete):
    -- fall through and create a fresh one rather than report a stale link.
    IF v_updated = 0 THEN v_lead_id := NULL; END IF;
  END IF;

  IF v_lead_id IS NULL THEN
    INSERT INTO public.leads (name, email, phone, country, budget, interest, project_slug, message, status, source)
    VALUES (
      p_lead ->> 'name',
      p_lead ->> 'email',
      p_lead ->> 'phone',
      p_lead ->> 'country',
      p_lead ->> 'budget',
      p_lead ->> 'interest',
      p_lead ->> 'project_slug',
      p_lead ->> 'message',
      'new',
      p_lead ->> 'source'
    )
    RETURNING id INTO v_lead_id;

    UPDATE public.booth_sessions
       SET lead_id = v_lead_id, updated_at = v_now
     WHERE id = v_session.id;
  END IF;

  PERFORM public.booth_emit_event(v_session.id, 'profile_confirmed', p_flow_mode);
  RETURN v_lead_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.booth_set_whatsapp_state(
  p_client_ref TEXT,
  p_actor_user_id UUID,
  p_state TEXT,
  p_method TEXT
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.booth_sessions;
  v_verified_at TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_session FROM public.booth_lock_owned_session(p_client_ref, p_actor_user_id);
  IF v_session.outcome <> 'active' THEN
    RAISE EXCEPTION 'booth_session_not_active';
  END IF;

  IF p_state = 'verified' THEN
    IF v_session.whatsapp IS NULL THEN
      RAISE EXCEPTION 'booth_contact_required';
    END IF;
    v_verified_at := COALESCE(v_session.whatsapp_verified_at, now());
    UPDATE public.booth_sessions
       SET whatsapp_verification_state = 'verified',
           whatsapp_verified_at = v_verified_at,
           whatsapp_verification_method = COALESCE(v_session.whatsapp_verification_method, p_method),
           updated_at = now()
     WHERE id = v_session.id;
    PERFORM public.booth_emit_event(v_session.id, 'whatsapp_verified');
    RETURN v_verified_at;
  END IF;

  -- Any non-verified state clears the evidence: a pending or unavailable
  -- verification never leaves a stale verified timestamp behind.
  IF v_session.whatsapp_verification_state = 'verified' THEN
    RETURN v_session.whatsapp_verified_at;
  END IF;
  UPDATE public.booth_sessions
     SET whatsapp_verification_state = p_state,
         whatsapp_verified_at = NULL,
         whatsapp_verification_method = NULL,
         updated_at = now()
   WHERE id = v_session.id;
  RETURN NULL;
END;
$$;

-- Assign (or re-assign) the primary Guide. A GENUINE reassignment — a
-- different primary Guide — invalidates every downstream fact the PREVIOUS
-- Guide established, because that evidence cannot complete the new
-- assignment: the acknowledgement, the first contact, the agreed consultation
-- instant, the next step, and the corresponding funnel events are all cleared
-- so they must be re-earned. Facts that remain true regardless of who guides
-- the guest — the profile, the contact bundle, the consent and a verified
-- WhatsApp number — are deliberately kept. Changing only the reserve Guide or
-- the fallback reason is NOT a reassignment and resets nothing.
CREATE OR REPLACE FUNCTION public.booth_assign_guide(
  p_client_ref TEXT,
  p_actor_user_id UUID,
  p_guide_id UUID,
  p_reserve_guide_id UUID,
  p_fallback_reason TEXT
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.booth_sessions;
  v_now TIMESTAMPTZ := now();
  v_reassigned BOOLEAN;
BEGIN
  SELECT * INTO v_session FROM public.booth_lock_owned_session(p_client_ref, p_actor_user_id);
  IF v_session.outcome <> 'active' THEN
    RAISE EXCEPTION 'booth_session_not_active';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.booth_guides WHERE id = p_guide_id AND is_active
  ) THEN
    RAISE EXCEPTION 'booth_guide_not_found';
  END IF;
  IF p_reserve_guide_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.booth_guides WHERE id = p_reserve_guide_id AND is_active
  ) THEN
    RAISE EXCEPTION 'booth_guide_not_found';
  END IF;

  v_reassigned := v_session.assigned_guide_id IS NOT NULL
                  AND v_session.assigned_guide_id IS DISTINCT FROM p_guide_id;

  UPDATE public.booth_sessions
     SET assigned_guide_id = p_guide_id,
         reserve_guide_id = p_reserve_guide_id,
         guide_assigned_at = CASE
           WHEN v_session.assigned_guide_id IS DISTINCT FROM p_guide_id THEN v_now
           ELSE v_session.guide_assigned_at END,
         -- A newly assigned Guide has confirmed nothing yet.
         guide_acknowledged_at = CASE
           WHEN v_reassigned THEN NULL ELSE v_session.guide_acknowledged_at END,
         guide_acknowledged_by = CASE
           WHEN v_reassigned THEN NULL ELSE v_session.guide_acknowledged_by END,
         guide_acknowledged_method = CASE
           WHEN v_reassigned THEN NULL ELSE v_session.guide_acknowledged_method END,
         guide_first_contact_at = CASE
           WHEN v_reassigned THEN NULL ELSE v_session.guide_first_contact_at END,
         guide_first_contact_by = CASE
           WHEN v_reassigned THEN NULL ELSE v_session.guide_first_contact_by END,
         guide_first_contact_method = CASE
           WHEN v_reassigned THEN NULL ELSE v_session.guide_first_contact_method END,
         consultation_scheduled_at = CASE
           WHEN v_reassigned THEN NULL ELSE v_session.consultation_scheduled_at END,
         consultation_timezone = CASE
           WHEN v_reassigned THEN NULL ELSE v_session.consultation_timezone END,
         next_step = CASE
           WHEN v_reassigned THEN NULL ELSE v_session.next_step END,
         guide_fallback_reason = NULLIF(btrim(p_fallback_reason), ''),
         updated_at = v_now
   WHERE id = v_session.id;

  -- The previous Guide's funnel evidence is deleted, not left standing.
  IF v_reassigned THEN
    DELETE FROM public.booth_funnel_events
     WHERE session_id = v_session.id
       AND event IN ('guide_acknowledged', 'guide_contacted', 'consultation_booked');
  END IF;

  PERFORM public.booth_emit_event(v_session.id, 'guide_assigned');
  RETURN v_now;
END;
$$;

-- Record the acknowledgement. The Host always may; the session's currently
-- assigned Guide may confirm their OWN acknowledgement and nothing else.
-- 'guide_self_confirmed' is only truthful when the actor IS that Guide's own
-- staff account; anything else must be recorded as a disclosed observation.
CREATE OR REPLACE FUNCTION public.booth_acknowledge_guide(
  p_client_ref TEXT,
  p_actor_user_id UUID,
  p_method TEXT
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.booth_sessions;
  v_at TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_session FROM public.booth_lock_owned_session(p_client_ref, p_actor_user_id, TRUE);
  IF v_session.outcome <> 'active' THEN
    RAISE EXCEPTION 'booth_session_not_active';
  END IF;
  IF v_session.assigned_guide_id IS NULL THEN
    RAISE EXCEPTION 'booth_guide_required';
  END IF;
  IF p_method = 'guide_self_confirmed' AND NOT EXISTS (
    SELECT 1 FROM public.booth_guides
     WHERE id = v_session.assigned_guide_id AND staff_user_id = p_actor_user_id
  ) THEN
    RAISE EXCEPTION 'booth_ack_actor_mismatch';
  END IF;
  -- A non-Host actor reached this point only as the assigned Guide, and may
  -- establish nothing except their own acknowledgement.
  IF v_session.host_user_id <> p_actor_user_id AND p_method <> 'guide_self_confirmed' THEN
    RAISE EXCEPTION 'booth_session_forbidden';
  END IF;

  v_at := COALESCE(v_session.guide_acknowledged_at, now());
  UPDATE public.booth_sessions
     SET guide_acknowledged_at = v_at,
         guide_acknowledged_by = COALESCE(v_session.guide_acknowledged_by, p_actor_user_id),
         guide_acknowledged_method = COALESCE(v_session.guide_acknowledged_method, p_method),
         updated_at = now()
   WHERE id = v_session.id;

  PERFORM public.booth_emit_event(v_session.id, 'guide_acknowledged');
  RETURN v_at;
END;
$$;

-- Record the warm handoff. The Host may record all of it. The session's
-- assigned Guide may ONLY confirm their own first contact: a Guide call that
-- also tries to set the consultation instant or the next step is refused, as
-- is a Guide call claiming a host observation.
CREATE OR REPLACE FUNCTION public.booth_record_handoff(
  p_client_ref TEXT,
  p_actor_user_id UUID,
  p_first_contact_method TEXT,
  p_consultation_scheduled_at TIMESTAMPTZ,
  p_consultation_timezone TEXT,
  p_next_step TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.booth_sessions;
  v_now TIMESTAMPTZ := now();
  v_first_contact_at TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_session FROM public.booth_lock_owned_session(p_client_ref, p_actor_user_id, TRUE);
  IF v_session.outcome <> 'active' THEN
    RAISE EXCEPTION 'booth_session_not_active';
  END IF;

  IF v_session.host_user_id <> p_actor_user_id
     AND (
       p_first_contact_method IS DISTINCT FROM 'guide_self_confirmed'
       OR p_consultation_scheduled_at IS NOT NULL
       OR NULLIF(btrim(p_next_step), '') IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'booth_session_forbidden';
  END IF;

  v_first_contact_at := v_session.guide_first_contact_at;
  IF p_first_contact_method IS NOT NULL AND v_first_contact_at IS NULL THEN
    IF v_session.assigned_guide_id IS NULL THEN
      RAISE EXCEPTION 'booth_guide_required';
    END IF;
    IF p_first_contact_method = 'guide_self_confirmed' AND NOT EXISTS (
      SELECT 1 FROM public.booth_guides
       WHERE id = v_session.assigned_guide_id AND staff_user_id = p_actor_user_id
    ) THEN
      RAISE EXCEPTION 'booth_ack_actor_mismatch';
    END IF;
    v_first_contact_at := v_now;
  END IF;

  UPDATE public.booth_sessions
     SET guide_first_contact_at = v_first_contact_at,
         guide_first_contact_by = CASE
           WHEN v_first_contact_at IS NULL THEN NULL
           ELSE COALESCE(v_session.guide_first_contact_by, p_actor_user_id) END,
         guide_first_contact_method = CASE
           WHEN v_first_contact_at IS NULL THEN NULL
           ELSE COALESCE(v_session.guide_first_contact_method, p_first_contact_method) END,
         consultation_scheduled_at =
           COALESCE(p_consultation_scheduled_at, v_session.consultation_scheduled_at),
         consultation_timezone = CASE
           WHEN p_consultation_scheduled_at IS NOT NULL THEN NULLIF(btrim(p_consultation_timezone), '')
           ELSE v_session.consultation_timezone END,
         next_step = COALESCE(NULLIF(btrim(p_next_step), ''), v_session.next_step),
         updated_at = v_now
   WHERE id = v_session.id;

  IF v_first_contact_at IS NOT NULL THEN
    PERFORM public.booth_emit_event(v_session.id, 'guide_contacted');
  END IF;
  IF p_consultation_scheduled_at IS NOT NULL THEN
    PERFORM public.booth_emit_event(v_session.id, 'consultation_booked');
  END IF;
  RETURN TRUE;
END;
$$;

-- Complete the session. A contacted completion is gated on every fact (and the
-- table CHECK backs it up). A no-contact completion CLEARS every guest-specific
-- value (see NO-CONTACT DATA MINIMIZATION above) and DELETES any lead created
-- for this session — all in one transaction, so a partial clear can never be
-- observed or left behind. Replaying the outcome the session already holds is
-- an idempotent success that writes nothing.
CREATE OR REPLACE FUNCTION public.booth_complete_session(
  p_client_ref TEXT,
  p_actor_user_id UUID,
  p_outcome TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.booth_sessions;
  v_lead_id UUID;
BEGIN
  SELECT * INTO v_session FROM public.booth_lock_owned_session(p_client_ref, p_actor_user_id);
  IF v_session.outcome = p_outcome THEN
    RETURN TRUE; -- idempotent replay of the established terminal outcome
  END IF;
  IF v_session.outcome <> 'active' THEN
    RAISE EXCEPTION 'booth_session_not_active';
  END IF;

  IF p_outcome = 'contacted_complete' THEN
    IF v_session.profile_confirmed_at IS NULL
       OR v_session.first_name IS NULL
       OR v_session.whatsapp IS NULL
       OR v_session.preferred_language IS NULL
       OR NOT v_session.consultation_consent
       OR v_session.consent_recorded_at IS NULL
       OR v_session.whatsapp_verification_state <> 'verified'
       OR v_session.assigned_guide_id IS NULL
       OR v_session.next_step IS NULL
       OR (v_session.consultation_scheduled_at IS NULL
           AND v_session.guide_first_contact_at IS NULL) THEN
      RAISE EXCEPTION 'booth_completion_blocked';
    END IF;
    UPDATE public.booth_sessions
       SET outcome = 'contacted_complete', updated_at = now()
     WHERE id = v_session.id;
    RETURN TRUE;
  END IF;

  IF p_outcome <> 'no_contact_qr' THEN
    RAISE EXCEPTION 'booth_outcome_invalid';
  END IF;

  v_lead_id := v_session.lead_id;
  UPDATE public.booth_sessions
     SET flow_mode = NULL,
         profile = NULL,
         profile_version = NULL,
         profile_confirmed_at = NULL,
         shortlist = '[]'::jsonb,
         shortlist_mode = 'none',
         first_name = NULL,
         whatsapp = NULL,
         last_name = NULL,
         email = NULL,
         country = NULL,
         preferred_contact_time = NULL,
         host_note = NULL,
         preferred_language = NULL,
         consultation_consent = FALSE,
         consent_recorded_at = NULL,
         marketing_opt_in = FALSE,
         whatsapp_verification_state = 'unverified',
         whatsapp_verified_at = NULL,
         whatsapp_verification_method = NULL,
         assigned_guide_id = NULL,
         reserve_guide_id = NULL,
         guide_assigned_at = NULL,
         guide_acknowledged_at = NULL,
         guide_acknowledged_by = NULL,
         guide_acknowledged_method = NULL,
         guide_first_contact_at = NULL,
         guide_first_contact_by = NULL,
         guide_first_contact_method = NULL,
         guide_fallback_reason = NULL,
         consultation_scheduled_at = NULL,
         consultation_timezone = NULL,
         next_step = NULL,
         lead_id = NULL,
         outcome = 'no_contact_qr',
         updated_at = now()
   WHERE id = v_session.id;

  -- No lead may exist for a no-contact session.
  IF v_lead_id IS NOT NULL THEN
    DELETE FROM public.leads WHERE id = v_lead_id;
  END IF;

  PERFORM public.booth_emit_event(v_session.id, 'qr_continuation');
  RETURN TRUE;
END;
$$;

-- Privileged RPCs: revoke every inherited privilege, then grant EXECUTE to
-- service_role alone. No anonymous or merely-authenticated caller can execute
-- them even with a valid Supabase session.
REVOKE ALL ON FUNCTION public.booth_sessions_freeze_terminal() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booth_emit_event(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booth_lock_owned_session(TEXT, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booth_create_session(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booth_ensure_session(TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booth_record_event(TEXT, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booth_mark_profile_confirmed(TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booth_commit_consent(TEXT, UUID, TEXT, JSONB, INTEGER, TIMESTAMPTZ, JSONB, TEXT, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booth_set_whatsapp_state(TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booth_assign_guide(TEXT, UUID, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booth_acknowledge_guide(TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booth_record_handoff(TEXT, UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booth_complete_session(TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.booth_emit_event(UUID, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.booth_lock_owned_session(TEXT, UUID, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.booth_create_session(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.booth_ensure_session(TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.booth_record_event(TEXT, UUID, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.booth_mark_profile_confirmed(TEXT, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.booth_commit_consent(TEXT, UUID, TEXT, JSONB, INTEGER, TIMESTAMPTZ, JSONB, TEXT, JSONB, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.booth_set_whatsapp_state(TEXT, UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.booth_assign_guide(TEXT, UUID, UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.booth_acknowledge_guide(TEXT, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.booth_record_handoff(TEXT, UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.booth_complete_session(TEXT, UUID, TEXT) TO service_role;

-- ----------------------------------------------------------------------------
-- 8. leads — allow service-boundary Booth V2 leads without an email address.
--    The anonymous INSERT policy is deliberately NOT modified: it still
--    requires length(btrim(email)) > 0, which is never true for NULL, so the
--    browser-side contract is unchanged and NULL-email rows can only come from
--    the trusted server boundary.
-- ----------------------------------------------------------------------------

ALTER TABLE public.leads ALTER COLUMN email DROP NOT NULL;

ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_email_format;
ALTER TABLE public.leads ADD CONSTRAINT leads_email_format CHECK (
  email IS NULL OR email ~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$'
);

COMMIT;

-- ============================================================================
-- DOWN (reversal REFERENCE only — verify each precondition before running):
--
--   1. Booth pilot data lives ONLY in the three booth tables; dropping them
--      destroys that pilot data:
--        DROP TRIGGER IF EXISTS booth_sessions_freeze_terminal ON public.booth_sessions;
--        DROP FUNCTION IF EXISTS public.booth_sessions_freeze_terminal();
--        DROP FUNCTION IF EXISTS public.booth_complete_session(TEXT, UUID, TEXT);
--        DROP FUNCTION IF EXISTS public.booth_record_handoff(TEXT, UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT);
--        DROP FUNCTION IF EXISTS public.booth_acknowledge_guide(TEXT, UUID, TEXT);
--        DROP FUNCTION IF EXISTS public.booth_assign_guide(TEXT, UUID, UUID, UUID, TEXT);
--        DROP FUNCTION IF EXISTS public.booth_set_whatsapp_state(TEXT, UUID, TEXT, TEXT);
--        DROP FUNCTION IF EXISTS public.booth_commit_consent(TEXT, UUID, TEXT, JSONB, INTEGER, TIMESTAMPTZ, JSONB, TEXT, JSONB, JSONB);
--        DROP FUNCTION IF EXISTS public.booth_mark_profile_confirmed(TEXT, UUID, TEXT);
--        DROP FUNCTION IF EXISTS public.booth_record_event(TEXT, UUID, TEXT, TEXT, TEXT);
--        DROP FUNCTION IF EXISTS public.booth_ensure_session(TEXT, UUID);
--        DROP FUNCTION IF EXISTS public.booth_create_session(UUID, TEXT, TEXT);
--        DROP FUNCTION IF EXISTS public.booth_lock_owned_session(TEXT, UUID, BOOLEAN);
--        DROP FUNCTION IF EXISTS public.booth_emit_event(UUID, TEXT, TEXT, TEXT);
--        DROP TABLE IF EXISTS public.booth_funnel_events;
--        DROP TABLE IF EXISTS public.booth_sessions;
--        DROP TABLE IF EXISTS public.booth_guides;
--   2. The Booth capability column is additive and Studio never reads it, so
--      dropping it is safe and affects no Studio behaviour:
--        ALTER TABLE public.studio_members DROP COLUMN IF EXISTS can_access_booth;
--   3. Restoring the strict leads email contract is only safe when no
--      NULL-email rows exist (Booth V2 pilot leads would violate it). First:
--        SELECT count(*) FROM public.leads WHERE email IS NULL;
--      Only if that is zero:
--        ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_email_format;
--        ALTER TABLE public.leads ADD CONSTRAINT leads_email_format CHECK (
--          email ~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$'
--        );
--        ALTER TABLE public.leads ALTER COLUMN email SET NOT NULL;
--      If it is non-zero, those rows need an explicit operator decision first —
--      never a silent delete.
-- ============================================================================
