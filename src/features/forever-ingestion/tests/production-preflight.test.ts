import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const preflight = readFileSync(
  "scripts/production/progressive-ingestion-preflight.sql",
  "utf8",
);
const progressiveMigration = readFileSync(
  "supabase/migrations/20260718113000_progressive_ingestion_v1.sql",
  "utf8",
);
const strictMigration = readFileSync(
  "supabase/migrations/20260715120000_rc55d_import_execution_boundary.sql",
  "utf8",
);
const legacyWriter = readFileSync("src/import/persistence-projection.ts", "utf8");
const arrayAggRegression = readFileSync(
  "scripts/production/tests/progressive-ingestion-array-agg-regression.sql",
  "utf8",
);

describe("progressive production preflight", () => {
  it("is transactionally read-only, rerunnable, and stops on named failures", () => {
    expect(preflight).toContain("\\set ON_ERROR_STOP on");
    expect(preflight).toContain("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;");
    expect(preflight).toContain("ROLLBACK;");
    expect(preflight).not.toMatch(
      /^(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT|REVOKE)\b/im,
    );
    expect(preflight).toContain("[partial_progressive_state]");
  });

  it("uses the correct function catalog type and never casts regprocedure to regclass", () => {
    expect(preflight).toContain("to_regprocedure('public.set_updated_at()')");
    expect(preflight).toContain("to_regprocedure('public.forever_progressive_ingest(jsonb)')");
    expect(preflight).not.toMatch(/regprocedure\s*::\s*regclass/i);
  });

  it("inspects only ordinary routines and never asks for aggregate function definitions", () => {
    expect(preflight).toMatch(/p\.prokind IN \('f', 'p'\)/);
    expect(preflight).toContain("pg_get_function_identity_arguments(p.oid)");
    expect(preflight).not.toContain("pg_get_functiondef");
    expect(arrayAggRegression).toContain("p.prokind = 'a'");
    expect(arrayAggRegression).toContain("n.nspname = 'pg_catalog'");
    expect(arrayAggRegression).toContain("p.proname = 'array_agg'");
    expect(arrayAggRegression).toContain("SQLSTATE '42809'");
  });

  it("covers every required rollout check", () => {
    for (const check of [
      "[identity]", "[migration_history]", "[required_tables]", "[required_columns]",
      "[required_functions]", "[drop_policy_targets]", "[project_media_duplicates]",
      "[sha256_bytea]", "[currency_shape]", "[strict_currency_writers]",
      "[partial_progressive_state]", "[visibility]", "[baseline_counts]",
      "[strict_execution_inventory]",
    ]) expect(preflight).toContain(check);
  });

  it("keeps known strict writers explicit about unit-price currency", () => {
    expect(strictMigration).toMatch(
      /INSERT INTO public\.unit_price_history\s*\([\s\S]*?currency[\s\S]*?\)\s*VALUES/i,
    );
    expect(legacyWriter).toMatch(/currency:\s*row\.currency/);
  });

  it("keeps RC5.6P out of the automatic chain without changing progressive SQL", () => {
    const migrations = readdirSync("supabase/migrations");
    expect(migrations).not.toContain(
      "20260718100000_coralina_prerequisite_execution_boundary.sql",
    );
    expect(
      migrations.filter(
        (name) => name.slice(0, 14) > "20260715120000",
      ),
    ).toEqual([
      "20260718113000_progressive_ingestion_v1.sql",
    ]);
    expect(progressiveMigration).not.toContain("prerequisite_execution");
    expect(progressiveMigration).not.toContain("forever_import.");
    expect(progressiveMigration).not.toContain("forever_execution.");
  });
});
