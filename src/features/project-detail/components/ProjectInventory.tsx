import { Building2 } from "lucide-react";
import { Section } from "@/components/layout/Section";
import type { ProjectDetail, ProjectDetailUnit } from "../project-detail-types";

type ProjectInventoryProps = {
  project: ProjectDetail;
};

/** Statuses that mean "not currently buyable". Anything else reads as available. */
const UNAVAILABLE_STATUSES = new Set(["sold", "sold_out", "reserved", "booked", "blocked"]);

function isAvailable(unit: ProjectDetailUnit): boolean {
  return !UNAVAILABLE_STATUSES.has(unit.availabilityStatus.trim().toLowerCase());
}

/** Title-case a raw status token for display ("sold_out" -> "Sold out"). */
function statusLabel(status: string): string {
  const cleaned = status.trim().replace(/[_-]+/g, " ");
  if (!cleaned) return "Not available";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
}

/**
 * A recorded price, or an explicit dash.
 *
 * Reads only the price columns granted to the anonymous role
 * (`20260723130000_public_projection_privacy.sql`). `unit_price_history` is
 * deliberately NOT public — it carries source paths and provenance — so a unit
 * whose price exists only there shows "—" here rather than leaking that table
 * or inventing a "price on request" claim the record does not support.
 */
function priceLabel(unit: ProjectDetailUnit): string {
  const price = unit.discountedPriceTHB ?? unit.basePriceTHB;
  if (price === null || price === undefined) return "—";
  const numeric = Number(price);
  if (!Number.isFinite(numeric)) return "—";
  return `฿${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(numeric)}`;
}

function areaLabel(unit: ProjectDetailUnit): string {
  if (unit.sizeSqm === null || unit.sizeSqm === undefined) return "—";
  const numeric = Number(unit.sizeSqm);
  if (!Number.isFinite(numeric)) return "—";
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(numeric)} m²`;
}

/**
 * Per-unit availability, ordered available-first then by unit code.
 *
 * Rendered from the recorded rows only: a unit the developer marked sold is
 * shown as sold, never folded into the available count. Deterministic order
 * keeps the table stable between loads.
 */
function unitRows(units: readonly ProjectDetailUnit[]): ProjectDetailUnit[] {
  return [...units].sort((left, right) => {
    const leftAvailable = isAvailable(left);
    const rightAvailable = isAvailable(right);
    if (leftAvailable !== rightAvailable) return leftAvailable ? -1 : 1;
    return left.code.localeCompare(right.code, "en");
  });
}

export function ProjectInventory({ project }: ProjectInventoryProps) {
  const buildings = new Map<string, number>();
  for (const unit of project.units) {
    if (unit.buildingCode) {
      buildings.set(unit.buildingCode, (buildings.get(unit.buildingCode) ?? 0) + 1);
    }
  }

  if (project.units.length === 0) return null;

  const rows = unitRows(project.units);
  const availableCount = rows.filter(isAvailable).length;

  const title =
    buildings.size > 0
      ? `${buildings.size} buildings · ${project.units.length} residences`
      : `${project.units.length} residences`;

  return (
    <Section eyebrow="Inventory" title={title} className="pt-0">
      {buildings.size > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[...buildings.entries()].map(([building, units]) => (
            <div key={building} className="rounded-2xl border border-border/60 bg-card p-5">
              <Building2 className="h-5 w-5 text-primary" />
              <div className="mt-3 font-serif text-2xl text-foreground">Building {building}</div>
              <div className="mt-1 text-sm text-muted-foreground">{units} listed residences</div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-8">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-serif text-xl text-foreground">Availability and prices</h3>
          <p className="text-sm text-muted-foreground">
            {availableCount} of {rows.length} available
            {project.pricing.lastPriceUpdate
              ? ` · price list ${project.pricing.lastPriceUpdate}`
              : ""}
          </p>
        </div>

        {/*
          Below the tablet breakpoint the same rows render as cards (F-013).
          The 40rem table needs 640 px, which at 375 px left Area, Price and
          Status behind an unhinted horizontal scroll — the two facts a buyer
          most wants were off-screen by default. Same rows, same ordering, same
          formatting helpers; only the presentation differs.
        */}
        <ul
          data-testid="inventory-unit-cards"
          className="mt-4 grid gap-3 md:hidden"
          aria-label="Availability and prices"
        >
          {rows.map((unit) => {
            const available = isAvailable(unit);
            return (
              <li
                key={unit.code}
                className="rounded-2xl border border-border/60 bg-card p-4"
                data-available={available ? "true" : "false"}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-foreground">{unit.code}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{unit.type || "—"}</div>
                  </div>
                  <span
                    className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                      available ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                    }`}
                  >
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
                </dl>
              </li>
            );
          })}
        </ul>

        {/* Wide table scrolls inside its own container so the page never does. */}
        <div
          data-testid="inventory-unit-table"
          className="mt-4 hidden overflow-x-auto rounded-2xl border border-border/60 bg-card md:block"
        >
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border/60 text-left text-muted-foreground">
                <th scope="col" className="px-4 py-3 font-medium">
                  Unit
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Building
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Floor
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Type
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Area
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Price
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((unit) => {
                const available = isAvailable(unit);
                return (
                  <tr
                    key={unit.code}
                    className={`border-b border-border/40 last:border-0 ${
                      available ? "" : "text-muted-foreground"
                    }`}
                  >
                    <th scope="row" className="px-4 py-3 text-left font-medium text-foreground">
                      {unit.code}
                    </th>
                    <td className="px-4 py-3">{unit.buildingCode ?? "—"}</td>
                    <td className="px-4 py-3">{unit.floor ?? "—"}</td>
                    <td className="px-4 py-3">{unit.type || "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{areaLabel(unit)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{priceLabel(unit)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                          available
                            ? "bg-primary/10 text-primary"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {statusLabel(unit.availabilityStatus)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Section>
  );
}
