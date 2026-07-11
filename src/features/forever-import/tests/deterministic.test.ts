import { describe, expect, it } from "vitest";

import { normalizeDocument, normalizeMedia, validateImport, type ImportBatch } from "..";
import { makeMedia, makeProject } from "./fixtures";

describe("deterministic foundation", () => {
  it("normalizers return equal output for equal input", () => {
    const input = { url: "https://cdn.example.com/a.jpg", mediaType: "Gallery", sortOrder: "2" };
    expect(normalizeMedia(input)).toEqual(normalizeMedia(input));
    expect(normalizeDocument({ url: "https://cdn.example.com/b.pdf" })).toEqual(
      normalizeDocument({ url: "https://cdn.example.com/b.pdf" }),
    );
  });

  it("does not mutate the input record it normalizes", () => {
    const input = { url: "https://cdn.example.com/a.jpg", title: "  Pool  " };
    const snapshot = structuredClone(input);
    normalizeMedia(input);
    expect(input).toEqual(snapshot);
  });

  it("validateImport is a pure function of its batch and scope", () => {
    const batch: ImportBatch = {
      projects: [makeProject({ id: "p-1", developerId: undefined, locationId: undefined })],
      media: [makeMedia({ projectId: "p-1" })],
    };
    const a = validateImport(batch);
    const b = validateImport(batch);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("does not mutate the batch it validates", () => {
    const batch: ImportBatch = {
      media: [makeMedia({ projectId: "ghost" })],
    };
    const snapshot = structuredClone(batch);
    validateImport(batch);
    expect(batch).toEqual(snapshot);
  });
});
