-- Forever Booth 2.0 pilot summary (internal, service-role only).
-- One result set per metric block; see docs/FOREVER_BOOTH_PILOT_SCORECARD.md.

-- 1. Funnel counts
SELECT event, count(*) AS n
FROM public.booth_funnel_events
GROUP BY event
ORDER BY n DESC;

-- 2. Quick vs Full among confirmed profiles
SELECT flow_mode, count(*) AS n
FROM public.booth_sessions
WHERE profile_confirmed_at IS NOT NULL
GROUP BY flow_mode;

-- 3. Outcomes
SELECT outcome, count(*) AS n
FROM public.booth_sessions
GROUP BY outcome;

-- 4. Valid WhatsApp rate among contacted sessions
SELECT
  count(*) FILTER (WHERE whatsapp_verification_state = 'verified') AS verified,
  count(*) FILTER (WHERE whatsapp IS NOT NULL) AS contact_saved
FROM public.booth_sessions;

-- 5. Guide SLAs (2-minute acknowledgement, 5-minute first contact)
SELECT
  count(*) FILTER (WHERE guide_acknowledged_at - guide_assigned_at <= interval '2 minutes') AS ack_within_2m,
  count(*) FILTER (WHERE guide_first_contact_at - guide_assigned_at <= interval '5 minutes') AS contact_within_5m,
  count(*) FILTER (WHERE guide_assigned_at IS NOT NULL) AS assigned
FROM public.booth_sessions;

-- 6. Abandonment breakdown
SELECT abandonment_step, abandonment_reason, count(*) AS n
FROM public.booth_sessions
WHERE outcome = 'abandoned'
GROUP BY abandonment_step, abandonment_reason
ORDER BY n DESC;

-- 7. Shortlist behaviour
SELECT shortlist_mode, jsonb_array_length(shortlist) AS size, count(*) AS n
FROM public.booth_sessions
WHERE profile_confirmed_at IS NOT NULL
GROUP BY shortlist_mode, size
ORDER BY shortlist_mode, size;
