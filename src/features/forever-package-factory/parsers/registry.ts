/**
 * Package Factory — the parser registry.
 *
 * A layout is selected by what the document's own structure looks like, never
 * by the developer's name and never by the filename. Each entry declares a
 * `detect` that scores the text and a `parse` that returns validated rows, so a
 * new layout is added by registering a descriptor — no existing stage changes.
 *
 * Selection is deliberately conservative: when no registered layout scores
 * above the floor, the Factory reports "no supported price layout" and the
 * project publishes without unit prices. That is a normal outcome, not a
 * failure — a missing price never blocks publication, but a price mapped to the
 * wrong unit would be unacceptable.
 */

import type { ParseOutcome } from "../types";

import { detectCondoSchedule, parseCondoSchedule } from "./condo-schedule";
import { detectVillaSchedule, parseVillaSchedule } from "./villa-schedule";

export interface LayoutDescriptor {
  id: string;
  family: string;
  description: string;
  /** 0 = definitely not this layout; higher wins. */
  detect(text: string): number;
  parse(text: string): ParseOutcome;
}

/** Minimum detection score for a layout to be used at all. */
export const DETECTION_FLOOR = 0.01;

const CONDO: LayoutDescriptor = {
  id: "condo-schedule-v1",
  family: "tabular-unit-schedule",
  description:
    "Tabular condominium schedule: tower/floor/status/unit/type/room type/area and two money columns whose order is derived from area × price-per-sqm ≈ total.",
  detect: detectCondoSchedule,
  parse(text) {
    const result = parseCondoSchedule(text);
    return {
      layoutId: CONDO.id,
      layoutFamily: CONDO.family,
      accepted: result.accepted,
      rejected: result.rejected,
      unresolved: result.unresolved,
      validationMethod: `area_times_price_per_sqm_equals_total (observed column order: ${result.observedOrder})`,
      currencies: result.currencies,
    };
  },
};

const VILLA: LayoutDescriptor = {
  id: "villa-schedule-v1",
  family: "tabular-unit-schedule",
  description:
    "Villa schedule with no price-per-sqm column: validated by square wah × 4 ≈ square metres and plot-code/type agreement.",
  detect: detectVillaSchedule,
  parse(text) {
    const result = parseVillaSchedule(text);
    return {
      layoutId: VILLA.id,
      layoutFamily: VILLA.family,
      accepted: result.accepted,
      rejected: result.rejected,
      unresolved: result.unresolved,
      validationMethod: result.validationMethod,
      currencies: result.currencies,
    };
  },
};

/** Built-in layouts, in registration order. */
export const BUILT_IN_LAYOUTS: readonly LayoutDescriptor[] = [CONDO, VILLA];

export interface LayoutSelection {
  layout: LayoutDescriptor;
  score: number;
  /** Every layout that scored above the floor, best first. */
  considered: Array<{ id: string; score: number }>;
}

/** Choose the best-scoring layout for this text, or null when none applies. */
export function selectLayout(
  text: string,
  layouts: readonly LayoutDescriptor[] = BUILT_IN_LAYOUTS,
): LayoutSelection | null {
  const scored = layouts
    .map((layout) => ({ layout, score: layout.detect(text) }))
    .filter((entry) => entry.score > DETECTION_FLOOR)
    .sort((left, right) => right.score - left.score);
  if (scored.length === 0) return null;
  return {
    layout: scored[0].layout,
    score: scored[0].score,
    considered: scored.map((entry) => ({ id: entry.layout.id, score: entry.score })),
  };
}

/** Select a layout and parse in one step. Null when no layout applies. */
export function parseWithRegistry(
  text: string,
  layouts: readonly LayoutDescriptor[] = BUILT_IN_LAYOUTS,
): ParseOutcome | null {
  const selection = selectLayout(text, layouts);
  if (!selection) return null;
  return selection.layout.parse(text);
}
