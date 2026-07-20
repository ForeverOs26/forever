# SIP-001B Coralina 2026-07-17 report

Status: ready for independent review; not canonical until Owner merge.

## Authority and sources

- Base: `4f3045cce153d347726955bb234ad76af664e430`.
- Price List: `CLK - Price List V.2. - Updated 17.07.26.pdf`, 251902 bytes, SHA-256 `268c2fa30e39e89c7dd5e3d7751326e3cf958ec2783e5953eabccbece9b3f3c0`.
- Master Plan: `CLK - Master Plan Price list V.2 - updated 17.07.26.pdf`, 1474832 bytes, SHA-256 `1f7d70c83a53b96981dabba3e03206996f8c1c6bfdfc37983a48c9e16eadd2fa`.
- Both owner files stayed outside Git, were rehashed after processing, and are not committed.

## Price-list result

The local Xpdf `pdftotext` 4.06 preflight qualified the price table in table mode: four pages, four repeated-header table regions, 198 candidate rows, 198 accepted rows, no rejected, review, or blocking rows. The content date is `2026-07-17`. Selling-price currency is THB with `inferred_default`; no fee was used as currency evidence. Page 4 supplemental evidence is sinking fund 850 THB/sqm and common fee 85 THB/sqm/month; neither is a unit price.

The narrow generic improvement recognizes tower/floor/room-number/code-type/room-type/price-per-sqm/selling-price headers and stops detached footer fragments entering a row. It contains no project, file-name, unit, row-count, or historical-value condition. Source page and row evidence remain on every row; no arithmetic repair is performed.

Two fresh managed extraction runs produced identical canonical hashes: source proof `a3bc11c60746753c52f7300716d428cb8bf825052105652e0562b33a013c055a`, qualification `9e1e08e4f1101df383389b0466291154d83ae8ecede0d650a2ffa9d617a2013d`, candidate `3e18f3eeb2f877afd5ac078b01e1097f5b942133fd95a70fa65d6a2a5a9b0533`, review summary `e197de598b3ca56b0ccfb03af09088cb21c8eb5de28f32c04407ecc9b2d2399d`, and reviewed list `066f2ddc40cfcabb663ffb8ecf7b492dbde1fc064c7381827d8019b46a5a0c14`.

## Version and companion evidence

Only after the new generation was frozen, the historical 2026-07-03 result was read for a separate diff: 197 shared unchanged units, one newly listed unit (`CKD508`), and one `missing_from_latest_price_list` unit (`CKF406`). There are zero price, price-per-sqm, availability, room/code/type/area, or duplicate-identity changes.

The Master Plan is registered as a seven-page `visual_master_plan_companion`, with page sequence 1–7. It was not machine-interpreted at unit level: no coordinate, orientation, view, geometry, availability, or price claim was generated. The Price List remains authoritative for structured availability and price evidence. No automatic reconciliation occurred.

## Compatibility and safety

Focused SIP, Fast Intake compatibility, and currency tests pass (89 tests). The unchanged Fast Intake public boundary accepts a finalized SIP reviewed list without an adapter in its existing compatibility test; the task does not run an importer or update Coralina's existing unpublished draft. No production connection, database client, import, lead, publication, network request, or Telegram authentication occurred. Coralina remains unpublished; Rainpalm remains unimported and unpublished; Partner Demo remains canonical; Factory remains A0.

The next recommended checkpoint is **TG-WATCH-001**, a separately approved local read-only Telegram watcher with a multi-project channel registry. It must be separate because it introduces user-session authentication, credential/session storage, external network access, recurring monitoring, and multiple-channel state.
