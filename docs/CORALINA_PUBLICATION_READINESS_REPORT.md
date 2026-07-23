# Coralina publication readiness report

**Audit ID:** CORALINA-PUBLICATION-READINESS-001
**Repository baseline:** `origin/main` at `453d8342601bfa34731a0f00d425c438d2c494b1` (PR #96 merge)
**Audit branch:** `codex/coralina-publication-readiness`
**Scope:** Repository evidence only. No production database, Storage, Cloudflare, Lovable, deployment, import, publication, Rainpalm action, migration application, merge, or auto-merge was performed.

## Decision

Coralina is **not yet safe to publish**. The source package is unusually complete, and Forever Studio can create the first honest public record immediately after its production rollout, but first publication remains blocked by one repository privacy correction that must be separately migrated, plus explicit owner decisions. The public page must launch as a source-backed project record, not an advisory, verification, or investment dossier.

The correction in this PR is deliberately limited and unapplied: it prevents public database roles from receiving private provenance/source-path columns from published Coralina rows. It is not a production write.

## Reconstructed current state

| Subject | Committed evidence | Current meaning |
| --- | --- | --- |
| Canonical identity | `forever-data/projects/coralina/manifest.json`; `src/features/coralina-integration/data/coralina-facts.ts` | Official name **The Title Coralina Kamala**; canonical slug **`coralina`**. |
| Developer | Manifest and Coralina facts | **Rhom Bho Property Public Company Limited**, backed by the cited official SEC filing. The planned progressive payload intentionally retains it as `developer_name_raw` with `developer_id: null`; no repository evidence proves a production developer UUID. |
| Location | Manifest / facts | Kamala, Phuket, Thailand. Area detail: Kamala Beach / walk to beach 430 m. Coordinates are absent. |
| Current import intent | `import-status.json`; `progressive/payload.json`; `PAYLOAD_SUMMARY.md` | Source-verified and fit for dry-run planning, not executed. The batch is create-mode with `publish: false`, draft intent, `forever_verified: false`, 1 project / 8 buildings / 198 units / 198 price-history rows / 6 warnings / **0 media and 0 documents**. |
| Buildings and units | Progressive payload | Buildings A�H: 33/20/12/27/20/52/22/12 units; 198 units, all source-labelled `available` as of the price-list source. |
| Prices | Progressive payload | 198 rows, THB 5,236,272 to 21,325,248, price-list date **2026-07-03**, version **V.2**. The price list does not print currency; THB is `inferred_default` (medium confidence) from source-verified Thailand under `project_country_default_currency v1.0.0`. |
| Known gaps/warnings | `progressive/payload.json` | Developer/location canonical IDs unresolved; coordinates, construction status and completion date missing; media/document processing deferred. |
| Material inventory | `import-status.json`; `extracted/*.json` | 4 brochures, 2 price lists, 10 master-plan files, 198 unit-plan files, 116 images, 3 videos, and 10 source-document files. Extracted inventories record 119 media and 16 documents when brochures/price lists/maps are included. |
| Public rendering now | `ProjectService`, `ProjectDetailService`, routes | Coralina local preview is DEV-only and excluded from the production bundle. Production can render it only after a real active, published database record exists. |

The README phrase �Classified, not ready for import� describes the historical package boundary; the later `import-status.json` narrows �ready� to deterministic dry-run planning. Neither authorizes execution or a database write.

## Public surfaces and truth behaviour

- Catalogue, Discovery/search and Navigator all obtain their public catalogue from `ProjectService.listActive()`. Direct project routes use the same active-project boundary. The current migration chain additionally makes anonymous project reads require `is_active = true AND public_status = 'published'`.
- Sitemap URLs come from `ProjectService.listActiveSlugs()`; unpublished Coralina has no sitemap URL. Known fictitious seed slugs are removed from catalogue, detail and sitemap flows.
- The DEV-only Coralina preview is guarded by a direct `import.meta.env.DEV` dynamic import. It cannot be a production route or production-bundle dependency.
- Project Detail omits media/documents/plans/investment sections when their arrays or facts are empty. It does not substitute stock media.
- Passport renders a sparse-record state: �Advisory assessment pending�; it expressly issues no Score, verdict, rental projection or verification claim. Intelligence is not rendered without advisory evidence. The public mappers suppress legacy verification, score, verdict, rental, yield, growth, promotion and inspection columns introduced before PR #94.
- Studio holds uploaded files in private staging and copies only byte-class-validated selected media to public buckets. Its tests cover forged-media rejection and private retention of non-public files.

## Publication-readiness matrix

| Area | Classification | Evidence and action |
| --- | --- | --- |
| Identity and developer | READY | Official name, raw developer identity and stable `coralina` slug are source-backed. Use the exact slug in the Studio job. |
| Location | READY WITH TRANSPARENT LIMITATION | Kamala / Phuket / Thailand are supported; no coordinates. Do not show a pin, GPS map or exact address without a source. |
| Descriptions | READY | Brochure provides tagline, description, highlights, beach distance and nearby-place statements. Preserve source wording; do not turn marketing copy into a Forever finding. |
| Status and completion | BLOCKED BY MISSING SOURCE | No Coralina-specific construction status or completion date. Hide both. |
| Unit inventory | READY WITH TRANSPARENT LIMITATION | 8 buildings, 198 unit rows and source-labelled availability are present. It is a dated price-list snapshot, not live reservation availability. |
| Prices and availability | OWNER DECISION REQUIRED | The dated V.2 source gives numbers but not printed currency. Either hide prices / state �request current availability� or explicitly approve a clearly labelled THB inference with date context. Never present it as verified or live. |
| Payment terms | BLOCKED BY MISSING SOURCE | No payment plan/terms in the extracted package. |
| Ownership statements | BLOCKED BY MISSING SOURCE | No freehold/leasehold or other tenure statement. |
| Facilities | READY | Source-backed facilities/highlights exist; publish only stated facilities and avoid operational promises. |
| Master plan | READY WITH TRANSPARENT LIMITATION | Ten source files exist, but none is public in the current payload. Upload an approved byte-validated plan to Studio to render it. |
| Floor and unit plans | READY WITH TRANSPARENT LIMITATION | 198 unit-plan source files exist, but no public URLs are currently written. Publish an approved subset; avoid implying a plan is tied to a particular unit unless sourced. |
| Gallery and video | OWNER DECISION REQUIRED | 116 images and 3 videos are classified as Coralina materials, but the repository contains no licence/permission/release record. The owner must approve public use; Studio then validates bytes and copies selected items. |
| Downloadable documents | OWNER DECISION REQUIRED | Brochures, maps, facilities and price-list files exist but are deferred in the payload. Approve each public document; Studio keeps unselected/legal/internal files private. |
| Passport | READY WITH TRANSPARENT LIMITATION | Sparse Passport is deliberately neutral and labels advisory assessment pending. |
| Scores, verdicts, rental and investment claims | READY | Suppressed by PR #94 public mappers and absent from source evidence. Do not create `investment_data` or advisory claims for launch. |
| Missing-data presentation | READY | Empty sections are hidden and absence is neutral; no stock-image fallback is allowed. |
| Media rights | OWNER DECISION REQUIRED | Classification is not a public-use licence. Written approval or documented publisher authorization is required before upload. |
| Contact CTA | READY | Project Detail has an advisory form carrying project slug/source; use it, not a developer-contact assertion. |
| Mobile behaviour | READY WITH TRANSPARENT LIMITATION | Responsive components support mobile; execute a manual mobile smoke check after the authorised deploy because no real public Coralina record exists today. |
| Publish/unpublish rollback | READY | Studio�s authorised project toggle changes publication state; RLS and sitemap/catalogue queries then remove an unpublished record. Verify on the deployed environment during launch. |
| Forever Studio compatibility | READY WITH TRANSPARENT LIMITATION | Studio�s Coralina-like test proves 8 buildings/198 units/198 prices plus private-staging/public-media controls. Production rollout and the privacy migration below are prerequisites. |
| Source paths/private metadata | TECHNICAL DEFECT � corrected in repository, unapplied | Existing RLS was row-only. A published Coralina row could expose `projects.field_provenance`, `units.metadata`, `project_media.metadata` and `unit_price_history.source_file/metadata` through broad public table grants. This PR changes public app queries to explicit columns and adds an unapplied grant-reduction migration. |

## Truth boundary

Subject to separately applying the new privacy migration before first publication:

1. **No fabricated claims:** Coralina facts come from committed manifest/extractions. Coordinates, construction/completion, tenure, payment terms, bathrooms, rental data and investment data are explicit gaps and must be omitted.
2. **No unsupported verification or invented advisory:** public mappers hard-set legacy advisory scalars to absence. Passport�s sparse state is neutral; Intelligence is absent. No �Forever verified,� Score, verdict, buy recommendation, yield, rental-demand or capital-growth claim can render from current Coralina data.
3. **No uncontextual stale quote:** the progressive graph writes price history, but not a public price-summary field. It therefore does not presently expose the V.2 numbers on Project Detail. If an owner later adds a starting price, it must carry 2026-07-03 context and resolve the inferred-currency decision.
4. **No borrowed media:** production does not bundle the Coralina preview; ProjectService has no stock-image fallback. Studio publishes only observed-byte-matching files. Rights approval remains an owner gate.
5. **No source paths/private metadata:** this was not true under pre-existing broad grants. `20260723130000_public_projection_privacy.sql` revokes them and restores only rendered columns; source-bearing price history has no public grant. It is intentionally not applied by this audit.
6. **No duplicate Coralina record/route:** launch must set `projectSlug: "coralina"`. Studio otherwise derives `the-title-coralina-kamala` from the name (as its Coralina-like test demonstrates), which would create a second route. Before action, search Studio/production for both slugs; do not publish if either existing state is unexpected.

## Smallest commercially useful first page

After Studio is deployed and the privacy migration is separately applied, the minimum honest page is:

- Official name, developer-as-stated, Kamala/Phuket, residential type and brochure-derived one-paragraph description.
- A source-approved hero image **only if** public-use authority is recorded; otherwise a neutral no-media state is preferable to a borrowed image.
- The existing advisory contact CTA, with `projectSlug: "coralina"`.
- Neutral Passport �available record / advisory assessment pending.�
- No completion/ownership/payment/rental/investment assertions, no Score/verdict/verification badge, and no claimed live availability.
- Prices omitted unless the owner chooses dated inferred-THB disclosure; �request current pricing and availability� is a useful honest alternative.

### Mandatory before first publication

1. Complete the separately authorised Studio production rollout.
2. Apply the unapplied public-projection privacy migration through the normal release process, then verify anonymous API requests cannot select provenance, metadata or price-history source paths.
3. Record the owner�s public-media/document authority and select only approved files for Studio upload.
4. Use Studio with explicit `projectSlug: "coralina"`; preflight both `coralina` and `the-title-coralina-kamala` for collisions before publishing.
5. Decide the price posture (hide versus dated inferred-THB disclosure) and preserve V.2 / 2026-07-03 context if shown.
6. Smoke-test the public route, catalogue/Discovery/Navigator inclusion, sitemap inclusion, mobile view and one-click Studio unpublish rollback.

### Valuable in the first week

- Add selected approved gallery images, brochure, map/master-plan and unit-plan links through Studio.
- Obtain direct price-currency confirmation and a refreshed price list; then add a public dated price summary only if the display contract can show date/context.
- Obtain construction/completion, tenure, payment and exact-location sources before publishing those facts.
- Link the developer to a proven canonical developer record if one is available; until then retain the raw name without a Forever verification claim.

### Catalogue-scale improvements later

- Public, column-safe views or a dedicated public API projection rather than direct table access.
- A current-price projection that exposes price date/currency provenance without exposing `unit_price_history` raw source metadata.
- Source/rights registry, structured facility taxonomy, per-unit plan associations, translation/accessibility media metadata, and a formal evidence contract for Passport/Intelligence.

## Repository correction and validation

This PR adds:

- `supabase/migrations/20260723130000_public_projection_privacy.sql` � **unapplied** grant minimisation; no production migration was run.
- Explicit public fields in `src/lib/project-service.ts` and `src/features/project-detail/project-detail-service.ts`.
- `src/lib/public-query-contract.test.ts` to prevent wildcard public projections and broad provenance-bearing grants from returning.

No Coralina data was fabricated or changed. No production state was read or modified.