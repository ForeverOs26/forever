-- ============================================================================
-- FOREVER-BOOTH-ASSISTED-DECISION-001 (PR #102 corrective pass 2) —
-- real-database behavioral suite for the Booth Mode 2.0 pilot schema.
--
-- Runs against a disposable PostgreSQL cluster after the COMPLETE committed
-- migration chain (see scripts/studio/run-postgres-tests.mjs). The runner
-- deliberately grants browser roles ALL on public tables/functions BY DEFAULT
-- immediately before this migration applies, so these assertions prove the
-- migration's explicit REVOKEs actually strip inherited privileges.
--
-- Proves, in order:
--   1. privilege isolation and the least-privilege Booth capability column;
--   2. session ownership — a valid staff account cannot touch another Host's
--      session by knowing its client_ref, and a rejected operation changes
--      ZERO rows;
--   3. the consent boundary — nothing about the guest is persisted before the
--      consultation consent, enforced by the database itself;
--   4. the atomic consent commit — profile + shortlist + contact + exactly one
--      lead, with every accepted replay keeping the lead mirror consistent;
--   5. WhatsApp-number-change invalidation;
--   6. Guide reassignment evidence reset;
--   7. the assigned Guide's narrow self-action permission;
--   8. terminal immutability;
--   9. no-contact total data minimization;
--  10. once-only funnel events and atomic abandonment.
-- No production connection.
-- ============================================================================

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.assert_true(ok boolean, message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE(ok, false) THEN RAISE EXCEPTION 'booth_pg_test_failed: %', message; END IF;
END;
$$;

/** Run a statement and report whether it raised the expected SQLSTATE/message. */
CREATE OR REPLACE FUNCTION pg_temp.raises(sql text, needle text)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql;
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN position(needle IN SQLERRM) > 0 OR needle = '*';
END;
$$;

/**
 * Run a statement that MUST be refused, and prove it changed nothing at all:
 * the session row is captured before and after and must be byte-identical.
 */
CREATE OR REPLACE FUNCTION pg_temp.refused_without_change(
  sql text, needle text, client_ref text)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  v_before public.booth_sessions;
  v_after public.booth_sessions;
  v_events_before BIGINT;
  v_events_after BIGINT;
  v_leads_before BIGINT;
  v_leads_after BIGINT;
BEGIN
  SELECT * INTO v_before FROM public.booth_sessions s WHERE s.client_ref = $3;
  SELECT count(*) INTO v_events_before FROM public.booth_funnel_events
    WHERE session_id = v_before.id;
  SELECT count(*) INTO v_leads_before FROM public.leads;

  IF NOT pg_temp.raises(sql, needle) THEN
    RAISE EXCEPTION 'booth_pg_test_failed: the operation was NOT refused: %', sql;
  END IF;

  SELECT * INTO v_after FROM public.booth_sessions s WHERE s.client_ref = $3;
  SELECT count(*) INTO v_events_after FROM public.booth_funnel_events
    WHERE session_id = v_after.id;
  SELECT count(*) INTO v_leads_after FROM public.leads;

  RETURN v_before IS NOT DISTINCT FROM v_after
     AND v_events_before = v_events_after
     AND v_leads_before = v_leads_after;
END;
$$;

-- Fixtures: two Host staff accounts, one Guide with a linked staff account, one
-- Guide without, and an unrelated staff account.
INSERT INTO auth.users (id, email) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'host-a@example.test'),
  ('b0000000-0000-0000-0000-000000000002', 'guide@example.test'),
  ('b0000000-0000-0000-0000-000000000003', 'other@example.test'),
  ('b0000000-0000-0000-0000-000000000004', 'host-b@example.test')
ON CONFLICT DO NOTHING;

INSERT INTO public.booth_guides (id, display_name, staff_user_id, languages, on_duty) VALUES
  ('b1000000-0000-0000-0000-000000000001', 'Guide One', 'b0000000-0000-0000-0000-000000000002', ARRAY['English'], TRUE),
  ('b1000000-0000-0000-0000-000000000002', 'Guide Two', NULL, ARRAY['English'], TRUE),
  ('b1000000-0000-0000-0000-000000000003', 'Guide Three', NULL, ARRAY['English'], TRUE);

-- Convenience: the canonical confirmed-profile payload shapes used below.
-- (Content is validated by the strict TypeScript schema at the boundary; the
-- database only needs the language agreement and the version triple.)

-- ---------------------------------------------------------------------------
-- 1. Privilege isolation + the least-privilege Booth capability
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_true(
  (SELECT bool_and(relrowsecurity) FROM pg_class
   WHERE oid IN ('public.booth_guides'::regclass,
                 'public.booth_sessions'::regclass,
                 'public.booth_funnel_events'::regclass)),
  'booth tables have RLS enabled');

SELECT pg_temp.assert_true(
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
              AND tablename IN ('booth_guides','booth_sessions','booth_funnel_events')),
  'booth tables have zero policies');

SELECT pg_temp.assert_true(
  NOT has_table_privilege('anon','public.booth_sessions','SELECT')
  AND NOT has_table_privilege('anon','public.booth_sessions','INSERT')
  AND NOT has_table_privilege('authenticated','public.booth_sessions','SELECT')
  AND NOT has_table_privilege('authenticated','public.booth_sessions','INSERT')
  AND NOT has_table_privilege('anon','public.booth_guides','SELECT')
  AND NOT has_table_privilege('authenticated','public.booth_guides','SELECT')
  AND NOT has_table_privilege('anon','public.booth_funnel_events','SELECT')
  AND NOT has_table_privilege('authenticated','public.booth_funnel_events','INSERT'),
  'anon/authenticated cannot read or write any booth table (inherited defaults revoked)');

SELECT pg_temp.assert_true(
  has_function_privilege('service_role','public.booth_commit_consent(text,uuid,text,jsonb,integer,timestamptz,jsonb,text,jsonb,jsonb)','EXECUTE')
  AND has_function_privilege('service_role','public.booth_complete_session(text,uuid,text)','EXECUTE')
  AND NOT has_function_privilege('anon','public.booth_commit_consent(text,uuid,text,jsonb,integer,timestamptz,jsonb,text,jsonb,jsonb)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.booth_commit_consent(text,uuid,text,jsonb,integer,timestamptz,jsonb,text,jsonb,jsonb)','EXECUTE')
  AND NOT has_function_privilege('anon','public.booth_complete_session(text,uuid,text)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.booth_complete_session(text,uuid,text)','EXECUTE')
  AND NOT has_function_privilege('anon','public.booth_ensure_session(text,uuid,text,text)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.booth_lock_owned_session(text,uuid,boolean)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.booth_assign_guide(text,uuid,uuid,uuid,text)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.booth_acknowledge_guide(text,uuid,text)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.booth_record_handoff(text,uuid,text,timestamptz,text,text)','EXECUTE'),
  'booth RPCs are service_role only');

-- The anonymous lead policy is untouched: a NULL email still fails its WITH CHECK.
SELECT pg_temp.assert_true(
  EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='leads'
          AND policyname='Anyone can submit a lead'
          AND with_check LIKE '%btrim(email)%'),
  'the anonymous leads INSERT policy still requires a non-blank email');

-- The Booth capability is a real, additive, default-OFF column on the EXISTING
-- staff roster — no second identity table, and nobody is granted access here.
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='studio_members'
       AND column_name='can_access_booth'
       AND is_nullable='NO' AND column_default='false'),
  'studio_members.can_access_booth exists, is NOT NULL and defaults to FALSE');

SELECT pg_temp.assert_true(
  NOT EXISTS (SELECT 1 FROM public.studio_members WHERE can_access_booth),
  'the migration grants the Booth capability to nobody');

-- A member inserted the ordinary way starts WITHOUT the capability, and the
-- existing Studio columns are untouched (the Studio suite already bootstrapped
-- the single Owner, so this new member is a trusted publisher).
INSERT INTO public.studio_members (user_id, role, display_name, email, is_active)
VALUES ('b0000000-0000-0000-0000-000000000001','trusted_publisher','Host A','host-a@example.test',TRUE);
SELECT pg_temp.assert_true(
  (SELECT can_access_booth = FALSE AND is_active AND role='trusted_publisher'
     FROM public.studio_members WHERE user_id='b0000000-0000-0000-0000-000000000001'),
  'a newly inserted ACTIVE staff member has no Booth capability by default');

-- The existing Studio roster is unchanged by the Booth column: every member the
-- Studio suite created is still there, still active, and still Booth-less.
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.studio_members WHERE role='owner' AND is_active) = 1
  AND (SELECT bool_and(NOT can_access_booth) FROM public.studio_members),
  'the existing Studio roster and its single-Owner invariant are untouched');

-- ---------------------------------------------------------------------------
-- 2. Session ownership — a client_ref is an idempotency key, not a capability
-- ---------------------------------------------------------------------------
SELECT public.booth_ensure_session('ref-own-0005', 'b0000000-0000-0000-0000-000000000001', 'host-a@example.test', 'pilot-booth');
SELECT public.booth_ensure_session('ref-own-0005', 'b0000000-0000-0000-0000-000000000001', 'host-a@example.test', 'pilot-booth');

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.booth_sessions WHERE client_ref='ref-own-0005') = 1,
  'ensure_session is idempotent for the SAME Host on the same client_ref');

SELECT pg_temp.assert_true(
  pg_temp.refused_without_change(
    $q$SELECT public.booth_ensure_session('ref-own-0005','b0000000-0000-0000-0000-000000000004','host-b@example.test','pilot-booth')$q$,
    'booth_session_forbidden', 'ref-own-0005'),
  'a DIFFERENT Host presenting the same client_ref is refused and never adopts the session');

SELECT pg_temp.assert_true(
  (SELECT host_user_id FROM public.booth_sessions WHERE client_ref='ref-own-0005')
    = 'b0000000-0000-0000-0000-000000000001',
  'ownership is never transferred silently');

-- Host B knows the client_ref and holds a perfectly valid staff account. Every
-- single transition must refuse, and must change nothing.
SELECT pg_temp.assert_true(
  pg_temp.refused_without_change(
    $q$SELECT public.booth_mark_profile_confirmed('ref-own-0005','b0000000-0000-0000-0000-000000000004','quick')$q$,
    'booth_session_forbidden', 'ref-own-0005'),
  'Host B cannot mark another Host session profile-confirmed');

SELECT pg_temp.assert_true(
  pg_temp.refused_without_change(
    $q$SELECT public.booth_commit_consent('ref-own-0005','b0000000-0000-0000-0000-000000000004','quick',
        '{"profileVersion":2,"preferredLanguage":"English"}'::jsonb, 2, now(), '[]'::jsonb, 'none',
        '{"first_name":"Mallory","whatsapp":"+79990009911","preferred_language":"English"}'::jsonb,
        '{"name":"Mallory","phone":"+79990009911","message":"m","source":"booth_v2"}'::jsonb)$q$,
    'booth_session_forbidden', 'ref-own-0005'),
  'Host B cannot save contact or create a lead for Host A''s session');

SELECT pg_temp.assert_true(
  pg_temp.refused_without_change(
    $q$SELECT public.booth_set_whatsapp_state('ref-own-0005','b0000000-0000-0000-0000-000000000004','verified','wa_me_host_confirmed')$q$,
    'booth_session_forbidden', 'ref-own-0005'),
  'Host B cannot verify WhatsApp on Host A''s session');

SELECT pg_temp.assert_true(
  pg_temp.refused_without_change(
    $q$SELECT public.booth_assign_guide('ref-own-0005','b0000000-0000-0000-0000-000000000004','b1000000-0000-0000-0000-000000000001',NULL,NULL)$q$,
    'booth_session_forbidden', 'ref-own-0005'),
  'Host B cannot assign a Guide on Host A''s session');

SELECT pg_temp.assert_true(
  pg_temp.refused_without_change(
    $q$SELECT public.booth_acknowledge_guide('ref-own-0005','b0000000-0000-0000-0000-000000000004','host_observed')$q$,
    'booth_session_forbidden', 'ref-own-0005'),
  'Host B cannot acknowledge on Host A''s session');

SELECT pg_temp.assert_true(
  pg_temp.refused_without_change(
    $q$SELECT public.booth_record_handoff('ref-own-0005','b0000000-0000-0000-0000-000000000004',NULL,NULL,NULL,'takeover')$q$,
    'booth_session_forbidden', 'ref-own-0005'),
  'Host B cannot record a handoff on Host A''s session');

SELECT pg_temp.assert_true(
  pg_temp.refused_without_change(
    $q$SELECT public.booth_record_event('ref-own-0005','b0000000-0000-0000-0000-000000000004','profile_started',NULL,NULL)$q$,
    'booth_session_forbidden', 'ref-own-0005'),
  'Host B cannot record a funnel event on Host A''s session');

SELECT pg_temp.assert_true(
  pg_temp.refused_without_change(
    $q$SELECT public.booth_complete_session('ref-own-0005','b0000000-0000-0000-0000-000000000004','no_contact_qr')$q$,
    'booth_session_forbidden', 'ref-own-0005'),
  'Host B cannot complete or abandon Host A''s session');

SELECT pg_temp.assert_true(
  pg_temp.raises(
    $q$SELECT public.booth_lock_owned_session('ref-own-0005', NULL)$q$,
    'booth_session_forbidden'),
  'a NULL actor is refused outright');

-- ---------------------------------------------------------------------------
-- 3. The consent boundary — nothing about the guest before the acknowledgement
-- ---------------------------------------------------------------------------
SELECT public.booth_ensure_session('ref-consent-0008', 'b0000000-0000-0000-0000-000000000001', 'host-a@example.test', 'pilot-booth');
SELECT public.booth_mark_profile_confirmed('ref-consent-0008','b0000000-0000-0000-0000-000000000001','full');

SELECT pg_temp.assert_true(
  (SELECT flow_mode='full' AND profile IS NULL AND profile_version IS NULL
          AND profile_confirmed_at IS NULL AND preferred_language IS NULL
          AND jsonb_array_length(shortlist)=0 AND shortlist_mode='none'
          AND first_name IS NULL AND whatsapp IS NULL AND host_note IS NULL
          AND consultation_consent = FALSE AND lead_id IS NULL
     FROM public.booth_sessions WHERE client_ref='ref-consent-0008'),
  'confirming a profile before consent stores only the flow mode — no profile, no shortlist, no contact');

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.booth_funnel_events e
     JOIN public.booth_sessions s ON s.id=e.session_id
    WHERE s.client_ref='ref-consent-0008' AND e.event='profile_confirmed') = 1,
  'the non-personal profile_confirmed funnel fact IS recorded before consent');

-- The database itself refuses guest data ahead of consent, so an application
-- bug cannot write it.
SELECT pg_temp.assert_true(
  pg_temp.raises(
    $q$UPDATE public.booth_sessions
         SET profile='{"preferredLanguage":null,"note":"secret"}'::jsonb, profile_version=2,
             profile_confirmed_at=now()
       WHERE client_ref='ref-consent-0008'$q$,
    'booth_sessions_pre_consent_minimal'),
  'a Decision Profile cannot be persisted without the consultation consent');

SELECT pg_temp.assert_true(
  pg_temp.raises(
    $q$UPDATE public.booth_sessions SET shortlist='[{"slug":"a"}]'::jsonb, shortlist_mode='guest_selected'
       WHERE client_ref='ref-consent-0008'$q$,
    'booth_sessions_pre_consent_minimal'),
  'a shortlist cannot be persisted without the consultation consent');

SELECT pg_temp.assert_true(
  pg_temp.raises(
    $q$UPDATE public.booth_sessions SET preferred_language='English'
       WHERE client_ref='ref-consent-0008'$q$,
    'booth_sessions_pre_consent_minimal'),
  'a preferred language cannot be persisted without the consultation consent');

-- The guest note is part of the contact bundle, so the bundle CHECK catches it
-- first; either guard proves the same thing — it cannot be stored unconsented.
SELECT pg_temp.assert_true(
  pg_temp.raises(
    $q$UPDATE public.booth_sessions SET host_note='guest wants sea view'
       WHERE client_ref='ref-consent-0008'$q$,
    'booth_sessions_contact_bundle'),
  'a guest note cannot be persisted without the consultation consent');

SELECT pg_temp.assert_true(
  pg_temp.raises(
    $q$UPDATE public.booth_sessions SET first_name='Anna' WHERE client_ref='ref-consent-0008'$q$,
    '*'),
  'a partial contact bundle is rejected');

-- ---------------------------------------------------------------------------
-- 4. The atomic consent commit + the truthful lead mirror
-- ---------------------------------------------------------------------------
SELECT public.booth_ensure_session('ref-contract-0001', 'b0000000-0000-0000-0000-000000000001', 'host-a@example.test', 'pilot-booth');
SELECT public.booth_mark_profile_confirmed('ref-contract-0001','b0000000-0000-0000-0000-000000000001','quick');

SELECT pg_temp.assert_true(
  pg_temp.raises(
    $q$SELECT public.booth_set_whatsapp_state('ref-contract-0001','b0000000-0000-0000-0000-000000000001','verified','wa_me_host_confirmed')$q$,
    'booth_contact_required'),
  'WhatsApp cannot be verified before consent stored a contact number');

SELECT pg_temp.assert_true(
  pg_temp.raises(
    $q$SELECT public.booth_commit_consent('ref-contract-0001','b0000000-0000-0000-0000-000000000001','quick',
        NULL, NULL, NULL, '[]'::jsonb, 'none',
        '{"first_name":"Anna","whatsapp":"+79990001122","preferred_language":"English"}'::jsonb,
        '{"name":"Anna","phone":"+79990001122","message":"m","source":"booth_v2"}'::jsonb)$q$,
    'booth_profile_required'),
  'consent without a confirmed profile is refused');

-- The one locked operation: profile + shortlist + contact + consent + lead.
SELECT public.booth_commit_consent('ref-contract-0001','b0000000-0000-0000-0000-000000000001','quick',
  '{"profileVersion":2,"flowMode":"quick","preferredLanguage":"English"}'::jsonb, 2, now(),
  '[{"slug":"modeva","mentionedByGuest":true}]'::jsonb, 'guest_selected',
  '{"first_name":"Anna","whatsapp":"+79990001122","preferred_language":"English","marketing_opt_in":false}'::jsonb,
  '{"name":"Anna","phone":"+79990001122","message":"summary","source":"booth_v2"}'::jsonb);

SELECT pg_temp.assert_true(
  (SELECT profile IS NOT NULL AND profile_version=2 AND profile_confirmed_at IS NOT NULL
          AND preferred_language='English' AND jsonb_array_length(shortlist)=1
          AND shortlist_mode='guest_selected' AND first_name='Anna'
          AND consultation_consent AND consent_recorded_at IS NOT NULL
          AND marketing_opt_in = FALSE AND lead_id IS NOT NULL
     FROM public.booth_sessions WHERE client_ref='ref-contract-0001'),
  'consent persists the profile, shortlist, contact, consent and lead in one operation');

SELECT pg_temp.assert_true(
  pg_temp.raises(
    $q$UPDATE public.booth_sessions SET preferred_language='Deutsch' WHERE client_ref='ref-contract-0001'$q$,
    'booth_sessions_profile_language_agrees'),
  'a contact language that disagrees with the persisted profile is rejected');

SELECT pg_temp.assert_true(
  pg_temp.raises(
    $q$UPDATE public.booth_sessions SET whatsapp='not-a-number' WHERE client_ref='ref-contract-0001'$q$,
    'booth_sessions_contact_bundle'),
  'an invalid WhatsApp number is rejected');

SELECT pg_temp.assert_true(
  pg_temp.raises(
    $q$UPDATE public.booth_sessions SET email='nope' WHERE client_ref='ref-contract-0001'$q$,
    'booth_sessions_email_format'),
  'an invalid optional email is rejected');

SELECT pg_temp.assert_true(
  pg_temp.raises(
    $q$UPDATE public.booth_sessions SET country='   ' WHERE client_ref='ref-contract-0001'$q$,
    'booth_sessions_optional_text_nonblank'),
  'a blank optional string is rejected');

SELECT pg_temp.assert_true(
  pg_temp.raises(
    $q$UPDATE public.booth_sessions SET whatsapp_verification_state='verified'
       WHERE client_ref='ref-contract-0001'$q$,
    'booth_sessions_verified_requires_evidence'),
  'a verified state without timestamp and method is rejected');

SELECT public.booth_set_whatsapp_state('ref-contract-0001','b0000000-0000-0000-0000-000000000001','verified','wa_me_host_confirmed');

SELECT pg_temp.assert_true(
  pg_temp.raises(
    $q$UPDATE public.booth_sessions SET guide_acknowledged_at=now()
       WHERE client_ref='ref-contract-0001'$q$,
    'booth_sessions_ack_attributed'),
  'an unattributed acknowledgement is rejected');

SELECT pg_temp.assert_true(
  pg_temp.raises(
    $q$SELECT public.booth_acknowledge_guide('ref-contract-0001','b0000000-0000-0000-0000-000000000001','host_observed')$q$,
    'booth_guide_required'),
  'acknowledgement requires an assigned Guide');

SELECT public.booth_assign_guide('ref-contract-0001','b0000000-0000-0000-0000-000000000001',
  'b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002', NULL);

SELECT pg_temp.assert_true(
  pg_temp.raises(
    $q$UPDATE public.booth_sessions SET reserve_guide_id = assigned_guide_id
       WHERE client_ref='ref-contract-0001'$q$,
    'booth_sessions_reserve_differs'),
  'the reserve Guide must differ from the primary');

-- 'guide_self_confirmed' is only truthful for the assigned Guide's own account.
SELECT pg_temp.assert_true(
  pg_temp.raises(
    $q$SELECT public.booth_acknowledge_guide('ref-contract-0001','b0000000-0000-0000-0000-000000000003','guide_self_confirmed')$q$,
    'booth_session_forbidden'),
  'an unrelated staff account cannot claim a Guide self-acknowledgement');

SELECT public.booth_acknowledge_guide('ref-contract-0001','b0000000-0000-0000-0000-000000000002','guide_self_confirmed');

SELECT pg_temp.assert_true(
  (SELECT guide_acknowledged_by FROM public.booth_sessions WHERE client_ref='ref-contract-0001')
    = 'b0000000-0000-0000-0000-000000000002'
  AND (SELECT guide_acknowledged_method FROM public.booth_sessions WHERE client_ref='ref-contract-0001')
    = 'guide_self_confirmed',
  'the acknowledgement records who confirmed it and by which method');

SELECT pg_temp.assert_true(
  pg_temp.raises(
    $q$UPDATE public.booth_sessions SET consultation_scheduled_at = now() + interval '1 day'
       WHERE client_ref='ref-contract-0001'$q$,
    'booth_sessions_consultation_structured'),
  'a scheduled instant requires its timezone context');

SELECT pg_temp.assert_true(
  pg_temp.raises(
    $q$SELECT public.booth_complete_session('ref-contract-0001','b0000000-0000-0000-0000-000000000001','contacted_complete')$q$,
    'booth_completion_blocked'),
  'completion is blocked without a next step and an exact time');

SELECT public.booth_record_handoff('ref-contract-0001', 'b0000000-0000-0000-0000-000000000001',
  NULL, now() + interval '1 day', 'Asia/Bangkok', '30-minute consultation');

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.booth_funnel_events e
     JOIN public.booth_sessions s ON s.id=e.session_id
    WHERE s.client_ref='ref-contract-0001' AND e.event='consultation_booked') = 1,
  'booking an exact time emits consultation_booked server-side');

SELECT public.booth_complete_session('ref-contract-0001','b0000000-0000-0000-0000-000000000001','contacted_complete');
SELECT public.booth_complete_session('ref-contract-0001','b0000000-0000-0000-0000-000000000001','contacted_complete'); -- idempotent replay

SELECT pg_temp.assert_true(
  (SELECT outcome FROM public.booth_sessions WHERE client_ref='ref-contract-0001') = 'contacted_complete',
  'a fully-evidenced contacted session completes');

-- ---------------------------------------------------------------------------
-- 5. Terminal immutability — the database freezes a finished session
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_true(
  pg_temp.refused_without_change(
    $q$UPDATE public.booth_sessions SET next_step='rewritten' WHERE client_ref='ref-contract-0001'$q$,
    'booth_session_terminal_immutable', 'ref-contract-0001'),
  'a direct service_role UPDATE of a completed session is refused by the database');

SELECT pg_temp.assert_true(
  pg_temp.refused_without_change(
    $q$SELECT public.booth_acknowledge_guide('ref-contract-0001','b0000000-0000-0000-0000-000000000002','guide_self_confirmed')$q$,
    'booth_session_not_active', 'ref-contract-0001'),
  'no new acknowledgement after completion');

SELECT pg_temp.assert_true(
  pg_temp.refused_without_change(
    $q$SELECT public.booth_record_handoff('ref-contract-0001','b0000000-0000-0000-0000-000000000001','host_observed',NULL,NULL,NULL)$q$,
    'booth_session_not_active', 'ref-contract-0001'),
  'no first-contact mutation after completion');

SELECT pg_temp.assert_true(
  pg_temp.refused_without_change(
    $q$SELECT public.booth_assign_guide('ref-contract-0001','b0000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000003',NULL,NULL)$q$,
    'booth_session_not_active', 'ref-contract-0001'),
  'no Guide reassignment after completion');

SELECT pg_temp.assert_true(
  pg_temp.refused_without_change(
    $q$SELECT public.booth_commit_consent('ref-contract-0001','b0000000-0000-0000-0000-000000000001','quick',
        '{"profileVersion":2,"preferredLanguage":"English"}'::jsonb, 2, now(), '[]'::jsonb, 'none',
        '{"first_name":"Anna","whatsapp":"+79990001122","preferred_language":"English"}'::jsonb,
        '{"name":"Anna","phone":"+79990001122","message":"m","source":"booth_v2"}'::jsonb)$q$,
    'booth_session_not_active', 'ref-contract-0001'),
  'no contact / profile / shortlist update after completion');

SELECT pg_temp.assert_true(
  pg_temp.refused_without_change(
    $q$SELECT public.booth_set_whatsapp_state('ref-contract-0001','b0000000-0000-0000-0000-000000000001','pending',NULL)$q$,
    'booth_session_not_active', 'ref-contract-0001'),
  'no WhatsApp state change after completion');

SELECT pg_temp.assert_true(
  pg_temp.refused_without_change(
    $q$SELECT public.booth_record_event('ref-contract-0001','b0000000-0000-0000-0000-000000000001','session_abandoned','x','y')$q$,
    'booth_session_not_active', 'ref-contract-0001'),
  'no funnel transition inconsistent with the terminal state');

SELECT pg_temp.assert_true(
  pg_temp.refused_without_change(
    $q$SELECT public.booth_complete_session('ref-contract-0001','b0000000-0000-0000-0000-000000000001','no_contact_qr')$q$,
    'booth_session_not_active', 'ref-contract-0001'),
  'a completed session cannot be re-completed with a different outcome');

-- booth_ensure_session is the documented read-mostly exception: it returns the
-- existing row (ownership still proven) and mutates nothing.
SELECT pg_temp.assert_true(
  (SELECT outcome FROM public.booth_ensure_session('ref-contract-0001','b0000000-0000-0000-0000-000000000001','host-a@example.test','pilot-booth'))
    = 'contacted_complete',
  'ensure_session reads a terminal session without mutating it');

-- ---------------------------------------------------------------------------
-- 6. Exactly one lead per session, and the mirror stays consistent on replay
-- ---------------------------------------------------------------------------
SELECT public.booth_ensure_session('ref-contract-0002', 'b0000000-0000-0000-0000-000000000001', 'host-a@example.test', 'pilot-booth');

SELECT pg_temp.assert_true(
  public.booth_commit_consent('ref-contract-0002','b0000000-0000-0000-0000-000000000001','quick',
    '{"profileVersion":2,"preferredLanguage":"English"}'::jsonb, 2, now(), '[]'::jsonb, 'none',
    '{"first_name":"Bo","whatsapp":"+79990002233","preferred_language":"English"}'::jsonb,
    '{"name":"Bo","phone":"+79990002233","message":"m","source":"booth_v2"}'::jsonb)
  = public.booth_commit_consent('ref-contract-0002','b0000000-0000-0000-0000-000000000001','quick',
    '{"profileVersion":2,"preferredLanguage":"English"}'::jsonb, 2, now(), '[]'::jsonb, 'none',
    '{"first_name":"Bo","whatsapp":"+79990002233","preferred_language":"English"}'::jsonb,
    '{"name":"Bo","phone":"+79990002233","message":"m","source":"booth_v2"}'::jsonb),
  'an exact replay returns the SAME lead id');

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.leads WHERE phone='+79990002233') = 1,
  'a replayed consent commit creates exactly one lead');

-- A CORRECTION (name, email, country) must reach the linked lead too — the
-- session and its mirror can never drift apart.
SELECT public.booth_commit_consent('ref-contract-0002','b0000000-0000-0000-0000-000000000001','quick',
  '{"profileVersion":2,"preferredLanguage":"English"}'::jsonb, 2, now(), '[]'::jsonb, 'none',
  '{"first_name":"Bo","last_name":"Larsen","email":"bo@example.test","country":"Thailand","whatsapp":"+79990002233","preferred_language":"English"}'::jsonb,
  '{"name":"Bo Larsen","email":"bo@example.test","country":"Thailand","phone":"+79990002233","message":"m2","source":"booth_v2","budget":"1,000,000 USD"}'::jsonb);

SELECT pg_temp.assert_true(
  (SELECT s.country='Thailand' AND s.last_name='Larsen' AND s.email='bo@example.test'
          AND l.name='Bo Larsen' AND l.email='bo@example.test' AND l.country='Thailand'
          AND l.message='m2' AND l.budget='1,000,000 USD'
     FROM public.booth_sessions s JOIN public.leads l ON l.id = s.lead_id
    WHERE s.client_ref='ref-contract-0002'),
  'a corrected name/email/country updates the SAME linked lead atomically');

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.leads WHERE phone='+79990002233') = 1,
  'the correction did not duplicate the lead');

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1 FROM public.leads l
     WHERE l.source='booth_v2'
       AND NOT EXISTS (SELECT 1 FROM public.booth_sessions s WHERE s.lead_id = l.id)),
  'no unattached booth lead exists');

-- A booth lead may carry no email; the trusted boundary is its only writer.
SELECT public.booth_ensure_session('ref-contract-0002b', 'b0000000-0000-0000-0000-000000000001', 'host-a@example.test', 'pilot-booth');
SELECT public.booth_commit_consent('ref-contract-0002b','b0000000-0000-0000-0000-000000000001','quick',
  '{"profileVersion":2,"preferredLanguage":"English"}'::jsonb, 2, now(), '[]'::jsonb, 'none',
  '{"first_name":"NoMail","whatsapp":"+79990002299","preferred_language":"English"}'::jsonb,
  '{"name":"NoMail","phone":"+79990002299","message":"m","source":"booth_v2"}'::jsonb);
SELECT pg_temp.assert_true(
  (SELECT email IS NULL FROM public.leads WHERE phone='+79990002299'),
  'a booth lead can be stored without an email address');

-- One lead can never be linked to two sessions.
SELECT pg_temp.assert_true(
  pg_temp.raises(
    $q$UPDATE public.booth_sessions SET lead_id =
        (SELECT lead_id FROM public.booth_sessions WHERE client_ref='ref-contract-0002')
       WHERE client_ref='ref-contract-0002b'$q$,
    '*'),
  'a lead cannot be linked to two booth sessions');

-- ---------------------------------------------------------------------------
-- 7. A replaced WhatsApp number invalidates everything that proved the old one
-- ---------------------------------------------------------------------------
SELECT public.booth_set_whatsapp_state('ref-contract-0002','b0000000-0000-0000-0000-000000000001','verified','wa_me_host_confirmed');
SELECT public.booth_assign_guide('ref-contract-0002','b0000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001',NULL,NULL);
SELECT public.booth_record_handoff('ref-contract-0002','b0000000-0000-0000-0000-000000000001','host_observed',
  now() + interval '2 days', 'Asia/Bangkok', 'call back tomorrow');

SELECT pg_temp.assert_true(
  (SELECT whatsapp_verification_state='verified' AND guide_first_contact_at IS NOT NULL
          AND consultation_scheduled_at IS NOT NULL
     FROM public.booth_sessions WHERE client_ref='ref-contract-0002'),
  'the session is fully evidenced before the number changes');

SELECT public.booth_commit_consent('ref-contract-0002','b0000000-0000-0000-0000-000000000001','quick',
  '{"profileVersion":2,"preferredLanguage":"English"}'::jsonb, 2, now(), '[]'::jsonb, 'none',
  '{"first_name":"Bo","last_name":"Larsen","email":"bo@example.test","country":"Thailand","whatsapp":"+79990007744","preferred_language":"English"}'::jsonb,
  '{"name":"Bo Larsen","email":"bo@example.test","country":"Thailand","phone":"+79990007744","message":"m3","source":"booth_v2"}'::jsonb);

SELECT pg_temp.assert_true(
  (SELECT whatsapp='+79990007744'
          AND whatsapp_verification_state='unverified'
          AND whatsapp_verified_at IS NULL
          AND whatsapp_verification_method IS NULL
          AND guide_first_contact_at IS NULL
          AND guide_first_contact_by IS NULL
          AND guide_first_contact_method IS NULL
     FROM public.booth_sessions WHERE client_ref='ref-contract-0002'),
  'a replaced number is never born verified, and first-contact evidence tied to the old number is cleared');

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.booth_funnel_events e
     JOIN public.booth_sessions s ON s.id=e.session_id
    WHERE s.client_ref='ref-contract-0002' AND e.event IN ('whatsapp_verified','guide_contacted')) = 0,
  'the funnel evidence for the old number is deleted, not left standing');

SELECT pg_temp.assert_true(
  (SELECT l.phone='+79990007744' FROM public.booth_sessions s
     JOIN public.leads l ON l.id=s.lead_id WHERE s.client_ref='ref-contract-0002'),
  'the linked lead carries the new number');

-- Truthful decision, documented: the Guide assignment and the agreed
-- consultation instant survive a corrected number; completion does NOT.
SELECT pg_temp.assert_true(
  (SELECT assigned_guide_id IS NOT NULL AND consultation_scheduled_at IS NOT NULL
     FROM public.booth_sessions WHERE client_ref='ref-contract-0002'),
  'the Guide assignment and the agreed appointment survive a corrected number');

SELECT pg_temp.assert_true(
  pg_temp.raises(
    $q$SELECT public.booth_complete_session('ref-contract-0002','b0000000-0000-0000-0000-000000000001','contacted_complete')$q$,
    'booth_completion_blocked'),
  'completion is blocked until the REPLACEMENT number is verified');

SELECT public.booth_set_whatsapp_state('ref-contract-0002','b0000000-0000-0000-0000-000000000001','verified','wa_me_host_confirmed');
SELECT public.booth_complete_session('ref-contract-0002','b0000000-0000-0000-0000-000000000001','contacted_complete');
SELECT pg_temp.assert_true(
  (SELECT outcome='contacted_complete' FROM public.booth_sessions WHERE client_ref='ref-contract-0002'),
  'completion succeeds once the replacement number is verified');

-- ---------------------------------------------------------------------------
-- 8. Guide reassignment resets the previous Guide's evidence
-- ---------------------------------------------------------------------------
SELECT public.booth_ensure_session('ref-guide-0006', 'b0000000-0000-0000-0000-000000000001', 'host-a@example.test', 'pilot-booth');
SELECT public.booth_commit_consent('ref-guide-0006','b0000000-0000-0000-0000-000000000001','quick',
  '{"profileVersion":2,"preferredLanguage":"English"}'::jsonb, 2, now(), '[]'::jsonb, 'none',
  '{"first_name":"Dee","whatsapp":"+79990004455","preferred_language":"English"}'::jsonb,
  '{"name":"Dee","phone":"+79990004455","message":"m","source":"booth_v2"}'::jsonb);
SELECT public.booth_set_whatsapp_state('ref-guide-0006','b0000000-0000-0000-0000-000000000001','verified','wa_me_host_confirmed');

-- (a) initial assignment
SELECT public.booth_assign_guide('ref-guide-0006','b0000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001',NULL,NULL);
-- (b) acknowledgement, (c) first contact, (d) scheduling
SELECT public.booth_acknowledge_guide('ref-guide-0006','b0000000-0000-0000-0000-000000000002','guide_self_confirmed');
SELECT public.booth_record_handoff('ref-guide-0006','b0000000-0000-0000-0000-000000000001','host_observed',
  now() + interval '3 days','Asia/Bangkok','intro call');

SELECT pg_temp.assert_true(
  (SELECT guide_acknowledged_at IS NOT NULL AND guide_first_contact_at IS NOT NULL
          AND consultation_scheduled_at IS NOT NULL AND next_step='intro call'
     FROM public.booth_sessions WHERE client_ref='ref-guide-0006'),
  'the first Guide accumulated acknowledgement, first contact, a schedule and a next step');

-- A same-Guide re-call (reserve only) is NOT a reassignment and resets nothing.
SELECT public.booth_assign_guide('ref-guide-0006','b0000000-0000-0000-0000-000000000001',
  'b1000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000002',NULL);
SELECT pg_temp.assert_true(
  (SELECT guide_acknowledged_at IS NOT NULL AND guide_first_contact_at IS NOT NULL
          AND consultation_scheduled_at IS NOT NULL AND next_step='intro call'
          AND reserve_guide_id='b1000000-0000-0000-0000-000000000002'
     FROM public.booth_sessions WHERE client_ref='ref-guide-0006'),
  'changing only the reserve Guide is not a reassignment and resets nothing');

-- (e) a GENUINE reassignment clears every downstream fact of the old Guide.
SELECT public.booth_assign_guide('ref-guide-0006','b0000000-0000-0000-0000-000000000001',
  'b1000000-0000-0000-0000-000000000003',NULL,'first Guide went off duty');

SELECT pg_temp.assert_true(
  (SELECT assigned_guide_id='b1000000-0000-0000-0000-000000000003'
          AND guide_acknowledged_at IS NULL AND guide_acknowledged_by IS NULL
          AND guide_acknowledged_method IS NULL
          AND guide_first_contact_at IS NULL AND guide_first_contact_by IS NULL
          AND guide_first_contact_method IS NULL
          AND consultation_scheduled_at IS NULL AND consultation_timezone IS NULL
          AND next_step IS NULL
     FROM public.booth_sessions WHERE client_ref='ref-guide-0006'),
  'a genuine reassignment clears acknowledgement, first contact, schedule and next step');

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.booth_funnel_events e
     JOIN public.booth_sessions s ON s.id=e.session_id
    WHERE s.client_ref='ref-guide-0006'
      AND e.event IN ('guide_acknowledged','guide_contacted','consultation_booked')) = 0,
  'the previous Guide funnel evidence is deleted so it can be re-earned');

-- Facts that are still true survive the reassignment.
SELECT pg_temp.assert_true(
  (SELECT profile IS NOT NULL AND first_name='Dee' AND consultation_consent
          AND whatsapp_verification_state='verified'
     FROM public.booth_sessions WHERE client_ref='ref-guide-0006'),
  'the profile, contact, consent and verified WhatsApp survive a reassignment');

-- (f) completion is blocked until the NEW Guide produces fresh evidence.
SELECT pg_temp.assert_true(
  pg_temp.raises(
    $q$SELECT public.booth_complete_session('ref-guide-0006','b0000000-0000-0000-0000-000000000001','contacted_complete')$q$,
    'booth_completion_blocked'),
  'completion is blocked until the new Guide produces fresh evidence');

SELECT public.booth_record_handoff('ref-guide-0006','b0000000-0000-0000-0000-000000000001','host_observed',
  now() + interval '4 days','Asia/Bangkok','handover call');
SELECT public.booth_complete_session('ref-guide-0006','b0000000-0000-0000-0000-000000000001','contacted_complete');
SELECT pg_temp.assert_true(
  (SELECT outcome='contacted_complete' FROM public.booth_sessions WHERE client_ref='ref-guide-0006'),
  'completion succeeds on the new Guide''s own evidence');

-- ---------------------------------------------------------------------------
-- 9. The assigned Guide's permission is narrow: their OWN two facts, no more
-- ---------------------------------------------------------------------------
SELECT public.booth_ensure_session('ref-narrow-0007', 'b0000000-0000-0000-0000-000000000001', 'host-a@example.test', 'pilot-booth');
SELECT public.booth_commit_consent('ref-narrow-0007','b0000000-0000-0000-0000-000000000001','quick',
  '{"profileVersion":2,"preferredLanguage":"English"}'::jsonb, 2, now(), '[]'::jsonb, 'none',
  '{"first_name":"Eve","whatsapp":"+79990005566","preferred_language":"English"}'::jsonb,
  '{"name":"Eve","phone":"+79990005566","message":"m","source":"booth_v2"}'::jsonb);
SELECT public.booth_set_whatsapp_state('ref-narrow-0007','b0000000-0000-0000-0000-000000000001','verified','wa_me_host_confirmed');
SELECT public.booth_assign_guide('ref-narrow-0007','b0000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001',NULL,NULL);

-- ALLOWED: the assigned Guide's own acknowledgement.
SELECT public.booth_acknowledge_guide('ref-narrow-0007','b0000000-0000-0000-0000-000000000002','guide_self_confirmed');
SELECT pg_temp.assert_true(
  (SELECT guide_acknowledged_by='b0000000-0000-0000-0000-000000000002'
     FROM public.booth_sessions WHERE client_ref='ref-narrow-0007'),
  'the assigned Guide may confirm their OWN acknowledgement');

-- ALLOWED: the assigned Guide's own first contact, and nothing bundled with it.
SELECT public.booth_record_handoff('ref-narrow-0007','b0000000-0000-0000-0000-000000000002',
  'guide_self_confirmed', NULL, NULL, NULL);
SELECT pg_temp.assert_true(
  (SELECT guide_first_contact_by='b0000000-0000-0000-0000-000000000002'
          AND guide_first_contact_method='guide_self_confirmed'
     FROM public.booth_sessions WHERE client_ref='ref-narrow-0007'),
  'the assigned Guide may confirm their OWN first contact');

-- REFUSED: everything else, even for the assigned Guide.
SELECT pg_temp.assert_true(
  pg_temp.refused_without_change(
    $q$SELECT public.booth_record_handoff('ref-narrow-0007','b0000000-0000-0000-0000-000000000002',
        'guide_self_confirmed', now() + interval '1 day', 'Asia/Bangkok', NULL)$q$,
    'booth_session_forbidden', 'ref-narrow-0007'),
  'the assigned Guide cannot schedule the consultation');

SELECT pg_temp.assert_true(
  pg_temp.refused_without_change(
    $q$SELECT public.booth_record_handoff('ref-narrow-0007','b0000000-0000-0000-0000-000000000002',
        NULL, NULL, NULL, 'my own next step')$q$,
    'booth_session_forbidden', 'ref-narrow-0007'),
  'the assigned Guide cannot write the next step');

SELECT pg_temp.assert_true(
  pg_temp.refused_without_change(
    $q$SELECT public.booth_acknowledge_guide('ref-narrow-0007','b0000000-0000-0000-0000-000000000002','host_observed')$q$,
    'booth_session_forbidden', 'ref-narrow-0007'),
  'the assigned Guide cannot record a HOST observation');

SELECT pg_temp.assert_true(
  pg_temp.refused_without_change(
    $q$SELECT public.booth_commit_consent('ref-narrow-0007','b0000000-0000-0000-0000-000000000002','quick',
        '{"profileVersion":2,"preferredLanguage":"English"}'::jsonb, 2, now(), '[]'::jsonb, 'none',
        '{"first_name":"Eve","whatsapp":"+79990005566","preferred_language":"English"}'::jsonb,
        '{"name":"Eve","phone":"+79990005566","message":"m","source":"booth_v2"}'::jsonb)$q$,
    'booth_session_forbidden', 'ref-narrow-0007'),
  'the assigned Guide cannot edit the profile, shortlist, contact or consent');

SELECT pg_temp.assert_true(
  pg_temp.refused_without_change(
    $q$SELECT public.booth_set_whatsapp_state('ref-narrow-0007','b0000000-0000-0000-0000-000000000002','pending',NULL)$q$,
    'booth_session_forbidden', 'ref-narrow-0007'),
  'the assigned Guide cannot change the WhatsApp verification');

SELECT pg_temp.assert_true(
  pg_temp.refused_without_change(
    $q$SELECT public.booth_assign_guide('ref-narrow-0007','b0000000-0000-0000-0000-000000000002','b1000000-0000-0000-0000-000000000002',NULL,NULL)$q$,
    'booth_session_forbidden', 'ref-narrow-0007'),
  'the assigned Guide cannot reassign the Guide');

SELECT pg_temp.assert_true(
  pg_temp.refused_without_change(
    $q$SELECT public.booth_complete_session('ref-narrow-0007','b0000000-0000-0000-0000-000000000002','no_contact_qr')$q$,
    'booth_session_forbidden', 'ref-narrow-0007'),
  'the assigned Guide cannot complete or abandon the session');

SELECT pg_temp.assert_true(
  pg_temp.refused_without_change(
    $q$SELECT public.booth_mark_profile_confirmed('ref-narrow-0007','b0000000-0000-0000-0000-000000000002','full')$q$,
    'booth_session_forbidden', 'ref-narrow-0007'),
  'the assigned Guide cannot mark the profile confirmed');

-- ---------------------------------------------------------------------------
-- 10. No-contact continuation retains NOTHING about the guest
-- ---------------------------------------------------------------------------
SELECT public.booth_ensure_session('ref-contract-0003', 'b0000000-0000-0000-0000-000000000001', 'host-a@example.test', 'pilot-booth');
SELECT public.booth_mark_profile_confirmed('ref-contract-0003','b0000000-0000-0000-0000-000000000001','full');
SELECT public.booth_commit_consent('ref-contract-0003','b0000000-0000-0000-0000-000000000001','full',
  '{"profileVersion":2,"preferredLanguage":"English","note":"wants a sea view in Bang Tao"}'::jsonb, 2, now(),
  '[{"slug":"modeva","mentionedByGuest":true}]'::jsonb, 'guest_selected',
  '{"first_name":"Cee","last_name":"Tan","whatsapp":"+79990003344","preferred_language":"English","email":"cee@example.test","country":"Singapore","preferred_contact_time":"evenings","host_note":"prefers WhatsApp","marketing_opt_in":true}'::jsonb,
  '{"name":"Cee Tan","phone":"+79990003344","email":"cee@example.test","message":"m","source":"booth_v2"}'::jsonb);
SELECT public.booth_set_whatsapp_state('ref-contract-0003','b0000000-0000-0000-0000-000000000001','verified','wa_me_host_confirmed');
SELECT public.booth_assign_guide('ref-contract-0003','b0000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000002','busy');
SELECT public.booth_acknowledge_guide('ref-contract-0003','b0000000-0000-0000-0000-000000000002','guide_self_confirmed');
SELECT public.booth_record_handoff('ref-contract-0003','b0000000-0000-0000-0000-000000000001','host_observed',
  now() + interval '1 day','Asia/Bangkok','send three options');

SELECT pg_temp.assert_true(
  (SELECT profile IS NOT NULL AND lead_id IS NOT NULL AND assigned_guide_id IS NOT NULL
     FROM public.booth_sessions WHERE client_ref='ref-contract-0003'),
  'the no-contact fixture really did accumulate a full record first');

SELECT public.booth_complete_session('ref-contract-0003','b0000000-0000-0000-0000-000000000001','no_contact_qr');

SELECT pg_temp.assert_true(
  (SELECT outcome='no_contact_qr'
          AND profile IS NULL AND profile_version IS NULL AND profile_confirmed_at IS NULL
          AND flow_mode IS NULL
          AND jsonb_array_length(shortlist)=0 AND shortlist_mode='none'
          AND first_name IS NULL AND whatsapp IS NULL AND last_name IS NULL
          AND email IS NULL AND country IS NULL AND preferred_contact_time IS NULL
          AND host_note IS NULL AND preferred_language IS NULL
          AND consultation_consent = FALSE AND consent_recorded_at IS NULL
          AND marketing_opt_in = FALSE
          AND whatsapp_verification_state='unverified' AND whatsapp_verified_at IS NULL
          AND whatsapp_verification_method IS NULL
          AND assigned_guide_id IS NULL AND reserve_guide_id IS NULL
          AND guide_assigned_at IS NULL
          AND guide_acknowledged_at IS NULL AND guide_acknowledged_by IS NULL
          AND guide_acknowledged_method IS NULL
          AND guide_first_contact_at IS NULL AND guide_first_contact_by IS NULL
          AND guide_first_contact_method IS NULL
          AND guide_fallback_reason IS NULL
          AND consultation_scheduled_at IS NULL AND consultation_timezone IS NULL
          AND next_step IS NULL AND lead_id IS NULL
     FROM public.booth_sessions WHERE client_ref='ref-contract-0003'),
  'a no-contact session retains NOTHING about the guest');

-- What may remain is only the anonymous shell.
SELECT pg_temp.assert_true(
  (SELECT client_ref IS NOT NULL AND host_user_id IS NOT NULL AND booth_id IS NOT NULL
          AND created_at IS NOT NULL
     FROM public.booth_sessions WHERE client_ref='ref-contract-0003'),
  'the anonymous funnel shell (identity, Host/booth attribution, timestamps) remains');

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.leads WHERE phone='+79990003344') = 0,
  'no lead survives a no-contact session');

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.booth_funnel_events e
     JOIN public.booth_sessions s ON s.id=e.session_id
    WHERE s.client_ref='ref-contract-0003' AND e.event='qr_continuation') = 1,
  'a no-contact completion emits qr_continuation once');

-- A replay of the SAME terminal outcome stays an idempotent success.
SELECT public.booth_complete_session('ref-contract-0003','b0000000-0000-0000-0000-000000000001','no_contact_qr');
SELECT pg_temp.assert_true(
  (SELECT outcome='no_contact_qr' FROM public.booth_sessions WHERE client_ref='ref-contract-0003'),
  'replaying the established no-contact outcome is idempotent');

SELECT pg_temp.assert_true(
  pg_temp.refused_without_change(
    $q$UPDATE public.booth_sessions SET host_note='re-added' WHERE client_ref='ref-contract-0003'$q$,
    'booth_session_terminal_immutable', 'ref-contract-0003'),
  'a no-contact session is frozen too — nothing can be written back into it');

-- ---------------------------------------------------------------------------
-- 11. Funnel events are once-only and abandonment is settled atomically
-- ---------------------------------------------------------------------------
SELECT public.booth_ensure_session('ref-contract-0004', 'b0000000-0000-0000-0000-000000000001', NULL, 'pilot-booth');
SELECT public.booth_record_event('ref-contract-0004','b0000000-0000-0000-0000-000000000001','meaningful_conversation',NULL,NULL);
SELECT public.booth_record_event('ref-contract-0004','b0000000-0000-0000-0000-000000000001','meaningful_conversation',NULL,NULL);
SELECT public.booth_record_event('ref-contract-0004','b0000000-0000-0000-0000-000000000001','session_abandoned','contact','inactivity_timeout');
SELECT public.booth_record_event('ref-contract-0004','b0000000-0000-0000-0000-000000000001','session_abandoned','contact','inactivity_timeout');

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.booth_funnel_events e
     JOIN public.booth_sessions s ON s.id=e.session_id
    WHERE s.client_ref='ref-contract-0004') = 2,
  'repeated funnel events are recorded at most once each');

SELECT pg_temp.assert_true(
  (SELECT outcome='abandoned' AND abandonment_step='contact'
          AND abandonment_reason='inactivity_timeout'
     FROM public.booth_sessions WHERE client_ref='ref-contract-0004'),
  'abandonment settles the session outcome with its step and reason');

SELECT pg_temp.assert_true(
  pg_temp.refused_without_change(
    $q$SELECT public.booth_mark_profile_confirmed('ref-contract-0004','b0000000-0000-0000-0000-000000000001','quick')$q$,
    'booth_session_not_active', 'ref-contract-0004'),
  'an abandoned session refuses further state transitions');

-- ---------------------------------------------------------------------------
-- 12. Shortlist bounds are enforced by the database, at consent
-- ---------------------------------------------------------------------------
SELECT public.booth_ensure_session('ref-shortlist-0010', 'b0000000-0000-0000-0000-000000000001', 'host-a@example.test', 'pilot-booth');

SELECT pg_temp.assert_true(
  pg_temp.raises(
    $q$SELECT public.booth_commit_consent('ref-shortlist-0010','b0000000-0000-0000-0000-000000000001','quick',
        '{"profileVersion":2,"preferredLanguage":"English"}'::jsonb, 2, now(),
        '[{"slug":"a"},{"slug":"b"},{"slug":"c"},{"slug":"d"},{"slug":"e"}]'::jsonb,'guest_selected',
        '{"first_name":"Fay","whatsapp":"+79990006677","preferred_language":"English"}'::jsonb,
        '{"name":"Fay","phone":"+79990006677","message":"m","source":"booth_v2"}'::jsonb)$q$,
    'booth_sessions_shortlist_max_four'),
  'a five-entry shortlist is rejected by the database');

SELECT pg_temp.assert_true(
  pg_temp.raises(
    $q$SELECT public.booth_commit_consent('ref-shortlist-0010','b0000000-0000-0000-0000-000000000001','quick',
        '{"profileVersion":2,"preferredLanguage":"English"}'::jsonb, 2, now(),
        '[]'::jsonb,'guest_selected',
        '{"first_name":"Fay","whatsapp":"+79990006677","preferred_language":"English"}'::jsonb,
        '{"name":"Fay","phone":"+79990006677","message":"m","source":"booth_v2"}'::jsonb)$q$,
    'booth_sessions_shortlist_mode_coherent'),
  'an empty guest_selected shortlist is incoherent and rejected');

SELECT pg_temp.assert_true(
  (SELECT consultation_consent = FALSE AND lead_id IS NULL
     FROM public.booth_sessions WHERE client_ref='ref-shortlist-0010'),
  'a rejected consent commit leaves the session unconsented, with no lead');

SELECT 'ALL BOOTH POSTGRES ASSERTIONS PASSED' AS result;
