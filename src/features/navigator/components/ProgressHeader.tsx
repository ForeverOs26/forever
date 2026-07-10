import type { ReactNode } from "react";

export interface ProgressHeaderProps {
  currentStep: number;
  totalSteps: number;
  title?: string;
  subtitle?: string;
  index?: string;
  onBack?: () => void;
  backLabel?: string;
  titleRef?: React.Ref<HTMLHeadingElement>;
  className?: string;
  children?: ReactNode;
}

export default function ProgressHeader({
  currentStep,
  totalSteps,
  title,
  subtitle,
  index,
  onBack,
  backLabel = "Back",
  titleRef,
  className = "",
  children,
}: ProgressHeaderProps) {
  const clamped = Math.min(Math.max(currentStep, 0), totalSteps);
  const percent = totalSteps > 0 ? Math.round((clamped / totalSteps) * 100) : 0;
  const pad2 = (value: number) => String(value).padStart(2, "0");

  return (
    <div className={["w-full", className].join(" ")}>
      <div className="flex items-center gap-[14px] px-[26px] pb-[10px] pt-[52px]">
        {onBack ? (
          <button
            type="button"
            aria-label={backLabel}
            onClick={onBack}
            className={[
              "flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-full",
              "border border-[#EAE6DE] bg-white text-[16px] text-[#57534A]",
              "transition-colors duration-200 ease-out motion-reduce:transition-none hover:bg-[#FBFAF7]",
              "outline-none focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2 focus-visible:ring-offset-white",
            ].join(" ")}
          >
            {"<"}
          </button>
        ) : null}

        <div
          className="h-[2px] flex-1 overflow-hidden rounded-[2px] bg-[#EAE6DE]"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Step ${clamped} of ${totalSteps}`}
        >
          <div
            className="h-full rounded-[2px] bg-[#17150F] transition-[width] duration-[600ms] ease-[cubic-bezier(.2,.7,.2,1)] motion-reduce:transition-none"
            style={{ width: `${percent}%` }}
          />
        </div>

        <div className="text-[12px] font-[600] tabular-nums tracking-[.08em] text-[#A29C90]">
          {pad2(clamped)} / {pad2(totalSteps)}
        </div>
      </div>

      {(index || title || subtitle) && (
        <div className="px-[26px] pt-[14px]">
          {index ? (
            <div className="mb-3 text-[18px] italic text-[#9C7B4C] [font-family:'Newsreader',Georgia,serif]">
              {index}
            </div>
          ) : null}
          {title ? (
            <h1
              ref={titleRef}
              tabIndex={-1}
              className="mb-2 text-[28px] font-[400] leading-tight tracking-[-.01em] text-[#17150F] outline-none [font-family:'Newsreader',Georgia,serif] md:text-[40px]"
            >
              {title}
            </h1>
          ) : null}
          {subtitle ? (
            <p className="text-[14px] text-[#9A958A] [font-family:'Hanken_Grotesk',system-ui,sans-serif] md:text-[16px]">
              {subtitle}
            </p>
          ) : null}
          {children}
        </div>
      )}
    </div>
  );
}
