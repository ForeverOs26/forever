#!/usr/bin/env node
/**
 * Semantic media contract — disposable PostgreSQL execution proof
 * (FOREVER-PR117-DATABASE-PROOF-AND-REREVIEW-001).
 *
 * Two throwaway clusters, two questions:
 *
 *   Path A — FRESH: does the complete committed migration chain, including
 *            20260728120000, apply to an empty database and leave exactly one
 *            of every object it declares?
 *   Path B — UPGRADE: applied to a database that already holds realistic
 *            pre-PR117 data, does the new migration alone preserve that data,
 *            and does the REAL Direct Publish RPC then behave correctly?
 *
 * Path B is the one that matters. It calls `public.forever_direct_publish`
 * with realistic JSON batches rather than poking the helper functions
 * directly, because the blocker independent review found was precisely that a
 * helper can be correct and never be called.
 *
 * No production or staging credential is read. Both clusters are created under
 * the OS temp directory with trust auth on loopback, and removed in `finally`.
 *
 * Usage: node scripts/media/run-semantic-media-pg-tests.mjs
 * Exits 0 only when every assertion passes.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The repo's own TypeScript, loaded the way a runner loads it.
 *
 * Path C drives the backfill controller, and the controller's join key is the
 * publish lane's content-addressed object path. A fixture that hard-coded those
 * paths would prove only that two constants match, so the fixtures are built by
 * running the real `createPublicDerivative` and `publicMediaPath` over real
 * bytes and seeding the URLs they produce. jiti is what makes that reachable
 * from a `.mjs` file — and loading these modules here is itself a check that
 * every one of them still keeps to relative imports.
 */
const requireCjs = createRequire(import.meta.url);
let jitiLoader = null;
function loadTs(relativePath) {
  if (!jitiLoader) {
    jitiLoader = requireCjs("jiti")(import.meta.url, { interopDefault: true, esmResolve: true });
  }
  return jitiLoader(join(REPO, relativePath));
}

const REPO = process.cwd();
const MIGRATIONS_DIR = join(REPO, "supabase", "migrations");
const BOOTSTRAP = join(REPO, "scripts", "studio", "pg-bootstrap.sql");

/** The migration under proof. Everything before it is "the existing chain". */
const SUBJECT = "20260728120000_project_media_semantic_role.sql";

const WINDOWS = process.platform === "win32";

/**
 * Locate initdb/pg_ctl/psql.
 *
 * The Studio runner searches POSIX install roots and falls back to PATH. On
 * Windows the EnterpriseDB installer puts them under Program Files and does not
 * add them to PATH, so that search finds nothing — hence the extra roots here.
 */
function findBinDir() {
  const roots = [
    process.env.FOREVER_PG_BIN,
    ...(WINDOWS
      ? ["C:/Program Files/PostgreSQL", "C:/Program Files (x86)/PostgreSQL"]
      : ["/usr/lib/postgresql", "/usr/pgsql", "/opt/homebrew/opt"]),
  ].filter(Boolean);

  for (const base of roots) {
    if (!existsSync(base)) continue;
    if (existsSync(join(base, WINDOWS ? "initdb.exe" : "initdb"))) return base;
    for (const entry of readdirSync(base).sort().reverse()) {
      const bin = join(base, entry, "bin");
      if (existsSync(join(bin, WINDOWS ? "initdb.exe" : "initdb"))) return bin;
    }
  }
  return "";
}

const BIN = findBinDir();
const bin = (name) => (BIN ? join(BIN, WINDOWS ? `${name}.exe` : name) : name);

let failures = 0;
let checks = 0;

function ok(label) {
  checks += 1;
  console.log(`  PASS  ${label}`);
}

function bad(label, detail) {
  checks += 1;
  failures += 1;
  console.error(`  FAIL  ${label}`);
  if (detail) console.error(`        ${String(detail).trim().split("\n").join("\n        ")}`);
}

/**
 * Something the proof established that is not an assertion about behaviour.
 *
 * A defect found in the code under proof is not the same event as a check that
 * did not hold, and conflating the two costs both of them: a red run reads as
 * "the harness is broken" and the finding gets lost inside it, while a green run
 * that quietly knew about a defect is worse still. Findings are collected,
 * printed with their own prefix, and reported next to the pass/fail summary.
 */
const findings = [];
function note(label, detail) {
  findings.push({ label, detail: String(detail ?? "") });
  console.log(`  FIND  ${label}`);
  if (detail) console.log(`        ${String(detail).trim().split("\n").join("\n        ")}`);
}

/** One disposable cluster. */
class Cluster {
  constructor(tag, port) {
    this.tag = tag;
    this.port = String(port);
    this.work = mkdtempSync(join(tmpdir(), `forever-media-pg-${tag}-`));
    this.data = join(this.work, "data");
    this.started = false;
  }

  /**
   * Bring the cluster up, walking forward if the port is taken.
   *
   * This proof is meant to be re-run by reviewers, and two people running it at
   * once is the normal case, not the exceptional one. A fixed port turns that
   * into `pg_ctl ... start` failing with no explanation and a `-1/0 checks`
   * summary that looks like the migration broke. Eight attempts is enough for
   * any plausible number of concurrent runs; the port is reported so a run can
   * be identified.
   */
  start() {
    execFileSync(bin("initdb"), ["-D", this.data, "-U", "postgres", "--auth=trust", "-E", "UTF8"], {
      stdio: "pipe",
      encoding: "utf8",
    });
    let lastError;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const port = String(Number(this.port) + attempt * 10);
      try {
        execFileSync(
          bin("pg_ctl"),
          [
            "-D",
            this.data,
            "-o",
            `-h 127.0.0.1 -p ${port} -c fsync=off -c synchronous_commit=off`,
            "-w",
            "-l",
            join(this.work, "log"),
            "start",
          ],
          WINDOWS ? { stdio: "ignore" } : { stdio: "pipe", encoding: "utf8" },
        );
        this.port = port;
        this.started = true;
        return;
      } catch (error) {
        lastError = error;
        // pg_ctl leaves a postmaster.pid behind on a bind failure, which blocks
        // the next attempt with "another server might be running".
        rmSync(join(this.data, "postmaster.pid"), { force: true });
      }
    }
    throw lastError;
  }

  args(extra) {
    return [
      "-h",
      "127.0.0.1",
      "-p",
      this.port,
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-q",
      ...extra,
    ];
  }

  file(path) {
    return execFileSync(bin("psql"), this.args(["-f", path]), { stdio: "pipe", encoding: "utf8" });
  }

  sql(text) {
    return execFileSync(bin("psql"), this.args(["-c", text]), { stdio: "pipe", encoding: "utf8" });
  }

  /** A single scalar, trimmed. */
  scalar(text) {
    return execFileSync(bin("psql"), this.args(["-tAc", text]), {
      stdio: "pipe",
      encoding: "utf8",
    }).trim();
  }

  /** Run SQL expected to fail; return the error text. Throws if it succeeds. */
  expectFailure(text, label) {
    try {
      this.sql(text);
    } catch (error) {
      return String(error.stderr ?? "") + String(error.stdout ?? "");
    }
    throw new Error(`${label}: statement unexpectedly SUCCEEDED`);
  }

  stop() {
    if (this.started) {
      try {
        execFileSync(bin("pg_ctl"), ["-D", this.data, "-w", "-m", "immediate", "stop"], {
          stdio: "ignore",
        });
      } catch {
        /* best effort */
      }
    }
    rmSync(this.work, { recursive: true, force: true });
  }
}

function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/**
 * Supabase platform default: browser roles hold a broad table grant on public.
 * The Studio runner reproduces it before the Studio migration so the corrective
 * REVOKE is exercised. The same applies here.
 */
function applyChain(cluster, files) {
  for (const file of files) {
    if (file === "20260721120000_forever_studio_v1.sql") {
      cluster.sql("GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated");
    }
    cluster.file(join(MIGRATIONS_DIR, file));
  }
}

// ---------------------------------------------------------------------------
// Fixture identifiers — stable so assertions can name them.
// ---------------------------------------------------------------------------

const P = {
  normal: "aa000000-0000-4000-8000-000000000001",
  coralina: "aa000000-0000-4000-8000-000000000002",
  sierra: "aa000000-0000-4000-8000-000000000003",
  kirara: "aa000000-0000-4000-8000-000000000004",
  unrelated: "aa000000-0000-4000-8000-000000000005",
};

const U = {
  normalUnit: "bb000000-0000-4000-8000-000000000001",
  soldUnit: "bb000000-0000-4000-8000-000000000002",
  unrelatedUnit: "bb000000-0000-4000-8000-000000000003",
};

const B = { normal: "cc000000-0000-4000-8000-000000000001" };

const URLS = {
  normalCover: "https://cdn.example.com/normal/cover-exterior.jpg",
  normalG1: "https://cdn.example.com/normal/g1.jpg",
  normalG2: "https://cdn.example.com/normal/g2.jpg",
  coralinaOldCover: "https://cdn.example.com/coralina/257e5181-event.jpg",
  coralinaNewCover: "https://cdn.example.com/coralina/bd2d9040-exterior.jpg",
  sierraOldCover: "https://cdn.example.com/sierra/002eead3-holiday.png",
  sierraNewCover: "https://cdn.example.com/sierra/37fa558a-exterior.png",
  sierraLegacyGallery: "https://cdn.example.com/sierra/b04b9971-xmas.png",
  kiraraPlan: "https://cdn.example.com/kirara/house-plan.png",
  unrelatedCover: "https://cdn.example.com/unrelated/cover.jpg",
  unrelatedGallery: "https://cdn.example.com/unrelated/g1.jpg",
};

/** Realistic pre-PR117 state: rows written by the chain as it exists on main. */
function seedPreUpgradeFixtures(cluster) {
  const rows = [];
  const project = (id, slug, name, cover) =>
    `INSERT INTO public.projects (id, name, slug, is_active, main_image_url)
       VALUES ('${id}', '${name}', '${slug}', true, ${cover ? `'${cover}'` : "NULL"});`;
  const media = (project_id, type, url, sort) =>
    `INSERT INTO public.project_media (project_id, media_type, url, sort_order)
       VALUES ('${project_id}', '${type}', '${url}', ${sort});`;

  rows.push(project(P.normal, "normal-project", "Normal Project", URLS.normalCover));
  rows.push(media(P.normal, "cover", URLS.normalCover, 0));
  rows.push(media(P.normal, "gallery", URLS.normalG1, 1));
  rows.push(media(P.normal, "gallery", URLS.normalG2, 2));

  // Coralina shape: the corrected hero, with the launch-event cover still there.
  rows.push(project(P.coralina, "coralina", "Coralina", URLS.coralinaNewCover));
  rows.push(media(P.coralina, "cover", URLS.coralinaOldCover, 0));
  rows.push(media(P.coralina, "cover", URLS.coralinaNewCover, 0));

  // Sierra shape: same, plus a role-less legacy gallery row.
  rows.push(project(P.sierra, "the-title-sierra", "The Title Sierra", URLS.sierraNewCover));
  rows.push(media(P.sierra, "cover", URLS.sierraOldCover, 0));
  rows.push(media(P.sierra, "cover", URLS.sierraNewCover, 0));
  rows.push(media(P.sierra, "gallery", URLS.sierraLegacyGallery, 1));

  // Villa Kirara shape: no cover at all, only a plan.
  rows.push(project(P.kirara, "the-title-villa-kirara", "The Title Villa Kirara", null));
  rows.push(media(P.kirara, "unit_plan", URLS.kiraraPlan, 0));

  // An unrelated project that must stay byte-for-byte identical.
  rows.push(project(P.unrelated, "unrelated-project", "Unrelated Project", URLS.unrelatedCover));
  rows.push(media(P.unrelated, "cover", URLS.unrelatedCover, 0));
  rows.push(media(P.unrelated, "gallery", URLS.unrelatedGallery, 1));

  // Buildings, units, availability, SOLD status and a current price.
  rows.push(
    `INSERT INTO public.buildings (id, project_id, name, building_code)
       VALUES ('${B.normal}', '${P.normal}', 'Building A', 'A');`,
  );
  rows.push(
    `INSERT INTO public.units (id, project_id, building_id, unit_code, unit_type, availability_status, base_price_thb)
       VALUES ('${U.normalUnit}', '${P.normal}', '${B.normal}', 'A101', 'One Bedroom', 'available', 9000000);`,
  );
  rows.push(
    `INSERT INTO public.units (id, project_id, building_id, unit_code, unit_type, availability_status, base_price_thb)
       VALUES ('${U.soldUnit}', '${P.normal}', '${B.normal}', 'A102', 'Two Bedroom', 'sold', 14500000);`,
  );
  rows.push(
    `INSERT INTO public.units (id, project_id, unit_code, unit_type, availability_status, base_price_thb)
       VALUES ('${U.unrelatedUnit}', '${P.unrelated}', 'Z900', 'Studio', 'available', 5000000);`,
  );

  cluster.sql(rows.join("\n"));
}

/**
 * A Direct Publish batch shaped exactly as the application sends one.
 *
 * `publish.ts` builds `media[]` entries carrying media_type, url, sort_order and
 * — since this contract — semantic_role. The RPC is invoked with the same two
 * option stamps the application always sends.
 */
function batch({ slug, mode = "enrich", set = {}, media = [] }) {
  const payload = {
    // Exactly what `build-batch.ts` emits; the ingest boundary refuses anything
    // else with schema_version_unsupported.
    schema_version: "1",
    mode,
    project: { slug, ...(Object.keys(set).length ? { set } : {}) },
    media,
  };
  // Content-derived, so an identical batch replays (the ingest short-circuits
  // and returns replayed:true) while a changed batch gets its own key rather
  // than tripping fingerprint_payload_mismatch. Note the short-circuit is
  // inside forever_progressive_ingest only: forever_direct_publish still runs
  // publication, price projection, semantic projection and cover
  // reconciliation afterwards, which is what makes replay a real test of them.
  payload.batch_fingerprint = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return JSON.stringify(payload).replace(/'/g, "''");
}

function directPublish(cluster, json) {
  return cluster.scalar(
    `SELECT public.forever_direct_publish('${json}'::jsonb,
       '{"source_trust":"owner_approved_official","publication_mode":"direct"}'::jsonb)::text`,
  );
}

// ---------------------------------------------------------------------------

const clusters = [];

try {
  if (!BIN && !existsSync("/usr/bin/initdb")) {
    console.log("[media-pg] no PostgreSQL binaries found; set FOREVER_PG_BIN");
    process.exitCode = 1;
  }

  const files = migrationFiles();
  const subjectIndex = files.indexOf(SUBJECT);
  if (subjectIndex < 0) throw new Error(`${SUBJECT} not found in ${MIGRATIONS_DIR}`);

  // The subject must stay put in ledger order and nothing after it may reach
  // back into the media contract this proof establishes.
  //
  // This used to demand the subject be the LAST migration. That was the right
  // guard while it was the newest one, but it conflates two things: "nothing
  // has rewritten the media contract behind this proof" (what actually matters)
  // and "no migration has been added since" (which the ledger does constantly —
  // it only ever grows). 20260728160000 adds two columns to project_amenities
  // and touches nothing here, yet the old form failed on it.
  //
  // So the check is now the real one: every migration ordered after the subject
  // must be additive with respect to project_media. Comments are stripped
  // before scanning — a later migration may legitimately *mention* project_media
  // while explaining itself, and the subject's own file is not re-scanned.
  const uncommented = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
  const laterMediaWriters = files
    .slice(subjectIndex + 1)
    .filter((file) =>
      /project_media|semantic_role/i.test(
        uncommented(readFileSync(join(MIGRATIONS_DIR, file), "utf8")),
      ),
    );
  if (laterMediaWriters.length > 0) {
    throw new Error(
      `migration(s) ordered after ${SUBJECT} modify the media contract — ` +
        `additive ordering violated: ${laterMediaWriters.join(", ")}`,
    );
  }

  // =========================================================================
  // PATH A — fresh database, complete chain
  // =========================================================================
  console.log("\n[media-pg] PATH A — fresh database, complete committed chain");
  const A = new Cluster("fresh", process.env.FOREVER_PG_PORT_A || 55440);
  clusters.push(A);
  A.start();
  console.log(`  server: ${A.scalar("SHOW server_version")}`);
  A.file(BOOTSTRAP);
  applyChain(A, files);
  ok(
    `complete chain applied (${files.length} migrations; ${files.length - 1 - subjectIndex} ` +
      `additive migration(s) ordered after ${SUBJECT}, none touching project_media)`,
  );

  // -- schema ---------------------------------------------------------------
  const col = A.scalar(
    `SELECT data_type || ':' || is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND table_name='project_media' AND column_name='semantic_role'`,
  );
  col === "text:YES"
    ? ok("semantic_role exists and is nullable")
    : bad("semantic_role exists and is nullable", `got "${col}"`);

  for (const [label, expr] of [
    [
      "semantic_role column",
      "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='project_media' AND column_name='semantic_role'",
    ],
    [
      "vocabulary CHECK constraint",
      "SELECT count(*) FROM pg_constraint WHERE conname='project_media_semantic_role_vocabulary'",
    ],
    [
      "forever_project_media_semantic_projection",
      "SELECT count(*) FROM pg_proc WHERE proname='forever_project_media_semantic_projection'",
    ],
    [
      "forever_project_cover_reconcile",
      "SELECT count(*) FROM pg_proc WHERE proname='forever_project_cover_reconcile'",
    ],
    [
      "forever_project_cover_withdraw",
      "SELECT count(*) FROM pg_proc WHERE proname='forever_project_cover_withdraw'",
    ],
    [
      "forever_direct_publish",
      "SELECT count(*) FROM pg_proc WHERE proname='forever_direct_publish'",
    ],
  ]) {
    const n = A.scalar(expr);
    n === "1"
      ? ok(`${label} exists exactly once`)
      : bad(`${label} exists exactly once`, `count=${n}`);
  }

  // -- vocabulary acceptance / rejection ------------------------------------
  A.sql(
    `INSERT INTO public.projects (id, name, slug, is_active)
       VALUES ('${P.normal}', 'Vocab Probe', 'vocab-probe', true)`,
  );
  const VOCAB = [
    "property_exterior",
    "property_aerial",
    "property_pool_exterior",
    "villa_exterior",
    "architecture_render",
    "property_interior",
    "amenity",
    "landscape",
    "lifestyle",
    "event",
    "group_photo",
    "portrait",
    "decorative_detail",
    "text_promo",
    "plan",
    "map",
    "unknown",
  ];
  let vocabOk = true;
  VOCAB.forEach((role, index) => {
    try {
      A.sql(
        `INSERT INTO public.project_media (project_id, media_type, url, sort_order, semantic_role)
           VALUES ('${P.normal}', 'gallery', 'https://cdn.example.com/v${index}.jpg', ${index}, '${role}')`,
      );
    } catch (error) {
      vocabOk = false;
      bad(`vocabulary accepts ${role}`, error.stderr);
    }
  });
  if (vocabOk) ok(`all ${VOCAB.length} vocabulary members accepted`);

  const nullRole = A.sql(
    `INSERT INTO public.project_media (project_id, media_type, url, sort_order)
       VALUES ('${P.normal}', 'gallery', 'https://cdn.example.com/vnull.jpg', 900)`,
  );
  void nullRole;
  ok("NULL semantic_role accepted (no classification recorded)");

  const rejected = A.expectFailure(
    `INSERT INTO public.project_media (project_id, media_type, url, sort_order, semantic_role)
       VALUES ('${P.normal}', 'gallery', 'https://cdn.example.com/bad.jpg', 901, 'verified_amenity')`,
    "invalid vocabulary value",
  );
  /project_media_semantic_role_vocabulary/.test(rejected)
    ? ok("invalid semantic_role rejected by the named CHECK constraint")
    : bad("invalid semantic_role rejected by the named CHECK constraint", rejected);

  for (const invalid of ["logo", "GALLERY", "property exterior", ""]) {
    const out = A.expectFailure(
      `INSERT INTO public.project_media (project_id, media_type, url, sort_order, semantic_role)
         VALUES ('${P.normal}', 'gallery', 'https://cdn.example.com/bad-${encodeURIComponent(invalid)}.jpg', 902, '${invalid}')`,
      `invalid ${invalid}`,
    );
    if (!/project_media_semantic_role_vocabulary/.test(out)) {
      bad(`near-miss "${invalid}" rejected`, out);
    }
  }
  ok("near-miss values (logo, GALLERY, spaced, empty) all rejected");

  // -- grants ---------------------------------------------------------------
  const granted = A.scalar(
    `SELECT string_agg(DISTINCT column_name, ',' ORDER BY column_name)
       FROM information_schema.column_privileges
      WHERE table_schema='public' AND table_name='project_media'
        AND grantee='anon' AND privilege_type='SELECT'`,
  );
  const grantedSet = granted ? granted.split(",") : [];
  const expected = [
    "id",
    "media_type",
    "project_id",
    "semantic_role",
    "sort_order",
    "title",
    "url",
  ];
  JSON.stringify(grantedSet) === JSON.stringify(expected)
    ? ok(`anon reads exactly the presentation columns (${expected.join(", ")})`)
    : bad("anon reads exactly the presentation columns", `got: ${granted}`);

  grantedSet.includes("metadata")
    ? bad("metadata is NOT public", "metadata is granted to anon")
    : ok("metadata is NOT granted to anon (provenance stays private)");

  const tableWide = A.scalar(
    `SELECT count(*) FROM information_schema.table_privileges
      WHERE table_schema='public' AND table_name='project_media'
        AND grantee IN ('anon','authenticated') AND privilege_type='SELECT'`,
  );
  tableWide === "0"
    ? ok("no table-wide SELECT on project_media for browser roles")
    : bad("no table-wide SELECT on project_media for browser roles", `count=${tableWide}`);

  for (const fn of [
    "forever_project_media_semantic_projection",
    "forever_project_cover_reconcile",
    "forever_project_cover_withdraw",
  ]) {
    const canExec = A.scalar(
      `SELECT bool_or(has_function_privilege(r, p.oid, 'EXECUTE'))::text
         FROM pg_proc p, unnest(ARRAY['anon','authenticated']) AS r
        WHERE p.proname = '${fn}'`,
    );
    canExec === "false"
      ? ok(`${fn} is not executable by anon/authenticated`)
      : bad(`${fn} is not executable by anon/authenticated`, `has_function_privilege=${canExec}`);

    const svc = A.scalar(
      `SELECT bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE'))::text
         FROM pg_proc p WHERE p.proname = '${fn}'`,
    );
    svc === "true"
      ? ok(`${fn} is executable by service_role`)
      : bad(`${fn} service_role EXECUTE`, svc);
  }

  // =========================================================================
  // PATH B — realistic upgrade
  // =========================================================================
  console.log("\n[media-pg] PATH B — upgrade over realistic pre-PR117 data");
  const Bc = new Cluster("upgrade", process.env.FOREVER_PG_PORT_B || 55441);
  clusters.push(Bc);
  Bc.start();
  Bc.file(BOOTSTRAP);
  applyChain(Bc, files.slice(0, subjectIndex));
  ok(`chain applied through origin/main only (${subjectIndex} migrations, subject withheld)`);

  seedPreUpgradeFixtures(Bc);
  const seeded = {
    projects: Bc.scalar("SELECT count(*) FROM public.projects"),
    media: Bc.scalar("SELECT count(*) FROM public.project_media"),
    units: Bc.scalar("SELECT count(*) FROM public.units"),
    buildings: Bc.scalar("SELECT count(*) FROM public.buildings"),
  };
  console.log(
    `  fixtures: projects=${seeded.projects} media=${seeded.media} units=${seeded.units} buildings=${seeded.buildings}`,
  );

  const beforeDigest = Bc.scalar(
    `SELECT md5(string_agg(t, '|' ORDER BY t)) FROM (
       SELECT project_id::text || ':' || media_type || ':' || url || ':' || sort_order::text AS t
         FROM public.project_media) s`,
  );
  const unrelatedBefore = Bc.scalar(
    `SELECT md5(string_agg(media_type || ':' || url || ':' || sort_order::text, '|' ORDER BY url))
       FROM public.project_media WHERE project_id='${P.unrelated}'`,
  );
  const unitsBefore = Bc.scalar(
    `SELECT md5(string_agg(unit_code || ':' || availability_status || ':' || COALESCE(base_price_thb::text,'-'), '|' ORDER BY unit_code))
       FROM public.units`,
  );

  // -- the upgrade itself ---------------------------------------------------
  Bc.file(join(MIGRATIONS_DIR, SUBJECT));
  ok("subject migration applied over populated database");

  const survivors = Bc.scalar(
    "SELECT count(*) FROM public.project_media WHERE semantic_role IS NULL",
  );
  survivors === seeded.media
    ? ok(`all ${survivors} pre-existing media rows survived with semantic_role NULL`)
    : bad("pre-existing rows survive as NULL", `${survivors} of ${seeded.media}`);

  const afterDigest = Bc.scalar(
    `SELECT md5(string_agg(t, '|' ORDER BY t)) FROM (
       SELECT project_id::text || ':' || media_type || ':' || url || ':' || sort_order::text AS t
         FROM public.project_media) s`,
  );
  afterDigest === beforeDigest
    ? ok("migration performed no DML — media rows byte-identical before/after")
    : bad("migration performed no DML", "project_media changed during migration");

  // -- Direct Publish: Sierra-shaped cover replacement ----------------------
  console.log("\n[media-pg] Direct Publish — Sierra-shaped cover replacement");
  const sierraBatch = batch({
    slug: "the-title-sierra",
    set: { main_image_url: URLS.sierraNewCover },
    media: [
      {
        media_type: "cover",
        url: URLS.sierraNewCover,
        sort_order: 0,
        semantic_role: "architecture_render",
      },
      {
        media_type: "gallery",
        url: URLS.sierraLegacyGallery,
        sort_order: 1,
        semantic_role: "lifestyle",
      },
      {
        media_type: "gallery",
        url: "https://cdn.example.com/sierra/4fd0eacb-pool.png",
        sort_order: 2,
        semantic_role: "amenity",
      },
    ],
  });
  const sierraSummary = directPublish(Bc, sierraBatch);
  console.log(`  summary: ${sierraSummary.slice(0, 220)}`);

  const sierraCovers = Bc.scalar(
    `SELECT count(*) FROM public.project_media WHERE project_id='${P.sierra}' AND media_type='cover'`,
  );
  sierraCovers === "1"
    ? ok("exactly one active cover remains after replacement")
    : bad("exactly one active cover remains", `count=${sierraCovers}`);

  const sierraActive = Bc.scalar(
    `SELECT url FROM public.project_media WHERE project_id='${P.sierra}' AND media_type='cover'`,
  );
  sierraActive === URLS.sierraNewCover
    ? ok("the new exterior render is the active cover — no stale cover wins")
    : bad("new cover is active", sierraActive);

  const sierraRetired = Bc.scalar(
    `SELECT media_type FROM public.project_media
      WHERE project_id='${P.sierra}' AND url='${URLS.sierraOldCover}'`,
  );
  sierraRetired === "superseded_cover"
    ? ok("the HOLIDAY MOMENTS cover is retired to superseded_cover (not gallery)")
    : bad("old cover retired to superseded_cover", `media_type=${sierraRetired}`);

  const sierraPreserved = Bc.scalar(
    `SELECT count(*) FROM public.project_media
      WHERE project_id='${P.sierra}' AND url='${URLS.sierraOldCover}'`,
  );
  sierraPreserved === "1"
    ? ok("the retired row and its storage URL are preserved — nothing deleted")
    : bad("retired row preserved", `count=${sierraPreserved}`);

  const readerSet = Bc.scalar(
    `SELECT count(*) FROM public.project_media
      WHERE project_id='${P.sierra}' AND media_type IN ('cover','gallery')
        AND url='${URLS.sierraOldCover}'`,
  );
  readerSet === "0"
    ? ok("the retired cover is outside the gallery reader set (cover|gallery)")
    : bad("retired cover excluded from reader set", `count=${readerSet}`);

  const sierraRole = Bc.scalar(
    `SELECT semantic_role FROM public.project_media
      WHERE project_id='${P.sierra}' AND url='${URLS.sierraNewCover}' AND media_type='cover'`,
  );
  sierraRole === "architecture_render"
    ? ok("the exact Factory role is stored on the published row")
    : bad("Factory role stored", `semantic_role=${sierraRole}`);

  const legacyRole = Bc.scalar(
    `SELECT semantic_role FROM public.project_media
      WHERE project_id='${P.sierra}' AND url='${URLS.sierraLegacyGallery}'`,
  );
  legacyRole === "lifestyle"
    ? ok("a pre-existing role-less row receives its role on re-publish")
    : bad("legacy row receives role", `semantic_role=${legacyRole}`);

  // -- replay ---------------------------------------------------------------
  const replayDigest = () =>
    Bc.scalar(
      `SELECT md5(string_agg(media_type || ':' || url || ':' || COALESCE(semantic_role,'-') || ':' || sort_order::text, '|' ORDER BY url, media_type))
         FROM public.project_media WHERE project_id='${P.sierra}'`,
    );
  const beforeReplay = replayDigest();
  const replayCount = Bc.scalar(
    `SELECT count(*) FROM public.project_media WHERE project_id='${P.sierra}'`,
  );
  directPublish(Bc, sierraBatch);
  const afterReplay = replayDigest();
  const afterReplayCount = Bc.scalar(
    `SELECT count(*) FROM public.project_media WHERE project_id='${P.sierra}'`,
  );
  afterReplay === beforeReplay && afterReplayCount === replayCount
    ? ok("identical replay changes zero semantic values and creates no duplicate row")
    : bad(
        "replay idempotent",
        `${beforeReplay} -> ${afterReplay}, ${replayCount} -> ${afterReplayCount}`,
      );

  // -- a batch WITHOUT semantic_role must not erase a recorded role ---------
  directPublish(
    Bc,
    batch({
      slug: "the-title-sierra",
      media: [{ media_type: "cover", url: URLS.sierraNewCover, sort_order: 0 }],
    }),
  );
  const preservedRole = Bc.scalar(
    `SELECT semantic_role FROM public.project_media
      WHERE project_id='${P.sierra}' AND url='${URLS.sierraNewCover}' AND media_type='cover'`,
  );
  preservedRole === "architecture_render"
    ? ok("a batch carrying no semantic_role does not erase the recorded role")
    : bad("role preserved when batch omits it", `semantic_role=${preservedRole}`);

  // -- Coralina: same shape, independent project ---------------------------
  console.log("\n[media-pg] Direct Publish — Coralina-shaped replacement");
  directPublish(
    Bc,
    batch({
      slug: "coralina",
      set: { main_image_url: URLS.coralinaNewCover },
      media: [
        {
          media_type: "cover",
          url: URLS.coralinaNewCover,
          sort_order: 0,
          semantic_role: "property_exterior",
        },
      ],
    }),
  );
  const coralinaCovers = Bc.scalar(
    `SELECT count(*) FROM public.project_media WHERE project_id='${P.coralina}' AND media_type='cover'`,
  );
  const coralinaRetired = Bc.scalar(
    `SELECT media_type FROM public.project_media
      WHERE project_id='${P.coralina}' AND url='${URLS.coralinaOldCover}'`,
  );
  coralinaCovers === "1" && coralinaRetired === "superseded_cover"
    ? ok("Coralina's launch-event cover retired; exactly one active cover")
    : bad("Coralina reconciliation", `covers=${coralinaCovers} old=${coralinaRetired}`);

  // -- price-only enrichment must not touch the cover -----------------------
  console.log("\n[media-pg] Direct Publish — price-only enrichment");
  const normalCoverBefore = Bc.scalar(
    `SELECT media_type || '|' || url FROM public.project_media
      WHERE project_id='${P.normal}' AND media_type='cover'`,
  );
  directPublish(Bc, batch({ slug: "normal-project", media: [] }));
  const normalCoverAfter = Bc.scalar(
    `SELECT media_type || '|' || url FROM public.project_media
      WHERE project_id='${P.normal}' AND media_type='cover'`,
  );
  normalCoverAfter === normalCoverBefore
    ? ok("a batch declaring no cover leaves the existing cover untouched")
    : bad("price-only enrichment preserves cover", `${normalCoverBefore} -> ${normalCoverAfter}`);

  // -- Villa Kirara stays honestly cover-less -------------------------------
  directPublish(
    Bc,
    batch({
      slug: "the-title-villa-kirara",
      media: [
        { media_type: "unit_plan", url: URLS.kiraraPlan, sort_order: 0, semantic_role: "plan" },
      ],
    }),
  );
  const kiraraCovers = Bc.scalar(
    `SELECT count(*) FROM public.project_media WHERE project_id='${P.kirara}' AND media_type='cover'`,
  );
  const kiraraHero = Bc.scalar(
    `SELECT COALESCE(main_image_url,'(null)') FROM public.projects WHERE id='${P.kirara}'`,
  );
  kiraraCovers === "0" && kiraraHero === "(null)"
    ? ok("Villa Kirara remains honestly cover-less — none fabricated")
    : bad("Villa Kirara cover-less", `covers=${kiraraCovers} hero=${kiraraHero}`);

  // -- a returning cover: A -> B -> A -> B ---------------------------------
  // Independent review found the retire was not collision-proof. A cover that
  // comes back leaves a retired AND a live row for the same URL, and retiring
  // it again would duplicate (project_id,'superseded_cover',url). The original
  // fixtures never re-covered a previously retired URL, so they could not see
  // it.
  console.log("\n[media-pg] Direct Publish — a cover that returns (A/B/A/B)");
  const FLIP = "dd000000-0000-4000-8000-000000000009";
  const FA = "https://cdn.example.com/flip/a.jpg";
  const FB = "https://cdn.example.com/flip/b.jpg";
  Bc.sql(
    `INSERT INTO public.projects (id,name,slug,is_active,main_image_url)
       VALUES ('${FLIP}','Flip','flip-project',true,'${FA}');
     INSERT INTO public.project_media (project_id,media_type,url,sort_order)
       VALUES ('${FLIP}','cover','${FA}',0);`,
  );
  const flipPublish = (cover, tag) =>
    directPublish(
      Bc,
      batch({
        slug: "flip-project",
        set: { main_image_url: cover },
        media: [
          { media_type: "cover", url: cover, sort_order: 0, semantic_role: "property_exterior" },
          {
            media_type: "gallery",
            url: `${cover}#${tag}`,
            sort_order: 1,
            semantic_role: "amenity",
          },
        ],
      }),
    );
  let flipError = "";
  try {
    flipPublish(FB, "r1");
    flipPublish(FA, "r2");
    flipPublish(FB, "r3");
    flipPublish(FA, "r4");
  } catch (error) {
    flipError = String(error.stderr ?? "") + String(error.stdout ?? "");
  }
  flipError === ""
    ? ok("a returning cover republishes without a natural-key violation")
    : bad("returning cover republishes", flipError.slice(0, 400));

  const flipDupes = Bc.scalar(
    `SELECT count(*) FROM (
       SELECT url FROM public.project_media
        WHERE project_id='${FLIP}' AND media_type IN ('cover','superseded_cover')
        GROUP BY url HAVING count(*) > 1) s`,
  );
  flipDupes === "0"
    ? ok("no URL is ever both an active and a retired cover at once")
    : bad("no URL is both active and retired", `duplicated urls=${flipDupes}`);

  const flipCovers = Bc.scalar(
    `SELECT count(*) FROM public.project_media WHERE project_id='${FLIP}' AND media_type='cover'`,
  );
  flipCovers === "1"
    ? ok("a returning cover still ends with exactly one active cover")
    : bad("returning cover leaves one active cover", `count=${flipCovers}`);

  // -- the documented rollback must actually RUN ----------------------------
  //
  // Extracted from the migration file, not retyped. This check previously ran a
  // hand-copied UPDATE that merely resembled the documented block: it proved
  // that *a* statement executes, and would have gone on passing after any edit
  // to the rollback it claims to verify. What is executed below is the exact
  // text between the ROLLBACK-SQL markers.
  //
  // Wrapped in BEGIN … ROLLBACK, because this cluster's remaining assertions
  // need the migration still applied. That proves the block PARSES and RUNS
  // against the real post-migration schema without violating the natural key —
  // which is the property that was false before, and is what a rollback is
  // needed for at 3am.
  console.log("\n[media-pg] rollback — the documented text, executed");
  const subjectSql = readFileSync(join(MIGRATIONS_DIR, SUBJECT), "utf8");
  const rollbackBlock = subjectSql
    .slice(
      subjectSql.indexOf("-- ROLLBACK-SQL-BEGIN") + "-- ROLLBACK-SQL-BEGIN".length,
      subjectSql.indexOf("-- ROLLBACK-SQL-END"),
    )
    .split("\n")
    .map((line) => line.replace(/^\s*--\s?/, ""))
    .join("\n")
    .trim();

  rollbackBlock.includes("DROP COLUMN IF EXISTS semantic_role") &&
  rollbackBlock.includes("forever_project_cover_withdraw") &&
  !rollbackBlock.includes("--")
    ? ok("the rollback block extracted from the migration is complete and comment-free")
    : bad("rollback block extracted", rollbackBlock.slice(0, 300));

  let rollbackError = "";
  try {
    Bc.sql(`BEGIN;\n${rollbackBlock}\nROLLBACK;`);
  } catch (error) {
    rollbackError = String(error.stderr ?? "") + String(error.stdout ?? "");
  }
  rollbackError === ""
    ? ok("the documented rollback executes without violating the natural key")
    : bad("documented rollback executes", rollbackError.slice(0, 400));

  // …and the ROLLBACK really did leave the migration in place, so everything
  // asserted after this point is still asserted against the migrated schema.
  Bc.scalar(
    `SELECT count(*) FROM information_schema.columns
      WHERE table_schema='public' AND table_name='project_media' AND column_name='semantic_role'`,
  ) === "1"
    ? ok("the rollback ran inside a transaction and left the schema untouched")
    : bad("rollback probe left the schema alone", "semantic_role is gone");

  // -- natural-key collision probe -----------------------------------------
  // The retired URL also exists as a gallery row on another project shape; a
  // retire that collided would have raised here already. Prove no duplicate.
  const dupes = Bc.scalar(
    `SELECT count(*) FROM (
       SELECT project_id, media_type, url FROM public.project_media
        GROUP BY project_id, media_type, url HAVING count(*) > 1) s`,
  );
  dupes === "0"
    ? ok("no natural-key collision: (project_id, media_type, url) unique throughout")
    : bad("no natural-key collision", `duplicate groups=${dupes}`);

  // -- composition + summary ------------------------------------------------
  const published = Bc.scalar(`SELECT public_status FROM public.projects WHERE id='${P.sierra}'`);
  published === "published" ? ok("project published atomically") : bad("published", published);

  for (const key of [
    "semantic_roles_applied",
    "covers_retired",
    "public_prices_projected",
    "direct_published",
  ]) {
    sierraSummary.includes(key)
      ? ok(`summary reports ${key}`)
      : bad(`summary reports ${key}`, sierraSummary.slice(0, 200));
  }

  // -- failure rolls everything back ---------------------------------------
  console.log("\n[media-pg] atomicity — a failing publish must roll back");
  const beforeFail = Bc.scalar(
    `SELECT md5(string_agg(media_type || ':' || url || ':' || COALESCE(semantic_role,'-'), '|' ORDER BY url, media_type))
       FROM public.project_media WHERE project_id='${P.coralina}'`,
  );
  const failOut = Bc.expectFailure(
    `SELECT public.forever_direct_publish('${batch({
      slug: "coralina",
      set: { main_image_url: URLS.coralinaNewCover },
      media: [
        {
          media_type: "cover",
          url: URLS.coralinaNewCover,
          sort_order: 0,
          semantic_role: "property_exterior",
        },
        {
          media_type: "gallery",
          url: "https://cdn.example.com/coralina/x.jpg",
          sort_order: 1,
          semantic_role: "not_a_role",
        },
      ],
    })}'::jsonb, '{"source_trust":"owner_approved_official","publication_mode":"direct"}'::jsonb)`,
    "invalid role inside a publish",
  );
  /project_media_semantic_role_vocabulary/.test(failOut)
    ? ok("an invalid role is refused by the database as defence in depth")
    : bad("invalid role refused in publish", failOut.slice(0, 300));

  const afterFail = Bc.scalar(
    `SELECT md5(string_agg(media_type || ':' || url || ':' || COALESCE(semantic_role,'-'), '|' ORDER BY url, media_type))
       FROM public.project_media WHERE project_id='${P.coralina}'`,
  );
  afterFail === beforeFail
    ? ok("the failed publish rolled back project, media and cover changes together")
    : bad("failure rolls back", `${beforeFail} -> ${afterFail}`);

  // -- unrelated business data ---------------------------------------------
  console.log("\n[media-pg] unchanged business data");
  const unrelatedAfter = Bc.scalar(
    `SELECT md5(string_agg(media_type || ':' || url || ':' || sort_order::text, '|' ORDER BY url))
       FROM public.project_media WHERE project_id='${P.unrelated}'`,
  );
  unrelatedAfter === unrelatedBefore
    ? ok("unrelated project media byte-for-byte unchanged")
    : bad("unrelated media unchanged", `${unrelatedBefore} -> ${unrelatedAfter}`);

  const unitsAfter = Bc.scalar(
    `SELECT md5(string_agg(unit_code || ':' || availability_status || ':' || COALESCE(base_price_thb::text,'-'), '|' ORDER BY unit_code))
       FROM public.units`,
  );
  unitsAfter === unitsBefore
    ? ok("units, availability, SOLD status and current prices unchanged")
    : bad("units unchanged", `${unitsBefore} -> ${unitsAfter}`);

  const soldStill = Bc.scalar(
    `SELECT availability_status FROM public.units WHERE id='${U.soldUnit}'`,
  );
  soldStill === "sold" ? ok("the SOLD unit is still sold") : bad("SOLD preserved", soldStill);

  const buildingsAfter = Bc.scalar("SELECT count(*) FROM public.buildings");
  buildingsAfter === seeded.buildings
    ? ok("buildings unchanged")
    : bad("buildings unchanged", `${seeded.buildings} -> ${buildingsAfter}`);

  const unrelatedProject = Bc.scalar(
    `SELECT COALESCE(public_status,'(null)') || '|' || COALESCE(main_image_url,'(null)')
       FROM public.projects WHERE id='${P.unrelated}'`,
  );
  unrelatedProject.endsWith(URLS.unrelatedCover)
    ? ok("unrelated project row unchanged (never published by these runs)")
    : bad("unrelated project unchanged", unrelatedProject);

  // =========================================================================
  // A REJECTED COVER IS ACTUALLY WITHDRAWN
  // =========================================================================
  //
  // `publish.ts` clears `main_image_url` when the policy examined the supplied
  // photographs and found that none depicts the property. The ingest's
  // `IS NOT NULL` guard discarded that explicit null, so the rejected cover kept
  // being served and `hero_candidate_missing` was a report with no effect. This
  // proves it now takes effect, and — just as importantly — that the narrow case
  // stays narrow.
  console.log("\n[media-pg] Direct Publish — a rejected cover is withdrawn, not merely reported");
  const WD = "dd000000-0000-4000-8000-00000000000a";
  const WDC = "https://cdn.example.com/withdraw/old-cover.jpg";
  Bc.sql(
    `INSERT INTO public.projects (id,name,slug,is_active,main_image_url)
       VALUES ('${WD}','Withdraw','withdraw-project',true,'${WDC}');
     INSERT INTO public.project_media (project_id,media_type,url,sort_order,semantic_role)
       VALUES ('${WD}','cover','${WDC}',0,'property_exterior');`,
  );

  // A price-only enrichment carries no media and no explicit null: the cover
  // must survive untouched. This is the regression the narrowness protects.
  directPublish(Bc, batch({ slug: "withdraw-project", set: { price_range: "THB 9M - 20M" } }));
  const afterEnrich = Bc.scalar(
    `SELECT COALESCE(main_image_url,'(null)') FROM public.projects WHERE id='${WD}'`,
  );
  afterEnrich === WDC
    ? ok("a price-only enrichment leaves a good cover completely alone")
    : bad("enrichment preserves the cover", afterEnrich);

  // Now the real case: photographs were supplied, all rejected, explicit null.
  const withdrawSummary = directPublish(
    Bc,
    batch({
      slug: "withdraw-project",
      set: { main_image_url: null },
      media: [
        {
          media_type: "gallery",
          url: "https://cdn.example.com/withdraw/party.jpg",
          sort_order: 1,
          semantic_role: "event",
        },
      ],
    }),
  );

  const afterWithdraw = Bc.scalar(
    `SELECT COALESCE(main_image_url,'(null)') FROM public.projects WHERE id='${WD}'`,
  );
  afterWithdraw === "(null)"
    ? ok("an explicit null actually clears main_image_url")
    : bad("explicit null clears main_image_url", afterWithdraw);

  const activeCovers = Bc.scalar(
    `SELECT count(*) FROM public.project_media WHERE project_id='${WD}' AND media_type='cover'`,
  );
  activeCovers === "0"
    ? ok("the rejected cover row is retired, so no reader can elect it")
    : bad("rejected cover row retired", activeCovers);

  const retainedRow = Bc.scalar(
    `SELECT count(*) FROM public.project_media
      WHERE project_id='${WD}' AND media_type='superseded_cover' AND url='${WDC}'`,
  );
  retainedRow === "1"
    ? ok("the row is retired, never deleted — the media evidence survives")
    : bad("withdrawn cover retained as superseded_cover", retainedRow);

  withdrawSummary.includes('"covers_withdrawn": 1') ||
  withdrawSummary.includes('"covers_withdrawn":1')
    ? ok("the publish summary reports covers_withdrawn")
    : bad("summary reports covers_withdrawn", withdrawSummary.slice(0, 300));

  // Idempotent, and safe to repeat after the cover has already gone.
  let withdrawAgainError = "";
  try {
    directPublish(
      Bc,
      batch({
        slug: "withdraw-project",
        set: { main_image_url: null },
        media: [
          {
            media_type: "gallery",
            url: "https://cdn.example.com/withdraw/party2.jpg",
            sort_order: 1,
            semantic_role: "event",
          },
        ],
      }),
    );
  } catch (error) {
    withdrawAgainError = String(error.stderr ?? "") + String(error.stdout ?? "");
  }
  withdrawAgainError === ""
    ? ok("withdrawing an already-withdrawn cover is a safe no-op")
    : bad("withdraw is idempotent", withdrawAgainError.slice(0, 400));

  // And a project can recover: a later publish naming a real cover restores one.
  directPublish(
    Bc,
    batch({
      slug: "withdraw-project",
      set: { main_image_url: "https://cdn.example.com/withdraw/exterior.jpg" },
      media: [
        {
          media_type: "cover",
          url: "https://cdn.example.com/withdraw/exterior.jpg",
          sort_order: 0,
          semantic_role: "property_exterior",
        },
      ],
    }),
  );
  const recovered = Bc.scalar(
    `SELECT COALESCE(main_image_url,'(null)') || '|' ||
            (SELECT count(*) FROM public.project_media
              WHERE project_id='${WD}' AND media_type='cover')::text
       FROM public.projects WHERE id='${WD}'`,
  );
  recovered === "https://cdn.example.com/withdraw/exterior.jpg|1"
    ? ok("a withdrawn project recovers a cover the moment a safe one is published")
    : bad("cover recovers after withdrawal", recovered);

  // =========================================================================
  // ROLE COMPLETENESS — the rollout's closing gate, executed
  // =========================================================================
  //
  // The public readers show a role-less row on purpose, because on deploy day
  // every published row is role-less. That permissiveness is only defensible if
  // something later refuses to let it stand. This runs the real gate script
  // against this disposable cluster's real rows, at both stages, and then
  // simulates the backfill and runs it again. Nothing here touches any database
  // but the throwaway one B created.
  console.log("\n[media-pg] role completeness — the post-backfill release gate");

  const censusUrl = `postgres://postgres@127.0.0.1:${Bc.port}/postgres`;
  const runGate = (stage) => {
    try {
      const stdout = execFileSync(
        process.execPath,
        [
          join(REPO, "scripts", "media", "role-completeness-report.mjs"),
          "--database-url",
          censusUrl,
          "--stage",
          stage,
        ],
        { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      return { code: 0, out: stdout };
    } catch (error) {
      return {
        code: error.status ?? 1,
        out: String(error.stdout ?? "") + String(error.stderr ?? ""),
      };
    }
  };

  // Fixture reality: the seeded pre-PR117 rows have no role, exactly like
  // production today.
  Bc.sql(
    `UPDATE public.project_media SET semantic_role = NULL
      WHERE project_id = '${P.unrelated}' AND media_type IN ('cover','gallery')`,
  );
  const roleLessBefore = Number(
    Bc.scalar(
      `SELECT count(*) FROM public.project_media
        WHERE media_type IN ('cover','gallery') AND semantic_role IS NULL`,
    ),
  );
  roleLessBefore > 0
    ? ok(`census sees ${roleLessBefore} role-less public row(s), as production does today`)
    : bad("role-less rows present to gate on", `got ${roleLessBefore}`);

  const before = runGate("before_backfill");
  // The measured grant, printed into the proof rather than summarised. A release
  // record that says "the grant is correct" without showing the measurement is
  // the kind of claim this whole PR keeps having to retract.
  for (const line of before.out.split("\n")) {
    if (line.startsWith("anon grant")) console.log(`  ${line.trim()}`);
  }
  before.code === 0 && before.out.includes("GATE  PASS")
    ? ok("before the backfill the gate passes and states the role-less count")
    : bad("before_backfill gate passes", before.out.slice(-400));

  const after = runGate("after_backfill");
  after.code === 1 && after.out.includes("GATE  BLOCKED")
    ? ok("after the backfill the SAME rows block the release")
    : bad(
        "after_backfill gate blocks on role-less rows",
        `exit ${after.code}\n${after.out.slice(-400)}`,
      );

  // Assert the NUMBER against the database, not the label.
  //
  // The first version of this check tested only that the output contained
  // "superseded_cover; never presentation media" — a static string the script
  // prints whatever the count says. It passed while the script was reading a
  // snake_case property off a camelCase row and reporting 0 retired rows on
  // every database. A check that cannot fail is worse than no check.
  //
  // Scoped to published projects, because that is the population the report
  // describes. The census derives `retired` from the rows CENSUS_SQL returned,
  // and CENSUS_SQL already restricts to `p.is_active AND public_status =
  // 'published'`. An unscoped count compared two different row sets: put one
  // retired cover on a draft project and this check failed while both sides
  // were behaving correctly. It passed only because every superseded_cover in
  // the fixtures happened to belong to a project the run had published.
  const retiredInDb = Number(
    Bc.scalar(
      `SELECT count(*) FROM public.project_media m JOIN public.projects p ON p.id = m.project_id
        WHERE m.media_type = 'superseded_cover'
          AND p.is_active AND p.public_status = 'published'`,
    ),
  );
  const retiredReported = Number(/retired rows\s*:\s*(\d+)/.exec(after.out)?.[1] ?? -1);
  retiredInDb > 0 && retiredReported === retiredInDb
    ? ok(`the census counts all ${retiredInDb} retired row(s), and governs none of them`)
    : bad(
        "retired rows counted and excluded from the governed set",
        `db=${retiredInDb} reported=${retiredReported}`,
      );

  // Governed counts are cover + gallery of PUBLICLY VISIBLE projects only.
  //
  // `projects.public_status` defaults to 'draft' and the RLS policy admits a
  // media row only when its project is is_active AND published, so a draft's
  // rows are not public image rows. Counting them would refuse a production
  // release over media no anonymous client can fetch — and staging holds
  // exactly such drafts.
  // Mirrors GOVERNED_MEDIA_TYPES: every type a public reader can surface —
  // photographs, plans, documents, payment plans, brochures and videos — and
  // never a retired cover or a price list.
  const GOVERNED = `('cover','gallery','floor_plan','master_plan','unit_plan','document','brochure','payment_plan','video')`;
  const governedInDb = Number(
    Bc.scalar(
      `SELECT count(*) FROM public.project_media m JOIN public.projects p ON p.id = m.project_id
        WHERE m.media_type IN ${GOVERNED}
          AND p.is_active AND p.public_status = 'published'`,
    ),
  );
  const governedReported = Number(/governed rows\s*:\s*(\d+)/.exec(after.out)?.[1] ?? -1);
  governedReported === governedInDb
    ? ok(`the census governs exactly the ${governedInDb} publicly visible media row(s)`)
    : bad("governed count matches the database", `db=${governedInDb} reported=${governedReported}`);

  // ...and says out loud what it left out, rather than reporting a clean sheet
  // it narrowed its way into.
  //
  // Counted the way EXCLUDED_SQL counts, not derived as `all - governed`.
  // Those are two different row sets and subtracting them was wrong twice
  // over: EXCLUDED_SQL takes every media_type except `price_list`, including
  // `superseded_cover` which the governed list omits on purpose, and a retired
  // cover on a PUBLISHED project belongs to neither side of the subtraction.
  // The arithmetic agreed with the census only while the fixtures happened to
  // contain no such row; a draft project holding a payment plan, or a retired
  // cover on a published one, failed a check that had nothing wrong with it.
  const excludedInDb = Number(
    Bc.scalar(
      `SELECT count(*) FROM public.project_media m
         LEFT JOIN public.projects p ON p.id = m.project_id
        WHERE m.media_type <> 'price_list'
          AND (p.id IS NULL OR NOT p.is_active OR p.public_status IS DISTINCT FROM 'published')`,
    ),
  );
  const excludedReported = Number(/not counted\s*:\s*(\d+)/.exec(after.out)?.[1] ?? -1);
  excludedInDb > 0 && excludedReported === excludedInDb
    ? ok(`the census states the ${excludedReported} unpublished row(s) it did not count`)
    : bad(
        "census reports what it excluded",
        `db-excluded=${excludedInDb} governed=${governedInDb} reported-excluded=${excludedReported}`,
      );

  // The grant the whole contract rests on, checked by the gate rather than
  // argued in a comment.
  after.out.includes("anon can read semantic_role") &&
  after.out.includes("anon cannot read project_media.metadata")
    ? ok("the gate observes the public grant on the target database")
    : bad("gate reports the anon grant", after.out.slice(-600));

  // And it must BLOCK when the grant is wrong, whatever the roles say. This is
  // the second deploy-order hazard made executable: 20260723130000's table-level
  // REVOKE removes column grants too, so applying it after 20260728120000 takes
  // `semantic_role` away and both public projections 42703.
  Bc.sql("REVOKE SELECT ON TABLE public.project_media FROM anon");
  Bc.sql(
    `GRANT SELECT (id, project_id, media_type, title, url, sort_order)
       ON public.project_media TO anon`,
  );
  const stripped = runGate("before_backfill");
  stripped.code === 1 && stripped.out.includes("anon cannot SELECT project_media.semantic_role")
    ? ok("a stripped grant BLOCKS the release, at the permissive stage too")
    : bad("stripped grant blocks", `exit ${stripped.code}\n${stripped.out.slice(-500)}`);

  // Restore what 20260728120000 grants, and confirm the gate agrees again.
  Bc.sql(
    `GRANT SELECT (id, project_id, media_type, title, url, sort_order, semantic_role)
       ON public.project_media TO anon`,
  );
  const restored = runGate("before_backfill");
  restored.code === 0
    ? ok("restoring the column grant clears the block")
    : bad("restored grant passes", restored.out.slice(-500));

  // A readable `metadata` is a release failure on its own terms.
  Bc.sql("GRANT SELECT (metadata) ON public.project_media TO anon");
  const leaky = runGate("before_backfill");
  leaky.code === 1 && leaky.out.includes("anon CAN SELECT project_media.metadata")
    ? ok("an anon-readable metadata column BLOCKS the release")
    : bad("metadata exposure blocks", `exit ${leaky.code}\n${leaky.out.slice(-500)}`);
  Bc.sql("REVOKE SELECT (metadata) ON public.project_media FROM anon");

  // Simulate the controlled backfill on this throwaway cluster only.
  Bc.sql(
    `UPDATE public.project_media SET semantic_role = 'property_exterior'
      WHERE media_type IN ('cover','gallery') AND semantic_role IS NULL`,
  );
  const closed = runGate("after_backfill");
  closed.code === 0 && closed.out.includes("GATE  PASS")
    ? ok("once every public row carries a role the gate passes")
    : bad(
        "gate passes after a complete backfill",
        `exit ${closed.code}\n${closed.out.slice(-400)}`,
      );

  // And a value outside the vocabulary must be impossible, not merely reported.
  const vocabularyError = Bc.expectFailure(
    `UPDATE public.project_media SET semantic_role = 'logo'
      WHERE media_type = 'gallery' AND semantic_role IS NOT NULL`,
    "out-of-vocabulary role",
  );
  /violates check constraint "project_media_semantic_role_vocabulary"/.test(vocabularyError)
    ? ok("the database refuses a role outside the vocabulary, so the census cannot see one")
    : bad("vocabulary CHECK refuses an invented role", vocabularyError.slice(0, 300));

  // =========================================================================
  // PATH C — the semantic-role backfill controller, executed
  // =========================================================================
  //
  // FOREVER-SEMANTIC-MEDIA-BACKFILL-001. Path A proved the migration applies
  // and Path B proved the publish RPC behaves. Neither says anything about the
  // controller that writes `semantic_role` onto rows that already exist, and
  // that controller is the thing about to be pointed at the live public
  // database.
  //
  // Its own cluster, because its fixtures are shaped by content: every URL it
  // is asked to classify is the object path the publish lane would have
  // written for a specific file on disk, computed by running the real
  // `createPublicDerivative` and `publicMediaPath` over that file's bytes.
  // Seeding those URLs is the only way the join under test is the join being
  // exercised rather than a pair of matching constants.
  //
  // Path B's `seedPreUpgradeFixtures` is deliberately untouched: its assertions
  // depend on those exact rows.
  console.log("\n[media-pg] PATH C — semantic-role backfill controller, executed");

  const Cc = new Cluster("backfill", process.env.FOREVER_PG_PORT_C || 55442);
  clusters.push(Cc);
  Cc.start();
  Cc.file(BOOTSTRAP);
  applyChain(Cc, files);
  ok(`path C: complete chain applied to its own cluster (port ${Cc.port})`);

  // -- the repo's own rules, loaded the way a runner loads them --------------
  const heroPolicy = loadTs("src/features/forever-direct-publish/hero-policy.ts");
  const mediaPolicy = loadTs("src/lib/public-media-policy.ts");
  const objectPathModule = loadTs("src/features/forever-direct-publish/public-object-path.ts");
  const mediaTruth = loadTs("src/features/forever-studio/server/media-truth.ts");
  const imageFixtures = loadTs("src/features/forever-studio/tests/media-truth-fixtures.ts");
  const backfillFingerprints = loadTs("src/features/forever-semantic-backfill/fingerprints.ts");
  const backfillApply = loadTs("src/features/forever-semantic-backfill/apply-plan.ts");
  const backfillValidate = loadTs("src/features/forever-semantic-backfill/manifest-validate.ts");
  const backfillExceptions = loadTs("src/features/forever-semantic-backfill/exceptions.ts");
  const backfillJournal = loadTs("src/features/forever-semantic-backfill/journal.ts");
  const backfillRoles = loadTs("src/features/forever-semantic-backfill/role-resolution.ts");

  // M1/M2 — the two changes that exist so a `.mjs` runner can reach the real
  // rules instead of carrying a second copy of them. If either regressed, the
  // loads above would already have thrown; asserting identity is what proves
  // `publish.ts` re-exports rather than duplicates.
  typeof mediaPolicy.prohibitedPhotographUrls === "function"
    ? ok("jiti loads public-media-policy.ts, so the controller uses the REAL presentation policy")
    : bad("public-media-policy is loadable from a runner", "prohibitedPhotographUrls missing");

  // The reason `public-object-path.ts` exists, proven rather than asserted: a
  // runner still cannot load `publish.ts`, because it transitively imports a
  // tsconfig `@/` alias and jiti does not read tsconfig paths. If this ever
  // starts succeeding the extraction is no longer load-bearing — and if it keeps
  // failing while `publish.ts` has grown its own copy of the path rule, the
  // source check below is what catches it.
  let publishLoadError = "";
  try {
    loadTs("src/features/forever-direct-publish/publish.ts");
  } catch (error) {
    publishLoadError = String(error?.message ?? error);
  }
  publishLoadError.includes("@/import/currency-policy")
    ? ok("a runner still cannot load publish.ts — which is why the object-path rule was extracted")
    : bad(
        "publish.ts is unreachable from a runner",
        publishLoadError || "publish.ts loaded, so the extraction may no longer be needed",
      );
  {
    const publishSource = readFileSync(
      join(REPO, "src/features/forever-direct-publish/publish.ts"),
      "utf8",
    );
    const objectPathSource = readFileSync(
      join(REPO, "src/features/forever-direct-publish/public-object-path.ts"),
      "utf8",
    );
    const definedOnce =
      /export function publicMediaPath\(/.test(objectPathSource) &&
      /export function detectSanitizableImageType\(/.test(objectPathSource) &&
      !/export function publicMediaPath\(/.test(publishSource) &&
      !/export function detectSanitizableImageType\(/.test(publishSource) &&
      /from "\.\/public-object-path"/.test(publishSource) &&
      /publicMediaPath/.test(publishSource);
    definedOnce
      ? ok("publicMediaPath and detectSanitizableImageType are defined once and re-exported")
      : bad(
          "one implementation, not two",
          "publish.ts appears to define its own copy of the object-path rule",
        );
  }

  // -- fixtures, built from bytes -------------------------------------------
  const work = mkdtempSync(join(tmpdir(), "forever-backfill-proof-"));
  const packagesRoot = join(work, "packages");
  const artifacts = join(work, "artifacts");
  mkdirSync(packagesRoot, { recursive: true });
  mkdirSync(artifacts, { recursive: true });

  const CP = {
    coralina: "dd000000-0000-4000-8000-000000000001",
    sierra: "dd000000-0000-4000-8000-000000000002",
    kirara: "dd000000-0000-4000-8000-000000000003",
    quiet: "dd000000-0000-4000-8000-000000000004",
    seeded: "dd000000-0000-4000-8000-000000000005",
    draft: "dd000000-0000-4000-8000-000000000006",
  };
  const CSLUG = {
    [CP.coralina]: "coralina",
    [CP.sierra]: "the-title-sierra",
    [CP.kirara]: "the-title-villa-kirara",
    [CP.quiet]: "quiet-arbor",
    [CP.seeded]: "seeded-placeholder-villas",
    [CP.draft]: "draft-preview",
  };
  const CU = {
    coralinaAvailable: "ee000000-0000-4000-8000-000000000001",
    coralinaSold: "ee000000-0000-4000-8000-000000000002",
    sierraAvailable: "ee000000-0000-4000-8000-000000000003",
    quietAvailable: "ee000000-0000-4000-8000-000000000004",
    quietSold: "ee000000-0000-4000-8000-000000000005",
  };
  const CB = {
    coralina: "ff000000-0000-4000-8000-000000000001",
    sierra: "ff000000-0000-4000-8000-000000000002",
    quiet: "ff000000-0000-4000-8000-000000000003",
  };
  const CH = {
    coralina1: "e1000000-0000-4000-8000-000000000001",
    coralina2: "e1000000-0000-4000-8000-000000000002",
    quiet1: "e1000000-0000-4000-8000-000000000003",
  };

  const PKG = {
    coralinaCurrent: "coralina-corrected-2cc315a8",
    coralinaSecond: "coralina-second-opinion-9f10aa42",
    sierraCurrent: "the-title-sierra-corrected-1fdb9dfe",
    sierraPrefix: "the-title-sierra-prefix-run-1",
    kiraraCurrent: "the-title-villa-kirara-corrected-046387d7",
    kiraraPrefix: "the-title-villa-kirara-prefix-run-1",
  };
  const SUPERSEDED_PACKAGES = [PKG.sierraPrefix, PKG.kiraraPrefix];

  const STORAGE = "https://cdn.example.test/storage/v1/object/public/project-images/";

  /** The object path the publish lane would write for these bytes, recomputed. */
  function objectPathFor(slug, bytes) {
    const originalSha256 = createHash("sha256").update(bytes).digest("hex");
    const observedContentType = objectPathModule.detectSanitizableImageType(bytes);
    if (!observedContentType) throw new Error("path C fixture is not a publishable image");
    const derivative = mediaTruth.createPublicDerivative({
      bytes,
      originalSha256,
      originalSize: bytes.length,
      observedContentType,
    });
    if (!derivative.eligible || !derivative.record.derivative) {
      throw new Error(`path C fixture not eligible: ${derivative.reason}`);
    }
    return {
      originalSha256,
      objectPath: objectPathModule.publicMediaPath(
        slug,
        derivative.record.derivative.sha256,
        derivative.format,
      ),
    };
  }

  const png = (salt) => imageFixtures.syntheticPng(false, 1, salt);
  /** 1600x900 of nothing: 69 bytes over 1.44M pixels is flat artwork by geometry. */
  const flatPng = () => imageFixtures.syntheticPngWithDimensions(1600, 900);

  /**
   * Every media object Path C seeds.
   *
   * `copies` names the packages the bytes appear in, each with the manifest
   * fields that package records for them. `rows` is what production holds —
   * several rows may share one URL, which is the case the whole plan-per-URL
   * rule exists for.
   */
  const ITEMS = [
    // --- coralina shape: two cover rows, an event cover, logo artwork, plans
    {
      key: "coralinaCover",
      project: CP.coralina,
      bytes: png(101),
      rows: [["cover", 0]],
      isMainImage: true,
      copies: [
        {
          pkg: PKG.coralinaCurrent,
          file: "images/coralina-cover.png",
          manifest: {
            semantic_role: "property_exterior",
            drive_source_path: "root/11. Perspective/Exterior/01 Main Entrance.jpg",
          },
        },
      ],
      expect: "property_exterior",
    },
    {
      key: "coralinaEventCover",
      project: CP.coralina,
      bytes: png(102),
      rows: [["cover", 0]],
      copies: [
        {
          pkg: PKG.coralinaCurrent,
          file: "images/coralina-gallery-90.png",
          manifest: { drive_source_path: "root/12. Photo in the Event/Launch Party 04.jpg" },
        },
      ],
      expect: "event",
    },
    {
      key: "coralinaInterior",
      project: CP.coralina,
      bytes: png(103),
      rows: [["gallery", 1]],
      copies: [
        {
          pkg: PKG.coralinaCurrent,
          file: "images/coralina-gallery-91.png",
          manifest: { drive_source_path: "root/11. Perspective/Interior/Living Room 02.jpg" },
        },
      ],
      expect: "property_interior",
    },
    {
      key: "coralinaExterior",
      project: CP.coralina,
      bytes: png(104),
      rows: [["gallery", 2]],
      copies: [
        {
          pkg: PKG.coralinaCurrent,
          file: "images/coralina-gallery-92.png",
          manifest: { drive_source_path: "root/11. Perspective/Exterior/Tower Facade.jpg" },
        },
      ],
      expect: "property_exterior",
    },
    {
      key: "coralinaAmenity",
      project: CP.coralina,
      bytes: png(105),
      rows: [["gallery", 3]],
      copies: [
        {
          pkg: PKG.coralinaCurrent,
          file: "images/coralina-gallery-93.png",
          manifest: { drive_source_path: "root/11. Perspective/Exterior/Pet Club.jpg" },
        },
      ],
      expect: "amenity",
    },
    {
      // No manifest entry at all. The only thing true of it is its geometry.
      key: "coralinaLogo",
      project: CP.coralina,
      bytes: flatPng(),
      rows: [["gallery", 4]],
      copies: [
        { pkg: PKG.coralinaCurrent, file: "images/coralina-gallery-94.png", manifest: null },
      ],
      expect: "text_promo",
      expectTier: "planner_geometry_rule",
    },
    {
      // A pre-contract package's photograph: renamed, no section, no declared
      // role. The planner replay yields `unknown`, which must never be written.
      key: "coralinaUndescribed",
      project: CP.coralina,
      bytes: png(106),
      rows: [["gallery", 5]],
      copies: [
        {
          pkg: PKG.coralinaCurrent,
          file: "images/coralina-gallery-95.png",
          manifest: { onlyHash: true },
        },
      ],
      expect: null,
    },
    {
      // Two current packages, same authority, disagreeing. The role that shows
      // less must win and the disagreement must reach `review_required`.
      key: "coralinaConflict",
      project: CP.coralina,
      bytes: png(107),
      rows: [["gallery", 6]],
      copies: [
        {
          pkg: PKG.coralinaCurrent,
          file: "images/coralina-gallery-96.png",
          manifest: { semantic_role: "property_exterior" },
        },
        {
          pkg: PKG.coralinaSecond,
          file: "images/coralina-gallery-02.png",
          manifest: { semantic_role: "plan" },
        },
      ],
      expect: "plan",
    },
    {
      key: "coralinaMasterPlan",
      project: CP.coralina,
      bytes: png(108),
      rows: [["master_plan", 7]],
      copies: [
        {
          pkg: PKG.coralinaCurrent,
          file: "master-plan/coralina-master-plan-00.png",
          manifest: null,
        },
      ],
      expect: "plan",
      expectTier: "package_folder_convention",
    },
    {
      // D1: `payment_plan` is publicly linked and was outside GOVERNED_MEDIA_TYPES.
      key: "coralinaPaymentPlan",
      project: CP.coralina,
      bytes: png(109),
      rows: [["payment_plan", 8]],
      copies: [
        {
          pkg: PKG.coralinaCurrent,
          file: "payment-plan/coralina-payment-plan-00.png",
          manifest: null,
        },
      ],
      expect: "plan",
    },

    // --- sierra shape: two cover rows, a dual-typed hero, a dual-typed
    //     advertisement, lifestyle, architecture retained
    {
      key: "sierraCover",
      project: CP.sierra,
      bytes: png(111),
      // ONE URL, TWO ROWS — cover@0 and gallery@8, exactly as production holds
      // 37fa558ae05e339e3bdf1dc6.png.
      rows: [
        ["cover", 0],
        ["gallery", 8],
      ],
      isMainImage: true,
      copies: [
        {
          pkg: PKG.sierraCurrent,
          file: "images/the-title-sierra-cover.png",
          manifest: { drive_source_path: "root/11. Perspective/Exterior/Arrival Plaza.jpg" },
        },
      ],
      expect: "property_exterior",
    },
    {
      // The advertisement, also on two rows and also the second cover row.
      key: "sierraPromo",
      project: CP.sierra,
      bytes: png(112),
      rows: [
        ["cover", 0],
        ["gallery", 5],
      ],
      copies: [
        {
          pkg: PKG.sierraCurrent,
          file: "images/the-title-sierra-gallery-80.png",
          manifest: { drive_source_path: "root/14. Key Visual/HOLIDAY MOMENTS.jpg" },
        },
      ],
      expect: "text_promo",
    },
    {
      key: "sierraLifestyle",
      project: CP.sierra,
      bytes: png(113),
      rows: [["gallery", 1]],
      copies: [
        {
          pkg: PKG.sierraCurrent,
          file: "images/the-title-sierra-gallery-81.png",
          manifest: { drive_source_path: "root/13. Advertising/Songkran Campaign 01.jpg" },
        },
      ],
      expect: "lifestyle",
    },
    {
      key: "sierraRender",
      project: CP.sierra,
      bytes: png(114),
      rows: [["gallery", 2]],
      copies: [
        {
          pkg: PKG.sierraCurrent,
          file: "images/the-title-sierra-gallery-82.png",
          manifest: { drive_source_path: "root/11. Perspective/CGI/Night Render.jpg" },
        },
      ],
      expect: "architecture_render",
    },
    {
      key: "sierraPool",
      project: CP.sierra,
      bytes: png(115),
      rows: [["gallery", 3]],
      copies: [
        {
          pkg: PKG.sierraCurrent,
          file: "images/the-title-sierra-gallery-83.png",
          manifest: { drive_source_path: "root/11. Perspective/Exterior/Swimming Pool Deck.jpg" },
        },
      ],
      expect: "property_pool_exterior",
    },
    {
      // Only a superseded package describes it, and it says property_interior —
      // which would put it BACK on the page. Refused; left role-less.
      key: "sierraSupersededReveal",
      project: CP.sierra,
      bytes: png(116),
      rows: [["gallery", 4]],
      copies: [
        {
          pkg: PKG.sierraPrefix,
          file: "images/the-title-sierra-gallery-40.png",
          manifest: { semantic_role: "property_interior" },
        },
      ],
      expect: null,
    },
    {
      // The same superseded package saying "hide this" is believed — with a
      // recorded acknowledgement, per URL.
      key: "sierraSupersededHide",
      project: CP.sierra,
      bytes: png(117),
      rows: [["gallery", 7]],
      copies: [
        {
          pkg: PKG.sierraPrefix,
          file: "images/the-title-sierra-gallery-41.png",
          manifest: { semantic_role: "event" },
        },
      ],
      expect: "event",
      acknowledge: "Confirmed against the original launch-event set: people are the subject.",
    },
    {
      key: "sierraUnitPlan",
      project: CP.sierra,
      bytes: png(118),
      rows: [["unit_plan", 6]],
      copies: [
        {
          pkg: PKG.sierraCurrent,
          file: "unit-plan/the-title-sierra-unit-plan-00.png",
          manifest: null,
        },
      ],
      expect: "plan",
    },

    // --- Villa Kirara shape: no eligible exterior anywhere, plans and
    //     documents present, and a superseded package claiming otherwise
    {
      key: "kiraraEvent1",
      project: CP.kirara,
      bytes: png(121),
      rows: [["gallery", 0]],
      copies: [
        {
          pkg: PKG.kiraraCurrent,
          file: "images/the-title-villa-kirara-gallery-00.png",
          manifest: { drive_source_path: "root/12. Photo in the Event/Opening Ceremony 01.jpg" },
        },
      ],
      expect: "event",
    },
    {
      key: "kiraraEvent2",
      project: CP.kirara,
      bytes: png(122),
      rows: [["gallery", 1]],
      copies: [
        {
          pkg: PKG.kiraraCurrent,
          file: "images/the-title-villa-kirara-gallery-01.png",
          manifest: { drive_source_path: "root/12. Photo in the Event/Opening Ceremony 02.jpg" },
        },
      ],
      expect: "event",
    },
    {
      key: "kiraraGroup",
      project: CP.kirara,
      bytes: png(123),
      rows: [["gallery", 2]],
      copies: [
        {
          pkg: PKG.kiraraCurrent,
          file: "images/the-title-villa-kirara-gallery-02.png",
          manifest: { drive_source_path: "root/15. Sales Team/Group Photo 1.jpg" },
        },
      ],
      expect: "group_photo",
    },
    {
      // THE documented slug-word defect. The pre-fix run called this House Plan
      // sheet `villa_exterior` because the renamed file contains "villa".
      key: "kiraraHousePlan",
      project: CP.kirara,
      bytes: png(124),
      rows: [["unit_plan", 3]],
      copies: [
        {
          pkg: PKG.kiraraPrefix,
          file: "images/the-title-villa-kirara-gallery-03.png",
          manifest: { semantic_role: "villa_exterior" },
        },
      ],
      expect: null,
    },
    {
      key: "kiraraUnitPlan",
      project: CP.kirara,
      bytes: png(125),
      rows: [["unit_plan", 4]],
      copies: [
        {
          pkg: PKG.kiraraCurrent,
          file: "unit-plan/the-title-villa-kirara-unit-plan-00.png",
          manifest: null,
        },
      ],
      expect: "plan",
    },
    {
      key: "kiraraBrochure",
      project: CP.kirara,
      bytes: png(126),
      rows: [["brochure", 5]],
      copies: [
        {
          pkg: PKG.kiraraCurrent,
          file: "brochure/the-title-villa-kirara-brochure-00.png",
          manifest: null,
        },
      ],
      expect: "text_promo",
    },
  ];

  // Resolve every item's URL from its bytes, and write the packages.
  const packageManifests = new Map();
  const acknowledgements = [];
  for (const item of ITEMS) {
    const slug = CSLUG[item.project];
    const resolved = objectPathFor(slug, item.bytes);
    item.objectPath = resolved.objectPath;
    item.originalSha256 = resolved.originalSha256;
    item.url = `${STORAGE}${resolved.objectPath}`;
    if (item.acknowledge) {
      acknowledgements.push({
        projectSlug: slug,
        url: item.url,
        acknowledgement: item.acknowledge,
      });
    }
    for (const copy of item.copies) {
      const directory = join(packagesRoot, copy.pkg);
      const absolute = join(directory, copy.file);
      mkdirSync(join(absolute, ".."), { recursive: true });
      writeFileSync(absolute, item.bytes);
      const list = packageManifests.get(copy.pkg) ?? { slug, media: [] };
      list.slug = slug;
      if (copy.manifest) {
        list.media.push(
          copy.manifest.onlyHash
            ? { file: copy.file, sha256: item.originalSha256 }
            : { file: copy.file, sha256: item.originalSha256, ...copy.manifest },
        );
      }
      packageManifests.set(copy.pkg, list);
    }
  }
  for (const [ref, content] of packageManifests) {
    writeFileSync(
      join(packagesRoot, ref, "source-manifest.json"),
      JSON.stringify(
        {
          schema_version: "forever-package-factory.v1",
          slug: content.slug,
          task: SUPERSEDED_PACKAGES.includes(ref)
            ? "FOREVER-HERO-SELECTION-AND-CORRECTION-001 (pre-fix run 1)"
            : "FOREVER-HERO-SELECTION-AND-CORRECTION-001",
          batch_fingerprint: createHash("sha256").update(ref).digest("hex"),
          media: content.media,
        },
        null,
        2,
      ),
      "utf8",
    );
  }
  const acknowledgePath = join(artifacts, "acknowledgements.json");
  writeFileSync(acknowledgePath, JSON.stringify(acknowledgements, null, 2), "utf8");

  const byKey = new Map(ITEMS.map((item) => [item.key, item]));
  const itemsOf = (projectId) => ITEMS.filter((item) => item.project === projectId);

  // -- seed the cluster -----------------------------------------------------
  const ASSET_KEY_URL = "villaSeeded";
  const QUIET_COVER = `${STORAGE}direct/quiet-arbor/${"a1".repeat(12)}.jpg`;
  const QUIET_GALLERY = `${STORAGE}direct/quiet-arbor/${"b2".repeat(12)}.jpg`;
  const DRAFT_PAYMENT = `${STORAGE}direct/draft-preview/${"c3".repeat(12)}.jpg`;
  const DRAFT_RETIRED = `${STORAGE}direct/draft-preview/${"d4".repeat(12)}.jpg`;

  function seedBackfillFixtures(cluster) {
    const rows = [];
    const project = (id, slug, name, cover, status) =>
      `INSERT INTO public.projects (id, name, slug, is_active, public_status, main_image_url)
         VALUES ('${id}', '${name}', '${slug}', true, '${status}',
                 ${cover ? `'${cover}'` : "NULL"});`;
    const media = (projectId, type, url, sort) =>
      `INSERT INTO public.project_media (project_id, media_type, url, sort_order)
         VALUES ('${projectId}', '${type}', '${url}', ${sort});`;

    const mainImage = (projectId) =>
      itemsOf(projectId).find((item) => item.isMainImage)?.url ?? null;

    rows.push(
      project(
        CP.coralina,
        "coralina",
        "The Title Coralina Kamala",
        mainImage(CP.coralina),
        "published",
      ),
    );
    rows.push(
      project(CP.sierra, "the-title-sierra", "The Title Sierra", mainImage(CP.sierra), "published"),
    );
    // No cover row and no main image: the honest empty state.
    rows.push(
      project(CP.kirara, "the-title-villa-kirara", "The Title Villa Kirara", null, "published"),
    );
    rows.push(project(CP.quiet, "quiet-arbor", "Quiet Arbor", QUIET_COVER, "published"));
    rows.push(
      project(
        CP.seeded,
        "seeded-placeholder-villas",
        "Seeded Placeholder Villas",
        null,
        "published",
      ),
    );
    // Draft: never public, so the census must count it as excluded and never as
    // governed. It holds exactly the two media types the excluded-count and
    // retired-count checks used to get wrong.
    rows.push(project(CP.draft, "draft-preview", "Draft Preview", null, "draft"));

    for (const item of ITEMS) {
      for (const [type, sort] of item.rows) rows.push(media(item.project, type, item.url, sort));
    }
    rows.push(media(CP.quiet, "cover", QUIET_COVER, 0));
    rows.push(media(CP.quiet, "gallery", QUIET_GALLERY, 1));
    // The seeded villa row: its url is a bundled-asset key, not a URL.
    rows.push(media(CP.seeded, "gallery", ASSET_KEY_URL, 0));
    rows.push(media(CP.draft, "payment_plan", DRAFT_PAYMENT, 0));
    rows.push(media(CP.draft, "superseded_cover", DRAFT_RETIRED, 1));

    // Business data, so "unchanged" is a real assertion. The SOLD unit and the
    // price history both sit on a project the run WRITES to — an invariant
    // proven only on projects nothing touched proves nothing.
    for (const [id, projectId, name, code] of [
      [CB.coralina, CP.coralina, "Building A", "A"],
      [CB.sierra, CP.sierra, "Tower One", "T1"],
      [CB.quiet, CP.quiet, "Arbor House", "AH"],
    ]) {
      rows.push(
        `INSERT INTO public.buildings (id, project_id, name, building_code)
           VALUES ('${id}', '${projectId}', '${name}', '${code}');`,
      );
    }
    for (const [id, projectId, buildingId, code, type, status, price] of [
      [CU.coralinaAvailable, CP.coralina, CB.coralina, "A101", "One Bedroom", "available", 9250000],
      [CU.coralinaSold, CP.coralina, CB.coralina, "A102", "Two Bedroom", "sold", 14750000],
      [CU.sierraAvailable, CP.sierra, CB.sierra, "T1-05", "Studio", "available", 6100000],
      [CU.quietAvailable, CP.quiet, CB.quiet, "Q1", "Villa", "available", 21000000],
      [CU.quietSold, CP.quiet, CB.quiet, "Q2", "Villa", "sold", 23500000],
    ]) {
      rows.push(
        `INSERT INTO public.units (id, project_id, building_id, unit_code, unit_type,
                                   availability_status, base_price_thb)
           VALUES ('${id}', '${projectId}', '${buildingId}', '${code}', '${type}',
                   '${status}', ${price});`,
      );
    }
    // `price` and `currency`, which is what the table actually has.
    for (const [id, unitId, price, currency] of [
      [CH.coralina1, CU.coralinaAvailable, 9250000, "THB"],
      [CH.coralina2, CU.coralinaSold, 14750000, "THB"],
      [CH.quiet1, CU.quietAvailable, 21000000, "THB"],
    ]) {
      rows.push(
        `INSERT INTO public.unit_price_history (id, unit_id, price, currency, recorded_at)
           VALUES ('${id}', '${unitId}', ${price}, '${currency}', '2026-07-01T00:00:00Z');`,
      );
    }
    cluster.sql(rows.join("\n"));
  }

  // The committed chain seeds real projects of its own — including the six
  // fictitious villa projects whose `url` is a bundled-asset key, which is
  // exactly the production shape this backfill has to excuse. They are counted
  // as a baseline rather than deleted: a proof that removed the awkward rows the
  // real database contains would be proving something else.
  const chainSeeded = {
    projects: Number(Cc.scalar("SELECT count(*) FROM public.projects")),
    media: Number(Cc.scalar("SELECT count(*) FROM public.project_media")),
    units: Number(Cc.scalar("SELECT count(*) FROM public.units")),
    prices: Number(Cc.scalar("SELECT count(*) FROM public.unit_price_history")),
    buildings: Number(Cc.scalar("SELECT count(*) FROM public.buildings")),
  };
  seedBackfillFixtures(Cc);
  const seededC = {
    projects: Number(Cc.scalar("SELECT count(*) FROM public.projects")) - chainSeeded.projects,
    media: Number(Cc.scalar("SELECT count(*) FROM public.project_media")) - chainSeeded.media,
    units: Number(Cc.scalar("SELECT count(*) FROM public.units")) - chainSeeded.units,
    prices:
      Number(Cc.scalar("SELECT count(*) FROM public.unit_price_history")) - chainSeeded.prices,
    buildings: Number(Cc.scalar("SELECT count(*) FROM public.buildings")) - chainSeeded.buildings,
  };
  const expectedMedia = ITEMS.reduce((n, i) => n + i.rows.length, 0) + 5;
  seededC.media === expectedMedia && seededC.projects === 6 && seededC.units === 5
    ? ok(
        `path C fixtures seeded: +${seededC.projects} projects, +${seededC.media} media rows, ` +
          `+${seededC.units} units, +${seededC.prices} prices, +${seededC.buildings} buildings ` +
          `on top of the chain's own ${chainSeeded.projects} projects / ${chainSeeded.media} media rows`,
      )
    : bad(
        "path C fixtures seeded",
        `delta ${JSON.stringify(seededC)} expectedMedia=${expectedMedia}`,
      );

  // Every seeded URL must be the object path the publish lane would produce, or
  // the join under test is not the join being exercised.
  const dualTyped = ITEMS.filter((item) => item.rows.length > 1);
  dualTyped.length === 2 &&
  dualTyped.every((item) => new Set(item.rows.map((r) => r[0])).size === item.rows.length)
    ? ok("path C holds two dual-typed URLs (one hero, one advertisement) as production does")
    : bad("dual-typed URL fixtures present", JSON.stringify(dualTyped.map((i) => i.key)));

  // -- whole-database baselines, before the controller runs anything --------
  const WHOLE = {
    units: `SELECT coalesce(md5(string_agg(t, chr(10) ORDER BY t COLLATE "C")), 'empty')
              FROM (SELECT id::text||'|'||project_id::text||'|'||coalesce(unit_code,'')||'|'||
                           coalesce(unit_type,'')||'|'||coalesce(availability_status,'')||'|'||
                           coalesce(base_price_thb::text,'')||'|'||coalesce(updated_at::text,'') AS t
                      FROM public.units) s`,
    prices: `SELECT coalesce(md5(string_agg(t, chr(10) ORDER BY t COLLATE "C")), 'empty')
               FROM (SELECT id::text||'|'||unit_id::text||'|'||coalesce(price::text,'')||'|'||
                            coalesce(currency,'')||'|'||coalesce(recorded_at::text,'') AS t
                       FROM public.unit_price_history) s`,
    buildings: `SELECT coalesce(md5(string_agg(t, chr(10) ORDER BY t COLLATE "C")), 'empty')
                  FROM (SELECT id::text||'|'||project_id::text||'|'||coalesce(name,'')||'|'||
                               coalesce(building_code,'') AS t FROM public.buildings) s`,
    projects: `SELECT coalesce(md5(string_agg(t, chr(10) ORDER BY t COLLATE "C")), 'empty')
                 FROM (SELECT id::text||'|'||coalesce(slug,'')||'|'||coalesce(name,'')||'|'||
                              is_active::text||'|'||coalesce(public_status,'')||'|'||
                              coalesce(main_image_url,'')||'|'||coalesce(updated_at::text,'') AS t
                         FROM public.projects) s`,
    mediaNonRole: `SELECT coalesce(md5(string_agg(t, chr(10) ORDER BY t COLLATE "C")), 'empty')
                     FROM (SELECT id::text||'|'||project_id::text||'|'||media_type||'|'||url||'|'||
                                  sort_order::text||'|'||coalesce(title,'')||'|'||
                                  coalesce(metadata::text,'') AS t FROM public.project_media) s`,
    roles: `SELECT coalesce(md5(string_agg(t, chr(10) ORDER BY t COLLATE "C")), 'empty')
              FROM (SELECT project_id::text||'|'||media_type||'|'||url||'|'||
                           coalesce(semantic_role,'') AS t FROM public.project_media) s`,
  };
  const wholeDb = () =>
    Object.fromEntries(Object.entries(WHOLE).map(([k, q]) => [k, Cc.scalar(q)]));
  const roleDigestOf = (projectId) =>
    Cc.scalar(backfillApply.PROJECT_ROLE_DIGEST_SQL.replace(/\$1::uuid/g, `'${projectId}'::uuid`));
  const baseline = wholeDb();
  const baselineRoleDigest = Object.fromEntries(
    Object.keys(CSLUG).map((id) => [id, roleDigestOf(id)]),
  );

  // -- the controller, run as its own process ------------------------------
  const CONTROLLER = join(REPO, "scripts", "media", "semantic-backfill.mjs");
  // A password the cluster does not need (trust auth on loopback) and will
  // therefore never validate. It is here so "no credential in the output" is a
  // check that can fail: with no password in the URL, every scan passes
  // vacuously.
  const CC_PASSWORD = "pathCsecret9174";
  const CC_URL = `postgres://postgres:${CC_PASSWORD}@127.0.0.1:${Cc.port}/postgres`;
  const CC_URL_NO_PASSWORD = `postgres://postgres@127.0.0.1:${Cc.port}/postgres`;

  // Connection strings that CARRY a real project ref.
  //
  // Two shapes, and the difference is deliberate.
  //
  // The `*_SPOOF` pair is loopback with the ref hidden in `application_name`.
  // The ref guard reads it, but every byte still goes to 127.0.0.1 — so if a
  // guard ever stopped firing, the regression writes to the throwaway cluster
  // and this harness fails loudly rather than touching anything real.
  //
  // The `*_SHAPED` pair spells the real Supabase host out. They exist for one
  // assertion the spoof cannot make: that NO CONNECTION IS OPENED. With the
  // spoof, a guard regression connects successfully to loopback and leaves no
  // error to look for; with a real hostname a regression would leave a DNS or
  // connect failure in the output, which `noConnectionAttempted` asserts is
  // absent. They are only ever used in refusal controls, where the target guard
  // (guards.assertTargetPermitted, GUARD 8/9/10) runs before GUARD 14 opens the
  // socket — and they carry no password, so an unauthorised regression could
  // still not authenticate.
  const STAGING_SPOOF = `${CC_URL_NO_PASSWORD}?application_name=garjibjhlzeljsnpzisu.supabase.co`;
  const PRODUCTION_SPOOF = `${CC_URL_NO_PASSWORD}?application_name=abtvsrcnfwlbawvrjeed.supabase.co`;
  const PRODUCTION_SHAPED_URL =
    "postgres://postgres@db.abtvsrcnfwlbawvrjeed.supabase.co:5432/postgres";
  const STAGING_SHAPED_URL =
    "postgres://postgres@db.garjibjhlzeljsnpzisu.supabase.co:5432/postgres";
  /** Anything psql says when it tried to reach a server and could not. */
  const CONNECTION_ERROR_MARKERS = [
    "could not translate host name",
    "could not connect",
    "connection to server",
    "Connection refused",
    "Name or service not known",
    "server closed the connection",
    "no pg_hba.conf entry",
    "password authentication failed",
    "timeout expired",
    "Temporary failure in name resolution",
  ];
  const connectionErrorIn = (out) =>
    CONNECTION_ERROR_MARKERS.filter((marker) => String(out).includes(marker));

  // HOW THIS RUN AUTHORISES ITSELF AGAINST A THROWAWAY CLUSTER.
  //
  // An earlier version of this path could not run the controller honestly. The
  // permission guard demanded a PRODUCTION ref for every write, so a loopback
  // target was unwritable — and the workaround was to export
  // `SUPABASE_URL=https://abtvsrcnfwlbawvrjeed.supabase.co`, because
  // `refFromTarget` preferred that variable over the connection string. The
  // proof therefore depended on the very defect it had discovered: the guard,
  // the manifest's `target.project_ref` and the `--confirm-project-ref`
  // handshake all said "production" while every byte went to 127.0.0.1.
  //
  // Both halves are now fixed. The ref is read out of the connection string
  // alone, so a loopback target has NO ref; and a write to a ref-less target is
  // authorised by `--disposable-target`, which cannot be confused with the
  // production markers because passing both is itself refused. The environment
  // below is scrubbed rather than seeded — including SUPABASE_URL, so a stale
  // export in the operator's shell cannot influence a single check here.
  const AMBIENT = [
    "SUPABASE_URL",
    "DATABASE_URL",
    "SUPABASE_DB_URL",
    "POSTGRES_URL",
    "PGDATABASE",
    "PGHOST",
    "PGUSER",
    "PGPASSWORD",
    "FOREVER_SEMANTIC_BACKFILL_DATABASE_URL",
    "FOREVER_ROLE_CENSUS_DATABASE_URL",
  ];
  const controllerLog = [];
  function runController(argv, extra = {}) {
    const env = { ...process.env, ...extra };
    for (const name of AMBIENT) if (!(name in extra)) delete env[name];
    let result;
    try {
      result = {
        code: 0,
        out: execFileSync(process.execPath, [CONTROLLER, ...argv], {
          cwd: REPO,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          env,
        }),
      };
    } catch (error) {
      result = {
        code: error?.status ?? 1,
        out: String(error?.stdout ?? "") + String(error?.stderr ?? ""),
      };
    }
    controllerLog.push(result.out);
    return result;
  }

  /**
   * Controller output trimmed to the part that says what happened.
   *
   * The per-project verdicts are printed BEFORE the acceptance lines and the
   * census report, so a plain tail slice shows thirty lines of gate output and
   * nothing about which project failed. That cost a debugging cycle.
   */
  const controllerDetail = (out) => {
    const lines = String(out).split("\n");
    const verdicts = lines.filter(
      (line) => line.startsWith("[semantic-backfill]") && !line.includes("re-evaluate when"),
    );
    return [...verdicts, "--- tail ---", ...lines.slice(-12)].join("\n");
  };

  const censusC = (stage, exceptionsPath) => {
    try {
      return {
        code: 0,
        out: execFileSync(
          process.execPath,
          [
            join(REPO, "scripts", "media", "role-completeness-report.mjs"),
            "--database-url",
            CC_URL_NO_PASSWORD,
            "--stage",
            stage,
            ...(exceptionsPath ? ["--exceptions", exceptionsPath] : []),
          ],
          { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        ),
      };
    } catch (error) {
      return {
        code: error?.status ?? 1,
        out: String(error?.stdout ?? "") + String(error?.stderr ?? ""),
      };
    }
  };

  const manifestPath = join(artifacts, "manifest.json");
  const manifestPath2 = join(artifacts, "manifest-second-run.json");
  const exceptionsPath = join(artifacts, "exceptions.json");
  const exceptionsPath2 = join(artifacts, "exceptions-second-run.json");
  const reportPath = join(artifacts, "report.txt");
  const planArgs = (mPath, ePath) => [
    "plan",
    "--database-url",
    CC_URL,
    "--packages",
    packagesRoot,
    ...SUPERSEDED_PACKAGES.flatMap((ref) => ["--superseded", ref]),
    "--acknowledge",
    acknowledgePath,
    "--manifest",
    mPath,
    "--exceptions-out",
    ePath,
    "--report",
    reportPath,
  ];

  // ---- plan, twice --------------------------------------------------------
  const plan1 = runController(planArgs(manifestPath, exceptionsPath));
  plan1.code === 0 && plan1.out.includes("MANIFEST VALID")
    ? ok("plan produced a valid manifest against the live cluster")
    : bad("plan succeeds", `exit ${plan1.code}\n${controllerDetail(plan1.out)}`);

  const afterPlan = wholeDb();
  JSON.stringify(afterPlan) === JSON.stringify(baseline)
    ? ok("plan mode wrote nothing — all six whole-table digests unchanged")
    : bad(
        "plan makes no writes",
        `baseline ${JSON.stringify(baseline)}\nafter ${JSON.stringify(afterPlan)}`,
      );

  const plan2 = runController(planArgs(manifestPath2, exceptionsPath2));
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const manifest2 = plan2.code === 0 ? JSON.parse(readFileSync(manifestPath2, "utf8")) : null;
  const stripProvenance = (m) => {
    const { generated_at: _a, generator_commit: _b, ...rest } = m;
    void _a;
    void _b;
    return JSON.stringify(rest);
  };
  manifest2 &&
  stripProvenance(manifest) === stripProvenance(manifest2) &&
  readFileSync(exceptionsPath, "utf8") === readFileSync(exceptionsPath2, "utf8")
    ? ok(
        "plan is deterministic: identical manifest body (and identical digests) and a " +
          "byte-identical exceptions file on a second run",
      )
    : bad(
        "plan is deterministic",
        manifest2
          ? `idempotency ${manifest.digests.idempotency_key} vs ${manifest2.digests.idempotency_key}`
          : `second plan exited ${plan2.code}`,
      );
  manifest.generated_at !== (manifest2?.generated_at ?? manifest.generated_at)
    ? ok("only generated_at differs between runs, and it is excluded from every digest")
    : ok("generated_at happened to match; the digests are what the guards compare");

  // ---- what the plan says ------------------------------------------------
  const projectBySlug = new Map(manifest.projects.map((p) => [p.slug, p]));
  const urlEntry = (slug, url) => projectBySlug.get(slug)?.urls.find((u) => u.url === url) ?? null;

  let roleMismatches = [];
  for (const item of ITEMS) {
    const slug = CSLUG[item.project];
    const entry = urlEntry(slug, item.url);
    const got = entry ? entry.proposed_semantic_role : "(url absent from plan)";
    if (got !== item.expect) roleMismatches.push(`${item.key}: expected ${item.expect} got ${got}`);
    if (item.expectTier && entry && entry.evidence_tier !== item.expectTier) {
      roleMismatches.push(
        `${item.key}: expected tier ${item.expectTier} got ${entry.evidence_tier}`,
      );
    }
  }
  roleMismatches.length === 0
    ? ok(`the plan proposes the expected role for all ${ITEMS.length} content-addressed objects`)
    : bad("planned roles match the fixtures", roleMismatches.join("\n"));

  // Never "unknown", whatever the evidence looked like.
  const unknownWritten = manifest.projects.flatMap((p) =>
    p.urls.filter((u) => u.proposed_semantic_role === "unknown").map((u) => `${p.slug} ${u.url}`),
  );
  unknownWritten.length === 0
    ? ok('no URL is planned as "unknown" — the gate cannot be satisfied by asserting nothing')
    : bad("unknown is never written", unknownWritten.join("\n"));

  // The dual-typed URLs: one role, fanned out to every row.
  const dualOk = dualTyped.every((item) => {
    const entry = urlEntry(CSLUG[item.project], item.url);
    return entry && entry.rows.length === item.rows.length;
  });
  dualOk
    ? ok("each dual-typed URL is ONE plan entry carrying both of its rows")
    : bad("dual-typed URLs plan once and emit twice", JSON.stringify(dualTyped.map((i) => i.key)));

  const sierraPayload = backfillApply.rpcPayloadForProject(projectBySlug.get("the-title-sierra"));
  const heroRows = sierraPayload.filter((r) => r.url === byKey.get("sierraCover").url);
  heroRows.length === 2 && new Set(heroRows.map((r) => r.semantic_role)).size === 1
    ? ok("the RPC payload names both hero rows with the SAME role, so the URL stays presentable")
    : bad("hero fan-out is consistent", JSON.stringify(heroRows));

  // The Villa Kirara slug-word defect, refused rather than repeated.
  const housePlan = urlEntry("the-title-villa-kirara", byKey.get("kiraraHousePlan").url);
  housePlan &&
  housePlan.proposed_semantic_role === null &&
  housePlan.refused_evidence.some(
    (e) => e.role === "villa_exterior" && e.why === "superseded_manifest_may_only_hide",
  )
    ? ok("a superseded package's villa_exterior is REFUSED and recorded, never applied")
    : bad("superseded evidence may only hide", JSON.stringify(housePlan?.refused_evidence));

  const hideOnly = urlEntry("the-title-sierra", byKey.get("sierraSupersededHide").url);
  hideOnly &&
  hideOnly.proposed_semantic_role === "event" &&
  hideOnly.restrictive_override === true &&
  typeof hideOnly.acknowledgement === "string" &&
  hideOnly.acknowledgement.length > 0
    ? ok("the same superseded package IS believed when it hides, with a recorded acknowledgement")
    : bad("superseded evidence is believed when it hides", JSON.stringify(hideOnly));

  // Same authority, disagreeing: the role that shows less wins, and it is
  // surfaced as a content deletion rather than buried in a table.
  const conflict = urlEntry("coralina", byKey.get("coralinaConflict").url);
  conflict &&
  conflict.proposed_semantic_role === "plan" &&
  conflict.conflict &&
  conflict.conflict.losing.some((l) => l.role === "property_exterior") &&
  manifest.review_required.some((r) => r.url === conflict.url)
    ? ok("two same-tier candidates: band 1 beat band 5, the loser is recorded, review required")
    : bad("same-tier conflict resolves to the stricter role", JSON.stringify(conflict?.conflict));

  // Retirement: recorded, never performed.
  const retirementOk = manifest.projects.every((p) => p.expected_retired_covers.length === 0);
  const coralinaProject = projectBySlug.get("coralina");
  const sierraProject = projectBySlug.get("the-title-sierra");
  retirementOk &&
  coralinaProject.retirement_candidates.length === 1 &&
  coralinaProject.retirement_candidates[0].url === byKey.get("coralinaEventCover").url &&
  sierraProject.retirement_candidates.length === 1 &&
  sierraProject.retirement_candidates[0].url === byKey.get("sierraPromo").url
    ? ok(
        "cover reconciliation matches the manifest: 0 retirements planned, both second cover rows " +
          "recorded as candidates and handled by their role",
      )
    : bad(
        "cover reconciliation matches the manifest",
        JSON.stringify({
          retirementOk,
          coralina: coralinaProject.retirement_candidates,
          sierra: sierraProject.retirement_candidates,
        }),
      );

  // Exceptions: exactly the URLs the manifest proposes no role for, and no
  // others. Derived from the manifest rather than listed, because the chain's own
  // six villa projects are legitimately in there too.
  const writtenExceptions = JSON.parse(readFileSync(exceptionsPath, "utf8"));
  const expectedExceptionUrls = manifest.projects
    .flatMap((p) => p.urls.filter((u) => u.proposed_semantic_role === null).map((u) => u.url))
    .sort();
  const actualExceptionUrls = writtenExceptions.map((e) => e.url).sort();
  const mineExpected = [
    ...ITEMS.filter((item) => item.expect === null).map((item) => item.url),
    QUIET_COVER,
    QUIET_GALLERY,
    ASSET_KEY_URL,
  ];
  const excusedSet = new Set(actualExceptionUrls);
  JSON.stringify(expectedExceptionUrls) === JSON.stringify(actualExceptionUrls) &&
  mineExpected.every((url) => excusedSet.has(url)) &&
  ITEMS.filter((item) => item.expect !== null).every((item) => !excusedSet.has(item.url))
    ? ok(
        `role-less exceptions match the manifest exactly (${writtenExceptions.length} entries): every ` +
          `unclassifiable URL is excused and no classified URL is`,
      )
    : bad(
        "role-less exceptions match the manifest",
        `manifest role-less ${JSON.stringify(expectedExceptionUrls)}\n` +
          `exceptions file ${JSON.stringify(actualExceptionUrls)}\n` +
          `mine missing ${JSON.stringify(mineExpected.filter((u) => !excusedSet.has(u)))}`,
      );
  // The chain's six seeded villa rows are the production shape of F9, and they
  // must be excused by the bundled-asset-key reason rather than any other.
  {
    const bundled = writtenExceptions.filter(
      (e) => e.reasonCode === "not_a_public_url_bundled_asset_key",
    );
    bundled.length >= 7 && bundled.every((e) => !e.url.includes("://"))
      ? ok(
          `${bundled.length} bundled-asset-key rows (the chain's six seeded villa projects plus the ` +
            "fixture's) are excused as unclassifiable, not as anything else",
        )
      : bad(
          "bundled-asset-key rows are excused for the right reason",
          JSON.stringify(bundled.map((e) => [e.projectSlug, e.url, e.reasonCode])),
        );
  }
  const assetKeyException = writtenExceptions.find((e) => e.url === ASSET_KEY_URL);
  assetKeyException?.reasonCode === "not_a_public_url_bundled_asset_key" &&
  writtenExceptions.find((e) => e.url === byKey.get("kiraraHousePlan").url)?.reasonCode ===
    "superseded_evidence_refused_may_only_hide" &&
  writtenExceptions.every((e) => typeof e.reason === "string" && e.reason.trim().length > 0)
    ? ok("every exception carries a non-blank reason and the reason CODE the evidence warrants")
    : bad(
        "exception reason codes",
        JSON.stringify(writtenExceptions.map((e) => [e.url, e.reasonCode])),
      );
  Array.isArray(writtenExceptions)
    ? ok("the exceptions file is a bare JSON array, which is the only shape the gate accepts")
    : bad("exceptions file shape", "not an array");

  // The plan's own acceptance criteria, evaluated against the plan.
  const planAcceptance = plan1.out;
  void planAcceptance;

  // ---- the SUPABASE_URL precedence defect, proven FIXED --------------------
  //
  // This used to be a FINDING. `guards.refFromTarget()` consulted
  // `process.env.SUPABASE_URL` before `--database-url`, so in the Owner's normal
  // shell — where the credentials file exports the production origin — the ref
  // was decided by the environment. A connection string naming staging passed
  // the staging refusal, and `--production --confirm-project-ref <production>`
  // authorised a write to whatever the string really pointed at. The finding is
  // replaced by assertions, each of which fails if the fix is reverted.
  //
  // `negative()` is defined here rather than with the rest of the controls
  // because the first two of these ARE refusal controls: they must also prove
  // that nothing was written.
  const negatives = [];
  const negative = (label, expectedCode, argv, extraEnv, expectText) => {
    const before = wholeDb();
    const result = runController(argv, extraEnv);
    const after = wholeDb();
    const unchanged = JSON.stringify(before) === JSON.stringify(after);
    const codeOk = result.code === expectedCode;
    const textOk = !expectText || result.out.includes(expectText);
    negatives.push({ label, code: result.code, expectedCode, unchanged });
    codeOk && textOk && unchanged
      ? ok(`negative control: ${label} -> exit ${expectedCode}, nothing written`)
      : bad(
          `negative control: ${label}`,
          `exit ${result.code} (expected ${expectedCode}) unchanged=${unchanged}\n${controllerDetail(result.out)}`,
        );
    return result;
  };

  // F1 — the ref recorded in the manifest is the one derived from the
  // connection string. A loopback target names no Supabase project, so it is
  // empty; it is NOT the production ref that used to arrive from the
  // environment. This is the plainest statement of the fix: the manifest can no
  // longer claim production while every byte went to 127.0.0.1.
  manifest.target.project_ref === ""
    ? ok(
        "the manifest records the ref derived from --database-url alone: a loopback target names " +
          "no Supabase project, so target.project_ref is empty rather than the production ref " +
          "SUPABASE_URL used to supply",
      )
    : bad(
        "the manifest ref comes from the connection string",
        `target.project_ref = ${JSON.stringify(manifest.target.project_ref)}; expected "" for a ` +
          `loopback target`,
      );

  // F2 — a --database-url naming STAGING is still refused when SUPABASE_URL is
  // exported as the PRODUCTION origin. This is the exact environment the defect
  // needed: under the old precedence the ref would read as production, the
  // staging refusal would not fire, and this run would exit 5
  // (production_marker_missing) instead of 4. The connection string is the
  // loopback spoof, so a total guard failure could still only reach the
  // throwaway cluster. No connection is opened either way: the target guard
  // precedes GUARD 14.
  {
    const result = negative(
      "a staging --database-url is refused even with SUPABASE_URL=<production origin>",
      4,
      [
        "execute",
        "--execute",
        "--dry-run",
        "--disposable-target",
        "--database-url",
        STAGING_SPOOF,
        "--manifest",
        manifestPath,
        "--journal",
        join(artifacts, "never-supabase-url.jsonl"),
        "--all",
      ],
      { SUPABASE_URL: "https://abtvsrcnfwlbawvrjeed.supabase.co" },
      "target_is_staging",
    );
    !result.out.includes("production_marker_missing") &&
    !existsSync(join(artifacts, "never-supabase-url.jsonl"))
      ? ok(
          "...and the refusal is the STAGING one, not the production-marker one an environment-" +
            "derived ref would have produced, and no journal was opened",
        )
      : bad(
          "the staging refusal is decided by the connection string",
          controllerDetail(result.out),
        );
  }

  // F3 — the production markers no longer authorise a write to a target that
  // is not production. This is the other half of the same defect: the flag used
  // to agree with the environment rather than with the target, so this exact
  // argument list is what wrote to 127.0.0.1 while calling itself production.
  negative(
    "--production --confirm-project-ref <production> against a loopback target",
    4,
    [
      "execute",
      "--execute",
      "--production",
      "--confirm-project-ref",
      "abtvsrcnfwlbawvrjeed",
      "--database-url",
      CC_URL,
      "--manifest",
      manifestPath,
      "--journal",
      join(artifacts, "never-flag-vs-target.jsonl"),
      "--all",
    ],
    { SUPABASE_URL: "https://abtvsrcnfwlbawvrjeed.supabase.co" },
    "target_not_production",
  );

  // F4 — assertTargetRefsAgree, and what this harness can and cannot say about
  // it. NOT_IMPLEMENTED as a CLI assertion, stated rather than faked.
  {
    const both = runController([
      "plan",
      "--snapshot",
      join(artifacts, "no-such-snapshot.json"),
      "--database-url",
      CC_URL,
      "--manifest",
      join(artifacts, "never-refs-agree.json"),
      "--exceptions-out",
      join(artifacts, "never-refs-agree-exc.json"),
    ]);
    both.code === 2 &&
    both.out.includes("--snapshot and --database-url are mutually exclusive") &&
    !existsSync(join(artifacts, "never-refs-agree.json"))
      ? note(
          "guards.assertTargetRefsAgree is unreachable from the CLI, so it is NOT proven here",
          `The controller calls it (GUARD 8), but GUARD 5 refuses --snapshot together with ` +
            `--database-url first, at exit 2 — so by the time assertTargetRefsAgree runs, one of ` +
            `its two arguments is always absent and it returns without comparing anything. ` +
            `snapshot_target_mismatch therefore cannot be produced through this executable, and ` +
            `this harness does not claim it: the guard's behaviour is covered by the unit tests ` +
            `in src/features/forever-semantic-backfill/tests/guards.test.ts. What IS asserted ` +
            `here is the refusal that pre-empts it, observed at exit ${both.code}.`,
        )
      : bad(
          "the snapshot/database-url combination is refused before assertTargetRefsAgree",
          `exit ${both.code}\n${controllerDetail(both.out)}`,
        );
  }

  // ---- dry run ------------------------------------------------------------
  const dryJournal = join(artifacts, "journal-dry-run.jsonl");
  const dry = runController([
    "execute",
    "--execute",
    "--dry-run",
    // A dry run opens the real transaction, so it now needs the same target
    // marker a real write does. Before the fix `--dry-run` was exempt.
    "--disposable-target",
    "--database-url",
    CC_URL,
    "--manifest",
    manifestPath,
    "--exceptions",
    exceptionsPath,
    "--journal",
    dryJournal,
    "--all",
    "--packages",
    packagesRoot,
    ...SUPERSEDED_PACKAGES.flatMap((ref) => ["--superseded", ref]),
    "--stage",
    "before_backfill",
  ]);
  const afterDry = wholeDb();
  dry.code === 0 && JSON.stringify(afterDry) === JSON.stringify(baseline)
    ? ok("--dry-run ran every check inside a real transaction and wrote nothing")
    : bad(
        "dry run makes no writes",
        `exit ${dry.code}\nbaseline ${baseline.roles}\nafter ${afterDry.roles}\n${controllerDetail(dry.out)}`,
      );
  dry.out.includes("dry run — rolled back")
    ? ok("--dry-run says out loud that it rolled back")
    : bad("dry run reports itself", dry.out.slice(-600));

  // ---- negative controls, none of which may write -------------------------
  //
  // The manifest is a PARAMETER rather than something a caller appends. It has to
  // be: `arg()` in both this controller and the census gate is a bare
  // `argv.indexOf("--name") + 1`, so it returns the FIRST occurrence of a flag
  // and a later one is silently ignored. Appending `--manifest tampered.json` to
  // an argument list that already carried `--manifest good.json` therefore ran
  // the GOOD manifest — and this proof reported the tamper as accepted until the
  // argument list stopped being built that way.
  const executeArgs = (extra, manifestOverride) => [
    "execute",
    "--execute",
    // The loopback cluster names no Supabase project, so its write marker is
    // `--disposable-target`. It is NOT `--production --confirm-project-ref`:
    // those now refuse this target outright (`target_not_production`), which is
    // asserted a few lines above.
    "--disposable-target",
    "--database-url",
    CC_URL,
    "--manifest",
    manifestOverride ?? manifestPath,
    "--exceptions",
    exceptionsPath,
    "--packages",
    packagesRoot,
    ...SUPERSEDED_PACKAGES.flatMap((ref) => ["--superseded", ref]),
    "--stage",
    "before_backfill",
    ...extra,
  ];
  note(
    "a repeated CLI flag silently uses the FIRST occurrence, not the last",
    "`arg(name)` is `process.argv.indexOf('--' + name) + 1` in both " +
      "scripts/media/semantic-backfill.mjs and scripts/media/role-completeness-report.mjs. An " +
      "operator who appends `--manifest today.json` to a saved command line that already carries " +
      "`--manifest last-week.json` runs last week's plan with no warning. It cost this proof a " +
      "false PASS on the manifest-tamper control before it was spotted. A duplicate-flag refusal " +
      "would be a few lines and would fail closed.",
  );

  // Staging, in every mode. The ref is spoofed onto a LOOPBACK connection
  // string on purpose: the guard reads the ref, so this exercises the refusal
  // without the possibility of contacting the real staging database even if the
  // guard failed to fire.
  for (const [mode, argv] of [
    [
      "plan",
      [
        "plan",
        "--database-url",
        STAGING_SPOOF,
        "--manifest",
        join(artifacts, "never.json"),
        "--exceptions-out",
        join(artifacts, "never-exc.json"),
      ],
    ],
    ["verify", ["verify", "--database-url", STAGING_SPOOF, "--manifest", manifestPath]],
    [
      "execute --dry-run",
      [
        "execute",
        "--execute",
        "--dry-run",
        "--database-url",
        STAGING_SPOOF,
        "--manifest",
        manifestPath,
        "--journal",
        join(artifacts, "never.jsonl"),
        "--all",
      ],
    ],
  ]) {
    negative(
      `staging ref refused in ${mode} mode`,
      4,
      argv,
      { SUPABASE_URL: "" },
      "target_is_staging",
    );
  }
  existsSync(join(artifacts, "never.json")) === false
    ? ok("a refused staging run produced no artifact at all")
    : bad("staging refusal writes nothing", "a manifest was written for a staging target");

  // A production-shaped target without the markers. Loopback again, so a guard
  // regression writes to the throwaway cluster rather than to production.
  negative(
    "--execute without --production",
    5,
    [
      "execute",
      "--execute",
      "--database-url",
      PRODUCTION_SPOOF,
      "--manifest",
      manifestPath,
      "--journal",
      join(artifacts, "never2.jsonl"),
      "--all",
    ],
    { SUPABASE_URL: "" },
    "production_marker_missing",
  );
  negative(
    "--execute --production with no --confirm-project-ref",
    5,
    [
      "execute",
      "--execute",
      "--production",
      "--database-url",
      PRODUCTION_SPOOF,
      "--manifest",
      manifestPath,
      "--journal",
      join(artifacts, "never3.jsonl"),
      "--all",
    ],
    { SUPABASE_URL: "" },
    "ref_confirmation_missing",
  );
  negative(
    "--confirm-project-ref with a wrong ref",
    5,
    [
      "execute",
      "--execute",
      "--production",
      "--confirm-project-ref",
      "abtvsrcnfwlbawvrjeee",
      "--database-url",
      PRODUCTION_SPOOF,
      "--manifest",
      manifestPath,
      "--journal",
      join(artifacts, "never4.jsonl"),
      "--all",
    ],
    { SUPABASE_URL: "" },
    "ref_confirmation_missing",
  );

  // ---- the two write markers, against a connection string that spells the
  //      real host out ------------------------------------------------------
  //
  // Every one of these must refuse BEFORE a socket is opened, and that is the
  // second thing each asserts: the target guard is GUARD 8/9/10 and the psql
  // handle is not created until GUARD 14, so a correct build produces no
  // connection diagnostic at all. If any of these ever DID open a connection
  // the URL carries no password and the environment is scrubbed, so it could
  // not authenticate — but the assertion is there so the regression is loud
  // rather than survivable.
  const refusedBeforeConnecting = (label, expectedCode, argv, expectText) => {
    const result = negative(label, expectedCode, argv, { SUPABASE_URL: "" }, expectText);
    const errors = connectionErrorIn(result.out);
    errors.length === 0
      ? ok(`...and ${label} opened no connection: no psql connection diagnostic in the output`)
      : bad(
          `${label} refused before connecting`,
          `the output contains ${JSON.stringify(errors)}, so a socket was attempted`,
        );
    return result;
  };

  // N-a — a dry run against production still needs the production marker. This
  // is the second half of the --dry-run defect: `opensTransaction` was false for
  // a dry run, so this argument list used to be permitted outright.
  refusedBeforeConnecting(
    "execute --dry-run against a production connection string with no --production",
    5,
    [
      "execute",
      "--execute",
      "--dry-run",
      "--database-url",
      PRODUCTION_SHAPED_URL,
      "--manifest",
      manifestPath,
      "--journal",
      join(artifacts, "never-na.jsonl"),
      "--all",
    ],
    "production_marker_missing",
  );

  // N-b — ...and the typed ref, still, in dry-run mode.
  refusedBeforeConnecting(
    "execute --dry-run --production against production with no --confirm-project-ref",
    5,
    [
      "execute",
      "--execute",
      "--dry-run",
      "--production",
      "--database-url",
      PRODUCTION_SHAPED_URL,
      "--manifest",
      manifestPath,
      "--journal",
      join(artifacts, "never-nb.jsonl"),
      "--all",
    ],
    "ref_confirmation_missing",
  );

  // N-c — --execute alone writes nowhere. A ref-less target needs a positive
  // claim that it is disposable; "the ref was merely unrecognised" is not one.
  negative(
    "--execute against the loopback cluster with no --disposable-target",
    5,
    [
      "execute",
      "--execute",
      "--database-url",
      CC_URL,
      "--manifest",
      manifestPath,
      "--journal",
      join(artifacts, "never-nc.jsonl"),
      "--all",
    ],
    { SUPABASE_URL: "" },
    "disposable_marker_missing",
  );

  // N-d — the two markers are mutually exclusive by construction. Calling
  // production disposable is refused before anything else is considered.
  refusedBeforeConnecting(
    "--disposable-target against a production connection string",
    4,
    [
      "execute",
      "--execute",
      "--disposable-target",
      "--database-url",
      PRODUCTION_SHAPED_URL,
      "--manifest",
      manifestPath,
      "--journal",
      join(artifacts, "never-nd.jsonl"),
      "--all",
    ],
    "disposable_claim_on_production",
  );

  // N-e — staging, spelled out in full, in the read-only mode. Staging is
  // refusal number one in every mode, so no plan artifact can ever describe it.
  refusedBeforeConnecting(
    "plan against a staging connection string",
    4,
    [
      "plan",
      "--database-url",
      STAGING_SHAPED_URL,
      "--manifest",
      join(artifacts, "never-ne.json"),
      "--exceptions-out",
      join(artifacts, "never-ne-exc.json"),
    ],
    "target_is_staging",
  );
  [
    "never-na.jsonl",
    "never-nb.jsonl",
    "never-nc.jsonl",
    "never-nd.jsonl",
    "never-ne.json",
    "never-ne-exc.json",
  ].every((name) => !existsSync(join(artifacts, name)))
    ? ok("none of the five marker controls opened a journal or wrote a plan artifact")
    : bad(
        "the marker controls produce no artifact",
        "a refused run left a file behind in the artifacts directory",
      );

  // An ambient DATABASE_URL is named and refused, never read...
  negative(
    "ambient DATABASE_URL with no explicit source",
    2,
    [
      "plan",
      "--manifest",
      join(artifacts, "never5.json"),
      "--exceptions-out",
      join(artifacts, "never5-exc.json"),
    ],
    { DATABASE_URL: "postgres://ambient:secret@10.0.0.1:5432/wrong", SUPABASE_URL: "" },
    "DATABASE_URL",
  );
  // ...and it is IGNORED, not used, when an explicit target is given.
  const ambientIgnored = runController(
    planArgs(join(artifacts, "manifest-ambient.json"), join(artifacts, "exceptions-ambient.json")),
    {
      DATABASE_URL: "postgres://ambient:secret@10.0.0.1:5432/wrong",
    },
  );
  ambientIgnored.code === 0 &&
  stripProvenance(JSON.parse(readFileSync(join(artifacts, "manifest-ambient.json"), "utf8"))) ===
    stripProvenance(manifest)
    ? ok("an ambient DATABASE_URL is ignored: the explicit target produced the identical plan")
    : bad(
        "ambient DATABASE_URL is ignored",
        `exit ${ambientIgnored.code}\n${ambientIgnored.out.slice(-600)}`,
      );

  // The journal must not be written into the repository.
  negative(
    "journal path inside the repository",
    2,
    executeArgs(["--journal", join(REPO, "journal-in-repo.jsonl"), "--all"]),
    {},
    "journal_inside_repo",
  );

  // A hand-edited manifest, down to a single word of a classifier reason.
  const tamperedManifest = join(artifacts, "manifest-tampered.json");
  {
    const copy = JSON.parse(readFileSync(manifestPath, "utf8"));
    const target = copy.projects
      .flatMap((p) => p.urls)
      .find((u) => u.evidence && u.evidence.classifier_reason);
    target.evidence.classifier_reason = `${target.evidence.classifier_reason} (reworded)`;
    writeFileSync(tamperedManifest, JSON.stringify(copy, null, 2), "utf8");
  }
  negative(
    "a classifier reason reworded in the manifest",
    8,
    executeArgs(["--journal", join(artifacts, "never6.jsonl"), "--all"], tamperedManifest),
    {},
    "manifest_body_digest mismatch",
  );

  // A policy byte moved after the approval.
  {
    const policyFile = join(REPO, "src", "features", "forever-direct-publish", "hero-policy.ts");
    const original = readFileSync(policyFile, "utf8");
    try {
      writeFileSync(policyFile, `${original}\n// path C policy-digest probe\n`, "utf8");
      negative(
        "one byte changed in hero-policy.ts",
        6,
        executeArgs(["--journal", join(artifacts, "never7.jsonl"), "--all"]),
        {},
        "policy_digest mismatch",
      );
    } finally {
      writeFileSync(policyFile, original, "utf8");
    }
  }

  // A package regenerated or edited after the approval.
  {
    const victim = join(packagesRoot, PKG.coralinaCurrent, "images", "coralina-gallery-92.png");
    const original = readFileSync(victim);
    try {
      writeFileSync(victim, png(199));
      negative(
        "one byte changed in a package file",
        7,
        executeArgs(["--journal", join(artifacts, "never8.jsonl"), "--all"]),
        {},
        "package_state_digest mismatch",
      );
    } finally {
      writeFileSync(victim, original);
    }
  }

  // A row appeared in the target since the plan was built.
  {
    Cc.sql(
      `INSERT INTO public.project_media (project_id, media_type, url, sort_order)
         VALUES ('${CP.coralina}', 'gallery', '${STORAGE}direct/coralina/${"9e".repeat(12)}.jpg', 99)`,
    );
    try {
      negative(
        "an extra media row in the target",
        9,
        executeArgs(["--journal", join(artifacts, "never9.jsonl"), "--all"]),
        {},
        "production_structure_digest mismatch",
      );
    } finally {
      Cc.sql(
        `DELETE FROM public.project_media WHERE sort_order = 99 AND project_id = '${CP.coralina}'`,
      );
    }
  }

  // A journal belonging to a different plan.
  {
    const foreign = join(artifacts, "journal-foreign.jsonl");
    writeFileSync(
      foreign,
      backfillJournal.serialiseJournalRecord({
        record: "run_opened",
        at: new Date().toISOString(),
        run_id: "f".repeat(64),
        schema_version: backfillJournal.JOURNAL_SCHEMA_VERSION,
        project_ref: "abtvsrcnfwlbawvrjeed",
        mode: "execute",
        controller_commit: "unknown",
        manifest_basename: "someone-elses.json",
        digests: manifest.digests,
        projects_selected: ["coralina"],
      }),
      "utf8",
    );
    negative(
      "a journal whose run_id is from a different manifest",
      11,
      executeArgs(["--journal", foreign, "--all", "--resume"]),
      {},
      "belongs to a different run",
    );
  }

  // A package item that resembles a production row only by filename.
  {
    const decoy = join(packagesRoot, "decoy-by-filename");
    mkdirSync(join(decoy, "images"), { recursive: true });
    // Named exactly like the live object, but different bytes.
    const liveName = byKey.get("coralinaCover").objectPath.split("/").pop();
    writeFileSync(join(decoy, "images", liveName), png(201));
    writeFileSync(
      join(decoy, "source-manifest.json"),
      JSON.stringify({
        slug: "coralina",
        batch_fingerprint: "d".repeat(64),
        media: [{ file: `images/${liveName}`, semantic_role: "villa_exterior" }],
      }),
      "utf8",
    );
    const decoyPlan = runController([
      "plan",
      "--database-url",
      CC_URL,
      "--packages",
      packagesRoot,
      ...SUPERSEDED_PACKAGES.flatMap((ref) => ["--superseded", ref]),
      "--acknowledge",
      acknowledgePath,
      "--manifest",
      join(artifacts, "manifest-decoy.json"),
      "--exceptions-out",
      join(artifacts, "exceptions-decoy.json"),
    ]);
    const decoyManifest =
      decoyPlan.code === 0
        ? JSON.parse(readFileSync(join(artifacts, "manifest-decoy.json"), "utf8"))
        : null;
    const coverEntry = decoyManifest?.projects
      .find((p) => p.slug === "coralina")
      ?.urls.find((u) => u.url === byKey.get("coralinaCover").url);
    coverEntry &&
    coverEntry.proposed_semantic_role === "property_exterior" &&
    !decoyManifest.projects
      .flatMap((p) => p.urls)
      .some((u) => u.proposed_semantic_role === "villa_exterior")
      ? ok(
          "a package item matching only by FILENAME is not applied — the join is by content and " +
            "the decoy's villa_exterior appears nowhere",
        )
      : bad(
          "filename similarity is not a join",
          `exit ${decoyPlan.code} role=${coverEntry?.proposed_semantic_role}`,
        );
    rmSync(decoy, { recursive: true, force: true });
  }

  // ---- one project, and only that project --------------------------------
  const journalMain = join(artifacts, "journal-main.jsonl");
  const single = runController(executeArgs(["--project", "coralina", "--journal", journalMain]));
  const afterSingle = Object.fromEntries(Object.keys(CSLUG).map((id) => [id, roleDigestOf(id)]));
  const onlyCoralinaMoved =
    afterSingle[CP.coralina] !== baselineRoleDigest[CP.coralina] &&
    [CP.sierra, CP.kirara, CP.quiet, CP.seeded, CP.draft].every(
      (id) => afterSingle[id] === baselineRoleDigest[id],
    );
  single.code === 0 && onlyCoralinaMoved
    ? ok("execute --project coralina updated coralina and no other project")
    : bad(
        "one-project execute is scoped",
        `exit ${single.code} moved=${JSON.stringify(
          Object.entries(afterSingle)
            .filter(([id]) => afterSingle[id] !== baselineRoleDigest[id])
            .map(([id]) => CSLUG[id]),
        )}\n${controllerDetail(single.out)}`,
      );
  afterSingle[CP.coralina] === coralinaProject.role_digest_expected_after
    ? ok("coralina's post-write role digest is exactly the digest the manifest predicted")
    : bad(
        "role digest matches the manifest prediction",
        `observed ${afterSingle[CP.coralina]} planned ${coralinaProject.role_digest_expected_after}`,
      );

  /**
   * Rows read as unit-separated fields.
   *
   * `Cluster.scalar` is `psql -tAc`, which is the only shape available here:
   * backslash meta-commands are not accepted inside `-c`, so the separator has
   * to come from SQL. `chr(31)` cannot occur in a media_type, a URL or a role.
   */
  const US = String.fromCharCode(31);
  const readRows = (selectList, where) =>
    Cc.scalar(
      `SELECT ${selectList.join(" || chr(31) || ")} FROM public.project_media WHERE ${where}`,
    )
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split(US));

  // Row by row against the payload, not merely digest against digest.
  const observedRoles = (projectId) =>
    new Map(
      readRows(
        ["media_type", "url", "coalesce(semantic_role,'')"],
        `project_id = '${projectId}'`,
      ).map((row) => [`${row[0]}@${row[1]}`, row[2] ?? ""]),
    );
  const recordedMediaFor = (where) =>
    readRows(["media_type", "url", "coalesce(semantic_role,'')"], where).map((row) => ({
      mediaType: row[0],
      url: row[1],
      semanticRole: row[2] ? row[2] : null,
    }));
  {
    const payload = backfillApply.rpcPayloadForProject(coralinaProject);
    const observed = observedRoles(CP.coralina);
    const wrong = payload.filter(
      (entry) => observed.get(`${entry.media_type}@${entry.url}`) !== entry.semantic_role,
    );
    wrong.length === 0 && payload.length === coralinaProject.project_totals.rows_to_update
      ? ok(`all ${payload.length} coralina rows hold exactly the role the manifest named`)
      : bad("resulting roles match the manifest exactly", JSON.stringify(wrong.slice(0, 5)));
  }
  {
    const roleLess = Number(
      Cc.scalar(
        `SELECT count(*) FROM public.project_media
          WHERE project_id = '${CP.coralina}' AND semantic_role IS NULL`,
      ),
    );
    roleLess === coralinaProject.project_totals.rows_left_role_less
      ? ok(`coralina keeps exactly ${roleLess} role-less row, the one the exceptions file excuses`)
      : bad(
          "role-less rows match the manifest",
          `db=${roleLess} planned=${coralinaProject.project_totals.rows_left_role_less}`,
        );
  }
  // No cover was retired, and nothing but semantic_role moved.
  {
    const after = wholeDb();
    after.mediaNonRole === baseline.mediaNonRole &&
    after.units === baseline.units &&
    after.prices === baseline.prices &&
    after.buildings === baseline.buildings &&
    after.projects === baseline.projects &&
    Number(
      Cc.scalar(
        `SELECT count(*) FROM public.project_media WHERE media_type='superseded_cover' AND project_id='${CP.coralina}'`,
      ),
    ) === 0
      ? ok(
          "after a real commit: no media_type, url, sort_order, title or metadata changed, no " +
            "cover was retired, and units/prices/buildings/projects are byte-identical",
        )
      : bad("only semantic_role changed", JSON.stringify({ baseline, after }));
  }

  // ---- forced failures, each on a project that is still pending -----------
  const trigger = {
    abort: `CREATE OR REPLACE FUNCTION public.forever_probe_abort() RETURNS trigger
              LANGUAGE plpgsql AS $fn$ BEGIN
                RAISE EXCEPTION 'forever_probe_forced_failure' USING ERRCODE = 'data_exception';
              END $fn$;`,
    skip: `CREATE OR REPLACE FUNCTION public.forever_probe_skip() RETURNS trigger
             LANGUAGE plpgsql AS $fn$ BEGIN RETURN NULL; END $fn$;`,
    touchUnits: `CREATE OR REPLACE FUNCTION public.forever_probe_touch_units() RETURNS trigger
                   LANGUAGE plpgsql AS $fn$ BEGIN
                     UPDATE public.units SET availability_status = 'reserved'
                      WHERE project_id = NEW.project_id;
                     RETURN NEW;
                   END $fn$;`,
  };
  Cc.sql([trigger.abort, trigger.skip, trigger.touchUnits].join("\n"));

  const withTrigger = (name, timing, fn, projectId, body) => {
    Cc.sql(
      `CREATE TRIGGER ${name} ${timing} UPDATE OF semantic_role ON public.project_media
         FOR EACH ROW WHEN (NEW.project_id = '${projectId}')
         EXECUTE FUNCTION public.${fn}()`,
    );
    try {
      return body();
    } finally {
      Cc.sql(`DROP TRIGGER IF EXISTS ${name} ON public.project_media`);
    }
  };

  const sierraBefore = roleDigestOf(CP.sierra);
  withTrigger("trg_probe_abort", "BEFORE", "forever_probe_abort", CP.sierra, () => {
    const journal = join(artifacts, "journal-forced-abort.jsonl");
    const result = runController(
      executeArgs([
        "--project",
        "the-title-sierra",
        "--project",
        "the-title-villa-kirara",
        "--journal",
        journal,
      ]),
    );
    const records = backfillJournal.parseJournal(readFileSync(journal, "utf8").split("\n"));
    const failed = records.filter((r) => r.record === "project_failed");
    const committed = records.filter((r) => r.record === "project_committed");
    const closed = records.find((r) => r.record === "run_closed");
    result.code === 13 &&
    failed.length === 1 &&
    failed[0].slug === "the-title-sierra" &&
    failed[0].rolled_back === true &&
    committed.some((r) => r.slug === "the-title-villa-kirara") &&
    roleDigestOf(CP.sierra) === sierraBefore &&
    closed?.projects_failed === 1 &&
    closed?.verification_ran === true
      ? ok(
          "a forced mid-project failure rolls that project back, commits the others, still runs " +
            "verification, and exits 13",
        )
      : bad(
          "forced failure is isolated",
          `exit ${result.code} failed=${JSON.stringify(failed.map((r) => r.slug))} ` +
            `committed=${JSON.stringify(committed.map((r) => r.slug))} ` +
            `sierra digest moved=${roleDigestOf(CP.sierra) !== sierraBefore}\n${controllerDetail(result.out)}`,
        );
    return journal;
  });
  // Kirara committed inside that block; sierra did not.
  roleDigestOf(CP.sierra) === sierraBefore
    ? ok("the rolled-back project is byte-identical to its pre-run state")
    : bad("rollback is complete", "sierra roles changed");

  // ...and the failed project is still re-runnable, once the cause is gone.
  // Asserted with the trigger DROPPED, because "re-runnable" is a claim about
  // the plan and the journal, not about whether the fault is still present.
  {
    const retry = runController(
      executeArgs([
        "--project",
        "the-title-sierra",
        "--journal",
        join(artifacts, "journal-forced-abort.jsonl"),
        "--resume",
      ]),
    );
    retry.code === 0 && roleDigestOf(CP.sierra) === sierraProject.role_digest_expected_after
      ? ok("the failed project is re-runnable: resuming the same journal completes it")
      : bad(
          "a failed project stays re-runnable",
          `exit ${retry.code} digest ${roleDigestOf(CP.sierra)}\n${controllerDetail(retry.out)}`,
        );
    // Back to pending, so the remaining forced-failure probes have something to
    // roll back.
    Cc.sql(
      `UPDATE public.project_media SET semantic_role = NULL WHERE project_id = '${CP.sierra}'`,
    );
    roleDigestOf(CP.sierra) === sierraBefore
      ? ok("the fixture is reset to its planned pre-state for the remaining probes")
      : bad("reset to pre-state", roleDigestOf(CP.sierra));
  }

  // The count assertion: the RPC must apply exactly what the plan named.
  withTrigger("trg_probe_skip", "BEFORE", "forever_probe_skip", CP.sierra, () => {
    const journal = join(artifacts, "journal-count-mismatch.jsonl");
    const result = runController(
      executeArgs(["--project", "the-title-sierra", "--journal", journal]),
    );
    result.code === 13 &&
    /rpc applied \d+ row\(s\), plan named \d+/.test(result.out) &&
    roleDigestOf(CP.sierra) === sierraBefore
      ? ok("an RPC count that disagrees with the plan rolls the project back")
      : bad(
          "the count assertion is enforcing",
          `exit ${result.code} digest moved=${roleDigestOf(CP.sierra) !== sierraBefore}\n${controllerDetail(result.out)}`,
        );
  });

  // The business invariant: enforcing, not observational.
  withTrigger("trg_probe_units", "AFTER", "forever_probe_touch_units", CP.sierra, () => {
    const journal = join(artifacts, "journal-units-mutated.jsonl");
    const result = runController(
      executeArgs(["--project", "the-title-sierra", "--journal", journal]),
    );
    const unitsNow = Cc.scalar(WHOLE.units);
    result.code === 13 &&
    result.out.includes("business invariant changed") &&
    unitsNow === baseline.units &&
    roleDigestOf(CP.sierra) === sierraBefore
      ? ok(
          "a units row mutated inside the transaction rolls the whole project back — units are " +
            "byte-identical afterwards",
        )
      : bad(
          "the business invariant assertion rolls back",
          `exit ${result.code} units moved=${unitsNow !== baseline.units}\n${controllerDetail(result.out)}`,
        );
  });

  // Verification is not vacuous: a manifest that claims the wrong roles fails.
  {
    const forged = JSON.parse(readFileSync(manifestPath, "utf8"));
    const sierra = forged.projects.find((p) => p.slug === "the-title-sierra");
    const entry = sierra.urls.find((u) => u.url === byKey.get("sierraPool").url);
    // Deliberately wrong, and the predicted post-state left as it was — which
    // is what makes the in-transaction check the only thing that can catch it.
    entry.proposed_semantic_role = "amenity";
    const digestsWithoutKey = { ...forged.digests };
    delete digestsWithoutKey.idempotency_key;
    forged.digests.manifest_body_digest = "";
    digestsWithoutKey.manifest_body_digest = "";
    const body = backfillFingerprints.manifestBodyDigest(forged);
    forged.digests.manifest_body_digest = body;
    digestsWithoutKey.manifest_body_digest = body;
    forged.digests.idempotency_key = backfillFingerprints.idempotencyKey(
      digestsWithoutKey,
      forged.target.project_ref,
      forged.schema_version,
    );
    for (const exception of forged.exceptions) {
      exception.manifestIdempotencyKey = forged.digests.idempotency_key;
    }
    const forgedPath = join(artifacts, "manifest-wrong-roles.json");
    writeFileSync(forgedPath, JSON.stringify(forged, null, 2), "utf8");
    const issues = backfillValidate.validateBackfillManifest(forged);
    const journal = join(artifacts, "journal-wrong-roles.jsonl");
    const result = runController(
      executeArgs(["--project", "the-title-sierra", "--journal", journal], forgedPath),
    );
    issues.length === 0 &&
    result.code === 13 &&
    result.out.includes("role_digest_expected_after mismatch") &&
    roleDigestOf(CP.sierra) === sierraBefore
      ? ok(
          "a manifest whose expected roles are deliberately wrong is caught IN the transaction " +
            "and rolled back — the verification is not vacuous",
        )
      : bad(
          "wrong expected roles fail verification",
          `validator issues ${issues.length} exit ${result.code} digest moved=${roleDigestOf(CP.sierra) !== sierraBefore}\n${controllerDetail(result.out)}`,
        );
  }

  // ---- interruption and resume -------------------------------------------
  const resetRoles = (projectId) =>
    Cc.sql(
      `UPDATE public.project_media SET semantic_role = NULL WHERE project_id = '${projectId}'`,
    );
  const journalHead = (runId, project) =>
    [
      backfillJournal.serialiseJournalRecord({
        record: "run_opened",
        at: new Date().toISOString(),
        run_id: runId,
        schema_version: backfillJournal.JOURNAL_SCHEMA_VERSION,
        project_ref: manifest.target.project_ref,
        mode: "execute",
        controller_commit: "unknown",
        manifest_basename: "manifest.json",
        digests: manifest.digests,
        projects_selected: [project.slug],
      }),
      backfillJournal.serialiseJournalRecord({
        record: "project_started",
        at: new Date().toISOString(),
        run_id: runId,
        project_id: project.project_id,
        slug: project.slug,
        project_plan_digest: "simulated",
        planned_updates: project.project_totals.rows_to_update,
        planned_exceptions: 0,
        role_digest_before: project.role_digest_before,
        role_digest_expected_after: project.role_digest_expected_after,
      }),
    ].join("");

  // (a) interrupted BEFORE the commit. The on-disk state is exactly this: a
  //     project_started with no outcome, and a table still holding the
  //     pre-state. Written directly rather than by killing a process, so the
  //     case is reproduced deterministically instead of by timing.
  {
    resetRoles(CP.sierra);
    const journal = join(artifacts, "journal-crash-rolled-back.jsonl");
    writeFileSync(journal, journalHead(manifest.digests.idempotency_key, sierraProject), "utf8");
    const result = runController(
      executeArgs(["--project", "the-title-sierra", "--journal", journal, "--resume"]),
    );
    const records = backfillJournal.parseJournal(readFileSync(journal, "utf8").split("\n"));
    const committed = records.filter((r) => r.record === "project_committed");
    result.code === 0 &&
    committed.length === 1 &&
    committed[0].recovered_from_crash === false &&
    roleDigestOf(CP.sierra) === sierraProject.role_digest_expected_after
      ? ok(
          "an interruption before COMMIT is classified as rolled back, RETRIED (not skipped), and " +
            "completes on resume",
        )
      : bad(
          "resume retries a crashed-before-commit project",
          `exit ${result.code} committed=${JSON.stringify(committed)}\n${controllerDetail(result.out)}`,
        );
  }

  // (b) interrupted AFTER the commit and before the append. The dangerous case:
  //     assuming a rollback here would re-run the invariant assertions against
  //     a moved baseline.
  {
    const journal = join(artifacts, "journal-crash-committed.jsonl");
    writeFileSync(journal, journalHead(manifest.digests.idempotency_key, sierraProject), "utf8");
    const before = wholeDb();
    const result = runController(
      executeArgs(["--project", "the-title-sierra", "--journal", journal, "--resume"]),
    );
    const records = backfillJournal.parseJournal(readFileSync(journal, "utf8").split("\n"));
    const recovered = records.filter(
      (r) => r.record === "project_committed" && r.recovered_from_crash === true,
    );
    const after = wholeDb();
    result.code === 0 && recovered.length === 1 && JSON.stringify(before) === JSON.stringify(after)
      ? // and no second project_committed for the same project beyond the recovery
        ok(
          "an interruption after COMMIT is recognised from the live digest, recorded as recovered, " +
            "and writes nothing a second time",
        )
      : bad(
          "resume recognises a landed commit",
          `exit ${result.code} recovered=${recovered.length} rolesMoved=${before.roles !== after.roles}\n${controllerDetail(result.out)}`,
        );
  }

  // (c) a state a single transaction cannot produce. No repair is attempted.
  {
    resetRoles(CP.sierra);
    const payload = backfillApply.rpcPayloadForProject(sierraProject);
    const half = payload.slice(0, Math.max(1, Math.floor(payload.length / 2)));
    for (const entry of half) {
      Cc.sql(
        `UPDATE public.project_media SET semantic_role = '${entry.semantic_role}'
          WHERE project_id = '${CP.sierra}' AND media_type = '${entry.media_type}'
            AND url = '${entry.url}'`,
      );
    }
    const partialDigest = roleDigestOf(CP.sierra);
    const journal = join(artifacts, "journal-crash-partial.jsonl");
    writeFileSync(journal, journalHead(manifest.digests.idempotency_key, sierraProject), "utf8");
    const result = runController(
      executeArgs(["--project", "the-title-sierra", "--journal", journal, "--resume"]),
    );
    // The SAFETY property: refused, nothing written, nothing repaired.
    (result.code === 12 || result.code === 9) && roleDigestOf(CP.sierra) === partialDigest
      ? ok(
          `a half-classified project is refused (exit ${result.code}) and left exactly as found — ` +
            "no automatic repair, no further writes",
        )
      : bad(
          "partial state aborts without repair",
          `exit ${result.code} digest moved=${roleDigestOf(CP.sierra) !== partialDigest}\n${controllerDetail(result.out)}`,
        );
    // ...but not with the exit code or the diagnostic the design specifies.
    result.code === 12
      ? ok("the partial state is diagnosed as irrecoverable (exit 12) as designed")
      : note(
          "exit 12 (irrecoverable partial state) is unreachable; the case surfaces as exit 9",
          `Guard 17 classifies every chosen project three ways and exits 9 the moment one is ` +
            `neither the planned pre-state nor the planned post-state. A half-applied project is ` +
            `exactly that, so it is refused before guard 18 ever reads the journal — and ` +
            `classifyCrashedProject's "partial_irrecoverable" branch, EXIT.irrecoverable and the ` +
            `"no repair is attempted" message are dead code. Observed exit ${result.code}. The ` +
            `outcome is still fail-closed (nothing written, nothing repaired), but the operator ` +
            `is told "re-plan" where the design intends "stop, this needs a human".`,
        );
    resetRoles(CP.sierra);
  }

  // ---- the full batch, then the replay ------------------------------------
  const journalAll = join(artifacts, "journal-all.jsonl");
  const all = runController([
    "execute",
    "--execute",
    "--disposable-target",
    "--database-url",
    CC_URL,
    "--manifest",
    manifestPath,
    "--exceptions",
    exceptionsPath,
    "--packages",
    packagesRoot,
    ...SUPERSEDED_PACKAGES.flatMap((ref) => ["--superseded", ref]),
    "--journal",
    journalAll,
    "--all",
    "--stage",
    "after_backfill",
  ]);
  all.code === 0
    ? ok("the full batch executed and the after_backfill gate passed in the same run")
    : bad("full batch execute", `exit ${all.code}\n${controllerDetail(all.out)}`);

  {
    const mismatches = [];
    for (const project of manifest.projects) {
      const payload = backfillApply.rpcPayloadForProject(project);
      const observed = observedRoles(project.project_id);
      for (const entry of payload) {
        const got = observed.get(`${entry.media_type}@${entry.url}`);
        if (got !== entry.semantic_role) {
          mismatches.push(
            `${project.slug} ${entry.media_type} expected ${entry.semantic_role} got ${got}`,
          );
        }
      }
      const observedDigest = roleDigestOf(project.project_id);
      if (observedDigest !== project.role_digest_expected_after) {
        mismatches.push(
          `${project.slug} role digest ${observedDigest} != ${project.role_digest_expected_after}`,
        );
      }
    }
    mismatches.length === 0
      ? ok(
          `every one of the ${manifest.totals.rows_to_update} planned rows holds exactly its ` +
            "planned role, and every project's role digest equals its predicted digest",
        )
      : bad("resulting roles match the manifest exactly", mismatches.slice(0, 8).join("\n"));
  }

  // The role-less rows that survive are exactly the excused ones.
  {
    const roleLess = Cc.scalar(
      `SELECT p.slug || ' ' || m.url FROM public.project_media m
         JOIN public.projects p ON p.id = m.project_id
        WHERE m.semantic_role IS NULL AND p.is_active AND p.public_status = 'published'
        ORDER BY 1`,
    )
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const excused = writtenExceptions.map((e) => `${e.projectSlug} ${e.url}`).sort();
    JSON.stringify([...new Set(roleLess)].sort()) === JSON.stringify(excused)
      ? ok(`the ${excused.length} surviving role-less public rows are exactly the excused ones`)
      : bad(
          "role-less rows are exactly the exceptions",
          `db ${JSON.stringify(roleLess)}\nexcused ${JSON.stringify(excused)}`,
        );
  }

  const afterAll = wholeDb();
  afterAll.units === baseline.units &&
  afterAll.prices === baseline.prices &&
  afterAll.buildings === baseline.buildings &&
  afterAll.projects === baseline.projects &&
  afterAll.mediaNonRole === baseline.mediaNonRole &&
  Number(Cc.scalar(`SELECT count(*) FROM public.units WHERE availability_status = 'sold'`)) === 2
    ? ok(
        "across the whole run: units, prices, price history, SOLD status, buildings, projects and " +
          "every non-role media column are byte-identical to the pre-run baseline",
      )
    : bad(
        "business data unchanged",
        JSON.stringify({
          units: [baseline.units, afterAll.units],
          prices: [baseline.prices, afterAll.prices],
          buildings: [baseline.buildings, afterAll.buildings],
          projects: [baseline.projects, afterAll.projects],
          mediaNonRole: [baseline.mediaNonRole, afterAll.mediaNonRole],
        }),
      );
  Number(
    Cc.scalar(`SELECT count(*) FROM public.project_media WHERE media_type = 'superseded_cover'`),
  ) === 1 && roleDigestOf(CP.quiet) === baselineRoleDigest[CP.quiet]
    ? ok(
        "no cover was retired by the run (the one retired row is the seeded draft one) and the " +
          "unrelated project is untouched",
      )
    : bad(
        "cover retirement is out of scope and unrelated projects are untouched",
        `superseded_cover=${Cc.scalar(`SELECT count(*) FROM public.project_media WHERE media_type='superseded_cover'`)}`,
      );

  // ---- replay -------------------------------------------------------------
  {
    const journalReplay = join(artifacts, "journal-replay.jsonl");
    const beforeReplay = wholeDb();
    const replay = runController([
      "execute",
      "--execute",
      "--disposable-target",
      "--database-url",
      CC_URL,
      "--manifest",
      manifestPath,
      "--exceptions",
      exceptionsPath,
      "--journal",
      journalReplay,
      "--all",
      "--stage",
      "after_backfill",
    ]);
    const afterReplay = wholeDb();
    const records = backfillJournal.parseJournal(readFileSync(journalReplay, "utf8").split("\n"));
    const skipped = records.filter(
      (r) => r.record === "project_skipped" && r.reason === "already_applied_idempotent",
    );
    const withChanges = manifest.projects.filter((p) => p.project_totals.rows_to_update > 0);
    replay.code === 0 &&
    JSON.stringify(beforeReplay) === JSON.stringify(afterReplay) &&
    skipped.length === withChanges.length
      ? ok(
          `replaying the same manifest changed zero rows: all ${skipped.length} projects with ` +
            "planned writes were recorded already_applied_idempotent",
        )
      : bad(
          "replay is idempotent",
          `exit ${replay.code} skipped=${skipped.length}/${withChanges.length} ` +
            `rolesMoved=${beforeReplay.roles !== afterReplay.roles}\n${controllerDetail(replay.out)}`,
        );
    records.filter((r) => r.record === "project_committed").every((r) => r.rows_updated === 0) ||
    records.filter((r) => r.record === "project_committed").length === 0
      ? ok("the replay journal records no second commit of any already-applied project")
      : bad(
          "no duplicate commit on replay",
          JSON.stringify(
            records.filter((r) => r.record === "project_committed").map((r) => r.slug),
          ),
        );
  }

  // ---- the census gate, both ways ----------------------------------------
  const gateWith = censusC("after_backfill", exceptionsPath);
  gateWith.code === 0 && gateWith.out.includes("GATE  PASS")
    ? ok("after_backfill census PASSES with the controller's own exceptions file, unmodified")
    : bad("after_backfill gate passes with the exceptions file", controllerDetail(gateWith.out));
  const gateWithout = censusC("after_backfill");
  gateWithout.code === 1 &&
  gateWithout.out.includes("GATE  BLOCKED") &&
  gateWithout.out.includes(ASSET_KEY_URL)
    ? ok("the SAME gate BLOCKS without the exceptions file, naming the bundled-asset row")
    : bad(
        "gate blocks without exceptions",
        `exit ${gateWithout.code}\n${controllerDetail(gateWithout.out)}`,
      );

  // The two tools must agree on the numbers, not merely both be happy.
  {
    const governedReported = Number(/governed rows\s*:\s*(\d+)/.exec(gateWith.out)?.[1] ?? -1);
    const classifiedReported = Number(/classified\s*:\s*(\d+)/.exec(gateWith.out)?.[1] ?? -1);
    const excusedReported = Number(/excused\s*:\s*(\d+)/.exec(gateWith.out)?.[1] ?? -1);
    const governedInDb = Number(
      Cc.scalar(
        `SELECT count(*) FROM public.project_media m JOIN public.projects p ON p.id = m.project_id
          WHERE m.media_type IN ('cover','gallery','floor_plan','master_plan','unit_plan',
                                 'document','brochure','payment_plan','video')
            AND p.is_active AND p.public_status = 'published'`,
      ),
    );
    governedReported === governedInDb &&
    classifiedReported === manifest.totals.rows_to_update &&
    excusedReported === writtenExceptions.length
      ? ok(
          `the census and the controller agree: ${governedReported} governed, ` +
            `${classifiedReported} classified (= the manifest's rows_to_update), ` +
            `${excusedReported} excused (= the exceptions file)`,
        )
      : bad(
          "census and controller agree on the numbers",
          `governed ${governedReported}/${governedInDb} classified ${classifiedReported}/${manifest.totals.rows_to_update} excused ${excusedReported}/${writtenExceptions.length}`,
        );
  }

  // ---- the four PR #117 gate defects, as regressions ---------------------
  gateWith.out.includes("payment_plan")
    ? ok("D1: payment_plan is inside GOVERNED_MEDIA_TYPES, so a public document cannot be missed")
    : bad("D1 payment_plan is governed", "the governed list does not mention payment_plan");
  {
    const paymentGoverned = Number(
      Cc.scalar(
        `SELECT count(*) FROM public.project_media m JOIN public.projects p ON p.id = m.project_id
          WHERE m.media_type = 'payment_plan' AND p.is_active AND p.public_status = 'published'`,
      ),
    );
    const classifiedReported = Number(/classified\s*:\s*(\d+)/.exec(gateWith.out)?.[1] ?? -1);
    paymentGoverned === 1 && classifiedReported === manifest.totals.rows_to_update
      ? ok("D1: the published payment_plan row is counted and classified, not silently dropped")
      : bad("D1 payment_plan counted", `paymentGoverned=${paymentGoverned}`);
  }
  {
    // D2: EXCLUDED_SQL counts every non-price_list type; `allGoverned - governed`
    // does not. The draft project's payment_plan and retired cover are what
    // separate the two.
    //
    // The fix is that BOTH SIDES NOW MEASURE THE SAME SET. `excludedInDb` is
    // EXCLUDED_SQL's own predicate — `media_type <> 'price_list'` against
    // unpublished/inactive/orphaned projects — rather than an arithmetic
    // reconstruction over the 8 governed types, which counts a different set and
    // only agreed when the fixture happened to hold no draft rows outside those
    // types. `oldArithmetic` is kept and asserted to DISAGREE, so this check
    // cannot silently become a tautology: if the fixture ever stopped
    // distinguishing the two, this fails rather than passing for free.
    const excludedReported = Number(/not counted\s*:\s*(\d+)/.exec(gateWith.out)?.[1] ?? -1);
    const excludedInDb = Number(
      Cc.scalar(
        `SELECT count(*) FROM public.project_media m LEFT JOIN public.projects p ON p.id = m.project_id
          WHERE m.media_type <> 'price_list'
            AND (p.id IS NULL OR NOT p.is_active OR p.public_status IS DISTINCT FROM 'published')`,
      ),
    );
    const oldArithmetic =
      Number(
        Cc.scalar(
          `SELECT count(*) FROM public.project_media
            WHERE media_type IN ('cover','gallery','floor_plan','master_plan','unit_plan',
                                 'document','brochure','payment_plan','video')`,
        ),
      ) -
      Number(
        Cc.scalar(
          `SELECT count(*) FROM public.project_media m JOIN public.projects p ON p.id = m.project_id
            WHERE m.media_type IN ('cover','gallery','floor_plan','master_plan','unit_plan',
                                   'document','brochure','payment_plan','video')
              AND p.is_active AND p.public_status = 'published'`,
        ),
      );
    excludedReported === excludedInDb && oldArithmetic !== excludedInDb
      ? ok(
          `D2: the excluded count is measured the way EXCLUDED_SQL counts (${excludedInDb}); the ` +
            `old subtraction would have said ${oldArithmetic} and failed a correct database`,
        )
      : bad(
          "D2 excluded count",
          `reported=${excludedReported} db=${excludedInDb} old=${oldArithmetic}`,
        );
  }
  {
    // D3: the report's retired count is publication-scoped. The seeded retired
    // cover sits on a DRAFT project, which is exactly the case that used to
    // fail while both sides were correct.
    //
    // Same fix, same shape: the report counts `superseded_cover` rows out of
    // CENSUS_SQL, which JOINs projects and filters `is_active AND
    // public_status = 'published'`, so the harness compares against a query
    // carrying THAT scope (`retiredScoped`) instead of an unscoped `count(*)`.
    // `retiredUnscoped` is kept and asserted to differ for the same reason as
    // above — the two are equal only when no draft project holds a retired
    // cover, and a fixture that lost that row would make this check vacuous.
    const retiredReported = Number(/retired rows\s*:\s*(\d+)/.exec(gateWith.out)?.[1] ?? -1);
    const retiredScoped = Number(
      Cc.scalar(
        `SELECT count(*) FROM public.project_media m JOIN public.projects p ON p.id = m.project_id
          WHERE m.media_type = 'superseded_cover' AND p.is_active AND p.public_status = 'published'`,
      ),
    );
    const retiredUnscoped = Number(
      Cc.scalar(`SELECT count(*) FROM public.project_media WHERE media_type = 'superseded_cover'`),
    );
    retiredReported === retiredScoped && retiredUnscoped !== retiredScoped
      ? ok(
          `D3: the retired count is publication-scoped (${retiredScoped}); the unscoped count is ` +
            `${retiredUnscoped}, and comparing those two is what used to fail a correct run`,
        )
      : bad(
          "D3 retired count scope",
          `reported=${retiredReported} scoped=${retiredScoped} unscoped=${retiredUnscoped}`,
        );
  }
  /not counted\s*:\s*\d+ media row\(s\)/.test(gateWith.out) &&
  !/not counted[^\n]*cover\/gallery/.test(gateWith.out)
    ? ok('D4: the "not counted" line describes media rows, not "cover/gallery row(s)"')
    : bad(
        "D4 not-counted label",
        gateWith.out.split("\n").find((l) => l.startsWith("not counted")),
      );

  // ---- acceptance criteria, evaluated against the written rows -----------
  {
    const verify = runController([
      "verify",
      "--database-url",
      CC_URL,
      "--manifest",
      manifestPath,
      "--exceptions",
      exceptionsPath,
      "--stage",
      "after_backfill",
    ]);
    const lines = verify.out.split("\n").filter((l) => l.startsWith("[acceptance]"));
    const failing = lines.filter((l) => l.includes("FAIL"));
    const named = lines.filter((l) => /coralina\.|sierra\.|kirara\./.test(l));
    verify.code === 0 && failing.length === 0 && named.length >= 15
      ? ok(
          `verify: all ${lines.length} acceptance criteria pass or are not_checkable (${named.length} named)`,
        )
      : bad(
          "acceptance criteria pass against the written rows",
          `exit ${verify.code} failing=${failing.length}\n${lines.join("\n")}`,
        );
    for (const id of [
      "coralina.single_active_exterior_cover",
      "coralina.old_event_cover_not_presentable",
      "sierra.holiday_moments_excluded",
      "sierra.lifestyle_excluded",
      "kirara.no_eligible_cover",
      "kirara.plans_documents_retained",
      "kirara.no_fabricated_exterior_role",
    ]) {
      const line = lines.find((l) => l.includes(id));
      line && line.includes("PASS")
        ? ok(`acceptance ${id}`)
        : bad(`acceptance ${id}`, line ?? "criterion not reported");
    }
  }

  // The presentation consequences, asked of the real policy rather than parsed.
  {
    const rows = recordedMediaFor(`project_id IN ('${CP.coralina}','${CP.sierra}')`);
    const barred = mediaPolicy.prohibitedPhotographUrls(rows);
    const advertisement = byKey.get("sierraPromo").url;
    const hero = byKey.get("sierraCover").url;
    barred.has(advertisement) && !barred.has(hero)
      ? ok("prohibitedPhotographUrls now bars the advertisement and still admits the active cover")
      : bad(
          "the advertisement leaves, the hero stays",
          `advertisement barred=${barred.has(advertisement)} hero barred=${barred.has(hero)}`,
        );
    const sierraCover = mediaPolicy.presentableCoverUrl(hero, rows);
    const kiraraRows = recordedMediaFor(`project_id = '${CP.kirara}'`);
    sierraCover === hero && mediaPolicy.presentableCoverUrl(null, kiraraRows) === null
      ? ok("presentableCoverUrl returns the Sierra hero and null for the cover-less Kirara shape")
      : bad(
          "presentableCoverUrl",
          `sierra=${sierraCover} kirara-shape=${mediaPolicy.presentableCoverUrl(null, kiraraRows)}`,
        );
  }

  // ---- the vocabulary CHECK, and the validator rules that need a fixture --
  {
    const error = Cc.expectFailure(
      `UPDATE public.project_media SET semantic_role = 'launch_party'
        WHERE project_id = '${CP.coralina}' AND media_type = 'cover'`,
      "path C invented role",
    );
    /violates check constraint "project_media_semantic_role_vocabulary"/.test(error)
      ? ok("the database still refuses an invented role after the backfill has run")
      : bad("vocabulary CHECK holds", error.slice(0, 300));
  }
  {
    // V4 cannot be produced by a generated plan — a role-less URL has no
    // band-0/1 evidence by construction — so it is exercised against the real
    // manifest with one synthetic refusal injected. Reported as an in-process
    // validator assertion, not as a CLI path.
    const probe = JSON.parse(readFileSync(manifestPath, "utf8"));
    const victim = probe.projects
      .find((p) => p.slug === "the-title-villa-kirara")
      .urls.find((u) => u.proposed_semantic_role === null);
    victim.refused_evidence = [
      {
        tier: "package_manifest_semantic_role",
        role: "event",
        input: "media[].semantic_role",
        input_value: "event",
        why: "synthetic probe",
      },
    ];
    const issues = backfillValidate.validateBackfillManifest(probe);
    issues.some((i) => i.code === "exception_hides_prohibited")
      ? ok(
          "V4: an exception may not excuse a URL some evidence calls event — the manifest is refused",
        )
      : bad("V4 exception_hides_prohibited", JSON.stringify(issues.map((i) => i.code)));
  }
  {
    let threw = "";
    try {
      backfillExceptions.writeExceptionsFile(join(artifacts, "blank-reason.json"), [
        {
          projectSlug: "coralina",
          url: "https://x/y.jpg",
          reason: "   ",
          reasonCode: "classification_unavailable_no_evidence",
        },
      ]);
    } catch (error) {
      threw = String(error?.message ?? "");
    }
    threw.includes("exception_missing_reason") && !existsSync(join(artifacts, "blank-reason.json"))
      ? ok("an exception with a blank reason is refused BEFORE the file is written")
      : bad("blank reason refused", threw || "no error thrown");
  }
  {
    // The strictness ordering the whole resolution rests on, read off the real
    // policy maps rather than restated.
    const bands = Object.fromEntries(
      [
        "event",
        "text_promo",
        "plan",
        "amenity",
        "unknown",
        "property_interior",
        "property_exterior",
      ].map((role) => [role, backfillRoles.strictnessBand(role)]),
    );
    bands.event === 0 &&
    bands.text_promo === 1 &&
    bands.plan === 1 &&
    bands.amenity === 2 &&
    bands.unknown === 3 &&
    bands.property_interior === 4 &&
    bands.property_exterior === 5
      ? ok("strictness bands are derived from the live policy maps and order as documented")
      : bad("strictness bands", JSON.stringify(bands));
  }

  // ---- the prescribed sequence: dry run, then the real run, ONE journal ---
  //
  // The third blocker, and the reason it needs a live cluster rather than a unit
  // test. The operating sequence is "dry run, read the journal, then execute
  // against that same journal with --resume". The dry-run branch used to append
  // `project_committed` with `rows_updated: 0`; `classifyResume` reads the
  // record NAME, not the count, so the real run classified every project
  // `committed`, skipped it as `already_applied_idempotent`, and wrote NOTHING —
  // while the journal, which is the release record, asserted that the rows had
  // been applied. Silent success, in the artifact the release is judged by.
  //
  // Every other scenario in this file gives the dry run its own journal path
  // (journal-dry-run.jsonl) and the real run another (journal-main.jsonl).
  // That is precisely why none of them could see it. This one uses a single
  // path across both steps, which is the only shape that exercises the bug.
  {
    for (const project of manifest.projects) resetRoles(project.project_id);
    const preState = manifest.projects.filter(
      (project) => roleDigestOf(project.project_id) !== project.role_digest_before,
    );
    preState.length === 0
      ? ok(
          `all ${manifest.projects.length} projects reset to their planned pre-state, so the ` +
            "sequence below starts where a real first run would",
        )
      : bad(
          "the fixture is back at the planned pre-state",
          JSON.stringify(preState.map((p) => p.slug)),
        );

    const sharedJournal = join(artifacts, "journal-dry-then-real.jsonl");
    const sequenceArgs = (extra) => [
      "execute",
      "--execute",
      "--disposable-target",
      "--database-url",
      CC_URL,
      "--manifest",
      manifestPath,
      "--exceptions",
      exceptionsPath,
      "--packages",
      packagesRoot,
      ...SUPERSEDED_PACKAGES.flatMap((ref) => ["--superseded", ref]),
      "--journal",
      sharedJournal,
      "--all",
      ...extra,
    ];

    // Step 1 — the dry run, writing into the shared journal.
    const beforeDry = wholeDb();
    const dryStep = runController(sequenceArgs(["--dry-run", "--stage", "before_backfill"]));
    const afterDryStep = wholeDb();
    const dryRecords = backfillJournal.parseJournal(
      readFileSync(sharedJournal, "utf8").split("\n"),
    );
    const dryRunRecords = dryRecords.filter((r) => r.record === "project_dry_run");
    const dryCommitted = dryRecords.filter((r) => r.record === "project_committed");
    dryStep.code === 0 &&
    JSON.stringify(beforeDry) === JSON.stringify(afterDryStep) &&
    dryRunRecords.length === manifest.projects.length &&
    dryCommitted.length === 0 &&
    dryRunRecords.every((r) => r.rows_updated === 0)
      ? ok(
          `step 1 — the dry run appended ${dryRunRecords.length} project_dry_run record(s) and ` +
            "NO project_committed, and the database is byte-identical afterwards",
        )
      : bad(
          "a dry run records project_dry_run, never project_committed",
          `exit ${dryStep.code} dry_run=${dryRunRecords.length} committed=${dryCommitted.length} ` +
            `rolesMoved=${beforeDry.roles !== afterDryStep.roles}\n${controllerDetail(dryStep.out)}`,
        );

    // ...and the classifier agrees: `dry_run_only`, which is neither
    // `committed` (nothing was written) nor `never_attempted` (something ran).
    {
      const resume = backfillJournal.classifyResume(
        dryRecords,
        manifest.digests.idempotency_key,
        manifest,
      );
      const states = manifest.projects.map((p) => resume.perProject.get(p.project_id));
      !resume.foreignRunId && states.every((s) => s === "dry_run_only")
        ? ok(
            "classifyResume reads that journal as dry_run_only for every project — the state that " +
              "makes the next run do the work",
          )
        : bad(
            "the dry-run journal classifies as dry_run_only",
            `foreign=${resume.foreignRunId} states=${JSON.stringify([...new Set(states)])}`,
          );
    }

    // Step 2 — the REAL run, resuming that same journal. This is the run that
    // used to write nothing.
    const realStep = runController(sequenceArgs(["--resume", "--stage", "after_backfill"]));
    const allRecords = backfillJournal.parseJournal(
      readFileSync(sharedJournal, "utf8").split("\n"),
    );
    const idempotentSkips = allRecords.filter(
      (r) => r.record === "project_skipped" && r.reason === "already_applied_idempotent",
    );
    const realCommits = allRecords.filter(
      (r) => r.record === "project_committed" && r.recovered_from_crash === false,
    );
    const plannedRows = manifest.projects.reduce(
      (sum, p) => sum + p.project_totals.rows_to_update,
      0,
    );
    const committedRows = realCommits.reduce((sum, r) => sum + r.rows_updated, 0);
    realStep.code === 0 &&
    idempotentSkips.length === 0 &&
    realCommits.length === manifest.projects.length &&
    committedRows === plannedRows
      ? ok(
          `step 2 — the real run on the SAME journal committed all ${realCommits.length} projects ` +
            `and ${committedRows} row(s), and recorded already_applied_idempotent for NONE of ` +
            "them: the dry run did not make it think the work was done",
        )
      : bad(
          "the real run after a dry run on the same journal actually does the work",
          `exit ${realStep.code} committed=${realCommits.length}/${manifest.projects.length} ` +
            `rows=${committedRows}/${plannedRows} idempotentSkips=${idempotentSkips.length}\n` +
            controllerDetail(realStep.out),
        );

    // ...and the rows really moved. The journal saying "committed" is not the
    // claim under test; the table is.
    {
      const mismatches = [];
      for (const project of manifest.projects) {
        const payload = backfillApply.rpcPayloadForProject(project);
        const observed = observedRoles(project.project_id);
        for (const entry of payload) {
          const got = observed.get(`${entry.media_type}@${entry.url}`);
          if (got !== entry.semantic_role) {
            mismatches.push(
              `${project.slug} ${entry.media_type} expected ${entry.semantic_role} got ${got}`,
            );
          }
        }
        const observedDigest = roleDigestOf(project.project_id);
        if (observedDigest !== project.role_digest_expected_after) {
          mismatches.push(`${project.slug} role digest ${observedDigest} != predicted`);
        }
      }
      mismatches.length === 0 && plannedRows > 0
        ? ok(
            `step 2 wrote real rows: all ${plannedRows} planned rows hold exactly their planned ` +
              "role and every project's role digest equals its predicted digest",
          )
        : bad(
            "the dry-run-then-real sequence leaves the planned roles in the table",
            mismatches.slice(0, 8).join("\n") || `plannedRows=${plannedRows}`,
          );
    }

    // The summary line of a dry run's release record must not read as though it
    // committed. This was a reported finding — one counter served both branches,
    // so a dry run closed its journal claiming a commit per rolled-back project.
    // Now asserted rather than observed, in both directions, so the counters
    // cannot quietly merge again.
    {
      const dryClosed = dryRecords.find((r) => r.record === "run_closed");
      if (!dryClosed) {
        bad("a dry run closes its journal", "no run_closed record was written");
      } else if (dryClosed.projects_committed !== 0) {
        bad(
          "a dry run reports zero commits",
          `run_closed records projects_committed=${dryClosed.projects_committed} for ` +
            `${dryRunRecords.length} project(s) that all rolled back`,
        );
      } else if (dryClosed.projects_dry_run_only !== dryRunRecords.length) {
        bad(
          "a dry run counts its rolled-back projects",
          `run_closed records projects_dry_run_only=${dryClosed.projects_dry_run_only} but ` +
            `${dryRunRecords.length} project_dry_run record(s) were written`,
        );
      } else {
        ok(
          `a dry run's run_closed reports 0 committed and ${dryClosed.projects_dry_run_only} ` +
            `dry-run-only`,
        );
      }
    }
  }

  // ---- nothing leaked into any output ------------------------------------
  {
    const captured = controllerLog.join("\n");
    const artifactText = [manifestPath, exceptionsPath, reportPath]
      .filter((p) => existsSync(p))
      .map((p) => readFileSync(p, "utf8"))
      .join("\n");
    const forbidden = [
      [CC_PASSWORD, "the connection password"],
      ["eyJ", "a JWT-shaped token"],
      ["service_role", "a service-role literal"],
      ["/Users/", "a POSIX home directory"],
      ["Downloads", "a private source folder"],
      ["Telegram", "a private source folder"],
    ];
    const leaks = [];
    for (const [needle, what] of forbidden) {
      if (captured.includes(needle)) leaks.push(`controller output contains ${what}`);
      if (artifactText.includes(needle)) leaks.push(`a written artifact contains ${what}`);
    }
    // A Windows drive letter, anchored so `https://` does not match.
    if (/(^|[^A-Za-z0-9+.\-_])[A-Za-z]:[\\/]/.test(artifactText)) {
      leaks.push("a written artifact contains a filesystem path");
    }
    leaks.length === 0 && captured.length > 5000
      ? ok(
          `no credential and no private path in ${captured.length} bytes of controller output or ` +
            "in any written artifact (the URL carried a password, so this can fail)",
        )
      : bad(
          "no credential or private path leaked",
          leaks.join("\n") || "captured output too small",
        );
  }

  const pathCResult = {
    cluster_port: Cc.port,
    projects: manifest.totals.projects,
    media_rows: manifest.totals.rows,
    rows_written: manifest.totals.rows_to_update,
    exceptions: manifest.totals.exceptions,
    negative_controls: negatives.length,
    all_negatives_wrote_nothing: negatives.every((n) => n.unchanged),
  };
  console.log(`[media-pg] path C ${JSON.stringify(pathCResult)}`);
  rmSync(work, { recursive: true, force: true });

  // -- the machine-readable result ------------------------------------------
  // Printed, never written into the repository: a proof artefact must not be
  // capable of becoming a tracked file.
  console.log(
    "\n[media-pg] result " +
      JSON.stringify({
        server_version: A.scalar("SHOW server_version"),
        migrations_applied: files.length,
        subject: SUBJECT,
        checks,
        failures,
        fixtures: seeded,
        path_c: pathCResult,
      }),
  );
} catch (error) {
  failures += 1;
  const detail = [error.stdout, error.stderr, error.message]
    .filter(Boolean)
    .map((p) => String(p).trim())
    .filter(Boolean)
    .join("\n");
  console.error("[media-pg] HARNESS ERROR\n" + detail);
} finally {
  for (const c of clusters) c.stop();
}

if (findings.length > 0) {
  console.log(`\n[media-pg] ${findings.length} FINDING(S) — behaviour held, but read these:`);
  for (const finding of findings) console.log(`  - ${finding.label}`);
}

console.log(`\n[media-pg] ${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`[media-pg] FAIL — ${failures} failing check(s)`);
  process.exitCode = 1;
} else {
  console.log("[media-pg] PASS");
}
