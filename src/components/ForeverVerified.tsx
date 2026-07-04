import * as React from "react";
import { CheckCircle2 } from "lucide-react";
import {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";

interface ForeverVerifiedProps {
  className?: string;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  sideOffset?: number;
}

const verificationItems = [
  "Personally inspected by Forever advisors.",
  "Developer information verified.",
  "Construction progress reviewed.",
  "Promotion validated.",
  "Legal documentation checked.",
];

export function ForeverVerified({
  className,
  align = "center",
  side = "top",
  sideOffset = 8,
}: ForeverVerifiedProps) {
  return (
    <HoverCard openDelay={150} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className={cn(
            "group inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-accent/15 bg-accent/[0.05] px-3 py-1.5 text-[12px] tracking-wide text-accent transition-all duration-300 ease-out hover:scale-[1.04] hover:border-accent/30 hover:bg-accent/[0.10] hover:shadow-[0_0_24px_-4px_rgba(199,154,69,0.25)] focus:outline-none focus:ring-2 focus:ring-accent/20",
            className,
          )}
          aria-label="Forever Verified — view details"
        >
          <CheckCircle2
            className="h-3.5 w-3.5 text-accent transition-transform duration-300 ease-out group-hover:scale-110"
            strokeWidth={1.8}
            aria-hidden="true"
          />
          <span className="font-sans font-medium">Forever Verified</span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        align={align}
        side={side}
        sideOffset={sideOffset}
        className="w-[280px] rounded-2xl border border-accent/10 bg-popover p-6 shadow-[0_12px_40px_rgba(30,30,30,0.06)] backdrop-blur-sm"
      >
        <div className="flex items-center gap-2.5 pb-4">
          <CheckCircle2
            className="h-5 w-5 text-accent"
            strokeWidth={1.8}
            aria-hidden="true"
          />
          <span className="font-serif text-[15px] font-semibold tracking-tight text-foreground">
            Forever Verified
          </span>
        </div>
        <ul className="flex flex-col gap-3">
          {verificationItems.map((item, i) => (
            <li
              key={i}
              className="flex items-start gap-2.5 text-[13px] leading-[1.6] text-muted-foreground"
            >
              <span
                className="mt-[7px] h-[5px] w-[5px] shrink-0 rounded-full bg-accent/60"
                aria-hidden="true"
              />
              {item}
            </li>
          ))}
        </ul>
        <div className="mt-5 pt-4 border-t border-accent/8">
          <button
            type="button"
            className="text-[12px] font-medium text-accent/70 transition-colors duration-200 hover:text-accent tracking-wide"
          >
            Learn more
          </button>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
