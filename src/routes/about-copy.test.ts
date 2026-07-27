import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * F-009. `/about` told every prospective buyer "The platform is demo-ready for
 * Phuket" — development-stage vocabulary on a live client-facing page, and the
 * one sentence on the site that undercut the credibility the rest of it builds.
 *
 * Asserted against the route source because the About page is static copy: no
 * loader, no data, nothing to render around. A source assertion is what keeps
 * the phrase from being typed back in.
 */
const about = readFileSync(join(process.cwd(), "src", "routes", "about.tsx"), "utf-8");

describe("public About copy (F-009)", () => {
  it("does not describe the platform as a demo", () => {
    expect(about).not.toMatch(/demo-ready/i);
    expect(about).not.toMatch(/\bdemo\b/i);
  });

  it("does not expose internal platform status to buyers", () => {
    for (const phrase of [
      "prototype",
      "beta",
      "pilot",
      "work in progress",
      "coming soon",
      "under development",
      "MVP",
      "staging",
      "placeholder",
    ]) {
      expect(about.toLowerCase()).not.toContain(phrase.toLowerCase());
    }
  });

  it("describes Forever as a live Phuket discovery and comparison experience", () => {
    expect(about).toContain(
      "Forever is a live property discovery and comparison experience for Phuket",
    );
  });

  it("keeps the principle sentence that followed it", () => {
    expect(about).toContain("reduce uncertainty before a buyer takes the next step");
  });

  it("makes no verification or guarantee claim in that sentence", () => {
    // Replacing "demo-ready" must not overcorrect into a promise the record
    // cannot support.
    for (const overclaim of ["guarantee", "verified by", "certified", "the best", "no risk"]) {
      expect(about.toLowerCase()).not.toContain(overclaim);
    }
  });
});
