import type { ClientSnapshotData } from "../types";

/**
 * ClientSnapshot — at-a-glance profile of the client the advisor is about
 * to meet. Presentational only; all data arrives via props.
 */
export interface ClientSnapshotProps {
  data: ClientSnapshotData;
  /** Heading id, so the section can be labelled by assistive tech. */
  headingId?: string;
}

interface FieldProps {
  label: string;
  children: React.ReactNode;
}

const unavailable = <span className="text-[#9A958A]">Not available</span>;

function Field({ label, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs uppercase tracking-wide text-[#9A958A]">{label}</dt>
      <dd className="text-sm text-[#17150F]">{children}</dd>
    </div>
  );
}

export function ClientSnapshot({
  data,
  headingId = "advisory-client-snapshot-heading",
}: ClientSnapshotProps) {
  return (
    <section
      aria-labelledby={headingId}
      className="rounded-2xl border border-[#EAE6DE] bg-white p-5 sm:p-6"
    >
      <header className="mb-4">
        <h2
          id={headingId}
          className="font-serif text-lg text-[#17150F] sm:text-xl"
          style={{ fontFamily: '"Newsreader", Georgia, serif' }}
        >
          Client Snapshot
        </h2>
        <p className="mt-1 text-sm text-[#9A958A]">{data.clientName ?? "Not available"}</p>
      </header>

      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Buyer type">{data.buyerType ?? unavailable}</Field>
        <Field label="Primary goal">{data.primaryGoal ?? unavailable}</Field>
        <Field label="Budget">{data.budget ?? unavailable}</Field>
        <Field label="Timeline">{data.timeline ?? unavailable}</Field>
        <Field label="Risk profile">{data.riskProfile ?? unavailable}</Field>
        <Field label="Top priorities">
          {data.topPriorities.length === 0 ? unavailable : <ul className="flex flex-wrap gap-2">
            {data.topPriorities.map((priority) => (
              <li
                key={priority}
                className="rounded-full border border-[#EAE6DE] bg-[#F3EFE7] px-3 py-1 text-xs text-[#17150F]"
              >
                {priority}
              </li>
            ))}
          </ul>}
        </Field>
      </dl>
    </section>
  );
}
