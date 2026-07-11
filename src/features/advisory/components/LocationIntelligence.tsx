import { NOT_AVAILABLE } from "../investment-intelligence";
import type { LocationIntelligence } from "../location-intelligence";

/**
 * LocationIntelligence — foundation section for the Advisory Workspace.
 *
 * Presentational only: it renders a pre-derived, evidence-only view model.
 * Absent data is shown as "Not available"; it never fabricates distances,
 * travel times, demand, growth, or any location metric, and never renders a
 * numeric location score. Mirrors the Investment / Rental Intelligence sections
 * exactly.
 */
export interface LocationIntelligenceProps {
  data: LocationIntelligence;
  headingId?: string;
}

const VERDICT_BORDER: Record<LocationIntelligence["readinessVerdict"], string> = {
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

export function LocationIntelligence({
  data,
  headingId = "advisory-location-intelligence-heading",
}: LocationIntelligenceProps) {
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
          Location Intelligence
        </h2>
        <p className={`mt-1 text-sm ${muted}`}>
          Derived only from verified project data. Distances, demand, and travel times are never
          estimated; missing evidence is shown as &ldquo;Not available&rdquo;.
        </p>
      </header>

      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Area / location identity" value={data.locationIdentity} />
        <Field label="Location description" value={data.locationDescription} />
        <Field label="Beach proximity" value={data.beachProximity} />
        <Field label="Airport proximity" value={data.airportProximity} />
        <Field label="Lifestyle & amenities" value={data.lifestyleEvidence} />
        <Field label="Infrastructure" value={data.infrastructureEvidence} />
        <Field label="Rental-location evidence" value={data.rentalLocationEvidence} />
        <Field label="Resale / liquidity location" value={data.resaleLocationEvidence} />
      </dl>

      <div className="mt-5 border-t border-[#EAE6DE] pt-4">
        <dt className={`text-xs uppercase tracking-wide ${muted}`}>Location score</dt>
        <dd className={`mt-1 text-sm ${muted}`}>{data.locationScore}</dd>
      </div>

      <div className="mt-4">
        <h3 className={`text-xs uppercase tracking-wide ${muted}`}>Key location data gaps</h3>
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
        <p className={`text-xs uppercase tracking-wide ${muted}`}>Location readiness verdict</p>
        <p className="mt-1 text-sm font-semibold text-[#17150F]">{data.readinessVerdict}</p>
        <p className={`mt-1 text-sm ${muted}`}>{data.verdictRationale}</p>
      </div>
    </section>
  );
}
