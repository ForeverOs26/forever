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
    expect(listSource).not.toMatch(/const SELECT = \`\s*\*/);
    expect(detailSource).not.toMatch(/PROJECT_DETAIL_SELECT = \`\s*\*/);
    expect(detailSource).not.toContain("developer:developers(*)");
    expect(detailSource).not.toContain("media:project_media(*)");
    expect(detailSource).not.toContain("units:units(*)");
    expect(detailSource).not.toContain("investment:investment_data(*)");
  });

  it("keeps provenance-bearing raw rows outside public role grants", () => {
    const migration = read("supabase/migrations/20260723130000_public_projection_privacy.sql");

    expect(migration).toContain("REVOKE SELECT ON TABLE public.projects FROM anon, authenticated");
    expect(migration).toContain("REVOKE SELECT ON TABLE public.units FROM anon, authenticated");
    expect(migration).toContain("REVOKE SELECT ON TABLE public.project_media FROM anon, authenticated");
    expect(migration).toContain("REVOKE SELECT ON TABLE public.unit_price_history FROM anon, authenticated");
    expect(migration).not.toMatch(/GRANT SELECT \([^)]*field_provenance/s);
    expect(migration).not.toMatch(/GRANT SELECT \([^)]*metadata/s);
  });
});
