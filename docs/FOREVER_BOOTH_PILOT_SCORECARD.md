# Forever Booth 2.0 — Pilot Scorecard

Internal measurement for the Assisted Decision Concierge pilot. **No external analytics
platform**; everything comes from the structured `booth_sessions` /
`booth_funnel_events` tables via the queries below (also in
`scripts/booth/pilot-summary.sql`). No conversion targets are set for this pilot —
the pilot's purpose is to LEARN the numbers, not to hit invented ones.

## Pilot window

Two weeks **or** 100 `meaningful_conversation` events, whichever comes first.

## What we measure

| Metric                   | Definition (event/field)                               |
| ------------------------ | ------------------------------------------------------ |
| Meaningful conversations | `meaningful_conversation` events                       |
| Quick vs Full share      | `step` of the `profile_confirmed` funnel event         |
| Profile completion       | `profile_confirmed` / `profile_started`                |
| Valid WhatsApp rate      | `whatsapp_verified` / sessions with contact saved      |
| Guide contact ≤ 5 min    | `guide_first_contact_at - guide_assigned_at <= 5 min`  |
| Acknowledgement ≤ 2 min  | `guide_acknowledged_at - guide_assigned_at <= 2 min`   |
| Consultation bookings    | `consultation_booked` events                           |
| QR continuations         | `qr_continuation` events                               |
| Abandonment step/reason  | `session_abandoned` events + `abandonment_step/reason` |
| Viewings (later)         | `viewing_booked` events, when recorded                 |

## Queries (service-role only; run internally, never from a browser)

```sql
-- Funnel counts
SELECT event, count(*) FROM public.booth_funnel_events GROUP BY event ORDER BY count(*) DESC;

-- Quick vs Full among confirmed profiles. Read from the funnel event step:
-- the profile is not persisted before the guest consents, and flow_mode is
-- cleared entirely on a no-contact outcome.
SELECT step AS flow_mode, count(*) FROM public.booth_funnel_events
WHERE event = 'profile_confirmed' GROUP BY step;

-- Outcomes
SELECT outcome, count(*) FROM public.booth_sessions GROUP BY outcome;

-- Valid WhatsApp rate among contacted sessions
SELECT
  count(*) FILTER (WHERE whatsapp_verification_state = 'verified') AS verified,
  count(*) FILTER (WHERE whatsapp IS NOT NULL) AS contact_saved
FROM public.booth_sessions;

-- Guide SLAs
SELECT
  count(*) FILTER (WHERE guide_acknowledged_at - guide_assigned_at <= interval '2 minutes') AS ack_within_2m,
  count(*) FILTER (WHERE guide_first_contact_at - guide_assigned_at <= interval '5 minutes') AS contact_within_5m,
  count(*) FILTER (WHERE guide_assigned_at IS NOT NULL) AS assigned
FROM public.booth_sessions;

-- Abandonment breakdown
SELECT abandonment_step, abandonment_reason, count(*)
FROM public.booth_sessions WHERE outcome = 'abandoned'
GROUP BY abandonment_step, abandonment_reason ORDER BY count(*) DESC;

-- Shortlist behaviour (consented sessions only — a shortlist exists nowhere else)
SELECT shortlist_mode, jsonb_array_length(shortlist) AS size, count(*)
FROM public.booth_sessions WHERE consultation_consent
GROUP BY shortlist_mode, size ORDER BY shortlist_mode, size;
```

## What these numbers can and cannot tell us

The consent boundary deliberately limits this scorecard, and that limit is the point:

- Sessions where the guest did **not** consent contribute funnel counts, outcomes and
  abandonment step/reason — and nothing else. No profile, no shortlist, no answers, no
  language, no contact data was ever stored for them.
- A `no_contact_qr` session is reduced to an anonymous shell, so it can be counted but
  never profiled retrospectively.
- Quick-vs-Full share therefore comes from the `profile_confirmed` event's `step`, not
  from a stored profile.

Any question that would need pre-consent guest data cannot be answered from this
pilot, and should not be — answering it would mean storing what the guest did not
agree to.

## Daily one-page summary (manual, pilot)

- Conversations · profiles started · confirmed (Quick/Full)
- Contacts saved · WhatsApp verified · Guides assigned
- Ack ≤ 2 min and contact ≤ 5 min (count / assigned)
- Consultations with exact time · live-message confirmations
- QR continuations · abandonments (top step + reason)
- Operational blocks encountered (no Guide on duty, WhatsApp unavailable) — with times

## Review

End of pilot: compare Quick vs Full completion and downstream verification rates,
identify the top abandonment step, list every operational block, and only THEN discuss
targets for the next phase.
