import { describe, expect, it } from "vitest";

import {
  deriveProjectSourceIdentity,
  partitionProjectSourceIssues,
  projectSourceDescriptor,
  projectSourceRelationships,
  projectSourceVersion,
  validateProjectSourceAuthority,
  validateProjectSourceCatalog,
  validateProjectSourceDefinition,
  validateProjectSourceDescriptor,
  validateProjectSourceIdentity,
  validateProjectSourceRelationships,
  validateProjectSourceStatus,
} from "..";
import { describeProjectSource } from "../definition";
import { makeCatalog, makeEntry, makeInput, makeSource } from "./fixtures";

describe("identity validation", () => {
  it("passes a derived identity; flags missing fields; warns (never rewrites) on an unnormalized slug", () => {
    expect(
      validateProjectSourceIdentity(deriveProjectSourceIdentity("coralina", "price-list")),
    ).toEqual([]);

    const codes = validateProjectSourceIdentity({
      id: "",
      slug: "",
      name: "",
      projectId: "",
    }).map((issue) => issue.code);
    expect(codes).toEqual([
      "missing_source_id",
      "missing_source_slug",
      "missing_source_name",
      "missing_project_id",
    ]);

    const unnormalized = validateProjectSourceIdentity({
      id: "psrc_x",
      slug: "Not Normal",
      name: "X",
      projectId: "proj_x",
    });
    expect(unnormalized).toHaveLength(1);
    expect(unnormalized[0].code).toBe("unnormalized_source_slug");
    expect(unnormalized[0].severity).toBe("warning");
  });
});

describe("descriptor validation", () => {
  it("passes a well-formed descriptor and flags unknown vocabularies", () => {
    expect(
      validateProjectSourceDescriptor(
        projectSourceDescriptor("price_list", "pdf", {
          language: "en-GB",
          uploadedAt: "2026-01-01T00:00:00.000Z",
          documentDate: "2025-12-15",
        }),
      ),
    ).toEqual([]);

    const codes = validateProjectSourceDescriptor(
      projectSourceDescriptor("novel" as never, "papyrus" as never),
    ).map((issue) => issue.code);
    expect(codes).toEqual(["unknown_document_type", "unknown_file_format"]);
  });

  it("flags empty optionals as errors and unconventional shapes as warnings", () => {
    const empty = validateProjectSourceDescriptor(
      projectSourceDescriptor("brochure", "pdf", {
        language: " ",
        uploadedAt: "",
        documentDate: "",
      }),
    ).map((issue) => issue.code);
    expect(empty).toEqual(["empty_language", "empty_uploaded_at", "empty_document_date"]);

    const odd = validateProjectSourceDescriptor(
      projectSourceDescriptor("brochure", "pdf", {
        language: "English!",
        uploadedAt: "yesterday",
        documentDate: "15/12/2025",
      }),
    );
    expect(odd.map((issue) => issue.code)).toEqual([
      "unconventional_language",
      "unconventional_uploaded_at",
      "unconventional_document_date",
    ]);
    expect(odd.every((issue) => issue.severity === "warning")).toBe(true);
  });
});

describe("authority and status validation", () => {
  it("flags unknown kinds, unknown trust, empty attribution, and unknown status", () => {
    const codes = validateProjectSourceAuthority({
      kind: "oracle" as never,
      trust: "absolute" as never,
      verifiedBy: " ",
    }).map((issue) => issue.code);
    expect(codes).toEqual(["unknown_authority_kind", "unknown_trust_level", "empty_verified_by"]);

    expect(validateProjectSourceStatus("published" as never).map((issue) => issue.code)).toEqual([
      "unknown_source_status",
    ]);
    expect(validateProjectSourceStatus("verified")).toEqual([]);
  });
});

describe("relationships validation", () => {
  it("flags empty references, duplicate related ids, and self-references", () => {
    const issues = validateProjectSourceRelationships(
      {
        registeredSourceId: " ",
        supersedes: "psrc_self",
        related: ["psrc_a", "psrc_a", " ", "psrc_self"],
      },
      "psrc_self",
    );
    const codes = issues.map((issue) => issue.code);
    expect(codes).toContain("empty_relationship_reference");
    expect(codes).toContain("duplicate_related_reference");
    expect(codes.filter((code) => code === "self_relationship")).toHaveLength(2);
  });

  it("passes a coherent chain and checks nothing against a live catalogue", () => {
    expect(
      validateProjectSourceRelationships(
        projectSourceRelationships({
          registeredSourceId: "src_developer_website",
          supersedes: "psrc_coralina-price-list-v1-0-0",
        }),
        "psrc_coralina-price-list-v2-0-0",
      ),
    ).toEqual([]);
  });
});

describe("definition validation", () => {
  it("passes a fully described source with no issues at all", () => {
    expect(validateProjectSourceDefinition(makeSource())).toEqual([]);
  });

  it("flags missing version/authority, an unknown origin, and a bad status", () => {
    const codes = validateProjectSourceDefinition(
      makeSource({
        version: undefined as never,
        authority: undefined as never,
        status: "published" as never,
        origin: "carrier_pigeon" as never,
      }),
    ).map((issue) => issue.code);
    expect(codes).toContain("missing_source_version");
    expect(codes).toContain("missing_source_authority");
    expect(codes).toContain("unknown_source_status");
    expect(codes).toContain("unknown_source_origin");
  });

  it("warns when a superseded source names no superseding revision", () => {
    const issues = validateProjectSourceDefinition(makeSource({ status: "superseded" }));
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("superseded_without_reference");
    expect(issues[0].severity).toBe("warning");

    const chained = makeSource({
      status: "superseded",
      relationships: projectSourceRelationships({
        supersededBy: "psrc_coralina-price-list-v2-0-0",
      }),
    });
    expect(validateProjectSourceDefinition(chained)).toEqual([]);
  });

  it("surfaces reused RC4.0 policy issues and RC3.3 version issues through the definition guard", () => {
    const codes = validateProjectSourceDefinition(
      makeSource({
        version: projectSourceVersion(1, -1, 0),
        policy: {
          id: "p",
          executionMode: "warp" as never,
          onError: "abort",
          retry: { maxAttempts: 0, backoff: "none" },
          dryRunOnly: true,
        },
      }),
    ).map((issue) => issue.code);
    expect(codes).toContain("invalid_version_part");
    expect(codes).toContain("unknown_execution_mode");
    expect(codes).toContain("invalid_retry_attempts");
  });
});

describe("catalogue validation", () => {
  it("passes a coherent catalogue, including multiple revisions of one document", () => {
    const v1 = makeEntry({
      definition: makeSource({
        status: "superseded",
        relationships: projectSourceRelationships({
          supersededBy: "psrc_coralina-price-list-v2-0-0",
        }),
      }),
    });
    const v2 = makeEntry({
      definition: describeProjectSource(makeInput({ version: projectSourceVersion(2, 0, 0) })),
    });
    const verdict = validateProjectSourceCatalog(makeCatalog({ entries: [v1, v2] }));
    expect(verdict.valid).toBe(true);
    expect(verdict.issues).toEqual([]);
  });

  it("flags a missing id, duplicate ids/revisions, and a non-boolean enabled flag", () => {
    expect(
      validateProjectSourceCatalog(makeCatalog({ id: "" })).errors.map((error) => error.code),
    ).toContain("missing_catalog_id");

    const dupes = validateProjectSourceCatalog(
      makeCatalog({ entries: [makeEntry(), makeEntry()] }),
    );
    const dupeCodes = dupes.errors.map((error) => error.code);
    expect(dupeCodes).toContain("duplicate_source_id");
    expect(dupeCodes).toContain("duplicate_source_revision");

    const badFlag = makeCatalog({ entries: [makeEntry({ enabled: "yes" as never })] });
    expect(validateProjectSourceCatalog(badFlag).errors.map((error) => error.code)).toContain(
      "invalid_enabled_flag",
    );
  });

  it("warns when one document has more than one enabled, current revision", () => {
    const v1 = makeEntry();
    const v2 = makeEntry({
      definition: describeProjectSource(makeInput({ version: projectSourceVersion(2, 0, 0) })),
    });
    const verdict = validateProjectSourceCatalog(makeCatalog({ entries: [v1, v2] }));
    expect(verdict.valid).toBe(true);
    expect(verdict.warnings.map((warning) => warning.code)).toContain("multiple_current_revisions");

    const disabled = validateProjectSourceCatalog(
      makeCatalog({ entries: [{ ...v1, enabled: false }, v2] }),
    );
    expect(disabled.warnings).toEqual([]);
  });

  it("partitions issues into errors and warnings consistently", () => {
    const verdict = validateProjectSourceCatalog(
      makeCatalog({ entries: [makeEntry({ definition: makeSource({ status: "superseded" }) })] }),
    );
    const { errors, warnings } = partitionProjectSourceIssues(verdict.issues);
    expect(verdict.errors).toEqual(errors);
    expect(verdict.warnings).toEqual(warnings);
    expect(verdict.valid).toBe(errors.length === 0);
  });

  it("flags malformed lists instead of silently passing them", () => {
    const nonListEntries = validateProjectSourceCatalog({ id: "c", entries: "nope" as never });
    expect(nonListEntries.valid).toBe(false);
    expect(nonListEntries.errors.map((error) => error.code)).toEqual(["invalid_entries"]);

    const nonListRelated = validateProjectSourceRelationships({ related: "not-a-list" as never });
    expect(nonListRelated.map((issue) => issue.code)).toEqual(["invalid_related_list"]);
  });

  it("still detects duplicate surrogate ids when versions are missing", () => {
    const twin = () => makeEntry({ definition: makeSource({ version: undefined as never }) });
    const verdict = validateProjectSourceCatalog(makeCatalog({ entries: [twin(), twin()] }));
    expect(verdict.errors.map((error) => error.code)).toContain("duplicate_source_id");
  });

  it("never throws on deeply malformed input, whether absent parts are undefined or null", () => {
    const broken = {
      id: undefined,
      entries: [
        null,
        { enabled: null, definition: undefined },
        { enabled: true, definition: null },
        {
          enabled: true,
          definition: {
            identity: null,
            descriptor: null,
            version: null,
            authority: null,
            relationships: null,
            policy: null,
            status: 7,
          },
        },
        {
          enabled: true,
          definition: {
            identity: {},
            descriptor: {},
            version: null,
            relationships: { related: "not-a-list" },
            status: 7,
          },
        },
      ],
    } as never;
    expect(() => validateProjectSourceCatalog(broken)).not.toThrow();
    expect(validateProjectSourceCatalog(broken).valid).toBe(false);

    expect(() =>
      validateProjectSourceDefinition({
        identity: null,
        descriptor: null,
        version: null,
        authority: null,
        relationships: null,
        policy: null,
        status: null,
        origin: null,
      } as never),
    ).not.toThrow();
  });
});
