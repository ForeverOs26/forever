import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { KNOWN_FICTITIOUS_PROJECT_SLUGS } from "./public-truth";

/**
 * FOREVER-TRUTH-001A: invariants of the prepared (never executed) production
 * cleanup plan. The plan is documentation, but its SQL is the exact change
 * set an Owner would run — so its safety properties are regression-tested
 * like code:
 *
 * - deactivation and rollback are single transactions whose checks
 *   `RAISE EXCEPTION` (database-enforced abort) rather than relying on an
 *   operator comparing SELECT output by eye;
 * - the rollback restores only values bound from the reviewed Step 1b
 *   snapshot, shipped as an inert template (placeholder ids that can never
 *   match production);
 * - unrelated projects are compared value-by-value, not merely counted; and
 * - a table-level mutation boundary protects snapshots and identities through
 *   COMMIT, rather than relying on the timing of row locks or verification.
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
  const step3 = stepsSource.slice(
    stepsSource.indexOf("## Step 3"),
    stepsSource.indexOf("## Step 4"),
  );
  const step5 = stepsSource.slice(stepsSource.indexOf("## Step 5"));
  const step5Sql = sqlBlocks(step5).join("\n");
  const step3Sql = sqlBlocks(step3).join("\n");

  it("is explicitly prepared-only and Owner-gated", () => {
    expect(source).toContain("PREPARED ONLY — NOT EXECUTED");
    expect(source).toContain("explicit Owner approval");
  });

  it("targets exactly the six quarantined slugs and never a broad predicate", () => {
    for (const slug of KNOWN_FICTITIOUS_PROJECT_SLUGS) {
      expect(allSql).toContain(slug);
    }
    const updates = allSql.match(/UPDATE public\.projects[\s\S]*?;/g) ?? [];
    expect(updates.length).toBeGreaterThan(0);
    for (const statement of updates) {
      // Slug-scoped deactivation or snapshot-id-scoped rollback — never a
      // status-based or unconditional predicate.
      expect(statement).toMatch(/WHERE slug IN|WHERE p\.id = s\.id/);
    }
  });

  it("contains no ellipses or placeholders inside SQL", () => {
    for (const block of sql) {
      expect(block).not.toContain("...");
      expect(block).not.toContain("<same");
      expect(block).not.toContain("same six slugs");
    }
  });

  it("deactivation locks the projects table before its snapshot and identity check", () => {
    expect(step3Sql).toContain("BEGIN;");
    expect(step3Sql).toContain("COMMIT;");
    expect(step3Sql).toContain("LOCK TABLE public.projects IN SHARE ROW EXCLUSIVE MODE;");
    expect(step3Sql).toContain("FOR UPDATE");
    const tableLock = step3Sql.indexOf("LOCK TABLE public.projects IN SHARE ROW EXCLUSIVE MODE;");
    expect(tableLock).toBeGreaterThan(step3Sql.indexOf("BEGIN;"));
    expect(tableLock).toBeLessThan(step3Sql.indexOf("truth001a_untargeted_before"));
    expect(tableLock).toBeLessThan(step3Sql.indexOf("SELECT count(*) INTO matched"));
  });

  it("deactivation runs in one transaction with database-enforced aborts", () => {
    expect((step3Sql.match(/RAISE EXCEPTION/g) ?? []).length).toBeGreaterThanOrEqual(2);
    // Identity verification happens before the UPDATE, final verification
    // before COMMIT.
    expect(step3Sql.indexOf("RAISE EXCEPTION")).toBeLessThan(
      step3Sql.indexOf("UPDATE public.projects"),
    );
    expect(step3Sql.lastIndexOf("RAISE EXCEPTION")).toBeLessThan(step3Sql.indexOf("COMMIT;"));
  });

  it("compares unrelated projects value-by-value, not only by count, and aborts on drift", () => {
    expect(step3Sql).toContain("truth001a_untargeted_before");
    expect(step3Sql).toContain("EXCEPT");
    expect(step3Sql).toContain("unrelated_changed");
    // The unrelated-row invariant participates in the abort condition.
    expect(step3Sql).toMatch(/unrelated_changed <> 0[\s\S]*?RAISE EXCEPTION/);
    // No notice-only escape hatch anywhere in the write transactions.
    expect(step3Sql).not.toContain("RAISE NOTICE");
    expect(step5Sql).not.toContain("RAISE NOTICE");
  });

  it("rollback restores only snapshot-bound values through an inert template", () => {
    expect(step5Sql).toContain("truth001a_rollback_snapshot");
    // Restoration reads captured values, never literals.
    expect(step5Sql).toMatch(/SET is_active = s\.is_active/);
    expect(step5Sql).toMatch(/is_featured = s\.is_featured/);
    expect(step5Sql).toMatch(/public_status = s\.public_status/);
    expect(step5Sql).not.toMatch(/SET is_active = true/);
    expect(step5Sql).not.toMatch(/public_status = 'published'/);
    // The shipped template is inert: placeholder ids cannot match production.
    expect(step5Sql).toContain("00000000-0000-0000-0000-000000000001");
    expect(step5).toContain("Step 1b");
    // All six slugs are bound into the snapshot.
    for (const slug of KNOWN_FICTITIOUS_PROJECT_SLUGS) {
      expect(step5Sql).toContain(`'${slug}'`);
    }
  });

  it("rollback verifies identities before modifying and exact values before COMMIT", () => {
    const tableLock = step5Sql.indexOf("LOCK TABLE public.projects IN SHARE ROW EXCLUSIVE MODE;");
    expect(tableLock).toBeGreaterThan(step5Sql.indexOf("BEGIN;"));
    expect(tableLock).toBeLessThan(step5Sql.indexOf("CREATE TEMPORARY TABLE"));
    expect(tableLock).toBeLessThan(step5Sql.indexOf("SELECT count(*) INTO snapshot_rows"));
    expect((step5Sql.match(/RAISE EXCEPTION/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(step5Sql.indexOf("RAISE EXCEPTION")).toBeLessThan(
      step5Sql.indexOf("UPDATE public.projects"),
    );
    // Exact-value verification of all six rows precedes COMMIT.
    expect(step5Sql).toMatch(/restored <> 6[\s\S]*?RAISE EXCEPTION/);
    expect(step5Sql.lastIndexOf("RAISE EXCEPTION")).toBeLessThan(step5Sql.indexOf("COMMIT;"));
    // No manual compare-then-commit instruction anywhere in the rollback.
    expect(step5).not.toMatch(/[Cc]ompare against .* before COMMIT/);
    expect(step5).not.toMatch(/ROLLBACK on any difference/);
  });

  it("never deletes rows or touches leads, developers, media, units, or prices", () => {
    expect(allSql).not.toContain("DELETE FROM");
    expect(allSql).not.toContain("TRUNCATE");
    for (const table of ["leads", "developers", "project_media", "units", "unit_price_history"]) {
      expect(allSql).not.toMatch(new RegExp(`UPDATE public\\.${table}`));
    }
  });

  it("discovers referencing relations instead of assuming a hand-written list", () => {
    expect(allSql).toContain("pg_constraint");
    expect(source).toContain("leads");
    expect(source).toContain("What this inventory cannot see");
  });
});
