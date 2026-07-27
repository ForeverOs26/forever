/**
 * Package Factory — layout family `condo-schedule-v1`.
 *
 * The tabular condominium price schedule: one row per unit, carrying a tower, a
 * floor, a sales status, a unit code, a type code, a room-type label, an area,
 * and two money columns whose ORDER VARIES BETWEEN PROJECTS.
 *
 * Everything that varies between the projects seen so far is handled here as
 * one layout rather than as N project parsers:
 *
 *   - `area, price/sqm, total`      (Coralina, Sierra, Adora)
 *   - `area, total, price/sqm`      (Modeva, KataBello)      → derived, not assumed
 *   - room types beginning with a digit          "1 BEDROOM L"
 *   - hyphenated penthouse names                 "PH-3 BEDROOM C - GD"
 *   - parenthesised type/room codes              "1BS(M)"
 *   - alphanumeric unit codes of 1–4 letters     MBA101, CKA201, SBA218
 *   - tower/floor separated by wide gaps         "G  7"
 *   - thousands groups split by whitespace       "5,651,  585"
 *   - repeated page headers
 *   - a missing tower column, a missing floor column, or both
 *
 * Two invariants gate every accepted row, and a row that fails either is
 * REJECTED with its reason — never guessed, never silently assigned:
 *
 *   1. `area × price_per_sqm ≈ total_price` decides which money column is which;
 *   2. when tower and floor columns exist, the unit code must agree with them.
 */

import type { ParsedUnitRow, RejectedRow } from "../types";

import {
  currenciesInText,
  healSplitNumbers,
  looksLikeHeaderLine,
  pageCounter,
  parseAmount,
  resolvePricePair,
  squashWhitespace,
} from "./shared";

/**
 * Row grammar.
 *
 * Anchored on the three trailing numeric columns, because those are the only
 * cells whose SHAPE is guaranteed. Everything before them is matched lazily so
 * a room-type label may contain digits, spaces, hyphens, parentheses and
 * slashes without the tail sliding.
 */
const FULL_ROW =
  /^([A-Z]{1,2})\s+(\d{1,3})\s+([A-Za-z]+)\s+([A-Z]{1,4}\d{2,4}[A-Z]?)\s+(\S+)\s+([0-9A-Za-z][0-9A-Za-z ()/.\-+]*?)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s*$/;

/** Same schedule without a tower column: floor, status, unit, … */
const NO_TOWER_ROW =
  /^(\d{1,3})\s+([A-Za-z]+)\s+([A-Z]{1,4}\d{2,4}[A-Z]?)\s+(\S+)\s+([0-9A-Za-z][0-9A-Za-z ()/.\-+]*?)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s*$/;

/** Neither tower nor floor: unit, type, room type, area, N, N. */
const NO_TOWER_NO_FLOOR_ROW =
  /^([A-Z]{1,4}\d{2,4}[A-Z]?)\s+([A-Za-z]+)\s+(\S+)\s+([0-9A-Za-z][0-9A-Za-z ()/.\-+]*?)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s*$/;

/** A token that could be a unit identity, used to spot unparsed data lines. */
const UNIT_IDENTITY_HINT = /\b[A-Z]{1,4}\d{2,4}[A-Z]?\b/;

/** Sales-status words a schedule uses. Anything else is not a status cell. */
const STATUS_WORDS = new Set([
  "available",
  "avail",
  "sold",
  "reserved",
  "booked",
  "hold",
  "holding",
  "unavailable",
  "blocked",
]);

interface Candidate {
  tower: string | null;
  floor: number | null;
  status: string;
  unitCode: string;
  typeCode: string;
  roomType: string;
  area: number;
  firstMoney: number;
  secondMoney: number;
}

function matchLine(line: string): Candidate | null {
  const full = FULL_ROW.exec(line);
  if (full && STATUS_WORDS.has(full[3].toLowerCase())) {
    return {
      tower: full[1],
      floor: Number.parseInt(full[2], 10),
      status: full[3],
      unitCode: full[4],
      typeCode: full[5],
      roomType: squashWhitespace(full[6]),
      area: parseAmount(full[7]),
      firstMoney: parseAmount(full[8]),
      secondMoney: parseAmount(full[9]),
    };
  }
  const noTower = NO_TOWER_ROW.exec(line);
  if (noTower && STATUS_WORDS.has(noTower[2].toLowerCase())) {
    return {
      tower: null,
      floor: Number.parseInt(noTower[1], 10),
      status: noTower[2],
      unitCode: noTower[3],
      typeCode: noTower[4],
      roomType: squashWhitespace(noTower[5]),
      area: parseAmount(noTower[6]),
      firstMoney: parseAmount(noTower[7]),
      secondMoney: parseAmount(noTower[8]),
    };
  }
  const bare = NO_TOWER_NO_FLOOR_ROW.exec(line);
  if (bare && STATUS_WORDS.has(bare[2].toLowerCase())) {
    return {
      tower: null,
      floor: null,
      status: bare[2],
      unitCode: bare[1],
      typeCode: bare[3],
      roomType: squashWhitespace(bare[4]),
      area: parseAmount(bare[5]),
      firstMoney: parseAmount(bare[6]),
      secondMoney: parseAmount(bare[7]),
    };
  }
  return null;
}

/**
 * Does the unit code agree with its own tower and floor columns?
 *
 * Codes in this family end with a floor+index group (`MBA101` = tower A, floor
 * 1) and carry the tower letter immediately before it. A row whose columns have
 * shifted usually breaks this agreement, which is exactly the row we must not
 * publish. When the code does not carry the information at all, the check
 * passes rather than inventing a disagreement.
 */
export function unitCodeAgrees(
  unitCode: string,
  tower: string | null,
  floor: number | null,
): boolean {
  const parsed = /^([A-Z]{1,4})(\d{2,4})[A-Z]?$/.exec(unitCode);
  if (!parsed) return true;
  const [, letters, digits] = parsed;
  if (tower && letters.length > 0 && !letters.endsWith(tower)) return false;
  if (floor !== null) {
    // A 3-digit group is F+II, a 4-digit group is FF+II.
    const declared = digits.length >= 4 ? Number(digits.slice(0, 2)) : Number(digits.slice(0, 1));
    if (declared !== floor) return false;
  }
  return true;
}

export interface CondoParseResult {
  accepted: ParsedUnitRow[];
  rejected: RejectedRow[];
  unresolved: RejectedRow[];
  /** The column order the invariant proved for the document as a whole. */
  observedOrder: "area_psqm_total" | "area_total_psqm" | "mixed" | "none";
  currencies: string[];
}

/** How confidently this text looks like a condo schedule. 0 means "not this". */
export function detectCondoSchedule(text: string): number {
  let matched = 0;
  let inspected = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = healSplitNumbers(raw.replace(/\f/g, ""));
    if (!line.trim()) continue;
    inspected += 1;
    if (matchLine(line)) matched += 1;
    if (inspected > 400) break;
  }
  if (matched < 3) return 0;
  return Math.min(1, matched / Math.max(1, inspected));
}

export function parseCondoSchedule(text: string): CondoParseResult {
  const accepted: ParsedUnitRow[] = [];
  const rejected: RejectedRow[] = [];
  const unresolved: RejectedRow[] = [];
  const orders = new Set<"area_psqm_total" | "area_total_psqm">();
  const nextPage = pageCounter();

  for (const raw of text.split(/\r?\n/)) {
    const page = nextPage(raw);
    const line = healSplitNumbers(raw.replace(/\f/g, ""));
    if (!line.trim()) continue;
    if (looksLikeHeaderLine(line)) continue;

    const candidate = matchLine(line);
    if (!candidate) {
      if (
        UNIT_IDENTITY_HINT.test(line) &&
        !/price\s*list|room\s*no|additional\s*cost/i.test(line)
      ) {
        unresolved.push({ line: squashWhitespace(raw), reason: "row_shape_unrecognized", page });
      }
      continue;
    }

    if (!Number.isFinite(candidate.area) || candidate.area <= 0) {
      rejected.push({ line: squashWhitespace(raw), reason: "area_unreadable", page });
      continue;
    }

    const resolvedPair = resolvePricePair(
      candidate.area,
      candidate.firstMoney,
      candidate.secondMoney,
    );
    if (!resolvedPair) {
      rejected.push({
        line: squashWhitespace(raw),
        reason: "price_invariant_unsatisfied",
        page,
      });
      continue;
    }
    orders.add(resolvedPair.order);

    if (!unitCodeAgrees(candidate.unitCode, candidate.tower, candidate.floor)) {
      rejected.push({
        line: squashWhitespace(raw),
        reason: "unit_code_disagrees_with_tower_or_floor",
        page,
      });
      continue;
    }

    accepted.push({
      unitCode: candidate.unitCode,
      building: candidate.tower,
      floor: candidate.floor,
      unitType: candidate.roomType || null,
      typeCode: candidate.typeCode || null,
      sizeSqm: candidate.area,
      landAreaSqm: null,
      pricePerSqm: resolvedPair.pricePerSqm,
      totalPrice: resolvedPair.totalPrice,
      availabilityStatus: candidate.status.toLowerCase(),
      bedrooms: null,
      bathrooms: null,
      page,
    });
  }

  const observedOrder = orders.size === 0 ? "none" : orders.size > 1 ? "mixed" : [...orders][0];

  return { accepted, rejected, unresolved, observedOrder, currencies: currenciesInText(text) };
}
