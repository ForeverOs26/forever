import type { AdvisoryRisk, RiskScope, RiskSeverity } from "../types";

/**
 * RiskPanel — surfaces up to three important risks. If more than three are
 * supplied, only the first three are rendered to honour the RC1 contract.
 * Severity is communicated through label + border weight + tonal restraint,
 * never through a new brand accent.
 */
export interface RiskPanelProps {
  risks: AdvisoryRisk[];
  headingId?: string;
}

const SEVERITY_LABEL: Record<RiskSeverity, string> = {
  info: "Info",
  attention: "Attention",
  critical: "Critical",
};

/** Border weight rises with severity; colour stays within the frozen palette. */
const SEVERITY_BORDER: Record<RiskSeverity, string> = {
  info: "border-l-2 border-l-[#EAE6DE]",
  attention: "border-l-2 border-l-[#9C7B4C]",
  critical: "border-l-4 border-l-[#9C7B4C]",
};

/** Simple inline glyphs — no icon dependency, decorative only. */
const SEVERITY_GLYPH: Record<RiskSeverity, string> = {
  info: "•",
  attention: "▲",
  critical: "◆",
};

const SCOPE_LABEL: Record<RiskScope, string> = {
  client: "Client",
  project: "Project",
  data: "Data",
};

function RiskRow({ risk }: { risk: AdvisoryRisk }) {
  return (
    <li
      className={`rounded-xl border border-[#EAE6DE] bg-white p-4 ${SEVERITY_BORDER[risk.severity]}`}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-[#17150F]">
          <span aria-hidden="true" className="mr-2 text-[#9C7B4C]">
            {SEVERITY_GLYPH[risk.severity]}
          </span>
          {risk.title}
        </h3>
        <span className="shrink-0 rounded-full bg-[#F3EFE7] px-2 py-0.5 text-xs text-[#9A958A]">
          {SEVERITY_LABEL[risk.severity]}
        </span>
      </div>
      <p className="mt-2 text-sm text-[#17150F]">{risk.explanation}</p>
      <p className="mt-2 text-xs uppercase tracking-wide text-[#9A958A]">
        Scope: {SCOPE_LABEL[risk.scope]}
      </p>
    </li>
  );
}

export function RiskPanel({ risks, headingId = "advisory-risks-heading" }: RiskPanelProps) {
  const visible = risks.slice(0, 3);

  return (
    <section aria-labelledby={headingId}>
      <h2
        id={headingId}
        className="mb-4 font-serif text-lg text-[#17150F] sm:text-xl"
        style={{ fontFamily: '"Newsreader", Georgia, serif' }}
      >
        Risk Panel
      </h2>
      {visible.length === 0 ? (
        <p className="text-sm text-[#9A958A]">No risks flagged.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((risk) => (
            <RiskRow key={risk.id} risk={risk} />
          ))}
        </ul>
      )}
    </section>
  );
}
