import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "scripts/production");
const read = (name: string) => readFileSync(resolve(root, name), "utf8");

describe("tracked Progressive production verification harness", () => {
  it("keeps one tracked orchestration entry point and no runtime-only logic", () => {
    const entries = readdirSync(root).filter((name) => /^verify-progressive.*\.ps1$/i.test(name));
    expect(entries).toEqual(["verify-progressive-ingestion-production.ps1"]);
  });

  it("passes dynamic smoke values through a temporary context table", () => {
    const smoke = read("progressive-ingestion-smoke.sql");
    expect(smoke).toContain("CREATE TEMP TABLE progressive_smoke_context");
    expect(smoke).toContain("SMOKE_EXPLICIT_ROLLBACK_COMPLETE");
    expect(smoke).toContain("'buildings', '[]'::jsonb");
    expect(smoke).toContain("'units', '[]'::jsonb");
    expect(smoke).toContain("'prices', '[]'::jsonb");
    expect(smoke).toContain("'media', '[]'::jsonb");
  });

  it("has no quoted psql variable reference in a dollar-quoted body", () => {
    for (const name of readdirSync(root).filter((item) => item.endsWith(".sql"))) {
      const sql = read(name);
      for (const block of sql.matchAll(/(\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)[\s\S]*?\1/g)) {
        expect(block[0], name).not.toMatch(/:'[A-Za-z_][A-Za-z0-9_]*'/);
      }
    }
  });

  it("always runs an independent residue connection after a possible smoke call", () => {
    const harness = read("verify-progressive-ingestion-production.ps1");
    expect(harness).toContain("06-zero-residue-after-failed-smoke");
    expect(harness).toContain("SMOKE FAILED AND ZERO RESIDUE CONFIRMED");
    expect(harness).toContain("RESIDUE DETECTED");
    expect(harness).toContain("06-zero-residue-after-missing-marker");
  });

  it("uses exit codes, separate sanitized streams, and JSON-first migration parsing", () => {
    const harness = read("verify-progressive-ingestion-production.ps1");
    expect(harness).toContain("RedirectStandardOutput = $true");
    expect(harness).toContain("RedirectStandardError = $true");
    expect(harness).toContain("ExitCode = $exitCode");
    expect(harness).toContain("$format = 'json'");
    expect(harness).toContain("$format = 'legacy-table'");
    expect(harness).toContain("Duplicate local migration version");
    expect(harness).toContain("Unexpected remote-only migration versions");
  });

  it("types catalog chars and deterministically orders every row hash", () => {
    const baseline = read("progressive-ingestion-baseline.sql");
    expect(baseline).toContain("c.relkind::text");
    expect(baseline).toContain("c.relpersistence::text");
    expect(baseline).toContain("p.prokind::text");
    expect(baseline).toContain("ORDER BY row_json");
    expect(baseline).toContain("pg_catalog.pg_get_functiondef(p.oid)");
    expect(baseline).toContain("p.prokind::text IN ('f', 'p')");
    expect(baseline).toContain("'strict_object_sha256'");
    expect(baseline).toContain("'visibility'");
  });

  it("never uses pg_stat_ssl as the client TLS gate", () => {
    const harness = read("verify-progressive-ingestion-production.ps1");
    expect(harness).toContain("\\conninfo");
    expect(harness).not.toContain("pg_stat_ssl");
  });

  it("pins the immutable migration and PostgreSQL 17.6 owner gate", () => {
    const harness = read("verify-progressive-ingestion-production.ps1");
    const preflight = read("progressive-ingestion-preflight.sql");
    expect(harness).toContain(
      "579234319127c36fa2a203b26d81bdfd86c8d01e8c001e45aa96f9d511632b56",
    );
    expect(preflight).toContain("[owner_gate]");
    expect(preflight).toContain("<> 170006");
  });

  it("runs the RPC as service_role and verifies complete independent residue", () => {
    const smoke = read("progressive-ingestion-smoke.sql");
    const residue = read("progressive-ingestion-zero-residue.sql");
    expect(smoke).toContain("SET LOCAL ROLE service_role");
    expect(smoke).toContain("SMOKE_INSIDE_JSON");
    expect(residue).toContain("forever_import.import_execution_approvals");
    expect(residue).toContain("forever_import.import_execution_receipts");
    expect(residue).toContain("public.unit_price_history");
    expect(residue).toContain("RESIDUE_JSON");
  });

  it("emits sanitized JSON and Markdown evidence and gates TLS bypass to loopback", () => {
    const harness = read("verify-progressive-ingestion-production.ps1");
    expect(harness).toContain("function Protect-Evidence");
    expect(harness).toContain("'result.json'");
    expect(harness).toContain("'report.md'");
    expect(harness).toContain("Production verification requires TLS verify-full.");
    expect(harness).toContain("TLS may only be disabled for a disposable loopback database.");
  });
});
