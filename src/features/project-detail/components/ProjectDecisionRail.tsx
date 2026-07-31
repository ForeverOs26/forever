import { CalendarClock, CircleAlert, HardHat, Layers3 } from "lucide-react";

import type {
  DecisionDeckDecisionRail,
  DecisionDeckInventorySummary,
  DecisionDeckValue,
} from "../decision-deck-model";

function money(value: number): string {
  return `฿${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value)}`;
}

function supported<T>(
  value: DecisionDeckValue<T>,
): value is Extract<DecisionDeckValue<T>, { state: "supported" }> {
  return value.state === "supported";
}

function inventoryLabel(inventory: DecisionDeckInventorySummary): string {
  return `${inventory.availableCount} of ${inventory.listedCount} listed units available`;
}

export interface ProjectDecisionRailProps {
  rail: DecisionDeckDecisionRail;
}

/**
 * The commercial summary is intentionally not a conversion surface. Every row
 * is supplied by the Decision Deck model and unsupported values simply do not
 * enter the DOM.
 */
export function ProjectDecisionRail({ rail }: ProjectDecisionRailProps) {
  const hasSupportedContent = Object.values(rail).some((field) => field.state === "supported");
  if (!hasSupportedContent) return null;

  return (
    <aside
      aria-label="Decision summary"
      data-composition-id="decision-rail"
      data-testid="decision-rail"
      data-desktop-behavior="sticky"
      data-mobile-behavior="inline"
      className="decision-deck-rail min-w-0 rounded-[18px] border border-border bg-card p-5 shadow-[0_1px_2px_oklch(0.22_0_0/0.05),0_8px_24px_oklch(0.22_0_0/0.05)] min-[960px]:row-span-2 min-[960px]:self-start sm:p-6"
    >
      <div className="flex items-center gap-3">
        <span className="h-0.5 w-6 bg-accent" aria-hidden="true" />
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Decision rail
        </p>
      </div>

      {supported(rail.priceFromTHB) ? (
        <div className="mt-5 border-b border-border/70 pb-5">
          <p className="text-xs text-muted-foreground">Starting price</p>
          <p className="mt-1 font-serif text-[2.1rem] leading-none tracking-tight text-foreground min-[401px]:text-[2.3rem]">
            {money(rail.priceFromTHB.value)}
          </p>
          {supported(rail.lastVerifiedUpdate) ? (
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
              Price list {rail.lastVerifiedUpdate.value}
            </p>
          ) : null}
        </div>
      ) : null}

      {supported(rail.currentInventory) ? (
        <div className="border-b border-border/70 py-5">
          <p className="font-serif text-xl leading-tight text-foreground">
            {inventoryLabel(rail.currentInventory.value)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Listed inventory, not total development scale
          </p>
        </div>
      ) : null}

      <dl className="divide-y divide-border/60">
        {!supported(rail.priceFromTHB) && supported(rail.lastVerifiedUpdate) ? (
          <div className="py-4">
            <dt className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
              Price list update
            </dt>
            <dd className="mt-1 text-sm font-medium text-foreground">
              {rail.lastVerifiedUpdate.value}
            </dd>
          </div>
        ) : null}
        {supported(rail.verdict) ? (
          <div className="py-4">
            <dt className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />
              Forever verdict
            </dt>
            <dd className="mt-1 text-sm font-medium text-foreground">{rail.verdict.value}</dd>
          </div>
        ) : null}
        {supported(rail.constructionContext) ? (
          <div className="py-4">
            <dt className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <HardHat className="h-3.5 w-3.5" aria-hidden="true" />
              Construction
            </dt>
            <dd className="mt-1 text-sm font-medium text-foreground">
              {rail.constructionContext.value}
            </dd>
          </div>
        ) : null}
        {supported(rail.buyerProfile) ? (
          <div className="py-4">
            <dt className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <Layers3 className="h-3.5 w-3.5" aria-hidden="true" />
              Supported buyer profile
            </dt>
            <dd className="mt-1 text-sm font-medium text-foreground">{rail.buyerProfile.value}</dd>
          </div>
        ) : null}
        {supported(rail.strongestVerifiedReason) ? (
          <div className="py-4">
            <dt className="text-xs text-muted-foreground">Strongest verified reason</dt>
            <dd className="mt-1 text-sm text-foreground">{rail.strongestVerifiedReason.value}</dd>
          </div>
        ) : null}
        {supported(rail.principalVerifiedCaution) ? (
          <div className="py-4">
            <dt className="text-xs text-muted-foreground">Principal verified caution</dt>
            <dd className="mt-1 text-sm text-foreground">{rail.principalVerifiedCaution.value}</dd>
          </div>
        ) : null}
      </dl>
    </aside>
  );
}
