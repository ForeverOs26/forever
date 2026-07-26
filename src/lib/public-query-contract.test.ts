import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), "utf8");
}

function grantedColumns(migration: string, table: string): string[] {
  const match = migration.match(
    new RegExp(
      `GRANT SELECT \\(\\s*([\\s\\S]*?)\\s*\\) ON public\\.${table} TO anon, authenticated;`,
    ),
  );
  expect(match, `column grant for public.${table}`).not.toBeNull();
  return match?.[1].split(",").map((column) => column.trim()) ?? [];
}

describe("public query privacy contract", () => {
  it("uses explicit public project projections rather than wildcard selects", () => {
    const listSource = read("src/lib/project-service.ts");
    const detailSource = read("src/features/project-detail/project-detail-service.ts");

    expect(listSource).toContain("Deliberate public projection");
    expect(listSource).not.toMatch(/const SELECT = `\s*\*/);
    expect(detailSource).not.toMatch(/PROJECT_DETAIL_SELECT = `\s*\*/);
    expect(detailSource).not.toContain("developer:developers(*)");
    expect(detailSource).not.toContain("media:project_media(*)");
    expect(detailSource).not.toContain("units:units(*)");
    expect(detailSource).not.toContain("investment:investment_data(*)");

    for (const column of ["start_date_display", "completion_date_display"]) {
      expect(listSource).toMatch(new RegExp(`\\b${column}\\b`));
    }
    for (const projection of [
      "developer:developers(id, name, description, website, logo_url)",
      "media:project_media(id, media_type, title, url, sort_order)",
      "units:units(id, unit_code, unit_type, bedrooms, bathrooms, size_sqm, floor, view_type, ownership_type, base_price_thb, discounted_price_thb, price_per_sqm, availability_status, payment_plan, furniture_package, rental_guarantee, roi_estimate, notes, building:buildings(building_code))",
      "investment:investment_data(id, project_id, unit_id, expected_daily_rate, expected_monthly_rent, expected_yearly_rent, occupancy_rate, annual_roi_percent, guaranteed_rental_percent, guarantee_years, management_company, notes, created_at)",
    ]) {
      expect(detailSource).toContain(projection);
    }
    expect(detailSource).not.toMatch(/contact_(name|phone|email)/);
    // The building embed exists only to name a unit's building. `buildings`
    // still carries field_provenance in `metadata`, so it must never widen.
    expect(detailSource).not.toContain("buildings(*)");
    expect(detailSource).not.toMatch(/buildings\([^)]*\bmetadata\b/);
  });

  it("restricts the buildings projection the detail query now reads", () => {
    const raw = read("supabase/migrations/20260726140000_public_unit_price_projection.sql");
    // Executable text only: the documented rollback restores the broad grant in
    // a comment, and a comment must never satisfy or break a grant assertion.
    const migration = raw
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");

    // Reading buildings publicly is only safe once the broad table grant from
    // 20260707101000 is replaced by a presentation-column grant.
    expect(migration).toContain("REVOKE SELECT ON TABLE public.buildings FROM anon, authenticated;");
    const columns = grantedColumns(migration, "buildings");
    for (const key of ["id", "project_id", "building_code"]) expect(columns).toContain(key);
    expect(columns).not.toContain("metadata");
    expect(migration).not.toMatch(
      /GRANT\s+SELECT\s+ON(?:\s+TABLE)?\s+public\.buildings\s+TO\s+anon/i,
    );

    // The join key, and nothing more, is added to the units grant.
    expect(migration).toContain("GRANT SELECT (building_id) ON public.units TO anon, authenticated;");
    expect(migration).not.toMatch(/GRANT SELECT \([^)]*\bmetadata\b[^)]*\) ON public\.units/);

    // The private price history is projected, never exposed.
    expect(migration).not.toMatch(/GRANT[\s\S]{0,120}?ON\s+(TABLE\s+)?public\.unit_price_history/i);
  });

  it("keeps provenance-bearing raw rows outside public role grants", () => {
    const migration = read("supabase/migrations/20260723130000_public_projection_privacy.sql");

    expect(migration).toContain("REVOKE SELECT ON TABLE public.projects FROM anon, authenticated");
    expect(migration).toContain("REVOKE SELECT ON TABLE public.units FROM anon, authenticated");
    expect(migration).toContain(
      "REVOKE SELECT ON TABLE public.developers FROM anon, authenticated",
    );
    expect(migration).toContain(
      "REVOKE SELECT ON TABLE public.investment_data FROM anon, authenticated",
    );
    expect(migration).toContain("start_date_display, completion_date_display");
    expect(migration).toContain("id, name, description, website, logo_url");
    expect(migration).toContain(
      "REVOKE SELECT ON TABLE public.project_media FROM anon, authenticated",
    );
    expect(migration).toContain(
      "REVOKE SELECT ON TABLE public.unit_price_history FROM anon, authenticated",
    );
    expect(migration).not.toMatch(/GRANT SELECT \([^)]*field_provenance/s);
    expect(migration).not.toMatch(/GRANT SELECT \([^)]*metadata/s);
    expect(migration).not.toMatch(/GRANT SELECT \([^)]*contact_(name|phone|email)/s);
  });

  it("grants relationship and RLS keys without restoring table-wide SELECT", () => {
    const migration = read("supabase/migrations/20260723130000_public_projection_privacy.sql");
    const relationshipKeys = {
      projects: ["id", "developer_id", "public_status"],
      developers: ["id"],
      units: ["id", "project_id"],
      project_media: ["id", "project_id"],
      investment_data: ["id", "project_id"],
    } as const;

    for (const [table, keys] of Object.entries(relationshipKeys)) {
      const columns = grantedColumns(migration, table);
      for (const key of keys) expect(columns).toContain(key);
      expect(migration).not.toMatch(
        new RegExp(`GRANT\\s+SELECT\\s+ON(?:\\s+TABLE)?\\s+public\\.${table}\\b`, "i"),
      );
    }

    const listSource = read("src/lib/project-service.ts");
    const detailSource = read("src/features/project-detail/project-detail-service.ts");
    expect(listSource).not.toMatch(/\bdeveloper_id\b|\bproject_id\b/);
    expect(detailSource).not.toContain("developer_id");
    expect(detailSource).not.toContain("units:units(id, project_id");
    expect(detailSource).not.toContain("media:project_media(id, project_id");
  });
});
