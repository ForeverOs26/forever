import type { AdvisoryAction, AdvisoryActionId } from "../types";

/**
 * NextAction — renders the available next actions as accessible buttons and
 * emits the selected action id via `onAction`. No real integration: this is a
 * pure callback boundary the host wires up later.
 */
export interface NextActionProps {
  actions: AdvisoryAction[];
  onAction?: (actionId: AdvisoryActionId) => void;
  headingId?: string;
}

export function NextAction({
  actions,
  onAction,
  headingId = "advisory-next-action-heading",
}: NextActionProps) {
  return (
    <section
      aria-labelledby={headingId}
      className="rounded-2xl border border-[#EAE6DE] bg-white p-5 sm:p-6"
    >
      <h2
        id={headingId}
        className="mb-4 font-serif text-lg text-[#17150F] sm:text-xl"
        style={{ fontFamily: '"Newsreader", Georgia, serif' }}
      >
        Next Action
      </h2>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {actions.map((action) => (
          <li key={action.id}>
            <button
              type="button"
              onClick={() => onAction?.(action.id)}
              className="flex w-full flex-col items-start gap-1 rounded-xl border border-[#EAE6DE] bg-[#F3EFE7] px-4 py-3 text-left transition-colors hover:border-[#9C7B4C] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9C7B4C] motion-reduce:transition-none"
            >
              <span className="text-sm font-semibold text-[#17150F]">{action.label}</span>
              <span className="text-xs text-[#9A958A]">{action.description}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
