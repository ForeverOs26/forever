# Forever Product Specification (FPS)

Version: 1.0

Status: Living Document

## 1. Product Identity

Forever is a Decision Intelligence Platform for Real Estate.

Forever is designed to help people make clearer, safer, and more confident property decisions using verified data, structured analysis, explainable recommendations, and consistent decision support.

Forever is not:

- A property listing website
- A real estate agency website
- A CRM
- An AI chatbot

Forever exists to reduce uncertainty in real estate decisions.

Every product decision must protect this identity. If a feature makes Forever feel like a generic listing portal, sales brochure, CRM, or conversational assistant without evidence, it must be redesigned.

## 2. Mission

Forever's mission is to:

- Reduce uncertainty.
- Increase confidence.
- Help people make better property decisions.

The product must serve the decision, not the transaction alone. Every surface should help users understand what matters, what is known, what is uncertain, what risks exist, and why a property may or may not fit their goals.

## 3. Vision

Forever's long-term vision is to become the most trusted platform for real estate decision making.

People should open Forever before making any major property decision.

Forever should become the place where buyers, investors, families, advisors, and sales teams go to understand a property before they act. The platform should make complex real estate decisions easier to evaluate without oversimplifying material risk.

## 4. Product Principles

### PP-001 Trust Before Beauty

Visual quality matters, but trust matters more. Design must never make weak data look stronger than it is. A beautiful interface that hides uncertainty fails the product.

### PP-002 Evidence Before Opinion

Forever recommendations must be grounded in structured evidence. Opinions are only acceptable when they are clearly derived from data and explained.

### PP-003 Explain Every Recommendation

Every recommendation must answer why. Users should be able to understand the evidence, reasoning, and tradeoffs behind the conclusion.

### PP-004 Never Hide Material Risks

Material risks must be visible, understandable, and placed near the decision they affect. Risk disclosure is a core product function, not a legal afterthought.

### PP-005 Every Screen Reduces Uncertainty

Every screen must help the user know more, compare better, or decide with more confidence. Screens that only decorate, distract, or repeat weak information should not exist.

### PP-006 Information Before Decoration

Decoration must support comprehension. The product should feel premium through structure, hierarchy, spacing, and clarity, not through visual noise.

### PP-007 One Engine - Many Interfaces

Forever should use one shared data and intelligence foundation across website, tablet, CRM, PDF, AI, mobile, and future interfaces. Interfaces may differ, but truth must not fragment.

### PP-008 Data Quality Over Quantity

More data is not automatically better. Forever must prioritize accurate, verified, meaningful, and decision-relevant data over volume.

### PP-009 One Primary Action Per Screen

Each screen should make the next best action clear. Multiple competing primary actions reduce confidence and weaken decision flow.

### PP-010 Premium Through Clarity

Forever should feel premium because it is clear, calm, disciplined, and trustworthy. Premium is expressed through judgment, not excess.

## 5. Product Pillars

### Trust

Trust is the foundation of Forever. Users must believe that the platform is careful, honest, and transparent about what is known and unknown.

### Intelligence

Intelligence means structured evaluation, scoring, comparison, and buyer-fit analysis. It must be deterministic where decisions require accountability.

### Transparency

Transparency means users can see the basis for every score, verdict, recommendation, and risk. Hidden reasoning weakens the product.

### Consistency

Consistency means the same project data and conclusions travel across all Forever interfaces. A property should not tell different stories in different places.

### Decision Support

Decision Support means helping the user move from interest to confidence. Forever should make decisions clearer without pretending that all uncertainty can be removed.

## 6. Product Architecture

Forever's product architecture follows a structured decision chain:

```text
Verified Data
    |
Project Engine
    |
Intelligence Engine
    |
Decision Engine
    |
Passport
    |
Website
Tablet
CRM
PDF
AI
Mobile
```

### Verified Data

Verified Data is the source foundation. It includes project facts, prices, availability, developer information, media, documents, verification dates, and other decision-relevant records.

### Project Engine

The Project Engine turns raw project data into a consistent project model. It ensures that every project can be understood through the same structure.

### Intelligence Engine

The Intelligence Engine evaluates project quality. It produces scores, verdicts, strengths, weaknesses, risks, buyer profiles, and investment interpretation from structured data.

### Decision Engine

The Decision Engine evaluates project fit for a specific client goal. It moves the product from "Is this project good?" to "Is this project right for this client?"

### Passport

The Passport is the canonical project summary. It is the single digital identity of a property across all Forever interfaces.

### Interfaces

Website, Tablet, CRM, PDF, AI, and Mobile are delivery surfaces. They must consume the shared engines and must not create separate truth.

## 7. User Journey

The ideal Forever customer journey is:

```text
Interest
    |
Discovery
    |
Understanding
    |
Comparison
    |
Confidence
    |
Decision
    |
Purchase
    |
Ownership
```

### Interest

The user becomes aware of a project, market, location, or investment possibility. Forever must give the user a reason to investigate with confidence.

### Discovery

The user explores available projects and categories. Forever must help them identify relevant options without overwhelming them.

### Understanding

The user studies a project in depth. Forever must explain the project, its evidence, its strengths, and its risks.

### Comparison

The user compares alternatives. Forever must make differences visible, meaningful, and connected to the user's goals.

### Confidence

The user begins to trust a direction. Forever must clarify what supports that confidence and what uncertainty remains.

### Decision

The user chooses a next step. Forever must make the decision path clear, documented, and evidence-based.

### Purchase

The user moves into transaction support. Forever must preserve context and ensure the reasoning behind the decision is not lost.

### Ownership

The user owns or manages the property. Forever should continue to support understanding, updates, resale thinking, rental strategy, and future decisions.

## 8. Core Product Components

### Hero

Purpose: Establish the project identity and immediate decision context.

User Question: What is this project and why should I continue?

Required Data: Project name, location, type, status, primary image, headline value proposition, price context.

Success Criteria: The user understands the project category and relevance within seconds.

### Passport

Purpose: Provide the canonical project summary across Forever interfaces.

User Question: What is the verified identity and current decision snapshot of this property?

Required Data: Forever ID, project name, verdict, overall score, core scores, buyer profile, recommendation summary, risks, inspection date, price update date.

Success Criteria: The user can understand the project's current standing without reading the full detail page.

### Intelligence Report

Purpose: Explain the structured assessment of the project.

User Question: Why does Forever evaluate this project this way?

Required Data: Scores, verdict, strengths, weaknesses, risks, source fields, source values, buyer profile, investment horizon.

Success Criteria: The user understands the reasoning behind the recommendation and can trace it to data.

### Investment Analysis

Purpose: Explain the financial and investment characteristics of the project.

User Question: What are the investment implications, returns, risks, and time horizon?

Required Data: Price, yield, rental demand, capital growth estimate, rental assumptions, investment rows, unit economics.

Success Criteria: The user understands the financial case and its limitations.

### Gallery

Purpose: Show visual evidence of the project.

User Question: What does the project actually look like?

Required Data: Cover image, gallery images, videos, image labels, media type, sort order.

Success Criteria: The user can visually inspect the project without confusion or misleading presentation.

### Developer

Purpose: Explain who is responsible for delivering the project.

User Question: Can I trust the developer?

Required Data: Developer name, description, website, contact information, logo, track record where available.

Success Criteria: The user understands the developer's role and credibility.

### Documents

Purpose: Provide supporting evidence and transaction materials.

User Question: What formal documents support this project?

Required Data: Brochures, floor plans, master plans, price lists, payment plans, legal or project documents where available.

Success Criteria: The user can access decision-relevant documents from a clear and organized area.

### Contact

Purpose: Convert informed interest into a qualified next step.

User Question: How do I ask about this project or take the next step?

Required Data: Name, email, phone, country, budget, interest, project slug, message, source.

Success Criteria: The user can submit interest with confidence and the sales team receives useful project context.

## 9. MVP Scope

### Included in MVP

- Public website project discovery.
- Universal Project Detail Engine.
- Supabase-backed project data.
- Lead submission.
- Forever Intelligence Engine MVP.
- Forever Intelligence Report UI.
- Forever Passport architecture.
- Forever Passport UI MVP.
- Core project media, documents, units, developer, and investment sections where data exists.
- Blueprint and Product Specification governance documents.

### Not Included in MVP

- Full CRM.
- Tablet Booth Mode production release.
- Decision Engine production UI.
- AI recommendation engine.
- Automated legal advice.
- Payment processing.
- Contract workflows.
- Owner portal.
- Multi-market operating system.
- White-label portals.

## 10. Definition of Done

A feature is complete only if:

- Build passes.
- TypeScript passes.
- It is responsive.
- It matches the Blueprint.
- It matches Standards.
- It matches this Product Specification.
- It provides measurable user value.

If a feature fails any of these conditions, it is not done.

## 11. Forever Promise

Forever will never recommend a property simply because it is profitable for Forever.

Forever recommends the property that best matches the client's goals using transparent evidence.

This principle is fundamental because trust is the product. If users believe recommendations are driven by commission, inventory pressure, or hidden incentives, Forever fails its purpose. The platform must protect decision quality even when that means showing risks, recommending caution, or explaining that a project is not the best fit.

## 12. The Forever Test

Every new feature must answer yes to:

- Does it reduce uncertainty?
- Does it increase trust?
- Is it understandable without explanation?
- Does it follow the Forever mission?
- Will it still make sense in five years?

Any feature failing this test must be redesigned.

## 13. Product Governance

This document is mandatory for:

- Codex
- Lovable
- Future developers
- Future designers
- Future AI agents
- All future product decisions

All work on Forever must respect this specification. Product decisions that conflict with it require explicit review and revision of the governing documents.

## 14. Relationship with Blueprint

The Forever constitutional foundation consists of four documents:

- Blueprint explains why Forever exists.
- Product Specification explains what Forever must become.
- Standards explain how it is built.
- Decision Log explains why important decisions were made.

Together, these documents define the constitutional foundation of the Forever Platform.
