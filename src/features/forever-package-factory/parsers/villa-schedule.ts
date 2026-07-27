/**
 * Package Factory — layout family `villa-schedule-v1`.
 *
 * A villa schedule has no price-per-sqm column, so the condo invariant does not
 * apply. Two deterministic checks replace it, both derived from the document's
 * own columns rather than from any outside knowledge:
 *
 *   1. `land area in sq.wah × 4 ≈ land area in sq.m` (1 sq.wah = 4 sq.m
 *      exactly) — a shifted row breaks this;
 *   2. the plot code's type prefix must agree with the stated villa type
 *      column.
 *
 * A row that fails either is rejected with its reason. Rows are accepted with
 * `pricePerSqm: null` — a villa list simply has no such figure, and inventing
 * one by division would publish a number the developer never stated.
 */

import type { ParsedUnitRow, RejectedRow } from "../types";

import {
  currenciesInText,
  healSplitNumbers,
  looksLikeHeaderLine,
  pageCounter,
  parseAmount,
  squashWhitespace,
  SQUARE_WAH_TO_SQM,
} from "./shared";

/** Tolerance for sq.wah × 4 ≈ sq.m; the schedules round the wah figure. */
export const LAND_AREA_TOLERANCE = 0.01;

/**
 * plot | phase/zone | status | villa type | plot code | land(wah) | land(sqm) |
 * built-up(sqm) | N beds / N baths | price [| optional second amount]
 */
const VILLA_ROW =
  /^([A-Za-z]{2,4})\s+(\S+)\s+([A-Za-z]+)\s+([A-Za-z][A-Za-z ]*?)\s+([A-Z]{1,3}[A-Z]?\d{1,4})\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+(\d+)\s*beds?\s*\/\s*(\d+)\s*baths?\s+([\d.,]+)(?:\s+([\d.,]+))?\s*$/i;

/** Simpler villa list: plot code | type | land(sqm) | built-up(sqm) | price. */
const VILLA_ROW_MINIMAL =
  /^([A-Z]{1,3}[A-Z]?\d{1,4})\s+([A-Za-z][A-Za-z0-9 ]*?)\s+([A-Za-z]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s*$/;

const PLOT_IDENTITY_HINT = /\b[A-Z]{1,3}[A-Z]?\d{1,4}\b/;

const STATUS_WORDS = new Set([
  "available",
  "avail",
  "sold",
  "reserved",
  "booked",
  "hold",
  "holding",
]);

/**
 * Does the plot code's leading letters agree with the stated villa type?
 *
 * Compared on first letters only, because schedules write "Type A" against
 * plot "AVA12" and "XL" against "XLA03". Returns true when the type column
 * carries no letter to compare — an absent column is not a disagreement.
 */
export function plotCodeAgreesWithType(plotCode: string, villaType: string): boolean {
  const codeLetters = /^([A-Z]+)/.exec(plotCode)?.[1] ?? "";
  const typeLetters = (villaType.match(/[A-Za-z]+/g) ?? [])
    .map((word) => word.toUpperCase())
    .filter((word) => !["TYPE", "VILLA", "POOL", "HOUSE"].includes(word));
  if (!codeLetters || typeLetters.length === 0) return true;
  return typeLetters.some(
    (word) => codeLetters.startsWith(word) || word.startsWith(codeLetters.slice(0, 1)),
  );
}

/** sq.wah × 4 ≈ sq.m, when the schedule supplies both. */
export function landAreaAgrees(squareWah: number, squareMetres: number): boolean {
  if (!(squareWah > 0) || !(squareMetres > 0)) return false;
  const expected = squareWah * SQUARE_WAH_TO_SQM;
  return Math.abs(expected - squareMetres) / squareMetres <= LAND_AREA_TOLERANCE;
}

export interface VillaParseResult {
  accepted: ParsedUnitRow[];
  rejected: RejectedRow[];
  unresolved: RejectedRow[];
  currencies: string[];
  validationMethod: string;
}

export function detectVillaSchedule(text: string): number {
  let matched = 0;
  let inspected = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = healSplitNumbers(raw.replace(/\f/g, ""));
    if (!line.trim()) continue;
    inspected += 1;
    if (VILLA_ROW.test(line) || VILLA_ROW_MINIMAL.test(line)) matched += 1;
    if (inspected > 400) break;
  }
  if (matched < 3) return 0;
  return Math.min(1, matched / Math.max(1, inspected));
}

export function parseVillaSchedule(text: string): VillaParseResult {
  const accepted: ParsedUnitRow[] = [];
  const rejected: RejectedRow[] = [];
  const unresolved: RejectedRow[] = [];
  const nextPage = pageCounter();
  const methods = new Set<string>();

  for (const raw of text.split(/\r?\n/)) {
    const page = nextPage(raw);
    const line = healSplitNumbers(raw.replace(/\f/g, ""));
    if (!line.trim()) continue;
    if (looksLikeHeaderLine(line)) continue;

    const full = VILLA_ROW.exec(line);
    if (full && STATUS_WORDS.has(full[3].toLowerCase())) {
      const villaType = squashWhitespace(full[4]);
      const plotCode = full[5];
      const landWah = parseAmount(full[6]);
      const landSqm = parseAmount(full[7]);
      const builtUp = parseAmount(full[8]);
      const bedrooms = Number.parseInt(full[9], 10);
      const bathrooms = Number.parseInt(full[10], 10);
      const price = parseAmount(full[11]);

      if (!landAreaAgrees(landWah, landSqm)) {
        rejected.push({ line: squashWhitespace(raw), reason: "land_area_wah_sqm_mismatch", page });
        continue;
      }
      if (!plotCodeAgreesWithType(plotCode, villaType)) {
        rejected.push({
          line: squashWhitespace(raw),
          reason: "plot_code_disagrees_with_type",
          page,
        });
        continue;
      }
      if (!(price > 0)) {
        rejected.push({ line: squashWhitespace(raw), reason: "price_unreadable", page });
        continue;
      }
      methods.add("square_wah_times_four_equals_sqm");
      methods.add("plot_code_matches_villa_type");
      accepted.push({
        unitCode: plotCode,
        building: null,
        floor: null,
        unitType: villaType || null,
        typeCode: villaType || null,
        sizeSqm: builtUp > 0 ? builtUp : null,
        landAreaSqm: landSqm,
        pricePerSqm: null,
        totalPrice: price,
        availabilityStatus: full[3].toLowerCase(),
        bedrooms: Number.isFinite(bedrooms) ? bedrooms : null,
        bathrooms: Number.isFinite(bathrooms) ? bathrooms : null,
        page,
      });
      continue;
    }

    const minimal = VILLA_ROW_MINIMAL.exec(line);
    if (minimal && STATUS_WORDS.has(minimal[3].toLowerCase())) {
      const plotCode = minimal[1];
      const villaType = squashWhitespace(minimal[2]);
      const landSqm = parseAmount(minimal[4]);
      const builtUp = parseAmount(minimal[5]);
      const price = parseAmount(minimal[6]);
      if (!plotCodeAgreesWithType(plotCode, villaType)) {
        rejected.push({
          line: squashWhitespace(raw),
          reason: "plot_code_disagrees_with_type",
          page,
        });
        continue;
      }
      if (!(price > 0) || !(landSqm > 0)) {
        rejected.push({ line: squashWhitespace(raw), reason: "price_or_area_unreadable", page });
        continue;
      }
      methods.add("plot_code_matches_villa_type");
      accepted.push({
        unitCode: plotCode,
        building: null,
        floor: null,
        unitType: villaType || null,
        typeCode: villaType || null,
        sizeSqm: builtUp > 0 ? builtUp : null,
        landAreaSqm: landSqm,
        pricePerSqm: null,
        totalPrice: price,
        availabilityStatus: minimal[3].toLowerCase(),
        bedrooms: null,
        bathrooms: null,
        page,
      });
      continue;
    }

    if (PLOT_IDENTITY_HINT.test(line) && /beds?\s*\/|sq\.?\s*wah|villa/i.test(line)) {
      unresolved.push({ line: squashWhitespace(raw), reason: "row_shape_unrecognized", page });
    }
  }

  return {
    accepted,
    rejected,
    unresolved,
    currencies: currenciesInText(text),
    validationMethod: [...methods].sort().join(" + ") || "none",
  };
}
