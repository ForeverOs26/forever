import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the local no-write lead demo mode out of production behavior.
 *
 * The demo branch in `submitLead` and every demo-mode UI note must sit behind
 * a literal `import.meta.env.DEV` guard. Vite inlines that to `false` in a
 * production build, so dead-code elimination removes the branch, the demo-mode
 * strings, and (with no remaining references) the `isDemoLeadModeEnabled`
 * helper itself — leaving the production lead write path unchanged.
 */
const read = (relativePath: string) => readFileSync(join(process.cwd(), relativePath), "utf-8");

describe("lead demo mode stays out of production behavior", () => {
  it("submitLead skips the write only behind a literal DEV guard", () => {
    const source = read("src/lib/lead-service.ts");
    expect(source).toMatch(/if \(import\.meta\.env\.DEV && isDemoLeadModeEnabled\(\)\)/);
    // The production write path is still present and unconditional otherwise.
    expect(source).toContain('await supabase.from("leads").insert(payload)');
  });

  it.each(["src/components/ContactForm.tsx", "src/features/navigator/booth/BoothNavigator.tsx"])(
    "%s renders demo-mode notes only behind a literal DEV guard",
    (relativePath) => {
      const source = read(relativePath);
      const uses = source.match(/isDemoLeadModeEnabled\(\)/g) ?? [];
      const guardedUses =
        source.match(/import\.meta\.env\.DEV && isDemoLeadModeEnabled\(\)/g) ?? [];
      expect(uses.length).toBeGreaterThan(0);
      expect(guardedUses.length).toBe(uses.length);
    },
  );

  it("no second lead flow exists: demo mode lives inside the one submitLead path", () => {
    const source = read("src/lib/lead-service.ts");
    // A single exported submit function, and exactly one leads insert call.
    expect(source.match(/export async function submitLead/g)).toHaveLength(1);
    expect(source.match(/from\("leads"\)/g)).toHaveLength(1);
  });
});
