# Forever CRM — Final Recommendation

Task ID: FOREVER-CRM-ARCH-001
Status: Proposed architecture — not approved, not scheduled, not authorized for implementation
Repository state of record: main @ `821b3c4e2f6f82e0d4ddce86199a8ff24b44a094`
Risk class: R0 (documentation only)

> This document is a design record. It asserts no product truth, changes no active stage, and authorizes no
> implementation. The active stage remains FOREVER-STUDIO-001 (`docs/CURRENT_STAGE.md`), which lists
> "large CRM integration" as out of scope. Any implementing task is R2 under the shared-contract rule and
> requires an Architect-reviewed stage change plus Owner approval.

## What this document decides

The single page to point at. What Forever should build first, why it beats every alternative considered, what
would stop it, and what the Owner must answer before anything larger begins.

---

## 1. The recommendation in one paragraph

**Build nothing with a schema. Start by counting.**

Run a checked-in read-only SQL script against the existing `public.leads` table to establish how many
enquiries Forever actually receives. Then ship one Owner-only, phone-usable screen that reads those leads
back, together with the one-line repair that stops `/contact?project=&unit=` discarding its own context. Zero
new tables. Zero migrations. No change to how a lead is written. Reversible by deleting two files and one
route. Everything beyond that — the eleven-table pilot, the pipeline, the decision-profile persistence, the
messaging gateway — waits behind a recorded stage change and the Owner's answers in
`docs/crm/CRM_DECISION_RECORDS.md`.

## 2. Why this and not the schema

[Repository fact] `docs/ROADMAP.md:228` already defers an external CRM behind the trigger "lead volume exceeds
the simple internal workflow." That trigger **cannot be evaluated today**, because `public.leads` has one
INSERT policy, no SELECT policy, and exactly two `from("leads")` occurrences in the entire codebase — an
insert and the test that pins it. Nothing reads a lead back. The gate Forever set for its own most consequential
CRM decision has no number behind it, and the cheapest way to produce that number is a SQL script.

[Repository fact] `docs/CURRENT_STAGE.md:228` excludes "new architecture-only foundations without a measured
current-stage need." Building eleven tables before knowing whether Forever receives three enquiries a month or
three hundred is precisely the defect that line was written to prevent. [Provisional — open Draft PR #118]
Gate G0 records that the lead submission path has never been proven to deliver end to end; PR #118 is
withdrawing capture surfaces because of it. A pipeline built over an input that may produce nothing is the
worst available first move.

Against that, the recommended slice is already sanctioned. [Repository fact] `docs/CURRENT_STAGE.md:109`
carries "Establish lead-response and guest-feedback baseline" as an **active task**, and `:212` places "simple
lead-response measurement and alert design where it provides immediate value" **in scope**.

## 3. The two steps

### Slice 0 — evidence, not code

A read-only SQL script under `scripts/`, run by the Owner in the Supabase SQL editor. It returns counts only:
total leads; by calendar month; by `source`; by `status`; distinct lowercased emails; leads with a NULL
`project_slug`; booth-sourced leads; earliest and latest `created_at`.

No code, no migration, no deployment dependency — which matters, because production rollout is BLOCKED under
Cloudflare verdict E and it cannot be asserted that the Worker's scheduled export is live.

### Slice 1 — the Lead Response Baseline

**R1. Zero `crm_*` tables, zero migrations, no change to `submitLead`'s transport, no change to the public
INSERT policy.**

| # | Component |
| - | --------- |
| 1 | `crmListLeads` and `crmGetLeadCounts` server functions behind the existing `requireSupabaseAuth → requireStudioMember → resolveStudioActor` chain, service-role client reached only by dynamic `await import()`, wrapped in the redacting error envelope |
| 2 | `assertOwner` — every endpoint gates on `actor.role === 'owner'` |
| 3 | One authenticated route: newest-first lead list with age, plus counts by month and by source. Phone-usable |
| 4 | `contact.tsx` forwards `?project=` and `?unit=` into `<ContactForm>` — a props change, no schema |
| 5 | The un-ingested detector, computed on demand from the same read path |
| 6 | Every new client-reachable file appended to `CLIENT_REACHABLE` in the existing bundle-boundary test |

Full acceptance criteria, including the five negative tests, are in `docs/crm/CRM_IMPLEMENTATION_PLAN.md` §3.

## 4. Why it beats the alternatives

| Alternative first move | Why it loses |
| ---------------------- | ------------ |
| Start with the schema | Excluded by `CURRENT_STAGE.md:228`; builds eleven tables before the measurement exists |
| Start with server-side capture | R2 (shared contract), produces no number and no screen, and collides with Draft PR #118, which is withdrawing capture surfaces pending the same gate Slice 0 answers |
| Start with decision-profile persistence | Requires `/booth` to be access-controlled first (it has no guard today), three tables, and three Navigator-core changes; collides with Draft PR #102's lock on `public.leads` |
| Start with lead alerts | Nothing on main can send; Workers has no SMTP; and `CURRENT_STAGE.md:212` says alert *design*, not delivery |
| Buy a CRM now | The deciding variable is the write path, not price — and the volume that would justify it is exactly the number Slice 0 produces |

The asymmetry that makes this safe: every alternative first move is either irreversible (it collects personal
data), R2 (it touches a shared contract), or blocked on a deployment nobody has demonstrated. Slice 1 is none
of the three.

## 5. Kill and review triggers

| Type | Condition | Response |
| ---- | --------- | -------- |
| **Kill** | The Owner does not open the console in any 14-day window | Stop the programme; re-evaluate against buying |
| **Kill** | Slice 0 shows fewer than 5 non-spam leads in the trailing 90 days | Reduce to the script; re-review after 60 days of data |
| **Stop the line** | Gate G0 confirmed open — no lead has ever arrived end to end | Slice 1 still ships, because it costs nothing and proves G0 either way; no further phase starts until delivery is repaired |
| **Review** | More than 30% of leads are marked spam | The real problem is quarantine, not pipeline; re-sequence |
| **Review** | Fewer than half of non-spam enquiries have any recorded response within 7 days, after 8 weeks | The design is failing the adoption test; the answer is a **smaller** surface, not more features |

## 6. Measurable outcomes

1. Lead volume becomes a product capability, settling `ROADMAP.md:228` and `NORTH_STAR:254` for the first time.
2. Forward first-response latency becomes measurable — the metric `CURRENT_STAGE.md:196` already commits this
   stage to recording.
3. The count of enquiries that received **no response at all** becomes visible. [Web research — HBR's 2011
   audit of 2,241 companies found 23% never responded at all, average 42 hours; the defensible threshold is
   one hour, not five minutes: https://thedenmangroupselling.wordpress.com/wp-content/uploads/2011/03/the-short-life-of-online-sales-leads-harvard-business-review.pdf]
4. Unit and project enquiries stop losing their context on submit.
5. Gate G0 is closed or proven open — which also unblocks Draft PR #118's CTA-restoration decision.

An external signal is required before the phase closes, per `NORTH_STAR:273`: within 14 days of shipping, at
least one guest enquiry arrives with its project context intact and is responded to, and the Owner can state
last month's enquiry count without opening Supabase.

## 7. What must be answered before anything larger

Seven questions, in `docs/crm/CRM_DECISION_RECORDS.md` Part 2. The three that gate the most:

1. **Where do buyer WhatsApp conversations live today** — a company number, or advisors' personal accounts?
   This gates any gateway purchase absolutely, and the history may already be unrecoverable.
2. **Three PDPA questions for Thai counsel**, of which the sharpest is whether retaining a minimum identifier
   in order to honour an absolute marketing objection survives an erasure request.
3. **Ratify the constitutional reconciliation** — `FOREVER_PRODUCT_SPECIFICATION.md:17` says Forever "is not:
   … A CRM" while `FOREVER_BLUEPRINT.md` §13 charters one. The proposed resolution is in
   `docs/crm/CRM_PRODUCT_BOUNDARY.md` §2. It gates Phase 1, not the two slices above.

## 8. The one sentence to remember

Forever does not need a CRM product; it needs to stop destroying the structured buyer intent it already
collects — and before it builds anything to hold that intent, it needs to know how much of it arrives.
