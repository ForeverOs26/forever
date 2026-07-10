import { useId } from "react";

export interface NoteFieldProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  maxLength?: number;
  showCounter?: boolean;
  disabled?: boolean;
  rows?: number;
  className?: string;
}

export default function NoteField({
  value,
  onChange,
  label,
  placeholder,
  maxLength,
  showCounter = false,
  disabled = false,
  rows = 3,
  className = "",
}: NoteFieldProps) {
  const id = useId();
  const counterId = `${id}-counter`;
  const remaining = typeof maxLength === "number" ? maxLength - value.length : null;
  const near = remaining !== null && remaining <= 50;

  return (
    <div className={["mt-2", className].join(" ")}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        rows={rows}
        disabled={disabled}
        aria-describedby={showCounter && maxLength ? counterId : undefined}
        className={[
          "w-full resize-none rounded-[15px] border px-4 py-[14px]",
          "text-[15px] leading-relaxed [font-family:'Hanken_Grotesk',system-ui,sans-serif]",
          "outline-none transition-colors duration-200 ease-out motion-reduce:transition-none",
          "placeholder:text-[#B0AB9F]",
          disabled
            ? "cursor-not-allowed border-[#EFEBE3] bg-[#F6F4EF] text-[#B0AB9F]"
            : "border-[#EAE6DE] bg-[#FBFAF7] text-[#2A2820] focus:border-[#D8D2C6] focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2 focus-visible:ring-offset-white",
        ].join(" ")}
      />
      {showCounter && typeof maxLength === "number" ? (
        <div
          id={counterId}
          aria-live="polite"
          className={[
            "mt-[6px] text-right text-[12px] tabular-nums [font-family:'Hanken_Grotesk',system-ui,sans-serif]",
            near ? "text-[#9C7B4C]" : "text-[#B0AB9F]",
          ].join(" ")}
        >
          {value.length} / {maxLength}
        </div>
      ) : null}
    </div>
  );
}
