# Forever CRM — Product Vision, Boundary and Roles

Task ID: FOREVER-CRM-ARCH-001
Status: Proposed architecture — not approved, not scheduled, not authorized for implementation
Repository state of record: main @ `821b3c4e2f6f82e0d4ddce86199a8ff24b44a094`
Risk class: R0 (documentation only)

> This document is a design record. It asserts no product truth, changes no active stage, and authorizes no
> implementation. The active stage remains FOREVER-STUDIO-001 (`docs/CURRENT_STAGE.md`), which lists
> "large CRM integration" as out of scope. Any implementing task is R2 under the shared-contract rule and
> requires an Architect-reviewed stage change plus Owner approval.

## What this document decides

- What the Forever CRM is, and the four things it is deliberately not.
- The exact ownership boundary between the CRM and every neighbouring Forever system.
- How the constitutional contradiction between `FOREVER_PRODUCT_SPECIFICATION.md` and `FOREVER_BLUEPRINT.md`
  is resolved.
- Which roles exist, how many are actually justified now, and what each one's daily workspace is.

---

## 1. The vision, in Forever's own terms

Forever's mission is to reduce uncertainty in real-estate decisions
(`docs/FOREVER_STRATEGIC_NORTH_STAR.md:18`). The CRM's contribution to that mission is narrow and specific:

> **The CRM is the layer that keeps a buyer's stated intent intact from the first anonymous click to the
> closed transaction, and back again years later when a new project matches what they told us.**

Everything else it does is subordinate to that.

This is not the usual CRM framing, and the difference is deliberate. A conventional CRM exists to manage
*seller* activity — calls made, tasks closed, pipeline hygiene. Forever's engine already produces something
more valuable and rarer: a structured, deterministic statement of what a specific buyer wants, derived from
approved questions with a fixed vocabulary. [Repository fact] `deriveDecisionProfile` in
`src/features/navigator/core/decision-profile.ts` produces it, and
`buildBoothMessageSummary` in `src/features/navigator/core/lead.ts` then flattens it into prose. The CRM's
first job is to stop that loss. Its second is to make the preserved intent operationally useful.

### 1.1 The success test is behavioural

The design is correct only if all six hold. Each is testable, and each appears as an acceptance criterion or
a review trigger in `docs/crm/CRM_IMPLEMENTATION_PLAN.md`.

| # | Test |
| - | ---- |
| 1 | No advisor keeps a side spreadsheet or a private notes app for work the system is supposed to hold |
| 2 | An advisor opening the system on a phone knows their next action without reading anything twice |
| 3 | The Owner can identify a neglected or at-risk enquiry in under a minute, on a phone |
| 4 | A buyer who returns after eighteen months is recognised, and their original profile is still readable |
| 5 | No screen shows a number the underlying data cannot honestly support |
| 6 | Removing the CRM would lose operational history, not merely convenience |

### 1.2 What it is not

[Recommendation] Four exclusions, each of which a generic CRM would violate.

- **Not a second source of project truth.** It stores no project, developer, location, unit, price, Passport
  or Intelligence fact. It holds references.
- **Not a marketing automation platform.** It records consent and suppression because the law requires it and
  because a send path must consult them. It does not become a campaign tool.
- **Not an accounting, payroll, property-management or ERP system.** Commission *attribution* is modelled
  because it is the North Star metric's denominator; commission *payment* is not.
- **Not a product Forever sells.** It is internal operational tooling. Commercialisation would require a new
  strategic review under `docs/FOREVER_STRATEGIC_NORTH_STAR.md:349-359`.

---

## 2. Resolving the constitutional contradiction

[Repository fact] Forever's own documents disagree, and `docs/FOREVER_STRATEGIC_NORTH_STAR.md:14` requires
conflicting product-priority statements to be resolved before new work starts.

| Document | Statement |
| -------- | --------- |
| `docs/FOREVER_PRODUCT_SPECIFICATION.md:17` | Forever "is not: … A CRM" |
| `docs/FOREVER_PRODUCT_SPECIFICATION.md:306` | MVP excludes "Full CRM." |
| `docs/FOREVER_BLUEPRINT.md:250-266` | §13 charters a CRM with seven required capabilities, Status: Planned |
| `docs/FOREVER_CORE_ARCHITECTURE.md` | Places CRM in the core workflow chain after Advisor Workspace |
| `docs/FOREVER_STRATEGIC_NORTH_STAR.md:103` | Lists "CRM-lite and communication workflows" as a chartered interface |

[Recommendation] **The contradiction is verbal, not substantive, and resolves in one sentence:**

> An internal operational interface over the one Forever engine is not the claim that Forever *is* a CRM
> product. `FOREVER_PRODUCT_SPECIFICATION.md` §1 is a statement about **what Forever sells and how it must
> feel to a guest**; `FOREVER_BLUEPRINT.md` §13 is a statement about **which internal capability exists**.
> Both are true.

The supporting evidence is that the North Star, which is the most recent and the governing document on
product priority, already names "CRM-lite and communication workflows" among the interfaces of the one engine
and simultaneously warns against "a large external CRM" — precisely the distinction above.

This resolution is **R3 and requires Owner ratification** before any Phase 1 stage change. It is recorded as
Owner decision 7 in `docs/crm/CRM_DECISION_RECORDS.md`. It does not gate Slice 0 or Slice 1, neither of which
creates a CRM table.

---

## 3. The ownership boundary

[Repository fact] `docs/FOREVER_BRAIN_V1.md` §7 "CRM Interaction" is the binding contract. It is cited here,
not restated, and this package adds no competing contract.

### 3.1 System by system

| System | Owns | The CRM's relationship to it |
| ------ | ---- | ---------------------------- |
| **Forever CRM** | Leads, buyer profiles, advisor notes, follow-up state, buyer preferences, inquiry history, deal workflow state | — |
| **Project Record** (`public.projects`, `public.units`, `public.buildings`, `unit_price_history`) | All project, unit, price, availability and developer truth | **References by key. Never copies, never writes.** A project fact written from CRM code would bypass provenance stamping |
| **Navigator / DecisionProfile** | The approved NAV-001 question set, its 28 enum keys, and the derivation logic | **Consumes and persists the answers.** Never redefines a question, never adds a sixth question without NAV governance |
| **Forever Passport** | The guest- and advisor-facing project summary | **Links to it.** Never re-derives it, never caches a rendered copy |
| **Advisory** | Evidence-led interpretation, comparison, recommendation, reports | **Supplies the client context; stores the produced report by reference.** Never re-implements a derivation |
| **Booth** | The walk-in session shell | **Receives its output.** Booth becomes a CRM capture surface, not a parallel funnel |
| **Studio** | Project publishing and project-data production | **Shares its identity roster and its server-boundary idiom. No data overlap.** |
| **Factory** | The development system | **Governs how CRM work is packaged and reviewed. Not a runtime dependency.** |
| **Developer Check** | Developer evidence profiles and their findings | **References the evidence record; creates the follow-up.** Never copies a finding into a CRM table |
| **Marketing** | Campaign definition and spend | **Receives attribution. Consults suppression before any send.** |
| **Accounting / finance** | Money movement | **Out of scope entirely.** The CRM attributes credit; it does not pay it |

### 3.2 The rule that prevents drift

[Recommendation] One sentence, testable by grep:

> No `crm_*` table may contain a column whose value is a project, unit, developer, location, price or
> availability **fact**. It may contain only that entity's **key**, plus Forever's own operational assertion
> about it.

The distinction is worked in practice: `crm_person_interest` stores `project_id` and nothing about the
project. `crm_unit_hold` stores Forever's own expiring, attributable assertion that a unit is being held for a
buyer — which is an operational fact Forever owns — and stores no unit availability, because that belongs to
the Project Record and the CRM is confidently stale about developer reallocation.

---

## 4. Developer Check as a first-class source

[Repository fact] Issue #101 (FOREVER-DD-001) proposes the Developer Evidence and Due Diligence pilot. It is
an open issue, not canonical, and no evidence-profile table exists on main.

[Recommendation] When it exists, a Developer Check purchase or request is **an enquiry with unusually rich
context**, not a separate customer system. It arrives already carrying a named developer, a named project,
often a legal entity, a specific high-intent concern, a preferred language, and — after the report — a set of
findings and evidence gaps.

The integration rule is the same rule as everywhere else:

- The buyer becomes an ordinary `crm_person`; the request becomes an ordinary `crm_enquiry` with its own
  `crm_source` value.
- Consent is captured at the point of purchase, under the same append-only consent model.
- The resulting follow-up is an ordinary `crm_task` assigned to an Advisor, and where the intent justifies it,
  an ordinary `crm_opportunity`.
- **The report and its findings are referenced, never copied.** A finding duplicated into a CRM table would
  become stale evidence presented as current — the exact failure the public-truth boundary exists to prevent.
- There is no separate SunThai lead database, report engine or scoring system. SunThai is a business-facing
  context on the same records.

---

## 5. Roles and workspaces

### 5.1 How many roles are actually justified

[Repository fact] `public.studio_members.role` today has exactly two values: `owner` and `trusted_publisher`.

[Recommendation] The Owner's brief names nine role types. At roughly ten seats, shipping nine roles would
produce a permission matrix nobody maintains and which fails open the first time someone is hired. The design
therefore separates the **role vocabulary** (what a person is called) from the **capability set** (what the
software checks), and keeps both small: **three principals and six capabilities.**

| Business role | Verdict | Justification |
| ------------- | ------- | ------------- |
| Owner | **Exists** | Already single-winner at the database via `studio_members.role = 'owner'` |
| Sales director | **Collapsed into Owner** | At ten seats the Owner is the sales director |
| Team leader | **Collapsed into Advisor** | Not enough people to form teams. Splits when a second team exists |
| Advisor / Agent / Forever Guide | **Exists — one role** | Three job titles, one software role |
| Booth Host | **Exists** | Capture and handoff only. Cannot read the pipeline. It is what makes gating `/booth` safe on a shared device in a public place |
| CRM coordinator | **Deferred** | Its distinct powers are exactly the irreversible set reserved to the Owner. Trigger: the Owner delegating compliance authority to a named non-Owner |
| Marketing staff | **Does not exist** | [Repository fact] No outbound messaging path exists on main. A role with no capability is a row in a CHECK constraint. Trigger: a signed gateway contract |
| Studio publisher | **Exists, zero CRM access** | Publishing a project has never implied reading a buyer |
| Partner / referral user | **Rejected** | An introducer is a *contact*, not a principal. See below |

Adding a value to a CHECK constraint later is a one-line migration. Handing out an over-broad login now is
not reversible.

The six capabilities, the full principal-by-capability matrix, the decision on whether CRM roles live in
`studio_members` or a sibling roster, and the RLS posture are in `docs/crm/CRM_SECURITY_AND_RBAC.md` §1.

**Why no partner login in v1.** [Recommendation] An external partner account is the single largest attack
surface a small CRM can add: it is an unmanaged credential, held by someone outside Forever's control, with a
commercial incentive to see more than their own referrals. A referring partner is modelled as a *flagged
person* with referral credit — which delivers the commercial function — and receives outcomes by a human
message. The trigger to reconsider is a partner sending more than roughly one referral a month whose status
they ask about repeatedly.

### 5.2 Daily workspace per role

Full wireframes are in `docs/crm/CRM_UX_INFORMATION_ARCHITECTURE.md`. This is the one-line orientation.

| Principal | Primary workspace | The one question it answers | Critical alert |
| --------- | ----------------- | --------------------------- | -------------- |
| Owner | Pulse | "Is anything rotting?" | An enquiry with no response at all |
| Advisor | My Work Today | "What do I do next?" | A commitment I made and have not kept |
| Booth Host | Capture | "Who is in front of me, and who takes them?" | Handoff not acknowledged while the guest is still present |

The Owner's Pulse absorbs what a separate manager queue would have shown, because at ten seats the Owner is
the sales director. The team queue is a view every Advisor can already reach, not a separate workspace.

### 5.3 What every role can never do

[Recommendation] These are absolute and enforced at the server boundary, not by hiding UI.

- No principal may edit a project, unit, price or availability fact. That path does not exist in CRM code.
- No principal may delete an activity, a consent event or an audit row. Corrections are appended.
- No principal may send to a suppressed person. The suppression check is in the send path, not the UI.
- No principal except the Owner may change a business policy value, lift a suppression, decide a
  data-subject request, or erase a person.
- The Booth Host cannot read the pipeline at all — capture and one internal note on the session just
  captured, and nothing else.

---

## 6. Where this boundary is most likely to be violated

[Inference] Three predicted failure paths, recorded so they can be watched for.

1. **"Just cache the price on the opportunity."** It will be proposed for performance or for a printed
   summary, and it will produce a quoted price that is wrong. The rule in §3.2 exists for this. If a snapshot
   is genuinely needed for a reservation record, it is stored as *what was quoted on this date*, explicitly
   labelled historical, never as current truth.
2. **"Add a match score so agents can sort."** `docs/CURRENT_STAGE.md:221-222` places new scoring out of
   scope, and no approved evidence-backed rule exists. The greppable column-name test in
   `docs/crm/CRM_ANALYTICS_AND_KPI.md` keeps it unstorable.
3. **"Let the partner log in to check their referral."** §5.1. The commercial need is real; the login is not
   the way to meet it.
