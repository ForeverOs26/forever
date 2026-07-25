-- ============================================================================
-- FOREVER BOOTH MODE 2.0 — PILOT MIGRATION DRAFT (pending; NOT applied)
--
-- FOREVER-BOOTH-ASSISTED-DECISION-001 + PR #102 corrective pass 1.
-- This file has never been applied to any environment (it is unmerged and
-- unapplied), so the corrective pass rewrites it IN PLACE rather than layering
-- a second migration on an imaginary applied state. It is exercised only by
-- the disposable PostgreSQL harness (npm run studio:pg-test).
--
-- TRUST MODEL (corrective pass 1)
--   The booth tablet is NOT an anonymous kiosk. Every Booth V2 server function
--   runs behind an authenticated, active Forever staff identity
--   (public.studio_members — the existing staff roster; no second identity
--   system is introduced) AND a default-disabled server-side enablement flag.
--   These tables therefore carry NO anonymous or authenticated grants at all:
--   RLS is enabled with no policies, every privilege is explicitly REVOKEd
--   from PUBLIC / anon / authenticated, and only service_role — reachable
--   solely through the authenticated server boundary — may touch them.
--
-- WHAT THIS MIGRATION DOES — exact, in order:
--   1. booth_guides — operator-maintained Guide roster, optionally linked to an
--      auth user so a Guide can confirm their own acknowledgement. NO seed rows.
--   2. booth_sessions — the authoritative structured record: versioned
--      confirmed Decision Profile, server-derived Host identity, shortlist
--      (0–4), an all-or-nothing contact bundle with format checks, separate
--      consents, manual WhatsApp verification, Guide assignment with attributed
--      acknowledgement/first-contact, a STRUCTURED consultation instant
--      (TIMESTAMPTZ), truthful completion gates, and a UNIQUE lead link.
--   3. booth_funnel_events — once-only structured pilot events.
--   4. Atomic SECURITY DEFINER RPCs (service_role EXECUTE only, search_path='')
--      so contact+lead creation, verification, assignment, handoff and
--      completion are single transactions with the session row locked — a
--      retry can never create a second lead or a partial state.
--   5. public.leads: email becomes nullable with a NULL-tolerant format CHECK
--      so the trusted server can mirror a booth lead that has no email. The
--      anonymous INSERT policy is NOT modified: it still requires a non-blank
--      email, so the website's browser-side contract is unchanged and a
--      NULL-email lead can only originate from the trusted server boundary.
--
-- ROLLBACK TRUTH: see the DOWN reference at the end. The booth objects are new;
-- dropping them destroys only pilot data. Restoring leads.email NOT NULL is
-- safe only after verifying no NULL-email rows exist.
--
-- The static suite
-- src/features/navigator/core/v2/booth-v2-migration-contract.test.ts pins this
-- file's security contract; src/features/navigator/booth-v2/tests/booth.postgres.sql
-- exercises its behaviour against a disposable PostgreSQL instance.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. booth_guides — operator-maintained roster (NO seed data)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.booth_guides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  display_name TEXT NOT NULL,
  -- Optional link to an authenticated staff account: when present, that Guide
  -- can confirm their OWN acknowledgement ('guide_self_confirmed'); otherwise
  -- only a disclosed Host observation is possible.
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
-- 2. booth_sessions — authoritative structured Booth V2 session record
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.booth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Idempotency: the tablet generates one random reference per guest session;
  -- every server write upserts on it, so retries never duplicate a session.
  client_ref TEXT NOT NULL UNIQUE,
  CONSTRAINT booth_sessions_client_ref_not_empty CHECK (length(btrim(client_ref)) > 0),

  -- Host identity is SERVER-DERIVED from the authenticated staff account that
  -- opened the session. There is no client-supplied host label anywhere.
  host_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  host_email TEXT,
  booth_id TEXT NOT NULL DEFAULT 'unconfigured',

  -- Versioned confirmed Decision Profile. The jsonb payload is authoritative;
  -- profile_version lets consumers fail closed on obsolete payloads.
  flow_mode TEXT CHECK (flow_mode IN ('quick', 'full')),
  profile JSONB,
  profile_version INTEGER,
  profile_confirmed_at TIMESTAMPTZ,
  CONSTRAINT booth_sessions_profile_versioned CHECK (
    (profile IS NULL AND profile_version IS NULL AND profile_confirmed_at IS NULL)
    OR (profile IS NOT NULL AND profile_version IS NOT NULL AND profile_confirmed_at IS NOT NULL)
  ),

  -- Shortlist of ZERO to FOUR directions — enforced here, not only in the UI.
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
  -- so it may exist before any contact data. It must agree with the confirmed
  -- profile payload (checked below) and is cleared on a no-contact outcome.
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
  -- acknowledgement; marketing is opt-in only and defaults to FALSE.
  consultation_consent BOOLEAN NOT NULL DEFAULT FALSE,
  consent_recorded_at TIMESTAMPTZ,
  marketing_opt_in BOOLEAN NOT NULL DEFAULT FALSE,

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
  -- A no-contact session retains NOTHING personal or operational about the
  -- guest: no contact bundle, no consents, no verification, no Guide, no
  -- handoff timestamps, no next step, and no lead link.
  CONSTRAINT booth_sessions_no_contact_retains_nothing CHECK (
    outcome <> 'no_contact_qr'
    OR (
      first_name IS NULL AND whatsapp IS NULL AND last_name IS NULL
      AND email IS NULL AND country IS NULL AND preferred_contact_time IS NULL
      AND host_note IS NULL AND preferred_language IS NULL
      AND consultation_consent = FALSE AND consent_recorded_at IS NULL
      AND marketing_opt_in = FALSE
      AND whatsapp_verification_state = 'unverified'
      AND whatsapp_verified_at IS NULL AND whatsapp_verification_method IS NULL
      AND assigned_guide_id IS NULL AND reserve_guide_id IS NULL
      AND guide_assigned_at IS NULL AND guide_acknowledged_at IS NULL
      AND guide_first_contact_at IS NULL
      AND consultation_scheduled_at IS NULL AND next_step IS NULL
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
-- 3. booth_funnel_events — once-only structured pilot funnel events
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
  -- Each funnel event is recorded at most once per session.
  CONSTRAINT booth_funnel_events_once UNIQUE (session_id, event)
);

CREATE INDEX IF NOT EXISTS idx_booth_funnel_events_session
  ON public.booth_funnel_events(session_id);

ALTER TABLE public.booth_funnel_events ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 4. Privileges — service_role ONLY, with explicit REVOKEs.
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
-- 5. Atomic transaction functions.
--    Every one of these locks the session row and performs the whole state
--    transition (including its funnel event) in ONE transaction, so a retry or
--    a concurrent call can never produce a duplicate lead, a duplicate event,
--    or a partially-applied handoff. SECURITY DEFINER + SET search_path = ''
--    + fully qualified objects + no dynamic SQL; EXECUTE is service_role only.
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

-- Create (or return) the session for a client reference. Host identity comes
-- from the authenticated caller resolved at the server boundary.
CREATE OR REPLACE FUNCTION public.booth_ensure_session(
  p_client_ref TEXT,
  p_host_user_id UUID,
  p_host_email TEXT,
  p_booth_id TEXT
)
RETURNS public.booth_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.booth_sessions;
BEGIN
  INSERT INTO public.booth_sessions (client_ref, host_user_id, host_email, booth_id)
  VALUES (p_client_ref, p_host_user_id, NULLIF(btrim(p_host_email), ''), p_booth_id)
  ON CONFLICT (client_ref) DO NOTHING;

  SELECT * INTO v_session FROM public.booth_sessions WHERE client_ref = p_client_ref;
  RETURN v_session;
END;
$$;

-- Record a client-observed funnel event (and settle abandonment) atomically.
CREATE OR REPLACE FUNCTION public.booth_record_event(
  p_client_ref TEXT,
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
  SELECT * INTO v_session FROM public.booth_sessions
    WHERE client_ref = p_client_ref FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booth_session_not_found';
  END IF;

  PERFORM public.booth_emit_event(v_session.id, p_event, p_step, p_reason);

  IF p_event = 'session_abandoned' AND v_session.outcome = 'active' THEN
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

-- Confirm the Decision Profile (and its preferred language) atomically.
CREATE OR REPLACE FUNCTION public.booth_confirm_profile(
  p_client_ref TEXT,
  p_flow_mode TEXT,
  p_profile JSONB,
  p_profile_version INTEGER,
  p_confirmed_at TIMESTAMPTZ,
  p_preferred_language TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.booth_sessions;
BEGIN
  SELECT * INTO v_session FROM public.booth_sessions
    WHERE client_ref = p_client_ref FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booth_session_not_found';
  END IF;
  IF v_session.outcome <> 'active' THEN
    RAISE EXCEPTION 'booth_session_not_active';
  END IF;

  UPDATE public.booth_sessions
     SET flow_mode = p_flow_mode,
         profile = p_profile,
         profile_version = p_profile_version,
         profile_confirmed_at = p_confirmed_at,
         preferred_language = NULLIF(btrim(p_preferred_language), ''),
         updated_at = now()
   WHERE id = v_session.id;

  PERFORM public.booth_emit_event(v_session.id, 'profile_confirmed');
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.booth_set_shortlist(
  p_client_ref TEXT,
  p_shortlist JSONB,
  p_shortlist_mode TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.booth_sessions;
BEGIN
  SELECT * INTO v_session FROM public.booth_sessions
    WHERE client_ref = p_client_ref FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booth_session_not_found';
  END IF;
  IF v_session.outcome <> 'active' THEN
    RAISE EXCEPTION 'booth_session_not_active';
  END IF;

  UPDATE public.booth_sessions
     SET shortlist = p_shortlist,
         shortlist_mode = p_shortlist_mode,
         updated_at = now()
   WHERE id = v_session.id;
  RETURN TRUE;
END;
$$;

-- Save the contact bundle AND create-or-return exactly one lead, atomically.
-- The session row is locked first, so two concurrent retries serialize: the
-- second sees the linked lead and returns the SAME lead id. A failure at any
-- point rolls the whole thing back — no unattached lead can survive.
CREATE OR REPLACE FUNCTION public.booth_save_contact_and_lead(
  p_client_ref TEXT,
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
  v_now TIMESTAMPTZ := now();
BEGIN
  SELECT * INTO v_session FROM public.booth_sessions
    WHERE client_ref = p_client_ref FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booth_session_not_found';
  END IF;
  IF v_session.outcome <> 'active' THEN
    RAISE EXCEPTION 'booth_session_not_active';
  END IF;
  IF v_session.profile IS NULL THEN
    RAISE EXCEPTION 'booth_profile_required';
  END IF;

  UPDATE public.booth_sessions
     SET first_name = p_contact ->> 'first_name',
         whatsapp = p_contact ->> 'whatsapp',
         preferred_language = p_contact ->> 'preferred_language',
         last_name = p_contact ->> 'last_name',
         email = p_contact ->> 'email',
         country = p_contact ->> 'country',
         preferred_contact_time = p_contact ->> 'preferred_contact_time',
         host_note = p_contact ->> 'host_note',
         consultation_consent = TRUE,
         consent_recorded_at = COALESCE(v_session.consent_recorded_at, v_now),
         marketing_opt_in = COALESCE((p_contact ->> 'marketing_opt_in')::BOOLEAN, FALSE),
         updated_at = v_now
   WHERE id = v_session.id;

  -- Exactly one lead per session: the locked row's link is authoritative.
  IF v_session.lead_id IS NOT NULL THEN
    RETURN v_session.lead_id;
  END IF;

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

  RETURN v_lead_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.booth_set_whatsapp_state(
  p_client_ref TEXT,
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
  SELECT * INTO v_session FROM public.booth_sessions
    WHERE client_ref = p_client_ref FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booth_session_not_found';
  END IF;
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
           whatsapp_verification_method = p_method,
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

CREATE OR REPLACE FUNCTION public.booth_assign_guide(
  p_client_ref TEXT,
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
BEGIN
  SELECT * INTO v_session FROM public.booth_sessions
    WHERE client_ref = p_client_ref FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booth_session_not_found';
  END IF;
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

  -- Re-assignment resets the acknowledgement: the new Guide has not confirmed.
  UPDATE public.booth_sessions
     SET assigned_guide_id = p_guide_id,
         reserve_guide_id = p_reserve_guide_id,
         guide_assigned_at = v_now,
         guide_acknowledged_at = NULL,
         guide_acknowledged_by = NULL,
         guide_acknowledged_method = NULL,
         guide_fallback_reason = NULLIF(btrim(p_fallback_reason), ''),
         updated_at = v_now
   WHERE id = v_session.id;

  PERFORM public.booth_emit_event(v_session.id, 'guide_assigned');
  RETURN v_now;
END;
$$;

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
  SELECT * INTO v_session FROM public.booth_sessions
    WHERE client_ref = p_client_ref FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booth_session_not_found';
  END IF;
  IF v_session.assigned_guide_id IS NULL THEN
    RAISE EXCEPTION 'booth_guide_required';
  END IF;
  -- 'guide_self_confirmed' is only truthful when the actor IS the assigned
  -- Guide's own staff account; anything else must be recorded as an observation.
  IF p_method = 'guide_self_confirmed' AND NOT EXISTS (
    SELECT 1 FROM public.booth_guides
     WHERE id = v_session.assigned_guide_id AND staff_user_id = p_actor_user_id
  ) THEN
    RAISE EXCEPTION 'booth_ack_actor_mismatch';
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
  SELECT * INTO v_session FROM public.booth_sessions
    WHERE client_ref = p_client_ref FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booth_session_not_found';
  END IF;
  IF v_session.outcome <> 'active' THEN
    RAISE EXCEPTION 'booth_session_not_active';
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
-- table CHECK backs it up). A no-contact completion CLEARS every personal and
-- operational field and DELETES any lead created for this session — all in one
-- transaction, so a partial clear can never be observed or left behind.
CREATE OR REPLACE FUNCTION public.booth_complete_session(
  p_client_ref TEXT,
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
  SELECT * INTO v_session FROM public.booth_sessions
    WHERE client_ref = p_client_ref FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booth_session_not_found';
  END IF;
  IF v_session.outcome = p_outcome THEN
    RETURN TRUE; -- idempotent replay
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
     SET first_name = NULL,
         whatsapp = NULL,
         last_name = NULL,
         email = NULL,
         country = NULL,
         preferred_contact_time = NULL,
         host_note = NULL,
         preferred_language = NULL,
         profile = CASE
           WHEN profile IS NULL THEN NULL
           ELSE jsonb_set(profile, '{preferredLanguage}', 'null'::jsonb, true) END,
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
REVOKE ALL ON FUNCTION public.booth_emit_event(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booth_ensure_session(TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booth_record_event(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booth_confirm_profile(TEXT, TEXT, JSONB, INTEGER, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booth_set_shortlist(TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booth_save_contact_and_lead(TEXT, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booth_set_whatsapp_state(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booth_assign_guide(TEXT, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booth_acknowledge_guide(TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booth_record_handoff(TEXT, UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booth_complete_session(TEXT, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.booth_emit_event(UUID, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.booth_ensure_session(TEXT, UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.booth_record_event(TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.booth_confirm_profile(TEXT, TEXT, JSONB, INTEGER, TIMESTAMPTZ, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.booth_set_shortlist(TEXT, JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.booth_save_contact_and_lead(TEXT, JSONB, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.booth_set_whatsapp_state(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.booth_assign_guide(TEXT, UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.booth_acknowledge_guide(TEXT, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.booth_record_handoff(TEXT, UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.booth_complete_session(TEXT, TEXT) TO service_role;

-- ----------------------------------------------------------------------------
-- 6. leads — allow service-boundary Booth V2 leads without an email address.
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
--        DROP FUNCTION IF EXISTS public.booth_complete_session(TEXT, TEXT);
--        DROP FUNCTION IF EXISTS public.booth_record_handoff(TEXT, UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT);
--        DROP FUNCTION IF EXISTS public.booth_acknowledge_guide(TEXT, UUID, TEXT);
--        DROP FUNCTION IF EXISTS public.booth_assign_guide(TEXT, UUID, UUID, TEXT);
--        DROP FUNCTION IF EXISTS public.booth_set_whatsapp_state(TEXT, TEXT, TEXT);
--        DROP FUNCTION IF EXISTS public.booth_save_contact_and_lead(TEXT, JSONB, JSONB);
--        DROP FUNCTION IF EXISTS public.booth_set_shortlist(TEXT, JSONB, TEXT);
--        DROP FUNCTION IF EXISTS public.booth_confirm_profile(TEXT, TEXT, JSONB, INTEGER, TIMESTAMPTZ, TEXT);
--        DROP FUNCTION IF EXISTS public.booth_record_event(TEXT, TEXT, TEXT, TEXT);
--        DROP FUNCTION IF EXISTS public.booth_ensure_session(TEXT, UUID, TEXT, TEXT);
--        DROP FUNCTION IF EXISTS public.booth_emit_event(UUID, TEXT, TEXT, TEXT);
--        DROP TABLE IF EXISTS public.booth_funnel_events;
--        DROP TABLE IF EXISTS public.booth_sessions;
--        DROP TABLE IF EXISTS public.booth_guides;
--   2. Restoring the strict leads email contract is only safe when no
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
