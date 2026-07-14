import { describe, expect, it } from "vitest";

import { redactEvidence, redactSecrets, REDACTION_MARKER } from "./redaction";

describe("redaction", () => {
  it("redacts session URLs", () => {
    const out = redactSecrets("see https://example.com/s/FAKEMARKER?token=xyz for details");
    expect(out).not.toContain("example.com");
    expect(out).not.toContain("FAKEMARKER");
    expect(out).toContain(REDACTION_MARKER);
  });

  it("redacts bearer tokens and api keys", () => {
    const out = redactSecrets(
      "Authorization: Bearer FAKETOKEN000001 and key sk-ant-EXAMPLENOTREAL01",
    );
    expect(out).not.toContain("FAKETOKEN000001");
    expect(out).not.toContain("sk-ant-EXAMPLENOTREAL01");
  });

  it("redacts key=value secrets and cookies", () => {
    const out = redactSecrets("session_id=FAKEIDVALUE0001; set-cookie: sess=FAKECOOKIEVAL01");
    expect(out).not.toContain("FAKEIDVALUE0001");
    expect(out).not.toContain("FAKECOOKIEVAL01");
  });

  it("redacts UUID session identifiers", () => {
    const out = redactSecrets("session 00000000-1111-4222-8333-444455556666 finished");
    expect(out).not.toContain("00000000-1111-4222-8333-444455556666");
    expect(out).toContain(REDACTION_MARKER);
  });

  it("is deterministic and leaves ordinary text intact", () => {
    const text = "Patch produced under inbox/run.patch; 3 focused tests passed.";
    expect(redactSecrets(text)).toBe(redactSecrets(text));
    expect(redactSecrets(text)).toContain("focused tests passed");
  });

  it("bounds evidence length", () => {
    const long = "patch line ".repeat(1000);
    const out = redactEvidence(long, 100);
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out).toContain("[truncated]");
  });

  it("returns empty string for missing evidence", () => {
    expect(redactEvidence(undefined)).toBe("");
  });
});
