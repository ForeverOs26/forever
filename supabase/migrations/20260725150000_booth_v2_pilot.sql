-- ============================================================================
-- FOREVER BOOTH MODE 2.0 — PILOT MIGRATION DRAFT (pending; NOT applied here)
--
-- FOREVER-BOOTH-ASSISTED-DECISION-001: structured storage for the Assisted
-- Decision Concierge pilot. This file is ADDITIVE except for one deliberate
-- widening of public.leads (email becomes nullable so a service-boundary
-- Booth V2 lead — first name + WhatsApp + language only — can be mirrored
-- into the human-readable leads list). The anonymous INSERT policy on leads
-- is NOT weakened: it still requires a non-blank email, so the browser-side
-- website contact flow keeps exactly its current contract. NULL-email leads
-- can only be written by the trusted server boundary (service_role).
--
-- WHAT THIS MIGRATION DOES — exact, in order:
--   1. booth_guides — operator-maintained Guide roster. NO seed rows: real
--      staff records are entered by the operator later; this task never
--      invents staff names or phone numbers.
--   2. booth_sessions — the authoritative structured record of a Booth V2
--      session: versioned confirmed Decision Profile (jsonb), flow mode,
--      shortlist (0–4, enforced by CHECK), light contact + separate consents,
--      manual WhatsApp verification state, Guide assignment + handoff
--      timestamps, next step, outcome, abandonment step/reason, and a link to
--      the mirrored human-readable lead row.
--   3. booth_funnel_events — once-only structured funnel events per session
--      (UNIQUE (session_id, event)); no conversation content, no device data.
--   4. public.leads: ALTER email DROP NOT NULL + replace the email-format
--      CHECK with a NULL-tolerant one. Policy "Anyone can submit a lead" is
--      untouched (anon still must supply a non-blank email).
--
-- SECURITY MODEL (least privilege):
--   • All three booth tables have RLS ENABLED with NO policies and NO anon /
--     authenticated grants — the same internal-only pattern as
--     studio_members. Only service_role can read or write them, so an
--     anonymous browser client can never spoof a Host/Guide identity,
--     fabricate a verification, or read another guest's session. Every booth
--     write goes through the server boundary (TanStack server functions using
--     the service-role client), which enforces the state transitions.
--   • Idempotency: booth_sessions.client_ref is UNIQUE (client-generated
--     random reference); booth_funnel_events (session_id, event) is UNIQUE —
--     retries can never duplicate a session, lead link, or funnel event.
--   • Truthful completion is enforced in the database: outcome
--     'contacted_complete' requires a confirmed profile, verified WhatsApp,
--     an assigned Guide, a recorded next step, and an exact scheduled time or
--     a confirmed live first contact. Outcome 'no_contact_qr' requires that
--     no contact data is stored.
--   • No real staff names, no real phone numbers, no exchange rates, and no
--     conversion targets appear anywhere in this file.
--
-- ROLLBACK TRUTH: the DOWN section at the end is a REFERENCE. The three
-- booth tables are new — dropping them destroys only pilot data collected
-- after this migration was applied. Restoring leads.email NOT NULL is only
-- safe after verifying no NULL-email rows exist (booth pilot rows would
-- violate it); the DOWN section spells out the exact order.
--
-- The static suite
-- src/features/navigator/core/v2/booth-v2-migration-contract.test.ts pins
-- this file's security contract; the real-database runner
-- (npm run studio:pg-test) applies the complete committed migration chain
-- including this file against a disposable PostgreSQL instance.
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
  languages TEXT[] NOT NULL DEFAULT '{}',
  specializations TEXT[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  on_duty BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT booth_guides_name_not_empty CHECK (length(btrim(display_name)) > 0)
);

ALTER TABLE public.booth_guides ENABLE ROW LEVEL SECURITY;

-- Internal-only: no policies, no anon/authenticated grants. service_role only.
GRANT ALL ON public.booth_guides TO service_role;

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

  -- Operational identity (operator-configured labels, not credentials).
  booth_id TEXT NOT NULL DEFAULT 'unconfigured',
  host_label TEXT,

  -- Versioned confirmed Decision Profile. The jsonb payload is authoritative;
  -- profile_version lets consumers fail closed on obsolete payloads.
  flow_mode TEXT CHECK (flow_mode IN ('quick', 'full')),
  profile JSONB,
  profile_version INTEGER,
  profile_confirmed_at TIMESTAMPTZ,
  CONSTRAINT booth_sessions_profile_versioned CHECK (
    (profile IS NULL AND profile_version IS NULL)
    OR (profile IS NOT NULL AND profile_version IS NOT NULL)
  ),

  -- Shortlist of ZERO to FOUR directions — enforced here, not only in the UI.
  shortlist JSONB NOT NULL DEFAULT '[]'::jsonb,
  shortlist_mode TEXT NOT NULL DEFAULT 'none'
    CHECK (shortlist_mode IN ('none', 'guest_selected', 'guide_prepares')),
  CONSTRAINT booth_sessions_shortlist_max_four CHECK (
    jsonb_typeof(shortlist) = 'array' AND jsonb_array_length(shortlist) <= 4
  ),

  -- Light contact contract: required first name + WhatsApp + language;
  -- everything else optional. Stored only with the consultation consent.
  first_name TEXT,
  whatsapp TEXT,
  preferred_language TEXT,
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
  CONSTRAINT booth_sessions_contact_requires_consent CHECK (
    (first_name IS NULL AND whatsapp IS NULL) OR consultation_consent
  ),

  -- Manual pilot WhatsApp verification (no Business API integration).
  whatsapp_verification_state TEXT NOT NULL DEFAULT 'unverified'
    CHECK (whatsapp_verification_state IN ('unverified', 'pending', 'verified', 'unavailable')),
  whatsapp_verified_at TIMESTAMPTZ,
  whatsapp_verification_method TEXT
    CHECK (whatsapp_verification_method IN ('wa_me_host_confirmed', 'qr_host_confirmed')),
  CONSTRAINT booth_sessions_verified_has_timestamp CHECK (
    whatsapp_verification_state <> 'verified'
    OR (whatsapp_verified_at IS NOT NULL AND whatsapp_verification_method IS NOT NULL)
  ),

  -- Guide assignment + warm-handoff timestamps (server boundary only).
  assigned_guide_id UUID REFERENCES public.booth_guides(id) ON DELETE SET NULL,
  reserve_guide_id UUID REFERENCES public.booth_guides(id) ON DELETE SET NULL,
  guide_assigned_at TIMESTAMPTZ,
  guide_acknowledged_at TIMESTAMPTZ,
  guide_first_contact_at TIMESTAMPTZ,
  consultation_scheduled_for TEXT,
  guide_fallback_reason TEXT,
  next_step TEXT,

  -- Outcome + truthful completion gates.
  outcome TEXT NOT NULL DEFAULT 'active'
    CHECK (outcome IN ('active', 'contacted_complete', 'no_contact_qr', 'abandoned')),
  abandonment_step TEXT,
  abandonment_reason TEXT,
  CONSTRAINT booth_sessions_contacted_complete_gate CHECK (
    outcome <> 'contacted_complete'
    OR (
      profile_confirmed_at IS NOT NULL
      AND whatsapp_verification_state = 'verified'
      AND assigned_guide_id IS NOT NULL
      AND next_step IS NOT NULL
      AND (consultation_scheduled_for IS NOT NULL OR guide_first_contact_at IS NOT NULL)
    )
  ),
  CONSTRAINT booth_sessions_no_contact_stores_no_contact CHECK (
    outcome <> 'no_contact_qr'
    OR (
      first_name IS NULL AND whatsapp IS NULL AND last_name IS NULL
      AND email IS NULL AND country IS NULL AND preferred_contact_time IS NULL
    )
  ),

  -- Human-readable mirror (leads list); structured columns stay authoritative.
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_booth_sessions_created_at
  ON public.booth_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_booth_sessions_outcome
  ON public.booth_sessions(outcome);

ALTER TABLE public.booth_sessions ENABLE ROW LEVEL SECURITY;

-- Internal-only: no policies, no anon/authenticated grants. service_role only.
GRANT ALL ON public.booth_sessions TO service_role;

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

-- Internal-only: no policies, no anon/authenticated grants. service_role only.
GRANT ALL ON public.booth_funnel_events TO service_role;

-- ----------------------------------------------------------------------------
-- 4. leads — allow service-boundary Booth V2 leads without an email address.
--    The anonymous INSERT policy is deliberately NOT modified: it still
--    requires length(btrim(email)) > 0, which is FALSE/NULL for a NULL email,
--    so the browser-side contract is unchanged and NULL-email rows can only
--    come from the trusted server boundary.
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
--   1. Booth pilot data collected after this migration lives ONLY in the
--      three booth tables; dropping them destroys that pilot data:
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
--      If it is non-zero, the rows must be exported or given a placeholder by
--      an explicit operator decision first — never silently deleted.
-- ============================================================================
