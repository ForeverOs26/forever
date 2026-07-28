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
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  if (subjectIndex !== files.length - 1) {
    throw new Error(`${SUBJECT} is not last in ledger order — additive ordering violated`);
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
  ok(`complete chain applied (${files.length} migrations, ${SUBJECT} last)`);

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
  // The contract test only string-matches the rollback block, so a rollback
  // that cannot execute would pass the suite. Execute it here instead.
  console.log("\n[media-pg] rollback — executed, not string-matched");
  let rollbackError = "";
  try {
    Bc.sql(`UPDATE public.project_media pm SET media_type = 'cover'
              WHERE pm.media_type = 'superseded_cover'
                AND NOT EXISTS (
                  SELECT 1 FROM public.project_media live
                   WHERE live.project_id = pm.project_id
                     AND live.media_type = 'cover'
                     AND live.url = pm.url)`);
  } catch (error) {
    rollbackError = String(error.stderr ?? "") + String(error.stdout ?? "");
  }
  rollbackError === ""
    ? ok("the documented rollback executes without violating the natural key")
    : bad("documented rollback executes", rollbackError.slice(0, 400));

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
  const retiredInDb = Number(
    Bc.scalar("SELECT count(*) FROM public.project_media WHERE media_type = 'superseded_cover'"),
  );
  const retiredReported = Number(/retired rows\s*:\s*(\d+)/.exec(after.out)?.[1] ?? -1);
  retiredInDb > 0 && retiredReported === retiredInDb
    ? ok(`the census counts all ${retiredInDb} retired row(s), and governs none of them`)
    : bad(
        "retired rows counted and excluded from the governed set",
        `db=${retiredInDb} reported=${retiredReported}`,
      );

  // Governed counts exclude them: cover + gallery only.
  const governedInDb = Number(
    Bc.scalar("SELECT count(*) FROM public.project_media WHERE media_type IN ('cover','gallery')"),
  );
  const governedReported = Number(/governed rows\s*:\s*(\d+)/.exec(after.out)?.[1] ?? -1);
  governedReported === governedInDb
    ? ok(`the census governs exactly the ${governedInDb} cover/gallery row(s)`)
    : bad("governed count matches the database", `db=${governedInDb} reported=${governedReported}`);

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

console.log(`\n[media-pg] ${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`[media-pg] FAIL — ${failures} failing check(s)`);
  process.exitCode = 1;
} else {
  console.log("[media-pg] PASS");
}
