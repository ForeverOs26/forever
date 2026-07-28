# Forever CRM — 2026 Market and Compliance Research

Status: Proposed — research input to the FOREVER-CRM-ARCH-001 architecture package. Not a build order.
Last updated: 2026-07-28
Task ID: FOREVER-CRM-ARCH-001

**This document authorizes nothing.** It is research and analysis only. No implementation, migration, schema
change, vendor contract, integration, or data processing is approved, active, or scheduled by anything written
here. The Factory remains at **A0 — Propose only**. Every SQL fragment below is illustrative and is explicitly
not a migration. Section 5 is **architecture research, not legal advice**.

---

## 1. Method and epistemic warning

### 1.1 How this research was done

| Aspect | Statement |
|---|---|
| Research date | **2026-07-28**. Every time-sensitive fact below has that as its as-of date. |
| Source preference | Primary sources first: vendor API references and help centres, regulator texts, RFCs, PostgreSQL manual. Secondary commentary used only where no primary source exists, and labelled. |
| Source classification | Every entry in the register (§10) is tagged `official_vendor_doc`, `official_regulator`, `industry_report`, or `secondary`. |
| What was deliberately *not* done | No feature checklists. A competitor shipping a feature is evidence about that competitor's customers, not about Forever. Only patterns with a stated mechanism and a documented failure mode were extracted. |
| Bias correction applied | Where a claim originates with a company that sells the remedy for the problem the claim describes, that is stated inline. This applies to almost the entire speed-to-lead literature (§4). |

`[Inference]` The most useful evidence in this research is not what vendors advertise. It is what their **API
contracts and help-centre troubleshooting pages concede** — the constraints, the cascade deletes, the "this
cannot be undone" notes. Marketing pages repeat each other; reference documentation has to be true.

### 1.2 What could not be verified — stated plainly

`[Unverified assumption]` The following were searched for and **not found**, or found only in a form too weak to
rely on. Nothing in the architecture may assume these resolve favourably.

| # | Claim / question | Status |
|---|---|---|
| U1 | A published **Thai adequacy allowlist** under PDPA s28 | None found as of 2026-07-28. `[LAWYER]` |
| U2 | Thai statutory ePrivacy-equivalent "prior consent for commercial email" rule | Could not be verified. `[LAWYER]` |
| U3 | The English PDPA text used is an **unofficial translation**; the PDPC consent guideline was read through a machine translation of a Thai PDF | Section numbers and thresholds must be checked against the Thai text before reliance. `[LAWYER]` |
| U4 | WhatsApp per-message rates effective 1 Oct 2026 | **Not knowable today.** Meta states rates will only be published by 1 Sep 2026. |
| U5 | Meta webhook retry duration | Two Meta primary pages **conflict**: the generic Graph API webhooks page implies ~36 hours, the WhatsApp-specific webhooks page says up to 7 days. Design must survive either. |
| U6 | `supa_audit` availability on the Supabase managed platform | Could not be confirmed from Supabase docs. A hand-rolled trigger audit is the fallback. |
| U7 | The `language sql` inlining hazard that reintroduces RLS recursion | **Community-documented only**, not stated in official Postgres or Supabase docs. Treated as a cheap precaution, not a proven rule. |
| U8 | Multi-currency support in Spark, Follow Up Boss or Lofty | No public documentation found. Absence of evidence in vendor docs, not proof of absence in product. |
| U9 | Language-based lead routing in any examined real-estate CRM | Not documented anywhere. |
| U10 | Viewing feedback automatically re-scoring or re-matching inventory, in any examined system | Not documented anywhere. |
| U11 | "78% of customers buy from the first business to respond" | **No traceable primary source.** Searching returns social posts and marketing blogs only. |
| U12 | Propertybase forward roadmap or end-of-life position under Lone Wolf | No primary vendor statement found. Only the 2021 acquisition press release. |
| U13 | Whether Lofty reassignment-group distribution can be automated | Two Lofty help articles contradict each other. |
| U14 | Russian regulatory action against WhatsApp | Secondary news reporting only; no primary regulator document obtained. |
| U15 | Whether Forever is on Google Workspace | Unknown. The single cheapest email/calendar unlock (§6.6) depends entirely on this. Needs an Owner answer. |

`[Repository fact]` One further verification limit specific to this repository: **there is no CI**
(no `.github/workflows` directory exists). No claim in this package may assert that a gate, test or check
"passes". Only locally executed commands can be reported, and this document ran none.

---

## 2. General CRM architecture patterns

### 2.1 The finding that matters: the industry abandoned Lead-as-parallel-identity, and only the API contracts say so

`[Web research]` Five general-purpose CRMs were examined. Three of them — HubSpot, Pipedrive, Attio — have
independently converged on **durable Person identity + episodic work item**. None of them market this as a
position. All three encode it in their object contracts, where it cannot be softened.

| Vendor | Documented evidence | What it proves | Source |
|---|---|---|---|
| **HubSpot** | Re-introduced a Leads object (`objectTypeId 0-136`), but the guide states a lead **"Must be associated with an existing contact"**, and **"If you remove all primary associations to the lead, the lead will automatically be deleted"** | The lead has **no independent existence**. It is a dependent child of the Contact. Cascade-delete on de-association is the strongest possible statement of that. | official_vendor_doc — developers.hubspot.com leads guide |
| **Pipedrive** | **"A lead always has to be linked to a person or an organization or both"**; `person_id` required unless `organization_id` given; leads have no own custom fields — they **inherit the Deal field structure** | A Pipedrive lead is literally a **pre-pipeline deal**, not an identity. | official_vendor_doc — developers.pipedrive.com/docs/api/v1/Leads |
| **Attio** | **No Lead object exists.** Objects are People, Companies, Deals (+ Users, Workspaces). Process is modelled as *Lists*, whose **entries** carry list-scoped attributes such as Stage and Owner | The most complete form of the pattern: process state lives on the *participation*, not on the person. | official_vendor_doc — docs.attio.com/docs/objects-and-lists |
| **Salesforce** | Retains a separate Lead requiring `convertLead()`. The converted Lead **"becomes a read-only record"**; conversion **cannot be undone**; shared activities re-parent to Account/Contact/Opportunity but **"If one of these activities is deleted from any of the resulting records, Salesforce will also remove it from the other records"** | The legacy model, with its scar tissue documented by the vendor. | official_vendor_doc — help.salesforce.com FAQ + developer.salesforce.com convertLead |
| **Zoho** | Ships a **Lead Conversion Options API** in V8 whose stated purpose is to "identify existing records in Contacts, Accounts, and Deals that match the lead's data before conversion… This helps prevent duplicate records" | A vendor documenting, in its own API reference, that **its lead model manufactures duplicates** and needs a dedicated API to mitigate them. | official_vendor_doc — zoho.com/crm/developer/docs/api/v8/convert-lead.html |

`[Recommendation]` **Adopt the convergence.** This is the single highest-leverage structural decision available
and it is consistent with **D1** of the binding decision brief: `crm_contact` is the person spine;
`public.leads` stays the append-only enquiry/intake event log with a nullable `contact_id`.

> **Architect challenge — recorded, not acted on.** `[Web research]` The general-CRM research recommended the
> episodic row carry a **`NOT NULL` FK to the person**. That is correct for a *promoted* work item and wrong for
> a *raw intake log*: an unvetted inbound cannot always be resolved to a person at insert time, and forcing it
> would either block intake or force premature identity guesses. D1's **nullable** `contact_id` on `leads` is the
> right call, provided a separate promoted work item carries the non-null FK. The trade-off is that "unresolved
> intake" becomes a real state that needs a queue, not an error.

### 2.2 Unified timeline

`[Web research]` HubSpot types activities as separate standard objects (Calls `0-48`, Emails `0-49`, Meetings
`0-47`, Notes `0-46`, Tasks `0-27`, Postal mail `0-116`) and the timeline is a **union over associations**.
Critically, HubSpot needed to add a **distinct Communications object (`0-18`)** purely to accommodate
WhatsApp/SMS/LinkedIn. Attio's record page exposes Activity as "a timeline of interactions and updates".
(official_vendor_doc — developers.hubspot.com understanding-the-crm; attio.com create-and-view-records)

`[Inference]` HubSpot needing a *second* activity object for messaging is direct evidence that an
**email-shaped activity model breaks on messaging channels**. Forever's channel mix is messaging-first from day
one, so the email-shaped model would break immediately.

`[Recommendation]` One append-only activity/event table with a `channel` enum that includes messaging as a
first-class value from the start, plus `direction`, plus nullable FKs to both person and work item. Do not add
messaging later; adding it later is what forced HubSpot's second object.

### 2.3 Pipeline and stage design

| Design | Evidence | Verdict |
|---|---|---|
| Stage on the **join row** (list entry), so one record can sit in several processes at once | Attio: list attributes such as Stage and Owner "exist only within a list" yet stay connected to the record (official_vendor_doc — attio.com understanding-attio-data-model) | `[Recommendation]` **Adapt.** Structure for it; keep a `pipeline_id` and a stages table so a second process is configuration, not migration. |
| Per-stage / per-pipeline **required fields** | Pipedrive `DealFields` carry `pipeline_ids` and `stage_ids`; required stages must be in pipelines where the field is visible (official_vendor_doc — developers.pipedrive.com DealFields) | `[Recommendation]` **Adapt.** Keep the capture form ~3 fields; require budget/unit-type/timeline only to advance past qualified. Demanding everything at intake is the most reliable way to make a small team stop using the CRM. |
| Stage **probability** → weighted pipeline value | Pipedrive: stage probability **defaults to 100%**; deal probability always overrides stage probability (official_vendor_doc — support.pipedrive.com probability-in-pipedrive) | `[Recommendation]` **Defer/Reject.** An unconfigured pipeline silently reports weighted value = total value. At Forever's concurrent-deal count a weighted forecast is statistical theatre. |
| Idle-time **"rotting"** as the staleness signal | Pipedrive's own KB: "The rotting feature disregards the next activity date, so any deal with an activity scheduled far into the future can still go rotten" (official_vendor_doc — support.pipedrive.com the-rotting-feature) | `[Recommendation]` **Reject as the primary mechanism.** Rotting measures *recent touching*, not *committed next step*, and an invisible email action resets it. Use an explicit next action instead (§2.5). |

`[Repository fact]` `docs/ROADMAP.md:141` already names the intended funnel — "new → contacted → qualified →
viewing → reserved → closed/lost" — which is wider than the shipped
`status CHECK IN ('new','contacted','qualified','closed','spam')` in
`supabase/migrations/20260704132000_create_leads.sql`. The stage vocabulary is therefore inherited, not invented.

### 2.4 Identity resolution and deduplication

`[Web research]` HubSpot auto-dedupes **contacts by Email** and **companies by domain**, with up to ten custom
unique-value properties as escape hatches. Its own documentation concedes two holes:

- companies created **through the API are not deduplicated** by domain (which includes third-party sync apps);
- unique-value properties are **"Not supported in forms"**.

(official_vendor_doc — knowledge.hubspot.com/records/deduplication-of-records)

`[Inference]` Those two exceptions are precisely the **two highest-volume intake routes**. A dedupe guarantee
that does not hold on forms and API writes is not a guarantee; it is a default.

`[Recommendation]` Two conclusions, both matching §4 of the decision brief:
1. **Dedup must be a database constraint, not an application rule** — a UNIQUE index on
   `(kind, normalized_value)` in the contact-method table holds regardless of which code path writes.
2. **Key on normalised E.164 phone, not email.** HubSpot's email-primary model is a B2B-SaaS artefact. Forever's
   buyers arrive by WhatsApp/Telegram/phone where email is frequently absent, disposable or mistyped.

`[Repository fact]` Today there is **no unique constraint on any identity field** — `idx_leads_email` is a plain
non-unique btree (`supabase/migrations/20260704132000_create_leads.sql`). Deduplication is currently zero, not
weak.

### 2.5 Task and next-action

`[Recommendation]` Enforce a **next action on every open work item at the database layer** (a CHECK or trigger
conditioned on the item being open). This is stronger than anything the five vendors ship, and it is the correct
reading of the rotting evidence in §2.3: vendors measure staleness because they *cannot* require a next step
across heterogeneous customers. Forever can, because it has one process.

`[Web research]` The complementary metric: store `first_response_at` and report the **median by source**, never
the mean. `[Inference]` One lead answered three days late destroys a mean and leaves a median honest.

`[Repository fact]` This is also the repository's own stated exit criterion: `docs/ROADMAP.md:148` — "median
response time is measured and improving". Nothing currently measures it, because nothing reads a lead back at all.

### 2.6 Permissions models and their complexity cost

`[Web research]` Salesforce's layered model is org-wide defaults (Private / Public Read Only / Public
Read/Write) → role hierarchy → sharing rules → manual/team shares → field-level security. Two vendor admissions
are decisive:

- Salesforce's own architecture guidance caps the role hierarchy at **"no more than 10 levels of branches"**, and
  its Platform Sharing Architecture guide ships a **Troubleshooting section** premised on nobody being able to
  work out why a record is visible. (official_vendor_doc — architect.salesforce.com platform-sharing-architecture)
- The stated business rationale for making Leads private is **"so that there's no potential for internal
  competition"**. (official_vendor_doc — help.salesforce.com security_sharing_owd_about)

`[Inference]` That rationale is an artefact of large commissioned sales floors. At a 5–15 agent brokerage where
two locations and multiple timezones cover for each other, engineering *against* mutual visibility is actively
harmful — and it is exactly the political dynamic the Owner/Assignee split (§3.4) is meant to defuse without
row-level hiding.

`[Web research]` Attio draws the sensitivity boundary in a different and better place: **around communication
content**, not around record rows — three email-sharing settings on sync, plus per-user inbox access and
per-email controls. This is a response to Attio's own documented behaviour that inbox sync "will automatically
create People and Company records for every person and company you've ever interacted with".
(official_vendor_doc — attio.com syncing-people-and-companies)

`[Recommendation]` **Reject** record-level visibility restrictions, role hierarchy and field-level security.
**Adapt** the Attio insight: if any sensitivity boundary is ever needed, draw it around message bodies and
exports, not around who may see which contact.

### 2.7 Automation engines and their documented failure modes

`[Web research]` HubSpot's re-enrolment documentation is the most valuable single automation source found,
because the documented behaviour *is* the documented failure mode:

- **"When a record is re-enrolled in a workflow, they will start the workflow again from the beginning and
  complete all workflow actions again (e.g., receiving any automated emails)"** — re-enrolment **replays every
  action from the start**, which is how customers get double-emailed.
- Date and count refinements **silently stop applying** on re-enrolment.
- Re-enrolment triggers are configured separately from enrolment triggers, with up to 250 enrolment triggers.

(official_vendor_doc — knowledge.hubspot.com/workflows/add-re-enrollment-triggers-to-a-workflow)

`[Recommendation]` **Defer any workflow/automation engine.** Four interacting non-obvious rules is a surface a
team of Forever's size will not maintain. Build one deterministic thing first — a durable, swept notification
when an enquiry arrives and when a next action goes overdue — and instrument before automating. Study the
re-enrolment semantics *before* building, because they are the specification for idempotency that would
otherwise take a year of production bugs to derive (see also §3.7 for Follow Up Boss's version of the same list).

### 2.8 Mobile home-screen design

`[Web research]` Salesforce's mobile "Today" page composition: the next event and today's events **pulled from
the phone's own calendars**, today's Salesforce tasks, and recently viewed records.
(official_vendor_doc — help.salesforce.com salesforce_app_today)

`[Inference]` The non-obvious detail worth copying is the calendar source: the rep's real schedule is **not
fully inside the CRM**, and a home screen that pretends otherwise is wrong before it renders. The design answer
is a **time-boxed day agenda, not a database browser**.

`[Recommendation]` One mobile-responsive "Today" route. Overdue and due-today next actions, the next
appointment, recently touched records. At most one chart. `[Repository fact]` The Studio UI shell already exists
as the reference authenticated mobile screen, and `table`, `dialog`, `drawer`, `form`, `calendar`, `chart` and
`sonner` shadcn components are installed but unused — so this costs no new dependency and no 24-hour
`minimumReleaseAge` delay.

---

## 3. Real-estate and off-plan brokerage patterns

Products examined: Follow Up Boss, Lofty, Spark, Reapit Foundations, iamproperty CRM, Kommo, Propertybase.

### 3.1 What these products do NOT document — report this first

`[Web research]` The negatives are more decision-relevant than the positives, because each one is a thing
Forever would otherwise assume it could buy or copy.

| Gap | Evidence | Consequence for Forever |
|---|---|---|
| **Language-based routing** | Follow Up Boss's advanced lead-flow criteria are exactly seven: Tags, Price, City, State, ZIP Code, MLS Number, Phone Number. Lofty routes on source, location/ZIP and similar. (official_vendor_doc — help.followupboss.com advanced lead flow rules) | RU/EN routing is a **bolt-on tag** in every product examined. Forever must model `preferred_language` as a first-class routing input itself. |
| **Multi-currency** | No documented support found in Spark, Follow Up Boss or Lofty public docs. `[Unverified assumption]` — absence in docs, not proof of absence in product. | These are North-America-centric products. A Phuket brokerage quoting THB against RUB/EUR/USD buyer budgets **must build it**: store `(amount_minor bigint, currency char(3))` and capture `fx_rate` + `rate_date` at quote time so a quote reproduces months later. |
| **Feedback → matching loop** | No documentation in Spark, Reapit, iamproperty, Follow Up Boss or Lofty describing viewing feedback re-scoring or re-matching inventory. | A genuine build opportunity — **and therefore an unproven one**. Do not assume it works because nobody has shipped it. |
| **Time-based dormancy reclaim** | Follow Up Boss's own Lead Ponds FAQ answers "Can I add an automation trigger to automatically place a lead in a Pond after X amount of time?" with **no**. Its automation triggers are all event-based. (official_vendor_doc — help.followupboss.com Lead Ponds Overview) | Auto-reclaim of stale leads on a calendar is **largely folklore**. In these products it is a manual smart-list exercise. This is the evidentiary core of §3.5. |
| **Propertybase's current direction** | Only a 2021 Lone Wolf acquisition press release. No primary end-of-life notice, no forward roadmap. (secondary — prnewswire) | Do not adopt a Salesforce-based enterprise product as the reference architecture for a 15-person team. |

### 3.2 Acknowledgement with a hard-capped claim window and a bounded fallback chain

`[Web research]` Follow Up Boss's First-to-Claim is the most precisely specified pattern found:

- agents are alerted; **first to claim wins**;
- the unclaimed window is **capped at a maximum of 30 minutes**, stated as being "to ensure timely automated
  communication";
- **at most two fallback groups** can be chained;
- after the second, the lead is **hard-assigned to the account owner** — so a lead can never end unowned;
- every fallback action is written to the **lead timeline**.

(official_vendor_doc — help.followupboss.com First-to-Claim)

`[Web research]` The vendor also documents the failure mode: claim notifications are **push-only** (never email
or text), and **swiping rather than tapping** the notification can clear it and prevent claiming.

`[Recommendation]` **Adopt**, with two adaptations. (a) The 30-minute ceiling is a vendor design decision, not a
suggestion — it encodes that hours-scale silence is unacceptable. Any Forever design offering a multi-hour hold
is out of line with the only documented benchmark. (b) Pure first-to-claim is **not fair** on its own, because
the notification channel is the weak link; pair it with a bounded chain that terminates at a **named human**.

`[Repository fact]` **Honest consequence Forever must state.** Per **D5**, the Cloudflare cron trigger runs
`*/5 * * * *`. The 5-minute tick is a **floor**. Acknowledgement and contact timestamps are measurable to the
second because they are stored, but **escalation fires at ≤5-minute resolution**. Forever must not promise
2-minute escalation on this runtime, and every SLA number must be a configurable policy row, never hard-coded UI
text.

### 3.3 Ordered first-match-wins routing with a mandatory default and a routing log

`[Web research]` Lofty's routing model: an ordered rule list evaluated top-to-bottom, **first match wins and
stops evaluation**, organised most-specific → most-general, with a **mandatory catch-all default** at the
bottom, plus **routing logs** showing which rule applied and why a lead matched or did not.
(official_vendor_doc — help.lofty.com lead-routing-rules)

`[Recommendation]` **Adopt in full.** Deterministic and debuggable; the default guarantees total coverage.
`[Inference]` The routing log is disproportionately valuable at 5–15 agents because **the CRM's real political
function at that size is settling arguments about who got which lead** — which is exactly what **D4** requires:
every routing, assignment and reclaim decision writes a `routing_log` row.

`[Web research]` The conditions Forever actually needs — language (ru/en), Phuket sub-district, price band,
source, off-plan vs resale, developer/project — are **not natively routable in any examined system** (§3.1).

`[Web research]` **Reject Kommo's Round Robin** as a distribution mechanism. It is a Salesbot *step rotation*
(2–100 options) whose documented reset conditions are: 30 days of non-use resets the distribution, adding or
deleting an option resets it, and internal cache resets reset it. (official_vendor_doc — support.kommo.com
round-robin-in-salesbot-overview) `[Inference]` That is rotation state held in a cache. Fairness state must be
durable rows.

`[Web research]` Lofty's **weighted allocation** is worth knowing even if not adopted: each assignee has an
*allocation*; *hunger* starts equal to allocation; after a claim, `new hunger = (hunger − 1) ÷ allocation`;
first lead in a cycle goes left-to-right; ties break leftmost. (official_vendor_doc — help.lofty.com In-Depth
Round Robin & Next Up) `[Recommendation]` **Defer.** Publishing the formula is what makes unequal capacity
defensible to agents — but at 5–15 agents with one process, naive rotation plus the routing log is enough. Note
the operational trap either way: **editing a round-robin rule resets the rotation**, while editing a
reassignment group deliberately does not.

### 3.4 Working-hours and away gating

`[Web research]` Lofty gates routing on **per-agent working hours and vacation mode**; rules will not distribute
to unavailable agents, and if all agents in a rule are unavailable the lead **falls through to the next rule**
and then the default. Rules themselves also carry working hours.
(official_vendor_doc — help.lofty.com lead-routing-rules)

`[Web research]` Spark takes the complementary approach: round-robin auto-assignment requires **per-user
opt-in** — a team member must switch auto-assign on to be in the rotation at all.
(official_vendor_doc — knowledge.spark.re registration-form-settings)

`[Inference]` This matters more for Forever than for any US product. Agents are UTC+7; clients are UTC+2 to
UTC+4. **A 20:00 Moscow enquiry is 00:00 in Phuket.** Without availability as a routing input, round-robin
cheerfully assigns 02:00 leads to sleeping agents and the SLA clock runs against nobody.

`[Recommendation]` **Adopt**, evaluated in `Asia/Bangkok`, with fall-through to the next rule then the default,
and with **self-service opt-out** (Spark's model) rather than admin rule-rebuilding. Forever must decide
explicitly and in writing what "acknowledged" means at 02:00 local — the honest options are an automated
acknowledgement with a stated human-contact window, or a named on-call rotation. Do not leave it implicit.

### 3.5 Owner vs Assignee — and the 21-day rule

`[Web research]` Lofty separates the two cleanly: **Owner** records how the lead entered the system and controls
delete/merge/export rights; **Assignee** is who is responsible for working it and is what appears on outgoing
communication. Ownership has scope levels (Company / Office-Team / Personal), and there is a global toggle to
force company-owned-only. (official_vendor_doc — help.lofty.com Lead Ownership)

`[Inference]` The existence of a "hide all the complexity" global toggle is itself evidence that ownership
modelling is a burden most teams should not carry in full.

`[Recommendation]` **Adopt the split.** Reassignment changes the assignee and **never** the owner. This decouples
**credit** from **workload**, which is the honest resolution of hoarding: an agent who stops working a lead
loses the work, not the credit — so there is no reason to hold on.

> **Where the repository evidence contradicts an Owner-supplied requirement.**
>
> `[Owner requirement]` "Ownership lasts 21 days; on reactivation the lead returns to the original agent."
>
> `[Web research]` **No vendor documentation and no industry-body standard for this rule was found.** The
> documented primitives are ownership *scope*, claim windows measured in *minutes*, and *manual* reassignment.
> Follow Up Boss's own FAQ answers the closest question — automatic movement to a pond after X time — with **no**.
>
> `[Inference]` **Consequence if implemented as stated:** a calendar lock creates a hoarding incentive. An agent
> who does nothing for twenty days still holds the lead on day twenty. The rule rewards the exact behaviour it
> was presumably introduced to prevent, and it is unenforceable against the buyer, who does not know or care
> which agent "owns" them.
>
> `[Recommendation]` **Recommended alternative (this is D4, and it is binding):** model ownership as **permanent
> credit**, and drive reclaim off **activity, not the calendar** — no logged contact attempt within N hours
> returns the lead to the pond. Implement the 21-day rule as a **configurable, versioned policy row** so the
> Owner may retain it, but ship the default activity-driven. Record the trade-off in the policy row itself so the
> choice is visible rather than folkloric.

### 3.6 Ponds

`[Web research]` Follow Up Boss and Lofty both ship a shared unclaimed pool. The mechanically interesting part
is the **pond lead acting as a pseudo-agent** for notifications, action plans and third-party integrations; pond
records are excluded from list API queries unless `includePonds=1`.
(official_vendor_doc — help.followupboss.com Lead Ponds Overview)

`[Recommendation]` **Adapt.** The pseudo-agent device solves a real problem — automations and integrations need
*some* human identity to act as — but at Forever's size a pond is better modelled as an **assignment state**
(unassigned + a named fallback human) than as a synthetic user account. The API-exclusion default is a warning
worth heeding: a pool that is invisible by default is a pool that silently accumulates.

### 3.7 Action plans: enumerated pause conditions, volume caps, idempotency

`[Web research]` This is where vendor documentation is unusually generous, and every item reads like a scar from
a production incident.

**Pause conditions — enumerated, never vague:**

| Product | Documented pause conditions |
|---|---|
| Follow Up Boss | contact replies by **email**; contact replies by **text**; a call lasting **more than 2.5 minutes** — the threshold exists specifically so short calls and **voicemails do not pause the plan** (official_vendor_doc — help.followupboss.com Action Plans Overview) |
| Lofty | six conditions: lead responds/reaches out (email, call, text, or replying to the AI); lead added to a Segment; an outbound call logged as "talked"; pipeline stage changes; the tags that triggered the plan are deleted; the lead's source changes (official_vendor_doc — help.lofty.com Smart Plan Builder) |

**Volume caps and unsubscribe plumbing** (Follow Up Boss): a maximum of **4 action-plan emails per day**; every
action-plan email carries an automatic unsubscribe link; unsubscribing auto-tags the contact and blocks all
future *marketing* email **while 1:1 individual email still sends**.

**Idempotency and re-entry rules** (Follow Up Boss Automations):

- plan already running → **nothing happens**;
- already paused → **stays paused**;
- completed and never previously started by an automation → **restarts from the beginning**;
- a **5-minute minimum gap** between automations applying the same plan to the same lead;
- a buffer stops any automation firing **more than 100 times at once**;
- automations **do not fire on new leads at all** (imports, manual adds, web leads) — new-lead automation belongs
  to the lead-flow layer;
- **mass actions never trigger automations**.

`[Web research]` Spark documents the counter-pattern to avoid: re-applying a follow-up schedule **"will override
any previously applied follow-up schedules and begin the new schedule from the first task"**, and it is not
possible to resume. (official_vendor_doc — knowledge.spark.re follow-up-schedules)

`[Recommendation]` **Adopt the pause list, the caps and the idempotency rules as a specification** — they are
free, and deriving them independently would cost a year of bugs. **Adopt** Spark's **per-step human-in-the-loop
send gate**: each step can auto-send or become a calendar task a human reviews, and auto-send additionally
requires the contact to already have an assigned team member, so anonymous machine mail cannot go out under
nobody's name. `[Inference]` For high-ticket, two-language advisory work the correct default for everything past
the initial acknowledgement is **auto_send = false**.

`[Recommendation]` **Adopt** Lofty's **"wait until an event happens, with a fallback timeout"** step, which
automatically produces *Event Met* / *Event Not Met* branches. `[Inference]` This single primitive expresses
every SLA and escalation rule Forever needs — "agent hasn't logged contact in 30 minutes", "client hasn't
replied in 3 days", "feedback not received 48h after viewing" — without a separate escalation subsystem.

`[Web research]` Send-time detail worth copying with one change: Follow Up Boss sends day-zero email
immediately, later emails around **09:00 in the user's timezone**, non-email actions around 05:00, and
calendar-date-triggered plans at 08:00 company time. `[Recommendation]` **Adapt** — for Forever the correct
anchor is the **client's** timezone, not the agent's, because the client is the one being woken up.

### 3.8 The viewing lifecycle and structured feedback

`[Web research]` iamproperty CRM documents this pattern more completely than anyone else:

| Element | Documented behaviour |
|---|---|
| Automated request | Feedback request auto-sent by **email or SMS at an agency-configured delay** after the viewing, driven by Viewing Templates, with manual push available from the viewing record |
| Two-tier editorial gate | Viewer submissions **always land as Private** (agent-only, scoped to the correct branch). The agent edits and copies what should be shared into **Public Feedback**, visible to vendors/landlords |
| Structured dimensions | Star ratings on **Location**, **Value for Money**, **Attributes**, plus Private and Public note fields, plus reusable **feedback templates** carrying the questions to ask |
| Work queue | A **"Viewings Requiring Feedback"** queue that only clears when a user explicitly answers "Yes, mark it". Choosing **"No, don't mark it"** keeps it queued and lets the agent append notes — explicitly including notes recording that they tried to reach the viewer and failed |

(official_vendor_doc — helpcentre.iamproperty.com, two articles)

`[Recommendation]` **Adopt all four.** `[Inference]` The queue design is the correct shape for any SLA queue in
this system: it distinguishes *"no feedback yet"* from *"we tried and failed"*, keeps the attempt history, and
requires a deliberate human act to close — so **queue depth is a real metric rather than an artefact**. The
editorial gate matters because raw buyer feedback is blunt, sometimes personal, and occasionally wrong; making
the agent the editor rather than a passive relay is right for an advisory brokerage that has to keep developer
relationships.

`[Recommendation]` Model the viewing as its own entity with an explicit lifecycle: `requested → scheduled →
confirmed → attended | no_show → feedback_requested → feedback_received | unreachable`.

`[Recommendation]` Capture feedback **structurally, not as a note**: ratings plus free text plus a **decision
field** (`proceed` / `maybe` / `rejected`) with a controlled reason code. `[Recommendation]` Because nobody
documents a feedback→matching loop (§3.1, U10), build it as an **explicit post-viewing task**, not a hidden
re-score: "too far from the beach" narrows the area set as a visible edit a human confirms.

> `[Repository fact]` **Hard constraint on any such loop.** `src/features/navigator/core/matching.ts:8-11`
> records NAV-001 §09 as a hard rule: "No score, percentage, ranking, 'best project', fabricated yield, market
> position, verification status, or trust score is ever computed or shown." A feedback loop that produces a
> ranking would violate a constitutional product rule. It must narrow **filters**, never produce a **score**.
> This is D10.

### 3.9 Off-plan reservation → SPA → completion

`[Web research]` Spark ships a documented off-plan **contract** state machine with customisable labels and
colours:

```
Prepping → Pending → Offer → In Rescission → Firm → Completed
   plus terminal / branch states: Not Accepted, Rescinded, Assigned, Reassigned
```

Definitions: *Prepping* = being prepared, not yet sent for signature; *Pending* = sent or past sent date, not
all purchasers signed; *Offer* = all purchasers signed, not yet countersigned; *In Rescission* = signed by all
parties; *Firm* = past firm date; *Completed* = past completion date.
(official_vendor_doc — knowledge.spark.re/contract-statuses)

`[Inference]` The valuable idea is not the labels. It is that Spark separates **document state** from **deal
state** from **unit state**, and makes **rescission** and **pre-completion assignment** first-class — both
normal in off-plan and both modelled as ad-hoc notes in generic CRMs.

`[Web research]` Spark also treats inventory as a first-class entity, not a listing: customisable per-unit
statuses, allocation attaching **both the purchaser and their broker** to a specific unit or floorplan, digital
request forms used pre-launch to "create, accept and allocate units", a live pricing matrix with price history,
stacking-plan visualisation, options and upgrades, and multiple buildings/phases per project.
(official_vendor_doc — spark.re/product/inventory)

`[Web research]` The **Thailand-specific** sequence (secondary — fazwaz.com, an advice page from a Thai property
portal; `[Unverified assumption]` not a regulator source and not verified against Thai statute): unit selection
and terms → reservation agreement → reservation deposit of approximately **2% for off-plan** (versus 5–10% on
resale) → **Sales and Purchase Agreement** with a typical **30-day review window** → first contract payment →
construction-milestone instalments → completion and transfer.

`[Recommendation]` Model the Thai off-plan deal as **dated milestones with amounts**, not as a single stage
field. `[Recommendation]` Model the unit with a status enum that includes a **time-boxed hold**:
`available → on_hold(held_for_contact_id, expires_at) → reserved → spa_issued → spa_signed → completed`, plus
`released` and `cancelled`. `[Inference]` **Holds must expire automatically** — a hold without a TTL becomes
permanent inventory rot, and inventory rot in an off-plan advisory is indistinguishable from dishonesty.

> `[Repository fact]` **Boundary reminder (D-brief §2).** Unit inventory truth, price history truth and project
> facts are **not owned by the CRM** (`docs/FOREVER_BRAIN_V1.md:288-328`). The CRM references
> `projects(slug)` and `units(id)` and consumes availability; it must not become a second inventory system.
> Note also that `unit_price_history` is **not append-only** (the ingest UPDATEs in place), so it must never be
> read as an event stream by CRM logic.

Illustrative only — **not a migration**, not executable, no version number, purely to show the shape being
described:

```sql
-- ILLUSTRATIVE DDL — NOT A MIGRATION. Do not run. Shape only.
-- Milestones as dated rows, so a Thai off-plan deal is a schedule, not a status string.
create table crm_deal_milestone (
  id              uuid primary key,
  deal_id         uuid not null,
  milestone_key   text not null,        -- reservation | spa_issued | spa_signed | instalment | completion
  due_on          date,
  occurred_on     date,
  amount_minor    bigint,               -- never a float
  currency        char(3),              -- multi-currency is schema, not display (§3.1)
  fx_rate         numeric,              -- captured at quote time so a quote reproduces later
  fx_rate_date    date
);
```

### 3.10 Commission attribution — settled by who registered the client first

`[Web research]` Spark's registration model discriminates registrant type **at capture**: registration forms
apply one rating to contacts who declare themselves agents and a different rating to everyone else, apply a
**different follow-up schedule** to agents versus buyers, and anyone indicating they are an agent receives the
agent tag regardless. (official_vendor_doc — knowledge.spark.re/registration-form-settings)

`[Web research]` Spark's inventory allocation attaches the broker to the unit **at request time, before any
contract exists**. (official_vendor_doc — spark.re/product/inventory)

`[Inference]` Read together, these encode the actual commercial rule of new-development brokerage: **developer
commission disputes are settled by who registered the client first**, not by who closed. The attribution record
must therefore be created at *registration/reservation*, not at completion.

`[Recommendation]` Create an explicit `client_registration(developer_id, project_id, contact_id, registered_at,
developer_reference)` alongside the deal-level attribution record, and create it at reservation.
`[Recommendation]` Force the **agent-vs-buyer distinction at the capture form**, not as a later cleanup — a
co-broke partner and an end buyer need different nurture, different data and different commercial terms.

`[Repository fact]` Forever already has an unresolved attribution gap upstream of this: `/contact` **never sets
`project_slug`**, so project attribution is lost on every website lead; only Booth sets it. Fixing intake
attribution is a precondition for trusting any commission attribution built on top of it.

### 3.11 Reapit's three-entity separation

`[Web research]` Reapit Foundations documents an estate-agency data model worth copying wholesale in shape:

- **Enquiry** — "Enquiries (Internet Registrations) represent a potential sales or lettings lead… Enquiries are
  **vetted by the agent before they are promoted** into property or applicant entities."
- **Contact** — the person, "captured and managed centrally so that a single contact can fulfill multiple vendor,
  landlord, applicant and tenancy roles at the same time."
- **Applicant** — a **requirement set**: "the property buying or renting interests of one or more contacts or
  companies… requirements such as the number of rooms, maximum budget and the geographical areas."
- **Journal Entry** — "Journal entries indicate that an event has occurred for an associated entity… Journal
  entries are used to drive the various activity feeds in our CRM systems."
- **Area** — "comprised of either polygon coordinates or a listing of postcodes. Areas are hierarchical and a
  single area can alternatively include a list of other areas."
- **Department** — a matching ring-fence determining which attributes may describe a property or requirement.

(official_vendor_doc — foundations-documentation.reapit.cloud/platform-glossary)

`[Recommendation]` **Adopt Enquiry-as-vetted-pre-entity.** This is the precise, documented fix for Forever's
orphaned `public.leads` table and it aligns exactly with **D1/D2**: `leads` stays the raw append-only landing
log for every channel, never matched against; a deliberate promotion action creates the person and the
requirement. `[Recommendation]` **Adopt Contact ≠ Requirement** — one person routinely holds several concurrent
search briefs, and collapsing them makes matching, re-engagement and reporting wrong simultaneously.
`[Recommendation]` **Adopt the append-only journal as the backbone**; every activity feed and attribution
argument becomes a projection of one event stream. `[Recommendation]` **Adapt Area as hierarchical** — locality
is the dominant Phuket buying criterion and it is not a string; hierarchy lets "west coast" match Bang Tao.
`[Recommendation]` **Adapt Reapit's extension-metadata (jsonb) pattern**, but honour its stated caveat: **not for
personally identifiable or sensitive data**, because extension storage is not governed or audited like core
columns.

### 3.12 What a 5–15 agent brokerage genuinely does not need

`[Recommendation]` Scope hard. Needed: ordered routing rules, a claim window, a pond, working hours, a routing
log, an event log. **Not needed:** multi-level org hierarchy, per-office permission profiles, weighted "hunger"
allocation, lead hiding/redaction, enterprise reassignment machinery, template-approval UI, a shared-inbox
clone, weighted forecasting, a second pipeline before the first one works.

`[Web research]` The evidence that ownership machinery is over-built: Lofty ships a "Global Company Lead" toggle
whose entire documented purpose is to **hide the ownership concepts** from users.

`[Web research]` **Do not build a business case on "X% of CRM projects fail."** The commonly cited figures are a
chain of undefined claims — 2001 Gartner 50%+, 2002 Butler Group 70%, 2006 AMR Research 31%, 2009 Forrester 47%
— with no shared definition of "failure" (secondary — crmsearch.com; johnnygrow.com, whose author reports having
asked the analyst firms directly and found no common definition). `[Inference]` A number that ranges from 31% to
70% across four firms in eight years is measuring the definition, not the phenomenon.

---

## 4. The speed-to-lead evidence base — a debunking

`[Inference]` This section exists because **Forever's positioning is evidence-led**. A brokerage that markets
itself on verified facts cannot build its own operating model on an unverifiable statistic, and must not repeat
one in its own marketing. This is a brand-integrity constraint, not a pedantic one.

### 4.1 Provenance of the famous multipliers

| Claim as usually stated | What the primary source actually is | What it actually says |
|---|---|---|
| "**100x** more likely to contact, **21x** more likely to qualify, if you respond in 5 minutes vs 30 minutes — *Harvard*" | **Not Harvard.** The 2007 **Lead Response Management study**, Dr James Oldroyd, published by **InsideSales.com** — a company selling lead-response software. 6 companies, 15,000+ leads, 100,000+ dials. (industry_report — the study PDF, hosted on HubSpot user content) | The multipliers are real quotes from that study. Its authority is not. |
| "…and HBR proved it" | The 2011 **Harvard Business Review** article *The Short Life of Online Sales Leads* (Oldroyd, McElheran, Elkington), an audit of **2,241 US firms**. (industry_report — hbr.org/2011/03) | **Different numbers entirely:** a **42-hour average** first response among firms that responded at all; **23% never responded**; roughly **7x** within an hour; roughly **60x** versus 24+ hours. |

`[Web research]` **Oldroyd co-authored both.** `[Inference]` That shared authorship is the mechanism by which
the 2007 vendor multipliers got laundered under the Harvard brand: the citation chain is real, the attribution
is not. Citing "the 5-minute rule" as a Harvard finding is the single most reliable tell that a source has not
been checked.

### 4.2 Three defects in the 2007 study that matter for design

`[Web research][Inference]`

1. **Publisher conflict of interest.** The study was published by a vendor selling exactly the software the
   study's conclusion recommends buying.
2. **Observational, not experimental.** Response speed was not assigned; reps chose it. `[Inference]` Reps
   plausibly dialled the **hottest and most complete leads fastest** — a named contact with a real phone number
   and a stated budget gets called first. If faster-dialled leads were also *better* leads, then lead quality is
   confounded with response speed and the odds ratios are inflated by an unknown amount. Nothing in the study
   design separates the two.
3. **It is ~19 years old.** It describes **US business-hours outbound phone dialling**, predating messaging-first
   buyer behaviour entirely.

### 4.3 "78% of customers buy from the first business to respond"

`[Web research]` Searched specifically for a primary source. **None exists that could be found.** The trail ends
at Instagram posts and a Reddit marketing account. `[Recommendation]` **Never use this figure.** It is folklore
with a decimal point.

### 4.4 The 2024–2026 "benchmarks"

`[Web research]` Every 2024–2026 "speed to lead benchmark" page located is **published by a company selling
lead-response software**, and they **contradict each other**: 42-hour median vs 47-hour average vs 13-minute
median vs 26% never responding. Most are relabelling the 2011 HBR figure as current data. A representative
example presents the 5-minute rule as a joint "Harvard Business Review and MIT" finding *and* asserts the
untraceable 78% figure on the same page (secondary — caseyresponse.com). The clearest available reconstruction
of the misattribution chain is itself a secondary blog (secondary — ainora.lt). **No credible new primary
research from 2024–2026 was found.**

### 4.5 Conclusion — what survives

`[Recommendation]`

- **Survives:** the *direction*. Fast response beats slow response, and most firms are far slower than they
  believe. Both the 2007 and 2011 studies agree on that, and the 2011 audit of 2,241 firms is the more credible
  of the two.
- **Does not survive:** every multiplier. 100x, 21x, 78%, and every 2024–2026 "benchmark".
- **Design consequence:** fast response is **genuinely worth designing for** — acknowledgement SLAs, claim
  windows, routing, escalation, all of §3 — but Forever must justify them on **its own measured median**, not on
  borrowed multipliers. `[Repository fact]` `docs/ROADMAP.md:148` already sets the honest version of this exit
  criterion: "median response time is measured and improving."
- **Marketing consequence:** `[Recommendation]` **Reject** repeating any of these statistics in Forever's own
  materials. An evidence-led brokerage citing a vendor-funded 2007 study of six companies as "Harvard research"
  would be doing precisely what it claims to be an alternative to.
- **Reject the 5-minute rule as a literal design target.** `[Inference]` It describes US business-hours phone
  dialling into a short sales cycle. Forever's buyers are in UTC+2..+4 while the office is UTC+7, and an off-plan
  purchase is a months-long decision. Speed matters; *that specific number* is not evidence.

---

## 5. Thai PDPA and cross-border privacy

> # ⚠ ARCHITECTURE RESEARCH — NOT LEGAL ADVICE
>
> This section is a **system-design input**. It is not legal advice and must not be relied on as such. Every
> point marked `[LAWYER]` requires confirmation from a **Thai-qualified privacy lawyer** before Forever relies
> on it. The English PDPA text used is an **unofficial translation** (U3); several notification details were
> read through machine translation or through law-firm commentary rather than the Thai original.

### 5.1 Scope — the finding that sets everything else

`[Web research]` Because Forever is **established in Thailand**, PDPA s5 applies to **all** its processing
regardless of where the buyer is or where the data is processed. Russian and EU buyer data is fully in scope —
not only data of people physically in Thailand. Forever is a **Data Controller**.
(official_regulator — mdes.go.th PDPA translation; official_regulator — Royal Gazette Vol. 136 Part 69 Gor)

### 5.2 The structural difference from GDPR that dominates the data model

`[Web research]` PDPA attaches the lawful basis **at collection** (s24). Section 27 then provides that you may
not use or disclose without consent unless the data was **originally collected** under a s24/s26 exemption.
**You cannot silently re-base data later.**

`[Inference]` This is the single most important schema consequence in the section. A GDPR-shaped model that
picks a fresh basis per processing operation **cannot represent what PDPA requires**. The CRM must record, per
person **per purpose**, which s24 limb was relied on **at capture time**, and persist that decision immutably.

**Lawful bases (s24):** consent (default), plus (1) research/archives, (2) vital interests, (3) contract or
pre-contract steps **at the data subject's request**, (4) public task, (5) legitimate interests **subject to
balancing**, (6) legal obligation. There is no journalism-style carve-out for a brokerage and no separate basis
list for use/disclosure.

Applied to Forever's four real collection scenarios `[Web research]` `[LAWYER]`:

| Scenario | Basis analysis |
|---|---|
| **Walk-in booth guest** | s23 notice is mandatory **regardless of basis**. Basis is either s24(3) — only if the guest is genuinely taking pre-contract steps at their own request, which is thin for a passer-by — or s24(5) legitimate interest, defensible for "capture contact + respond to the enquiry" with a **written** balancing assessment. Consent is safest for the capture and is required in practice for anything beyond answering the enquiry. |
| **Marketing messages** | s24(5) is available on the face of the Act, but **s32(2) gives an absolute right to object to direct marketing with no balancing test**, and PDPC consent guidance pushes toward separate opt-in. A Thai ePrivacy-equivalent prior-consent rule **could not be verified** (U2). `[LAWYER]` |
| **Buyer decision profile** | s24(5) is plausible for preferences the buyer **themselves stated**; inferred/derived scoring is more intrusive and needs a documented assessment. The hard limit is s26. |
| **Post-close retention** | s24(6) legal obligation is the strongest anchor — see §5.6. |

### 5.3 Consent — form, evidence, withdrawal

`[Web research]` s19 requires consent to be explicit, written or electronic, **"presented in a manner which is
clearly distinguishable from the other matters"**, freely given, and **withdrawable as easily as it was given**.
Non-compliant consent has **no binding effect at all**. s82 provides an administrative fine of **up to THB 1M**
for consent-form failures. (official_regulator — mdes.go.th PDPA; secondary — PDPC consent guidelines via
machine translation, clinregs.niaid.nih.gov)

`[Recommendation]` Schema consequences — all binding under **D8**:

| Requirement | Design |
|---|---|
| Prove **what the person actually saw** | `consent_text_version(id, locale TH/EN/RU, body, effective_from)` — **immutable**; consent records point at a version, never at free text |
| Consent is **evidence, not a flag** | `crm_consent_record` **append-only**: REVOKE UPDATE and DELETE from the application role. Withdrawal is a **new row** with a `supersedes` pointer — never a mutation |
| Marketing separated from terms | `purpose_key` must be granular: `booth_enquiry_response`, `marketing_email`, `marketing_whatsapp`, `marketing_telegram`… A single "I agree to the terms and to receive marketing" checkbox is **void as to the marketing element** — this is explicit statutory text, not interpretation |
| Withdrawal as easy as giving | Consent will be given on a tablet in one tap; "reply to this email to unsubscribe" is **not equivalent**. A self-serve preference page in RU/EN/TH is the proportionate answer — and it quietly reduces DSR volume, because most people who would file an erasure request just want the marketing to stop |
| Prove basis **at send time** | `marketing_send_log` row per message carrying the `consent_record_id` live at the moment of send, plus template version and unsubscribe token. Re-check consent **at send**, not at list-build — the gap between building a segment and pressing send is where withdrawals get missed |
| Suppression outlives erasure | A suppression list keyed on a **salted hash** of email/phone + channel. Otherwise honouring erasure by deletion means the next import re-creates the person and markets to someone who objected — the exact violation you were avoiding |

### 5.4 Data-subject rights and the 14 September 2026 access-request notification

`[Web research]` **This is a dated constraint, ~7 weeks from the research date.** The PDPC Access Requests
Notification was published in the Government Gazette on **16 July 2026** and takes effect **14 September 2026**
(Volume 143, Special Part 175 Ngor). It puts detail on s30 for the first time:
(secondary — Tilleke & Gibbins via Lexology; corroborated by lexbangkok.com and grandlinux.com)

- **mandatory intake channels: at minimum an office (in-person) channel and post.** Web/app/email are optional
  *additions*. `[Inference]` **A web form alone is not sufficient** — so this is a process change at two physical
  locations, not only a schema change;
- identity verification and a completeness/verification step, with a cure period for incomplete requests;
- **30-day completion**, extendable by up to a further 30 days **on written notice**;
- an enumerated list of refusal grounds, with **written reasons that must be recorded**;
- **capped fees, published in advance**;
- **minimum two-year retention** of the request, the evidence, the actions taken and the refusal reasons.
  Electronic recordkeeping is permitted.

`[Web research]` Deadlines are **asymmetric**, and that shapes the schema: s30 access has an express 30-day
statutory deadline (s30 para 4). Portability (s31), objection (s32), erasure (s33), restriction (s34) and
rectification (s35/36) have **no express deadline in the Act itself** — the 90-day erasure clock comes from the
2024 Notification, and objection requires the controller to act "immediately". Refusals of s30/s31/s32/s36 must
be recorded in the s39 record, and **that record-of-refusals duty is not covered by the SME exemption**.

`[Recommendation]` A `crm_dsr_request` table with a **generated due date**, a verification step, refusal-reason
capture and 2-year evidence retention is required before scale — and, on the face of the notification, before
**14 September 2026**. `[LAWYER]` Confirm the effective date and the intake-channel minimum against the Thai
text before relying on this.

### 5.5 Erasure reaching backups within 90 days

`[Web research]` The PDPC Notification on Criteria for Deletion, Destruction or Anonymization
(B.E. 2567 / 2024) was published in the Royal Gazette **13 August 2024** and took effect **11 November 2024**.
It requires deletion/destruction/anonymisation **within 90 days**, explicitly reaching **copies and backups**,
with interim protective measures where 90 days is not achievable, and requires a **verification system**.
Anonymisation is **not permitted for unlawfully-processed data**.
(secondary — lawplusltd.com summarising the Notification) `[LAWYER]`

`[Inference]` This is the constraint most likely to be silently violated, because it is a **backup-configuration
decision disguised as a schema decision**. A default Supabase PITR/snapshot retention will hold deleted rows
past 90 days.

`[Recommendation]` Three viable postures — choose one **before** configuring backups, because retrofitting is
painful:

| Option | Mechanism | Cost |
|---|---|---|
| A | Keep PITR/snapshot retention **under 90 days** | Simplest; reduces disaster-recovery depth |
| B | Document a **restore procedure that replays an erasure ledger** against any restored snapshot | Preserves DR depth; requires the ledger to be complete and the procedure to be actually rehearsed |
| C | Per-subject encryption with a destroyable key | Strongest; materially more engineering than this system warrants |

`[Recommendation]` **Anonymize in place, never hard-delete** (D-brief §4) — deleting a person cascades into
deals and destroys the funnel history an evidence-led brokerage's positioning rests on. And the non-obvious
half: **purge the audit history too**, because trigger-based audit rows store the exact PII in `old_record`.
This is the easiest way to "comply" with an erasure request and retain the data anyway.

### 5.6 Retention as purpose limitation

`[Web research]` PDPA imposes **no fixed retention periods**. It imposes purpose limitation plus three concrete
duties: disclose the retention period (or expected period) at collection (s23(3)); record it in the RoPA
(s39(4)); and operate an **"examination system"** that actually erases when the period ends (s37(3)).

`[Recommendation]` **Retention is per purpose, not per person** — the two diverge the moment a deal closes. A
closed-deal buyer's KYC and transaction records must be **kept** even if that same person withdraws marketing
consent the next day. A per-person retention date forces a choice about **which law to breach**.

`[Web research]` Anchor each purpose to a **named external statute**, not an invented duration:

| Purpose | Anchor | Source |
|---|---|---|
| Closed-deal KYC / customer due diligence | **AMLA s16(4)** — "Real estate brokers or agents" are listed among designated non-financial businesses; ~5-year record retention | official_regulator — AMLO presentation, item 4; secondary — juslaws.com AML 2026 guide `[LAWYER]` |
| Accounting records | **Accounting Act B.E. 2543 s14** — not less than five years | secondary — samuiforsale.com law text `[LAWYER]` |
| Tax | Revenue Code s87 — 5 years, extendable to 7 | secondary `[LAWYER]` |
| Legal claims | s33 para 2 preserves data needed for establishment/exercise/defence of legal claims | official_regulator — PDPA |
| Unconverted enquiries | **No statutory anchor** — needs a written legitimate-interest assessment stating the period and the reason | `[Recommendation]` |

`[Inference]` "We keep leads for 3 years" is arbitrary and indefensible. The statute-anchored version is
defensible **and** it drives the retention job from the same table that drives the privacy notice.

### 5.7 Cross-border transfer — no Thai adequacy allowlist found

`[Web research]` s28 requires adequate destination standards; s29 permits certified intra-group policies (BCRs)
or appropriate safeguards. Two Notifications were published **25 December 2023**, effective **24 March 2024**;
BCR rules were issued **29 September 2025** with further BCR regulation effective **17 February 2026**.
(secondary — Linklaters; secondary — Norton Rose Fulbright dataprotectionreport.com; industry_report — Chambers
Data Protection & Privacy 2026 Thailand chapter)

`[Web research]` `[Unverified assumption]` **No published Thai adequacy allowlist was found** (U1). `[LAWYER]`
Permitted SCC forms reportedly include PDPC-prescribed clauses, ASEAN Model Contractual Clauses, and the **EU
GDPR SCCs with limited amendment** — which most US vendors already offer.

`[Inference]` Practical consequence: **Supabase, Cloudflare, and any US email/WhatsApp/analytics provider are
cross-border transfers.** Each needs a signed DPA, a named s28/s29 mechanism, a destination country and data
categories recorded.

`[Recommendation]` Build a `data_transfer_register` and populate it **before signing any vendor**, not after.
For a tiny brokerage with no corporate group, **SCCs are the realistic route** — BCRs presuppose a group.

### 5.8 Breach notification — `detected_at` vs `became_aware_at`

`[Web research]` s37(4): notify the PDPC **without delay and where feasible within 72 hours of becoming aware**,
unless the breach is unlikely to result in risk; notify data subjects without delay if **high risk**. The 2022
PDPC Notification (15 Dec 2022) classifies breaches as confidentiality / integrity / availability. The PDPC
clarified (Dec 2024 / Feb 2025) that **the clock starts on reasonable belief following preliminary assessment**,
not on the first alert — and that if 72 hours is missed you must still notify as soon as possible and **no later
than 15 days**. (secondary — Tilleke & Gibbins; secondary — DLA Piper privacymatters) `[LAWYER]`

`[Recommendation]` Model **two distinct timestamps from day one**: `detected_at` (first alert) and
`became_aware_at` (reasonable belief after preliminary assessment). **The second is the legally load-bearing
one.** Add `pdpc_notified_at`, `delay_justification`, `high_risk`, `data_subjects_notified_at`, and encode the
**15-day absolute backstop as an alert**. `[Inference]` Forever has no security team, so the realistic incident
is a leaked key or an agent export — which is why §5.11's logging matters more than the paperwork.

### 5.9 Section 26 sensitive data and the criminal tier

`[Web research]` s26 is **the only part of PDPA carrying imprisonment** (s79: up to one year). The list is
precise and closed: racial or ethnic origin, political opinions, cult, religious or philosophical beliefs,
sexual behaviour, criminal records, health data, disability, trade union information, genetic data, biometric
data — plus anything the Committee later prescribes.

**Nationality / citizenship is NOT on the list.** (official_regulator — PDPA; secondary — Linklaters Data
Protected Thailand)

`[Recommendation]` Four design consequences:

1. `[Recommendation]` **Do not build a `nationality` field and then segment marketing on it.** Storing
   nationality is lawful; recording and segmenting "Russian" in a way that reads as **ethnic** profiling moves
   toward s26 territory where the penalty tier includes imprisonment. Store **`preferred_language`** and
   **`country_of_residence`** — which are what the business actually needs operationally anyway.
2. `[Recommendation]` **Treat free-text agent notes as the primary s26 leak.** A small sales team **will** type
   health, religion and family details into a notes box — that is what notes boxes are for. Provide structured
   neutral alternatives for what agents legitimately need: `ground_floor_required`, `lift_required`, proximity
   preferences as a facility list, `family_size`. Train the team to record the **requirement**, not the reason.
3. `[Recommendation]` **Keep identity documents out of the CRM entirely.** AMLA will require passport and ID
   handling; Thai ID cards carry religion and passports carry place of birth — **both are routes into s26**.
   Separate bucket, own access policy, own audit log, retention tied to the AMLA period; extract only minimal
   structured fields into the CRM and reference the document by id. `[Inference]` Contaminating the entire CRM
   with criminal-tier exposure to save one storage boundary is a bad trade at any size.
4. `[Web research]` A stored headshot is **probably not biometric** unless used for face matching — s26 defines
   biometric data as arising from technology relating to physical or behavioural characteristics usable to
   identify a person. `[LAWYER]`

### 5.10 DPO and RoPA thresholds — why the SME exemption probably does not save a CRM

`[Web research]` There is **no general controller registration** under PDPA.

**DPO (s41)** is required only if the controller is a public authority, **or** its activities require regular
monitoring of personal data by reason of large volume, **or** its core activity is s26 data. The PDPC DPO
Notification (effective **13 December 2023**) sets **100,000 data subjects** as large-scale — **and also
catches activities involving "tracking, monitoring, analyzing, or predicting the behavior, attitude, or profile
of individuals."** (secondary — Tilleke & Gibbins DPO notification)

`[Inference]` **A "buyer decision profile" is literally profiling.** Forever will be far under 100,000 people,
but the profiling limb is **not purely volume-based**. `[Recommendation]` Do not conclude "we're small, no DPO
needed" without **writing the assessment down and keeping it** — the August 2025 THB 7M fine expressly cited
failure to appoint a DPO as one of three violations. `[LAWYER]`

**SME RoPA exemption** (Notification in force **20 June 2022**): it exists, and it is narrower than it looks.
s39 para 3 **disapplies** it where processing is likely to risk rights and freedoms, where processing is **not
occasional**, or where s26 data is involved. `[Inference]` **A CRM is by definition continuous, routine
processing.** Assume the exemption does **not** apply and build the RoPA. Even if it did, item (7) — records of
rejected requests and objections — is **never exempted**.
(secondary — Kennedys summary of PDPC notifications) `[LAWYER]`

`[Recommendation]` **Build the RoPA as data, not as a document.** A `processing_purpose` table
(`purpose_key`, s24 limb, data categories, recipients, retention rule, transfer mechanism) can drive **the
privacy notice text, the retention job and the s39 record from one source of truth**. `[Inference]` One table
replacing three separately-maintained artefacts is the only version of this a five-person firm will keep current.

### 5.11 Enforcement reality — why security fields beat paperwork

`[Web research]` The PDPC moved from zero fines to active enforcement. **August 2025: eight administrative fines
across five cases totalling more than THB 21.5M.** In **every** case the cited failure was **inadequate security
measures** — plus failure to notify a breach, and in one case failure to appoint a DPO. A **processor** was
fined THB 3M in its own right. A 2025 fine of THB 1.21M against a hospital concerned a document-**destruction**
failure. The PDPC's "Eagle Eye" unit proactively monitors dark-web and social sources rather than waiting for
complaints. (secondary — Herbert Smith Freehills Kramer, 12 Sept 2025)

`[Recommendation]` **Prioritise access control and logging over documentation.** Concretely: RLS enabled on
every table with no permissive default, MFA on all staff accounts, no shared logins, an offboarding checklist
that revokes access same-day, and an **append-only log of reads and exports** of buyer data — not just writes.
`[Inference]` In a two-location brokerage the realistic incident is **an agent exporting the whole buyer list on
their way out**, and a write-only audit log cannot see that at all.

`[Recommendation]` **Do not treat a privacy policy as the compliance deliverable.** Notice (s23), lawful basis
(s24), consent evidence (s19), records (s39) and security (s37(1)) are **five distinct obligations**; a
published policy discharges one.

### 5.12 Does GDPR also apply?

`[Web research]` Plausibly, in parallel, via **Art 3(2)**. Mere website accessibility from the EU is **not**
enough — EDPB Guidelines 3/2018 require apparent intention to offer to, or to monitor, people in the Union.
But **EUR pricing, EU-targeted ad spend, an EU-language funnel aimed at EU residents, or analytics/retargeting
pixels firing on visitors physically in the EU** would satisfy the targeting or monitoring criterion.
(official_regulator — EDPB Guidelines 3/2018)

If in scope, it adds: an **Art 27 EU representative** (the derogation covers only occasional, low-risk,
non-large-scale processing — `[Inference]` an ongoing CRM of EU prospects is probably **not** "occasional"),
Art 12(3) one-month response with a two-month extension, Art 30 records, Art 33 72-hour notification to a lead
supervisory authority, Art 21(2) absolute marketing objection, and national ePrivacy rules generally requiring
prior consent for email/SMS marketing. (secondary — gdpr-info.eu Art 27)

`[Web research]` **Thailand is not on the EU adequacy list**, checked against the Commission's current page on
2026-07-28 (the list being Andorra, Argentina, Brazil, Canada (commercial organisations), Faroe Islands,
Guernsey, Israel, Isle of Man, Japan, Jersey, New Zealand, Korea, Switzerland, UK, US (DPF), Uruguay, EPO).
(official_regulator — commission.europa.eu adequacy-decisions) `[Inference]` So an EU-based portal or partner
sending leads **to** Forever needs Art 46 SCCs, and Forever should expect to sign as data importer.

`[Recommendation]` **Make the EU-targeting decision explicitly and write it down.** The cheapest compliant
answer may be a deliberate business choice **not** to target the EU. Either way it must be a recorded decision,
not an accident of ad settings. `[LAWYER]`

`[Web research]` `[Unverified assumption]` **Russian buyers:** Federal Law 152-FZ Art 18(5) localisation
(initial collection of Russian citizens' data into a database located in Russia) is asserted extraterritorially
by Roskomnadzor on a targeting theory — Russian-language site, ruble pricing, Russian-targeted advertising.
(secondary — Morgan Lewis) Whether it bites a Thai brokerage is genuinely uncertain and enforcement against a
tiny foreign operator is unlikely, but the risk is real enough not to design it out of reach.
`[LAWYER — Russian counsel, not Thai.]`

### 5.13 Monitoring items

`[Recommendation]` Set a recurring re-check on: (a) the **draft PDPA amendment bill** that went to public
consultation in late 2025 and was not completed — proposals touch controller/processor definitions,
sensitive-data classification, and the "freely given" consent standard; (b) whether the PDPC has **published an
adequacy allowlist** (none found — which is why SCCs are the current route). Both would change the design.

---

## 6. WhatsApp Business Platform, email and calendar

### 6.1 The two decisive findings

**Finding 1 — the 1 October 2026 pricing inversion.**

`[Web research]` Meta's own documentation states that effective **1 October 2026**, **service messages**
(free-form agent replies inside the 24-hour window) and **in-window utility templates** both become **billable
per message**, at the same market rates as utility/authentication, with **no volume tiers for service**. These
had been free since November 2024 and 1 July 2025 respectively. Separately, from **1 August 2026**, Meta
Business Agent replies bill **per token at $2.00/1M tokens** (~4–5 cents/message; Meta's own example puts a
simple 4-message inquiry at ~16–20 cents). **Rates take effect 1 Oct 2026 and will only be published by
1 Sep 2026.** (official_vendor_doc — developers.facebook.com whatsapp/pricing, page states "Updated: Jul 1,
2026"; developers.facebook.com whatsapp/pricing/non-template-messages)

`[Inference]` **Any business case resting on "replies inside the window are free anyway" expires in roughly ten
weeks, and the replacement cost is not yet knowable.** For a high-touch, low-volume brokerage where one off-plan
lead generates dozens of hand-typed messages over months, moving agent replies onto the API converts a
permanently free channel into a **metered one with unpublished pricing**.

**Finding 2 — the number-migration trap.**

`[Web research]` Meta's migration doc is explicit. To use an existing WhatsApp **Business App** number with
Cloud API you must **either**:

- **delete the account** — in which case *"your existing messaging history will be lost, and you will be unable
  to use that number with the WhatsApp Business app again"*; **or**
- onboard through a **partner that supports business-app number onboarding ("coexistence")**, in which case the
  app and the API run on the same number concurrently and history is preserved.

(official_vendor_doc — developers.facebook.com migrate-existing-whatsapp-number-to-a-business-account, page
states "Updated: Jun 16, 2026")

Coexistence mechanics `[Web research]` (official_vendor_doc — developers.facebook.com embedded-signup
onboarding-business-app-users): syncs up to **180 days of 1:1 history** in phases (0–1d / 1–90d / 90–180d);
**excludes group chats**; caps throughput at a fixed **20 mps**; disables disappearing / view-once / live
location; makes broadcast lists read-only; **unlinks all companion devices** at onboarding. Critically for
Forever, it emits **`smb_message_echoes` webhooks mirroring messages agents send from the Business App** — so
conversation data can reach Postgres **without changing agent behaviour and without paying per message for agent
replies**.

`[Web research]` The lock-in cost: Meta's own doc states that **numbers in use with the WhatsApp Business App
cannot use the programmatic BSP-to-BSP migration path**. (official_vendor_doc — developers.facebook.com
migrating-phone-numbers-among-solution-partners-programmatically) `[Inference]` So a coexistence number is
**materially stickier** than a plain Cloud API number. Migrated plain numbers keep display name, quality rating,
messaging limit, Official Business Account status and previously approved High-quality templates (template
quality ratings reset to UNKNOWN for 24h).

`[Recommendation]` **This is D6 and it is binding:** the agents' working WhatsApp number is a **protected
production asset — never self-onboard it.** `[Inference]` This is the one genuinely **irreversible** decision in
the entire integration space, and it can be made accidentally by one person clicking through a setup wizard "to
try it out". It deserves a written rule, not a convention.

> **Cross-research conflict, surfaced deliberately.** `[Web research]` The real-estate research recommended
> making **WhatsApp and Telegram ingestion a launch requirement, not a phase two**, on the grounds that
> Russian-speaking clients and Thai developer contacts negotiate in chat, and if those messages do not land in
> the timeline automatically, agents will keep their phones as the real CRM. **That adoption risk is real and
> this document does not dismiss it.** But it is outweighed by the two findings above, and **D6 resolves it**:
> model conversations channel-agnostically now, deep-link out to WhatsApp, capture *outcomes* manually, and
> revisit integration against **pre-declared kill criteria** after one full deal cycle (60–90 days for off-plan).
> `[Recommendation]` Declare the kill criteria **in advance**: what percentage of interactions get logged within
> 24h, how many leads go dark with no logged outcome. `[Inference]` If manual capture is going to fail, it will
> fail measurably — and that measurement is the only honest basis for spending on integration.

### 6.2 The 24-hour service window

`[Web research]` The window opens when a user messages or calls, and **resets on each further inbound**. Inside
it, any non-template message type may be sent with no pre-approval. Outside it you are restricted to
pre-approved **marketing / utility / authentication** templates, which take up to ~24h to review and can be
re-categorised by Meta. (official_vendor_doc — developers.facebook.com whatsapp/messages/send-messages;
templates/overview)

`[Recommendation]` **Adopt as a modelling constraint even without integrating.** `[Inference]` A brokerage's
conversations are overwhelmingly **client-initiated**, so the window is usually open when it matters. That is
also why a **template-management UI is not worth building**: templates only matter outside the window, and the
handful Forever might ever need can be managed in Meta's own interface.

### 6.3 Opt-in is entirely the business's responsibility

`[Web research]` The WhatsApp Business Messaging Policy states you may only contact people on WhatsApp if
**"(a) they have given you their mobile phone number; and (b) you have received opt-in permission"**, and that
**"You are solely responsible for determining the method of opt-in."**
(official_vendor_doc — whatsappbusiness.com/policy/)

`[Inference]` Meta prescribes **no format and stores nothing**. The evidentiary burden is entirely Forever's,
and **a CRM that cannot answer "when, where and how did this person opt in?" is the actual compliance gap —
independent of whether the API is ever used.** `[Recommendation]` Therefore: record opt-in as first-class CRM
data (timestamp, source form/URL, **exact consent wording shown**, channel scope) **now**, integration or not.
This is the same record §5.3 requires under PDPA s19 — one table serves both.

`[Recommendation]` **Do not accept "we handle WhatsApp compliance for you" from a BSP as covering opt-in.** A
BSP can store a flag; it cannot manufacture the evidence.

### 6.4 Webhooks: signature verification and the retry conflict

`[Web research]` Meta signs payloads with a **SHA256 HMAC keyed on the app secret**, delivered as
`sha256={signature}` in the **`X-Hub-Signature-256`** header. Verification handshake is
`hub.mode=subscribe` / `hub.challenge` (echo back) / `hub.verify_token`. Payloads up to 3 MB; object
`whatsapp_business_account` with `entry[].changes[]`. (official_vendor_doc — developers.facebook.com
graph-api/webhooks/getting-started; whatsapp/webhooks/overview)

`[Recommendation]` **Verify the HMAC over the RAW request bytes.** `[Inference]` Most web frameworks parse and
re-stringify the body, changing whitespace or key order, which makes the HMAC **fail intermittently — or, worse,
pass locally and fail in production.** This is a classic and expensive bug and it is worth writing down before
anyone touches a handler.

`[Web research]` `[Unverified assumption]` **The retry documentation conflicts (U5).** Meta's generic Graph API
webhooks page implies ~36 hours of retries; the WhatsApp-specific webhooks page says retries continue **for up
to 7 days**. `[Recommendation]` Design for the **longer** figure and treat every webhook as **at-least-once and
unordered**: insert into a raw table keyed on the provider message id, then process idempotently. Do not assume
either number is authoritative.

### 6.5 BSP cost shapes, and why "getting banned" is stale folklore

`[Web research]` Two cost structures, crossing over at low volume:

| BSP | Structure | At a few hundred messages/month |
|---|---|---|
| **Twilio** | **$0.005 per message, inbound or outbound**, on top of Meta's fees (official_vendor_doc — twilio.com/en-us/whatsapp/pricing) | A few dollars |
| **360dialog** | **€49 / number / month** (Regular; €99 Premium, €249 High Throughput), plus Meta's fees, with explicit "no markup" (official_vendor_doc — 360dialog.com/pricing) | €49 regardless |

`[Recommendation]` Choose on **cost shape, not brand** — and **re-run the arithmetic after 1 September 2026**,
when Meta publishes the new rates. `[Inference]` Meta's underlying rate card is the same either way, so the BSP
choice is purely about the fee layer.

`[Web research]` **"Getting the number banned" is stale folklore.** Meta's help centre states the phone-number
statuses **Flagged and Restricted were discontinued as of 7 October 2025**. Quality rating is a **7-day rolling**
signal derived from user block reasons (No longer needed / Didn't sign up / Spam / Offensive / No reason), shown
Green/Yellow/Red. Default messaging limits start at **250 unique recipients per rolling 24h** outside service
windows, scaling to 2,000 — orders of magnitude above anything a Phuket brokerage will reach. Cloud API default
throughput is 80 messages/second. (official_vendor_doc — facebook.com/business/help/896873687365001;
developers.facebook.com messaging-limits; throughput)

`[Inference]` The real residual risk is **template quality degradation and template pausing**, driven almost
entirely by **marketing** templates. `[Recommendation]` One absolute rule removes most of the risk:
**never send marketing-category templates from the number agents use.** `[Recommendation]` And **do not build an
AI auto-responder on WhatsApp in 2026** — the economics changed under it (see §6.1, per-token billing from
1 Aug 2026).

`[Web research]` `[Recommendation]` **Use the WhatsApp Business App's own linked-device / multi-agent tier as
the shared inbox instead of building one.** The app supports "up to four linked devices and one phone at a
time", with a multi-agent tier raising the device count. (official_vendor_doc — faq.whatsapp.com/647349420360876
and /395911122612120; `[Unverified assumption]` the multi-agent device count was read from a snippet and the
exact tier limits were not confirmed.) `[Inference]` Building a shared inbox in the Forever product means
reimplementing a messaging client — media, read receipts, typing states, reactions, ordering, offline — for a
handful of agents. That is the single most expensive mistake available in this space.

`[Web research]` `[Unverified assumption]` **Channel-strategy caveat:** 2026 reporting describes Russia moving
to block WhatsApp while promoting a state-backed messenger, with voice calls already blocked since August 2025
(secondary — dw.com, Feb 2026; U14). `[Recommendation]` **Never hardwire WhatsApp into the schema** as *the*
messaging channel — no `whatsapp_thread_id` on the enquiry, no `wa_message` table as the only conversation
store. This is D6's `contact_channel` model: WhatsApp is a **capability of a phone number**, recorded as a
`channels` array on the phone row, not a separate identifier space.

### 6.6 Email: restricted scopes and the internal-Workspace exemption

`[Web research]` Google classifies `mail.google.com`, `gmail.readonly`, `gmail.compose`, `gmail.insert`,
`gmail.modify`, `gmail.metadata`, `gmail.settings.*` as **RESTRICTED** scopes — storing or transmitting that
data server-side triggers an **annual third-party security assessment**. **`gmail.send` is only SENSITIVE.**
(official_vendor_doc — developers.google.com/workspace/gmail/api/auth/scopes; support.google.com/cloud/13464321)

`[Recommendation]` **Cheapest defensible first step: send-only + a BCC dropbox.** Send transactional mail
(viewing confirmations, unit shortlists) via a transactional provider from a **dedicated subdomain** with SPF,
DKIM and DMARC configured on that subdomain, so the primary domain's reputation is insulated. Capture inbound by
BCC-ing a dropbox address that is parsed into the timeline. `[Inference]` This avoids restricted scopes
**entirely** and gets threaded correspondence into the CRM without reading anyone's mailbox.

`[Web research]` **The escape hatch worth knowing:** OAuth verification is **not required** when *"The app is
only used by people in your Google Workspace or Cloud Identity organization"* — such apps *"will not be subject
to the unverified app screen or the 100-user cap."* (official_vendor_doc — support.google.com/cloud/13464323)

`[Inference]` This makes the usual "the Gmail API is too expensive to certify" objection **inapplicable to a
tiny in-house team** — *if* Forever is on Google Workspace. `[Unverified assumption]` **Whether it is, is
unknown (U15) and is a question for the Owner.** It is the single cheapest unlock in this section and it costs
one answer to find out.

### 6.7 Calendar: .ics versus push channels

`[Web research]` Google Calendar **push notifications carry no payload** — *"These messages do not contain
specific information about updated resources, you will need to make another API call to see the full change
details"*. Channels **expire** and there is no automatic renewal.
(official_vendor_doc — developers.google.com/workspace/calendar/api/guides/push)

`[Recommendation]` **Cheapest defensible first step: one-way, write-only.** Generate an **.ics attachment plus a
Google Calendar template link** on every booked viewing and let agents add it to whatever calendar they already
use. No OAuth, no tokens to refresh, works for Google, Apple and Outlook users alike.

`[Recommendation]` **Second step if genuinely needed:** write events with an internal-only Workspace OAuth app
(same verification exemption as §6.6) and read back via **periodic incremental sync with `syncToken`**, not push
channels. `[Inference]` Since push carries no payload you must call the API regardless — so a push channel adds
renewal bookkeeping and buys nothing at this volume.

`[Recommendation]` **Do not build two-way calendar sync in v1.** It means conflict resolution, ownership rules,
deletion tombstones, timezone correctness across `Asia/Bangkok` and clients' home zones, and watch-channel
renewal — for a team that can add an .ics in one tap.

---

## 7. Supabase/Postgres and identity-resolution engineering

### 7.1 RLS performance rules — and why Forever is not adopting the model they belong to

`[Web research]` Supabase's own documentation is unusually explicit and **benchmarked**:

| Rule | Published benchmark | Source |
|---|---|---|
| Wrap every auth/helper call in a **subselect** — `(select auth.uid()) = owner_id` — never a bare call | **11,000 ms → 10 ms** on a complex policy (also 179 ms → 9 ms). Flagged by lint `0003_auth_rls_initplan` | official_vendor_doc — supabase.com rls-performance-and-best-practices |
| Always add **`TO authenticated`** | **170 ms → <0.1 ms** — policies without a `TO` clause execute for anon requests too | same |
| **Index every column a policy touches** | "Improvement seen over 100x on large tables" | same |
| **Do not join the target table into the policy** — rewrite `auth.uid() in (select user_id from team_user where team_id = table.team_id)` as `team_id in (select team_id from team_user where user_id = auth.uid())` | **9,000 ms → 20 ms** | same |
| **Exactly one permissive policy per (table, action)** | Multiple permissive policies OR together *and* force evaluation of all of them per row. Lint `0006_multiple_permissive_policies` | official_vendor_doc — supabase.com database-advisors |

`[Inference]` **All of these matter at millions of rows. At Forever's hundreds of rows, none of them will be
measurable.** They cost nothing to do correctly, which is the only reason to do them.

> **Architect challenge — recorded, and the decision honoured.**
>
> `[Repository fact]` **D3 deliberately overrides the Supabase research recommendation to use `auth.uid()` RLS
> policies.** The evidence for the override is in the repository: `auth.uid()` appears in **zero of 24
> migrations**, and `studio_members` and `audit_log` carry the explicit comment *"RLS on, NO policies:
> internal-only (audit_log pattern). Authorization is enforced at the app-server boundary, never in the
> browser."* Introducing `auth.uid()` policies would create a **second authorization paradigm** — the
> "parallel source of truth" failure, at the security layer.
>
> `[Recommendation]` **What Forever forfeits, stated honestly:** database-layer defence-in-depth. If the server
> boundary is bypassed — a leaked service key, an errant import that ships a secret to the client bundle — there
> is **no second line of defence in the database**. That is a real cost and it is being accepted knowingly, not
> overlooked.
>
> `[Recommendation]` **Review trigger:** *if any browser ever needs to read CRM data directly, revisit this
> decision.* The Supabase performance guidance above is **not discarded** — it becomes the binding standard the
> moment that trigger fires.

`[Web research]` Supabase itself sanctions the server-boundary design: the service/secret key carries
`BYPASSRLS` and "skips any and all Row Level Security policies", and is permitted for
**"servers that implement prior authorization themselves"**. (official_vendor_doc — supabase.com/docs/guides/api/api-keys)

`[Recommendation]` **The cost of that sanction is that the boundary must be enumerated, never defaulted to.**
Every service-role path must be a named, reviewed entry point. `[Recommendation]` And the specific hazard for
this stack: TanStack Start **co-locates server and client code**, so an errant import can ship the secret key
into the browser bundle. Gate it behind a server-only module and grep the built output for the key prefix.
`[Repository fact]` No CI exists to run that grep automatically, so it must be a documented manual step until
one does.

### 7.2 Claims are stale until refresh — and never `raw_user_meta_data`

`[Web research]` Supabase documents this plainly: **"Even if you remove a user from a team and update the
app_metadata field, that will not be reflected using auth.jwt() until the user's JWT is refreshed."** The Custom
Access Token Hook guide has **no documented revocation story**.
(official_vendor_doc — supabase.com row-level-security; custom-claims-and-role-based-access-control-rbac)

`[Inference]` For a firm where the director will change someone's role by hand and expect it to take effect
**now**, a JWT claim is the wrong store. `[Recommendation]` Join a profile/membership table; **defer the auth
hook entirely.**

`[Web research]` **Never read authorization data from `raw_user_meta_data` / `user_metadata`.** Supabase states
it *"can be updated by the authenticated user"*, whereas `app_metadata` *"cannot be updated by the user, so
it's a good place to store authorization data"*. `[Inference]` A user setting their own role is a **complete
authz bypass**, and it is a common copy-paste error.

`[Repository fact]` `[Inference]` Under D3 none of this is load-bearing for v1 — CRM authorization lives at the
app-server boundary. It is recorded because it becomes binding the instant the D3 review trigger fires, and
because the `raw_user_meta_data` rule applies to **any** authorization code anywhere, boundary or not.

### 7.3 Policy recursion and `plpgsql`-not-`sql` helpers

`[Web research]` Postgres evaluates policy sub-SELECTs **as the invoking user**
(official_regulator — postgresql.org ddl-rowsecurity). So a policy on `contacts` that sub-selects from
`contacts` produces `infinite recursion detected in policy`. The documented break is a
**`STABLE SECURITY DEFINER SET search_path = ''`** helper, which Supabase confirms does **not** need to live in
an exposed schema provided it is schema-qualified in the policy
(official_vendor_doc — supabase.com troubleshooting do-i-need-to-expose-security-definer-functions).

`[Web research]` `[Unverified assumption]` **Write such helpers in `language plpgsql`, not `language sql`** — the
planner can inline a simple SQL function, discarding the SECURITY DEFINER context and reintroducing the
recursion. (secondary — dev.to community write-up; U7. **Not** stated in official docs.) `[Recommendation]`
Adopt anyway: it is a free precaution against a failure that is hard to diagnose.

`[Web research]` `[Recommendation]` **Never put SECURITY DEFINER helpers in `public` or any exposed schema** —
Supabase warns explicitly that they "should never be created in a schema in the Exposed schemas".

### 7.4 Scheduling and durability hygiene

| Component | Documented behaviour | Consequence |
|---|---|---|
| `pg_cron` | Runs on the DB server via a background worker; **only one instance of a given job at a time** (a second is **queued, not skipped**) (official_vendor_doc — github.com/citusdata/pg_cron) | Long sweeps can pile up. Keep the sweep idempotent and short. |
| `pg_cron` failure mode | Supabase's own debugging guide documents that **the scheduler background worker can die** — and **the symptom is silence, not an error** (official_vendor_doc — supabase.com pgcron-debugging-guide) | `[Recommendation]` Add a **heartbeat check**. A silent scheduler is indistinguishable from "no leads arrived". |
| `cron.job_run_details` | pg_cron **"does not clean up historical records"**; Supabase warns the table can become "extremely large" and should be pruned before an upgrade | `[Recommendation]` Schedule a prune job **on day one**. A frequent SLA sweep generates a row per run forever. |
| `pg_net` | Explicitly **fire-and-forget**: responses live in **UNLOGGED** tables "not preserved during a crash or unclean shutdown", purged after **6 hours**, ~200 req/s cap (official_vendor_doc — supabase.com pg_net) | `[Recommendation]` **Never** use it for anything that must not be lost. SLA notifications are durable rows swept idempotently, never a fired-and-forgotten HTTP call. |
| Supabase Queues / pgmq | Headline is "exactly once delivery"; **both** Supabase and pgmq scope it to **"within a visibility timeout"** — i.e. **at-least-once with a dedup window** (official_vendor_doc — supabase.com/docs/guides/queues; github.com/pgmq/pgmq) | `[Recommendation]` **Defer.** And when adopted, handlers must be idempotent regardless of the headline. |
| Realtime | Per-subscriber RLS on a single ordered thread; **DELETE events cannot be filtered**; no documented replay (official_vendor_doc — supabase.com realtime/postgres-changes) | `[Recommendation]` Treat Realtime as a **cache-invalidation ping** into the query cache — never as a queue or a delivery guarantee. Always refetch on reconnect and on focus. |
| Broadcast-from-DB | Real and documented, but Supabase's own switching threshold is **~3,000 concurrent subscribers** | `[Recommendation]` **Defer.** Forever has five. |

`[Repository fact]` **D5 supersedes the generic advice above with something better:** the repository already has
a working durable-job pattern — `studio_upload_jobs` with `studio_claim_job` / `heartbeat` / `fail` / `release`
/ `list_due_jobs`, implementing one-winner claim tokens, stale recovery, `attempt_count`, `retryable`, and
`content_fingerprint` idempotency. `[Recommendation]` Replicate it in a **separate** `crm_work_item` table
rather than overloading it, because the Studio due-jobs RPC joins `studio_members` and applies a shared LIMIT —
CRM rows would starve or be starved.

### 7.5 Audit patterns and anonymize-in-place

`[Web research]` Trigger-based row auditing into an `audit.record_version` table stores `old_record` /
`new_record` jsonb per operation and derives a stable uuid from PK values, "enabling efficient (linear time)
history queries". Supabase's own guidance is **not** to enable tracking on every table.
(official_vendor_doc — github.com/supabase/supa_audit; supabase.com/blog/postgres-audit) `[Unverified
assumption]` Availability on the managed platform could not be confirmed (U6); a hand-rolled trigger audit is
the documented fallback.

`[Web research]` **Reject pgAudit as the CRM audit trail** — it writes to Postgres **logs, not tables**, and
Supabase does not position it for application-level auditing. (official_vendor_doc — supabase.com pgaudit;
secondary — pganalyze comparison) `[Inference]` You cannot build a "who viewed this buyer" screen on log lines.

`[Recommendation]` **Keep the forensic audit and the business timeline separate and never let anyone conflate
them.** The audit log is a machine-generated row-diff nobody reads daily; the activity/journal table is the
business record agents live in and is written deliberately.

`[Repository fact]` **A repository-specific hazard that changes the design:** `audit_log` writes are
**swallowed on failure** (`recordAuditSafely`). It therefore **cannot** be an automation trigger. Anything that
must not be missed needs a **transactional outbox written in the same transaction** as the business change.

`[Recommendation]` **Anonymize in place; never hard-delete** — and **purge the audit history in the same
transaction**, because `old_record` holds the exact PII the erasure request targeted (§5.5). `[Inference]` This
is the single easiest way to believe you have complied while retaining the data.

### 7.6 E.164 and libphonenumber pitfalls

`[Web research]` `[Recommendation]` **Normalize in TypeScript, never in a Postgres generated column.** PG
requires generation expressions to use **only immutable functions and reference only the current row**; E.164
conversion is neither pure-immutable nor context-free — it needs a default region.
(official_regulator — postgresql.org ddl-generated-columns)

`[Web research]` libphonenumber's own FAQ documents the failure modes that matter:

| Rule | Evidence | Why it matters here |
|---|---|---|
| **Never reject a lead whose phone fails `isValidNumber`** | Genuinely working numbers fail validation — extra trailing digits, renumbering transitions, locally-dialled forms (official_vendor_doc — github.com/google/libphonenumber FAQ) | Rejecting means **silently discarding real buyers**. Store, flag, do not block. |
| **Never call `isValidNumberForRegion`** | Google warns against it because **"Many people have phone numbers that do not belong to the country they live in"** | That sentence is an exact description of Forever's buyer base. |
| **Do not re-validate stored numbers on a schedule and flip them to invalid** | Metadata changes as numbering plans change | A number valid at capture can read invalid later through no fault of the data. |
| **Do not expect reachability or current carrier** | Carrier data reflects the **originally-assigned** range and cannot account for portability | Validity ≠ reachability. Do not build product logic on either. |

`[Web research]` `[Recommendation]` **`isPossibleNumber` (length-only) vs `isValidNumber` (length + prefix)** is
the right pairing: use possible-ness to accept, validity as a **flag for human attention**.

### 7.7 Email normalization pitfalls

`[Web research]` `[Recommendation]` Lowercase the whole address for the **match key**, preserve the raw for
**sending**. (RFC 5321 states the local-part "MUST BE treated as case sensitive" while noting that exploiting
that case sensitivity "impedes interoperability and is discouraged" — official_regulator — rfc-editor.org/rfc/rfc5321.)

`[Web research]` **Do not strip dots as a general rule.** Google's own help page states dots are ignored for
`@gmail.com` **and explicitly that for Workspace/custom domains "dots do change your address"**.
(official_vendor_doc — support.google.com/mail/answer/7436150) `[Inference]` A blanket strip **merges two
distinct people** at the same partner domain — a silent, unrecoverable data-integrity failure.

`[Recommendation]` **Do not strip plus-addressing** from the address you send to; the tag is a deliberate user
choice and stripping it can break filters or deliverability. Use dot-collapse and plus-stripping only to
populate a nullable **`match_hint`** column, and only for `gmail.com` / `googlemail.com`.

`[Web research]` `[Recommendation]` **Do not adopt `citext`.** Postgres documents that its case folding depends
on the database `LC_CTYPE` and is not Unicode-correct, that it is less efficient than `text`, that it loses
B-tree deduplication, and that it fits poorly when both raw and folded forms are needed.
(official_regulator — postgresql.org citext)

### 7.8 Deterministic vs probabilistic matching at low volume

`[Web research]` Splink's own documentation characterises **deterministic** linkage as *"Computationally cheap"*
and *"Capable of achieving high precision (few False Positives)"*, its weakness being **low recall**.
(industry_report — moj-analytical-services.github.io/splink)

`[Inference]` At hundreds of records, low recall is **cheap to fix with a human** and high precision is what
protects the data. Probabilistic linkage (Fellegi-Sunter, EM-trained m/u probabilities) needs volume to train
and produces a model nobody in a five-person firm can explain to an agent who disagrees with a merge.

`[Recommendation]` Build in this order, and **stop**:

1. The `(kind, normalized_value)` **UNIQUE index** — catches the large majority of duplicates at write time, for
   free, on every code path.
2. An **unindexed duplicate-candidate VIEW** for human review, using `pg_trgm` `similarity()` on names. `pg_trgm`
   defaults its `%` operator to a 0.3 threshold (official_regulator — postgresql.org pgtrgm).
   `[Recommendation]` **Do not add a GIN/GiST trigram index** — a sequential scan over a few hundred rows is
   sub-millisecond; the index is maintenance cost with no measurable return.
3. **Stop.** No Splink, no probabilistic linkage.

`[Web research]` `[Recommendation]` **Never use soundex / metaphone / dmetaphone for name matching.**
PostgreSQL's own manual states they *"do not work well with multibyte encodings (such as UTF-8)"* and that
*"Soundex is not very useful for non-English names"*. (official_regulator — postgresql.org fuzzystrmatch)
`[Inference]` **Roughly half of Forever's names are Cyrillic.** This is not a marginal caveat; it is a total
failure for the primary use case.

`[Web research]` One further PG detail that bites contact-method uniqueness: **nulls in unique columns are not
considered equal by default**; `NULLS NOT DISTINCT` changes that, and only B-tree indexes can be unique.
(official_regulator — postgresql.org indexes-unique)

### 7.9 Merge survivorship

`[Web research]` Two vendor models, and the simpler one is better:

| Vendor | Survivorship rule |
|---|---|
| **HubSpot** | *"the primary record's property values are prioritized… If the primary record does not have a value for a property the secondary record's value is used."* Merging **"cannot be undone"** and there is **"not a way to separate the contacts after the merge"** (official_vendor_doc — knowledge.hubspot.com/records/merge-records) |
| **Salesforce** | The user picks the principal record **and the surviving field values** field-by-field; related items re-parent; non-master contacts go to the Recycle Bin (official_vendor_doc — help.salesforce.com contacts_considerations_for_merging_duplicates) |

`[Recommendation]` **Adopt HubSpot's rule: primary wins, null-fill from secondary.** `[Inference]` It is
deterministic, testable in one function, and it is the difference between shipping merge and not shipping merge.
**Reject a field-by-field merge picker UI** — Salesforce's version is a whole screen and a whole class of
support questions.

`[Recommendation]` **Tombstone and repoint, never hard-delete:** keep the loser with `merged_into_id`, snapshot
the loser as jsonb, stamp the repointed rows, log the merge. `[Inference]` Neither vendor ships un-merge, so
**do not treat un-merge as table stakes** — but capture the snapshot and the stamps so it stays *possible*.

`[Recommendation]` The case that actually needs code: **two contacts who each have a deal.** Merging produces
one contact on two deals, which is **correct and common** (a client buying two units). What breaks is the
junction — `deal_party` rows collide on the composite key and need conflict handling, and "one primary party per
deal" must be re-established after the repoint.

`[Recommendation]` **No `households` table** (D-brief §4). `[Web research]` Salesforce's `AccountContactRelation`
exists precisely because a person legitimately relates to more than one entity **with a role**
(official_vendor_doc — developer.salesforce.com AccountContactRelation). `[Inference]` A households table asserts
a permanent grouping the business does not have — **the same two people may be joint buyers on one unit and not
on another** — and then demands lifecycle management for the grouping itself. A `crm_deal_party` junction
(deal × contact × role, one primary) expresses the real requirement with no extra lifecycle.

Illustrative only — **not a migration**, shape only:

```sql
-- ILLUSTRATIVE DDL — NOT A MIGRATION. Do not run.
-- The dedup engine is a constraint, not an application rule.
create table crm_contact_method (
  id                uuid primary key,
  contact_id        uuid not null,
  kind              text not null,   -- 'phone' | 'email' | 'other'  (NOT 'whatsapp')
  raw_value         text not null,   -- exactly what the human typed
  normalized_value  text not null,   -- computed in TypeScript, never a generated column
  channels          text[],          -- e.g. {'whatsapp','telegram'} on a phone row
  match_hint        text,            -- gmail dot/plus collapse — a HINT, never the key
  valid_flag        boolean,         -- libphonenumber said "invalid"; store, flag, never block
  created_at        timestamptz not null default now()
);
create unique index crm_contact_method_identity_uq
  on crm_contact_method (kind, normalized_value);
```

---

## 8. Synthesis — adopt / adapt / defer / reject for Forever

`[Recommendation]` One consolidated verdict per pattern. Every row carries its reason.

| # | Pattern | Verdict | Reason (one line) |
|---|---|---|---|
| S1 | Durable Person spine + episodic work item | **Adopt** | Three vendors converged on it independently and encoded it in their API contracts; D1. |
| S2 | Separate Lead object with destructive conversion | **Reject** | Irreversible, leaves the source read-only, cascades activity deletes; Zoho ships an API to mitigate the duplicates it creates. |
| S3 | `public.leads` as a vetted **Enquiry** landing log, never accreted into | **Adopt** | Reapit's documented Enquiry→Applicant promotion is the exact fix for an orphaned intake table; D1/D2. |
| S4 | E.164 phone as the primary identity key | **Adopt** | Buyers arrive by WhatsApp/Telegram where email is absent or disposable; email-primary is a B2B-SaaS artefact. |
| S5 | `(kind, normalized_value)` UNIQUE index as the dedup engine | **Adopt** | HubSpot's own docs concede dedupe fails on API and form intake — a constraint holds on every path. |
| S6 | Normalize phone/email in TypeScript, not SQL | **Adopt** | PG generated columns require immutable, single-row expressions; E.164 is neither. |
| S7 | Store-and-flag invalid phones; never `isValidNumberForRegion` | **Adopt** | Google: "many people have phone numbers that do not belong to the country they live in" — Forever's buyers exactly. |
| S8 | Deterministic matching + unindexed human-reviewed candidate view | **Adopt** | Splink concedes deterministic is cheap and high-precision; low recall is human-fixable at hundreds of rows. |
| S9 | Probabilistic linkage (Splink / Fellegi-Sunter) | **Reject** | Needs volume to train and cannot be explained to an agent who disputes a merge. |
| S10 | soundex / metaphone name matching | **Reject** | PostgreSQL's own manual: fails on UTF-8 and non-English names; half of Forever's names are Cyrillic. |
| S11 | Tombstone-and-repoint merge, primary-wins + null-fill | **Adopt** | HubSpot's deterministic rule ships; Salesforce's field-picker UI is why merge doesn't. |
| S12 | Field-by-field merge picker UI | **Reject** | A whole screen and a support-question class, for a decision one function can make. |
| S13 | `crm_deal_party` junction; **no** households table | **Adopt** | The same two people may be joint buyers on one unit and not another — a household asserts a grouping that doesn't exist. |
| S14 | Append-only journal/event table as backbone | **Adopt** | Reapit and iamproperty both do it; every feed and attribution argument becomes a projection. |
| S15 | Activities as one table with a channel enum incl. messaging | **Adopt** | HubSpot needed a second object (0-18) to retrofit messaging — evidence the email-shaped model breaks. |
| S16 | Next action required at the DB layer on every open item | **Adopt** | Stronger than any vendor; Pipedrive's rotting "disregards the next activity date" and is silently resettable. |
| S17 | Idle-time rotting as the primary staleness signal | **Reject** | Measures recent touching, not committed next steps; produces false comfort. |
| S18 | Ordered first-match-wins routing + mandatory default + routing log | **Adopt** | Deterministic and debuggable; the log settles allocation arguments, the CRM's real political job at 5–15 agents. |
| S19 | Working-hours / away gating with fall-through | **Adopt** | Agents UTC+7, clients UTC+2..+4; a 20:00 Moscow enquiry is 00:00 Phuket. |
| S20 | Claim window ≤30 min with a bounded fallback chain terminating at a named human | **Adopt** | FUB's documented cap; a lead can never end unowned. |
| S21 | Owner (credit, permanent) vs Assignee (work, revocable) | **Adopt** | Lofty's documented split; decouples credit from workload and removes the hoarding incentive. |
| S22 | 21-day calendar ownership lock as the default | **Reject as default; retain as configurable policy** | No vendor doc, no standard; rewards inactivity. D4 makes reclaim activity-driven and the rule a versioned policy row. |
| S23 | Pond as a shared unclaimed pool | **Adapt** | Adopt the visibility; model it as assignment state, not a synthetic pseudo-agent user. |
| S24 | Weighted "hunger" allocation | **Defer** | Solves unequal capacity Forever does not yet have; naive rotation + routing log suffices. |
| S25 | Kommo-style cache-based round-robin | **Reject** | Documented resets on 30-day non-use, option edits and cache clears — fairness state must be durable rows. |
| S26 | Sequences with enumerated pause conditions, volume caps, idempotency rules | **Adopt as spec** | Free, hard-won vendor scar tissue; deriving it independently costs a year of bugs. |
| S27 | Per-step human-in-the-loop send gate, default `auto_send = false` | **Adopt** | High-ticket two-language advisory; a wrong automated message is expensive. |
| S28 | "Wait until event, with fallback timeout" → Met / Not-Met branches | **Adopt** | One primitive expresses every SLA and escalation rule without a separate subsystem. |
| S29 | General workflow/automation engine | **Defer** | HubSpot's re-enrolment replays every action from the start; four interacting rules a small team won't maintain. |
| S30 | Viewing as an entity with an explicit lifecycle | **Adopt** | Off-plan viewings are the highest-signal event and are currently unmodelled entirely. |
| S31 | Two-tier feedback (private → curated public) + structured dimensions + a queue that only an explicit act clears | **Adopt** | iamproperty's full pattern; the queue distinguishes "no feedback" from "tried and failed". |
| S32 | Feedback → matching as an explicit human-confirmed filter edit | **Adapt** | Nobody documents this loop; and NAV-001 §09 forbids any score or ranking — narrow filters, never score. |
| S33 | Unit status with a **time-boxed** hold | **Adopt** | A hold without a TTL becomes permanent inventory rot. |
| S34 | Off-plan deal as dated milestones with amounts | **Adopt** | Spark separates document / deal / unit state; Thai off-plan is a payment schedule, not a status string. |
| S35 | Commission attribution created at registration/reservation | **Adopt** | Developer disputes are settled by who registered the client first, not who closed. |
| S36 | Agent-vs-buyer discrimination at the capture form | **Adopt** | Co-broke partners need different nurture, data and terms; cleaning it up later never happens. |
| S37 | Multi-currency as `(amount_minor, currency)` + captured `fx_rate`/`rate_date` | **Adopt** | Undocumented in every examined product; a THB/RUB/EUR/USD brokerage must build it. |
| S38 | Language as a first-class routing input | **Adopt** | Not routable natively anywhere; RU/EN is Forever's primary segmentation. |
| S39 | Hierarchical Area entity | **Adapt** | Locality is the dominant Phuket criterion and is not a string; "west coast" must match Bang Tao. |
| S40 | jsonb extension metadata on core entities | **Adapt** | Keeps the core schema small — honour Reapit's caveat: **never** PII or sensitive data in extension storage. |
| S41 | Salesforce-style layered sharing / role hierarchy / FLS | **Reject** | Its stated rationale is preventing internal competition; at Forever mutual cover *is* the operating model. |
| S42 | `auth.uid()` RLS policies | **Reject for v1 (D3)** | A second authorization paradigm alongside the shipped app-server boundary; forfeited DB defence-in-depth recorded, review trigger set. |
| S43 | Supabase RLS performance rules (subselect, `TO authenticated`, indexed policy columns, one policy per action) | **Defer, as the binding standard if D3's trigger fires** | Unmeasurable at hundreds of rows; free to apply correctly when needed. |
| S44 | Role/team in a JWT claim | **Reject** | Supabase: claims are stale until refresh, with no documented revocation. |
| S45 | Authorization from `raw_user_meta_data` | **Reject — always** | User-editable; a complete authz bypass. |
| S46 | Enumerated service-role boundary + server-only module gate + bundle grep | **Adopt** | Supabase sanctions the design for servers implementing prior authorization; the cost is enumeration and no leakage. |
| S47 | Durable work items + idempotent sweeper (reusing the Studio job pattern in a separate table) | **Adopt** | D5; `pg_net` is fire-and-forget on UNLOGGED tables and must never carry an SLA. |
| S48 | `cron.job_run_details` prune + scheduler heartbeat, day one | **Adopt** | pg_cron never cleans history; the scheduler can die and the symptom is silence. |
| S49 | pgmq / Supabase Queues | **Defer** | "Exactly once" is scoped to a visibility timeout — at-least-once with a dedup window. |
| S50 | Realtime as a cache-invalidation ping | **Adopt** | No replay, DELETE unfilterable — never a queue or a delivery guarantee. |
| S51 | pgAudit as the CRM audit trail | **Reject** | Writes to logs, not tables; cannot answer "who viewed this buyer". |
| S52 | Trigger row-audit on identity/deal tables only + separate business journal | **Adopt** | Supabase advises against tracking everything; forensic diff and business timeline are different artefacts. |
| S53 | Anonymize-in-place **and purge audit history** | **Adopt** | `old_record` holds the exact PII; the easiest way to fake compliance is to forget it. |
| S54 | Consent as an append-only record pointing at an immutable wording version | **Adopt** | s19: non-compliant consent has no binding effect; s82 fines up to THB 1M; D8. |
| S55 | Marketing consent physically separate, defaulting FALSE | **Adopt** | Explicit statutory text — a bundled checkbox is void as to marketing. |
| S56 | Lawful basis bound at collection, per person per purpose, immutable | **Adopt** | PDPA s24 + s27; you cannot silently re-base later. |
| S57 | Retention per **purpose**, anchored to named statutes | **Adopt** | Closed-deal AMLA records must survive a marketing withdrawal; per-person retention forces choosing which law to breach. |
| S58 | `crm_dsr_request` with generated due date + 2-year evidence retention | **Adopt — dated** | The access-request notification takes effect 14 Sep 2026 and mandates office + postal intake. |
| S59 | Erasure pipeline scoped to 90 days including backups | **Adopt** | Notification effective 11 Nov 2024; it is a backup-configuration decision, so decide before configuring. |
| S60 | Breach record with `detected_at` ≠ `became_aware_at` + 15-day backstop | **Adopt** | The 72h clock hangs off reasonable belief, not the first alert. |
| S61 | RoPA as a `processing_purpose` table driving notice + retention + s39 | **Adopt** | The SME exemption probably fails (non-occasional processing); one table beats three stale documents. |
| S62 | `nationality` used for marketing segmentation | **Reject** | Not on the s26 list, but ethnic-reading segmentation approaches the only tier carrying imprisonment. Store language + country of residence. |
| S63 | Identity documents in the CRM | **Reject** | Thai IDs carry religion, passports carry place of birth — s26 contamination of the whole system. |
| S64 | Structured neutral alternatives to free-text notes | **Adopt** | Free text is the primary s26 leak; record the requirement, not the reason. |
| S65 | Article 27 EU representative | **Defer, pending an explicit written EU-targeting decision** | Mere accessibility does not trigger Art 3(2); EUR pricing or EU ad spend would. |
| S66 | WhatsApp Cloud API integration in v1 | **Reject (D6)** | Service messages become billable 1 Oct 2026 at rates unpublished until 1 Sep 2026; the case expires before it ships. |
| S67 | Self-onboarding the agents' number to Cloud API | **Reject — absolutely** | Deletes the account, loses all history, permanently locks the number out of the Business App. |
| S68 | Coexistence via a BSP, if integration ever proceeds | **Defer** | The only safe route — but it forfeits programmatic BSP-to-BSP migration, so it is stickier lock-in. |
| S69 | Channel-agnostic `contact_channel` with `channels[]` on the phone row | **Adopt** | WhatsApp is a capability of a phone number; a separate kind creates a second identifier space to reconcile. |
| S70 | Manual outcome capture with pre-declared kill criteria | **Adopt** | The API tells you what was said; it does not tell you what happened. These solve different problems. |
| S71 | Shared WhatsApp inbox inside the Forever product | **Reject** | Reimplementing a messaging client for a handful of agents; the app's own multi-agent tier already exists. |
| S72 | Template management / approval UI | **Reject** | Templates matter only outside the 24h window, and conversations here are client-initiated. |
| S73 | Marketing-category templates from the agents' number | **Reject — absolute rule** | Template pausing and quality degradation are driven almost entirely by marketing templates. |
| S74 | Send-only email from a dedicated subdomain + BCC dropbox | **Adopt** | Avoids Google's restricted scopes entirely; `gmail.send` is only sensitive. |
| S75 | Internal-only Workspace OAuth app, if mailbox access is ever needed | **Adapt — pending U15** | Exempt from verification, the unverified-app screen and the 100-user cap. Needs an Owner answer first. |
| S76 | `.ics` + calendar template link on every booked viewing | **Adopt** | No OAuth, no token refresh, works for Google/Apple/Outlook. |
| S77 | Two-way calendar sync | **Reject for v1** | Conflict resolution, tombstones, timezones and channel renewal, for something an .ics does in one tap. |
| S78 | Calendar push channels | **Reject** | Notifications carry no payload, so you call the API anyway; channels expire with no auto-renewal. |
| S79 | Median time-to-first-response by source as the headline metric | **Adopt** | The repository's own exit criterion; a mean is destroyed by one late lead. |
| S80 | The 5-minute rule as a literal target, and the 100x/21x/78% figures | **Reject** | Vendor-published, observational, ~19 years old, misattributed — and 78% has no primary source at all. |

---

## 9. Anti-patterns catalogue — what not to copy, and why

### 9.1 Data model

| # | Anti-pattern | Evidence |
|---|---|---|
| AP1 | **Destructive lead conversion.** Before conversion the same human can exist as both a Lead and a Contact with no link, splitting history exactly where it matters | Salesforce: converted lead "becomes a read-only record"; conversion cannot be undone; deleting a shared activity from one resulting record removes it from the others (official_vendor_doc) |
| AP2 | **Email or company domain as the primary identity key** in a messaging-first, non-Anglophone market | HubSpot's dedupe assumes B2B SaaS; "company domain" is meaningless for individual buyers (official_vendor_doc) |
| AP3 | **Trusting automatic dedupe uniformly across ingestion paths** | HubSpot: companies created via API are **not** deduplicated by domain; unique-value properties are "Not supported in forms" — the two highest-volume routes (official_vendor_doc) |
| AP4 | **Letting an 11-column intake table become the CRM by accretion** | `[Repository fact]` `public.leads` has no identity to hang off and **no read path back into the product** (`src/lib/lead-service.ts:92` is the only `from("leads")` occurrence, and it only inserts). Widening it preserves the actual defect. |
| AP5 | **A `households` table** | Asserts a permanent grouping the business does not have, then demands lifecycle management for it. |
| AP6 | **Two hand-maintained status fields** (person lifecycle stage + deal stage) that nobody reconciles | The split is correct; maintaining both by hand is not. Derive one; capture stage-entry timestamps automatically. |
| AP7 | **Persisting a "Forever ID"** | `[Repository fact]` Two incompatible formats exist for the same project (`FOREVER-<SLUG>` vs the bare slug). Persist slug or UUID; derive any display ID. |

### 9.2 Process and workflow

| # | Anti-pattern | Evidence |
|---|---|---|
| AP8 | **Idle-time rotting instead of an explicit next action** | Pipedrive's own KB: rotting "disregards the next activity date"; an invisible email action resets the timer (official_vendor_doc) |
| AP9 | **Building an automation engine before instrumenting anything** | HubSpot's re-enrolment replays every action from the start and silently drops date/count refinements (official_vendor_doc) |
| AP10 | **Multiple pipelines before one works** | Pipedrive's own suggested fix for rotting mismatch is *add more pipelines* — trading one problem for many half-maintained processes (official_vendor_doc) |
| AP11 | **Weighted forecasting at low volume with unconfigured probabilities** | Pipedrive defaults every stage to 100%: weighted value = total value, a forecast containing no information (official_vendor_doc) |
| AP12 | **Assuming time-based dormancy reclaim is standard** | Follow Up Boss FAQ answers "auto-place in a pond after X time?" with **no**; its triggers are all event-based (official_vendor_doc) |
| AP13 | **A 21-day ownership lock as the primary fairness mechanic** | No vendor documentation and no industry standard found; rewards twenty days of inactivity |
| AP14 | **Pure first-to-claim treated as fair** | FUB documents it: push-only notifications, and swiping instead of tapping can clear the notification and prevent claiming (official_vendor_doc) |
| AP15 | **A claim window measured in hours** | FUB caps unclaimed at 30 minutes "to ensure timely automated communication" — the only documented benchmark (official_vendor_doc) |
| AP16 | **Sequences that cannot resume** | Spark: re-applying a schedule "will override any previously applied follow-up schedules and begin the new schedule from the first task" (official_vendor_doc) |
| AP17 | **Bulk operations silently bypassing automation** | FUB: automations "will not be triggered when performing a Mass Action" — a whole class of silent failure (official_vendor_doc) |
| AP18 | **Cache-held rotation state** | Kommo Round Robin resets on 30-day non-use, on option edits, and on cache resets (official_vendor_doc) |
| AP19 | **Enterprise ownership machinery** | Lofty ships a toggle whose documented purpose is to *hide* the ownership concepts from users (official_vendor_doc) |
| AP20 | **Assuming viewing feedback improves matching** | No documentation of that loop in any of the five real-estate systems examined |

### 9.3 Evidence and marketing

| # | Anti-pattern | Evidence |
|---|---|---|
| AP21 | **Citing the 5-minute rule as a Harvard finding** | 100x/21x are MIT/InsideSales 2007 — six companies, vendor-published, observational. HBR 2011's own numbers are 42 hours, 23% never responding, ~7x within an hour |
| AP22 | **Treating 2024–2026 "speed to lead benchmarks" as current data** | Every such page located is published by a lead-response vendor, and they contradict each other: 42-hour median vs 47-hour average vs 13-minute median |
| AP23 | **Quoting "78% buy from the first responder"** | No traceable primary source; the trail ends at social posts |
| AP24 | **Building a business case on "X% of CRM projects fail"** | 2001 Gartner 50%+, 2002 Butler 70%, 2006 AMR 31%, 2009 Forrester 47% — no shared definition of failure (secondary) |

### 9.4 Privacy and compliance

| # | Anti-pattern | Evidence |
|---|---|---|
| AP25 | **Copying a GDPR-shaped privacy model wholesale** | PDPA binds the basis at collection (s24) and s27 gates later use on the original collection — a per-operation basis model cannot represent it |
| AP26 | **Consent as a boolean on the person row** | No timestamp, method, locale, wording pointer or withdrawal history — and s19 makes non-compliant consent void |
| AP27 | **Bundling marketing consent into terms acceptance** | s19 requires the request to be "clearly distinguishable from the other matters" — explicit statutory text |
| AP28 | **"Legitimate interest" as a schema label with no written balancing assessment** | s24(5) is expressly qualified; the basis only exists if the balancing was actually done |
| AP29 | **Hard DELETE as erasure** | The 2024 Notification reaches copies and backups within 90 days; default PITR retention will outlive it |
| AP30 | **Anonymizing a contact without purging the audit history** | Trigger audit rows store the exact PII in `old_record` |
| AP31 | **Retention modelled on the person record** | Closed-deal AMLA records must survive a next-day marketing withdrawal |
| AP32 | **Assuming the SME RoPA exemption applies** | s39 para 3 disapplies it for non-occasional processing; a CRM is by definition not occasional |
| AP33 | **"We're small, so no DPO"** without a written assessment | The DPO Notification catches profiling activity, not only the 100,000 threshold |
| AP34 | **Passport/ID scans in the CRM** | Thai IDs carry religion, passports carry place of birth — the only PDPA tier with imprisonment |
| AP35 | **Treating a privacy policy as the compliance deliverable** | Notice, basis, consent evidence, records and security are five distinct obligations |
| AP36 | **Assuming Thai or EU adequacy** | Thailand is absent from the Commission's list, and no Thai allowlist was found |

### 9.5 Integration and platform

| # | Anti-pattern | Evidence |
|---|---|---|
| AP37 | **Self-onboarding the existing number to Cloud API "to try it out"** | Deletes the account, destroys history, permanently blocks the number in the Business App. No undo (official_vendor_doc) |
| AP38 | **Justifying integration with "replies inside the window are free"** | True from Nov 2024; **stops being true 1 Oct 2026**, with rates unpublished until 1 Sep 2026 (official_vendor_doc) |
| AP39 | **Copying vendor pricing pages that still describe conversation-based pricing** | Conversation-based pricing and the 1,000 free service conversations were retired 1 Jul 2025 — a stale page is a dated page |
| AP40 | **Planning around "getting the number banned"** | Flagged and Restricted statuses were discontinued 7 Oct 2025; limits start at 250 recipients/24h (official_vendor_doc) |
| AP41 | **Verifying `X-Hub-Signature-256` against a re-serialised body** | Frameworks re-stringify JSON, changing whitespace/key order; the HMAC fails intermittently or passes only locally |
| AP42 | **Assuming the 36-hour retry figure applies to WhatsApp** | The WhatsApp-specific doc says up to 7 days; the two primary pages conflict (U5) |
| AP43 | **Hardwiring WhatsApp into the schema** | Beyond the Russia access risk, it makes the data model a bet on one vendor's continued availability |
| AP44 | **Accepting "we handle WhatsApp compliance" from a BSP as covering opt-in** | Meta places opt-in squarely on the business and prescribes no method |
| AP45 | **Treating manual outcome logging as a temporary embarrassment** | The API tells you what was *said*; it does not tell you what *happened* |
| AP46 | **Starting email with `gmail.readonly` / `modify` / IMAP scraping** | Restricted scopes trigger an annual third-party security assessment if stored server-side |
| AP47 | **Two-way calendar sync in v1** | Conflict resolution, tombstones, timezone correctness and channel renewal, for no v1 benefit |
| AP48 | **Bare `auth.uid() = owner_id` in a policy** | Supabase lint 0003; 11,000 ms vs 10 ms in their own benchmark. Four characters. |
| AP49 | **Several permissive policies for the same table+action** | They OR together, so adding a policy can only widen access — invisibly (lint 0006) |
| AP50 | **A policy on a table that sub-selects from that same table** | The literal recipe for `infinite recursion detected in policy` |
| AP51 | **SECURITY DEFINER helpers in an exposed schema** | Supabase: they "should never be created in a schema in the Exposed schemas" |
| AP52 | **Recursion-breaking helpers written `language sql`** | The planner can inline them, discarding the SECURITY DEFINER context (U7 — community-documented) |
| AP53 | **Service-role everywhere by default** | A legitimate architecture only when the boundary is enumerated; defaulting to it removes the last backstop |
| AP54 | **Letting the secret key reach the client bundle** | TanStack Start co-locates server and client code; an errant import ships it |
| AP55 | **`pg_net` for anything that must not be lost** | UNLOGGED tables "not preserved during a crash or unclean shutdown", purged after 6 hours |
| AP56 | **Assuming pg_cron just works** | Supabase documents the scheduler worker dying — and the symptom is silence |
| AP57 | **Letting `cron.job_run_details` grow unbounded** | pg_cron "does not clean up historical records"; Supabase warns it becomes "extremely large" |
| AP58 | **Realtime as a queue** | No documented replay; a dropped websocket loses events silently |
| AP59 | **Stripping gmail dots as a general rule** | Google: for Workspace/custom domains "dots do change your address" — a blanket strip merges two people |
| AP60 | **Stripping plus-addressing from the send address** | A deliberate user choice; stripping can break filters or deliverability |
| AP61 | **Rejecting a lead whose phone fails `isValidNumber`** | Working numbers fail validation; rejection silently discards real buyers |
| AP62 | **Re-validating stored numbers on a schedule and flipping them invalid** | Numbering-plan metadata changes; the data did not |
| AP63 | **`citext` for emails** | PG docs: LC_CTYPE-dependent folding, not Unicode-correct, less efficient, loses B-tree dedup |
| AP64 | **E.164 in a generated column** | PG requires immutable, single-row expressions; E.164 needs a default region |
| AP65 | **A GIN/GiST trigram index for the duplicate-candidate view at this row count** | A seq scan over hundreds of rows is sub-millisecond; the index is pure maintenance |

---

## 10. Source register

`[Web research]` Every URL below was returned by the Phase-1 research sweep dated 2026-07-28. **No URL in this
document was invented or inferred.** Claims for which no retrievable source existed were downgraded to
`[Inference]` or dropped.

### 10.1 General CRM vendors

| Class | Source |
|---|---|
| official_vendor_doc | https://developers.hubspot.com/docs/guides/crm/understanding-the-crm |
| official_vendor_doc | https://developers.hubspot.com/docs/api-reference/latest/crm/objects/leads/guide |
| official_vendor_doc | https://knowledge.hubspot.com/records/deduplication-of-records |
| official_vendor_doc | https://knowledge.hubspot.com/workflows/add-re-enrollment-triggers-to-a-workflow |
| official_vendor_doc | https://knowledge.hubspot.com/records/merge-records |
| official_vendor_doc | https://help.salesforce.com/s/articleView?id=sales.faq_leads_what_happens_when.htm&type=5 |
| official_vendor_doc | https://developer.salesforce.com/docs/atlas.en-us.api.meta/api/sforce_api_calls_convertlead.htm |
| official_vendor_doc | https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_lead.htm |
| official_vendor_doc | https://help.salesforce.com/s/articleView?language=en_US&id=sales.leads_notes.htm&type=5 |
| official_vendor_doc | https://architect.salesforce.com/docs/architect/fundamentals/guide/platform-sharing-architecture |
| official_vendor_doc | https://help.salesforce.com/s/articleView?id=platform.security_sharing_owd_about.htm&language=en&type=5 |
| official_vendor_doc | https://help.salesforce.com/s/articleView?id=xcloud.salesforce_app_today.htm&language=en_US&type=5 |
| official_vendor_doc | https://help.salesforce.com/s/articleView?id=sales.contacts_considerations_for_merging_duplicates.htm&language=en_US&type=5 |
| official_vendor_doc | https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_accountcontactrelation.htm |
| official_vendor_doc | https://developers.pipedrive.com/docs/api/v1/Leads |
| official_vendor_doc | https://developers.pipedrive.com/docs/api/v1/Stages |
| official_vendor_doc | https://developers.pipedrive.com/docs/api/v1/DealFields |
| official_vendor_doc | https://support.pipedrive.com/en/article/the-rotting-feature |
| official_vendor_doc | https://support.pipedrive.com/en/article/probability-in-pipedrive |
| official_vendor_doc | https://docs.attio.com/docs/objects-and-lists |
| official_vendor_doc | https://attio.com/help/reference/attio-101/attios-data-model/understanding-attio-data-model |
| official_vendor_doc | https://attio.com/help/reference/attio-101/syncing-people-and-companies |
| official_vendor_doc | https://attio.com/help/reference/managing-your-data/records/create-and-view-records |
| official_vendor_doc | https://www.zoho.com/crm/developer/docs/api/v8/convert-lead.html |

### 10.2 Real-estate CRM vendors

| Class | Source |
|---|---|
| official_vendor_doc | https://help.followupboss.com/hc/en-us/articles/360014656193-First-to-Claim |
| official_vendor_doc | https://help.followupboss.com/hc/en-us/articles/360014656033-Lead-Flow-Advanced-Lead-Flow-Rules |
| official_vendor_doc | https://help.followupboss.com/hc/en-us/articles/1500008539982-Action-Plans-Overview |
| official_vendor_doc | https://help.followupboss.com/hc/en-us/articles/360048951553-Automations-Overview |
| official_vendor_doc | https://help.followupboss.com/hc/en-us/articles/360048829034-Lead-Ponds-Overview |
| official_vendor_doc | https://help.lofty.com/hc/en-us/articles/360055177831-Lead-Routing-How-to-set-up-lead-routing-rules |
| official_vendor_doc | https://help.lofty.com/hc/en-us/articles/360047876811-In-Depth-Round-Robin-Next-Up |
| official_vendor_doc | https://help.lofty.com/hc/en-us/articles/115003544406-Lead-Ownership |
| official_vendor_doc | https://help.lofty.com/hc/en-us/articles/360061564771-Reassignment-Groups |
| official_vendor_doc | https://help.lofty.com/hc/en-us/articles/45537578767643-Smart-Plan-Builder |
| official_vendor_doc | https://knowledge.spark.re/contract-statuses |
| official_vendor_doc | https://knowledge.spark.re/follow-up-schedules |
| official_vendor_doc | https://knowledge.spark.re/registration-form-settings |
| official_vendor_doc | https://www.spark.re/product/inventory |
| official_vendor_doc | https://foundations-documentation.reapit.cloud/platform-glossary |
| official_vendor_doc | https://helpcentre.iamproperty.com/hc/en-gb/articles/36387556001553-Leaving-Viewing-Feedback-in-CRM |
| official_vendor_doc | https://helpcentre.iamproperty.com/hc/en-gb/articles/36400839368593-Viewing-and-Managing-Viewer-Feedback-for-a-Property-Viewing |
| official_vendor_doc | https://support.kommo.com/docs/round-robin-in-salesbot-overview |
| official_vendor_doc | https://support.kommo.com/docs/set-up-digital-pipeline-triggers |
| secondary | https://www.fazwaz.com/advice/the-purchase-process-off-plan-vs-resale |
| secondary | https://www.prnewswire.com/news-releases/lone-wolf-acquires-propertybase-to-complete-real-estates-ultimate-technology-platform-for-agents-and-brokers-301362315.html |

### 10.3 Speed-to-lead evidence base

| Class | Source |
|---|---|
| industry_report | https://25649.fs1.hubspotusercontent-na2.net/hub/25649/file-13535879-pdf/docs/mit_study.pdf — the 2007 Oldroyd/InsideSales study; primary source of the 100x/21x multipliers |
| industry_report | https://hbr.org/2011/03/the-short-life-of-online-sales-leads — the actual HBR 2011 article (42 hours; 23% never responded; ~7x within an hour) |
| secondary | https://ainora.lt/blog/lead-response-time-statistics-every-study-2026 — the clearest available reconstruction of the misattribution chain |
| secondary | https://caseyresponse.com/blog/lead-response-time-statistics — representative example of the vendor-marketing repetition problem |
| secondary | https://johnnygrow.com/crm/the-crm-failure-rate-is-55-percent/ — CRM failure-rate statistics lack a shared definition |
| secondary | https://crmsearch.com/implementation/crm-fail/ — the 2001–2009 citation chain behind the failure-rate folklore |

### 10.4 Thai PDPA and cross-border privacy

| Class | Source |
|---|---|
| official_regulator | https://www.mdes.go.th/law/detail/3577-Personal-Data-Protection-Act-B-E--2562--2019- — unofficial English translation, hosted by the Ministry of Digital Economy and Society |
| official_regulator | https://www.ratchakitcha.soc.go.th/DATA/PDF/2562/A/069/T_0052.PDF — Royal Gazette, Vol. 136 Part 69 Gor, 27 May 2019 (authoritative Thai text) |
| official_regulator | https://www.pdpc.or.th/ — the Personal Data Protection Committee |
| official_regulator | https://www.edpb.europa.eu/system/files/documents/files/file1/edpb_guidelines_3_2018_territorial_scope_after_public_consultation_en_1.pdf |
| official_regulator | https://commission.europa.eu/law/law-topic/data-protection/international-dimension-data-protection/adequacy-decisions_en |
| official_regulator | https://mfiu.gov.mm/sites/default/files/document/files/AMLO%20-%207%20-Thailand%27s%20AML-CFT%20System%20-%20Power%20Point.pdf — AMLO listing, item 4: "Real estate brokers or agents" |
| industry_report | https://practiceguides.chambers.com/practice-guides/data-protection-privacy-2026/thailand/trends-and-developments |
| secondary | https://clinregs.niaid.nih.gov/sites/default/files/documents/thailand/PersonalDataConsentGuidelines-GoogleTranslation.pdf — machine translation of the PDPC consent guidelines |
| secondary | https://www.tilleke.com/insights/thailand-pdpc-notification-on-data-breaches/10/ |
| secondary | https://privacymatters.dlapiper.com/2025/02/thailand-pdpcs-clarification-on-personal-data-breach-notification/ |
| secondary | https://www.lawplusltd.com/2024/08/rules-on-deletion-destruction-or-anonymization-of-personal-data/ |
| secondary | https://www.lexology.com/library/detail.aspx?g=c144fd43-9ba7-4065-a8ee-f1739ff3a11d — Tilleke on the 2026 access-request notification |
| secondary | https://lexbangkok.com/data-subject-access-requests-thailand/ |
| secondary | https://www.grandlinux.com/en/blogs/pdpa-data-subject-access-request-2026.html — corroborates the 14 September 2026 effective date |
| secondary | https://www.linklaters.com/en/insights/blogs/digilinks/2024/january/thailand---new-rules-for-transborder-dataflow |
| secondary | https://www.dataprotectionreport.com/2024/01/thailand-the-regulation-with-respect-to-cross-border-transfer-of-personal-data/ |
| secondary | https://www.hsfkramer.com/notes/data/2025-posts/pdpa-fines-and-firsts-a-6-year-timeline-of-thailands-data-privacy-enforcement |
| secondary | https://www.tilleke.com/insights/thailand-releases-notification-on-data-protection-officer-appointment/25/ |
| secondary | https://www.kennedyslaw.com/en/thought-leadership/article/guidelines-on-key-compliance-requirements-for-the-personal-data-protection-act-in-thailand/ |
| secondary | https://www.dlapiperdataprotection.com/index.html?t=law&c=TH |
| secondary | https://www.linklaters.com/en/insights/data-protected/data-protected---thailand |
| secondary | https://gdpr-info.eu/art-27-gdpr/ |
| secondary | https://www.juslaws.com/articles/anti-money-laundering-thailand-2026-compliance-guide |
| secondary | https://www.samuiforsale.com/law-texts/accounting-act.html |
| secondary | https://www.morganlewis.com/-/media/files/publication/outside-publication/article/2021/data-localization-laws-russian-federation.pdf |

### 10.5 WhatsApp, email and calendar

| Class | Source |
|---|---|
| official_vendor_doc | https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing |
| official_vendor_doc | https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages |
| official_vendor_doc | https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/migrate-existing-whatsapp-number-to-a-business-account/ |
| official_vendor_doc | https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users |
| official_vendor_doc | https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages |
| official_vendor_doc | https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview |
| official_vendor_doc | https://developers.facebook.com/docs/graph-api/webhooks/getting-started |
| official_vendor_doc | https://www.facebook.com/business/help/896873687365001 |
| official_vendor_doc | https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits |
| official_vendor_doc | https://developers.facebook.com/documentation/business-messaging/whatsapp/throughput |
| official_vendor_doc | https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/support/migrating-phone-numbers-among-solution-partners-programmatically |
| official_vendor_doc | https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview |
| official_vendor_doc | https://whatsappbusiness.com/policy/ |
| official_vendor_doc | https://www.twilio.com/en-us/whatsapp/pricing |
| official_vendor_doc | https://www.360dialog.com/pricing |
| official_vendor_doc | https://faq.whatsapp.com/647349420360876 |
| official_vendor_doc | https://faq.whatsapp.com/395911122612120 |
| official_vendor_doc | https://developers.google.com/workspace/gmail/api/auth/scopes |
| official_vendor_doc | https://support.google.com/cloud/answer/13464323 |
| official_vendor_doc | https://support.google.com/cloud/answer/13464321 |
| official_vendor_doc | https://developers.google.com/workspace/calendar/api/guides/push |
| official_vendor_doc | https://developers.google.com/workspace/calendar/api/auth |
| secondary | https://www.dw.com/en/russia-moves-to-block-whatsapp-as-moscow-pushes-state-backed-rival/a-75922756 |

### 10.6 Supabase, Postgres and identity resolution

| Class | Source |
|---|---|
| official_vendor_doc | https://supabase.com/docs/guides/database/postgres/row-level-security |
| official_vendor_doc | https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv |
| official_vendor_doc | https://supabase.com/docs/guides/database/database-advisors?lint=0003_auth_rls_initplan |
| official_vendor_doc | https://supabase.com/docs/guides/database/postgres/custom-claims-and-role-based-access-control-rbac |
| official_vendor_doc | https://supabase.com/docs/guides/api/api-keys |
| official_vendor_doc | https://supabase.com/docs/guides/database/hardening-data-api |
| official_vendor_doc | https://supabase.com/docs/guides/api/securing-your-api |
| official_vendor_doc | https://supabase.com/docs/guides/troubleshooting/do-i-need-to-expose-security-definer-functions-in-row-level-security-policies-iI0uOw |
| official_vendor_doc | https://supabase.com/docs/guides/realtime/postgres-changes |
| official_vendor_doc | https://supabase.com/docs/guides/realtime/authorization |
| official_vendor_doc | https://supabase.com/docs/guides/realtime/broadcast |
| official_vendor_doc | https://supabase.com/docs/guides/cron |
| official_vendor_doc | https://supabase.com/docs/guides/troubleshooting/pgcron-debugging-guide-n1KTaz |
| official_vendor_doc | https://github.com/citusdata/pg_cron |
| official_vendor_doc | https://supabase.com/docs/guides/database/extensions/pg_net |
| official_vendor_doc | https://supabase.com/docs/guides/functions/schedule-functions |
| official_vendor_doc | https://supabase.com/docs/guides/functions/limits |
| official_vendor_doc | https://supabase.com/docs/guides/functions/background-tasks |
| official_vendor_doc | https://supabase.com/docs/guides/queues |
| official_vendor_doc | https://github.com/pgmq/pgmq |
| official_vendor_doc | https://github.com/supabase/supa_audit |
| official_vendor_doc | https://supabase.com/blog/postgres-audit |
| official_vendor_doc | https://supabase.com/docs/guides/database/extensions/pgaudit |
| official_vendor_doc | https://supabase.com/docs/guides/auth/managing-user-data |
| official_vendor_doc | https://developers.cloudflare.com/workers/configuration/cron-triggers/ |
| official_vendor_doc | https://github.com/google/libphonenumber |
| official_vendor_doc | https://github.com/google/libphonenumber/blob/master/FAQ.md |
| official_vendor_doc | https://support.google.com/mail/answer/7436150 |
| official_regulator | https://www.postgresql.org/docs/current/ddl-rowsecurity.html |
| official_regulator | https://www.postgresql.org/docs/current/ddl-generated-columns.html |
| official_regulator | https://www.postgresql.org/docs/current/indexes-unique.html |
| official_regulator | https://www.postgresql.org/docs/current/pgtrgm.html |
| official_regulator | https://www.postgresql.org/docs/current/fuzzystrmatch.html |
| official_regulator | https://www.postgresql.org/docs/current/citext.html |
| official_regulator | https://wiki.postgresql.org/wiki/SQL2011Temporal |
| official_regulator | https://www.rfc-editor.org/rfc/rfc5321 |
| industry_report | https://moj-analytical-services.github.io/splink/topic_guides/theory/probabilistic_vs_deterministic.html |
| secondary | https://pganalyze.com/blog/5mins-postgres-auditing-pgaudit-supabase-supa-audit |
| secondary | https://dev.to/bairescodeai/infinite-recursion-in-postgres-rls-a-security-definer-gotcha-1916 |

---

## 11. Open questions for the Owner

`[Recommendation]` These cannot be resolved by research and block or reshape decisions elsewhere in the package.

| # | Question | What it unblocks |
|---|---|---|
| Q1 | Is Forever on **Google Workspace**? (U15) | The verification exemption that makes Gmail/Calendar API access near-free of compliance overhead (§6.6). |
| Q2 | Does Forever **target the EU** — EUR pricing, EU-targeted ad spend, retargeting pixels? | Whether GDPR Art 3(2) applies and an Art 27 representative is needed (§5.12). A recorded decision either way. |
| Q3 | What is the intended **after-hours definition of "acknowledged"** at 02:00 Phuket time? | Working-hours gating, the claim window, and every SLA policy row (§3.4). |
| Q4 | Retain the **21-day ownership rule** as the configured default, or accept the activity-driven default? | D4's policy row value; the reclaim behaviour agents will actually experience (§3.5). |
| Q5 | Which **backup posture** for the 90-day erasure constraint — retention under 90 days, an erasure-replay procedure, or per-subject keys? | Must be decided **before** backup configuration, not after (§5.5). |
| Q6 | Engage a **Thai-qualified privacy lawyer** to confirm the `[LAWYER]` items, at minimum: AMLA s16(4) applicability and required CDD data; whether the s39 SME RoPA exemption is disapplied; whether the buyer decision profile triggers the DPO profiling limb; and the 14 Sep 2026 access-request obligations | Everything in §5 that the architecture is currently treating as a design assumption. |

---

*End of document. This is research. Nothing here is authorized for implementation.*
