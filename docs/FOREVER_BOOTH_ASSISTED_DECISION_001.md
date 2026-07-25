# FOREVER-BOOTH-ASSISTED-DECISION-001 — Architecture Record

Booth Mode 2.0: the pilot-ready **Forever Assisted Decision Concierge**.

- Base: `main` @ `a9d275fc678065ef70b331aee20f24f1c4f030e6` (PR #100 merge commit, verified merged).
- Branch: `claude/forever-booth-assisted-decision-001`.
- Research basis: «НЕЗАВИСИМОЕ ИССЛЕДОВАНИЕ — Оптимальная модель взаимодействия с гостем на бутсе», v1.0, 25 July 2026 (task brief used as the authoritative summary).
- Factory autonomy: **A0** (unchanged). Production: **untouched** — no deploy, no migration application, no production data access.

---

## 1. Diagnosis of the current implementation

The pre-existing Booth Mode (`/booth`, `src/features/navigator/booth/*`) implements only
the first half of the intended journey:

- It reuses the website's fixed NAV-001 screen order (`NAVIGATOR_SCREEN_ORDER`,
  screens 00–08) — website and booth were architecturally locked to the identical flow.
- It captures psychological motivations/concerns but **no usable search profile**:
  no property type, bedrooms, areas, readiness, no purchase purpose, no original-currency
  budget (NAV-001 bands are USD-only labels).
- One mode only — no Quick/Full choice.
- The guest is funneled toward **one** `selectedProjectSlug`; zero or several directions
  are not representable.
- Contact reuses the website's heavy contract (surname + email required), with a single
  implicit consent and no marketing separation.
- No WhatsApp verification, no Guide identity, no acknowledgement/contact SLA, no next
  step, no funnel measurement.
- The archetype label is the constant **"The Considered Retreat-Seeker"** for every
  completed profile (`core/forever-story.ts`) — a universal pseudo-result.
- Structured storage does not exist: everything lands in `leads.message` free text.
- Reset is a manual `sessionStorage.removeItem` behind one button; no inactivity or
  post-completion auto-clear.

## 2. Retained foundations (deliberately unchanged)

- **Truth-first Navigator Core** (`src/features/navigator/core/*`): question definitions,
  `deriveDecisionProfile`, deterministic matching with fail-closed sentinel guards and the
  conservative yield parser, `ProjectService` with its explicit privacy-preserving column
  projection, `/projects/<slug>` links, source-backed reasons, the lead boundary
  (`lead-service.ts` + write-only `leads` RLS), and the website Navigator's behaviour.
- The legacy `/booth` route and shell stay exactly as they are (parallel pilot rule, §12).
- The existing studio-style trusted server boundary pattern (`supabaseAdmin` +
  RLS-with-no-policies internal tables) is **reused**, not reinvented — no second staff
  identity system was created.

## 3. Replaced boundaries

Booth V2 replaces, for the booth only:

| Replaced                                       | With                                                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Shared fixed screen order as product authority | Booth-owned explicit state machine (`core/v2/session.ts`)                                                                |
| Booth shell (`booth/BoothNavigator`)           | `booth-v2/BoothV2Navigator` (parallel route `/booth-v2`)                                                                 |
| Single `selectedProjectSlug`                   | Shortlist model, 0–4 entries, enforced in the reducer **and** by a DB CHECK                                              |
| Website contact contract at the booth          | Light contract: first name + WhatsApp + language, separate consents                                                      |
| "Lead saved" completion                        | Truthful completion gates (profile ∧ verified WhatsApp ∧ named Guide ∧ next step ∧ exact time or confirmed live message) |
| `leads.message` as the only record             | Structured `booth_sessions` (authoritative) + human-readable lead mirror                                                 |

The invariant "website and booth must use the identical fixed screen order" is removed as
a product rule. The website keeps its flow untouched; the legacy core keeps its own
parity tests for the legacy shells.

## 4. DecisionProfileV2 (versioned shared profile)

`src/features/navigator/core/v2/profile.ts`:

- `profileVersion: 2`, `flowMode: quick | full`, `purchasePurpose:
lifestyle | investment | both | exploring`.
- NAV-001 motivations / goals / concerns / note preserved verbatim (empty in Quick).
- `BudgetRangeV2`: minimum / maximum / **originalCurrency** (USD EUR GBP THB RUB CNY) /
  `stated | exploring`. Band boundaries are the guest's own statement in their currency.
- `CanonicalThbBudget` exists **only** when the original currency is THB (identity, no
  conversion) or when a dated, source-identified `FxRateConfig` covers the currency.
  Missing/undated/unsourced FX ⇒ no canonical budget ⇒ budget matching disabled — never a
  mismatch, never an invented rate.
- Search Essentials: property type, bedrooms, preferred areas OR explicit
  "help me choose based on lifestyle", readiness (`ready | off_plan | both | unsure`),
  preferred language, `confirmedAt` timestamp.
- `profileV2FromLegacyAnswers` lifts website NAV-001 answers to V2 with every essential
  honestly unknown — the website itself is not modified.
- `parseStoredProfileV2` is fail-closed: malformed / unversioned / obsolete payloads
  parse to `null`, never to a partially-trusted profile.

## 5. Quick and Full flows

State machine screens (all explicit, back navigation tested):

```
welcome → permission → mode_selection
  quick:  quick_profile (purpose → budget+currency → condo/villa → timeline)
  full:   full_nav_questions (NAV-001 01–04 + note) → property_fit → location_fit → readiness
→ decision_summary → initial_directions → contact
→ whatsapp_verification → guide_assignment → handoff_waiting → next_step → completion
declines at any contact point → respectful_no_contact_qr
```

- Quick requires exactly: purpose, budget range + original currency, condominium /
  villa / both / unsure, timeline. It never asks concerns, areas, project selection,
  email, or surname, and may proceed straight from the summary to contact/handoff.
- Full preserves the NAV-001 psychological questions verbatim (same option modules) and
  adds the Search Essentials. Area options are derived from the live catalogue's actual
  `location` values — no invented area list.
- The **Decision Summary** is factual, per-section editable, and states:
  _"This is your initial Decision Profile. It is not a sales recommendation yet."_
- The universal archetype is **hidden entirely** in Booth V2 (no differentiated,
  tested derivation rules exist yet, so per §6 of the brief it must not render).
- Editing a confirmed profile invalidates the confirmation, shortlist, and all handoff
  progress (reducer-enforced, tested).

## 6. Initial directions (matching rework)

`core/v2/directions.ts` replaces "Projects matching your preferences" with
**"Initial directions based on what we know"**:

- Dimensions: property type, location, readiness, bedrooms (only when `beds` parses
  unambiguously — single count or clean numeric range; anything else fails closed),
  budget (only with a truthful canonical THB budget AND a real THB price; the reason
  label carries the rate source + effective date), investment purpose (only with a
  quantified verified yield via the existing conservative parser — suppressed advisory
  data means this effectively never fires from live data, honestly).
- Fail-closed inputs produce **unknowns**, never reasons, and uncertainty is typed:
  `guest_answer_missing` / `no_suitable_project_fact` / `project_evidence_missing`.
- Every card has four explicit sections: **Why shown · Trade-off · Unknown ·
  Last updated / source**. No verified trade-off source exists in the public projection,
  so `tradeOff` is always `null` and the UI renders
  _"No verified trade-off statement yet — Guide review required"_ — never marketing copy.
  Price freshness renders truthfully ("Price freshness not verified…" when absent).
- No scores, percentages, rankings, "best match", fabricated yields, or commission
  preference. Catalogue order is preserved; the honest fallback shows the full catalogue.

## 7. Shortlist (zero to four)

`ShortlistV2 { entries: {slug, mentionedByGuest}[], guidePrepares }` — max 4 enforced in
the reducer (5th toggle is a no-op), re-enforced by zod at the server boundary and by a
`jsonb_array_length(shortlist) <= 4` CHECK in the database. Zero-project completion and
"Let my Guide prepare the shortlist" are first-class. Project links stay
`/projects/<runtime-slug>`.

## 8. Contact and consent contract

`core/v2/contact.ts`: required — first name, WhatsApp/phone, preferred language;
optional — last name, email (validated only when present), country, convenient time,
internal Host note. Two deliberately separate consents:

- `consultationConsent` (required): permission to save the Decision Profile and provide
  the requested consultation through the chosen channel.
- `marketingOptIn`: separate, optional, **default false**, never bundled.

Website `validateLead` is untouched (surname/email still required there); a regression
test pins it. Database: `leads.email` became nullable with a NULL-tolerant format CHECK
so the trusted server can mirror booth leads, but the anonymous INSERT policy still
requires a non-blank email — the browser-side website contract is not weakened
(`length(btrim(NULL)) > 0` is not true, so anon NULL-email inserts are rejected).

## 9. Structured storage

Migration `supabase/migrations/20260725150000_booth_v2_pilot.sql` (pending; NOT applied):

- `booth_guides` — operator-maintained roster (name, languages, specializations,
  active, on-duty). **No seed rows** — no staff names or numbers are invented.
- `booth_sessions` — authoritative structured record: versioned confirmed profile
  (jsonb + `profile_version` + `profile_confirmed_at`), flow mode, shortlist + mode,
  light contact fields, both consents (+ `consent_recorded_at`), WhatsApp verification
  state/timestamp/method, assigned + reserve Guide, `guide_assigned_at`,
  `guide_acknowledged_at`, `guide_first_contact_at`, `consultation_scheduled_for`,
  `next_step`, fallback reason, outcome, abandonment step/reason, `booth_id`,
  `host_label`, `lead_id` (human-readable mirror), and a UNIQUE client_ref idempotency
  key. CHECKs enforce contact-requires-consent, verified-has-timestamp, the
  contacted-completion gate, and no-contact-stores-no-contact.
- `booth_funnel_events` — `UNIQUE (session_id, event)`, event vocabulary CHECK in
  lockstep with the TypeScript contract.
- **RLS**: all three tables enabled with **no policies and no anon/authenticated
  grants** (the `studio_members` internal-only pattern). Anonymous clients cannot read
  or write booth data at all, so Host/Guide identities cannot be spoofed from the
  browser; all writes go through the server boundary.
- `leads.message` still receives a deterministic human-readable summary
  (`buildBoothV2Summary`) — a mirror, not the source of truth.
- Rollback: documented in the migration's DOWN reference (drop the three tables —
  destroying only pilot data — and restore `leads.email NOT NULL` only after verifying
  no NULL-email rows exist).

## 10. Server boundary

`booth-v2/booth-v2.functions.ts` (wiring + zod) → `booth-v2/server/service.ts`
(service-role writes, transition validation, safe error envelope with redacted logs).
Endpoints: config, ensureSession, recordEvent, confirmProfile (re-runs the fail-closed
parser server-side), setShortlist, saveContact (+ lead mirror, once per session),
start/confirm WhatsApp verification, listGuides, assignGuide, acknowledgeGuide,
recordHandoff, completeSession (server-side gate + DB CHECK backstop). Retries are
idempotent via `client_ref` upserts and the funnel uniqueness constraint. The dev/demo
no-write mode (`VITE_PARTNER_DEMO` / `VITE_DEMO_LEAD_MODE`) short-circuits before any
database access, mirroring the lead-service rule.

The booth tablet is an unauthenticated kiosk; the pilot's trust model is
"no anonymous database path + server-validated transitions + auditable manual Host
actions". Host identity is an operational label, not an authenticated credential — an
accepted, documented pilot boundary (see §14).

## 11. WhatsApp verification (manual pilot)

`core/v2/whatsapp.ts` + server endpoints. No Business API. The destination is
`BOOTH_WHATSAPP_NUMBER` (E.164, operator env config; `.env.example` documents it with a
placeholder). Absent/malformed config **fails closed**: state `unavailable`, the UI says
verification is unavailable and explicitly that the number was NOT verified, and the
contacted-completion gate stays blocked. Pilot flow: wa.me deep link (QR poster at the
booth) with a short non-sensitive session code derived from the random client ref; the
Host confirms the incoming message; state/timestamp/method are recorded. A contacted
handoff is complete only when verified; the deliberate no-contact QR path is the only
exception.

## 12. Guide assignment and warm handoff

`core/v2/guides.ts` + `booth_guides`. Suggestion order: on-duty Guides speaking the
guest's preferred language, then the rest of the on-duty roster; primary + reserve;
manual Host override always available. Empty roster / nobody on duty ⇒ a truthful
operational block — no Guide is ever invented; the Host records an exact contact time
instead. Recorded: assigned_at, acknowledged_at (manual, auditable — no WhatsApp API
required in the pilot), first_contact_at, consultation_scheduled_for, next_step,
fallback reason. The UI shows the Guide's name and languages, a 2-minute
acknowledgement timer and the 5-minute first-contact SLA.

## 13. Completion, privacy, auto-clear

- Contacted completion gates (client + server + DB): confirmed profile, verified
  WhatsApp, named Guide, recorded next step, exact time OR confirmed live message. The
  completion screen renders the actual outcomes — never "Lead saved".
- No-contact completion: deliberate decline, QR continuation shown, every personal field
  cleared (client reducer + server clear + DB CHECK).
- Auto-clear: versioned sessionStorage envelope; fail-closed hydration discards
  malformed, finished, or stale payloads; inactivity → Host warning → abandonment event
  - clear; completed sessions clear after ~45 s; "Start new guest" stays guarded. The
    next guest can never see the previous guest's data.

## 14. Funnel events and pilot metrics

Eleven structured events (see `core/v2/funnel.ts`), each at most once per session
(client dedupe + DB UNIQUE). Abandonment records step + reason only — no conversation
content, no device metadata, no external analytics. Pilot measurement queries live in
`docs/FOREVER_BOOTH_PILOT_SCORECARD.md` (+ `scripts/booth/pilot-summary.sql`): Quick vs
Full, completion step, valid-WhatsApp rate, 5-minute Guide contact, consultation
bookings, abandonment reasons. No conversion targets are invented anywhere.

## 15. Parallel pilot route and the Owner replacement action

`/booth-v2` ships alongside an untouched `/booth`; both are `noindex`, out of public
navigation and the sitemap, and build together without importing demo/staging data into
production bundles. **To replace `/booth` later (explicit Owner action, not part of this
task):** apply the migration to production, configure `BOOTH_WHATSAPP_NUMBER` (+
optionally `BOOTH_FX_RATES_JSON`, `BOOTH_ID`), enter real Guides into `booth_guides`,
verify the pilot on `/booth-v2`, then point `src/routes/booth.tsx` at `BoothV2Navigator`
(or delete the legacy shell) in a reviewed PR.

## 16. Testing strategy

- Pure-core suites: profile/FX/adapter/versioned parsing; state machine (flows, back
  navigation, shortlist 0–4 + fifth rejected, edit invalidation, completion gates,
  no-contact clearing, fail-closed deserialization, stale/finished-session privacy);
  directions (fail-closed dimensions, FX on/off, no fabricated trade-offs, typed
  unknowns, freshness); contact + consents; WhatsApp fail-closed config; Guide
  suggestion/blocks.
- Migration text contract: RLS + service_role-only grants, no policies on booth tables,
  leads policy untouched, shortlist/funnel/completion CHECKs, funnel vocabulary
  lockstep, no seeds, no phone numbers, no rates.
- UI suite: Quick flow → summary → directions → contact → verification → assignment →
  SLA timers → next step → truthful completion; consent enforcement; duplicate-submit
  guard; unconfigured-WhatsApp fail-closed; no-contact path; guarded reset privacy;
  once-only funnel events; archetype absence.
- Website regression: the untouched legacy suites (`navigator-core`, `session`,
  `matching`, `results-parity`, `shells`, lead-service, contact-form) all still pass,
  plus an explicit `validateLead` website-contract test.
- Real database: `npm run studio:pg-test` applies the full committed migration chain
  (including the booth migration) to a disposable PostgreSQL cluster.

## 17. Known legal-review items (not legal advice)

- The consultation-consent and marketing-opt-in wording, data-retention windows for
  `booth_sessions`, and the PDPA notices in the Host playbook are **drafts requiring
  review by qualified Thai counsel before production use**. Nothing in this record or
  the playbooks is legal advice.
- Cross-border transfer implications of storing guest contact data in the hosted
  Supabase region need confirmation.
- The wa.me deep-link flow sends a guest-initiated message to a company number; counsel
  should confirm no additional consent notice is required at the QR/poster.

## 18. Post-pilot boundary (explicitly NOT in this task)

WhatsApp Business API, automated marketing, external CRM, opaque AI recommendations,
recommendation scoring, automatic commission optimization, real staff seed records, a
real official phone number, production rollout — all deferred as post-pilot decisions.
