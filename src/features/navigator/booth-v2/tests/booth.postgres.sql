-- ============================================================================
-- FOREVER-BOOTH-ASSISTED-DECISION-001 (PR #102 corrective pass 1) —
-- real-database behavioral suite for the Booth Mode 2.0 pilot schema.
--
-- Runs against a disposable PostgreSQL cluster after the COMPLETE committed
-- migration chain (see scripts/studio/run-postgres-tests.mjs). The runner
-- deliberately grants browser roles ALL on public tables/functions BY DEFAULT
-- immediately before this migration applies, so these assertions prove the
-- migration's explicit REVOKEs actually strip inherited privileges.
--
-- Proves: privilege isolation, the all-or-nothing contact bundle, format and
-- coherence checks, structured consultation instants, attribution of every
-- acknowledgement, truthful completion gates, exactly-one-lead atomicity with
-- replay, no-contact total clearing (including lead deletion), and once-only
-- funnel events. No production connection.
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

-- Fixtures: one Host staff account, one Guide with a linked staff account, one
-- Guide without, and a project slug the shortlist can reference.
INSERT INTO auth.users (id, email) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'host@example.test'),
  ('b0000000-0000-0000-0000-000000000002', 'guide@example.test'),
  ('b0000000-0000-0000-0000-000000000003', 'other@example.test')
ON CONFLICT DO NOTHING;

INSERT INTO public.booth_guides (id, display_name, staff_user_id, languages, on_duty) VALUES
  ('b1000000-0000-0000-0000-000000000001', 'Guide One', 'b0000000-0000-0000-0000-000000000002', ARRAY['English'], TRUE),
  ('b1000000-0000-0000-0000-000000000002', 'Guide Two', NULL, ARRAY['English'], TRUE);

-- ---------------------------------------------------------------------------
-- 1. Privilege isolation — browser roles have NO path to booth data
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
  has_function_privilege('service_role','public.booth_save_contact_and_lead(text,jsonb,jsonb)','EXECUTE')
  AND has_function_privilege('service_role','public.booth_complete_session(text,text)','EXECUTE')
  AND NOT has_function_privilege('anon','public.booth_save_contact_and_lead(text,jsonb,jsonb)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.booth_save_contact_and_lead(text,jsonb,jsonb)','EXECUTE')
  AND NOT has_function_privilege('anon','public.booth_complete_session(text,text)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.booth_complete_session(text,text)','EXECUTE')
  AND NOT has_function_privilege('anon','public.booth_ensure_session(text,uuid,text,text)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.booth_assign_guide(text,uuid,uuid,text)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.booth_acknowledge_guide(text,uuid,text)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.booth_record_handoff(text,uuid,text,timestamptz,text,text)','EXECUTE'),
  'booth RPCs are service_role only');

-- The anonymous lead policy is untouched: a NULL email still fails its WITH CHECK.
SELECT pg_temp.assert_true(
  EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='leads'
          AND policyname='Anyone can submit a lead'
          AND with_check LIKE '%btrim(email)%'),
  'the anonymous leads INSERT policy still requires a non-blank email');

-- ---------------------------------------------------------------------------
-- 2. Session creation carries a server-derived Host identity
-- ---------------------------------------------------------------------------
SELECT public.booth_ensure_session('ref-contract-0001', 'b0000000-0000-0000-0000-000000000001', 'host@example.test', 'pilot-booth');
SELECT public.booth_ensure_session('ref-contract-0001', 'b0000000-0000-0000-0000-000000000001', 'host@example.test', 'pilot-booth');

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.booth_sessions WHERE client_ref='ref-contract-0001') = 1,
  'ensure_session is idempotent on client_ref');

SELECT pg_temp.assert_true(
  (SELECT host_user_id FROM public.booth_sessions WHERE client_ref='ref-contract-0001')
    = 'b0000000-0000-0000-0000-000000000001',
  'the Host identity is stored from the authenticated caller');

SELECT pg_temp.assert_true(
  pg_temp.raises(
    $q$INSERT INTO public.booth_sessions (client_ref, host_user_id) VALUES ('ref-nohost','b0000000-0000-0000-0000-000000000009')$q$,
    '*'),
  'a session cannot reference a non-existent Host account');

-- ---------------------------------------------------------------------------
-- 3. Contact bundle is all-or-nothing, format-checked, consent-gated
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_true(
  pg_temp.raises(
    $q$UPDATE public.booth_sessions SET first_name='Anna' WHERE client_ref='ref-contract-0001'$q$,
    'booth_sessions_contact_bundle'),
  'a partial contact bundle (name without number/consent) is rejected');

-- Confirm a profile (language included) so the bundle can be completed.
SELECT public.booth_confirm_profile(
  'ref-contract-0001', 'quick',
  '{"profileVersion":2,"flowMode":"quick","preferredLanguage":"English"}'::jsonb,
  2, now(), 'English');

SELECT pg_temp.assert_true(
  pg_temp.raises(
    $q$UPDATE public.booth_sessions SET first_name='Anna', whatsapp='+79990001122',
        preferred_language='Deutsch', consultation_consent=TRUE, consent_recorded_at=now()
       WHERE client_ref='ref-contract-0001'$q$,
    'booth_sessions_profile_language_agrees'),
  'a contact language that disagrees with the confirmed profile is rejected');

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.booth_funnel_events e
     JOIN public.booth_sessions s ON s.id = e.session_id
    WHERE s.client_ref='ref-contract-0001' AND e.event='profile_confirmed') = 1,
  'confirming the profile emits profile_confirmed server-side');

SELECT pg_temp.assert_true(
  pg_temp.raises(
    $q$UPDATE public.booth_sessions SET first_name='Anna', whatsapp='not-a-number',
        preferred_language='English', consultation_consent=TRUE, consent_recorded_at=now()
       WHERE client_ref='ref-contract-0001'$q$,
    'booth_sessions_contact_bundle'),
  'an invalid WhatsApp number is rejected');

SELECT pg_temp.assert_true(
  pg_temp.raises(
    $q$UPDATE public.booth_sessions SET first_name='Anna', whatsapp='+79990001122',
        preferred_language='English', consultation_consent=FALSE, consent_recorded_at=now()
       WHERE client_ref='ref-contract-0001'$q$,
    'booth_sessions_contact_bundle'),
  'contact data without the consultation consent is rejected');

SELECT pg_temp.assert_true(
  pg_temp.raises(
    $q$UPDATE public.booth_sessions SET first_name='Anna', whatsapp='+79990001122',
        preferred_language='English', consultation_consent=TRUE, consent_recorded_at=now(),
        email='nope' WHERE client_ref='ref-contract-0001'$q$,
    'booth_sessions_email_format'),
  'an invalid optional email is rejected');

SELECT pg_temp.assert_true(
  pg_temp.raises(
    $q$UPDATE public.booth_sessions SET first_name='Anna', whatsapp='+79990001122',
        preferred_language='English', consultation_consent=TRUE, consent_recorded_at=now(),
        country='   ' WHERE client_ref='ref-contract-0001'$q$,
    'booth_sessions_optional_text_nonblank'),
  'a blank optional string is rejected');

-- ---------------------------------------------------------------------------
-- 4. Verification, assignment, acknowledgement and handoff coherence
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_true(
  pg_temp.raises(
    $q$SELECT public.booth_set_whatsapp_state('ref-contract-0001','verified','wa_me_host_confirmed')$q$,
    'booth_contact_required'),
  'WhatsApp cannot be verified before a contact number exists');

SELECT public.booth_save_contact_and_lead(
  'ref-contract-0001',
  '{"first_name":"Anna","whatsapp":"+79990001122","preferred_language":"English","marketing_opt_in":false}'::jsonb,
  '{"name":"Anna","phone":"+79990001122","message":"summary","source":"booth_v2"}'::jsonb);

SELECT pg_temp.assert_true(
  (SELECT marketing_opt_in FROM public.booth_sessions WHERE client_ref='ref-contract-0001') = FALSE
  AND (SELECT consent_recorded_at IS NOT NULL FROM public.booth_sessions WHERE client_ref='ref-contract-0001'),
  'consultation consent is recorded and marketing stays false');

SELECT pg_temp.assert_true(
  pg_temp.raises(
    $q$UPDATE public.booth_sessions SET whatsapp_verification_state='verified'
       WHERE client_ref='ref-contract-0001'$q$,
    'booth_sessions_verified_requires_evidence'),
  'a verified state without timestamp and method is rejected');

SELECT public.booth_set_whatsapp_state('ref-contract-0001','verified','wa_me_host_confirmed');

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

SELECT public.booth_assign_guide('ref-contract-0001',
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
    'booth_ack_actor_mismatch'),
  'a non-Guide account cannot claim a Guide self-acknowledgement');

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

-- ---------------------------------------------------------------------------
-- 5. Completion gates
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_true(
  pg_temp.raises(
    $q$SELECT public.booth_complete_session('ref-contract-0001','contacted_complete')$q$,
    'booth_completion_blocked'),
  'completion is blocked without a next step and an exact time');

SELECT public.booth_record_handoff('ref-contract-0001', 'b0000000-0000-0000-0000-000000000001',
  NULL, now() + interval '1 day', 'Asia/Bangkok', '30-minute consultation');

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.booth_funnel_events e
     JOIN public.booth_sessions s ON s.id=e.session_id
    WHERE s.client_ref='ref-contract-0001' AND e.event='consultation_booked') = 1,
  'booking an exact time emits consultation_booked server-side');

SELECT public.booth_complete_session('ref-contract-0001','contacted_complete');
SELECT public.booth_complete_session('ref-contract-0001','contacted_complete'); -- idempotent replay

SELECT pg_temp.assert_true(
  (SELECT outcome FROM public.booth_sessions WHERE client_ref='ref-contract-0001') = 'contacted_complete',
  'a fully-evidenced contacted session completes');

SELECT pg_temp.assert_true(
  pg_temp.raises(
    $q$UPDATE public.booth_sessions SET next_step = NULL WHERE client_ref='ref-contract-0001'$q$,
    'booth_sessions_contacted_complete_gate'),
  'a completed session cannot lose a required completion fact');

-- ---------------------------------------------------------------------------
-- 6. Exactly one lead per session, replay-safe
-- ---------------------------------------------------------------------------
SELECT public.booth_ensure_session('ref-contract-0002', 'b0000000-0000-0000-0000-000000000001', 'host@example.test', 'pilot-booth');
SELECT public.booth_confirm_profile('ref-contract-0002','quick',
  '{"profileVersion":2,"preferredLanguage":"English"}'::jsonb, 2, now(), 'English');

SELECT pg_temp.assert_true(
  public.booth_save_contact_and_lead('ref-contract-0002',
    '{"first_name":"Bo","whatsapp":"+79990002233","preferred_language":"English"}'::jsonb,
    '{"name":"Bo","phone":"+79990002233","message":"m","source":"booth_v2"}'::jsonb)
  = public.booth_save_contact_and_lead('ref-contract-0002',
    '{"first_name":"Bo","whatsapp":"+79990002233","preferred_language":"English","country":"Thailand"}'::jsonb,
    '{"name":"Bo","phone":"+79990002233","message":"m2","source":"booth_v2"}'::jsonb),
  'an exact replay returns the SAME lead id');

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.leads WHERE phone='+79990002233') = 1,
  'a replayed contact save creates exactly one lead');

SELECT pg_temp.assert_true(
  (SELECT country FROM public.booth_sessions WHERE client_ref='ref-contract-0002') = 'Thailand',
  'a contact update after lead creation still applies');

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1 FROM public.leads l
     WHERE l.source='booth_v2'
       AND NOT EXISTS (SELECT 1 FROM public.booth_sessions s WHERE s.lead_id = l.id)),
  'no unattached booth lead exists');

-- A booth lead may carry no email; the trusted boundary is its only writer.
SELECT pg_temp.assert_true(
  (SELECT email IS NULL FROM public.leads WHERE phone='+79990002233'),
  'a booth lead can be stored without an email address');

-- One lead can never be linked to two sessions.
SELECT pg_temp.assert_true(
  pg_temp.raises(
    $q$UPDATE public.booth_sessions SET lead_id =
        (SELECT lead_id FROM public.booth_sessions WHERE client_ref='ref-contract-0002')
       WHERE client_ref='ref-contract-0001'$q$,
    '*'),
  'a lead cannot be linked to two booth sessions');

-- ---------------------------------------------------------------------------
-- 7. No-contact continuation retains nothing and deletes its lead
-- ---------------------------------------------------------------------------
SELECT public.booth_ensure_session('ref-contract-0003', 'b0000000-0000-0000-0000-000000000001', 'host@example.test', 'pilot-booth');
SELECT public.booth_confirm_profile('ref-contract-0003','full',
  '{"profileVersion":2,"preferredLanguage":"English"}'::jsonb, 2, now(), 'English');
SELECT public.booth_save_contact_and_lead('ref-contract-0003',
  '{"first_name":"Cee","whatsapp":"+79990003344","preferred_language":"English","email":"cee@example.test"}'::jsonb,
  '{"name":"Cee","phone":"+79990003344","email":"cee@example.test","message":"m","source":"booth_v2"}'::jsonb);
SELECT public.booth_set_whatsapp_state('ref-contract-0003','verified','wa_me_host_confirmed');
SELECT public.booth_assign_guide('ref-contract-0003','b1000000-0000-0000-0000-000000000001', NULL, NULL);

SELECT public.booth_complete_session('ref-contract-0003','no_contact_qr');

SELECT pg_temp.assert_true(
  (SELECT outcome='no_contact_qr' AND first_name IS NULL AND whatsapp IS NULL
          AND email IS NULL AND preferred_language IS NULL AND host_note IS NULL
          AND consultation_consent = FALSE AND consent_recorded_at IS NULL
          AND marketing_opt_in = FALSE
          AND whatsapp_verification_state='unverified' AND whatsapp_verified_at IS NULL
          AND whatsapp_verification_method IS NULL
          AND assigned_guide_id IS NULL AND guide_assigned_at IS NULL
          AND next_step IS NULL AND consultation_scheduled_at IS NULL AND lead_id IS NULL
     FROM public.booth_sessions WHERE client_ref='ref-contract-0003'),
  'a no-contact session retains nothing personal or operational');

SELECT pg_temp.assert_true(
  (SELECT (profile ->> 'preferredLanguage') IS NULL
     FROM public.booth_sessions WHERE client_ref='ref-contract-0003'),
  'the stored profile language is scrubbed on a no-contact outcome');

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.leads WHERE phone='+79990003344') = 0,
  'no lead survives a no-contact session');

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM public.booth_funnel_events e
     JOIN public.booth_sessions s ON s.id=e.session_id
    WHERE s.client_ref='ref-contract-0003' AND e.event='qr_continuation') = 1,
  'a no-contact completion emits qr_continuation once');

-- ---------------------------------------------------------------------------
-- 8. Funnel events are once-only and abandonment is settled atomically
-- ---------------------------------------------------------------------------
SELECT public.booth_ensure_session('ref-contract-0004', 'b0000000-0000-0000-0000-000000000001', NULL, 'pilot-booth');
SELECT public.booth_record_event('ref-contract-0004','meaningful_conversation',NULL,NULL);
SELECT public.booth_record_event('ref-contract-0004','meaningful_conversation',NULL,NULL);
SELECT public.booth_record_event('ref-contract-0004','session_abandoned','contact','inactivity_timeout');
SELECT public.booth_record_event('ref-contract-0004','session_abandoned','contact','inactivity_timeout');

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
  pg_temp.raises(
    $q$SELECT public.booth_confirm_profile('ref-contract-0004','quick','{}'::jsonb,2,now(),NULL)$q$,
    'booth_session_not_active'),
  'a finished session refuses further state transitions');

-- ---------------------------------------------------------------------------
-- 9. Shortlist bounds
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_true(
  pg_temp.raises(
    $q$SELECT public.booth_set_shortlist('ref-contract-0002',
        '[{"slug":"a"},{"slug":"b"},{"slug":"c"},{"slug":"d"},{"slug":"e"}]'::jsonb,'guest_selected')$q$,
    'booth_sessions_shortlist_max_four'),
  'a five-entry shortlist is rejected by the database');

SELECT pg_temp.assert_true(
  pg_temp.raises(
    $q$SELECT public.booth_set_shortlist('ref-contract-0002','[]'::jsonb,'guest_selected')$q$,
    'booth_sessions_shortlist_mode_coherent'),
  'an empty guest_selected shortlist is incoherent and rejected');

SELECT 'ALL BOOTH POSTGRES ASSERTIONS PASSED' AS result;
