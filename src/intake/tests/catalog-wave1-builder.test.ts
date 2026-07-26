/**
 * Focused coverage for the Catalogue 10 payload builder
 * (`scripts/catalog/build-wave1-payloads.mjs`).
 *
 * The builder is the only executable this work adds, and until now its
 * determinism, source-pinning and no-invention guarantees were checked only by
 * a human running it with Owner source documents present — which no CI can do.
 *
 * These tests are therefore split in two:
 *
 *  - **Source-free** (the large majority). Pure helpers, the source-selection
 *    policy driven by synthetic candidates, and assertions over the payload
 *    bytes committed to this repository. These run anywhere.
 *  - **Source-gated**. End-to-end determinism and `--only` isolation genuinely
 *    need the pinned documents. They skip when `FOREVER_CATALOG_SOURCE_ROOTS`
 *    is unset, and are exercised for real when it is.
 *
 * The builder is imported through a runtime `pathToFileURL` specifier, matching
 * how the rest of the suite reaches `.mjs` files, and runs its build only when
 * invoked as an entry point — so importing it here emits nothing.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const BUILDER_REL = "scripts/catalog/build-wave1-payloads.mjs";
const BUILDER_ABS = resolve(process.cwd(), BUILDER_REL);

interface PinnedSource {
  citation: string;
  sha256: string;
  bytes: number;
  strictPin?: boolean;
}
interface Candidate {
  path: string;
  bytes: number;
  sha256: string;
  mtime: number;
}
interface MaterialClaim {
  id: string;
  why: string;
  contiguous?: string;
  occurrences?: number;
  ordered?: string[];
  withinChars?: number;
  absent?: string;
}
interface WarningRow {
  code: string;
  [key: string]: unknown;
}
interface Payload {
  mode: string;
  schema_version: string;
  project: { publish: boolean; [key: string]: unknown };
  units?: unknown[];
  prices?: unknown[];
  buildings?: unknown[];
  media?: unknown[];
  documents?: unknown[];
  warnings?: WarningRow[];
  batch_fingerprint: string;
}
interface Builder {
  assertMaterialClaims: (label: string, text: string, claims: MaterialClaim[]) => number;
  assertTranscribedFacts: (label: string, text: string, phrases: string[]) => number;
  auditDeckOnly: (slug: string, payload: unknown) => void;
  auditDraftOnly: (slug: string, payload: unknown) => void;
  auditLayanPhase1: (payload: unknown) => void;
  auditNoDuplicateUnits: (slug: string, payload: unknown) => void;
  auditSourceRefPagesWithinBounds: (
    slug: string,
    payload: unknown,
    countPages?: (citation: string) => number | null,
  ) => number;
  auditWarningCodesUnique: (slug: string, payload: unknown) => number;
  BUILDERS: Record<string, unknown>;
  collectSourcePageRefs: (value: unknown) => { citation: string; page: number; via: string }[];
  fingerprintBatch: (batch: unknown) => string;
  LAYAN_PHASE1_PRICE_BANDS: { type_label: string; size_text: string }[];
  LAYAN_PHASE1_GUIDE_MATERIAL_CLAIMS: MaterialClaim[];
  LAYAN_PHASE1_PRICE_MATERIAL_CLAIMS: MaterialClaim[];
  maskOpaqueIdentifiers: (key: string, value: unknown) => unknown;
  normalizeExtractedText: (text: string) => string;
  provenance: (ref: string, options?: Record<string, unknown>) => Record<string, unknown>;
  selectPinnedCandidate: (
    source: PinnedSource,
    candidates: Candidate[],
  ) => { selected: PinnedSource & { path: string }; notice: Record<string, unknown> | null };
  SOURCES: Record<string, PinnedSource>;
  stableStringify: (value: unknown) => string;
}

const builder = (await import(pathToFileURL(BUILDER_ABS).href)) as unknown as Builder;

const PROJECT_SLUGS = [
  "rainpalm-villas",
  "garden-of-eden",
  "the-title-sierra",
  "layan-green-park",
  "ayana-heights-seaview-residence",
] as const;

function committedPayload(slug: string): Payload {
  return JSON.parse(
    readFileSync(join("forever-data", "projects", slug, "progressive", "payload.json"), "utf8"),
  ) as Payload;
}

const SOURCES_CONFIGURED = Boolean(
  process.env.FOREVER_CATALOG_SOURCE_ROOTS ?? process.env.FOREVER_WAVE1_SOURCE_ROOTS,
);

function runBuilder(args: string[]): string {
  return execFileSync(process.execPath, [BUILDER_REL, ...args], {
    encoding: "utf8",
    timeout: 600_000,
  });
}

// ---------------------------------------------------------------------------

describe("normalizeExtractedText", () => {
  const { normalizeExtractedText } = builder;

  it("folds thin, narrow and non-breaking spaces to an ordinary space", () => {
    expect(normalizeExtractedText("9 940 m²")).toBe("9 940 m²");
    expect(normalizeExtractedText("30 m²")).toBe("30 m²");
  });

  it("collapses runs of whitespace and trims", () => {
    expect(normalizeExtractedText("  a \n\n  b \t c  ")).toBe("a b c");
  });

  it("preserves Unicode punctuation rather than folding it to ASCII lookalikes", () => {
    // A source that prints a typographic apostrophe or em dash must not match a
    // transcription that used ASCII: the characters are the evidence.
    expect(normalizeExtractedText("island’s")).toBe("island’s");
    expect(normalizeExtractedText("island’s")).not.toBe("island's");
    expect(normalizeExtractedText("Building A — Mangosteen")).toContain("—");
    expect(normalizeExtractedText("Building A — Mangosteen")).not.toContain(" - ");
  });

  it("preserves a decimal comma and does not normalise it to a decimal point", () => {
    // The duplex band prints "120,9" and the page-2 FX rate prints "31,25".
    // Folding either to a point would silently invent a different number.
    expect(normalizeExtractedText("from 120,9 м2")).toBe("from 120,9 м2");
    expect(normalizeExtractedText("1 USD = 31,25 THB")).toBe("1 USD = 31,25 THB");
    expect(normalizeExtractedText("1 USD = 31,25 THB")).not.toContain("31.25");
  });

  it("preserves Cyrillic characters", () => {
    expect(normalizeExtractedText("120,9 м2")).toContain("м");
  });
});

describe("assertTranscribedFacts", () => {
  const { assertTranscribedFacts } = builder;

  it("accepts phrases present in the extracted text", () => {
    expect(assertTranscribedFacts("doc", "alpha beta gamma", ["alpha", "beta gamma"])).toBe(2);
  });

  it("throws when a transcribed phrase has left the document", () => {
    expect(() => assertTranscribedFacts("doc", "alpha beta", ["gamma"])).toThrow(
      /source_text_missing/,
    );
  });

  it("cannot be satisfied by a phrase that only appears inside a digest", () => {
    // A fact assertion is made against the pinned document's text. Payload
    // content — including a digest that happens to contain the characters — is
    // not evidence and must never stand in for the document.
    const digest = "b01ef1e39b9a0c6558230db7d8e7f34caee16c779f8966e8dec2a70c14a19dd4";
    const payloadJson = JSON.stringify({ sha256: digest });
    expect(payloadJson).toContain("e16c");
    const documentText = "Layan Green Park project guide. Two construction phases.";
    expect(() => assertTranscribedFacts("guide", documentText, ["e16c"])).toThrow(
      /source_text_missing/,
    );
  });

  it("cannot be satisfied by a phrase that only appears inside an audit note", () => {
    const warningNote =
      "The superseded 377-unit total was removed and is recorded here deliberately.";
    const documentText = "Phase 1 248 apartments. Phase 2 296 apartments.";
    expect(warningNote).toContain("377");
    expect(() => assertTranscribedFacts("guide", documentText, ["377-unit total"])).toThrow(
      /source_text_missing/,
    );
  });
});

describe("assertMaterialClaims", () => {
  const { assertMaterialClaims } = builder;
  const why = "test claim";

  it("accepts a contiguous phrase", () => {
    expect(
      assertMaterialClaims("doc", "Phase 1 248 apartments", [
        { id: "c", contiguous: "Phase 1 248", why },
      ]),
    ).toBe(1);
  });

  it("rejects a claim whose parts are present but no longer contiguous", () => {
    // This is the whole point of the stronger guard: a substring test over the
    // document would pass here, because both "Phase 1" and "248" still occur.
    const text = "Phase 1 buildings 4. Elsewhere the file mentions 248.";
    expect(() =>
      assertMaterialClaims("doc", text, [{ id: "c", contiguous: "Phase 1 248", why }]),
    ).toThrow(/material_claim_broken/);
  });

  it("enforces an exact occurrence count when the count is the evidence", () => {
    const four = "phuket | thailand ".repeat(4);
    expect(
      assertMaterialClaims("doc", four, [
        { id: "c", contiguous: "phuket | thailand", occurrences: 4, why },
      ]),
    ).toBe(1);
    expect(() =>
      assertMaterialClaims("doc", "phuket | thailand", [
        { id: "c", contiguous: "phuket | thailand", occurrences: 4, why },
      ]),
    ).toThrow(/material_claim_broken/);
  });

  it("accepts ordered parts within the stated character bound", () => {
    expect(
      assertMaterialClaims("doc", "Construction completed 6 4 in 2024", [
        { id: "c", ordered: ["Construction completed", "in 2024"], withinChars: 8, why },
      ]),
    ).toBe(1);
  });

  it("rejects ordered parts that drift beyond the bound", () => {
    const drifted = `Construction completed ${"x".repeat(40)} in 2024`;
    expect(() =>
      assertMaterialClaims("doc", drifted, [
        { id: "c", ordered: ["Construction completed", "in 2024"], withinChars: 8, why },
      ]),
    ).toThrow(/material_claim_broken/);
  });

  it("rejects ordered parts that appear in the wrong order", () => {
    expect(() =>
      assertMaterialClaims("doc", "in 2024 Construction completed", [
        { id: "c", ordered: ["Construction completed", "in 2024"], withinChars: 8, why },
      ]),
    ).toThrow(/material_claim_broken/);
  });

  it("enforces an absence claim", () => {
    expect(
      assertMaterialClaims("doc", "Studios from 30.3 m2", [{ id: "c", absent: "Phase", why }]),
    ).toBe(1);
    expect(() =>
      assertMaterialClaims("doc", "Phase 2 Studios", [{ id: "c", absent: "Phase", why }]),
    ).toThrow(/material_claim_broken/);
  });

  it("covers every material Layan claim the audit named", () => {
    const ids = [
      ...builder.LAYAN_PHASE1_GUIDE_MATERIAL_CLAIMS,
      ...builder.LAYAN_PHASE1_PRICE_MATERIAL_CLAIMS,
    ].map((claim) => claim.id);
    for (const required of [
      "two_construction_phases",
      "phase_1_apartments_248",
      "phase_1_buildings_4_with_phase_2_buildings_6",
      "phase_1_completion_2024",
      "location_bang_tao",
      "country_thailand",
      "phase_2_size_range_stated_not_ingested",
      "price_list_states_no_phase_en",
    ]) {
      expect(ids).toContain(required);
    }
    // Every one of the five type-level bands is asserted as a whole row.
    for (const band of builder.LAYAN_PHASE1_PRICE_BANDS) {
      const id = `price_band_row_${band.type_label.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
      expect(ids).toContain(id);
    }
    // The duplex SOLD state is carried by its band row's interleaved evidence.
    const duplex = builder.LAYAN_PHASE1_PRICE_MATERIAL_CLAIMS.find(
      (claim) => claim.id === "price_band_row_duplexes",
    );
    expect(duplex?.contiguous).toContain("fSroOmLD");
    // Every claim explains itself, so a future failure is actionable.
    for (const claim of [
      ...builder.LAYAN_PHASE1_GUIDE_MATERIAL_CLAIMS,
      ...builder.LAYAN_PHASE1_PRICE_MATERIAL_CLAIMS,
    ]) {
      expect(claim.why.length).toBeGreaterThan(20);
    }
  });
});

describe("maskOpaqueIdentifiers", () => {
  const { maskOpaqueIdentifiers } = builder;
  const realDigest = "b01ef1e39b9a0c6558230db7d8e7f34caee16c779f8966e8dec2a70c14a19dd4";

  it("masks a real SHA-256 held under an identifier field name", () => {
    expect(maskOpaqueIdentifiers("sha256", realDigest)).toBe("[opaque-identifier]");
    expect(maskOpaqueIdentifiers("pinned_sha256", realDigest)).toBe("[opaque-identifier]");
    expect(maskOpaqueIdentifiers("drive_file_id", "1S121eHy6YuHnhXcr3Xco5VTy65TWr2bR")).toBe(
      "[opaque-identifier]",
    );
  });

  it("leaves ordinary project text visible however long it is", () => {
    // The previous shape-based rule masked any 25–45 character word-ish token,
    // which hid ordinary warning codes from the superseded-claim scan.
    for (const code of [
      "construction_status_phase_dependent",
      "price_band_phase_scope_derived",
      "investment_projections_not_prices",
    ]) {
      expect(maskOpaqueIdentifiers("code", code)).toBe(code);
      expect(code.length).toBeGreaterThanOrEqual(25);
      expect(code.length).toBeLessThanOrEqual(45);
    }
    expect(maskOpaqueIdentifiers("message", "Bang Tao, the island’s most prestigious area")).toBe(
      "Bang Tao, the island’s most prestigious area",
    );
  });

  it("leaves ordinary numeric values visible", () => {
    expect(maskOpaqueIdentifiers("bytes", 25417328)).toBe(25417328);
    expect(maskOpaqueIdentifiers("apartments", 248)).toBe(248);
    expect(maskOpaqueIdentifiers("size_from_sqm", 120.9)).toBe(120.9);
    // A digest-shaped value under a non-identifier key stays visible too:
    // masking is decided by field name, never by value shape.
    expect(maskOpaqueIdentifiers("message", realDigest)).toBe(realDigest);
  });

  it("lets the superseded-claim scan see a claim carried in a long warning code", () => {
    // Regression for the blind spot the audit found: a 25–45 character code was
    // invisible to the scan, so a superseded claim could ride through inside one.
    const payload = {
      project: { publish: false },
      warnings: [
        { code: "completion_quarter_Q1-2026_stale", severity: "info" },
        { code: "price_bands_type_level_only", payload: { bands: [{ type_label: "Studios" }] } },
      ],
    };
    const scanned = JSON.stringify(payload.warnings, maskOpaqueIdentifiers);
    expect(scanned).toContain("Q1-2026");
  });
});

describe("selectPinnedCandidate", () => {
  const { selectPinnedCandidate } = builder;
  const strict: PinnedSource = {
    citation: "Layan Green Park price list.pdf",
    sha256: "a".repeat(64),
    bytes: 100,
    strictPin: true,
  };
  const soft: PinnedSource = {
    citation: "GARDEN OF EDEN - eng.pdf",
    sha256: "a".repeat(64),
    bytes: 100,
  };
  const good: Candidate = { path: "/phase-1/x.pdf", bytes: 100, sha256: "a".repeat(64), mtime: 1 };
  const wrong: Candidate = { path: "/phase-2/x.pdf", bytes: 100, sha256: "b".repeat(64), mtime: 9 };

  it("selects the copy matching the pinned digest and byte length", () => {
    const { selected, notice } = selectPinnedCandidate(strict, [good]);
    expect(selected.path).toBe("/phase-1/x.pdf");
    expect(notice).toBeNull();
  });

  it("refuses a strictly pinned source when no copy matches the digest", () => {
    expect(() => selectPinnedCandidate(strict, [wrong])).toThrow(/source_pin_mismatch/);
  });

  it("refuses a same-filename Phase 1 / Phase 2 collision rather than substituting", () => {
    // Both Layan phase folders hold a file with this exact name; only the digest
    // separates them. A newest-mtime fallback would quietly put Phase 2 content
    // into a Phase 1 record, so the strict pin must refuse instead.
    const phase2Newer: Candidate = {
      path: "/PHASE 2/Layan Green Park price list.pdf",
      bytes: 6798516,
      sha256: "c".repeat(64),
      mtime: 9_999_999,
    };
    expect(() => selectPinnedCandidate(strict, [phase2Newer])).toThrow(/source_pin_mismatch/);
    expect(() => selectPinnedCandidate(strict, [phase2Newer])).toThrow(/refuses to substitute/);
  });

  it("throws when the source is missing entirely", () => {
    expect(() => selectPinnedCandidate(strict, [])).toThrow(/source_unreadable/);
    expect(() => selectPinnedCandidate(soft, [])).toThrow(/source_unreadable/);
  });

  it("is order-independent when duplicate correct candidates exist in several roots", () => {
    const copyA: Candidate = { ...good, path: "/root-a/x.pdf", mtime: 1 };
    const copyB: Candidate = { ...good, path: "/root-b/x.pdf", mtime: 500 };
    // Whichever order the roots are walked in, a digest match wins over mtime.
    expect(selectPinnedCandidate(strict, [copyA, copyB]).selected.path).toBe("/root-a/x.pdf");
    expect(selectPinnedCandidate(strict, [copyB, copyA]).selected.path).toBe("/root-b/x.pdf");
    // And a wrong-bytes copy never wins, whichever side it is on.
    expect(selectPinnedCandidate(strict, [wrong, copyA]).selected.path).toBe("/root-a/x.pdf");
    expect(selectPinnedCandidate(strict, [copyA, wrong]).selected.path).toBe("/root-a/x.pdf");
  });

  it("emits a drift notice, never a silent substitution, for a non-strict source", () => {
    const { selected, notice } = selectPinnedCandidate(soft, [wrong]);
    expect(selected.sha256).toBe("b".repeat(64));
    expect(notice).toMatchObject({
      code: "source_version_changed",
      file: "GARDEN OF EDEN - eng.pdf",
      selected_sha256: "b".repeat(64),
    });
  });
});

describe("collectSourcePageRefs and page-bound auditing", () => {
  const { auditSourceRefPagesWithinBounds, collectSourcePageRefs } = builder;
  const threePages = () => 3;

  it("finds both the #page= suffix form and the source_file/source_page pair", () => {
    const refs = collectSourcePageRefs({
      warnings: [{ payload: { source_ref: "doc.pdf#page=2" } }],
      prices: [{ source_file: "doc.pdf", source_page: 1 }],
      nested: { deep: [{ sourceFile: "doc.pdf", sourcePage: 3 }] },
    });
    expect(refs.map((r) => r.page).sort()).toEqual([1, 2, 3]);
    expect(refs.every((r) => r.citation === "doc.pdf")).toBe(true);
  });

  it("accepts citations inside the document's real page count", () => {
    const payload = { warnings: [{ payload: { source_ref: "doc.pdf#page=3" } }] };
    expect(auditSourceRefPagesWithinBounds("slug", payload, threePages)).toBe(1);
  });

  it("rejects a citation past the end of the document", () => {
    // The exact defect the audit found: page 4 of a 3-page price list, repeated
    // across every price row.
    const payload = { prices: [{ source_file: "doc.pdf", source_page: 4 }] };
    expect(() => auditSourceRefPagesWithinBounds("slug", payload, threePages)).toThrow(
      /source_ref_page_out_of_bounds/,
    );
  });

  it("rejects a non-positive page number", () => {
    const payload = { prices: [{ source_file: "doc.pdf", source_page: 0 }] };
    expect(() => auditSourceRefPagesWithinBounds("slug", payload, threePages)).toThrow(
      /source_ref_page_out_of_bounds/,
    );
  });

  it("skips citations it cannot bound rather than inventing a limit", () => {
    const payload = { warnings: [{ payload: { source_ref: "unknown.pdf#page=99" } }] };
    expect(auditSourceRefPagesWithinBounds("slug", payload, () => null)).toBe(0);
  });
});

describe("audit guards", () => {
  const { auditDeckOnly, auditDraftOnly, auditNoDuplicateUnits, auditWarningCodesUnique } = builder;

  it("refuses a payload that is not an unpublished draft", () => {
    expect(() => auditDraftOnly("slug", { mode: "create", project: { publish: true } })).toThrow(
      /draft_violation/,
    );
    expect(() => auditDraftOnly("slug", { mode: "update", project: { publish: false } })).toThrow(
      /draft_violation/,
    );
  });

  it("refuses duplicate unit codes", () => {
    expect(() =>
      auditNoDuplicateUnits("slug", { units: [{ unit_code: "A1" }, { unit_code: "A1" }] }),
    ).toThrow(/duplicate_unit_code/);
  });

  it("refuses duplicate warning codes", () => {
    expect(() =>
      auditWarningCodesUnique("slug", { warnings: [{ code: "x" }, { code: "x" }] }),
    ).toThrow(/duplicate_warning_code/);
    expect(auditWarningCodesUnique("slug", { warnings: [{ code: "x" }, { code: "y" }] })).toBe(2);
  });

  it("refuses an invented unit row on a deck-derived record", () => {
    const base = {
      warnings: [
        { code: "building_inventory_missing" },
        { code: "unit_inventory_missing" },
        { code: "price_list_missing" },
        { code: "investment_projections_not_prices" },
      ],
    };
    expect(() => auditDeckOnly("slug", { ...base, units: [{ unit_code: "1" }] })).toThrow(
      /deck_record_violation/,
    );
  });

  it("refuses an invented price row on a deck-derived record", () => {
    const base = {
      warnings: [
        { code: "building_inventory_missing" },
        { code: "unit_inventory_missing" },
        { code: "price_list_missing" },
        { code: "investment_projections_not_prices" },
      ],
    };
    expect(() => auditDeckOnly("slug", { ...base, prices: [{ price: 1 }] })).toThrow(
      /deck_record_violation/,
    );
  });
});

describe("provenance date handling", () => {
  const { provenance } = builder;

  it("records a stated date when the document really states one", () => {
    expect(provenance("doc.pdf#page=1", { sourceDate: "2026-07-01" })).toMatchObject({
      source_date: "2026-07-01",
    });
  });

  it("records an explicit undated form rather than borrowing an unrelated date", () => {
    const result = provenance("doc.pdf#page=1", { undatedBySource: "the document states no date" });
    expect(result.source_date).toBeUndefined();
    expect(result.reasoning).toMatchObject({ source_date: "undated_by_source" });
  });

  it("refuses to be both dated and undated", () => {
    expect(() =>
      provenance("doc.pdf#page=1", { sourceDate: "2026-07-01", undatedBySource: "x" }),
    ).toThrow(/provenance_date_conflict/);
  });
});

describe("deterministic serialisation and fingerprinting", () => {
  const { fingerprintBatch, stableStringify } = builder;

  it("stableStringify is invariant to key insertion order", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(
      stableStringify({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });

  it("fingerprintBatch is invariant to key insertion order but sensitive to values", () => {
    const one = fingerprintBatch({ mode: "create", project: { slug: "x", publish: false } });
    const two = fingerprintBatch({ project: { publish: false, slug: "x" }, mode: "create" });
    expect(one).toBe(two);
    expect(fingerprintBatch({ mode: "create", project: { slug: "y" } })).not.toBe(one);
  });
});

describe("committed Catalogue 10 payloads", () => {
  it.each(PROJECT_SLUGS)("%s is a valid unpublished draft", (slug) => {
    const payload = committedPayload(slug);
    expect(payload.schema_version).toBe("1");
    expect(payload.mode).toBe("create");
    expect(payload.project.publish).toBe(false);
  });

  it.each(PROJECT_SLUGS)("%s reproduces its declared batch fingerprint", (slug) => {
    const payload = committedPayload(slug);
    const { batch_fingerprint: declared, ...body } = payload;
    expect(builder.fingerprintBatch(body)).toBe(declared);
  });

  it.each(PROJECT_SLUGS)("%s has no duplicate warning code", (slug) => {
    const payload = committedPayload(slug);
    expect(builder.auditWarningCodesUnique(slug, payload)).toBe((payload.warnings ?? []).length);
  });

  it.each(PROJECT_SLUGS)("%s cites no page past the end of its source", (slug) => {
    // Bounded here against the page counts measured from the pinned PDFs. The
    // build re-measures them from the documents themselves on every run.
    const pageCounts: Record<string, number> = {
      "SIB - Price List V.1. - Updated 15.05.2026.pdf": 3,
      "Layan Green Park price list.pdf": 2,
      "Layan Green Park project guide.pdf": 1,
    };
    const payload = committedPayload(slug);
    expect(() =>
      builder.auditSourceRefPagesWithinBounds(slug, payload, (citation) =>
        citation in pageCounts ? pageCounts[citation] : null,
      ),
    ).not.toThrow();
  });

  it("Sierra cites page 3 for its currency evidence, never a fourth page", () => {
    const raw = readFileSync(
      join("forever-data", "projects", "the-title-sierra", "progressive", "payload.json"),
      "utf8",
    );
    expect(raw).not.toContain("#page=4");
    expect(raw).not.toContain('"sourcePage": 4');
    expect(raw).toContain('"sourcePage": 3');
  });

  it("invents no unit or price row where the source carries no identifier", () => {
    for (const slug of ["layan-green-park", "ayana-heights-seaview-residence", "garden-of-eden"]) {
      const payload = committedPayload(slug);
      expect(payload.units ?? []).toHaveLength(0);
      expect(payload.prices ?? []).toHaveLength(0);
      expect(payload.buildings ?? []).toHaveLength(0);
    }
    // Rainpalm keeps its source-backed units but withdraws its prices until the
    // Owner selects a price-list version.
    const rainpalm = committedPayload("rainpalm-villas");
    expect(rainpalm.units ?? []).toHaveLength(21);
    expect(rainpalm.prices ?? []).toHaveLength(0);
  });

  it("carries no media or document row anywhere, since none has evidence", () => {
    for (const slug of PROJECT_SLUGS) {
      const payload = committedPayload(slug);
      expect(payload.media ?? []).toHaveLength(0);
      expect(payload.documents ?? []).toHaveLength(0);
    }
  });

  it("passes the Layan Phase 1 guard, including the superseded-claim scan", () => {
    expect(() => builder.auditLayanPhase1(committedPayload("layan-green-park"))).not.toThrow();
  });

  it("passes the deck-only guard for AYANA", () => {
    expect(() =>
      builder.auditDeckOnly(
        "ayana-heights-seaview-residence",
        committedPayload("ayana-heights-seaview-residence"),
      ),
    ).not.toThrow();
  });

  it("records the Layan descriptive fields as undated by their source", () => {
    const payload = committedPayload("layan-green-park");
    const provenanceMap = payload.project.field_provenance as Record<
      string,
      { source_date?: string; reasoning?: { source_date?: string } }
    >;
    for (const field of ["name", "location_name_raw", "location_area", "project_type"]) {
      expect(provenanceMap[field].source_date).toBeUndefined();
      expect(provenanceMap[field].reasoning?.source_date).toBe("undated_by_source");
    }
  });

  it("keeps the second Layan date classified as the price-validity statement it is", () => {
    const payload = committedPayload("layan-green-park");
    const warning = (payload.warnings ?? []).find((w) => w.code === "source_date_recorded");
    const detail = warning?.payload as {
      secondary_stated_validity_date?: { kind?: string; relationship_to_source_date?: string };
      floor_plan_page_internal_date?: string;
    };
    expect(detail.floor_plan_page_internal_date).toBeUndefined();
    expect(detail.secondary_stated_validity_date?.kind).toBe("price_validity_statement");
    expect(detail.secondary_stated_validity_date?.relationship_to_source_date).toBe("unresolved");
  });

  it("reports the Layan FX counts separately instead of collapsing them", () => {
    const payload = committedPayload("layan-green-park");
    const warning = (payload.warnings ?? []).find((w) => w.code === "price_fx_inconsistent");
    const counts = (warning?.payload as { rate_counts: Record<string, number> }).rate_counts;
    expect(counts).toMatchObject({
      printed_directly: 2,
      price_endpoints_compared: 10,
      distinct_implied_rates_4dp: 3,
      distinct_implied_rate_groups_2dp: 2,
    });
    // The conflicting rates are preserved, not normalised to one.
    expect(counts.distinct_implied_rate_groups_2dp).toBeGreaterThan(1);
  });
});

describe("builder CLI", () => {
  it("rejects --only for a project it has no builder for", () => {
    // Coralina has no builder entry; asking for it must fail rather than
    // silently do nothing.
    expect(() => runBuilder(["--only=coralina", "--check"])).toThrow(/unknown_project/);
    expect(Object.keys(builder.BUILDERS)).not.toContain("coralina");
  });

  it("has a builder for exactly the five Catalogue 10 projects", () => {
    expect(Object.keys(builder.BUILDERS).sort()).toEqual([...PROJECT_SLUGS].sort());
  });
});

// --- Source-gated. These need the pinned Owner documents. -------------------

describe.skipIf(!SOURCES_CONFIGURED)("end-to-end against the pinned sources", () => {
  it("reports every committed payload UNCHANGED, twice, byte-identically", () => {
    const first = runBuilder(["--check"]);
    const second = runBuilder(["--check"]);
    expect(first).toBe(second);
    for (const slug of PROJECT_SLUGS) {
      expect(first).toContain(`UNCHANGED ${slug}`);
    }
    expect(first).not.toContain("DIFFERS");
  }, 900_000);

  it("isolates --only to the named project", () => {
    const output = runBuilder(["--only=layan-green-park", "--check"]);
    expect(output).toContain("UNCHANGED layan-green-park");
    for (const slug of PROJECT_SLUGS.filter((s) => s !== "layan-green-park")) {
      expect(output).not.toContain(slug);
    }
  }, 900_000);
});
