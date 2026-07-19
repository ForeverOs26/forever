import { describe, expect, it } from "vitest";

import { fingerprintBatch } from "@/features/forever-ingestion/build-batch";

import { DraftValidationError, validateDraftPayload } from "../validate-draft";

function validBatch(overrides: Record<string, unknown> = {}) {
  const body = {
    schema_version: "1",
    mode: "create",
    project: { slug: "sample", name: "Sample", publish: false },
    ...overrides,
  };
  return { ...body, batch_fingerprint: fingerprintBatch(body as never) };
}

describe("Fast Intake draft validation boundary (mirrors -ValidateOnly)", () => {
  it("accepts a well-formed unpublished create payload and reports counts", () => {
    const batch = validBatch({
      buildings: [{ building_code: "A" }],
      units: [{ unit_code: "A-1" }, { unit_code: "A-2" }],
      prices: [{ unit_code: "A-1", price: 1 }],
    });
    const result = validateDraftPayload(batch, "a".repeat(64));
    expect(result.ok).toBe(true);
    expect(result.counts).toMatchObject({
      projects: 1,
      buildings: 1,
      units: 2,
      prices: 1,
      batches: 1,
    });
    expect(result.fingerprintVerified).toBe(true);
    expect(result.marker).toContain("DRAFT_PAYLOAD_VALID|slug=sample");
  });

  it("fails closed on publish=true", () => {
    const batch = validBatch();
    batch.project.publish = true as never;
    expect(() => validateDraftPayload(batch, "a".repeat(64))).toThrow(DraftValidationError);
  });

  it("fails closed on mode=enrich, bad slug, missing name, and bad fingerprint", () => {
    expect(() => validateDraftPayload(validBatch({ mode: "enrich" }), "a".repeat(64))).toThrow(
      DraftValidationError,
    );

    const badSlug = validBatch();
    (badSlug.project as Record<string, unknown>).slug = "Sample";
    expect(() => validateDraftPayload(badSlug, "a".repeat(64))).toThrow(DraftValidationError);

    const noName = validBatch();
    (noName.project as Record<string, unknown>).name = "";
    expect(() => validateDraftPayload(noName, "a".repeat(64))).toThrow(DraftValidationError);

    const badFingerprint = validBatch();
    badFingerprint.batch_fingerprint = "not-a-sha";
    expect(() => validateDraftPayload(badFingerprint, "a".repeat(64))).toThrow(
      DraftValidationError,
    );
  });

  it("rejects a documents array (unsupported by the ordinary importer)", () => {
    const batch = validBatch({ documents: [{ url: "x" }] });
    expect(() => validateDraftPayload(batch, "a".repeat(64))).toThrow(/documents/);
  });

  it("fails closed when batch_fingerprint does not match content", () => {
    const batch = validBatch();
    // Mutate content after the fingerprint was computed.
    batch.project.name = "Tampered";
    expect(() => validateDraftPayload(batch, "a".repeat(64))).toThrow(/fingerprint/);
  });
});
