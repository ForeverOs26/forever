# Forever Owner Direct Publication Policy

Status: Owner-approved durable product decision
Date: 2026-08-02
Authority: Owner

## Purpose

This document establishes the canonical operating policy for adding projects to Forever Studio and publishing them to the public catalogue.

Forever is commercially useful only when it contains a broad, current catalogue of real projects the Owner actively works with. The immediate catalogue objective is therefore **100 or more commercially relevant projects**, not a small catalogue held behind repeated content-review gates.

This policy supersedes any interpretation of earlier roadmap language that treats 5–8 projects as a permission gate for further catalogue growth. The first 5–8 projects remain an operational pilot batch for measuring speed and correcting Studio friction; they do not limit continued publication.

## Core decision

When the Owner creates a project in Forever Studio, enters project information, selects amenities, uploads official developer materials and presses Publish, that action is the publication authorization.

The Owner's decision means:

- the Owner works with the project;
- the project is commercially relevant to Forever;
- the Owner has selected the project for the catalogue;
- the Owner trusts the entered information and selected developer materials as sufficient for publication;
- no secondary business, factual, readiness, verification, review or publication-approval queue is required.

No employee, AI agent, automated classifier or later workflow may independently decide whether an Owner-selected project is "worthy" of publication.

## Publication speed

The required operating target is:

```text
open New Development
→ enter the useful available information
→ select amenities and exact materials
→ press Publish
→ useful public project available
≤ 15 minutes of Owner time
```

Studio must be optimized for repeated publication at catalogue scale.

The initial publish flow must require only the minimum information needed to create a usable, identifiable project safely. Missing optional business fields, documents, plans, payment schedules, media, prices, units, descriptions or enriched analysis must not create a publication gate.

## Official developer materials

Official materials selected and uploaded by the Owner are sufficient source material for immediate publication, including:

- brochures;
- price lists;
- payment plans;
- master plans;
- floor plans;
- unit plans;
- project photographs and renders;
- videos;
- developer or company profiles;
- construction media;
- project and legal documents.

These materials do not require a second confirmation by another employee, AI model, reviewer, lawyer or approval workflow before publication now or later.

Forever may truthfully label provenance such as:

- `Official developer material`;
- `Developer-provided`;
- `Uploaded by Forever Owner`;
- `Current as of [known date]`.

This source label is not a secondary approval requirement and must not delay publication.

The platform must not relabel developer-provided material as independently verified, legal due diligence, guaranteed, certified or independently confirmed unless that separate work was actually performed.

## Owner-entered data is authoritative

For Studio publication, the Owner is the authoritative business source for:

- project selection;
- entered project facts;
- developer and location association;
- selected material purpose;
- selected amenities;
- public/private material choice;
- later corrections and enrichment.

The system may normalize formatting and protect data integrity, but it must not override or withhold an Owner-entered value because an automated process prefers another interpretation.

## Amenities

Amenities must be available as a fast Owner-controlled checkbox selection.

Rules:

- the Owner selects which amenities exist at the project;
- the selected amenities are published without an additional evidence or approval requirement;
- no AI or image analysis is required;
- no later reviewer must reconfirm the selection;
- the Owner may add or correct amenities later;
- an empty amenity selection means the section is omitted or shown neutrally, not inferred.

The implementation should use a canonical amenity catalogue plus project-to-amenity relationships so amenities remain filterable and comparable across the platform.

## Material visibility

Every material intentionally selected by the Owner in a Studio material window is intended to appear in the appropriate public project section unless the Owner explicitly marks that individual material as private or internal.

Examples:

- Project Photos / Renders → public gallery;
- Brochure → public brochure/document section;
- Price List → public price-list/document section and later structured extraction where supported;
- Payment Plan → public payment-plan/document section;
- Master Plan, Floor Plans and Unit Plans → appropriate public plan sections;
- Video → public video section;
- Developer / Company Profile → public project/developer document section;
- Documents / Legal → public document section unless explicitly marked private;
- Construction Photos / Videos → public construction-update sections.

The platform must not silently hide an Owner-selected document merely because its material type was historically treated as private.

## Publish first, enrich later

The required lifecycle is:

```text
Owner-entered project + selected files
→ immediate useful publication
→ background processing and extraction
→ later manual or automated enrichment
```

Post-publication enrichment may include:

- structured prices;
- unit inventory;
- payment-plan structure;
- richer descriptions;
- developer due diligence;
- location analysis;
- Passport and Intelligence fields;
- rental, investment and exit analysis;
- construction updates.

None of these enrichment layers may become a prerequisite for the initial Owner-authorized publication.

A failure to parse or enrich one material must not suppress the project or unrelated successful materials. The original selected material should remain available when technically safe to serve, and the project may be corrected or enriched later.

## Technical checks that remain mandatory

The removal of content-approval gates does not remove technical or security boundaries.

The platform must still perform automatic checks for matters such as:

- authentication and authorization;
- file integrity and completed upload;
- safe file type and magic-byte compatibility;
- malware or executable-content refusal where applicable;
- safe image decoding and sanitization;
- prevention of credential, signed URL and private object-key disclosure;
- correct R2 bucket and ownership boundaries;
- duplicate and cross-project corruption protection;
- safe public/private delivery.

These checks are technical safety controls, not business or factual approval. They should be automatic and should block only the unsafe material or unsafe operation when possible, not create a manual content-review queue.

## Truth boundary

Forever's public truth standard remains in force, but it must not be misused as an approval gate.

The truthful public representation is:

- Owner-entered information is shown as Owner-provided information;
- official developer material is shown as developer-provided material;
- unknown information remains unknown or absent;
- independent verification is claimed only when independently performed;
- guarantees, legal certification and unsupported claims remain prohibited.

The fact that a source is developer-provided does not make it unpublishable and does not require a second source.

## Catalogue-scale operating sequence

The immediate sequence is:

```text
stabilize ordinary R2 publication and recover Coralina
→ prove the ≤15-minute Studio flow
→ publish the first operating batch
→ grow through 20 projects
→ grow through 50 projects
→ reach 100+ Owner-selected projects
→ continue enrichment without stopping catalogue growth
```

Project-count expansion does not require a new approval after the first 5–8 projects.

## Required implementation follow-up

After the current Coralina/R2 recovery work, the next product task is:

`FOREVER-STUDIO-FAST-PROJECT-ONBOARDING-001`

It must cover at least:

- ≤15-minute project publication;
- minimum necessary required fields;
- no readiness or approval queue;
- rapid developer and location selection or creation;
- Owner-controlled amenity checkboxes;
- public display of Owner-selected materials;
- explicit per-material private/internal override;
- background enrichment that does not block publication;
- editing after publication;
- efficient repeated creation of the next project;
- measurable publication time and failure rate.

## Metrics

The relevant operating metrics are:

- median Owner time from opening Studio to public project;
- percentage published within 15 minutes;
- publication failure rate;
- number of Owner-selected projects published;
- corrections required after publication;
- time required to update an existing project;
- number of materials displayed successfully;
- catalogue coverage relevant to active guest demand.

## Review triggers

Review the Studio workflow after:

- the first 10 projects;
- 20 published projects;
- median Owner time exceeds 15 minutes;
- repeated publication failures occur;
- a technical safety control unnecessarily becomes a manual content-approval gate.

Any future proposal to restore secondary factual approval, readiness review or publication approval for Owner-selected projects requires a new explicit Owner decision.
