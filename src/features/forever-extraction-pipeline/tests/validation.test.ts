import { describe, expect, it } from "vitest";

import {
  describeExtractionFact,
  extractionVersion,
  partitionExtractionIssues,
  validateExtractionCatalog,
  validateExtractionDefinition,
  validateExtractionFact,
  validateExtractionFacts,
  validateExtractionIdentity,
  validateExtractionMethod,
  validateExtractionRecipe,
} from "..";
import { makeCatalog, makeDefinition, makeEntry, makeFact, makeFactInput } from "./fixtures";

describe("identity and method validation", () => {
  it("passes derived values; flags missing fields; warns (never rewrites) on an unnormalized slug", () => {
    const codes = validateExtractionIdentity({ id: "", slug: "", name: "" }).map(
      (issue) => issue.code,
    );
    expect(codes).toEqual([
      "missing_extraction_id",
      "missing_extraction_slug",
      "missing_extraction_name",
    ]);

    const unnormalized = validateExtractionIdentity({
      id: "extr_x",
      slug: "Not Normal",
      name: "X",
    });
    expect(unnormalized).toHaveLength(1);
    expect(unnormalized[0]).toMatchObject({
      code: "unnormalized_extraction_slug",
      severity: "warning",
    });

    expect(
      validateExtractionMethod({ kind: "divination" as never, tool: " " }).map(
        (issue) => issue.code,
      ),
    ).toEqual(["unknown_method_kind", "empty_method_tool"]);
  });
});

describe("fact validation", () => {
  it("passes a fully described fact with no issues at all", () => {
    expect(validateExtractionFact(makeFact())).toEqual([]);
  });

  it("detects invalid source references across the fact, evidence, and provenance", () => {
    const fact = makeFact({ sourceId: "" });
    const codes = validateExtractionFact(fact).map((issue) => issue.code);
    expect(codes).toContain("missing_fact_source");

    const drifted = makeFact();
    drifted.evidence.sourceId = "psrc_somewhere-else";
    drifted.provenance.sourceVersion = extractionVersion(9, 9, 9);
    const driftCodes = validateExtractionFact(drifted).map((issue) => issue.code);
    expect(driftCodes).toContain("evidence_source_mismatch");
    expect(driftCodes).toContain("provenance_version_mismatch");
  });

  it("never fabricates a version mismatch when both sides carry the same malformed version", () => {
    const fact = describeExtractionFact(
      makeFactInput({ sourceVersion: { major: 1, minor: 0 } as never }),
    );
    const codes = validateExtractionFact(fact).map((issue) => issue.code);
    expect(codes).toContain("invalid_version_part");
    expect(codes).not.toContain("evidence_version_mismatch");
    expect(codes).not.toContain("provenance_version_mismatch");
  });

  it("detects missing evidence, missing provenance, and missing confidence", () => {
    const codes = validateExtractionFact(
      makeFact({
        evidence: undefined as never,
        provenance: null as never,
        confidence: undefined as never,
      }),
    ).map((issue) => issue.code);
    expect(codes).toContain("missing_evidence");
    expect(codes).toContain("missing_provenance");
    expect(codes).toContain("missing_confidence");
  });

  it("detects unsupported fact types and invalid confidence values", () => {
    const codes = validateExtractionFact(
      makeFact({ factType: "vibes" as never, confidence: { level: "high", score: 2 } }),
    ).map((issue) => issue.code);
    expect(codes).toContain("unsupported_fact_type");
    expect(codes).toContain("invalid_confidence_score");
  });

  it("detects contradictory lifecycle states instead of resolving them", () => {
    expect(
      validateExtractionFact(makeFact({ status: "verified", validationStatus: "invalid" })).map(
        (issue) => issue.code,
      ),
    ).toContain("verified_but_invalid");
    expect(
      validateExtractionFact(makeFact({ status: "verified", reviewStatus: "rejected" })).map(
        (issue) => issue.code,
      ),
    ).toContain("verified_but_rejected");

    const unavailable = validateExtractionFact(makeFact({ status: "unavailable" })).map(
      (issue) => issue.code,
    );
    expect(unavailable).toContain("unavailable_with_value");
  });

  it("keeps value representations honest about their kind", () => {
    expect(
      validateExtractionFact(
        makeFact({ valueKind: "raw", rawValue: undefined, structuredValue: undefined }),
      ).map((issue) => issue.code),
    ).toContain("missing_raw_value");
    expect(
      validateExtractionFact(makeFact({ valueKind: "structured", structuredValue: undefined })).map(
        (issue) => issue.code,
      ),
    ).toContain("missing_structured_value");
    expect(
      validateExtractionFact(makeFact({ valueKind: "derived" })).map((issue) => issue.code),
    ).toContain("derived_without_chain");
    expect(
      validateExtractionFact(makeFact({ structuredValue: { amount: 1 } as never })).map(
        (issue) => issue.code,
      ),
    ).toContain("invalid_structured_value");
  });

  it("warns when superseded or disputed facts name no counterpart, and flags self-references", () => {
    const superseded = validateExtractionFact(makeFact({ status: "superseded" }));
    expect(superseded).toHaveLength(1);
    expect(superseded[0]).toMatchObject({
      code: "superseded_without_reference",
      severity: "warning",
    });

    const disputed = validateExtractionFact(makeFact({ status: "disputed" }));
    expect(disputed.map((issue) => issue.code)).toEqual(["disputed_without_reference"]);

    const fact = makeFact();
    const selfCodes = validateExtractionFact(
      makeFact({ supersededBy: fact.id, conflictsWith: [fact.id, fact.id] }),
    ).map((issue) => issue.code);
    expect(selfCodes.filter((code) => code === "self_fact_reference")).toHaveLength(3);
    expect(selfCodes).toContain("duplicate_conflict_reference");
  });
});

describe("fact-set validation", () => {
  it("passes coherent facts: many from one source, one type from many sources, conflicts included", () => {
    const pdfPrice = makeFact();
    const crmPrice = describeExtractionFact(
      makeFactInput({
        factSlug: "price-1br-crm",
        sourceId: "psrc_coralina-crm-export-v1-0-0",
        structuredValue: { amount: 4650000, currency: "THB" },
        rawValue: "4,650,000 THB",
      }),
    );
    const bedrooms = describeExtractionFact(
      makeFactInput({ factSlug: "bedrooms-1br", factType: "bedrooms", rawValue: "1" }),
    );
    const verdict = validateExtractionFacts([pdfPrice, crmPrice, bedrooms]);
    expect(verdict.valid).toBe(true);
    expect(verdict.issues).toEqual([]);
  });

  it("detects duplicate fact ids", () => {
    const verdict = validateExtractionFacts([makeFact(), makeFact()]);
    expect(verdict.valid).toBe(false);
    expect(verdict.errors.map((error) => error.code)).toEqual(["duplicate_fact_id"]);
    expect(verdict.errors[0].path).toBe("facts.1.id");
  });

  it("partitions issues into errors and warnings consistently", () => {
    const verdict = validateExtractionFacts([makeFact({ status: "superseded" })]);
    const { errors, warnings } = partitionExtractionIssues(verdict.issues);
    expect(verdict.errors).toEqual(errors);
    expect(verdict.warnings).toEqual(warnings);
    expect(verdict.valid).toBe(errors.length === 0);
  });
});

describe("definition and recipe validation", () => {
  it("flags a definition with no recipes, duplicate recipes, and undeclared coverage", () => {
    const definition = makeDefinition({ recipes: [], factTypes: [] });
    const codes = validateExtractionDefinition(definition).map((issue) => issue.code);
    expect(codes).toContain("no_recipes");
    expect(codes).toContain("no_fact_types");

    const doubled = makeDefinition();
    doubled.recipes = [doubled.recipes[0], doubled.recipes[0]];
    expect(validateExtractionDefinition(doubled).map((issue) => issue.code)).toContain(
      "duplicate_recipe_id",
    );

    const narrow = makeDefinition({ factTypes: ["price"] });
    const warnings = validateExtractionDefinition(narrow).filter(
      (issue) => issue.severity === "warning",
    );
    expect(warnings.map((warning) => warning.code)).toContain("undeclared_recipe_fact_type");
  });

  it("flags recipes with unknown reused RC4.4 vocabularies and no verify stage", () => {
    const recipe = makeDefinition().recipes[0];
    recipe.documentTypes = ["price_list", "price_list", "novel" as never];
    recipe.fileFormats = ["papyrus" as never];
    recipe.stages = recipe.stages.filter((stage) => stage.kind !== "verify");
    const codes = validateExtractionRecipe(recipe).map((issue) => issue.code);
    expect(codes).toContain("duplicate_document_type");
    expect(codes).toContain("unknown_document_type");
    expect(codes).toContain("unknown_file_format");
    expect(codes).toContain("no_verify_stage");
  });
});

describe("catalogue validation", () => {
  it("passes a coherent catalogue", () => {
    const verdict = validateExtractionCatalog(makeCatalog());
    expect(verdict.valid).toBe(true);
    expect(verdict.issues).toEqual([]);
  });

  it("flags a missing id, duplicate definitions, and a non-boolean enabled flag", () => {
    expect(
      validateExtractionCatalog(makeCatalog({ id: "" })).errors.map((error) => error.code),
    ).toContain("missing_catalog_id");

    const dupes = validateExtractionCatalog(makeCatalog({ entries: [makeEntry(), makeEntry()] }));
    expect(dupes.errors.map((error) => error.code)).toContain("duplicate_extraction_id");
    expect(dupes.errors.map((error) => error.code)).toContain("duplicate_extraction_key");

    const badFlag = makeCatalog({ entries: [makeEntry({ enabled: "yes" as never })] });
    expect(validateExtractionCatalog(badFlag).errors.map((error) => error.code)).toContain(
      "invalid_enabled_flag",
    );
  });

  it("preserves deterministic issue ordering: identical input, identical issues, identical order", () => {
    const catalog = makeCatalog({ entries: [makeEntry(), makeEntry()] });
    expect(validateExtractionCatalog(catalog)).toEqual(validateExtractionCatalog(catalog));
    const fact = makeFact({ status: "superseded", factType: "vibes" as never });
    expect(validateExtractionFact(fact)).toEqual(validateExtractionFact(fact));
  });

  it("never throws on deeply malformed input: null, undefined, arrays, and primitives", () => {
    const broken = {
      id: undefined,
      entries: [
        null,
        7,
        "entry",
        { enabled: null, definition: undefined },
        { enabled: true, definition: null },
        {
          enabled: true,
          definition: {
            identity: null,
            version: null,
            recipes: "nope",
            factTypes: 4,
            policy: null,
          },
        },
        {
          enabled: true,
          definition: {
            identity: {},
            version: {},
            recipes: [null, { id: 1, stages: [null] }],
            factTypes: [null, [], "price"],
          },
        },
      ],
    } as never;
    expect(() => validateExtractionCatalog(broken)).not.toThrow();
    expect(validateExtractionCatalog(broken).valid).toBe(false);

    expect(() => validateExtractionFacts(null as never)).not.toThrow();
    expect(validateExtractionFacts(null as never).valid).toBe(false);
    expect(() =>
      validateExtractionFacts([
        null,
        7,
        [],
        {
          id: null,
          projectId: undefined,
          sourceVersion: "1.0.0",
          factType: 9,
          valueKind: null,
          confidence: 0.9,
          evidence: "page 3",
          provenance: { derivedFrom: "xfact_a" },
          conflictsWith: "xfact_b",
          issues: "none",
          status: [],
          reviewStatus: {},
          validationStatus: 1,
        },
      ] as never),
    ).not.toThrow();

    expect(() =>
      validateExtractionFact({
        id: "x",
        sourceVersion: { major: "1" },
        evidence: { locator: 5 },
        provenance: { method: { kind: null }, sourceVersion: {} },
        confidence: {},
      } as never),
    ).not.toThrow();
  });
});
