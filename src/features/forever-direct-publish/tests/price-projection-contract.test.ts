/**
 * FOREVER-PRODUCTION-ACTIVATION-001 — static contract of the public
 * unit-price projection migration.
 *
 * The SQL text is the artifact under test. These assertions pin the properties
 * that make it safe to apply to production: the private price history gains no
 * public grant, the projection is scoped to one project, it only ever updates
 * (so a replay creates no duplicate price row), currency is respected rather
 * than assumed, and the provenance columns on `buildings` stop being publicly
 * readable.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION_PATH = "supabase/migrations/20260726140000_public_unit_price_projection.sql";
const PRIVACY_PATH = "supabase/migrations/20260723130000_public_projection_privacy.sql";

const sql = readFileSync(resolve(process.cwd(), MIGRATION_PATH), "utf8");
const privacySql = readFileSync(resolve(process.cwd(), PRIVACY_PATH), "utf8");

/** Executable text only, so a comment can never satisfy a security assertion. */
function executable(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

const ddl = executable(sql);
const privacyDdl = executable(privacySql);

describe("public price projection — privacy contract", () => {
  it("never grants the private price history to a public role", () => {
    // The whole point of the projection: unit_price_history stays revoked.
    expect(ddl).not.toMatch(/GRANT[\s\S]{0,120}?ON\s+(TABLE\s+)?public\.unit_price_history/i);
    expect(privacyDdl).toContain(
      "REVOKE SELECT ON TABLE public.unit_price_history FROM anon, authenticated;",
    );
  });

  it("exposes no provenance column of the history table", () => {
    for (const column of ["source_file", "source_page", "price_source", "metadata"]) {
      expect(ddl).not.toMatch(new RegExp(`GRANT[^;]*${column}[^;]*unit_price_history`, "i"));
    }
    // It reads those rows server-side only, inside a service_role-only function.
    expect(ddl).toContain("FROM public.unit_price_history h");
  });

  it("closes the buildings provenance leak while keeping the building code", () => {
    expect(ddl).toContain("REVOKE SELECT ON TABLE public.buildings FROM anon, authenticated;");
    const grant = /GRANT SELECT \(([\s\S]*?)\) ON public\.buildings TO anon, authenticated;/.exec(
      ddl,
    );
    expect(grant).not.toBeNull();
    const columns = grant![1]
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    expect(columns).toContain("building_code");
    // metadata holds field_provenance source_ref URLs. It must not be listed.
    expect(columns).not.toContain("metadata");
  });

  it("grants only the opaque foreign key needed to resolve the building", () => {
    expect(ddl).toContain("GRANT SELECT (building_id) ON public.units TO anon, authenticated;");
    expect(ddl).not.toMatch(/GRANT SELECT \([^)]*\bmetadata\b[^)]*\) ON public\.units/);
  });

  it("keeps both functions service_role only and SECURITY INVOKER", () => {
    expect(ddl).not.toContain("SECURITY DEFINER");
    const projection = "public.forever_project_price_projection(UUID)";
    for (const role of ["PUBLIC", "anon", "authenticated"]) {
      expect(ddl).toContain(`REVOKE ALL ON FUNCTION ${projection} FROM ${role};`);
      expect(ddl).toContain(
        `REVOKE ALL ON FUNCTION public.forever_direct_publish(JSONB, JSONB) FROM ${role};`,
      );
    }
    expect(ddl).toContain(`GRANT EXECUTE ON FUNCTION ${projection} TO service_role;`);
  });

  it("locks the search path on every function it declares", () => {
    const declarations = ddl.match(/CREATE OR REPLACE FUNCTION/g) ?? [];
    const lockedPaths = ddl.match(/SET search_path = ''/g) ?? [];
    expect(declarations.length).toBeGreaterThan(0);
    expect(lockedPaths).toHaveLength(declarations.length);
  });
});

describe("public price projection — publication contract", () => {
  it("projects exactly one current price per unit", () => {
    expect(ddl).toContain("SELECT DISTINCT ON (h.unit_id)");
    // A total, deterministic ordering: newest effective date wins, ties broken.
    expect(ddl).toContain("h.price_list_date DESC NULLS LAST");
    expect(ddl).toContain("h.recorded_at DESC");
    expect(ddl).toContain("h.id DESC");
  });

  it("preserves THB and refuses to restate another currency as baht", () => {
    expect(ddl).toContain("upper(btrim(c.currency)) = 'THB'");
    // The non-THB branch writes NULL rather than a misleading amount.
    expect(ddl).toMatch(/THEN c\.price\s*\n?\s*ELSE NULL/);
  });

  it("creates no price row, so an identical replay duplicates nothing", () => {
    expect(ddl).not.toMatch(/INSERT\s+INTO\s+public\.unit_price_history/i);
    // Idempotence guard: an unchanged price is not rewritten.
    expect(ddl).toContain("u.base_price_thb IS DISTINCT FROM");
  });

  it("touches only the units of the one project being published", () => {
    expect(ddl).toContain("WHERE u.project_id = p_project_id");
    expect(ddl).toContain("AND u.project_id = p_project_id");
    expect(ddl).toContain("project_id_required");
    const unitUpdates = ddl.match(/UPDATE public\.units/g) ?? [];
    expect(unitUpdates).toHaveLength(1);
  });

  it("runs inside the direct-publish transaction, after publication", () => {
    expect(ddl).toContain("v_priced := public.forever_project_price_projection(v_project_id);");
    const publishIndex = ddl.indexOf("UPDATE public.projects");
    const projectIndex = ddl.indexOf("v_priced := public.forever_project_price_projection");
    expect(publishIndex).toBeGreaterThan(-1);
    expect(projectIndex).toBeGreaterThan(publishIndex);
    expect(ddl).toContain("public_prices_projected");
  });

  it("still publishes only the single project the batch names", () => {
    const updates = ddl.match(/UPDATE public\.projects/g) ?? [];
    expect(updates).toHaveLength(1);
    expect(ddl).toContain("WHERE id = v_project_id;");
  });

  it("keeps the Owner direct-publish stamps and the unchanged ingest", () => {
    expect(ddl).toContain("'owner_approved_official'");
    expect(ddl).toContain("source_trust_required");
    expect(ddl).toContain("publication_mode_required");
    expect(ddl).toContain("public.forever_progressive_ingest(batch)");
    expect(ddl).not.toContain("CREATE OR REPLACE FUNCTION public.forever_progressive_ingest");
  });

  it("leaves the shipped direct-publish migration byte-for-byte unedited", () => {
    // Applied/shipped migrations are immutable; this one layers on top.
    const shipped = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260726120000_forever_direct_publish.sql"),
      "utf8",
    );
    expect(shipped).not.toContain("forever_project_price_projection");
    expect(shipped).toContain("CREATE OR REPLACE FUNCTION public.forever_direct_publish");
  });

  it("drops no table and alters no existing table", () => {
    expect(ddl).not.toMatch(/DROP\s+(TABLE|POLICY|COLUMN|INDEX|TRIGGER)/);
    expect(ddl).not.toMatch(/ALTER\s+TABLE/);
  });

  it("documents a real rollback path", () => {
    expect(sql).toContain("DROP FUNCTION IF EXISTS public.forever_project_price_projection(UUID);");
  });

  it("is transactional", () => {
    expect(ddl).toContain("BEGIN;");
    expect(ddl).toContain("COMMIT;");
  });
});

describe("public read path stays inside the granted projection", () => {
  /** Column lists the privacy migration grants to anon/authenticated. */
  function grantedColumns(table: string, source: string): string[] {
    const match = new RegExp(
      `GRANT SELECT \\(([\\s\\S]*?)\\) ON public\\.${table} TO anon, authenticated;`,
    ).exec(source);
    if (!match) throw new Error(`no column grant found for ${table}`);
    return match[1]
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  it("selects only granted unit columns, including the building foreign key", () => {
    const service = readFileSync(
      resolve(process.cwd(), "src/features/project-detail/project-detail-service.ts"),
      "utf8",
    );
    const granted = new Set([...grantedColumns("units", privacySql), "building_id"]);
    const selected = /units:units\(([^)]*)\)/.exec(service);
    expect(selected).not.toBeNull();
    for (const raw of selected![1].split(",")) {
      const column = raw.trim();
      if (!column || column.startsWith("building:")) continue;
      expect(granted.has(column), `units.${column} is selected but not granted`).toBe(true);
    }
  });

  it("embeds only the building code, never building metadata", () => {
    const service = readFileSync(
      resolve(process.cwd(), "src/features/project-detail/project-detail-service.ts"),
      "utf8",
    );
    expect(service).toContain("building:buildings(building_code)");
    expect(service).not.toMatch(/buildings\([^)]*metadata/);
  });

  it("never reads the private price history from the browser data layer", () => {
    for (const path of [
      "src/features/project-detail/project-detail-service.ts",
      "src/lib/project-service.ts",
    ]) {
      const source = readFileSync(resolve(process.cwd(), path), "utf8");
      expect(source).not.toContain("unit_price_history");
    }
  });
});
