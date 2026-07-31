import { CalendarClock, Fingerprint, ListChecks, ShieldCheck } from "lucide-react";

import type {
  DecisionDeckCompactPassport,
  DecisionDeckInventorySummary,
  DecisionDeckValue,
} from "../decision-deck-model";

function supported<T>(
  value: DecisionDeckValue<T>,
): value is Extract<DecisionDeckValue<T>, { state: "supported" }> {
  return value.state === "supported";
}

function inventoryValue(value: DecisionDeckInventorySummary): string {
  return `${value.availableCount} available · ${value.listedCount} listed`;
}

export interface ProjectPassportStripProps {
  passport: DecisionDeckCompactPassport;
}

export function ProjectPassportStrip({ passport }: ProjectPassportStripProps) {
  const facts = [
    supported(passport.foreverId)
      ? { label: "Forever ID", value: passport.foreverId.value, Icon: Fingerprint }
      : null,
    supported(passport.listedAvailability)
      ? {
          label: "Recorded inventory",
          value: inventoryValue(passport.listedAvailability.value),
          Icon: ListChecks,
        }
      : null,
    supported(passport.verdict)
      ? { label: "Forever verdict", value: passport.verdict.value, Icon: ShieldCheck }
      : null,
    supported(passport.lastInspection)
      ? { label: "Last inspection", value: passport.lastInspection.value, Icon: CalendarClock }
      : null,
    supported(passport.lastPriceUpdate)
      ? { label: "Price list update", value: passport.lastPriceUpdate.value, Icon: CalendarClock }
      : null,
  ].filter((fact): fact is NonNullable<typeof fact> => fact !== null);

  if (facts.length === 0) return null;

  return (
    <section
      aria-label="Compact Forever Passport"
      data-composition-id="compact-passport"
      data-testid="compact-passport"
      className="rounded-[18px] border border-border/70 bg-card px-5 py-4 sm:px-6"
    >
      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-accent" aria-hidden="true" />
        <h2 className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Forever Passport
        </h2>
      </div>
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {facts.map(({ label, value, Icon }) => (
          <div key={label} className="min-w-0 border-l-2 border-accent/50 pl-3">
            <dt className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              <Icon className="h-3 w-3" aria-hidden="true" />
              {label}
            </dt>
            <dd className="mt-1 break-words text-sm font-medium text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
