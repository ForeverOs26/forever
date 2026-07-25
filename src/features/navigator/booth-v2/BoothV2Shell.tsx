import type { ReactNode } from "react";

import type { BoothV2Screen } from "../core/v2";

const STAGE_LABEL: Record<BoothV2Screen, string> = {
  welcome: "Welcome",
  permission: "Permission",
  language: "Language",
  mode_selection: "Choosing the pace",
  quick_profile: "Quick profile",
  full_nav_questions: "Decision Profile",
  property_fit: "Property fit",
  location_fit: "Location fit",
  readiness: "Readiness",
  decision_summary: "Decision summary",
  initial_directions: "Initial directions",
  contact: "Contact",
  whatsapp_verification: "WhatsApp check",
  guide_assignment: "Guide assignment",
  handoff_waiting: "Warm handoff",
  next_step: "Next step",
  completion: "Complete",
  respectful_no_contact_qr: "Continue at home",
};

const STAGE_ORDER: BoothV2Screen[] = [
  "welcome",
  "permission",
  "language",
  "mode_selection",
  "quick_profile",
  "full_nav_questions",
  "property_fit",
  "location_fit",
  "readiness",
  "decision_summary",
  "initial_directions",
  "contact",
  "whatsapp_verification",
  "guide_assignment",
  "handoff_waiting",
  "next_step",
  "completion",
];

function stageProgress(screen: BoothV2Screen): number {
  if (screen === "respectful_no_contact_qr") return 1;
  const index = STAGE_ORDER.indexOf(screen);
  if (index <= 0) return 0;
  return index / (STAGE_ORDER.length - 1);
}

/**
 * Booth 2.0 Host shell — 64px staff bar: Forever identity, an "Assisted
 * Decision · Host" chip, the stage label + mini progress, "Start new guest".
 * No public navigation.
 */
export function BoothV2Shell({
  screen,
  hostName,
  onStartNewGuest,
  children,
}: {
  screen: BoothV2Screen;
  /** The authenticated Host, resolved server-side — never client-supplied. */
  hostName?: string | null;
  onStartNewGuest: () => void;
  children: ReactNode;
}) {
  const label = STAGE_LABEL[screen];
  const progress = stageProgress(screen);

  return (
    <div className="flex min-h-screen flex-col bg-[#ECEAE3] [font-family:'Hanken_Grotesk',system-ui,sans-serif]">
      <header className="sticky top-0 z-30 border-b border-[#E3DED4] bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
        <div className="mx-auto flex min-h-[64px] w-full max-w-[1120px] items-center gap-4 px-5 py-2">
          <div className="flex items-center gap-2.5">
            <span aria-hidden="true" className="h-[8px] w-[8px] rounded-full bg-[#9C7B4C]" />
            <span className="text-[15px] font-[700] tracking-[0.02em] text-[#17150F]">Forever</span>
            <span className="rounded-full border border-[#E3DED4] bg-[#FBFAF7] px-2.5 py-1 text-[10.5px] font-[700] uppercase tracking-[0.14em] text-[#9C7B4C]">
              Booth 2.0 · Host
            </span>
            {hostName ? (
              <span className="hidden text-[12px] font-[600] text-[#57534A] sm:inline">
                {hostName}
              </span>
            ) : null}
          </div>

          <div className="ml-auto flex items-center gap-4">
            <div className="hidden min-w-[160px] flex-col items-end sm:flex">
              <span className="text-[12px] font-[600] text-[#57534A]">{label}</span>
              <span
                className="mt-1 h-[3px] w-[120px] overflow-hidden rounded-full bg-[#EAE6DE]"
                role="progressbar"
                aria-valuenow={Math.round(progress * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Booth stage: ${label}`}
              >
                <span
                  className="block h-full rounded-full bg-[#17150F] transition-[width] duration-500"
                  style={{ width: `${Math.round(progress * 100)}%` }}
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
          {label}
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1120px] flex-1 px-5 py-6">{children}</main>
    </div>
  );
}
