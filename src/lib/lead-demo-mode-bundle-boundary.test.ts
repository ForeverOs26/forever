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
    expect(source).toMatch(/import\.meta\.env\.DEV/);
    expect(source).toContain('import.meta.env.VITE_DEMO_LEAD_MODE === "true"');
    // The production write path is still present and unconditional otherwise.
    expect(source).toContain('await supabase.from("leads").insert(payload)');
  });

  it.each([
    "src/components/ContactForm.tsx",
    "src/features/navigator/booth/BoothLeadForm.tsx",
    "src/features/navigator/booth/BoothNavigator.tsx",
    "src/features/navigator/booth/ResetConfirmDialog.tsx",
  ])("%s renders demo-mode notes only behind a literal DEV guard", (relativePath) => {
    const source = read(relativePath);
    expect(source).toMatch(/import\.meta\.env\.DEV/);
    expect(source).toContain('import.meta.env.VITE_DEMO_LEAD_MODE === "true"');
    expect(source).not.toContain("partner-demo-mode");
  });

  it("public shells do not statically import the Partner Demo helper", () => {
    for (const relativePath of [
      "src/components/ContactForm.tsx",
      "src/components/layout/Header.tsx",
      "src/components/layout/Footer.tsx",
      "src/routes/contact.tsx",
      "src/routes/index.tsx",
      "src/routes/projects.index.tsx",
      "src/lib/lead-service.ts",
    ]) {
      expect(read(relativePath)).not.toContain("partner-demo-mode");
    }
  });

  it("no second lead flow exists: demo mode lives inside the one submitLead path", () => {
    const source = read("src/lib/lead-service.ts");
    // A single exported submit function, and exactly one leads insert call.
    expect(source.match(/export async function submitLead/g)).toHaveLength(1);
    expect(source.match(/from\("leads"\)/g)).toHaveLength(1);
  });

  it("logs no guest or contact payload in the no-write branch", () => {
    const source = read("src/lib/lead-service.ts");
    expect(source).not.toContain("payload.name");
    expect(source).not.toMatch(/console\.(?:info|log).*payload/);
  });
});
