import { describe, expect, it } from "vitest";

import {
  assertNoPrivatePaths,
  byteSort,
  canonicalJson,
  digestRecords,
  field,
  normaliseText,
  record,
  redactSecrets,
  sha256Hex,
  UNIT_SEP,
} from "../canonical";

describe("canonicalJson", () => {
  it("orders keys by bytes, not by insertion", () => {
    const a = canonicalJson({ zebra: 1, apple: 2, Mango: 3 });
    const b = canonicalJson({ Mango: 3, apple: 2, zebra: 1 });
    expect(a).toBe(b);
    // Uppercase sorts before lowercase in UTF-8, which is the order psql's
    // `COLLATE "C"` gives and the order the digests are compared against.
    expect(a.indexOf('"Mango"')).toBeLessThan(a.indexOf('"apple"'));
  });

  it("omits undefined rather than writing null", () => {
    // Absent evidence and recorded-as-nothing are different claims, and the
    // whole `unknown` argument turns on the difference.
    expect(canonicalJson({ a: undefined, b: null })).toBe('{\n  "b": null\n}\n');
  });

  it("ends with exactly one newline and never CRLF", () => {
    const text = canonicalJson({ a: "line" });
    expect(text.endsWith("}\n")).toBe(true);
    expect(text).not.toContain("\r");
  });

  it("is stable for nested arrays and objects", () => {
    const value = { list: [{ b: 1, a: 2 }], other: [3, 1, 2] };
    expect(canonicalJson(value)).toBe(canonicalJson(JSON.parse(JSON.stringify(value))));
    // Array ORDER is content, not incidental: it is not sorted.
    expect(canonicalJson(value)).toContain("[\n    3,\n    1,\n    2\n  ]");
  });
});

describe("byteSort and digestRecords", () => {
  it("sorts by UTF-8 bytes, not UTF-16 code units", () => {
    // "Z" (0x5A) precedes "a" (0x61) bytewise; the default comparator agrees
    // here, but an astral character is where the two orders diverge.
    expect(byteSort(["a", "Z", "\u{1F600}", "b"])).toEqual(["Z", "a", "b", "\u{1F600}"]);
  });

  it("is independent of input order", () => {
    const records = ["c", "a", "b"];
    expect(digestRecords(records)).toBe(digestRecords(["b", "c", "a"]));
  });

  it("changes when any record changes", () => {
    expect(digestRecords(["a", "b"])).not.toBe(digestRecords(["a", "b "]));
  });
});

describe("field and record", () => {
  it("maps null and undefined to the same empty field", () => {
    expect(field(null)).toBe("");
    expect(field(undefined)).toBe("");
  });

  it("refuses a non-integer number rather than truncating it", () => {
    // Truncating would fold two different inputs onto one digest — the single
    // failure a state digest must not have.
    expect(() => field(1.5)).toThrowError(/non-integer/);
  });

  it("joins with the unit separator, which no field can contain", () => {
    expect(record("a", 1, true, null)).toBe(["a", "1", "t", ""].join(UNIT_SEP));
  });

  it("cannot be collided by a field containing a printable separator", () => {
    // A URL can legitimately contain "|" and ":" — the reason U+001F is used.
    expect(record("a|b", "c")).not.toBe(record("a", "b|c"));
  });
});

describe("normaliseText", () => {
  it("normalises CRLF only, leaving intra-line whitespace alone", () => {
    expect(normaliseText("a\r\nb")).toBe("a\nb");
    expect(normaliseText("a  b")).toBe("a  b");
    expect(sha256Hex(normaliseText("x\r\n"))).toBe(sha256Hex("x\n"));
  });
});

describe("assertNoPrivatePaths", () => {
  it("does not fire on an https URL", () => {
    // The naive drive-letter rule matches the "s://" of every https URL, and
    // this manifest is mostly URLs. A guard that throws on every honest run is
    // a guard that gets deleted.
    expect(() =>
      assertNoPrivatePaths(
        "https://abtvsrcnfwlbawvrjeed.supabase.co/storage/v1/object/public/x.jpg",
        "The manifest",
      ),
    ).not.toThrow();
    expect(() => assertNoPrivatePaths("postgres://host:5432/db", "x")).not.toThrow();
  });

  it("throws on a Windows path, a POSIX home path and a token", () => {
    expect(() => assertNoPrivatePaths("see C:/Users/someone/file.json", "The report")).toThrowError(
      /Windows filesystem path/,
    );
    expect(() => assertNoPrivatePaths("/Users/someone/x", "The report")).toThrowError(/POSIX home/);
    expect(() => assertNoPrivatePaths("eyJhbGciOi", "The report")).toThrowError(/JWT-shaped/);
  });

  it("names the artifact so the operator knows what was refused", () => {
    expect(() => assertNoPrivatePaths("D:\\Downloads\\x", "The exceptions file")).toThrowError(
      /^The exceptions file contains/,
    );
  });
});

describe("redactSecrets", () => {
  it("redacts a connection string", () => {
    const out = redactSecrets("psql: postgres://user:hunter2@db.example.com:5432/postgres failed");
    expect(out).not.toContain("hunter2");
    expect(out).toContain("<connection string redacted>");
  });

  it("redacts a JWT-shaped token", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc-DEF_123";
    expect(redactSecrets(`Authorization: Bearer ${jwt}`)).toBe(
      "Authorization: Bearer <token redacted>",
    );
  });

  it("redacts a C:/Users path", () => {
    const out = redactSecrets("ENOENT: open 'C:/Users/owner/Downloads/pkg/x.json'");
    expect(out).not.toContain("owner");
    expect(out).toContain("<path redacted>");
  });

  it("redacts an explicitly supplied literal too", () => {
    // The connection string as the operator typed it may not match any pattern
    // (a libpq keyword/value string, for instance), so it is passed in.
    const supplied = "host=db.internal user=svc password=s3cretvalue";
    expect(redactSecrets(`failed: ${supplied}`, supplied)).toBe("failed: <redacted>");
  });

  it("leaves an ordinary message intact", () => {
    expect(redactSecrets("role_digest_before mismatch for coralina")).toBe(
      "role_digest_before mismatch for coralina",
    );
  });
});
