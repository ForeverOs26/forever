/**
 * The Coralina package as a test fixture — REAL paths, synthetic bytes.
 *
 * Shared by the `new_development` suite and the existing-draft
 * `project_update` suite so both run the identical package: if the two ever
 * disagreed about what Coralina contains, neither result would mean anything.
 *
 * The paths are exact, because paths are what decide routing. The bytes only
 * have to be the right KIND (so the media classifier and the public sanitizer
 * behave as they would in production) and the right SIZE BAND.
 *
 * The large band is reproduced faithfully rather than literally: an entry is
 * "large" when its UNCOMPRESSED size crosses `maxFileBytes` (24 MiB), and that
 * is the single branch Coralina's 151.4 MiB Master Plan PDF, its 36.1/31.5 MiB
 * Floor Plan PDFs, its 26.6 MiB Unit Plan PDF and its 86.2 MiB video all take.
 * Crossing it with entries that deflate well exercises the branch without a
 * 300 MiB test buffer; above the threshold the only difference is how many
 * evidence parts get written.
 */

import { magicBytesFor } from "./fakes";
import { patternBytes } from "./large-archive-fixtures";

/** Just over `maxFileBytes` (24 MiB) — the streaming-evidence branch. */
export const OVER_LIMIT = 25 * 1024 * 1024;

/**
 * A real, decodable synthetic file of whatever kind the NAME implies, salted by
 * that name so no two entries collide with the duplicate detector.
 *
 * `magicBytesFor` is what the rest of the suite publishes with, so an image
 * here really does survive the public sanitizer — the difference between
 * "published" and "retained" in these suites is the routing decision under
 * test, never a fixture that failed to decode.
 */
export function small(name: string): Buffer {
  return magicBytesFor(name);
}

/**
 * The same file, grown past `maxFileBytes`. The real magic bytes stay at the
 * head so the recorded media class is the true one; the padding is one
 * incompressible block repeated, which crosses the size threshold while staying
 * inside the 200:1 compression-ratio guard.
 */
export function large(name: string): Buffer {
  const head = magicBytesFor(name);
  const seed = [...name].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7);
  const block = patternBytes(200 * 1024, seed);
  const copies = Math.ceil((OVER_LIMIT - head.length) / block.length);
  return Buffer.concat([head, ...Array.from({ length: copies }, () => block)], OVER_LIMIT);
}

function entry(name: string, big = false) {
  return { name, data: () => (big ? large(name) : small(name)), method: 8 as const };
}

/** The Coralina package, by its real paths. */
export const CORALINA_ENTRIES = [
  // 11. Perspective — renders
  entry("11. Perspective/Exterior/SKY POOL.jpg"),
  entry("11. Perspective/Interior/GRAND LOBBY.jpg"),
  // 12. Photo of Show Units — @Kamala belongs, @Bangtao is another showroom
  entry("12. Photo of Show Units/Show Unit @Kamala/1 BR L 41 sqm/_DSC6667.jpg"),
  entry("12. Photo of Show Units/Show Unit @Bangtao/1BR M-31/1BR31 -  (1).jpg"),
  entry("12. Photo of Show Units/Show Unit @Bangtao/2BR1-64/2BR64 -  (1).jpg"),
  // 4. Master Plan — JPG sheets publish, the 151.4 MiB PDF cannot
  entry("4. Master Plan/JPG/20251009_Coralina_Master Plan-09.jpg"),
  entry("4. Master Plan/Coralina Master Plan.pdf", true),
  // 5. Floor Plan — per-building JPGs publish, both large PDFs cannot
  entry("5. Floor Plan/JPG/A/Coralina_Floor Plan_Part 1-08.jpg"),
  entry("5. Floor Plan/PDF/Coralina Floor Plan Part 1.pdf", true),
  entry("5. Floor Plan/PDF/Coralina Floor Plan Part 2.pdf", true),
  // 6. Unit Plan — type sheets publish, the 26.6 MiB PDF cannot
  entry("6. Unit Plan/JPG/2 Bedroom/20251014_Coralina_Unit Plan_Part3-17.jpg"),
  entry("6. Unit Plan/PDF/Coralina_Unit Plan_Part4.pdf", true),
  // 9. Map
  entry("9. Map/CORALINA Map 1.jpeg"),
  // 8. Living Service + the loose facilities deck — official documents that
  // used to classify as `unknown`
  entry("8. Living Service/THE ESQUIRE Living Services.pdf"),
  entry("Coralina Facilities.pdf"),
  // Video — classified, but Forever publishes no video yet
  entry("20260401 Coralina Facilities.mp4", true),
  // The price list, and the SECOND one that must not be reapplied
  entry("CLK - Price List V.2. - Updated 17.07.26.pdf"),
  entry("CLK - Master Plan Price list V.2 - updated 17.07.26.pdf"),
];

/** Material from a showroom in a location the Coralina draft does not share. */
export const BANGTAO_ENTRIES = CORALINA_ENTRIES.filter((item) =>
  item.name.includes("@Bangtao"),
).map((item) => item.name);

/** Entries above `maxFileBytes`, which take the streaming-evidence branch. */
export const OVER_LIMIT_ENTRIES = [
  "4. Master Plan/Coralina Master Plan.pdf",
  "5. Floor Plan/PDF/Coralina Floor Plan Part 1.pdf",
  "5. Floor Plan/PDF/Coralina Floor Plan Part 2.pdf",
  "6. Unit Plan/PDF/Coralina_Unit Plan_Part4.pdf",
  "20260401 Coralina Facilities.mp4",
];

/** Both price-list documents; exactly one may ever be applied. */
export const PRICE_LIST_ENTRIES = [
  "CLK - Price List V.2. - Updated 17.07.26.pdf",
  "CLK - Master Plan Price list V.2 - updated 17.07.26.pdf",
];
