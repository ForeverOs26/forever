export interface PrimaryActionBarProps {
  primaryLabel: string;
  onPrimary: () => void;
  disabled?: boolean;
  loading?: boolean;
  secondaryLabel?: string;
  onSecondary?: () => void;
  sticky?: boolean;
  className?: string;
}

export default function PrimaryActionBar({
  primaryLabel,
  onPrimary,
  disabled = false,
  loading = false,
  secondaryLabel,
  onSecondary,
  sticky = true,
  className = "",
}: PrimaryActionBarProps) {
  const inert = disabled || loading;

  return (
    <div
      className={[
        sticky ? "sticky bottom-0" : "",
        "w-full bg-gradient-to-b from-transparent to-white",
        "px-[26px] pt-3",
        "pb-[calc(34px+env(safe-area-inset-bottom))]",
        className,
      ].join(" ")}
    >
      <button
        type="button"
        disabled={inert}
        aria-busy={loading || undefined}
        onClick={inert ? undefined : onPrimary}
        className={[
          "flex w-full items-center justify-center gap-2 rounded-[16px] px-4 py-4",
          "text-[16px] font-[600] tracking-[.01em] [font-family:'Hanken_Grotesk',system-ui,sans-serif]",
          "transition-all duration-300 ease-out motion-reduce:transition-none",
          "outline-none focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2 focus-visible:ring-offset-white",
          inert
            ? "cursor-default bg-[#EDE9E1] text-[#B7B2A6] shadow-none"
            : "cursor-pointer bg-[#17150F] text-white shadow-[0_14px_30px_-14px_rgba(23,21,15,.7)] active:translate-y-px",
        ].join(" ")}
      >
        {loading ? (
          <>
            <span
              aria-hidden="true"
              className="h-[16px] w-[16px] rounded-full border-2 border-[#B7B2A6] border-t-transparent motion-safe:animate-spin"
            />
            <span className="sr-only">Working...</span>
          </>
        ) : (
          primaryLabel
        )}
      </button>

      {secondaryLabel ? (
        <button
          type="button"
          onClick={onSecondary}
          className={[
            "mt-[10px] w-full rounded-[12px] px-4 py-3",
            "text-[15px] font-[600] text-[#A29C90] [font-family:'Hanken_Grotesk',system-ui,sans-serif]",
            "transition-colors duration-200 ease-out motion-reduce:transition-none hover:text-[#57534A]",
            "outline-none focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2 focus-visible:ring-offset-white",
          ].join(" ")}
        >
          {secondaryLabel}
        </button>
      ) : null}
    </div>
  );
}
