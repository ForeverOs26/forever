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

/**
 * The grant this contract depends on, checked on the target database.
 *
 * Two failures this converts from argued into observed.
 *
 * **The site blanks.** Both public selects request `project_media.semantic_role`.
 * PostgREST fails an ENTIRE embedded select with 42703 for a column the caller
 * cannot read, so the catalogue and every project page go blank together, not
 * one card. Ledger order applies `20260723130000_public_projection_privacy.sql`
 * before this migration and everything is fine — but that migration does
 * `REVOKE SELECT ON TABLE public.project_media FROM anon` and re-grants a column
 * list written before `semantic_role` existed. In PostgreSQL a column-less
 * REVOKE removes column-level grants too, so applying it AFTER `20260728120000`
 * strips the column and blanks the site. On a target that has not applied it
 * yet, that order is not hypothetical.
 *
 * **The privacy claim.** `metadata` carries source paths, package directories
 * and sanitizer records. Whether `anon` can read it is a property of the target
 * database's actual grants, not of the migration ledger, and it is exactly the
 * kind of claim that should be measured rather than asserted.
 */
const GRANT_SQL = `
  SELECT CASE WHEN to_regrole('anon') IS NULL THEN 'no_anon_role'
              ELSE has_column_privilege('anon', 'public.project_media', 'semantic_role', 'SELECT')::text
         END AS can_read_role,
         CASE WHEN to_regrole('anon') IS NULL THEN 'no_anon_role'
              ELSE has_column_privilege('anon', 'public.project_media', 'metadata', 'SELECT')::text
         END AS can_read_metadata
`;

/**
 * Split the password out of the connection URL before psql ever sees argv.
 *
 * The password was being handed to `psql` as a command-line argument, which puts
 * it in the process table for every user on the machine and prints it verbatim
 * in any error `execFileSync` throws — defeating the whole point of offering an
 * environment variable for the connection string.
 *
 * libpq reads `PGPASSWORD` from the environment, so the secret goes there and
 * the URL on argv carries only the host, port, user and database. A URL with no
 * password is returned unchanged.
 */
function splitCredential(databaseUrl) {
  try {
    const parsed = new URL(databaseUrl);
    if (!parsed.password) return { url: databaseUrl, env: {} };
    const password = decodeURIComponent(parsed.password);
    parsed.password = "";
    return { url: parsed.toString(), env: { PGPASSWORD: password } };
  } catch {
    // Not a URL — a libpq keyword/value string, which we pass through untouched.
    return { url: databaseUrl, env: {} };
  }
}

/** Never let a connection string reach a log, however psql fails. */
function redact(text, databaseUrl) {
  return String(text ?? "")
    .split(databaseUrl)
    .join("<connection string redacted>");
}

function readGrants(databaseUrl) {
  const { url, env } = splitCredential(databaseUrl);
  const raw = execFileSync(psqlPath(), [url, "-X", "-A", "-t", "--no-psqlrc", "-c", GRANT_SQL], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });
  const [semanticRole, metadata] = raw.trim().split("|");
  // Reported verbatim in the release record. A gate that says "blocked" without
  // saying what it measured is a gate somebody overrides.
  return { semanticRole, metadata, raw: raw.trim() };
}

/**
 * Grant failures are release failures, at BOTH rollout stages.
 *
 * Neither is about how much of the backfill has run: an unreadable
 * `semantic_role` blanks the site whatever the roles say, and a readable
 * `metadata` is a privacy defect whatever the roles say.
 */
/**
 * `boolean::text` is `"true"`/`"false"`, not psql's display form `t`/`f`.
 *
 * Comparing against `"t"` made both checks fire on a database whose grants were
 * exactly right — a gate that blocks a correct release is as useless as one that
 * passes a broken one, and it is the failure people learn to override. So the
 * parse is explicit and an unrecognised value is neither true nor false.
 */
function pgBool(value) {
  if (value === "true" || value === "t") return true;
  if (value === "false" || value === "f") return false;
  return null;
}

function evaluateGrants(grants) {
  const failures = [];
  const notes = [];
  if (grants.semanticRole === "no_anon_role") {
    // A gate that cannot verify must not pass. Saying "not acceptable as release
    // evidence" in a note and then exiting 0 is how a note gets ignored.
    failures.push(
      "This database has no `anon` role, so the public grant could not be checked at all. " +
        "A gate that cannot measure the thing it exists to measure is not evidence: run it " +
        "against the actual target, not a bare cluster.",
    );
    return { failures, notes };
  }
  if (pgBool(grants.semanticRole) !== true) {
    failures.push(
      "anon cannot SELECT project_media.semantic_role. Both public projections request " +
        "it, and PostgREST fails an ENTIRE embedded select with 42703 for an unreadable " +
        "column — the catalogue and every project page would blank together. Apply " +
        "20260728120000, and if 20260723130000_public_projection_privacy.sql is still " +
        "pending, apply it BEFORE it: its table-level REVOKE removes column grants too.",
    );
  } else {
    notes.push("anon can read semantic_role, so neither public projection will 42703.");
  }
  if (pgBool(grants.metadata) !== false) {
    failures.push(
      "anon CAN SELECT project_media.metadata, which carries source paths, package " +
        "directories and sanitizer records. 20260723130000_public_projection_privacy.sql " +
        "is the migration that closes this and it is not in force on this database.",
    );
  } else {
    notes.push("anon cannot read project_media.metadata.");
  }
  return { failures, notes };
}

function readCensus(databaseUrl) {
  const { url, env } = splitCredential(databaseUrl);
  const raw = execFileSync(
    psqlPath(),
    [url, "-X", "-A", "-t", "-F", "\u001f", "--no-psqlrc", "-c", CENSUS_SQL],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } },
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

  const rawGrants = readGrants(databaseUrl);
  const grants = evaluateGrants(rawGrants);
  const rows = readCensus(databaseUrl);
  const report = buildRoleCompletenessReport(rows, readExceptions(arg("exceptions")));
  const roleVerdict = evaluateReleaseGate(report, stage);
  // The grant check is part of the same verdict, not a separate advisory. A
  // release that would blank the site does not become acceptable because every
  // row happens to carry a role.
  const verdict = {
    ...roleVerdict,
    failures: [...grants.failures, ...roleVerdict.failures],
    notes: [...grants.notes, ...roleVerdict.notes],
    passed: grants.failures.length === 0 && roleVerdict.passed,
  };
  // `readCensus` returns camelCase. Reading `row.media_type` here counted
  // `undefined === "superseded_cover"` and reported 0 retired rows on every
  // database — and the harness check that was supposed to catch it asserted on
  // the static label text, which is present whatever the number says.
  const retired = rows.filter((row) => row.mediaType === "superseded_cover").length;

  const text = [
    "[role-census] FOREVER-MEDIA-SEMANTIC-PUBLIC-CONTRACT-001",
    `anon grant      : project_media.semantic_role/metadata SELECT = "${rawGrants.raw}"`,
    formatRoleCompletenessReport(report, verdict),
    `retired rows    : ${retired} (superseded_cover; never presentation media)`,
  ].join("\n");

  console.log(text);
  const out = arg("out");
  if (out) writeFileSync(out, `${text}\n`, "utf8");

  process.exit(verdict.passed ? 0 : 1);
}

main().catch((error) => {
  // Redacted, always. `execFileSync` puts the full argv into the message it
  // throws, and that argv used to carry the password verbatim.
  const supplied = arg("database-url") ?? process.env.FOREVER_ROLE_CENSUS_DATABASE_URL ?? "";
  const detail = redact(error?.message ?? error, supplied);
  console.error(
    `[role-census] FAILED: ${supplied ? redact(detail, splitCredential(supplied).url) : detail}`,
  );
  process.exit(2);
});
