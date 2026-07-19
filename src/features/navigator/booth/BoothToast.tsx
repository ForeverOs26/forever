import { useEffect } from "react";

export type ToastTone = "success" | "error";

export interface BoothToastState {
  tone: ToastTone;
  message: string;
}

/**
 * Accessible transient feedback (copied / reset / error). Rendered in an
 * aria-live region so screen readers announce it without moving focus.
 */
export function BoothToast({
  toast,
  onDismiss,
}: {
  toast: BoothToastState | null;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!toast) return;
    const timeoutId = window.setTimeout(onDismiss, 3200);
    return () => window.clearTimeout(timeoutId);
  }, [toast, onDismiss]);

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(20px+env(safe-area-inset-bottom))] z-40 flex justify-center px-4"
    >
      {toast ? (
        <div
          role="status"
          className={[
            "pointer-events-auto max-w-[520px] rounded-[12px] px-4 py-3 text-[14px] font-[500] shadow-[0_18px_40px_-20px_rgba(23,21,15,.5)] [font-family:'Hanken_Grotesk',system-ui,sans-serif]",
            toast.tone === "success"
              ? "border border-[#CFE3D5] bg-[#F2F8F3] text-[#2C5B3F]"
              : "border border-[#EAC9BE] bg-[#FBF1ED] text-[#8A3D24]",
          ].join(" ")}
        >
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}
