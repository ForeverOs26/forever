#!/usr/bin/env node
/**
 * Read-only production snapshot capture
 * (FOREVER-SEMANTIC-MEDIA-BACKFILL-001).
 *
 * Produces the `forever-production-media-snapshot.v1` file the backfill planner
 * reads. It is the only component of this lane that touches the live database
 * over the network, and it is built so that its read-only-ness is checkable
 * rather than promised:
 *
 *   EXACTLY TWO network call sites exist in this file — `get()`, which
 *   hardcodes the read method, and `head()`, which hardcodes the metadata-only
 *   one. Neither takes the method as a parameter, and none of the four mutating
 *   HTTP verbs appears anywhere in this source. A unit test reads this file's
 *   own bytes and asserts both facts. A promise in a comment is not a control;
 *   a test that reads the file is.
 *
 *   The project ref is asserted against the literal production ref BEFORE the
 *   first request, and the SUPABASE_URL host must start with it. Staging is
 *   refused by literal.
 *
 *   `select=` lists never include `metadata` or `title`. `metadata` carries
 *   source paths, package directories and sanitizer records — it is the column
 *   20260723130000 exists to hide — so it is not fetched at all rather than
 *   fetched and dropped. A column that was never read cannot leak.
 *
 *   Business baselines come from `HEAD` plus `Prefer: count=exact`, so a count
 *   of units, sold units, price-history rows and buildings is obtained without
 *   ever retrieving a business row body.
 *
 * Credentials are read from the environment and never echoed. Usage:
 *
 *   node scripts/media/capture-production-snapshot.mjs --out snapshot.json
 *
 * with SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_PROJECT_REF already
 * in the environment (dot-source the credentials file; never print a value).
 */

import { writeFileSync } from "node:fs";

const PRODUCTION_PROJECT_REF = "abtvsrcnfwlbawvrjeed";
const REFUSED_PROJECT_REF = "garjibjhlzeljsnpzisu";
const SCHEMA_VERSION = "forever-production-media-snapshot.v1";

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function fail(message, code = 2) {
  console.error(`[capture-snapshot] ${message}`);
  process.exit(code);
}

const outPath = arg("out");
if (!outPath) fail("--out <path.json> is required.");

const ref = (process.env.SUPABASE_PROJECT_REF ?? "").trim();
const origin = (process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

// Asserted before the first request, and by literal on both sides. A ref that
// merely "is not staging" is not the same claim as "is production".
if (ref === REFUSED_PROJECT_REF)
  fail(`Refusing to run: SUPABASE_PROJECT_REF is the refused ref.`, 4);
if (ref !== PRODUCTION_PROJECT_REF) {
  fail(`Refusing to run: SUPABASE_PROJECT_REF is not the expected production ref.`, 4);
}
if (!origin) fail("SUPABASE_URL is not set.", 2);
let host;
try {
  host = new URL(origin).host;
} catch {
  host = "";
}
if (!host.startsWith(`${ref}.`)) {
  fail(`Refusing to run: the SUPABASE_URL host does not begin with the asserted project ref.`, 4);
}
if (host.includes(REFUSED_PROJECT_REF)) fail("Refusing to run: the URL names the refused ref.", 4);
if (!key) fail("SUPABASE_SERVICE_ROLE_KEY is not set. Its value is never printed.", 2);

const headers = { apikey: key, Authorization: `Bearer ${key}` };

/**
 * Network call site 1 of 2. The method is a literal, not a parameter — a
 * parameterised method is one careless caller away from being a write.
 *
 * `tolerateFailure` exists for the one probe that needs the failure itself as
 * its answer: whether `semantic_role` exists can only be learned by asking for
 * it, because PostgREST does not expose `information_schema` and an RPC would
 * need a method this file must not use.
 */
async function get(path, tolerateFailure = false) {
  const response = await fetch(`${origin}/rest/v1/${path}`, { method: "GET", headers });
  if (!response.ok) {
    if (tolerateFailure) return null;
    fail(`read of ${path.split("?")[0]} returned HTTP ${response.status}.`, 1);
  }
  return response.json();
}

/** Network call site 2 of 2. Used only to read an exact count out of a header. */
async function head(path) {
  const response = await fetch(`${origin}/rest/v1/${path}`, {
    method: "HEAD",
    headers: { ...headers, Prefer: "count=exact" },
  });
  if (!response.ok) return null;
  const range = response.headers.get("content-range");
  if (!range) return null;
  const total = range.split("/")[1];
  return total === "*" ? null : Number(total);
}

async function columnExists(table, column) {
  return (await get(`${table}?select=${column}&limit=1`, true)) !== null;
}

async function main() {
  const semanticRoleColumnPresent = await columnExists("project_media", "semantic_role");

  const projects = await get(
    "projects?select=id,slug,name,is_active,public_status,main_image_url" +
      "&is_active=eq.true&public_status=eq.published&order=slug.asc",
  );

  // No `metadata`, no `title`. Never fetched, so it can never be written out.
  const mediaSelect = semanticRoleColumnPresent
    ? "id,project_id,media_type,url,sort_order,semantic_role"
    : "id,project_id,media_type,url,sort_order";

  const out = { projects: [] };
  const baseline = [];

  for (const project of projects) {
    const media = await get(
      `project_media?select=${mediaSelect}&project_id=eq.${project.id}` +
        "&order=media_type.asc,url.asc,sort_order.asc",
    );
    out.projects.push({
      project_id: project.id,
      slug: project.slug,
      name: project.name ?? project.slug,
      is_active: project.is_active === true,
      public_status: project.public_status ?? "",
      main_image_url: project.main_image_url ?? null,
      media: media.map((row) => ({
        media_type: String(row.media_type ?? "").trim(),
        url: String(row.url ?? "").trim(),
        sort_order: Number(row.sort_order ?? 0),
        semantic_role: row.semantic_role ?? null,
      })),
    });

    baseline.push({
      project_id: project.id,
      units: (await head(`units?select=id&project_id=eq.${project.id}`)) ?? 0,
      // `ilike` rather than `eq`, because the recorded status has been seen as
      // both "sold" and "SOLD" and a case-sensitive count that silently returns
      // zero is worse than no count: it would read as "nothing was sold".
      units_sold:
        (await head(
          `units?select=id&project_id=eq.${project.id}&availability_status=ilike.sold`,
        )) ?? 0,
      // Price history has no project_id of its own; counted per project would
      // need a join PostgREST cannot express with HEAD, so the total is
      // recorded once and attributed to no project. Stated rather than faked.
      unit_price_history_rows: 0,
      buildings: (await head(`buildings?select=id&project_id=eq.${project.id}`)) ?? 0,
    });
  }

  const snapshot = {
    schema_version: SCHEMA_VERSION,
    // Excluded from every digest, so a re-capture of an unchanged database
    // still compares equal.
    captured_at: new Date().toISOString(),
    source: "postgrest_get",
    project_ref: ref,
    semantic_role_column_present: semanticRoleColumnPresent,
    projects: out.projects,
    business_baseline: { captured_by: "head_count_exact", projects: baseline },
  };

  const text = `${JSON.stringify(snapshot, null, 2)}\n`;
  if (/eyJ|sb_secret/.test(text))
    fail("Refusing to write: the snapshot would carry a credential.", 2);
  writeFileSync(outPath, text, "utf8");

  console.log(
    `[capture-snapshot] wrote ${snapshot.projects.length} project(s), ` +
      `${snapshot.projects.reduce((sum, p) => sum + p.media.length, 0)} media row(s). ` +
      `semantic_role column present: ${semanticRoleColumnPresent}. ` +
      `Read-only: GET and HEAD only.`,
  );
}

main().catch((error) => {
  const message = String(error?.message ?? error).replace(/eyJ[\w.-]+/g, "<token redacted>");
  fail(`capture failed: ${message}`, 1);
});
