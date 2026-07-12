/**
 * Coralina Knowledge inspection page (RC5.0).
 *
 * Purely presentational: renders the serialisable
 * {@link CoralinaKnowledgeInspection} view-model produced by the vertical
 * slice. Shows every stage of the RC4.4→RC4.9 chain with full traceability,
 * and shows disputed, withheld, and missing information exactly as the
 * foundations judged it.
 */

import type { ReactNode } from "react";

import type { CoralinaKnowledgeInspection, CoralinaReadinessRow } from "../inspection";

const BADGE_TONES: Record<string, string> = {
  // consensus / standing
  corroborated: "bg-emerald-100 text-emerald-900",
  uncorroborated: "bg-amber-100 text-amber-900",
  unverified: "bg-amber-100 text-amber-900",
  contested: "bg-red-100 text-red-900",
  disputed: "bg-red-100 text-red-900",
  unaddressed: "bg-stone-200 text-stone-700",
  missing: "bg-stone-200 text-stone-700",
  // readiness
  ready: "bg-emerald-100 text-emerald-900",
  blocked: "bg-red-100 text-red-900",
  indeterminate: "bg-stone-200 text-stone-700",
  met: "bg-emerald-100 text-emerald-900",
  unmet: "bg-red-100 text-red-900",
  // admissibility / dispositions
  admissible: "bg-emerald-100 text-emerald-900",
  requires_review: "bg-red-100 text-red-900",
  inadmissible: "bg-red-100 text-red-900",
  advisory: "bg-amber-100 text-amber-900",
  informational: "bg-stone-200 text-stone-700",
  // chain stage health
  ok: "bg-emerald-100 text-emerald-900",
  issues: "bg-red-100 text-red-900",
};

function Badge({ value }: { value: string }) {
  const tone = BADGE_TONES[value] ?? "bg-stone-200 text-stone-700";
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${tone}`}
    >
      {value.replaceAll("_", " ")}
    </span>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="font-serif text-2xl text-[#17150F]">{title}</h2>
      {note ? <p className="mt-1 max-w-3xl text-sm text-stone-600">{note}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Table({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-stone-200 bg-stone-50 text-xs tracking-wide text-stone-500 uppercase">
            {headers.map((header) => (
              <th key={header} className="px-3 py-2 font-medium">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100 align-top text-[#17150F]">{children}</tbody>
      </table>
    </div>
  );
}

function ReadinessRows({ rows }: { rows: CoralinaReadinessRow[] }) {
  return (
    <>
      {rows.map((row) => (
        <tr key={row.id}>
          <td className="px-3 py-2 font-mono text-xs">{row.kind}</td>
          <td className="px-3 py-2 font-mono text-xs">{row.subject || "—"}</td>
          <td className="px-3 py-2">{row.necessity}</td>
          <td className="px-3 py-2">
            <Badge value={row.verdict} />
          </td>
          <td className="px-3 py-2 text-stone-600">{row.reason}</td>
        </tr>
      ))}
    </>
  );
}

export function CoralinaKnowledgePage({ inspection }: { inspection: CoralinaKnowledgeInspection }) {
  return (
    <div className="bg-[#F3EFE7] px-4 py-10 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <p className="text-xs font-medium tracking-widest text-stone-500 uppercase">
          Internal inspection — RC5.0 vertical slice
        </p>
        <h1 className="mt-2 font-serif text-4xl text-[#17150F]">
          {inspection.projectName} — Project Knowledge
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-stone-600">
          Real Coralina source data run end-to-end through the Forever foundations: Project Sources
          (RC4.4) → Extraction Facts (RC4.5) → Cross-Source Validation (RC4.7) → Canonical Record
          (RC4.6) → Knowledge Graph (RC4.8) → Readiness (RC4.9). Every value below traces back to a
          committed source artifact; missing and disputed information is shown, not filled in.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-stone-600">
          <span className="font-mono text-xs">{inspection.projectId}</span>
          <span>described {inspection.describedAt}</span>
          <span className="flex items-center gap-2">
            readiness: <Badge value={inspection.readiness.standing} />
          </span>
        </div>

        <Section title="Foundation chain">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {inspection.chain.map((stage) => (
              <div key={stage.rc} className="rounded-lg border border-stone-200 bg-white p-4">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-stone-500">{stage.rc}</span>
                  <Badge value={stage.ok ? "ok" : "issues"} />
                </div>
                <h3 className="mt-1 font-medium text-[#17150F]">{stage.title}</h3>
                <p className="mt-1 text-sm text-stone-600">{stage.summary}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section
          title="Registered sources (RC4.4)"
          note="The committed Coralina source artifacts this slice extracts from. No developer, country, legal, or construction source exists in the package — none is registered."
        >
          <Table
            headers={[
              "Source",
              "Type",
              "Format",
              "Version",
              "Authority",
              "Trust",
              "Status",
              "Document date",
            ]}
          >
            {inspection.sources.map((source) => (
              <tr key={source.id}>
                <td className="px-3 py-2">
                  <div className="font-medium">{source.name}</div>
                  <div className="font-mono text-xs text-stone-500">{source.id}</div>
                  {source.artifact ? (
                    <div className="mt-1 max-w-md font-mono text-[11px] break-all text-stone-400">
                      {source.artifact}
                    </div>
                  ) : null}
                </td>
                <td className="px-3 py-2">{source.documentType.replaceAll("_", " ")}</td>
                <td className="px-3 py-2">{source.fileFormat}</td>
                <td className="px-3 py-2 font-mono text-xs">{source.version}</td>
                <td className="px-3 py-2">{source.authorityKind.replaceAll("_", " ")}</td>
                <td className="px-3 py-2">{source.trust}</td>
                <td className="px-3 py-2">{source.status.replaceAll("_", " ")}</td>
                <td className="px-3 py-2 font-mono text-xs">{source.documentDate ?? "—"}</td>
              </tr>
            ))}
          </Table>
        </Section>

        <Section
          title="Canonical record (RC4.6)"
          note="Fields settled from facts that passed cross-source validation. Consensus and standing come from RC4.7/RC4.8; a field supported by two independent sources reads corroborated, a single-source field stays unverified."
        >
          <Table headers={["Field", "Value", "Confidence", "Consensus", "Standing", "Trace"]}>
            {inspection.fields.map((field) => (
              <tr key={field.path}>
                <td className="px-3 py-2">
                  <div className="font-mono text-xs">{field.path}</div>
                  <div className="text-xs text-stone-500">{field.section}</div>
                </td>
                <td className="max-w-xs px-3 py-2">{field.display}</td>
                <td className="px-3 py-2">{field.confidence}</td>
                <td className="px-3 py-2">
                  {field.consensus ? <Badge value={field.consensus} /> : "—"}
                </td>
                <td className="px-3 py-2">
                  {field.standing ? <Badge value={field.standing} /> : "—"}
                </td>
                <td className="px-3 py-2">
                  <div className="font-mono text-[11px] text-stone-500">{field.factId}</div>
                  <div className="font-mono text-[11px] text-stone-400">
                    {field.supportingSourceIds.join(", ")}
                  </div>
                  {field.locator ? (
                    <div className="text-[11px] text-stone-400">{field.locator}</div>
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
        </Section>

        <Section
          title="Disputed information"
          note="Sources genuinely disagree here. Both statements are preserved verbatim and the subject is withheld from the canonical record — nothing is resolved silently."
        >
          {inspection.disputes.length === 0 ? (
            <p className="text-sm text-stone-600">No disputed subjects.</p>
          ) : (
            <div className="space-y-3">
              {inspection.disputes.map((dispute) => (
                <div
                  key={dispute.subjectKey}
                  className="rounded-lg border border-red-200 bg-white p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge value="contested" />
                    <span className="font-mono text-xs">{dispute.fieldPath}</span>
                  </div>
                  <ul className="mt-3 space-y-2 text-sm">
                    {dispute.claims.map((claim) => (
                      <li key={claim.factId} className="rounded bg-stone-50 p-2">
                        <div>{claim.display}</div>
                        <div className="mt-1 font-mono text-[11px] text-stone-500">
                          {claim.factId} · {claim.sourceId}
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2 font-mono text-[11px] text-stone-400">
                    findings: {dispute.findingIds.join(", ")}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section
          title="Missing information"
          note="Fields Coralina's committed sources genuinely do not state. Each is declared to RC4.7 and reported as an explicit missing_information finding — never given a placeholder value."
        >
          <Table headers={["Field path", "Why it is missing", "Finding"]}>
            {inspection.missing.map((row) => (
              <tr key={row.path}>
                <td className="px-3 py-2 font-mono text-xs">{row.path}</td>
                <td className="max-w-lg px-3 py-2 text-stone-600">{row.reason}</td>
                <td className="px-3 py-2 font-mono text-[11px] text-stone-500">
                  {row.findingIds.join(", ") || "—"}
                </td>
              </tr>
            ))}
          </Table>
        </Section>

        <Section
          title="Extraction facts (RC4.5)"
          note="Every fact stated by this slice, verbatim from committed data, with its source, locator, confidence, and the admissibility RC4.7 assigned it."
        >
          <Table headers={["Fact", "Field path", "Value", "Confidence", "Source", "Admissibility"]}>
            {inspection.facts.map((fact) => (
              <tr key={fact.id}>
                <td className="px-3 py-2">
                  <div className="font-mono text-[11px]">{fact.id}</div>
                  <div className="text-xs text-stone-500">{fact.factType.replaceAll("_", " ")}</div>
                </td>
                <td className="px-3 py-2 font-mono text-xs">{fact.fieldPath}</td>
                <td className="max-w-xs px-3 py-2">{fact.display}</td>
                <td className="px-3 py-2">{fact.confidence}</td>
                <td className="px-3 py-2">
                  <div className="font-mono text-[11px] text-stone-500">{fact.sourceId}</div>
                  {fact.locator ? (
                    <div className="text-[11px] text-stone-400">{fact.locator}</div>
                  ) : null}
                </td>
                <td className="px-3 py-2">
                  <Badge value={fact.admissibility} />
                </td>
              </tr>
            ))}
          </Table>
          {inspection.withheld.length > 0 ? (
            <p className="mt-3 text-sm text-stone-600">
              Withheld from the canonical record ({inspection.withheld.length} facts):{" "}
              {[...new Set(inspection.withheld.map((row) => row.fieldPath ?? row.factId))].join(
                ", ",
              )}{" "}
              (pending review of the findings above).
            </p>
          ) : null}
        </Section>

        <Section
          title="Validation findings (RC4.7)"
          note="Everything cross-source validation observed — agreements, single-source subjects, disputes, and missing information."
        >
          <Table headers={["Finding", "Kind", "Disposition", "Path", "Message"]}>
            {inspection.findings.map((finding) => (
              <tr key={finding.id}>
                <td className="px-3 py-2 font-mono text-[11px]">{finding.id}</td>
                <td className="px-3 py-2">{finding.kind.replaceAll("_", " ")}</td>
                <td className="px-3 py-2">
                  <Badge value={finding.disposition} />
                </td>
                <td className="px-3 py-2 font-mono text-xs">{finding.path ?? "—"}</td>
                <td className="max-w-md px-3 py-2 text-stone-600">{finding.message}</td>
              </tr>
            ))}
          </Table>
        </Section>

        <Section
          title="Knowledge graph (RC4.8)"
          note="The graph links project, sources, facts, claims, fields, revisions, findings, and declared entities. Claims that require review are the disputed ones."
        >
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ["nodes", inspection.graph.nodeCount],
              ["edges", inspection.graph.edgeCount],
              ["facts", inspection.graph.factCount],
              ["sources", inspection.graph.sourceCount],
              ["claims", inspection.graph.claimCount],
              ["unresolved", inspection.graph.unresolvedCount],
            ].map(([label, count]) => (
              <div
                key={String(label)}
                className="rounded-lg border border-stone-200 bg-white p-4 text-center"
              >
                <div className="text-2xl font-semibold text-[#17150F]">{count}</div>
                <div className="text-xs tracking-wide text-stone-500 uppercase">{label}</div>
              </div>
            ))}
          </div>
          {inspection.graph.reviewClaims.length > 0 ? (
            <div className="mt-3 text-sm text-stone-600">
              Claims requiring review:{" "}
              {inspection.graph.reviewClaims.map((claim) => (
                <span key={claim.key} className="mr-2 inline-flex items-center gap-1">
                  <span className="font-mono text-xs">{claim.key}</span>
                  {claim.standing ? <Badge value={claim.standing} /> : null}
                </span>
              ))}
            </div>
          ) : null}
          <div className="mt-2 font-mono text-[11px] text-stone-400">{inspection.graph.id}</div>
        </Section>

        <Section
          title="Readiness (RC4.9)"
          note={`Judged against the caller-stated profile "${inspection.readiness.profileName}". The blockers below are the same two blockers the committed manifest records as SOURCE_PENDING.`}
        >
          <div className="mb-3 flex items-center gap-2 text-sm">
            <span>Standing:</span>
            <Badge value={inspection.readiness.standing} />
            <span className="text-stone-500">
              {inspection.readiness.blockers.length} blocker(s),{" "}
              {inspection.readiness.advisories.length} advisories
            </span>
          </div>
          <Table headers={["Requirement", "Subject", "Necessity", "Verdict", "Reason"]}>
            <ReadinessRows rows={inspection.readiness.evaluations} />
          </Table>
        </Section>

        <p className="mt-10 max-w-3xl text-xs text-stone-500">
          This page is a deterministic inspection of committed repository data
          (forever-data/projects/coralina). It performs no network calls, reads no database, and
          fabricates no values: facts absent from the sources appear under "Missing information",
          and conflicting statements appear under "Disputed information" unresolved.
        </p>
      </div>
    </div>
  );
}
