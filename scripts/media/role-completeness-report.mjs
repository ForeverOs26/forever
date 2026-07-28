#!/usr/bin/env node
/**
 * Role completeness census and post-backfill release gate
 * (FOREVER-MEDIA-SEMANTIC-PUBLIC-CONTRACT-001).
 *
 * Reports how many public image rows carry a semantic role, and — after the
 * backfill — refuses the release while any of them still does not.
 *
 * READ-ONLY, and deliberately hard to point at the wrong database. It issues one
 * SELECT and nothing else: no INSERT, no UPDATE, no DELETE, no DDL, and it does
 * not perform the backfill. There is no default connection string and no
 * fallback to an ambient `DATABASE_URL`, `SUPABASE_DB_URL` or `.env` file,
 * because the failure mode of a convenient default here is "the Owner ran the
 * release gate against production while meaning to check a copy".
 *
 * Usage:
 *   node scripts/media/role-completeness-report.mjs \
 *     --database-url "postgres://…" \
 *     --stage before_backfill|after_backfill \
 *     [--exceptions path/to/exceptions.json] \
 *     [--out path/to/report.txt]
 *
 * The connection string may instead be supplied as FOREVER_ROLE_CENSUS_DATABASE_URL.
 *
 * The exceptions file is a JSON array of
 *   { "projectSlug": "...", "url": "...", "reason": "..." }
 * Each entry excuses exactly one role-less public row. A blank reason excuses
 * nothing — the point of an exception is that somebody wrote down why.
 *
 * Exits 0 when the gate passes, 1 when it blocks, 2 on a usage error.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);

/**
 * The census is pure TypeScript in `src/features/forever-direct-publish`. It is
 * loaded through the repository's own TypeScript runtime rather than
 * reimplemented here: a second copy of the rule is a second thing to keep
 * correct, and the tests only cover one of them.
 */
async function loadCensus() {
  let jiti;
  try {
    jiti = require("jiti")(import.meta.url, { interopDefault: true, esmResolve: true });
  } catch {
    usage(
      "This script loads the census rule from TypeScript and needs `jiti`.\n" +
        "Install it with:  npm i -D jiti",
    );
  }
  // A relative-import-only module by design: jiti does not read tsconfig path
  // aliases, so `role-completeness.ts` imports `./hero-policy` and nothing under
  // `@/`. Keep it that way or this loader silently stops working.
  return jiti(join(process.cwd(), "src/features/forever-direct-publish/role-completeness.ts"));
}

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function usage(message) {
  console.error(`\n${message}\n`);
  console.error("Usage:");
  console.error("  node scripts/media/role-completeness-report.mjs \\");
  console.error('    --database-url "postgres://…" \\');
  console.error("    --stage before_backfill|after_backfill \\");
  console.error("    [--exceptions exceptions.json] [--out report.txt]\n");
  console.error("No default connection string exists, by design.");
  process.exit(2);
}

const WINDOWS = process.platform === "win32";

/** Locate psql the same way the disposable-cluster harness does. */
function psqlPath() {
  const explicit = process.env.FOREVER_PG_BIN;
  const candidates = [
    explicit && join(explicit, WINDOWS ? "psql.exe" : "psql"),
    ...(WINDOWS
      ? ["C:/Program Files/PostgreSQL", "C:/Program Files (x86)/PostgreSQL"]
      : ["/usr/lib/postgresql", "/usr/pgsql", "/opt/homebrew/opt"]
    ).flatMap((root) => {
      if (!existsSync(root)) return [];
      const { readdirSync } = require("node:fs");
      return readdirSync(root)
        .sort()
        .reverse()
        .map((entry) => join(root, entry, "bin", WINDOWS ? "psql.exe" : "psql"));
    }),
  ].filter(Boolean);
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  return WINDOWS ? "psql.exe" : "psql";
}

/**
 * The one statement this script runs.
 *
 * `superseded_cover` is included in the read so the census can *state* how many
 * retired rows exist; `buildRoleCompletenessReport` governs only `cover` and
 * `gallery`, so a retired row is counted in neither the numerator nor the
 * denominator of completeness.
 */
const CENSUS_SQL = `
  SELECT coalesce(p.slug, '(unknown)') AS project_slug,
         m.media_type,
         m.url,
         coalesce(m.semantic_role, '') AS semantic_role
    FROM public.project_media m
    LEFT JOIN public.projects p ON p.id = m.project_id
   WHERE m.media_type IN ('cover', 'gallery', 'superseded_cover')
   ORDER BY project_slug, m.media_type, m.url
`;

function readCensus(databaseUrl) {
  const raw = execFileSync(
    psqlPath(),
    [databaseUrl, "-X", "-A", "-t", "-F", "\u001f", "--no-psqlrc", "-c", CENSUS_SQL],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [projectSlug, mediaType, url, semanticRole] = line.split("\u001f");
      return { projectSlug, mediaType, url, semanticRole: semanticRole || null };
    });
}

function readExceptions(path) {
  if (!path) return [];
  if (!existsSync(path)) usage(`Exceptions file not found: ${path}`);
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(parsed)) usage("The exceptions file must contain a JSON array.");
  return parsed;
}

async function main() {
  const databaseUrl = arg("database-url") ?? process.env.FOREVER_ROLE_CENSUS_DATABASE_URL;
  const stage = arg("stage");

  if (!databaseUrl) {
    usage("No database URL supplied. Pass --database-url or set FOREVER_ROLE_CENSUS_DATABASE_URL.");
  }
  if (stage !== "before_backfill" && stage !== "after_backfill") {
    usage("--stage must be exactly before_backfill or after_backfill.");
  }

  const { buildRoleCompletenessReport, evaluateReleaseGate, formatRoleCompletenessReport } =
    await loadCensus();

  const rows = readCensus(databaseUrl);
  const report = buildRoleCompletenessReport(rows, readExceptions(arg("exceptions")));
  const verdict = evaluateReleaseGate(report, stage);
  // `readCensus` returns camelCase. Reading `row.media_type` here counted
  // `undefined === "superseded_cover"` and reported 0 retired rows on every
  // database — and the harness check that was supposed to catch it asserted on
  // the static label text, which is present whatever the number says.
  const retired = rows.filter((row) => row.mediaType === "superseded_cover").length;

  const text = [
    "[role-census] FOREVER-MEDIA-SEMANTIC-PUBLIC-CONTRACT-001",
    formatRoleCompletenessReport(report, verdict),
    `retired rows    : ${retired} (superseded_cover; never presentation media)`,
  ].join("\n");

  console.log(text);
  const out = arg("out");
  if (out) writeFileSync(out, `${text}\n`, "utf8");

  process.exit(verdict.passed ? 0 : 1);
}

main().catch((error) => {
  console.error(`[role-census] FAILED: ${error?.message ?? error}`);
  process.exit(2);
});
