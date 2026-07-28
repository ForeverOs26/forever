# Forever CRM — Independent Review and Reconciliation

Task ID: FOREVER-CRM-ARCH-001
Status: Proposed architecture — not approved, not scheduled, not authorized for implementation
Repository state of record: main @ `82e2039270168df1043050204988fbd6c009ed0e`
Risk class: R0 (documentation only)

> This document is a design record. It asserts no product truth, changes no active stage, and authorizes no
> implementation. The active stage remains FOREVER-STUDIO-001 (`docs/CURRENT_STAGE.md`), which lists
> "large CRM integration" as out of scope. Any implementing task is R2 under the shared-contract rule and
> requires an Architect-reviewed stage change plus Owner approval.

## What this document decides

- What eight independent skeptical reviewers found wrong with the first draft of this architecture.
- Which findings were accepted, which were rejected, and why.
- How the buildable design shrank from 33 tables to zero for the first slice.

This record exists because the review materially changed the answer. Attaching it unprocessed would be
useless; hiding it would be dishonest. What follows is the adjudication.

---

## 1. Method

Eight reviewers examined the complete draft package independently, each with a single lens and an instruction
to find defects rather than to praise, and to verify every load-bearing repository claim against the real
worktree before asserting it.

| Lens | Question asked | Verdict | Blocker | Major | Minor |
| ---- | -------------- | ------- | ------- | ----- | ----- |
| Brokerage operations | Does this survive a Tuesday in a Phuket off-plan brokerage? | sound-with-corrections | 4 | 6 | 3 |
| Product simplicity | Does every table earn its place at ten seats? | **materially-flawed** | 4 | 7 | 3 |
| Repository consistency | Does it invent idioms Forever already has? | sound-with-corrections | 3 | 3 | 3 |
| Database and identity | What specific case corrupts data? | **materially-flawed** | 4 | 11 | 5 |
| Security and privacy | Where is the exfiltration path? | sound-with-corrections | 2 | 8 | 7 |
| Mobile and Owner oversight | Is the next action ever ambiguous? | sound-with-corrections | 1 | 7 | 2 |
| Integration failure modes | What double-messages a client or drops a lead? | sound-with-corrections | 3 | 7 | 4 |
| Overengineering, migration, value | Does each phase produce a commercial signal? | sound-with-corrections | 2 | 5 | 5 |
| **Total** | | | **23** | **54** | **32** |

**109 findings. 90 accepted, 11 rejected, 8 partially accepted.**

One methodological note worth recording: **no reviewer fabricated a repository fact.** Every load-bearing
claim spot-checked during reconciliation held — `units.project_id NOT NULL`, zero `commission` matches in
`src/`, zero repo-wide `GRANT UPDATE (`, 25 `CREATE TRIGGER`, 37 tables, zero views,
`studio_members.role CHECK (role IN ('owner','trusted_publisher'))`, `contact.tsx` dropping `?project=&unit=`,
and `audit_log` carrying no `REVOKE`. The findings can be trusted on their facts even where their proposed
fixes were rejected.

---

## 2. The three defects that decided it

Five reviewers said "sound with corrections" and two said "materially flawed". On a count the package passes.
On merit it did not, and three independently verified properties settle it.

| Defect | Evidence | Consequence |
| ------ | -------- | ----------- |
| **The migration chain does not apply** | A consent-event foreign key referenced `crm_activity` three files before `crm_activity` was created; a person column referenced `crm_source` before it existed | The proposed Phase 1 could not have been deployed at all |
| **The merge cannot execute** | The suppression primary key plus the rule that every legacy person receives a suppression row guarantees a unique violation on 100% of legacy merges; the grant profile additionally denied `UPDATE person_id`; and unmerge deadlocked against its own guard | The identity model's central operation was inoperable |
| **The marketing gate fails open** | The consent check did not follow `merged_into_person_id`, so merging a suppressed duplicate silently restored marketing eligibility | Failure on the one duty PDPA treats as absolute, in the direction that creates liability |

**The diagnosis is not the table count.** It is that a 52-table target was presented as a plan, and fifteen
defects of this class survived eight independent reviews. That produced the operating rule now recorded as
CRM-D9 in `docs/crm/CRM_DECISION_RECORDS.md`:

> No phase may propose more schema than one reviewer can hold in mind while checking every foreign key, every
> CHECK and every trigger interaction. The target architecture may be large. The buildable set may not.

---

## 3. The central adjudication: minimalist versus operator

The two harshest reviewers wanted opposite things. The product minimalist wanted twelve tables. The brokerage
operator wanted capabilities that implied nearer sixty. They were arguing about different questions.

> **The minimalist wins on what is BUILT. The operator wins on what is MODELLED.**

| Question | Minimalist | Operator | Ruling |
| -------- | ---------- | -------- | ------ |
| Target architecture | 12 tables | ~58 | **~39.** Every operator capability is a real Phuket transaction shape, and cheaper to design now than to retrofit |
| Phase 1 buildable | 12 | (silent) | **11 — and a different 11.** No pipeline, no opportunity, no decision profile |
| Compliance tables | cut two | (silent) | **Kept in full.** They are statutory carriers, not convenience |
| Automation engine | cut all 15 | (silent) | **Cut all 15** |
| Multi-unit, introducer, commission, trips, deposit custody | cut | build now | **Modelled now, built on named triggers** |

**What was traded.** The operator does not get multi-unit reservations, commission chasing, trip containers or
deposit custody this year, and several of those triggers will not fire. In exchange the design stops claiming
those cases are handled when they are not — which is the failure mode that ends with a screen being quoted to
a buyer. The minimalist does not get the compliance surface cut, because a purpose register carrying lawful
basis and retention is what makes seven of nine processing purposes provably *not* consent-based, and that is
the property that stops a marketing withdrawal from legally halting transaction correspondence.

---

## 4. Notable rejections

Eleven findings were rejected. Six are worth recording because the reasoning generalises.

**Cut the two compliance tables and put a notice hash on the consent event.**
Rejected. A hash discharges the burden of proving consent and nothing else. The purpose register carries
lawful basis, whether consent is required, and retention period — the record that proves most purposes are
contract-necessity rather than consent. Without it, a buyer withdrawing marketing consent would appear to
halt the correspondence Forever is contractually obliged to send.

**Enforce a per-actor daily read budget, failing closed.**
The read *log* was accepted; the fail-closed *budget* rejected. At ten seats the realistic effect is an
advisor working a three-day expo being locked out of the record for the buyer standing in front of them —
a worse failure than the threat it mitigates, and a control that would be disabled within a week.

**Replace the source and questionnaire registries with CHECK vocabularies, since TypeScript already pins the
28 keys.**
The repository fact was verified and correct; the inference does not follow. TypeScript enforces the key set
at the writing site in the current build. The registry's job is to keep a historical profile interpretable
after a key is retired — a different problem that a compile-time union cannot solve.

**Build commission claims now, because disputes happen when nobody tracked what was invoiced.**
Substance accepted into the target; timing rejected. Forever has zero reservations and no reservation table,
so the proposed chase queue is a partial index over rows that cannot exist — precisely the
"architecture-only foundation without a measured current-stage need" the active stage excludes.

**Defer commission credit behind the trigger "the first dispute a note cannot settle".**
Deferral accepted, trigger rejected as self-defeating. Credit must be recorded *before* a dispute to be
evidence of anything; a trigger firing at the dispute guarantees the table is empty at the moment it is
needed.

**Add a fifth "No next action" tile to the agent's Today screen.**
The team-queue view was accepted; the tile rejected. Today's contract is "what is due today", one action per
card. An item with no due semantics turns the agent's action screen into a coverage report — which is exactly
the management-reporting surface that the adoption evidence says agents abandon.

---

## 5. What changed, by section

Full detail is in each section document. This is the index of changes.

| Section | Principal correction |
| ------- | -------------------- |
| Domain model | 52 → 39 target, 11 buildable. Foreign-key ordering fixed; merge survivorship and unmerge ordering fixed; `crm_channel` added; `crm_record_history` cut in favour of `public.audit_log`; a unique index that forbade a real transaction replaced by a nightly coverage count; all dates pinned to Asia/Bangkok |
| Journeys and states | An inbound message can now be *recorded* — without it the stage machine could never reach "contacted" and every live WhatsApp conversation aged into the silence report within a fortnight. Unmet transition predicates now **flag rather than refuse** |
| Security and RBAC | Column-level `GRANT UPDATE` replaced by whole-table narrowing plus guard triggers — the precedent the repository actually proves. 26 capabilities collapsed to 6. The contract test discovers tables by regex instead of counting |
| Privacy and consent | The marketing gate now resolves the merge pointer in every caller. The ROPA table and its 500-comment census cut. Consent gains an insert-only correction path, because append-only with no correction path is unfalsifiable in both directions |
| Integration and events | One queue, one retry semantics, one latency promise. Escalation fires only on *definitive* transport failure; an ambiguous timeout degrades to manual fallback rather than risking a duplicate client message |
| UX and IA | Commitments surface on all three screens. One canonical tile set, owned by the analytics document. The offline outbox widens to every route — it is the anti-spreadsheet escape valve. Quiet hours changes the action rather than removing it |
| Automation | The engine is cut entirely. Five sweeps become five SQL functions; eleven policy numbers become TypeScript constants |
| Analytics | Wins per advisor permitted as a **count**; the conversion ban untouched. Order statistics gain a floor |
| Build versus integrate | Recommendation unchanged, sequencing corrected: the gateway purchase is gated on the WhatsApp number-ownership answer, not on a date |
| Implementation plan | Phase 0 splits; Slice 1 sheds its alert-design document and its audit migration; every table carries a phase or a named trigger |

---

## 6. Claims corrected rather than defended

Four assertions in the draft were wrong and are recorded as corrected, because a design that quietly drops an
overstatement teaches nothing.

- **"Six tables an advisor touches."** The booth journey writes eleven.
- **"The unit-hold index is the structural answer to two advisors selling the same unit."** It delivers
  intra-Forever exclusivity only. The CRM is confidently stale about a developer reallocating a unit, and the
  document now says so.
- **"Four SECURITY DEFINER routines are preserved."** Two reviewers were each half right. The count becomes
  six, because merge and unmerge provably cannot execute as INVOKER under the corrected grant profile.
- **The proposed `public.leads` table comment.** It now reads "Public intake mirror. Not complete." rather
  than implying the table remains authoritative.

---

## 7. The consolidation, and what was transplanted from PR #121

[Repository fact] A second architecture package was produced independently for the same task, from the same
commit, and opened as Draft PR #121. Four blind assessors — two per package, neither pair seeing the other —
and one adjudicator compared both against the task's Definition of Done. Both packages contained all
twenty-five required deliverables; on nine of fifteen criteria they were judged genuinely tied; and they
converged independently on twenty-three substantive points, including that `public.leads` is a write-only
mailbox, that the first move must create no schema, that `auth.uid()` RLS must not be introduced, and that the
five-minute speed-to-lead rule is folklore. Two runs debunking the same statistic without contact is the
strongest single piece of evidence in the exercise.

The adjudication recommended this package as the canonical base — principally because PR #121's Owner-facing
summary asserted that failed contact submissions are invisible, which is false (`src/components/ContactForm.tsx`
catches at lines 63-69 and renders at 184-188), and because its first slice was defined two incompatible ways
inside its own package. Under FOREVER-CRM-ARCH-002 the Owner accepted that recommendation and directed that
four of PR #121's strengths be preserved before it was closed.

| # | Transplanted from PR #121 | Destination in this package |
| - | ------------------------- | --------------------------- |
| 1 | Migration replay and migration-history risk — that `supabase db push` applies in version order so the first CRM migration replays the entire pending backlog; ledger mismatch; renaming hazards; clean-environment versus upgrade-path testing; rollback and restore; collision prevention | `CRM_IMPLEMENTATION_PLAN.md` (migration strategy + risk register), `CRM_SECURITY_AND_RBAC.md` (a security boundary must be verified against the live schema, never inferred from the file), `CRM_DECISION_RECORDS.md` |
| 2 | The anonymous `leads` column-widening privilege hole — `GRANT INSERT ON public.leads TO anon` at `supabase/migrations/20260704132000_create_leads.sql:29` is table-level and therefore extends automatically to any column added later | `CRM_SECURITY_AND_RBAC.md` (full finding + threat model), `CRM_IMPLEMENTATION_PLAN.md` (acceptance criterion), `CRM_DOMAIN_MODEL.md` (the standing reason this package adds zero columns), `CRM_FINAL_RECOMMENDATION.md` |
| 3 | The `units` prerequisite runbook — `units.unit_code` has no UNIQUE constraint, the fix is a partial unique index because it is nullable, `CONCURRENTLY` is unavailable because Supabase wraps each migration in a transaction, and dependent tables cascade from `units(id)` so deleting a duplicate first destroys price history silently | `CRM_PRODUCT_BOUNDARY.md` (boundary), `CRM_DOMAIN_MODEL.md` (runbook), `CRM_INTEGRATION_AND_EVENTS.md` (unresolved interest and change events), `CRM_IMPLEMENTATION_PLAN.md` (prerequisite task) |
| 4 | The fuller speed-to-lead evidence analysis — the shared-authorship mechanism by which vendor numbers acquired a Harvard byline, the ruling that the "78% buy from the first responder" figure has no traceable source, and the register of claims that could not be verified | `CRM_MARKET_RESEARCH_2026.md` §7 + unverifiable-claims appendix, `CRM_ANALYTICS_AND_KPI.md` (four separately measurable clocks), `CRM_AUTOMATION_CATALOGUE.md`, `CRM_FINAL_RECOMMENDATION.md` |

**Six things were deliberately not carried over**, because the adjudication verified them as defects: the
false silent-submission claim; the two conflicting first-slice definitions; the DDL ordering rule that
contradicts its own foreign key; the claim that a modular `docs/crm/` subtree violates repository precedent
(main tracks `docs/factory/`, `docs/navigator/` and `docs/progressive-ingestion/`); the cost bands PR #121
itself marks as unverified vendor pricing; and any large-schema plan presented as authorized.

PR #121 was closed unmerged and superseded. It was never force-pushed, never modified, and its branch was not
deleted.

## 8. What the reviewers agreed was right

Recorded because it is the part of the design that survived unchanged, and therefore the part with the
strongest claim to be correct.

- Referencing project and unit truth by key, and copying nothing. No reviewer challenged the boundary.
- Keeping authorization at the app-server boundary rather than introducing the repository's first
  user-scoped RLS.
- Reversible merge, and the refusal of automatic probabilistic merging.
- Withholding conversion percentages below a denominator of 30, and banning per-agent conversion comparison.
- Treating the five-minute human-contact target as folklore and replacing it with automated acknowledgement
  plus a business-hours human target.
- Persisting the decision profile structurally instead of as prose — described by more than one reviewer as
  the highest-value single fix available.
- Starting with something that creates no schema at all.
