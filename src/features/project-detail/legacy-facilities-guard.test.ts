/**
 * The legacy-table boundary (FOREVER-STUDIO-AMENITIES-CORE-001).
 *
 * `public.facilities` and `public.project_facilities` exist. FDB-001 created
 * them in `20260707101000_fdb001_inventory_facilities.sql`, they carry live
 * row-level security, and `project_facilities` even carries the same
 * `sort_order INTEGER NOT NULL DEFAULT 0` this task adds to
 * `project_amenities`. This file does not claim they are absent, and it does not
 * ask for them to be dropped — deprecating a table needs proof no branch is
 * about to write it, which is a separate piece of work.
 *
 * What it does claim, and prove, is narrower: no ACTIVE application code reads
 * them, writes them, defines an RPC against them, or presents them as the
 * canonical Studio amenity model. The canonical model is `amenities` /
 * `project_amenities`, and the amenities editor added by this task writes only
 * to that one.
 *
 * WHAT THIS DELIBERATELY DOES NOT SCAN
 * ------------------------------------
 * Three exclusions, each because scanning it would be wrong rather than
 * inconvenient:
 *
 *   1. `supabase/migrations/**` — migration history is immutable and legitimately
 *      contains the DDL that creates both tables. A guard that failed on it
 *      would be demanding the history be rewritten.
 *   2. Migration-contract and security-contract tests — the files whose whole
 *      purpose is to name these tables and assert something true about them.
 *      `src/features/forever-ingestion/tests/migration-contract.test.ts` lists
 *      `"public.project_facilities"` among the tables whose public SELECT policy
 *      must require a published active parent. That assertion protects the
 *      legacy tables' security and must keep working.
 *   3. This file, which states the rule.
 *
 * It also matches on QUALIFIED and STRUCTURAL forms only, never the bare word
 * "facilities". That word appears legitimately in at least four unrelated
 * places: the denormalised `projects.facilities TEXT[]` column, a
 * `forever-project-database` section id, Coralina and Modeva source-document
 * names, and `source_category` values in project data. A naive match on the
 * word alone reports dozens of false positives and gets switched off, which is
 * worse than no guard.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const SRC = resolve(root, "src");

/** Posix-style repo-relative path, so the exclusions read the same on Windows. */
function repoPath(file: string): string {
  return relative(root, file).split("\\").join("/");
}

/**
 * Files that legitimately name the legacy tables, each for a stated reason.
 * A new entry here needs a reason of the same kind — "the test that pins the
 * legacy tables' security contract" — not "the guard was failing".
 */
const CONTRACT_FILES = new Set([
  // Migration-contract test: asserts the legacy link table's public SELECT
  // policy requires a published active parent project.
  "src/features/forever-ingestion/tests/migration-contract.test.ts",
  // The amenities architecture contract: states which model is canonical.
  "src/features/project-detail/amenities-contract.test.tsx",
  // This file.
  "src/features/project-detail/legacy-facilities-guard.test.ts",
]);

/**
 * Structural references to the legacy tables — the forms that would mean active
 * code is actually reaching them.
 */
const FORBIDDEN: { pattern: RegExp; why: string }[] = [
  { pattern: /\bproject_facilities\b/, why: "names the legacy link table" },
  { pattern: /\bfacility_id\b/, why: "names the legacy link column" },
  { pattern: /\bpublic\.facilities\b/, why: "names the legacy catalogue table" },
  {
    pattern: /\bfrom\(\s*["'`]facilities["'`]\s*\)/,
    why: "reads or writes the legacy catalogue table through the client",
  },
  {
    pattern: /\brpc\(\s*["'`][a-z_]*facilit/i,
    why: "calls an RPC named for the legacy model",
  },
  {
    pattern: /\b(?:CREATE|REPLACE)\s+FUNCTION\s+[a-z_.]*facilit/i,
    why: "defines a function named for the legacy model",
  },
  { pattern: /\bProjectFacilit/, why: "types the legacy model" },
  { pattern: /\bmapProjectFacilities\b/, why: "maps the legacy model" },
];

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(full));
      continue;
    }
    if ([".ts", ".tsx"].includes(extname(entry))) found.push(full);
  }
  return found;
}

describe("no active code treats the legacy facilities tables as the amenity model", () => {
  it("finds no structural reference to them anywhere under src, outside the contract tests", () => {
    const offences: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const path = repoPath(file);
      if (CONTRACT_FILES.has(path)) continue;
      const source = readFileSync(file, "utf8");

      for (const { pattern, why } of FORBIDDEN) {
        if (pattern.test(source)) offences.push(`${path}: ${why} (${pattern})`);
      }
    }

    expect(offences, offences.join("\n")).toEqual([]);
  });

  it("keeps the canonical model reachable, so the guard is not passing vacuously", () => {
    // A guard that would also pass if the amenities feature were deleted proves
    // nothing. These two assertions make it fail in that case.
    const service = readFileSync(
      resolve(SRC, "features/project-detail/project-detail-service.ts"),
      "utf8",
    );
    expect(service).toContain("amenities:project_amenities(");

    const migrations = resolve(root, "supabase/migrations");
    const editor = readdirSync(migrations).filter((entry) =>
      entry.includes("studio_project_amenities_editor"),
    );
    expect(editor).toHaveLength(1);
    const sql = readFileSync(join(migrations, editor[0]), "utf8");
    expect(sql).toContain("public.studio_save_project_amenities");
  });

  it("writes nothing to the legacy tables from the new save path", () => {
    const migrations = resolve(root, "supabase/migrations");
    const editor = readdirSync(migrations).filter((entry) =>
      entry.includes("studio_project_amenities_editor"),
    );
    const statements = readFileSync(join(migrations, editor[0]), "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");

    // The whole migration, DDL and function body alike, never mentions them.
    expect(statements).not.toMatch(/\bproject_facilities\b/);
    expect(statements).not.toMatch(/\bfacility_id\b/);
    expect(statements).not.toMatch(/\bpublic\.facilities\b/);
  });

  it("leaves the legacy tables' own security contract asserted elsewhere intact", () => {
    // Named explicitly so that deleting that assertion — the thing this guard
    // deliberately does not scan — cannot go unnoticed.
    const contract = readFileSync(
      resolve(SRC, "features/forever-ingestion/tests/migration-contract.test.ts"),
      "utf8",
    );
    expect(contract).toContain('"public.project_facilities"');
    expect(contract).toContain('"public.project_amenities"');
  });
});
