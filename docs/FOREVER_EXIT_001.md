# FOREVER-EXIT-001 — Ownership & Exit

Status: Owner-approved strategic direction; implementation remains separately gated  
Date: 2026-08-03  
Authority: Owner  
Risk class: R0 for this document

> This document is product and roadmap authority, not legal advice and not deployment authorization. Any brokerage, mandate, assignment, resale, tax, personal-data, migration, or production action requires the applicable legal and Owner gates.

## 1. Product decision

Forever will build **ownership continuity and exit from a property**, not an open listing portal.

The first commercial product is **Forever Exit**: a demand-first, mandate-backed service for:

- off-plan assignment before handover;
- resale after title transfer;
- existing Forever clients who may later need liquidity;
- buyers who want access to investor exits inside projects they are already considering.

The unit of commercial authority is not a free-form listing. It is a **signed owner mandate for a specific unit**, connected to a project Forever already knows.

This direction supports the existing North Star: reservations and closed transactions in which Forever materially influenced the decision. It does not authorize a mass marketplace, lead resale, public owner registration, platform escrow, or inventory acquisition onto Forever's balance sheet.

## 2. Why this fits Forever

The research considered six distinct models: a mandate registry, owner-paid visibility, exclusive success-fee brokerage, a co-broker protocol, an Assignment Desk, and an Exit Passport.

The selected direction combines the strongest parts without turning Forever into a portal:

1. **Assignment first.** Off-plan exits remain inside Phuket new developments and can be matched to demand already captured by Navigator, advisors, project pages, and later CRM.
2. **Success fee first.** The first transaction can be found and closed manually; traffic scale and subscriptions are not prerequisites.
3. **Mandate-backed publication.** A public exit offer requires the owner's written authority to market that specific unit.
4. **Evidence-backed disclosure.** Public facts are derived from the mandate and supporting documents, while sensitive documents remain private.
5. **Project-native placement.** An exit is shown inside the project and unit context, not as a disconnected duplicate listing.
6. **Existing-client flywheel.** Every Forever-assisted purchase becomes a potential future exit, referral, rental, upgrade, or second purchase relationship.

## 3. Important boundary with Owner Direct Publication

`docs/FOREVER_OWNER_DIRECT_PUBLICATION_POLICY.md` remains fully in force for Owner-selected developer projects and official developer materials.

The mandate rule for Forever Exit is not a secondary factual approval queue and must not be used to slow project catalogue publication.

The two contracts are different:

- **Project catalogue:** the Owner selects a project and official developer materials; Publish is the publication authorization.
- **Specific owner exit offer:** Forever is representing a third party's right to market a specific unit; a signed mandate is the legal/commercial authority for that offer.

For an existing Forever client, the mandate flow should be prefilled and fast. No duplicate factual review, readiness review, or manual approval queue is added after the mandate is valid.

## 4. Refined product system

The research is strong. One improvement is adopted: treat Assignment Desk as the first transaction product inside a broader **Forever Ownership & Exit Loop**.

### 4.1 Ownership Record — internal from the first sale

For every past and future Forever-assisted purchase, record at minimum:

- client relation;
- project;
- developer unit reference;
- canonical `unit_id` when available;
- purchase date;
- purchase price;
- payment schedule;
- amount paid when known;
- handover/completion milestone;
- source and last update date.

This record is internal and is not a public listing.

### 4.2 Exit Intent — private signal, no public offer

A client may privately tell Forever:

- considering assignment;
- considering resale;
- wants a valuation or exit check;
- wants to be contacted only when matching demand exists.

An Exit Intent creates no public page and requires no public owner account.

### 4.3 Mandated Exit Offer — public only after authority exists

After a signed mandate:

- `assignment` is used for off-plan contract transfer;
- `resale` is used for completed property with title;
- the offer is attached to the canonical unit whenever possible;
- the owner identity and contact details remain internal;
- the SPA, proof of payment, mandate, FET, quota evidence, title and similar legal/personal files remain private by default;
- only safe derived fields and explicitly public media appear publicly.

### 4.4 Exit Match — demand first

The primary advantage is not another inventory page. It is matching a mandate to real demand already known to Forever.

Demand sources may include:

- a guest viewing the project;
- Navigator project fit;
- a named-project enquiry;
- an advisor shortlist;
- a unit or price preference;
- later, a CRM lead with project/unit context.

The first implementation should be deterministic and simple: project, unit type, bedrooms, size, budget, timeline, ownership form and buyer restrictions. It must not sell or reroute the guest's data to unknown agents.

### 4.5 Exit Passport — proof and economics

Exit Passport is the evidence product around the offer. Depending on assignment or resale, it may show:

- current asking price and last verification date;
- amount and percentage paid;
- remaining developer payment schedule;
- contractual/developer transfer conditions;
- developer fee when documented;
- ownership form;
- foreign-quota status and date when applicable;
- lease term and exact renewal wording when applicable;
- purchase date;
- FET status when applicable;
- known taxes/fees only after legally confirmed;
- missing information explicitly marked as unavailable.

A free **Exit Check** is the lead-generation entry point. A paid standalone Exit Passport may be tested later; it should be included or credited when the owner signs an exclusive mandate.

## 5. Public experience

### 5.1 Sold-out units first

The initial public pilot should prioritize units confirmed unavailable from the developer or otherwise sold out. This reduces developer-channel conflict and restores access to inventory that buyers can no longer purchase directly.

Displaying an investor exit beside a unit still actively sold by the developer requires a separate project-level business rule or developer conversation.

### 5.2 Where the offer appears

Initial placement:

1. project inventory table — `Investor exit` / `Owner exit` price;
2. unit card — paid amount, remaining schedule, fee when documented, last update;
3. direct share link — `/assignment/$slug` or `/resale/$slug`;
4. project CTA — `I own a unit in this project`;
5. project CTA — `Notify me about investor exits in this project`.

Do not create a separate public Assignments marketplace until the number of active, current offers justifies it.

### 5.3 Canonical unit identity without blocking speed

The commercial identity must always be a specific unit. When a full unit row already exists, the offer links to `public.units`.

When a project has been published quickly without complete unit inventory, Studio may create a minimal canonical unit stub from Owner-controlled data such as developer unit code, building, bedrooms, size and floor. The exit offer must not become a disconnected free-form duplicate listing.

## 6. Existing-client value and lead generation

The strongest acquisition loop is post-purchase continuity:

```text
Forever helps a client buy
→ Forever retains the buyer↔unit relationship
→ the client receives useful project/property updates
→ the client can request an Exit Check privately
→ Forever matches the unit to current buyer demand
→ Forever handles assignment/resale under mandate
→ the completed exit becomes a verified comparable and referral event
```

Near-term client-facing triggers:

- `I own a unit here`;
- `I am considering selling or assigning`;
- `Check my exit options`;
- `Notify me when a matching buyer appears`;
- `Notify me when an investor exit appears in this project`.

A full owner portal is deferred. The first version may use authenticated staff workflows and secure one-time owner links without opening public registration.

### 6.1 Additional market research

Official homeowner products support the post-purchase relationship pattern:

- Zillow's Owner Dashboard lets a verified owner claim a home, track value, price changes, equity and sale-related insights: https://www.zillow.com/z/owner-dashboard/
- Rightmove's Track My Property lets users track property estimates and monthly changes: https://www.rightmove.co.uk/guides/track-your-property/
- Homebot positions recurring homeowner insights as a way for agents and lenders to maintain the relationship after closing and surface sell/buy/referral intent: https://homebot.ai/real-estate-agents
- Mosaik documents the same post-closing homeowner-portal pattern for repeat and referral business: https://mosaik.io/blog/homeowner-portals-post-closing

These examples do not define Forever's product. Forever's differentiation is project-specific source evidence, owner mandates, and direct matching to live Phuket buyer demand.

## 7. Monetization

### Initial horizon — transaction proof

- assignment: success fee;
- resale: success fee;
- co-broker: transparent agreed split after closing;
- no owner subscription;
- no paid verification badge;
- no lead resale;
- no platform escrow;
- no iBuying.

Commission rates remain an Owner commercial decision and must be confirmed against actual signed agreements and legal/accounting advice before public pricing.

### Later horizons

After transaction proof:

- optional paid standalone Exit Passport;
- developer-sponsored project visibility as a clearly separate SKU;
- verified transaction/comparable data products only after sufficient coverage;
- partner-agent workflows only after Forever has controlled inventory and clear attribution.

## 8. Legal and privacy gates

Before public production implementation, obtain written Thai legal advice covering at least:

- who may legally perform brokerage/front-office work;
- corporate structure and Foreign Business Act implications;
- mandate and assignment document requirements;
- developer-contract restrictions;
- assignment/resale commission wording;
- transfer-fee and tax calculation basis;
- Royal Decree 342 and the five-year SBT rule before any public calculator;
- applicability of the Digital Platform Services regime;
- PDPA controller/processor roles, DPO, RoPA and notice-and-takedown.

The platform must not hold client money. Sensitive owner evidence remains private, access-controlled and purpose-limited.

## 9. Product sequence

### Track A — starts now, no product code required

1. Build the internal buyer↔unit register for past and future Forever transactions.
2. Prepare a Thai-lawyer-reviewed mandate template.
3. Select one existing client/unit and run one assignment or resale case manually end to end.
4. Record every friction point and document gap.
5. Begin a private demand log by project/unit profile.
6. Appoint/confirm DPO and complete the required privacy operating records.

### Track B — current product priority remains catalogue scale

Do not delay:

- Coralina production recovery;
- `FOREVER-STUDIO-FAST-PROJECT-ONBOARDING-001`;
- the 100+ Owner-selected project catalogue objective.

The first Exit code slice begins only after ordinary Studio publication is stable and the manual pilot has produced real workflow evidence.

### Track C — Exit v1 code

1. persist buyer↔unit relationships;
2. private Exit Intent;
3. mandate record and validity;
4. `listings.kind IN ('resale','assignment')`;
5. unit-linked exit offer;
6. safe assignment/resale fields;
7. sold-out-unit presentation;
8. project-page owner and buyer CTAs;
9. deterministic demand matching;
10. direct share page;
11. audit, freshness and expiry.

### Deferred until proof

- full owner portal;
- public owner self-registration;
- open marketplace;
- public Assignments section;
- agent ratings;
- mandatory partner exchange rules;
- paid placement;
- automated public tax calculator;
- transaction-price index;
- broad co-broker network.

## 10. Success metrics

### Immediate operating metrics

- buyer↔unit records captured;
- private Exit Intents;
- signed mandates;
- active mandated offers;
- percentage of public offers with a valid mandate — required 100%;
- percentage of sensitive legal/personal files exposed publicly — required 0%;
- time from mandate to first qualified match;
- matched demand records;
- existing clients re-engaged;
- referrals from existing clients;
- closed assignment/resale transactions;
- Forever-attributed commission.

### Phase-exit evidence

The first technical Exit phase is justified when:

- at least one manual exit transaction has been completed or has produced a documented, legally viable workflow;
- at least one valid signed mandate exists;
- ordinary Studio publication is stable;
- the legal operating structure is documented;
- the build does not delay the 100+ project catalogue objective.

A later public Exit marketplace is justified only by a meaningful number of current mandated offers and buyer demand. Catalogue size alone is not the trigger.

## 11. Review triggers

Review this decision when:

- the first manual transaction closes;
- the first owner refuses a mandate and gives a reason;
- a developer objects to an exit shown inside its project;
- Thai legal advice contradicts the proposed operating structure;
- ten active exit intents exist;
- two exits close through Forever;
- a full owner portal is proposed;
- paid listing visibility is proposed;
- public owner registration is proposed;
- thirty verified exit transactions exist;
- six months pass without review.

## 12. Explicit non-goals

Forever Exit is not:

- an MLS;
- a mass listing portal;
- a public unverified owner marketplace;
- a lead auction;
- a paid verification badge;
- an escrow provider;
- an iBuyer;
- a tokenization product;
- a substitute for Thai legal advice.
