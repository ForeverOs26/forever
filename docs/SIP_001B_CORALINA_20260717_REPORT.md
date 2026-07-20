# SIP-001B Coralina 2026-07-17 report

Status: implemented, independently reviewed, real-Windows validated, Owner-approved, and canonical after merge.

## Authority and sources

- Base: `4f3045cce153d347726955bb234ad76af664e430`.
- Price List: `CLK - Price List V.2. - Updated 17.07.26.pdf`, 251902 bytes, SHA-256 `268c2fa30e39e89c7dd5e3d7751326e3cf958ec2783e5953eabccbece9b3f3c0`.
- Master Plan: `CLK - Master Plan Price list V.2 - updated 17.07.26.pdf`, 1474832 bytes, SHA-256 `1f7d70c83a53b96981dabba3e03206996f8c1c6bfdfc37983a48c9e16eadd2fa`.
- Both owner-authorized source files stayed outside Git. Pre- and post-processing SHA-256 and byte-size evidence match for each source; neither file was changed or committed.

## Price-list result

The local Xpdf `pdftotext` 4.06 preflight qualified the price table in table mode: four pages, four repeated-header table regions, 198 candidate rows, 198 accepted rows, and no rejected, review, or blocking rows. The content date is `2026-07-17`. Selling-price currency is THB with `inferred_default`; no fee was used as currency evidence. Page 4 supplemental evidence is sinking fund 850 THB/sqm and common fee 85 THB/sqm/month; neither is a unit price.

The narrow generic improvement recognizes tower/floor/room-number/code-type/room-type/price-per-sqm/selling-price headers and stops detached footer fragments entering a row. It contains no project, file-name, unit, row-count, or historical-value condition. Source page and row evidence remain on every row; no arithmetic repair is performed.

Two fresh managed extraction runs produced byte-identical canonical files: source proof `2a1be52f24e9a3af5df8d798b8454597d5a3b4eb2499380d61b8436db73cef9c`, qualification `9e1e08e4f1101df383389b0466291154d83ae8ecede0d650a2ffa9d617a2013d`, candidate `3e18f3eeb2f877afd5ac078b01e1097f5b942133fd95a70fa65d6a2a5a9b0533`, review summary `e197de598b3ca56b0ccfb03af09088cb21c8eb5de28f32c04407ecc9b2d2399d`, preparation summary `e055403f01c0fed17e4c5a6d0266bb6ae81f1ebef38dac80c2a050d57613a014`, and reviewed list `066f2ddc40cfcabb663ffb8ecf7b492dbde1fc064c7381827d8019b46a5a0c14`.

## Source-bound package and companion evidence

The generic package CLI requires explicit project, date, origin-channel, source, artifact, prior-version, output, and workspace arguments. Its source bundle binds all six generated price artifacts by SHA-256; tampering with one changes the bundle identity. It rejects malformed or missing bindings, duplicate artifact paths, mixed project/generation artifacts, and artifact paths that package output could overwrite. It also captures and verifies pre- and post-processing fingerprints for the Master Plan before registering it.

Two fresh package runs produced byte-identical package files: source bundle `9f9803e61f7f47c37c60f1f42ab9225aa9059f16c4ba46cafef749bd7a3e9b7a`, Master Plan source proof `d70a8413201f3f3119dddcf483208387f092f0c1438e3b8bf24f4584b5634c77`, registration `62395f45509d3e7bde0fcf73713e8a5eb6decd21540a20f8f09398f5d5fd1eb4`, version diff `be080932a300fc4bc4c042b0a191c3c81e5ad270e9e0da595cf77f528b49a70b`, and cross-source summary `39efba1a6d796ea655921f42380f256befb3dd269e84b21a76969e186b4fe389`.

Only after the new generation was frozen, the historical 2026-07-03 result was read for a separate diff: 197 shared unchanged units, one newly listed unit (`CKD508`), and one `missing_from_latest_price_list` unit (`CKF406`). There are zero price, price-per-sqm, availability, room/code/type/area, or duplicate-identity changes.

The Master Plan is registered as a seven-page `visual_master_plan_companion`. It is explicitly `not_machine_interpreted_in_sip_001b`: no floor sequence, coordinate, orientation, view, geometry, availability, or price claim was generated. The Price List remains authoritative for structured availability and price evidence. No automatic reconciliation occurred.

## Compatibility and safety

TypeScript checking, formatting, lint of all changed files, and the production build pass. The ordinary complete `npm test` suite passed twice without sharding or exclusions: 307 files / 2,940 tests in 331.16 seconds, then 307 files / 2,940 tests in 323.00 seconds. The live PowerShell validation test retries once only for the documented Windows process-start contention shape: no exit status, no stdout, no stderr diagnostic, and no emitted `VALIDATION_PARITY_STARTED` marker. It fails immediately without retry for a non-zero exit, marker contradiction, PowerShell diagnostic, partial case output, or a timeout after the child begins the parity run. The SIP crash-recovery integration test has a documented 15-second local timeout because it performs three synchronous transactional generations under the full Windows suite; its behavior is unchanged.

No production connection, database client, import, lead, publication, network request, or Telegram authentication occurred. Coralina remains unpublished; Rainpalm remains unimported and unpublished; Partner Demo remains canonical; Factory remains A0.

The next active development checkpoint is **TG-WATCH-001 — Universal Read-Only Telegram Source Watcher Design and Safe Pilot**. It is a separate future task: one universal local watcher will use one protected Telegram user session and a configuration registry that maps channels to developers and project slugs. Its safe pilot will cover `@coralinakamala` and one additional authorized Title channel selected during that task. It will read new posts and attachments only, quarantine them locally with SHA-256 duplicate protection, classify canonical price tables, visual Master Plans, construction photos/videos, and other documents, retain per-channel cursor and last-processed-message state, and produce Owner-review output. It will not automatically import to a database, publish anything, or expand Factory autonomy.
