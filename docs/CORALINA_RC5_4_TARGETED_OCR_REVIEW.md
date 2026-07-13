# Coralina RC5.4 Targeted OCR Review

## Currency policy completion

The selling-price table columns on pages 1-4 are `Price/sqm` and `Selling Price` and do not name a currency. Page 4 separately states THB for sinking fund and common fee; those labels apply only to additional costs and are not used as direct selling-price evidence. Selling prices use `THB` with status `inferred_default`, medium confidence, and rule `project_country_default_currency` v1.0.0 because the project country is source-verified as Thailand. The original null source currency remains in provenance.

Task ID: RC5.4

Review date: 2026-07-13

Status: Source verified after the targeted local review was extended with official corporate and government-hosted web evidence. No database records were changed.

## Official-source resolution

The local-only checkpoint correctly stopped on ambiguous brochure branding and an unstated country. RC5.4 then applied the approved official-source hierarchy:

- Rhom Bho Property's official corporate history records the October 2025 launch of `The Title Coralina Kamala` in Phuket Province.
- Rhom Bho Property's official nature-of-business page identifies the legal company as a property developer and `TITLE` as its brand.
- The company's Q1 2026 filing hosted by Thailand's SEC states that Rhom Bho Property develops Phuket condominiums under `The Title`, lists Coralina Kamala in its portfolio, and explicitly identifies Thailand.
- Official shareholder materials identify AssetWise as an indirect major shareholder through 39 Estate, not as Coralina's developer.

Canonical results: developer `Rhom Bho Property Public Company Limited`; project name `The Title Coralina Kamala`; brand `The Title`; location `Kamala, Phuket, Thailand`.

## Outcome

Local deterministic rendering and OCR are available without installing repository dependencies:

- Poppler `pdftoppm` 26.05.0 from the bundled Codex runtime.
- Windows `Windows.Media.Ocr.OcrEngine` on Windows NT 10.0.26200.0.
- Available local OCR languages: `en-US`, `ru`.

A one-page 150 DPI PNG rendering test succeeded on the English Coralina brochure. A one-page English OCR test returned `BEAUTY OF THE OCEAN`. Processing remained local.

The targeted review then rendered 34 pages from four likely authoritative PDFs: selected English and Russian brochure identity/location/contact pages, all 16 pages of the supplied company profile, and both supplied map pages. Rendered pages and OCR caches stayed under ignored `.codex/tmp/rc54-ocr` and are not repository artifacts.

## Initial local developer finding

The local PDFs alone were unresolved. The Coralina brochure page 36 directly displays both `Rhom Bho Property` and `AssetWise` and supplies a `rhombho.co.th` sales contact, but it does not define their roles. Official corporate evidence now resolves those roles.

The company profile states a corporate/portfolio relationship and explicitly names `Rhom Bho Property Public Company Limited` as developer of other Title projects. It does not explicitly identify Coralina's developer. Applying another project's developer identity to Coralina would be inference.

The verified developer value is now promoted with official-source provenance.

## Initial local country finding

The local PDFs explicitly show Kamala and Phuket but not Thailand. Official corporate history and the SEC-hosted filing now complete the location hierarchy without relying on `.co.th` inference.

The verified country value is now promoted with official-source provenance.

## Structured evidence

The complete hashes, relative source paths, page locators, rendering parameters, OCR engines, excerpts, candidate names, ambiguity notes, approval states, and stop reasons are recorded in:

`forever-data/projects/coralina/evidence/rc5-4-evidence-review.json`

Only this structured review artifact is allowlisted. Source PDFs, incoming archives, rendered pages, OCR caches, images, videos, and all other evidence-directory files remain ignored.

## Import result

The Coralina Import Engine dry-run now completes:

- `developer`: `Rhom Bho Property Public Company Limited`
- `country`: `Thailand`
- `ready_for_import`: `true`
- operations: 405 (project 1, buildings 8, units 198, price history 198)
- database writes: 0

No execute-mode change or database write is authorized by this review.

## Remaining non-blocking evidence gaps

- Coordinates.
- Construction status/completion date.
- Ownership tenure.
- Price currency.
