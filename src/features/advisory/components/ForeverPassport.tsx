import { NOT_AVAILABLE } from "../investment-intelligence";
import type { ForeverPassport, PassportReadinessVerdict } from "../forever-passport";

/**
 * ForeverPassport — the executive-summary section for the Advisory Workspace.
 *
 * Presentational only: it renders a pre-derived, evidence-only Passport view
 * model that AGGREGATES the Trust, Investment, Rental and Location Intelligence
 * foundations. It never fabricates a value, never renders a numeric score, and
 * shows anything unsupported by verified data as "Not available". The overall
 * verdict it displays is the deterministic, most-conservative of the four
 * foundation verdicts — computed in the derivation layer, not here.
 */
export interface ForeverPassportProps {
  data: ForeverPassport;
  headingId?: string;
}

const VERDICT_BORDER: Record<PassportReadinessVerdict, string> = {
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

function SummaryCard({
  title,
  verdict,
  rationale,
  present,
  total,
  fields,
}: {
  title: string;
  verdict: PassportReadinessVerdict;
  rationale: string;
  present: number;
  total: number;
  fields: Array<{ label: string; value: string }>;
}) {
  return (
    <div
      className={`rounded-xl border border-[#EAE6DE] bg-[#F3EFE7] p-4 ${VERDICT_BORDER[verdict]}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h4
          className="font-serif text-base text-[#17150F]"
          style={{ fontFamily: '"Newsreader", Georgia, serif' }}
        >
          {title}
        </h4>
        <span className={`text-xs ${muted}`}>
          {present}/{total} signals
        </span>
      </div>
      <p className="mt-1 text-sm font-semibold text-[#17150F]">{verdict}</p>
      <dl className="mt-3 grid grid-cols-1 gap-3">
        {fields.map((field) => (
          <Field key={field.label} label={field.label} value={field.value} />
        ))}
      </dl>
      <p className={`mt-3 text-xs ${muted}`}>{rationale}</p>
    </div>
  );
}

export function ForeverPassport({
  data,
  headingId = "advisory-forever-passport-heading",
}: ForeverPassportProps) {
  const { identity, trust, investment, rental, location } = data;
  const { dataCompleteness, combinedGaps, overallVerdict, evidenceCoverage, metadata } = data;

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
          Forever Passport
        </h2>
        <p className={`mt-1 text-sm ${muted}`}>
          One evidence-based executive summary aggregating the Trust, Investment, Rental and
          Location Intelligence foundations. No new scores are calculated; missing evidence is shown
          as &ldquo;Not available&rdquo;.
        </p>
      </header>

      {/* 1. Project Identity */}
      <div className="rounded-xl border border-[#EAE6DE] bg-[#F3EFE7] p-4">
        <h3 className={`text-xs uppercase tracking-wide ${muted}`}>Project identity</h3>
        <dl className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Project name" value={identity.projectName} />
          <Field label="Forever ID" value={identity.foreverId} />
          <Field label="Property type" value={identity.propertyType} />
          <Field label="Location" value={identity.location} />
          <Field label="Ownership type" value={identity.ownershipType} />
          <Field label="Construction status" value={identity.constructionStatus} />
          <Field label="Developer" value={identity.developerName} />
        </dl>
      </div>

      {/* 8. Overall Advisory Readiness Verdict (executive headline) */}
      <div
        className={`mt-4 rounded-xl border border-[#EAE6DE] bg-[#F3EFE7] p-4 ${VERDICT_BORDER[overallVerdict.readinessVerdict]}`}
      >
        <p className={`text-xs uppercase tracking-wide ${muted}`}>Overall advisory readiness</p>
        <p className="mt-1 text-base font-semibold text-[#17150F]">
          {overallVerdict.readinessVerdict}
        </p>
        <p className={`mt-1 text-sm ${muted}`}>{overallVerdict.rationale}</p>
      </div>

      {/* 2. Trust Intelligence Summary */}
      <div className="mt-5">
        <h3 className={`mb-3 text-xs uppercase tracking-wide ${muted}`}>Trust Intelligence</h3>
        <SummaryCard
          title="Trust"
          verdict={trust.readinessVerdict}
          rationale={trust.verdictRationale}
          present={trust.signalsPresent}
          total={trust.signalsTotal}
          fields={[
            { label: "Verification", value: trust.verificationStatus },
            { label: "Forever verdict", value: trust.verdict },
            { label: "Market position", value: trust.marketPosition },
            { label: "Last inspection", value: trust.lastInspection },
          ]}
        />
      </div>

      {/* 3-5. Investment / Rental / Location summaries */}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SummaryCard
          title="Investment"
          verdict={investment.readinessVerdict}
          rationale={investment.verdictRationale}
          present={investment.signalsPresent}
          total={investment.signalsTotal}
          fields={[
            { label: "Entry price", value: investment.entryPrice },
            { label: "Price verification", value: investment.priceVerificationStatus },
            { label: "Rental evidence", value: investment.rentalEvidence },
          ]}
        />
        <SummaryCard
          title="Rental"
          verdict={rental.readinessVerdict}
          rationale={rental.verdictRationale}
          present={rental.signalsPresent}
          total={rental.signalsTotal}
          fields={[
            { label: "Demand context", value: rental.demandContext },
            { label: "Income evidence", value: rental.incomeEvidence },
            { label: "Guarantee evidence", value: rental.guaranteeEvidence },
          ]}
        />
        <SummaryCard
          title="Location"
          verdict={location.readinessVerdict}
          rationale={location.verdictRationale}
          present={location.signalsPresent}
          total={location.signalsTotal}
          fields={[
            { label: "Location identity", value: location.locationIdentity },
            { label: "Beach proximity", value: location.beachProximity },
            { label: "Lifestyle & amenities", value: location.lifestyleEvidence },
          ]}
        />
      </div>

      {/* 6. Overall Data Completeness */}
      <div className="mt-5 rounded-xl border border-[#EAE6DE] bg-[#F3EFE7] p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className={`text-xs uppercase tracking-wide ${muted}`}>Overall data completeness</h3>
          <span className="text-sm font-semibold text-[#17150F]">
            {dataCompleteness.signalsPresent}/{dataCompleteness.signalsTotal} (
            {dataCompleteness.percentComplete}%)
          </span>
        </div>
        <p className={`mt-1 text-xs ${muted}`}>
          Counts verified evidence signals present. A measure of data presence — not a quality
          score.
        </p>
        <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {dataCompleteness.byFoundation.map((row) => (
            <li key={row.key} className="flex items-center justify-between text-sm text-[#17150F]">
              <span>{row.label}</span>
              <span className={muted}>
                {row.signalsPresent}/{row.signalsTotal}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* 7. Combined Key Data Gaps */}
      <div className="mt-4">
        <h3 className={`text-xs uppercase tracking-wide ${muted}`}>Combined key data gaps</h3>
        {combinedGaps.totalGaps === 0 ? (
          <p className="mt-1 text-sm text-[#17150F]">No critical gaps identified.</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {combinedGaps.combined.map((gap) => (
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

      {/* 9. Evidence Coverage Summary */}
      <div className="mt-5 border-t border-[#EAE6DE] pt-4">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className={`text-xs uppercase tracking-wide ${muted}`}>Evidence coverage</h3>
          <span className={`text-xs ${muted}`}>
            {evidenceCoverage.foundationsReady}/{evidenceCoverage.foundationsTotal} foundations
            ready
          </span>
        </div>
        <ul className="mt-3 grid grid-cols-1 gap-2">
          {evidenceCoverage.foundations.map((row) => (
            <li
              key={row.key}
              className="flex flex-wrap items-center justify-between gap-1 text-sm text-[#17150F]"
            >
              <span>{row.label}</span>
              <span className={muted}>
                {row.readinessVerdict} · {row.signalsPresent}/{row.signalsTotal}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* 10. Passport Metadata */}
      <div className="mt-5 border-t border-[#EAE6DE] pt-4">
        <h3 className={`text-xs uppercase tracking-wide ${muted}`}>Passport metadata</h3>
        <dl className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Passport version" value={metadata.passportVersion} />
          <Field label="Schema version" value={metadata.schemaVersion} />
          <Field label="Generated at" value={metadata.generatedAt} />
          <Field label="Last inspection" value={metadata.lastInspection} />
          <Field label="Last price update" value={metadata.lastPriceUpdate} />
          <Field label="Aggregated foundations" value={metadata.foundationsConsumed.join(", ")} />
        </dl>
      </div>
    </section>
  );
}
