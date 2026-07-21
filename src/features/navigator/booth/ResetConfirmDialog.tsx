import { useEffect, useRef } from "react";

/**
 * Guarded "Start new guest" confirmation. role="dialog" aria-modal with a focus
 * trap; Esc or backdrop cancels. Only shown when the session holds guest data.
 */
export function ResetConfirmDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const isDemoMode =
    import.meta.env.DEV &&
    (import.meta.env.VITE_PARTNER_DEMO === "true" ||
      import.meta.env.VITE_DEMO_LEAD_MODE === "true");
  const confirmRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>("button");
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#17150F]/40 px-6"
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="booth-reset-title"
        aria-describedby="booth-reset-body"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-[440px] rounded-[18px] border border-[#E3DED4] bg-white p-7 shadow-[0_40px_90px_-40px_rgba(23,21,15,.5)]"
      >
        <h2
          id="booth-reset-title"
          className="text-[22px] font-[400] leading-tight text-[#17150F] [font-family:'Newsreader',Georgia,serif]"
        >
          Start a new guest session?
        </h2>
        <p
          id="booth-reset-body"
          className="mt-3 text-[14.5px] leading-relaxed text-[#57534A] [font-family:'Hanken_Grotesk',system-ui,sans-serif]"
        >
          This clears the current guest&apos;s answers and any unsaved details from this tablet.
          {isDemoMode ? " No contact details were saved." : " Saved leads are not affected."}
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row-reverse">
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className="min-h-[52px] flex-1 rounded-[14px] bg-[#17150F] px-4 text-[15px] font-[600] text-white outline-none transition-transform focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2 active:translate-y-px [font-family:'Hanken_Grotesk',system-ui,sans-serif]"
          >
            Clear and start new
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="min-h-[52px] flex-1 rounded-[14px] border border-[#EAE6DE] bg-white px-4 text-[15px] font-[600] text-[#57534A] outline-none transition-colors hover:bg-[#FBFAF7] focus-visible:ring-2 focus-visible:ring-[#9C7B4C] focus-visible:ring-offset-2 [font-family:'Hanken_Grotesk',system-ui,sans-serif]"
          >
            Keep session
          </button>
        </div>
      </div>
    </div>
  );
}
