# FOREVER-BOOTH-ASSISTED-DECISION-001 — Architecture Record

Booth Mode 2.0: the **Forever Assisted Decision Concierge** (pilot build, under
architect review — see §0 for the corrective pass and what is still open).

- Base: `main` @ `a9d275fc678065ef70b331aee20f24f1c4f030e6` (PR #100 merge commit, verified merged).
- Branch: `claude/forever-booth-assisted-decision-001`.
- Research basis: «НЕЗАВИСИМОЕ ИССЛЕДОВАНИЕ — Оптимальная модель взаимодействия с гостем на бутсе», v1.0, 25 July 2026 (task brief used as the authoritative summary).
- Factory autonomy: **A0** (unchanged). Production: **untouched** — no deploy, no migration application, no production data access.

---

## 0. Corrective pass 1 (PR #102 architect review)

The first build shipped the product architecture but an unacceptable trust
boundary: the booth was treated as an anonymous kiosk while its server
functions used the service role. This pass corrects that and the related
data-integrity and profile-truth defects. **The pilot is not "ready" until the
architect re-review passes.**

| Defect                                                                  | Correction                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unauthenticated callers could reach service-role operations             | Every Booth server function now runs behind `requireBoothStaff`: Supabase JWT + an ACTIVE row in the existing `studio_members` staff roster. No second identity system; no self-registration or bootstrap path here.                                                                             |
| Client-supplied `hostLabel`                                             | Removed. Host identity is derived server-side from the authenticated account and stored as `booth_sessions.host_user_id` (FK to `auth.users`, NOT NULL).                                                                                                                                         |
| `/booth-v2` compiled and reachable; `noindex` treated as access control | Server-side, DEFAULT-DISABLED `BOOTH_V2_ENABLED`. Route and every endpoint are gated independently; a refusal renders the application's normal not-found boundary. The flag is never read from a client-visible `VITE_*` variable.                                                               |
| Guide data readable without authorization                               | `booth_guides` is service_role-only and is returned only to an authorized staff caller.                                                                                                                                                                                                          |
| Check-then-insert lead creation could duplicate on retry                | One `SECURITY DEFINER` RPC (`booth_save_contact_and_lead`) locks the session row and creates-or-returns exactly one lead; `booth_sessions.lead_id` is UNIQUE. Proven by a two-session concurrency probe and a mid-transaction rollback probe.                                                    |
| Weak database contact contract                                          | All-or-nothing contact bundle + phone/email/non-blank format checks, consent-before-contact, verified-WhatsApp evidence, assignment/acknowledgement/first-contact coherence and attribution, reserve ≠ primary, non-blank next step.                                                             |
| `consultation_scheduled_for TEXT` ("tomorrow" could complete a handoff) | `consultation_scheduled_at TIMESTAMPTZ` + `consultation_timezone`, validated at the boundary (real instant, not past, not implausible) and entered through a `datetime-local` control.                                                                                                           |
| Partial no-contact clearing in two updates                              | One transaction clears every personal and operational field, scrubs the profile language, DELETES any lead created for the session, and sets the outcome — backed by a database CHECK.                                                                                                           |
| Full flow never asked purchase purpose → silently "exploring"           | The Full flow DERIVES it deterministically from the confirmed NAV-001 answers (`derivePurchasePurpose`); Quick still asks it outright.                                                                                                                                                           |
| `preferredLanguage` always null in the confirmed profile                | Language is captured on its own screen BEFORE the Decision Summary, carried in the profile, mirrored read-only on the contact form, and re-checked server-side; a mismatch is rejected and the database enforces agreement.                                                                      |
| USD band thresholds reused as amounts in other currencies               | The booth now collects EXPLICIT numeric minimum/maximum plus currency, with "still exploring" as a first-class answer; the approved USD bands remain only in the legacy website adapter.                                                                                                         |
| Permissive profile parsing                                              | ONE canonical strict schema (`decisionProfileV2Schema`) used by both session hydration and the server: exact enum keys, no unknown keys, budget geometry, canonical-THB arithmetic + provenance, bounded strings/areas/payload, flow completeness.                                               |
| Silently truncated shortlists                                           | `validateShortlist` rejects a malformed shortlist whole (duplicates, blanks, over-long, >4, guide-prepares conflict); unknown project slugs are refused at the boundary; the database re-checks size and mode coherence.                                                                         |
| Client marked funnel events before the server confirmed                 | Transition events are emitted SERVER-SIDE inside the RPC that establishes the fact; the few client-observed events use acknowledgement-before-dedupe and stay retryable, with the DB uniqueness keeping them exactly-once.                                                                       |
| A Host click recorded as the Guide's acknowledgement                    | Acknowledgement and first contact record WHO and BY WHAT METHOD. `guide_self_confirmed` is only possible from the assigned Guide's own linked staff account (enforced in the RPC); anything else is stored and displayed as `host_observed` — "Observed by the Host — not a Guide confirmation". |

> Two claims made in corrective pass 1 did not survive verification and are
> corrected in pass 2 below: `booth_save_contact_and_lead` returned an existing
> lead **without updating it**, and the "single opaque denial" was defeated by
> the upstream Supabase-auth middleware, which throws its own descriptive errors
> before any Booth code runs.

---

## 0b. Corrective pass 2 (PR #102 architect re-review)

Pass 1's accepted corrections stand unchanged. This pass closes the remaining
consent, ownership, replay and terminal-state defects.

| Defect                                                                         | Correction                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The Decision Profile and shortlist were written **before** the guest consented | The consent boundary is now real. Before consent the server stores only the operational shell (client reference, authorized Host, booth id, flow mode, non-personal funnel events). The profile and shortlist stay in the tablet's versioned local session. `booth_commit_consent` is the ONE locked transaction that persists profile + shortlist + contact + consent + exactly one lead + funnel facts. Enforced by `booth_sessions_pre_consent_minimal`, so an application bug cannot write guest data early.                                                                   |
| `no_contact_qr` still left a detailed profile behind                           | **Strategy: clear-in-place** — the row is kept as an anonymous funnel shell and every guest-specific value is cleared atomically (profile, version, confirmation instant, flow mode, shortlist + mode, all contact fields, language, both consents, WhatsApp state and evidence, Guide assignment + reserve, every acknowledgement/first-contact actor and method, fallback reason, scheduled instant + timezone, next step) and any lead is DELETED and unlinked. What may remain: session identity, Host/booth attribution, timestamps, the outcome, non-personal funnel events. |
| Any active Studio member could operate the booth                               | New least-privilege capability `studio_members.can_access_booth` (NOT NULL DEFAULT FALSE) on the EXISTING roster — no second identity table, no seeds. Booth requires active membership **AND** the capability; activation for a real operator is a separate controlled staging action.                                                                                                                                                                                                                                                                                            |
| A valid staff account could mutate another Host's session via its `client_ref` | Every session RPC takes the acting account and refuses unless `booth_sessions.host_user_id` matches, inside the locked `SECURITY DEFINER` function (`booth_lock_owned_session`) — not only in TypeScript. `booth_ensure_session` is idempotent for the same Host and refuses a different Host deterministically; ownership is never transferred. The session's assigned Guide may perform **only** their own acknowledgement and their own first contact.                                                                                                                          |
| Contact corrections did not reach the linked lead                              | `booth_commit_consent` UPDATEs the linked lead on every accepted replay (name, email, phone, country, budget, interest, project mirror, summary), so session and lead can never drift. Exact replay returns the same lead with zero duplication; a vanished link is re-created rather than reported stale; partial failure rolls back both.                                                                                                                                                                                                                                        |
| A replaced WhatsApp number kept its old verification                           | A changed number resets the verification state/timestamp/method, clears the first-contact evidence and attribution tied to the old number, and deletes the `whatsapp_verified` / `guide_contacted` funnel events. `verified` is never carried over, so **completion is blocked until the replacement number is verified**. Truthful decision: the Guide assignment and an already-agreed consultation instant survive — they are facts about people and an appointment, not about the number.                                                                                      |
| Terminal sessions were still mutable                                           | `booth_sessions_freeze_terminal` (BEFORE UPDATE trigger) refuses ANY update to a session whose stored outcome is terminal — including a direct `service_role` statement. Every transition RPC also requires `outcome = 'active'`; the only accepted terminal calls are an exact idempotent replay of the established outcome (which writes nothing) and the documented read-mostly `booth_ensure_session`.                                                                                                                                                                         |
| Old-Guide evidence could complete a new assignment                             | A **genuine** reassignment (a different primary Guide) clears the acknowledgement, the first contact, the scheduled consultation and its timezone, the next step, and the corresponding funnel events, so they must be re-earned. Profile, contact, consent and a verified WhatsApp number are kept — they are still true. Changing only the reserve Guide is not a reassignment and resets nothing.                                                                                                                                                                               |
| The strict profile was not bound to derived truth                              | A confirmed profile must state a non-blank bounded `preferredLanguage`; `confirmedAt` must be strict RFC3339 with an explicit offset and a real calendar date (not merely `Date.parse`-able); a confirmed **Full** profile's `purchasePurpose` must equal `derivePurchasePurpose({motivations, goals})` and a divergent client value is rejected; **Quick** preserves the explicitly answered purpose. FX effective dates must be real days. One schema for hydration, transport, server validation and DB payload preparation.                                                    |
| `/booth-v2` showed a login form while the pilot was disabled                   | The gate asks the server for deployment enablement FIRST. While disabled, `/booth-v2` renders the ordinary not-found boundary for every visitor, signed out included — no Forever Booth login form. When enabled: signed-out sees sign-in, authenticated-without-capability sees not-found, authorized sees Booth V2. Every operational endpoint remains independently gated.                                                                                                                                                                                                      |
| Auth refusals were **not** actually opaque                                     | Verified against the real middleware order: chaining `requireSupabaseAuth` let its distinct messages (missing header, unsupported scheme, invalid token, missing Supabase configuration) escape before Booth code ran, and a downstream middleware cannot catch an upstream throw. Booth now verifies the request identity itself (`server/auth.ts`), performing the same checks inside one try/catch that normalizes **every** failure to `booth_access_denied`. The reason goes to the server log only.                                                                          |

**Remaining pilot limitations (documented, not defects):** the tablet is
operated by an authenticated Host on behalf of the guest, so guest-facing
screens carry no separate guest identity; Guide acknowledgement is truthful but
manual (no WhatsApp API); the flow mode is the one operational fact recorded
before consent (it is non-personal and is cleared on a no-contact outcome); and
the migration remains unapplied everywhere except the disposable local harness.

---

## 0c. Corrective pass 3 (PR #102 architect final review)

Passes 1 and 2 stand unchanged. This pass closes the remaining **runtime** and
**funnel-integrity** boundaries: the credential actually reaching the server, the
disabled route actually behaving like a missing one, the funnel actually
recording facts, and a refusal actually revealing nothing.

| Defect                                                                                              | Correction                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0** `requireBoothStaff` had only a `.server()` stage, so a signed-in Host's token never arrived  | The middleware now has a `.client()` transport stage of its own: it reads the browser session through the existing Supabase client (`getSession()`, which refreshes an expired session first) and attaches `Authorization: Bearer <access_token>` via `next({ headers })`. The token travels in that header **only** — never in function data, a query string, a log, custom storage, React state or an error message; any transport failure attaches nothing and stays silent so the server's single opaque denial is what the caller sees. The `.server()` stage still re-verifies the JWT from the inbound request on every call and derives the actor from the database, so attaching a token is never itself authorization. |
| **P1** `/booth-v2` matched, published Booth metadata and rendered the Gate before checking the flag | Enablement moved to the route load boundary. `beforeLoad` calls the server-only availability boundary and throws TanStack `notFound()` while the pilot is off; the router then caps head execution at the root not-found boundary and stops loading further matches. A disabled deployment therefore returns the repository's ordinary not-found response with **no** Booth title, description, font links, Loading state, sign-in form or client shell, and makes exactly one Booth call (the availability probe). `head` is additionally gated on this route's own loader data. `BoothV2Gate` no longer decides enablement at all — it handles authentication and authorization only.                                          |
| **P1** `boothV2RecordEvent` accepted the whole funnel vocabulary, so transitions were forgeable     | The vocabulary is split. Client-observed: `meaningful_conversation`, `profile_started`, `session_abandoned` — observations the tablet is the sole witness to, none asserting a transition. Everything else is server-only and emitted by the atomic RPC that establishes the fact (`profile_confirmed`→profile-confirmation, `whatsapp_verified`→WhatsApp, `guide_assigned`→assignment, `guide_acknowledged`→acknowledgement, `guide_contacted`/`consultation_booked`→handoff, `qr_continuation`→no-contact completion; `viewing_booked` is reserved and unemitted). Enforced independently at four layers: the TypeScript type, the endpoint's zod validator, the service allowlist, and `booth_record_event` itself.           |
| **P2** A foreign session answered differently from an unknown one, allowing enumeration             | `booth_session_not_found` and `booth_session_forbidden` now collapse to one wire response — code `booth_session_unavailable`, message "This booth session is unavailable." — so a valid staff caller cannot walk `client_ref`s to discover which ones belong to someone else. The database keeps its distinct internal exceptions (the PostgreSQL suite asserts against them) and the operational distinction is written to the sanitized server log only.                                                                                                                                                                                                                                                                       |

**Two client-side `qr_continuation` emissions were removed.** Declining the
opening permission is not a continuation, and the no-contact finish already goes
through `booth_complete_session`, which clears everything, deletes any lead and
emits the event in one transaction. The metric now records what happened rather
than what the browser claimed.

**How the transport claim is evidenced.** `booth-auth-transport.test.ts` stands up
a disposable local Supabase-compatible auth service on a throwaway loopback port
issuing **real** ES256 JWTs over a per-run P-256 keypair with a matching JWKS,
signs in with the repository's own browser client, and calls the gated function
through the **real** TanStack client transport (`createClientRpc` →
`serverFnFetcher` → `fetch`) across a **real** HTTP hop into the **real**
`requestHandler`, where the **real** `requireBoothStaff.server` stage verifies the
signature against the published key. It proves the header carries the session
token, the server resolves the right user, the session refreshes when expired,
and that a missing, malformed, expired, wrong-scheme or **foreign-key-signed**
token — and a valid token without the capability — all collapse to the identical
denial. `booth-route-ssr.test.tsx` renders real SSR output in a real server
environment and asserts the disabled `/booth-v2` markup is **byte-identical** to a
genuinely missing URL.

**Measured against a real running server** (`vite dev`, three separate runs):

| `BOOTH_V2_ENABLED` | HTTP status | `<title>` served                   | Booth head/fonts | 404 boundary |
| ------------------ | ----------- | ---------------------------------- | ---------------- | ------------ |
| unset (default)    | **404**     | Forever — Phuket Property Advisory | absent           | rendered     |
| `false`            | **404**     | Forever — Phuket Property Advisory | absent           | rendered     |
| `true`             | **200**     | Forever — Booth Mode 2.0 (Pilot)   | present          | not rendered |

**Known, accepted residual (reported, not hidden).** `notFound()` from
`beforeLoad` means the route _matches_ and then refuses, so TanStack Start's SSR
dehydration serializes a match entry for it. Verified on the real server: a
disabled `/booth-v2` and a missing URL return the same 404 and the same visible
document, but the former's hydration payload contains a match keyed on the route
id with status `notFound` while the latter carries only the root match. An
attacker reading that script can therefore learn that a route path `/booth-v2` is
**declared** — and nothing else: not the pilot's name, title, description, fonts
or purpose, not whether it is enabled, not whether they could reach it, and no
capability. Eliminating even this would mean not declaring the route at all,
which is a build-time decision rather than the runtime gate that was specified.
`booth-route-ssr.test.tsx` pins this residual explicitly so the equivalence claim
is never read as broader than it is.

**Documented environment limitation.** Docker was unavailable in this
environment, so the full local Supabase container stack could not be started;
the disposable auth service substitutes for its two auth surfaces, and the
service-role `studio_members` read is the single mocked boundary in that suite.
The authorization half is proven against a real database by
`npm run studio:pg-test`.

---

## 0d. Corrective pass 4 (PR #102 — Supabase auth-event re-entrancy)

Passes 1–3 stand unchanged. This pass closes one narrow **runtime lifecycle**
defect that none of the earlier boundaries could expose, because it is not about
what the Gate decides — it is about **when it asks**.

| Defect                                                                                               | Correction                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0** `BoothV2Gate`'s `onAuthStateChange` subscriber re-ran a check that opened with `getSession()` | supabase-js holds an internal lock while it emits an auth event and awaits its subscribers, so a Supabase API call from inside that callback — directly, or indirectly through a Booth server function whose client middleware calls `getSession()` to attach the Host's token — can deadlock the shared client. The work is now split. **Initial session discovery** runs once on mount, where a Supabase call is safe. The **authorized-access probe** (`boothV2GetAccess`) never runs inside the callback stack: the subscriber reads the session object Supabase supplies, decides synchronously, and hands the probe to a fresh macrotask via `setTimeout(…, 0)` — the documented workaround. The callback calls nothing and returns a non-thenable. |

**Why the tablet was actually exposed.** The deadlock window is reachable from
`SIGNED_IN` (every staff sign-in), `TOKEN_REFRESHED` (an idle tablet rotating its
token through the Booth function middleware), and `SIGNED_OUT` followed by a
rapid re-login. The symptom is a page stuck on `Loading…` with every subsequent
Supabase call hanging behind it — recoverable only by reloading the tablet.

**Three invariants sit around the deferral**, because deferring alone would
introduce races the synchronous version did not have:

- a **monotonic generation counter** — a probe applies its result only while its
  own generation is current, so a grant or a refusal that was already in flight
  when the Host signed out, or signed in as somebody else, is discarded instead
  of overwriting the newer state;
- a **per-identity guard** keyed on the user id and deliberately **not** on the
  access token — the token rotates on every `TOKEN_REFRESHED`, and keying on it
  would re-probe the gated endpoint on a timer for as long as a tablet stays
  signed in, and bounce the Host back to `Loading…` each time;
- **unmount cancellation** that also clears the scheduled timer, so a tablet that
  navigated away never reaches the gated endpoint at all.

**How the claim is evidenced.** `booth-auth-lifecycle.test.tsx` asserts on the
call **timeline**, not only the rendered outcome: every Supabase auth method and
the gated Booth function are instrumented with a "was the auth callback on the
stack?" flag, the subscriber is driven with the real supabase-js `(event,
session)` shape, timers are faked so "nothing ran during the callback" and "the
probe ran after it" are two separately observable moments, and the callback's
synchronous return value is asserted to be a non-thenable (supabase-js awaits
what a subscriber returns, so an `async` callback would resume inside the same
lock window). Verified negatively as well: against the pre-correction component,
**13 of the suite's 17 tests fail**.

**What this pass does not change.** The credential transport and server
verification are untouched — `boothV2GetAccess` still travels through
`requireBoothStaff`, which attaches the Host's own access token and has the
server re-verify the JWT from the inbound request. Deferring the call changes
when it is made, not what it proves; `booth-auth-transport.test.ts` is unmodified
and still passes in full. The opaque denial is preserved: every refusal, and
every stale or discarded result, still lands on the ordinary not-found boundary.

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
  `guide_acknowledged_at/_by/_method`, `guide_first_contact_at/_by/_method`,
  `consultation_scheduled_at` (TIMESTAMPTZ) + `consultation_timezone`, `next_step`,
  fallback reason, outcome, abandonment step/reason, `booth_id`, server-derived
  `host_user_id` (FK to `auth.users`, NOT NULL — the ownership anchor) + `host_email`,
  `lead_id` (human-readable mirror, UNIQUE), and a UNIQUE `client_ref` idempotency key.
  CHECKs enforce the **consent boundary** (`booth_sessions_pre_consent_minimal` —
  without the consultation consent the row may hold no profile, shortlist, language,
  contact data or lead), the all-or-nothing contact bundle, verified-has-evidence,
  acknowledgement/first-contact attribution, structured consultation instants, the
  contacted-completion gate, and total no-contact minimization.
- **Terminal immutability**: the `booth_sessions_freeze_terminal` BEFORE UPDATE trigger
  refuses any update to a session whose stored outcome is `contacted_complete`,
  `no_contact_qr` or `abandoned` — including a direct `service_role` statement.
- **Session ownership**: `booth_lock_owned_session(client_ref, actor, allow_assigned_guide)`
  locks the row and proves the caller owns it before any write, and every transition RPC
  goes through it. The assigned Guide's opt-in applies to exactly two functions
  (`booth_acknowledge_guide`, `booth_record_handoff`) and only for their own
  acknowledgement and their own first contact.
- `public.studio_members.can_access_booth` (NOT NULL DEFAULT FALSE) — the explicit
  least-privilege Booth capability added to the existing staff roster. Additive only;
  Studio never reads it and no row is granted it by this migration.
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

Endpoints, grouped by what they may persist:

- **Ungated, and the only one** — `getRouteAvailability`: a single boolean saying
  whether this deployment enabled the pilot. No session, no database read, no actor,
  and no Booth-attached credential. It is called from the route's `beforeLoad`, which
  throws `notFound()` while the pilot is off, so a disabled deployment returns the
  ordinary not-found response to every visitor before any Booth metadata or markup is
  produced (§0c, P1).
- **Gated, non-persisting** — `getAccess`, `getConfig`, `listGuides`,
  `markProfileConfirmed` (re-runs the canonical strict parser server-side and records
  only the flow mode + the non-personal `profile_confirmed` funnel fact),
  `validateShortlist` (bounds + real-project check, stores nothing).
- **Gated, the consent transaction** — `commitConsent`: the FIRST and ONLY write of
  anything about the guest. Profile + shortlist + contact bundle + consent + exactly
  one lead, in one locked transaction; every accepted replay refreshes the linked lead.
- **Gated, post-consent operations** — `ensureSession`, `recordEvent` (**client-observed
  events only**: the three observations the tablet is the sole witness to; every
  transition event is emitted by the RPC that establishes the fact — §0c, P1),
  start/confirm WhatsApp verification, `assignGuide`, `acknowledgeGuide`,
  `recordHandoff`, `completeSession` (server-side gate + DB CHECK + terminal-freeze
  trigger backstop).

Retries are idempotent via `client_ref` upserts and the funnel uniqueness constraint,
and every session RPC additionally proves the caller owns the session. A refusal on
ownership or existence returns ONE non-descriptive answer
(`booth_session_unavailable`, "This booth session is unavailable."), so a valid staff
caller cannot enumerate other Hosts' sessions; the distinction is logged server-side
only (§0c, P2). The dev/demo no-write mode (`VITE_PARTNER_DEMO` /
`VITE_DEMO_LEAD_MODE`) short-circuits before any database access, mirroring the
lead-service rule.

The booth tablet is operated by an AUTHENTICATED Host, and `booth-auth.ts` owns **both
halves** of that:

- `.client()` — the browser attaches the Host's own Supabase access token as
  `Authorization: Bearer <access_token>` through `next({ headers })`, reading it via
  `getSession()` (which refreshes an expired session first). The token exists nowhere
  else: not in function data, a query string, a log, custom storage, React state or an
  error message. Any transport failure attaches nothing and stays silent.
- `.server()` — the JWT is re-verified from the inbound request on every call
  (`server/auth.ts`) rather than chaining the shared Supabase-auth middleware, whose
  distinct errors could not be normalized, and the actor is then required to hold an
  active `studio_members` row plus the explicit `can_access_booth` capability. Attaching
  a token is never itself authorization.

Every refusal — missing header, wrong scheme, malformed, expired or foreign-key-signed
token, non-member, inactive member, missing capability, disabled pilot — collapses to
the single `booth_access_denied`; the reason is logged server-side only. Host identity
is a real authenticated credential and is the ownership anchor for every session
transition.

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
(client dedupe + DB UNIQUE), **split by who may establish them**. Only three are
client-observed (`meaningful_conversation`, `profile_started`,
`session_abandoned`) and only those three are reachable through
`boothV2RecordEvent` / `booth_record_event`; every fact-establishing transition
event is emitted by the atomic RPC that performs the transition, so the
scorecard's transition counts cannot be inflated by the browser (see §0c).
Abandonment records step + reason only — no conversation
content, no device metadata, no external analytics. Pilot measurement queries live in
`docs/FOREVER_BOOTH_PILOT_SCORECARD.md` (+ `scripts/booth/pilot-summary.sql`): Quick vs
Full, completion step, valid-WhatsApp rate, 5-minute Guide contact, consultation
bookings, abandonment reasons. No conversion targets are invented anywhere.

## 15. Parallel pilot route and the Owner replacement action

`/booth-v2` ships alongside an untouched `/booth`; both are `noindex`, out of public
navigation and the sitemap, and build together without importing demo/staging data into
production bundles.

**While `BOOTH_V2_ENABLED` is not exactly `"true"` (the default), `/booth-v2` does not
behave like a hidden page — it behaves like a missing one.** The route's `beforeLoad`
throws `notFound()` before rendering, so the response is HTTP 404 carrying the
repository's ordinary not-found boundary with no Booth title, description, font links,
Loading state, staff sign-in form or client shell, and the rendered document is
byte-identical to a genuinely unknown URL. The same gate runs on direct SSR requests and
on in-app navigation. One residual remains and is documented in §0c: the SSR hydration
payload still shows that a route path `/booth-v2` is declared, though nothing about the
pilot itself. `noindex` remains as a second line of defence, not as the mechanism.

**To replace `/booth` later (explicit Owner action, not part of this
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
- **Real credential transport** (`booth-auth-transport.test.ts`): a disposable local
  Supabase-compatible auth service issuing real ES256 JWTs + JWKS, a real sign-in through
  the repository's browser client, the real TanStack client RPC path, a real HTTP hop, and
  the real server middleware verifying the real signature. Proves the header carries the
  token, the server resolves the right user, expired sessions refresh, the public probe
  carries no credential, and every failure mode (missing / malformed / wrong scheme /
  expired / foreign-key-signed / valid-but-uncapable / inactive / non-member / pilot
  disabled) produces one identical denial with no token in any log.
- **Real SSR route boundary** (`booth-route-ssr.test.tsx`): a real server environment and
  real `renderToString` output through the route's own options; the disabled
  `/booth-v2` markup is byte-identical to a genuinely missing URL, publishes no Booth
  head, runs no loader, and makes exactly one Booth call. The suite also pins the one
  known residual (the dehydrated match entry) so the equivalence claim stays honest.
- **Real running server** (manual, three runs of `vite dev`): HTTP 404 + the ordinary
  title with the flag unset and with it `false`; HTTP 200 + the Booth head with it
  `true`. Recorded in §0c.
- **Funnel integrity** (`booth-funnel-integrity.test.ts`): the client-observed subset is
  disjoint from the server-only set, the endpoint's real zod schema and the service
  allowlist both refuse every transition event with zero database work, and an unknown vs
  foreign session refusal is indistinguishable on the wire.
- Real database: `npm run studio:pg-test` applies the full committed migration chain
  (including the booth migration) to a disposable PostgreSQL cluster. It additionally
  proves `booth_record_event` refuses every transition event **before inserting
  anything**, even for a direct `service_role` caller that has bypassed all three
  application layers, while the legitimate atomic RPCs still emit those events.

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
