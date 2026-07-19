import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards against the demo-preview implementation being pulled back into the
 * production client bundle. `ProjectService.listActive` and
 * `ProjectDetailService.getBySlug` are reachable from ordinary public routes
 * (`/navigator`, `/booth`, `/discovery`, `/projects/$slug`), so a plain static
 * `import ... from ".../demo-preview"` in either file would bundle the Coralina
 * preview adapter into production again — as proven by the actual build output
 * before this fix (a `demo-preview-*.js` client chunk containing the Coralina
 * slug and property mapping). The fix routes both call sites through a
 * dynamic import gated directly on `import.meta.env.DEV`, which Vite inlines
 * to the literal `false` in a production build so Rollup's dead-code
 * elimination removes the branch — and the whole demo-preview module graph —
 * entirely. See the production-bundle assertion in this file's sibling
 * artifact scan for the built-output proof.
 */
const PRODUCTION_SERVICE_FILES = [
  "src/lib/project-service.ts",
  "src/features/project-detail/project-detail-service.ts",
];

// Matches a static ES import whose specifier ends in "/demo-preview" (not
// "-constants"), e.g. `import { x } from "./demo-preview";` or the `@/` alias.
const STATIC_DEMO_PREVIEW_IMPORT = /^\s*import\s+[^;]*from\s+["'][^"']*\/demo-preview["'];?\s*$/m;

// The one legal reference: `await import("./demo-preview")` or the `@/` alias,
// dynamically, inside a function.
const DYNAMIC_DEMO_PREVIEW_IMPORT = /\bimport\(\s*["'][^"']*\/demo-preview["']\s*\)/;

describe("demo-preview stays out of production-reachable services", () => {
  it.each(PRODUCTION_SERVICE_FILES)(
    "%s has no static top-level import of the demo-preview implementation",
    (relativePath) => {
      const source = readFileSync(join(process.cwd(), relativePath), "utf-8");
      expect(STATIC_DEMO_PREVIEW_IMPORT.test(source)).toBe(false);
    },
  );

  it.each(PRODUCTION_SERVICE_FILES)(
    "%s only reaches demo-preview through a DEV-guarded dynamic import",
    (relativePath) => {
      const source = readFileSync(join(process.cwd(), relativePath), "utf-8");
      expect(DYNAMIC_DEMO_PREVIEW_IMPORT.test(source)).toBe(true);
      // The dynamic import call must be reachable only when import.meta.env.DEV
      // guards it, so production tree-shaking can eliminate the whole branch.
      expect(source).toMatch(/if \(!import\.meta\.env\.DEV\) return/);
    },
  );

  it("the booth badge imports only the constant, not the preview implementation", () => {
    const source = readFileSync(
      join(process.cwd(), "src/features/navigator/booth/MatchResultCard.tsx"),
      "utf-8",
    );
    expect(source).toContain("demo-preview-constants");
    expect(STATIC_DEMO_PREVIEW_IMPORT.test(source)).toBe(false);
  });
});
