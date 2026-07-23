import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), "utf8");
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
      "units:units(id, unit_code, unit_type, bedrooms, bathrooms, size_sqm, floor, view_type, ownership_type, base_price_thb, discounted_price_thb, price_per_sqm, availability_status, payment_plan, furniture_package, rental_guarantee, roi_estimate, notes)",
      "investment:investment_data(id, project_id, unit_id, expected_daily_rate, expected_monthly_rent, expected_yearly_rent, occupancy_rate, annual_roi_percent, guaranteed_rental_percent, guarantee_years, management_company, notes, created_at)",
    ]) {
      expect(detailSource).toContain(projection);
    }
    expect(detailSource).not.toMatch(/contact_(name|phone|email)/);
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
});
