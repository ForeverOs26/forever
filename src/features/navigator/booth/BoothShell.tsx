import type { ReactNode } from "react";

import type { SessionScreen } from "../core";
import { boothStage } from "./stage";

/**
 * Booth staff shell — replaces the public site header/footer with a 64px staff
 * bar: Forever identity, a "Booth Mode · Staff" chip, the current stage label +
 * mini progress, and "Start new guest". No public navigation. This is the ONLY
 * chrome difference from the website; the journey inside is the shared core.
 */
export function BoothShell({
  screen,
  onStartNewGuest,
  children,
}: {
  screen: SessionScreen;
  onStartNewGuest: () => void;
  children: ReactNode;
}) {
  const stage = boothStage(screen);

  return (
    <div className="flex min-h-screen flex-col bg-[#ECEAE3] [font-family:'Hanken_Grotesk',system-ui,sans-serif]">
      <header className="sticky top-0 z-30 border-b border-[#E3DED4] bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
        <div className="mx-auto flex min-h-[64px] w-full max-w-[1120px] items-center gap-4 px-5 py-2">
          <div className="flex items-center gap-2.5">
            <span aria-hidden="true" className="h-[8px] w-[8px] rounded-full bg-[#9C7B4C]" />
            <span className="text-[15px] font-[700] tracking-[0.02em] text-[#17150F]">Forever</span>
            <span className="rounded-full border border-[#E3DED4] bg-[#FBFAF7] px-2.5 py-1 text-[10.5px] font-[700] uppercase tracking-[0.14em] text-[#9C7B4C]">
              Booth Mode · Staff
            </span>
          </div>

          <div className="ml-auto flex items-center gap-4">
            <div className="hidden min-w-[160px] flex-col items-end sm:flex">
              <span className="text-[12px] font-[600] text-[#57534A]">{stage.label}</span>
              <span
                className="mt-1 h-[3px] w-[120px] overflow-hidden rounded-full bg-[#EAE6DE]"
                role="progressbar"
                aria-valuenow={Math.round(stage.progress * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Booth stage: ${stage.label}`}
              >
                <span
                  className="block h-full rounded-full bg-[#17150F] transition-[width] duration-500"
                  style={{ width: `${Math.round(stage.progress * 100)}%` }}
                />
              </span>
            </div>

            <button
              type="button"
              onClick={onStartNewGuest}
              className="min-h-[44px] rounded-[12px] border border-[#EAE6DE] bg-white px-4 text-[13.5px] font-[600] text-[#3A362E] outline-none transition-colors hover:bg-[#FBFAF7] focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2"
            >
              Start new guest
            </button>
          </div>
        </div>
        <div className="border-t border-[#F1EDE6] px-5 py-1.5 text-[11.5px] font-[600] text-[#8A857A] sm:hidden">
          {stage.label}
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1120px] flex-1 px-5 py-6">{children}</main>
    </div>
  );
}
