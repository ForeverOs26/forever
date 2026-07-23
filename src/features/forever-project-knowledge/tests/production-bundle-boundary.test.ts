import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const INTERNAL_KNOWLEDGE_ROUTES = [
  "src/routes/internal.coralina.tsx",
  "src/routes/internal.projects.$slug.tsx",
];

const STATIC_CATALOG_IMPORT =
  /^\s*import\s+[^;]*from\s+["'][^"']*\/forever-project-knowledge\/catalog["'];?\s*$/m;
const DYNAMIC_CATALOG_IMPORT =
  /\bimport\(\s*["'][^"']*\/forever-project-knowledge\/catalog["']\s*\)/;

describe("internal project knowledge stays out of the production client bundle", () => {
  it.each(INTERNAL_KNOWLEDGE_ROUTES)(
    "%s reaches private-source definitions only through a direct DEV guard",
    (relativePath) => {
      const source = readFileSync(join(process.cwd(), relativePath), "utf8");
      const guardIndex = source.indexOf("if (import.meta.env.DEV)");
      const importIndex = source.search(DYNAMIC_CATALOG_IMPORT);

      expect(STATIC_CATALOG_IMPORT.test(source)).toBe(false);
      expect(guardIndex).toBeGreaterThanOrEqual(0);
      expect(importIndex).toBeGreaterThan(guardIndex);
      expect(source).toMatch(
        /if \(import\.meta\.env\.DEV\) \{[\s\S]*?await import\([\s\S]*?forever-project-knowledge\/catalog/,
      );
      expect(source.slice(importIndex)).toContain("throw notFound()");
    },
  );
});
