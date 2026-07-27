import { forwardRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";

export interface ChoiceCardProps {
  title: string;
  description?: string;
  selected?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  onClick?: () => void;
  ariaLabel?: string;
  className?: string;
}

const ChoiceCard = forwardRef<HTMLButtonElement, ChoiceCardProps>(function ChoiceCard(
  {
    title,
    description,
    selected = false,
    disabled = false,
    icon,
    onClick,
    ariaLabel,
    className = "",
  },
  ref,
) {
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) {
      return;
    }

    if (event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      onClick?.();
    }
  }

  return (
    <button
      ref={ref}
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-disabled={disabled || undefined}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      onKeyDown={handleKeyDown}
      className={[
        "group flex w-full items-center justify-between gap-3 text-left",
        "min-h-[54px] rounded-[15px] px-[18px] py-[17px]",
        "text-[15.5px] font-[500] leading-tight",
        "[font-family:'Hanken_Grotesk',system-ui,sans-serif]",
        "transition-all duration-[280ms] ease-[cubic-bezier(.2,.7,.2,1)] motion-reduce:transition-none",
        "outline-none focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2 focus-visible:ring-offset-white",
        disabled
          ? "cursor-default border border-[#EFEBE3] bg-white text-[#C4BFB4]"
          : selected
            ? "cursor-pointer border-[1.5px] border-[#17150F] bg-[#F3EFE7] font-[600] text-[#17150F] shadow-[0_6px_18px_-8px_rgba(23,21,15,.25)] active:translate-y-px"
            : "cursor-pointer border border-[#EAE6DE] bg-white text-[#3A362E] hover:border-[#D8D2C6] hover:bg-[#FBFAF7] active:translate-y-px active:bg-[#F6F3EC]",
        className,
      ].join(" ")}
    >
      <span className="flex min-w-0 items-center gap-3">
        {icon ? (
          <span aria-hidden="true" className="flex shrink-0 items-center justify-center text-[#9C7B4C]">
            {icon}
          </span>
        ) : null}
        <span className="flex min-w-0 flex-col">
          <span>{title}</span>
          {description ? (
            <span
              className={[
                "mt-1 text-[13px] font-[400] leading-snug",
                disabled ? "text-[#C4BFB4]" : "text-[#9A958A]",
              ].join(" ")}
            >
              {description}
            </span>
          ) : null}
        </span>
      </span>

      <span
        aria-hidden="true"
        className={[
          "h-[10px] w-[10px] shrink-0 rounded-full transition-transform duration-200 ease-out motion-reduce:transition-none",
          disabled
            ? "border border-[#EBE6DD] bg-transparent"
            : selected
              ? "scale-100 bg-[#9C7B4C]"
              : "border border-[#DDD8CE] bg-transparent",
        ].join(" ")}
      />
    </button>
  );
});

export default ChoiceCard;
