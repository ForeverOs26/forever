# Forever Blueprint v1.0

## 1. Vision

**Status: In Progress**

Forever exists to reduce uncertainty in real estate decisions.

The long-term vision is to become the trusted decision layer for real estate buyers, investors, developers, and sales teams. Forever should not only present properties; it should explain why a project is trustworthy, who it is best for, where the risks are, and what decision path makes sense for each buyer.

Forever is built around the principle of **One Engine, Many Interfaces**: the same structured project data, Supabase backend, Project Detail Engine, Intelligence Engine, and future Decision Engine should power every experience across web, tablet booth, sales, CRM, marketing, and AI-assisted workflows.

## Constitutional source-of-truth principles

- Forever exists to reduce uncertainty in real estate decisions.
- Forever follows **One Engine, Many Interfaces**: one structured engine should power website, tablet booth, sales, CRM, reports, mobile, and future AI-assisted workflows.
- GitHub is the source of truth for code and version-controlled documentation.
- Supabase is the source of truth for structured operational data.
- Work follows **One Finished Result**: each stage is organized around one completed, validated result before the next stage starts.
- Forever follows **Incremental Forever Factory**: automation is introduced only when it accelerates the current stage or immediately reduces recurring manual work.
- Before each stage, ask: **Is there a small automation that will accelerate this stage and later stages?**
- If automation is not needed now, record it in the roadmap or backlog, but do not let it delay product progress.
- ChatGPT acts as Chief Architect / Technical Director.
- Claude supports specifications, UX, copy, audits, isolated components, tests, and code drafts.
- Codex performs repository-aware implementation, migrations when approved, cross-file integration, validation, commits, and pull requests.
- Paid tools are purchased only after checking necessity, ROI, alternatives, dependency risk, and current-stage relevance.

## 2. Mission

**Status: In Progress**

Forever's mission is to make real estate evaluation clearer, faster, and more explainable.

The product should help users:

- Compare projects using structured evidence.
- Understand trust, investment, rental, location, liquidity, and construction risk factors.
- Match projects to buyer goals instead of treating every project as universally good.
- Reduce dependence on ad hoc sales claims.
- Turn fragmented project data into a consistent decision system.

## 3. Forever OS

**Status: Planned**

Forever OS is the operating system for structured real estate intelligence.

It includes:

- Project data ingestion and normalization.
- Supabase as the shared data layer.
- Project Detail Engine for universal project pages.
- Forever Intelligence Engine for deterministic project evaluation.
- Decision Engine for buyer-specific project fit.
- Knowledge Engine for structured educational and advisory content.
- Sales and CRM workflows connected to the same source of truth.
- Multi-interface delivery across website, tablet booth, internal dashboards, and future AI modules.

Forever OS should remain modular. Each engine should be independently testable, deterministic where required, and traceable back to source data.

Forever Standards:

- **FS-011 Project Passport:** Every property must have a single digital passport used across all Forever interfaces.

## 4. Brand

**Status: In Progress**

Forever's brand should communicate trust, clarity, calm expertise, and premium real estate judgment.

Core brand principles:

- Evidence before hype.
- Calm confidence over aggressive selling.
- Premium but practical.
- Transparent recommendations.
- Buyer-first decision support.

The brand should make users feel that Forever is not merely listing properties, but protecting decision quality.

## 5. Website

**Status: In Progress**

The website is the primary public interface for Forever OS.

Current direction:

- Reusable Project Detail Engine.
- Supabase-powered project data.
- Contact and lead submission flow.
- Forever Intelligence report integrated into project detail pages.
- Consistent visual language across discovery, detail, and conversion surfaces.

Future website priorities:

- Better comparison flows.
- Buyer persona filters.
- Explainable project matching.
- SEO-ready project and area content.
- Clear conversion paths into sales and CRM.

## 6. Tablet Booth Mode

**Status: Planned**

Tablet Booth Mode is a dedicated event and sales-floor interface for Forever.

It must connect to the same Supabase, Project Detail Engine data model, and Forever Intelligence Engine as the website. Booth Mode should not become a separate product with duplicated project logic.

Key principle:

**Tablet Booth Mode connected to the same Supabase/Project/Intelligence engine.**

Expected capabilities:

- Browse curated projects on a tablet.
- Present project verdicts and strengths clearly.
- Capture leads directly into the same lead system.
- Support salesperson-assisted conversations.
- Work from the same project facts, media, units, documents, and intelligence reports as the website.

## 7. Booth Experience

**Status: Planned**

The Booth Experience is the physical and digital flow around Tablet Booth Mode.

It should support:

- Fast project discovery for walk-up users.
- Guided buyer profile questions.
- Side-by-side project explanation.
- QR handoff from tablet to user's phone.
- Lead capture with project context.
- Salesperson notes and follow-up triggers.

The booth should feel premium, focused, and low-friction. It should reduce decision anxiety during live sales conversations.

## 8. Intelligence Engine

**Status: In Progress**

The Forever Intelligence Engine evaluates whether a project is strong based on structured project data.

It is deterministic and explainable. It does not depend on an LLM.

Current responsibilities:

- Produce a Forever verdict.
- Score trust, investment, rental, location, liquidity, and construction risk.
- Generate strengths, weaknesses, risks, best buyer profile, rental strategy, exit strategy, and investment horizon.
- Include `sourceFields` and `sourceValues` for traceability.

Next priorities:

- Expand scoring coverage as database fields mature.
- Add tests for edge cases and missing data.
- Surface richer evidence in the UI.
- Add versioning for scoring models.

## 9. Decision Engine

**Status: Planned**

The Decision Engine answers a different question from the Intelligence Engine.

The Intelligence Engine asks: **Is this project good?**

The Decision Engine asks: **Is this project right for this client?**

It should evaluate project fit against:

- Buyer profile.
- Client goals.
- Budget constraints.
- Location preferences.
- Risk tolerance.
- Usage intent.
- Investment horizon.
- Yield versus appreciation priority.

Supported buyer personas:

- Capital Growth Investor
- Rental Income Investor
- Family Buyer
- Holiday Home Owner
- Digital Nomad
- Retirement Living
- Luxury Lifestyle

Every recommendation must remain deterministic, explainable, and traceable to project data and client inputs.

## 10. Knowledge Engine

**Status: In Progress (internal architecture; not yet a public or content-authoring product)**

RC4.4–RC5.1 built the source-backed half of the Knowledge Engine: a tested, architecture-only chain (source registry, extraction pipeline, canonical project database, cross-source validation, knowledge graph, readiness) exposed through a project-agnostic engine, `src/features/forever-project-knowledge`. It runs over committed repository artifacts for Coralina and Modeva and is inspectable only at internal, `noindex` routes (`/internal/coralina`, `/internal/projects/$slug`) — it has no persistence layer, no public route, and no content-authoring surface yet.

The Knowledge Engine should eventually also organize Forever's real estate expertise into reusable structured knowledge. It may include:

- Area guides.
- Buyer education.
- Investment explainers.
- Legal and ownership concepts.
- Rental market guidance.
- Developer due diligence notes.
- Sales enablement content.

The Knowledge Engine should support both public content and internal advisory workflows. It should provide structured context for future AI modules without making AI the source of truth.

## 11. Sales System

**Status: Planned**

The Sales System should turn project intelligence and buyer intent into a structured sales workflow.

Core functions:

- Lead capture.
- Project-specific lead attribution.
- Buyer qualification.
- Recommended follow-up actions.
- Sales notes.
- Project shortlist tracking.
- Contact history.
- Handoff between booth, website, and CRM.

Sales should operate from the same Forever OS data layer so that recommendations, leads, and buyer conversations remain consistent.

## 12. Marketing

**Status: Planned**

Marketing should amplify Forever's authority as a decision-quality brand.

Primary channels:

- SEO project pages.
- Area and investment content.
- Social media explainers.
- Email campaigns.
- Developer partnership material.
- Event and booth campaigns.

Marketing content should reinforce the same principle: Forever reduces uncertainty through structured evidence, not generic promotion.

## 13. CRM

**Status: Planned**

The CRM should become the operational layer for leads, buyer goals, follow-up, and sales conversion.

Required capabilities:

- Lead status management.
- Source tracking.
- Project interest tracking.
- Buyer profile records.
- Communication history.
- Sales task pipeline.
- Integration with website and Tablet Booth Mode.

CRM data should eventually feed the Decision Engine so the system can match future projects to known client goals.

## 14. AI Modules

**Status: Future**

AI modules should assist, not decide.

Rules:

- No AI module should replace deterministic scoring or source-of-truth project data.
- AI can summarize, explain, draft, translate, or personalize.
- AI outputs should be grounded in structured data where possible.
- High-stakes recommendations should remain traceable to deterministic engines.

Possible AI modules:

- Buyer conversation assistant.
- Project explanation generator.
- Sales email drafter.
- Area guide assistant.
- CRM note summarizer.
- Multilingual project explainer.

## 15. Roadmap, Backlog, and Future Ideas

**Status: In Progress**

The Blueprint defines direction, not day-to-day task assignment. To avoid competing scopes:

- Current active-stage work belongs in `docs/CURRENT_STAGE.md`.
- Sequenced phases, dependencies, and milestones belong in `docs/ROADMAP.md`.
- Future tasks and parked ideas belong in `docs/BACKLOG.md`.
- Durable architecture and workflow decisions belong in `docs/DECISIONS.md`.

Roadmap and backlog items do not become active scope until the Architect moves them into the current stage. Future ideas should always be evaluated against the core mission: reducing uncertainty in real estate decisions.

## 16. Lessons Learned

**Status: In Progress**

Current lessons:

- The project detail page should be a universal engine, not a one-off template.
- Supabase should remain the shared source of truth across web, booth, sales, and CRM.
- Deterministic intelligence is critical before adding AI.
- Recommendations need traceability through `sourceFields` and `sourceValues`.
- Lead capture should be treated as production infrastructure, not a visual form.
- Documentation should evolve alongside implementation so product direction stays clear.

Operating lesson:

Build Forever as one coherent system, not a collection of disconnected interfaces. The website, Tablet Booth Mode, CRM, sales tooling, Intelligence Engine, Decision Engine, and future AI modules should all express the same underlying Forever OS.
