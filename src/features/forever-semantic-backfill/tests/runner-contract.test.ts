/**
 * Properties of the two runners, asserted by reading their own bytes.
 *
 * The claims these tests cover are the kind that decay silently: "this file
 * only ever reads", "there is no default connection string", "staging is
 * refused". Each of them is one careless edit away from being false, and none
 * of them can be observed from the outside without pointing the tool at a real
 * database. Reading the source is the cheapest honest check.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = process.cwd();
const CAPTURE = readFileSync(join(REPO, "scripts/media/capture-production-snapshot.mjs"), "utf8");
const CONTROLLER = readFileSync(join(REPO, "scripts/media/semantic-backfill.mjs"), "utf8");
const GATE = readFileSync(join(REPO, "scripts/media/role-completeness-report.mjs"), "utf8");
const PACKAGE_JSON = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));

describe("the snapshot capture runner is read-only", () => {
  it("contains none of the four mutating HTTP verbs", () => {
    for (const verb of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(new RegExp(`\\b${verb}\\b`).test(CAPTURE), verb).toBe(false);
    }
  });

  it("has exactly two network call sites", () => {
    expect(CAPTURE.match(/\bfetch\(/g) ?? []).toHaveLength(2);
  });

  it("hardcodes both methods rather than taking them as parameters", () => {
    expect(CAPTURE).toContain('method: "GET"');
    expect(CAPTURE).toContain('method: "HEAD"');
    // Every `method:` in the file must be one of those two literals. A method
    // that arrives as a variable is one careless caller away from a write.
    const all = CAPTURE.match(/method:/g) ?? [];
    const literal = CAPTURE.match(/method: "(?:GET|HEAD)"/g) ?? [];
    expect(literal).toHaveLength(all.length);
  });

  it("never selects metadata or title", () => {
    // metadata carries source paths, package directories and sanitizer records.
    // A column that was never read cannot leak.
    const selects = CAPTURE.match(/select=[^&"`]+/g) ?? [];
    expect(selects.length).toBeGreaterThan(0);
    for (const select of selects) {
      expect(select).not.toContain("metadata");
      expect(select).not.toContain("title");
    }
  });

  it("asserts the production ref by literal, and refuses staging by literal", () => {
    expect(CAPTURE).toContain('const PRODUCTION_PROJECT_REF = "abtvsrcnfwlbawvrjeed"');
    expect(CAPTURE).toContain('const REFUSED_PROJECT_REF = "garjibjhlzeljsnpzisu"');
    expect(CAPTURE).toContain("if (ref !== PRODUCTION_PROJECT_REF)");
  });

  it("never prints a credential", () => {
    expect(CAPTURE).not.toMatch(/console\.log\([^)]*\bkey\b/);
    expect(CAPTURE).toContain("Refusing to write: the snapshot would carry a credential.");
  });
});

describe("the controller has no default target", () => {
  it("reads a connection string only from --database-url or its own named variable", () => {
    expect(CONTROLLER).toContain(
      'arg("database-url") ?? process.env.FOREVER_SEMANTIC_BACKFILL_DATABASE_URL',
    );
    // The failure mode of a convenient default here is a production write
    // somebody meant to aim at a copy.
    expect(CONTROLLER).not.toMatch(/process\.env\.DATABASE_URL/);
    expect(CONTROLLER).not.toMatch(/process\.env\.SUPABASE_DB_URL/);
    expect(CONTROLLER).not.toMatch(/dotenv|\.env["']/);
  });

  it("offers no --force", () => {
    expect(CONTROLLER).not.toContain('flag("force")');
    expect(CONTROLLER).toContain("There is no --force.");
  });

  it("requires the production marker and the typed ref for a write", () => {
    // `--dry-run` is deliberately NOT subtracted here. It issues the real BEGIN
    // and the real UPDATE before rolling back, so it is authorised as the
    // write-shaped contact with the target that it is. The earlier
    // `execute && !dryRun` let a dry run reach production with no marker at all.
    expect(CONTROLLER).toContain('opensTransaction: command === "execute"');
    expect(CONTROLLER).toContain('arg("confirm-project-ref")');
    expect(CONTROLLER).toContain('flag("disposable-target")');
  });

  it("derives the target ref from the connection, not from the environment", () => {
    // The Owner's credentials file exports SUPABASE_URL as production. While the
    // controller passed it to refFromTarget, that value decided the ref — so a
    // --database-url naming staging was not refused, and --production authorised
    // a write to whatever the connection string really pointed at. Reproduced at
    // the CLI by an independent review before it was removed.
    expect(CONTROLLER).not.toContain("process.env.SUPABASE_URL");
    expect(CONTROLLER).toContain("guards.assertTargetRefsAgree");
  });

  it("checks the target before it opens a connection", () => {
    const guardAt = CONTROLLER.indexOf("guards.assertTargetPermitted");
    const connectAt = CONTROLLER.indexOf("GUARD 14 — CONNECTION OPENED");
    expect(guardAt).toBeGreaterThan(0);
    expect(connectAt).toBeGreaterThan(guardAt);
  });

  it("parses flags the same way the census gate does — no `=` form", () => {
    expect(CONTROLLER).toContain("process.argv.indexOf(`--${name}`)");
    expect(GATE).toContain("process.argv.indexOf(`--${name}`)");
  });

  it("keeps the password out of argv", () => {
    expect(CONTROLLER).toContain("PGPASSWORD: password");
    expect(CONTROLLER).toContain('parsed.password = ""');
  });

  it("redacts before printing any failure", () => {
    expect(CONTROLLER).toContain(
      "redactSecrets(error?.stack ?? error?.message ?? error, supplied)",
    );
  });
});

describe("npm scripts", () => {
  it("exposes the two runners", () => {
    expect(PACKAGE_JSON.scripts["media:semantic-backfill"]).toBe(
      "node scripts/media/semantic-backfill.mjs",
    );
    expect(PACKAGE_JSON.scripts["media:capture-snapshot"]).toBe(
      "node scripts/media/capture-production-snapshot.mjs",
    );
  });

  it("leaves the existing media scripts untouched", () => {
    expect(PACKAGE_JSON.scripts["media:pg-test"]).toBe(
      "node scripts/media/run-semantic-media-pg-tests.mjs",
    );
    expect(PACKAGE_JSON.scripts["media:role-census"]).toBe(
      "node scripts/media/role-completeness-report.mjs",
    );
  });
});

describe("jiti loadability", () => {
  it("keeps every module a runner loads on relative imports", () => {
    // jiti does not resolve the tsconfig `@/` alias, so an aliased import in
    // any of these makes the runner die before executing a line.
    const modules = [
      "src/features/forever-semantic-backfill/canonical.ts",
      "src/features/forever-semantic-backfill/guards.ts",
      "src/features/forever-semantic-backfill/fingerprints.ts",
      "src/features/forever-semantic-backfill/production-snapshot.ts",
      "src/features/forever-semantic-backfill/package-evidence.ts",
      "src/features/forever-semantic-backfill/role-resolution.ts",
      "src/features/forever-semantic-backfill/plan.ts",
      "src/features/forever-semantic-backfill/manifest-validate.ts",
      "src/features/forever-semantic-backfill/acceptance.ts",
      "src/features/forever-semantic-backfill/exceptions.ts",
      "src/features/forever-semantic-backfill/journal.ts",
      "src/features/forever-semantic-backfill/apply-plan.ts",
      "src/features/forever-semantic-backfill/types.ts",
      "src/features/forever-direct-publish/public-object-path.ts",
      "src/features/forever-direct-publish/role-completeness.ts",
      "src/lib/public-media-policy.ts",
    ];
    for (const path of modules) {
      const source = readFileSync(join(REPO, path), "utf8");
      const aliased = source.match(/from "@\/[^"]+"/g) ?? [];
      expect(aliased, path).toEqual([]);
    }
  });

  it("keeps publish.ts out of the runner's reach by re-exporting the object path helpers", () => {
    // publish.ts transitively imports `@/import/currency-policy`, so it can
    // never be loaded through jiti. The helpers moved; they were not copied.
    const publish = readFileSync(
      join(REPO, "src/features/forever-direct-publish/publish.ts"),
      "utf8",
    );
    expect(publish).toContain('} from "./public-object-path";');
    expect(publish).not.toMatch(/export function publicMediaPath/);
    expect(publish).not.toMatch(/export function detectSanitizableImageType/);
  });
});
