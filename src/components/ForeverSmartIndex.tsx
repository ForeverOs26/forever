import * as React from "react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ForeverSmartIndexProps {
  trustScore: number;
  valueScore: number;
  fairPriceIndex: number;
  fairPriceLabel?: string;
  className?: string;
}

const metricDetails = [
  {
    key: "trust" as const,
    label: "Forever Score",
    shortLabel: "Score",
    description:
      "Overall quality and reliability rating based on site inspections, developer history, construction progress, and legal review.",
    max: 10,
    decimals: 1,
    unit: "/ 10",
    getColor: (v: number) => {
      if (v >= 9.0) return "text-foreground";
      if (v >= 7.5) return "text-foreground";
      return "text-foreground";
    },
  },
  {
    key: "value" as const,
    label: "Forever Value Score",
    shortLabel: "Value",
    description:
      "Price-to-quality assessment comparing this project against similar properties in the same area and segment.",
    max: 10,
    decimals: 1,
    unit: "/ 10",
    getColor: (v: number) => {
      if (v >= 9.0) return "text-foreground";
      if (v >= 7.5) return "text-foreground";
      return "text-foreground";
    },
  },
  {
    key: "fairPrice" as const,
    label: "Fair Price Index",
    shortLabel: "Fair Price",
    description:
      "How the current asking price compares to verified comparable sales and market benchmarks.",
    max: 100,
    decimals: 0,
    unit: "%",
    getColor: () => "text-foreground",
    format: (v: number, label?: string) => {
      if (label) return label;
      if (v > 0) return `${v}% below similar projects`;
      if (v < 0) return `${Math.abs(v)}% above similar projects`;
      return "Priced near market average";
    },
  },
];

export function ForeverSmartIndex({
  trustScore,
  valueScore,
  fairPriceIndex,
  fairPriceLabel,
  className,
}: ForeverSmartIndexProps) {
  const values = {
    trust: trustScore,
    value: valueScore,
    fairPrice: fairPriceIndex,
  };

  return (
    <TooltipProvider delayDuration={150}>
      <div
        className={cn(
          "rounded-3xl border border-border/60 bg-card p-6 sm:p-8",
          className
        )}
      >
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-3 sm:gap-6">
          {metricDetails.map((metric) => (
            <Tooltip key={metric.key}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="group relative flex flex-col items-start gap-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/20 rounded-xl -m-2 p-2"
                  aria-label={`${metric.label}: ${
                    metric.key === "fairPrice"
                      ? metric.format?.(values[metric.key], fairPriceLabel) ??
                        values[metric.key]
                      : values[metric.key].toFixed(metric.decimals) + metric.unit
                  }. ${metric.description}`}
                >
                  <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                    {metric.label}
                  </span>
                  <span
                    className={cn(
                      "font-serif text-3xl tracking-tight transition-colors duration-300",
                      metric.getColor(values[metric.key])
                    )}
                  >
                    {metric.key === "fairPrice" ? (
                      <span className="inline-flex items-baseline gap-1">
                        <span className="font-sans text-sm font-medium text-accent">
                          {fairPriceIndex > 0 ? "+" : ""}
                          {Math.abs(fairPriceIndex)}%
                        </span>
                        <span className="font-sans text-sm text-muted-foreground">
                          {fairPriceLabel ??
                            (fairPriceIndex > 0
                              ? "below market"
                              : fairPriceIndex < 0
                              ? "above market"
                              : "at market")}
                        </span>
                      </span>
                    ) : (
                      <>
                        {values[metric.key].toFixed(metric.decimals)}
                        <span className="ml-1 font-sans text-sm font-normal text-muted-foreground">
                          {metric.unit}
                        </span>
                      </>
                    )}
                  </span>
                  <span className="mt-0.5 h-[2px] w-8 rounded-full bg-accent/30 transition-all duration-300 group-hover:w-12 group-hover:bg-accent/50" />
                </button>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                sideOffset={8}
                className="max-w-[240px] rounded-xl border border-accent/10 bg-popover px-4 py-3 text-sm text-popover-foreground shadow-[0_12px_40px_rgba(30,30,30,0.06)]"
              >
                <p className="leading-relaxed text-muted-foreground">
                  {metric.description}
                </p>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>

        <div className="mt-6 border-t border-border/40 pt-4">
          <p className="text-[11px] leading-relaxed text-muted-foreground/70">
            Based on comparable projects, verified pricing, and Forever advisory
            review.
          </p>
        </div>
      </div>
    </TooltipProvider>
  );
}
