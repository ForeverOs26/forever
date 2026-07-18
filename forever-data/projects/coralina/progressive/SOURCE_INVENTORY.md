# Coralina Progressive source inventory

This inventory is limited to tracked repository evidence. Historical strict-lane payloads and reports are not payload inputs.

| Payload facts | Authoritative tracked evidence | Decision |
| --- | --- | --- |
| Official name `The Title Coralina Kamala`, brand `The Title` | `evidence/rc5-4-evidence-review.json`, official developer history and Thailand SEC filing | Preserve official name; brand is implicit in the official name because the RPC has no brand column. |
| Developer `Rhom Bho Property Public Company Limited` | `manifest.json`, `import-status.json`, RC5.4 review | Preserve raw name. Keep `developer_id` null because no tracked production UUID proof exists. |
| Location `Kamala, Phuket, Thailand` | `manifest.json`, brochure pages 1/4, RC5.4 review | Preserve the full raw location and `location_area=Kamala`. Keep `location_id` null because no tracked production UUID proof exists. |
| Project type `Residential` | Facilities PDF page 2, recorded in `manifest.json` | Medium-confidence official-project-material provenance. |
| Buildings A–H | `extracted/price-list.json`, 198 rows | Eight unique building codes; no names, descriptions, or completion facts invented. |
| 198 units | `extracted/price-list.json` | Unit number is the project natural key. Source type code is retained in metadata. Bathrooms are omitted/NULL because source confidence is `none`. |
| 198 selling prices, effective 2026-07-03 | `extracted/price-list.json` and the tracked developer price-list PDF | Every source row has one numeric selling price and maps to exactly one unit. |
| THB | RC5.4 evidence review plus `src/import/currency-policy.ts` | `inferred_default`, medium confidence, rule `project_country_default_currency` version `1.0.0`; never represented as direct price-list evidence. |
| Coordinates and construction status | `import-status.json` | Unsupported and omitted/NULL, with explicit warnings. |
| Media/documents | Local repository paths in extracted manifests | Deferred with warnings because repository paths are not stable storage/public URLs accepted for production use. Payload counts are zero. |

Graph proof: 198 extracted rows; 198 unique unit numbers; 8 unique building codes; 198 non-null prices; no missing building assignment; every price shares the unit natural key from its source row.
