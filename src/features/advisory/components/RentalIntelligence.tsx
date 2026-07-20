import { NOT_AVAILABLE } from "../investment-intelligence";
import type { RentalIntelligence } from "../rental-intelligence";

/**
 * RentalIntelligence — foundation section for the Advisory Workspace.
 *
 * Presentational only: it renders a pre-derived, evidence-only view model.
 * Absent data is shown as "Not available"; it never fabricates figures and
 * never renders a numeric rental score. Mirrors the Investment Intelligence
 * section exactly.
 */
export interface RentalIntelligenceProps {
  data: RentalIntelligence;
  headingId?: string;
}

const VERDICT_BORDER: Record<RentalIntelligence["readinessVerdict"], string> = {
  "Insufficient verified data": "border-l-2 border-l-[#EAE6DE]",
  "More evidence required": "border-l-2 border-l-[#9C7B4C]",
  "Ready for preliminary review": "border-l-4 border-l-[#9C7B4C]",
};

const muted = "text-[#9A958A]";

function EvidenceValue({ value }: { value: string }) {
  const isMissing = value === NOT_AVAILABLE;
  return <dd className={`text-sm ${isMissing ? muted : "text-[#17150F]"}`}>{value}</dd>;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className={`text-xs uppercase tracking-wide ${muted}`}>{label}</dt>
      <EvidenceValue value={value} />
    </div>
  );
}

export function RentalIntelligence({
  data,
  headingId = "advisory-rental-intelligence-heading",
}: RentalIntelligenceProps) {
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
          Rental Intelligence
        </h2>
        <p className={`mt-1 text-sm ${muted}`}>
          Derived only from recorded project data. Missing evidence is shown as &ldquo;Not
          available&rdquo;.
        </p>
      </header>

      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Rental demand" value={data.demandContext} />
        <Field label="Rental income evidence" value={data.incomeEvidence} />
        <Field label="Occupancy evidence" value={data.occupancyEvidence} />
        <Field label="Return evidence" value={data.returnEvidence} />
        <Field label="Rental guarantee" value={data.guaranteeEvidence} />
        <Field label="Rental management" value={data.managementContext} />
        <Field label="Seasonality" value={data.seasonalityEvidence} />
        <Field label="Competition" value={data.competitionEvidence} />
      </dl>

      <div className="mt-5 border-t border-[#EAE6DE] pt-4">
        <dt className={`text-xs uppercase tracking-wide ${muted}`}>Rental score</dt>
        <dd className={`mt-1 text-sm ${muted}`}>{data.rentalScore}</dd>
      </div>

      <div className="mt-4">
        <h3 className={`text-xs uppercase tracking-wide ${muted}`}>Key data gaps</h3>
        {data.keyDataGaps.length === 0 ? (
          <p className="mt-1 text-sm text-[#17150F]">No critical gaps identified.</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {data.keyDataGaps.map((gap) => (
              <li
                key={gap}
                className="rounded-full border border-[#EAE6DE] bg-[#F3EFE7] px-3 py-1 text-xs text-[#17150F]"
              >
                {gap}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div
        className={`mt-5 rounded-xl border border-[#EAE6DE] bg-[#F3EFE7] p-4 ${VERDICT_BORDER[data.readinessVerdict]}`}
      >
        <p className={`text-xs uppercase tracking-wide ${muted}`}>Rental readiness verdict</p>
        <p className="mt-1 text-sm font-semibold text-[#17150F]">{data.readinessVerdict}</p>
        <p className={`mt-1 text-sm ${muted}`}>{data.verdictRationale}</p>
      </div>
    </section>
  );
}
