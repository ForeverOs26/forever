/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — generated Worker configuration.
 *
 * The corrective release adds Workers Logs. Adding anything to the deploy
 * configuration is exactly the moment something else can be lost, so this pins
 * the whole repository-declared surface: the runtime contract, the cron, every
 * binding the production Worker has today, and the boundary that keeps secrets
 * and deployment-plane variables OUT of the generated file and out of the
 * browser.
 *
 * `wrangler.jsonc` is the source Nitro merges at build time; `.output/server/
 * wrangler.json` is the merged result actually deployed. Both are asserted —
 * the source because it is what a reviewer reads, the generated file (when a
 * build exists) because it is what ships.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

/** Strips comments so the JSONC source can be compared as data. */
function parseJsonc(source: string): Record<string, unknown> {
  const withoutComments = source.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const withoutTrailingCommas = withoutComments.replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(withoutTrailingCommas) as Record<string, unknown>;
}

const sourceConfig = parseJsonc(read("wrangler.jsonc"));

const GENERATED = ".output/server/wrangler.json";
const generatedConfig: Record<string, unknown> | null = existsSync(
  resolve(process.cwd(), GENERATED),
)
  ? (JSON.parse(read(GENERATED)) as Record<string, unknown>)
  : null;

/**
 * The complete binding set the production Worker carries, as recorded from the
 * live deployment. Three of the twelve are declared by this repository; the
 * other nine are deployment-plane values (secrets and one plain variable) that
 * the repository must never declare, because declaring them in the config is
 * how a deploy would REPLACE what production already has.
 */
const REPOSITORY_DECLARED_BINDINGS = [
  "ASSETS",
  "R2_PRIVATE_SOURCES",
  "R2_PROJECT_ARCHIVES",
  "R2_PUBLIC_MEDIA",
] as const;

const DEPLOYMENT_PLANE_BINDINGS = [
  "R2_ACCESS_KEY_ID",
  "R2_ACCOUNT_ID",
  "R2_SECRET_ACCESS_KEY",
  "STUDIO_OWNER_USER_ID",
  "STUDIO_STORAGE_WRITE_PROVIDER",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_URL",
] as const;

describe("wrangler.jsonc — the reviewed source", () => {
  it("enables Workers Logs with full invocation sampling", () => {
    expect(sourceConfig.observability).toEqual({ enabled: true, head_sampling_rate: 1 });
  });

  it("keeps the pinned runtime contract", () => {
    expect(sourceConfig.compatibility_date).toBe("2026-07-30");
    expect(sourceConfig.name).toBe("forever");
  });

  it("keeps the Studio scheduled runner cron", () => {
    expect(sourceConfig.triggers).toEqual({ crons: ["*/5 * * * *"] });
  });

  it("keeps all three R2 bucket bindings, bound to the production buckets", () => {
    expect(sourceConfig.r2_buckets).toEqual([
      { binding: "R2_PRIVATE_SOURCES", bucket_name: "forever-private-sources" },
      { binding: "R2_PUBLIC_MEDIA", bucket_name: "forever-public-media" },
      { binding: "R2_PROJECT_ARCHIVES", bucket_name: "forever-project-archives" },
    ]);
  });

  it("declares NO vars block, so the deployment-set provider variable survives a deploy", () => {
    // STUDIO_STORAGE_WRITE_PROVIDER=r2 lives on the Worker, not in this file.
    // Declaring a `vars` block here would replace the deployed set — which is
    // how an R2 deployment would silently lose its write provider.
    expect(sourceConfig.vars).toBeUndefined();
    expect(read("wrangler.jsonc")).not.toContain('"vars"');
  });

  it("declares no secret and no Owner email", () => {
    // Compared against the CONFIGURATION, not the file text: wrangler.jsonc
    // documents the server-only secrets by name in its comments, which is
    // exactly where naming them is safe. What must never appear is a
    // declaration or a value.
    const declared = JSON.stringify(sourceConfig);
    for (const secret of [
      "SUPABASE_SERVICE_ROLE_KEY",
      "R2_SECRET_ACCESS_KEY",
      "R2_ACCESS_KEY_ID",
      "R2_ACCOUNT_ID",
      "STUDIO_OWNER_EMAIL",
      "STUDIO_OWNER_USER_ID",
      "sb_secret_",
      "sb_publishable_",
    ]) {
      expect(declared, secret).not.toContain(secret);
    }
  });

  it("adds no new binding — the identity mechanism needs none", () => {
    // The build identity is a compile-time constant plus a same-origin route,
    // so no version_metadata binding, service binding or upstream Worker is
    // introduced by this change.
    expect(sourceConfig.version_metadata).toBeUndefined();
    expect(sourceConfig.services).toBeUndefined();
    expect(sourceConfig.routes).toBeUndefined();
    expect(Object.keys(sourceConfig).sort()).toEqual([
      "compatibility_date",
      "name",
      "observability",
      "r2_buckets",
      "triggers",
    ]);
  });
});

describe(".output/server/wrangler.json — what actually deploys", () => {
  const maybe = generatedConfig ? it : it.skip;

  maybe("retains observability, enabled, at full sampling", () => {
    expect(generatedConfig?.observability).toEqual({ enabled: true, head_sampling_rate: 1 });
  });

  maybe("retains the compatibility date and nodejs_compat", () => {
    expect(generatedConfig?.compatibility_date).toBe("2026-07-30");
    expect(generatedConfig?.compatibility_flags).toEqual(["nodejs_compat"]);
  });

  maybe("retains the cron trigger", () => {
    expect(generatedConfig?.triggers).toEqual({ crons: ["*/5 * * * *"] });
  });

  maybe("retains the ASSETS binding and all three R2 bindings", () => {
    const assets = generatedConfig?.assets as { binding?: string } | undefined;
    expect(assets?.binding).toBe("ASSETS");
    const buckets = (generatedConfig?.r2_buckets ?? []) as Array<{ binding: string }>;
    expect(buckets.map((bucket) => bucket.binding).sort()).toEqual([
      "R2_PRIVATE_SOURCES",
      "R2_PROJECT_ARCHIVES",
      "R2_PUBLIC_MEDIA",
    ]);
    expect(REPOSITORY_DECLARED_BINDINGS).toHaveLength(4);
  });

  maybe("carries no secret value, no Owner email and no vars block", () => {
    const generated = read(GENERATED);
    for (const forbidden of [
      "STUDIO_OWNER_EMAIL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "R2_SECRET_ACCESS_KEY",
      "R2_ACCESS_KEY_ID",
      "sb_secret_",
    ]) {
      expect(generated, forbidden).not.toContain(forbidden);
    }
    expect(generatedConfig?.vars).toBeUndefined();
    // Every deployment-plane binding stays out of the generated file, so a
    // deploy cannot replace the values production already carries.
    for (const binding of DEPLOYMENT_PLANE_BINDINGS) {
      expect(generated, binding).not.toContain(binding);
    }
  });
});

describe("client bundle boundary", () => {
  const assetsDir = resolve(process.cwd(), ".output/public/assets");
  const maybe = existsSync(assetsDir) ? it : it.skip;

  maybe("ships no Worker secret, binding name or Owner identity to the browser", async () => {
    const { readdirSync } = await import("node:fs");
    const files = readdirSync(assetsDir).filter((name) => name.endsWith(".js"));
    expect(files.length).toBeGreaterThan(0);
    const forbidden = [
      "SUPABASE_SERVICE_ROLE_KEY",
      "R2_SECRET_ACCESS_KEY",
      "R2_ACCESS_KEY_ID",
      "R2_ACCOUNT_ID",
      "STUDIO_OWNER_EMAIL",
      "STUDIO_OWNER_USER_ID",
      "STUDIO_STORAGE_WRITE_PROVIDER",
      "R2_PRIVATE_SOURCES",
      "R2_PROJECT_ARCHIVES",
      "__env__",
    ];
    // A secret VALUE, not the bare prefix: `@supabase/auth-js` legitimately
    // contains the literal `sb_secret_` as a key-shape check, and asserting on
    // the prefix alone would fail on vendor code that holds no secret.
    const secretValue = /sb_secret_[A-Za-z0-9_-]{8,}/;
    const offenders: string[] = [];
    for (const file of files) {
      const contents = readFileSync(resolve(assetsDir, file), "utf8");
      for (const needle of forbidden) {
        if (contents.includes(needle)) offenders.push(`${file}:${needle}`);
      }
      if (secretValue.test(contents)) offenders.push(`${file}:sb_secret_<value>`);
    }
    // Reported as a name list so a failure never dumps a bundle.
    expect(offenders).toEqual([]);
  });
});
