/**
 * Package Factory — parsing primitives shared by every layout family.
 *
 * These exist because the same three problems appear in every developer price
 * list regardless of who produced it:
 *
 *   1. a `pdftotext` rendering splits comma-grouped numbers across a cell gap
 *      ("5,651,  585"), so numbers must be healed before they are read;
 *   2. column POSITION is unreliable — the same producer emits
 *      area/price-per-sqm/total in one project and area/total/price-per-sqm in
 *      the next — so the meaning of a numeric column must be DERIVED from an
 *      arithmetic invariant, never assumed;
 *   3. page headers repeat mid-document and must be recognized rather than
 *      parsed as data.
 */

/** Rounding tolerance for `area × price_per_sqm ≈ total_price`. */
export const PRICE_INVARIANT_TOLERANCE = 0.005;
/** 1 square wah = 4 square metres, exactly. Same tolerance band. */
export const SQUARE_WAH_TO_SQM = 4;

/**
 * Repair a comma-grouped number split by intra-cell whitespace ("5,651,  585").
 * Anchored on the comma so a genuine column gap ("124.20      141,750") is left
 * alone — collapsing that would merge two different columns into one token.
 */
export function healSplitNumbers(line: string): string {
  return line.replace(/,[ \t]+(?=\d{3}(?!\d))/g, ",");
}

export function squashWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** Parse "9,379,584.00" → 9379584. Returns NaN for anything unparseable. */
export function parseAmount(value: string): number {
  return Number.parseFloat(String(value).replace(/,/g, ""));
}

/**
 * Does `area × pricePerSqm` reproduce `total` within tolerance?
 *
 * Relative to the total, so the band means the same thing for a 3M and a 30M
 * unit. A non-positive total never satisfies the invariant.
 */
export function satisfiesPriceInvariant(
  area: number,
  pricePerSqm: number,
  total: number,
  tolerance = PRICE_INVARIANT_TOLERANCE,
): boolean {
  if (!(area > 0) || !(pricePerSqm > 0) || !(total > 0)) return false;
  return Math.abs(area * pricePerSqm - total) / total <= tolerance;
}

export interface ResolvedPricePair {
  pricePerSqm: number;
  totalPrice: number;
  /** Which column order the invariant proved. */
  order: "area_psqm_total" | "area_total_psqm";
}

/**
 * Decide which of two trailing numbers is the price per sqm and which is the
 * total, using the only rule a column swap cannot fool: their product with the
 * area.
 *
 * Returns null when BOTH orders fit (ambiguous) or NEITHER does (shifted row).
 * The caller must reject such a row — assigning either reading would risk
 * publishing a real price against the wrong unit.
 */
export function resolvePricePair(
  area: number,
  first: number,
  second: number,
  tolerance = PRICE_INVARIANT_TOLERANCE,
): ResolvedPricePair | null {
  const forward = satisfiesPriceInvariant(area, first, second, tolerance);
  const reversed = satisfiesPriceInvariant(area, second, first, tolerance);
  if (forward === reversed) return null;
  return forward
    ? { pricePerSqm: first, totalPrice: second, order: "area_psqm_total" }
    : { pricePerSqm: second, totalPrice: first, order: "area_total_psqm" };
}

/** Split a line into cells at runs of 2+ spaces or a tab. */
export function splitCells(line: string): string[] {
  return line
    .split(/\t|\s{2,}/)
    .map((cell) => cell.trim())
    .filter(Boolean);
}

/** Lines that are a repeated page header rather than data. */
export function looksLikeHeaderLine(line: string): boolean {
  const lower = line.toLowerCase();
  const headerWords = ["tower", "floor", "status", "room no", "unit no", "price", "area", "type"];
  const hits = headerWords.filter((word) => lower.includes(word)).length;
  return hits >= 3;
}

/** Track page numbers across a `pdftotext` rendering (form feed = new page). */
export function pageCounter(): (rawLine: string) => number {
  let page = 1;
  return (rawLine: string) => {
    const before = page;
    const feeds = rawLine.match(/\f/g);
    if (feeds) page += feeds.length;
    return before;
  };
}

/** Currency codes the document itself evidences. Never defaulted. */
export function currenciesInText(text: string): string[] {
  const found = new Set<string>();
  if (/\bTHB\b|\bbaht\b|฿/i.test(text)) found.add("THB");
  if (/\bUSD\b|\bUS\$/i.test(text)) found.add("USD");
  if (/\bEUR\b|€/i.test(text)) found.add("EUR");
  return [...found].sort();
}
