import { useMemo, useState } from "react";

import { Section } from "@/components/layout/Section";
import { Button } from "@/components/ui/button";

import type { DecisionDeckUnits, DecisionDeckValue } from "../decision-deck-model";
import type { PublicProjectUnitDTO } from "../public-project-detail";
import {
  applyUnitFilters,
  areaLabel,
  DEFAULT_UNIT_FILTERS,
  isAvailable,
  priceLabel,
  statusLabel,
  unitFacets,
  type UnitFilterState,
  type UnitSort,
} from "../unit-presentation";

/**
 * The one canonical Units section. It starts as a compact ten-row preview and
 * expands into a bounded, scrollable inventory without duplicating the data
 * elsewhere on the page.
 *
 * Filtering stays in memory, Listed order is the default, and filter choices
 * are derived only from the loaded inventory.
 */

const PREVIEW_SIZE = 10;

export interface ProjectUnitPreviewProps {
  units: DecisionDeckUnits;
  lastPriceUpdate: DecisionDeckValue<string>;
}

const SORTS: Array<{ value: UnitSort; label: string }> = [
  { value: "listed-order", label: "Listed order" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "price-desc", label: "Price: high to low" },
  { value: "area-asc", label: "Area: small to large" },
  { value: "area-desc", label: "Area: large to small" },
];

function UnitCard({ unit }: { unit: PublicProjectUnitDTO }) {
  const available = isAvailable(unit);
  return (
    <li
      data-testid="unit-preview-card"
      data-available={available ? "true" : "false"}
      className="flex flex-col rounded-2xl border border-border/70 bg-card p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-foreground">{unit.code}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{unit.type || "—"}</p>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
            available ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
          }`}
        >
          {/* A shape as well as a colour: availability is never colour-only. */}
          <span aria-hidden="true">{available ? "●" : "✕"}</span>
          {statusLabel(unit.availabilityStatus)}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Price</dt>
          <dd className="tabular-nums text-foreground">{priceLabel(unit)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Area</dt>
          <dd className="tabular-nums text-foreground">{areaLabel(unit)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Building</dt>
          <dd className="text-foreground">{unit.buildingCode ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Floor</dt>
          <dd className="text-foreground">{unit.floor ?? "—"}</dd>
        </div>
        {unit.bedrooms !== null && unit.bedrooms !== undefined ? (
          <div>
            <dt className="text-xs text-muted-foreground">Bedrooms</dt>
            <dd className="text-foreground">{unit.bedrooms}</dd>
          </div>
        ) : null}
      </dl>

      {/*
        The per-unit action is withheld until gate G0 passes (F5). It is the
        highest-volume contact surface on the page — one button per card, up to
        24 at once — so it is the last one that should reach an unverified
        submission path. Absent, not disabled: the card ends at its facts and
        the trailing spacing goes with the button.
      */}
    </li>
  );
}

export function ProjectUnitPreview({ units, lastPriceUpdate }: ProjectUnitPreviewProps) {
  const [filters, setFilters] = useState<UnitFilterState>(DEFAULT_UNIT_FILTERS);
  const [expanded, setExpanded] = useState(false);

  const facets = useMemo(() => unitFacets(units.rows), [units.rows]);
  const filtered = useMemo(() => applyUnitFilters(units.rows, filters), [units.rows, filters]);

  if (units.summary.state !== "supported" || units.rows.length === 0) return null;

  const shown = expanded ? filtered : filtered.slice(0, PREVIEW_SIZE);
  const { availableCount, listedCount } = units.summary.value;
  const priceUpdate = lastPriceUpdate.state === "supported" ? lastPriceUpdate.value : "";
  const isFiltered =
    filters.bedrooms !== "all" ||
    filters.building !== "all" ||
    filters.type !== "all" ||
    filters.includeUnavailable ||
    filters.sort !== "listed-order";

  const select =
    "rounded-full border border-border bg-card px-3 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent";

  return (
    <Section
      id="units"
      eyebrow="Availability"
      title={`${availableCount} of ${listedCount} listed units available`}
      className="py-11 sm:py-16"
      data-testid="project-unit-preview"
      data-decision-deck-section
    >
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter units">
        {facets.bedrooms.length > 1 ? (
          <label className="inline-flex items-center gap-2 text-sm">
            <span className="sr-only">Bedrooms</span>
            <select
              className={select}
              value={filters.bedrooms}
              onChange={(event) =>
                setFilters((current) => ({ ...current, bedrooms: event.target.value }))
              }
            >
              <option value="all">All bedrooms</option>
              {facets.bedrooms.map((facet) => (
                <option key={facet.value} value={facet.value}>
                  {facet.label} ({facet.count})
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {facets.buildings.length > 1 ? (
          <label className="inline-flex items-center gap-2 text-sm">
            <span className="sr-only">Building</span>
            <select
              className={select}
              value={filters.building}
              onChange={(event) =>
                setFilters((current) => ({ ...current, building: event.target.value }))
              }
            >
              <option value="all">All buildings</option>
              {facets.buildings.map((facet) => (
                <option key={facet.value} value={facet.value}>
                  {facet.label} ({facet.count})
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {facets.types.length > 1 ? (
          <label className="inline-flex items-center gap-2 text-sm">
            <span className="sr-only">Unit type</span>
            <select
              className={select}
              value={filters.type}
              onChange={(event) =>
                setFilters((current) => ({ ...current, type: event.target.value }))
              }
            >
              <option value="all">All types</option>
              {facets.types.map((facet) => (
                <option key={facet.value} value={facet.value}>
                  {facet.label} ({facet.count})
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="inline-flex items-center gap-2 text-sm">
          <span className="sr-only">Sort by</span>
          <select
            className={select}
            value={filters.sort}
            onChange={(event) =>
              setFilters((current) => ({ ...current, sort: event.target.value as UnitSort }))
            }
          >
            {SORTS.map((sort) => (
              <option key={sort.value} value={sort.value}>
                {sort.label}
              </option>
            ))}
          </select>
        </label>

        {facets.notAvailableCount > 0 ? (
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-current"
              checked={filters.includeUnavailable}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  includeUnavailable: event.target.checked,
                }))
              }
            />
            Include unavailable ({facets.notAvailableCount})
          </label>
        ) : null}

        {isFiltered ? (
          <button
            type="button"
            onClick={() => setFilters(DEFAULT_UNIT_FILTERS)}
            className="rounded-full px-3 py-1.5 text-sm font-medium text-accent underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Clear all
          </button>
        ) : null}
      </div>

      <p className="mt-4 text-sm text-muted-foreground" aria-live="polite">
        Showing {shown.length} of {filtered.length} matching units
        {priceUpdate ? ` · price list ${priceUpdate}` : ""}
      </p>

      {shown.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">
          {isFiltered
            ? "No unit matches this combination. Clear the filters to see the available list."
            : "No listed unit is explicitly recorded as available. Use Include unavailable to review all listed units."}
        </p>
      ) : (
        <ul
          tabIndex={expanded ? 0 : undefined}
          aria-label={expanded ? "Complete filtered unit inventory" : undefined}
          className={`mt-4 grid gap-3 pr-1 sm:grid-cols-2 lg:grid-cols-3 ${
            expanded
              ? "max-h-[640px] overflow-y-auto overscroll-contain rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-accent lg:max-h-[620px]"
              : ""
          }`}
        >
          {shown.map((unit) => (
            <UnitCard key={unit.id || unit.code} unit={unit} />
          ))}
        </ul>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        {!expanded && filtered.length > PREVIEW_SIZE ? (
          <Button variant="outline" onClick={() => setExpanded(true)}>
            Show all {filtered.length} matching units
          </Button>
        ) : null}
        {expanded && filtered.length > PREVIEW_SIZE ? (
          <Button variant="ghost" onClick={() => setExpanded(false)}>
            Show first {PREVIEW_SIZE}
          </Button>
        ) : null}
      </div>
    </Section>
  );
}
