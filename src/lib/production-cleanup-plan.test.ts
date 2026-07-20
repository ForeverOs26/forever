import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { KNOWN_FICTITIOUS_PROJECT_SLUGS } from "./public-truth";

/**
 * FOREVER-TRUTH-001A: invariants of the prepared (never executed) production
 * cleanup plan. The plan is documentation, but its SQL is the exact change
 * set an Owner would run — so its safety properties are regression-tested
 * like code.
 */

const PLAN_PATH = join(process.cwd(), "docs", "FOREVER_TRUTH_001A_PRODUCTION_CLEANUP_PLAN.md");

function plan(): string {
  return readFileSync(PLAN_PATH, "utf-8");
}

function sqlBlocks(source: string): string[] {
  return [...source.matchAll(/```sql\n([\s\S]*?)```/g)].map((match) => match[1]);
}

describe("production cleanup plan invariants", () => {
  const source = plan();
  // The preamble quotes the historical 20260718113000 backfill as context;
  // only the plan's own steps (Step 1 onward) contain executable plan SQL.
  const stepsSource = source.slice(source.indexOf("## Step 1"));
  const sql = sqlBlocks(stepsSource);
  const allSql = sql.join("\n");

  it("is explicitly prepared-only and Owner-gated", () => {
    expect(source).toContain("PREPARED ONLY — NOT EXECUTED");
    expect(source).toContain("explicit Owner approval");
  });

  it("targets exactly the six quarantined slugs and never a broad predicate", () => {
    for (const slug of KNOWN_FICTITIOUS_PROJECT_SLUGS) {
      expect(allSql).toContain(slug);
    }
    // Every UPDATE against projects must be slug-scoped.
    const updates = allSql.match(/UPDATE public\.projects[\s\S]*?;/g) ?? [];
    expect(updates.length).toBeGreaterThan(0);
    for (const statement of updates) {
      expect(statement).toMatch(/WHERE slug (IN|=)/);
    }
  });

  it("contains no ellipses or placeholders inside SQL", () => {
    for (const block of sql) {
      expect(block).not.toContain("...");
      expect(block).not.toContain("<same");
      expect(block).not.toContain("same six slugs");
    }
  });

  it("wraps the deactivation in one transaction with row locks and fail-closed checks", () => {
    expect(allSql).toContain("BEGIN;");
    expect(allSql).toContain("COMMIT;");
    expect(allSql).toContain("FOR UPDATE");
    expect(allSql).toContain("RAISE EXCEPTION");
  });

  it("captures pre-change state and restores exact values in rollback", () => {
    expect(source).toContain("pre-change snapshot");
    // Rollback restores per-row values, never a blanket publish-everything.
    const rollbackSection = source.slice(source.indexOf("## Step 5"));
    for (const slug of KNOWN_FICTITIOUS_PROJECT_SLUGS) {
      expect(rollbackSection).toContain(`WHERE slug = '${slug}'`);
    }
    expect(rollbackSection).not.toMatch(/WHERE is_active = true AND public_status/);
  });

  it("never deletes rows or touches leads", () => {
    expect(allSql).not.toContain("DELETE FROM");
    expect(allSql).not.toContain("TRUNCATE");
    expect(allSql).not.toMatch(/UPDATE public\.leads/);
  });

  it("discovers referencing relations instead of assuming a hand-written list", () => {
    expect(allSql).toContain("pg_constraint");
    expect(source).toContain("leads");
    expect(source).toContain("What this inventory cannot see");
  });
});
