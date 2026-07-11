import { describe, expect, it } from "vitest";

import {
  normalizeBoolean,
  normalizeDate,
  normalizeDocument,
  normalizeMedia,
  normalizeMoney,
  normalizeNumber,
  normalizeString,
  normalizeUrl,
} from "../normalizers";

describe("normalizeString", () => {
  it("trims and collapses internal whitespace", () => {
    expect(normalizeString("  Coralina   Residences ")).toBe("Coralina Residences");
  });

  it("returns undefined for empty, whitespace, and non-strings", () => {
    expect(normalizeString("   ")).toBeUndefined();
    expect(normalizeString("")).toBeUndefined();
    expect(normalizeString(42)).toBeUndefined();
    expect(normalizeString(null)).toBeUndefined();
    expect(normalizeString(undefined)).toBeUndefined();
  });
});

describe("normalizeNumber", () => {
  it("passes finite numbers through", () => {
    expect(normalizeNumber(1234.5)).toBe(1234.5);
    expect(normalizeNumber(0)).toBe(0);
  });

  it("parses numeric strings with spaces and thousands separators", () => {
    expect(normalizeNumber("1,234,567")).toBe(1234567);
    expect(normalizeNumber(" 5 000 000 ")).toBe(5000000);
    expect(normalizeNumber("-3.5")).toBe(-3.5);
  });

  it("rejects non-numeric input", () => {
    expect(normalizeNumber("12px")).toBeUndefined();
    expect(normalizeNumber(Number.NaN)).toBeUndefined();
    expect(normalizeNumber(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(normalizeNumber(true)).toBeUndefined();
  });
});

describe("normalizeMoney", () => {
  it("builds positive money and defaults the currency", () => {
    expect(normalizeMoney(5_000_000)).toEqual({ amount: 5_000_000, currency: "THB" });
  });

  it("upper-cases a valid 3-letter currency", () => {
    expect(normalizeMoney("1000", "usd")).toEqual({ amount: 1000, currency: "USD" });
  });

  it("treats zero, negative, and unparseable amounts as absent", () => {
    expect(normalizeMoney(0)).toBeUndefined();
    expect(normalizeMoney(-1)).toBeUndefined();
    expect(normalizeMoney("n/a")).toBeUndefined();
  });

  it("falls back to the provided default when the currency is invalid", () => {
    expect(normalizeMoney(10, "dollars", "EUR")).toEqual({ amount: 10, currency: "EUR" });
  });
});

describe("normalizeBoolean", () => {
  it("recognises native booleans and 0/1", () => {
    expect(normalizeBoolean(true)).toBe(true);
    expect(normalizeBoolean(1)).toBe(true);
    expect(normalizeBoolean(0)).toBe(false);
  });

  it("recognises english word tokens case-insensitively", () => {
    expect(normalizeBoolean("Yes")).toBe(true);
    expect(normalizeBoolean("NO")).toBe(false);
    expect(normalizeBoolean("true")).toBe(true);
  });

  it("returns undefined for anything ambiguous", () => {
    expect(normalizeBoolean("maybe")).toBeUndefined();
    expect(normalizeBoolean(2)).toBeUndefined();
    expect(normalizeBoolean(null)).toBeUndefined();
  });
});

describe("normalizeDate", () => {
  it("normalizes ISO and slash forms, dropping any time suffix", () => {
    expect(normalizeDate("2026-01-05")).toBe("2026-01-05");
    expect(normalizeDate("2026/1/5")).toBe("2026-01-05");
    expect(normalizeDate("2026-01-05T12:30:00Z")).toBe("2026-01-05");
  });

  it("normalizes day-first european forms", () => {
    expect(normalizeDate("05.01.2026")).toBe("2026-01-05");
    expect(normalizeDate("5/1/2026")).toBe("2026-01-05");
  });

  it("rejects impossible and unrecognised dates", () => {
    expect(normalizeDate("2026-02-30")).toBeUndefined();
    expect(normalizeDate("2026-13-01")).toBeUndefined();
    expect(normalizeDate("not a date")).toBeUndefined();
  });

  it("accepts a genuine leap day and rejects a non-leap one", () => {
    expect(normalizeDate("2024-02-29")).toBe("2024-02-29");
    expect(normalizeDate("2026-02-29")).toBeUndefined();
  });
});

describe("normalizeUrl", () => {
  it("accepts absolute http(s) urls verbatim", () => {
    expect(normalizeUrl("  https://cdn.example.com/a.pdf?x=1 ")).toBe(
      "https://cdn.example.com/a.pdf?x=1",
    );
    expect(normalizeUrl("http://example.com")).toBe("http://example.com");
  });

  it("rejects relative urls and non-web schemes", () => {
    expect(normalizeUrl("/relative/path.jpg")).toBeUndefined();
    expect(normalizeUrl("ftp://example.com/f")).toBeUndefined();
    expect(normalizeUrl("javascript:alert(1)")).toBeUndefined();
    expect(normalizeUrl("")).toBeUndefined();
  });
});

describe("normalizeMedia", () => {
  it("classifies the media type and applies defaults", () => {
    expect(
      normalizeMedia({ url: "https://cdn.example.com/cover.jpg", mediaType: "Cover photo" }),
    ).toEqual({
      mediaType: "cover_image",
      title: "",
      url: "https://cdn.example.com/cover.jpg",
      sortOrder: 0,
      isPublic: true,
    });
  });

  it("carries optional fields only when present", () => {
    const media = normalizeMedia({
      url: "https://cdn.example.com/g.jpg",
      title: "  Gallery  ",
      caption: "A view",
      sortOrder: "3",
      isPublic: "no",
    });
    expect(media).toEqual({
      mediaType: "other",
      title: "Gallery",
      url: "https://cdn.example.com/g.jpg",
      caption: "A view",
      sortOrder: 3,
      isPublic: false,
    });
    expect(media && "altText" in media).toBe(false);
  });

  it("returns undefined without a valid url", () => {
    expect(normalizeMedia({ url: "not-a-url", title: "x" })).toBeUndefined();
    expect(normalizeMedia({})).toBeUndefined();
  });
});

describe("normalizeDocument", () => {
  it("classifies the document type and derives the extension from the url", () => {
    expect(
      normalizeDocument({ url: "https://cdn.example.com/price.PDF", documentType: "Price list" }),
    ).toEqual({
      documentType: "price_list",
      title: "",
      url: "https://cdn.example.com/price.PDF",
      fileExtension: "pdf",
      sortOrder: 0,
      isPublic: true,
    });
  });

  it("prefers an explicit extension and a recognised verification status", () => {
    const doc = normalizeDocument({
      url: "https://cdn.example.com/legal",
      documentType: "Contract",
      fileExtension: ".DOCX",
      verificationStatus: "Verified",
    });
    expect(doc).toEqual({
      documentType: "legal",
      title: "",
      url: "https://cdn.example.com/legal",
      fileExtension: "docx",
      verificationStatus: "verified",
      sortOrder: 0,
      isPublic: true,
    });
  });

  it("returns undefined without a valid url", () => {
    expect(normalizeDocument({ url: "" })).toBeUndefined();
  });
});
