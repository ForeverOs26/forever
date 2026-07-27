/**
 * Words the public project flow may not use
 * (FOREVER-PR116-RELEASE-STABILIZATION-001, findings F1 and F6).
 *
 * A source-level check, because the defect was a *name*: the unit sort ordered
 * by availability and then unit code, and called that a recommendation. Nothing
 * in the ordering weighs suitability for a buyer, and per-unit price currentness
 * cannot be proven — `units.price_effective_date` does not exist as a column.
 *
 * Scoped deliberately to `src/features/project-detail`. Forever's advisory
 * feature does make evidence-backed recommendations, and this must not be read
 * as a ban on the word everywhere.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const FEATURE_ROOT = resolve(process.cwd(), "src/features/project-detail");

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(full));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry)) found.push(full);
  }
  return found;
}

/**
 * Files exempt from the recommendation-language check, and why.
 *
 * `unit-presentation.ts` documents the rename, so it has to name what it
 * replaced. This file states the rule.
 *
 * `ForeverIntelligenceSection.tsx` is a different claim, not the same defect.
 * It renders "Forever Recommendation" from a scored intelligence report and is
 * gated on `hasAdvisoryEvidence` in `ProjectDetailEngine`, so it appears only
 * where evidence exists and it shows the category scores behind it. F6 is about
 * a *sort* that ordered by availability and unit code and called itself a
 * recommendation — an endorsement with nothing behind it.
 *
 * Whether an evidence-scored recommendation should appear on a public project
 * page at all is a real question, but it is an Owner decision about a separate
 * feature, not part of correcting PR #116's release defects. It is recorded as
 * an adjacent finding rather than settled here by deleting the section.
 */
const EXEMPT_FILES = new Set([
  resolve(FEATURE_ROOT, "unit-presentation.ts"),
  resolve(FEATURE_ROOT, "public-flow-vocabulary.test.ts"),
  resolve(FEATURE_ROOT, "components/ForeverIntelligenceSection.tsx"),
  // Asserts the absence of the old token, so it has to name it.
  resolve(FEATURE_ROOT, "release-safety-claims.test.ts"),
]);

describe("public project-detail vocabulary", () => {
  const files = sourceFiles(FEATURE_ROOT);

  it("finds the project-detail sources it is meant to police", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  /**
   * F6. The token, the visible label, the accessibility name and the tests all
   * had to change together — a rename that leaves the token behind still ships
   * the claim in the DOM and in any analytics keyed on it.
   */
  it("uses no 'recommended' terminology anywhere in the public flow", () => {
    const offenders: string[] = [];

    for (const file of files) {
      if (EXEMPT_FILES.has(file)) continue;
      const source = readFileSync(file, "utf8");
      source.split(/\r?\n/).forEach((line, index) => {
        if (/recommend/i.test(line)) {
          offenders.push(`${file.replace(FEATURE_ROOT, "")}:${index + 1} — ${line.trim()}`);
        }
      });
    }

    expect(offenders, `unexpected recommendation language:\n${offenders.join("\n")}`).toEqual([]);
  });

  /**
   * F1. A bare "N residences" reads as the size of the development. Every
   * surviving use must carry a listing-scoped qualifier.
   */
  it("never states a bare residence or unit count as project scale", () => {
    const offenders: string[] = [];

    for (const file of files) {
      if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
      const source = readFileSync(file, "utf8");
      source.split(/\r?\n/).forEach((line, index) => {
        // A template literal that prints a count immediately followed by the
        // noun, with no "listed" qualifier in front of it.
        if (/\}\s*(residences|residence)\b/.test(line) && !/listed\s*\$\{|\}\s*listed/.test(line)) {
          offenders.push(`${file.replace(FEATURE_ROOT, "")}:${index + 1} — ${line.trim()}`);
        }
      });
    }

    expect(offenders, `unqualified inventory count:\n${offenders.join("\n")}`).toEqual([]);
  });
});
