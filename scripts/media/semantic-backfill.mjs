#!/usr/bin/env node
/**
 * Semantic role backfill controller
 * (FOREVER-SEMANTIC-MEDIA-BACKFILL-001).
 *
 * Writes `public.project_media.semantic_role` onto rows that already exist,
 * from semantic decisions that already exist in local publish packages, matched
 * by recorded evidence only. It writes nothing else, ships no migration, and
 * retires no cover.
 *
 * Three commands:
 *   plan     read-only. Produces the manifest, the exceptions file and a report.
 *   execute  applies a reviewed manifest, one transaction per project.
 *   verify   re-reads the target and runs the census gate over the result.
 *
 * DEFAULT MODE WRITES NOTHING. `plan` never opens a connection when given a
 * snapshot, and `execute` refuses without BOTH `--production` and
 * `--confirm-project-ref abtvsrcnfwlbawvrjeed` typed in full. There is no
 * default connection string and no fallback to an ambient `DATABASE_URL`,
 * `SUPABASE_DB_URL` or `.env` — the failure mode of a convenient default here
 * is a production write somebody meant to aim at a copy.
 *
 * The pure logic is TypeScript under `src/features/forever-semantic-backfill`,
 * loaded through jiti. Nothing is reimplemented here: the classification, the
 * presentation policy and the census rule are the same modules the publish lane
 * and the public readers use, because a second copy of a rule is a second thing
 * to keep correct and only one of them is under test.
 *
 * Exit codes:
 *   0 success                         7 stale approval: package digest
 *   1 verification / census blocked    8 manifest invalid or hand-edited
 *   2 usage error                      9 stale approval: production changed
 *   3 snapshot invalid                10 schema precondition unmet
 *   4 target refused                  11 journal belongs to a different run
 *   5 missing production marker       12 irrecoverable partial state
 *   6 stale approval: policy digest   13 one or more projects failed
 */

import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { createRequire } from "node:module";
import { basename, join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const REPO = process.cwd();

const EXIT = {
  ok: 0,
  blocked: 1,
  usage: 2,
  snapshot: 3,
  target: 4,
  marker: 5,
  policyDigest: 6,
  packageDigest: 7,
  manifest: 8,
  productionChanged: 9,
  schema: 10,
  journal: 11,
  irrecoverable: 12,
  projectFailed: 13,
};

// ---------------------------------------------------------------------------
// Argument handling — bare `--name value`, mirroring role-completeness-report
// ---------------------------------------------------------------------------

/**
 * No `=` form, deliberately: the census gate parses the same way, and two
 * scripts in the same directory that disagree about how a flag is written is a
 * paper cut the Owner hits at exactly the wrong moment.
 */
function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function args(name) {
  const found = [];
  for (let i = 0; i < process.argv.length; i += 1) {
    if (process.argv[i] === `--${name}` && process.argv[i + 1]) found.push(process.argv[i + 1]);
  }
  return found;
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

const HELP = `
semantic-backfill — write project_media.semantic_role onto existing rows
FOREVER-SEMANTIC-MEDIA-BACKFILL-001

  node scripts/media/semantic-backfill.mjs <plan|execute|verify> [flags]

INPUT (exactly one of these two)
  --snapshot <path.json>          read-only capture; no connection is opened
  --database-url "postgres://…"   live target (or FOREVER_SEMANTIC_BACKFILL_DATABASE_URL)

EVIDENCE
  --packages <dir>                root holding package directories
  --package <dir>                 repeatable; one explicit package directory
  --superseded <ref>              repeatable; a package ref produced by a policy
                                  version known to be wrong (hide-only evidence)
  --source-tree <dir>             optional local source tree, indexed by content hash
  --acknowledge <path.json>       operator acknowledgements for restrictive overrides

OUTPUT
  --manifest <path.json>          plan: write here; execute/verify: read here
  --exceptions-out <path.json>    plan: the census-consumable exceptions file
  --exceptions <path.json>        execute/verify: the file to hand the census gate
                                  (normally the very file plan wrote)
  --report <path.txt>             human-readable report
  --journal <path.jsonl>          execute: REQUIRED, no default, must be outside the repo

SELECTION
  --project <slug>                repeatable
  --all                           execute only

SAFETY (all required together before anything is written)
  --execute                       required for ANY write
  --production                    the explicit production marker
  --confirm-project-ref <ref>     must be typed literally: abtvsrcnfwlbawvrjeed
  --disposable-target             required to write to a throwaway cluster
  --dry-run                       BEGIN … ROLLBACK; every check still runs
  --resume                        continue from an existing journal
  --stage before_backfill|after_backfill   passed through to the census gate

No default connection string. The only connection variable read is
FOREVER_SEMANTIC_BACKFILL_DATABASE_URL, and only when --database-url is absent;
nothing else in the environment can name or authorise a target.
There is no --force.
Staging garjibjhlzeljsnpzisu is refused in every mode, including plan
and --dry-run.

A write needs one of two markers and they are mutually exclusive: --production
(with the typed ref) for production, --disposable-target for a cluster that
names no Supabase project. --dry-run does not exempt a run from either: it
issues the real BEGIN and the real UPDATE before it rolls back.
`.trimStart();

function usage(message, code = EXIT.usage) {
  if (message) console.error(`\n${message}\n`);
  console.error(HELP);
  process.exit(code);
}

// ---------------------------------------------------------------------------
// Module loading
// ---------------------------------------------------------------------------

/**
 * jiti resolves relative specifiers and not tsconfig `@/` aliases, which is why
 * every module under `forever-semantic-backfill` imports relatively and why
 * `public-media-policy.ts` was changed to do the same. Run from the repo root:
 * the paths below are joined onto `process.cwd()`.
 */
function loadTs(relativePath) {
  let jiti;
  try {
    jiti = require("jiti")(import.meta.url, { interopDefault: true, esmResolve: true });
  } catch {
    usage("This script loads TypeScript through `jiti`. Install it with:  npm i -D jiti");
  }
  return jiti(join(REPO, relativePath));
}

const FEATURE = "src/features/forever-semantic-backfill";

// ---------------------------------------------------------------------------
// psql — located, never defaulted; password never on argv
// ---------------------------------------------------------------------------

const WINDOWS = process.platform === "win32";

function psqlPath() {
  const explicit = process.env.FOREVER_PG_BIN;
  const candidates = [
    explicit && join(explicit, WINDOWS ? "psql.exe" : "psql"),
    // `FOREVER_PG_BIN` may name a version ROOT rather than a bin directory —
    // the disposable-cluster harness accepts both, and a census that accepted
    // only one of them ENOENTed on a custom install while the harness worked.
    ...(explicit ? [explicit] : []).flatMap((root) => scanForPsql(root)),
    ...(WINDOWS
      ? ["C:/Program Files/PostgreSQL", "C:/Program Files (x86)/PostgreSQL"]
      : ["/usr/lib/postgresql", "/usr/pgsql", "/opt/homebrew/opt"]
    ).flatMap((root) => scanForPsql(root)),
  ].filter(Boolean);
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  return WINDOWS ? "psql.exe" : "psql";
}

function scanForPsql(root) {
  if (!existsSync(root)) return [];
  const { readdirSync } = require("node:fs");
  try {
    return readdirSync(root)
      .sort()
      .reverse()
      .map((entry) => join(root, entry, "bin", WINDOWS ? "psql.exe" : "psql"));
  } catch {
    return [];
  }
}

/** The password goes to PGPASSWORD, never to argv — argv is world-readable. */
function splitCredential(databaseUrl) {
  try {
    const parsed = new URL(databaseUrl);
    if (!parsed.password) return { url: databaseUrl, env: {} };
    const password = decodeURIComponent(parsed.password);
    parsed.password = "";
    return { url: parsed.toString(), env: { PGPASSWORD: password } };
  } catch {
    return { url: databaseUrl, env: {} };
  }
}

function makePsql(databaseUrl, redactSecrets) {
  const { url, env } = splitCredential(databaseUrl);
  const run = (extra, input) => {
    try {
      return execFileSync(
        psqlPath(),
        [url, "-X", "--no-psqlrc", "-v", "ON_ERROR_STOP=1", ...extra],
        {
          encoding: "utf8",
          input,
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env, ...env },
        },
      );
    } catch (error) {
      const detail = redactSecrets(
        `${error?.stdout ?? ""}${error?.stderr ?? ""}${error?.message ?? ""}`,
        databaseUrl,
        url,
      );
      const wrapped = new Error(detail);
      wrapped.psql = true;
      throw wrapped;
    }
  };
  return {
    /** One value. */
    scalar: (sql) => run(["-A", "-t", "-c", sql]).trim(),
    /** Unit-separated rows. */
    rows: (sql) =>
      run(["-A", "-t", "-F", "\u001f", "-c", sql])
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.split("\u001f")),
    /** A whole script through stdin, so no SQL ever appears in the process table. */
    script: (text) => run(["-f", "-"], text),
  };
}

// ---------------------------------------------------------------------------
// Journal — append-only, flushed per record
// ---------------------------------------------------------------------------

function appendJournal(path, line) {
  // Opened, written, fsynced and closed per record. Holding the handle open
  // would be faster and would also mean an interrupted run loses the record it
  // most needs: the one describing the project that was in flight.
  const handle = openSync(path, "a");
  try {
    writeSync(handle, line);
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (flag("help") || flag("h") || process.argv.length <= 2) {
    console.log(HELP);
    process.exit(process.argv.length <= 2 ? EXIT.usage : EXIT.ok);
  }

  const command = process.argv[2];
  // GUARD 1 — a known command. An unknown one must not fall through to a
  // default that happens to be the destructive one.
  if (command !== "plan" && command !== "execute" && command !== "verify") {
    usage(`Unknown command "${command}". Expected plan, execute or verify.`);
  }

  const canonical = loadTs(`${FEATURE}/canonical.ts`);
  const guards = loadTs(`${FEATURE}/guards.ts`);
  const { redactSecrets, assertNoPrivatePaths, canonicalJson } = canonical;

  const snapshotPath = arg("snapshot");
  const databaseUrl = arg("database-url") ?? process.env.FOREVER_SEMANTIC_BACKFILL_DATABASE_URL;
  const manifestPath = arg("manifest");
  const journalPath = arg("journal");
  const selected = args("project");
  const wantsAll = flag("all");
  const execute = flag("execute");
  const dryRun = flag("dry-run");
  const production = flag("production");
  const disposableTarget = flag("disposable-target");
  const confirmRef = arg("confirm-project-ref") ?? null;
  const stage = arg("stage") ?? "after_backfill";

  try {
    // GUARD 2 — flag combinations. Checked before anything is read, so a
    // mistyped run costs nothing.
    if (command === "execute") {
      if (!execute) {
        usage("`execute` requires the explicit --execute flag. Naming the command is not enough.");
      }
      if (!manifestPath) usage("`execute` requires --manifest <path.json>.");
      if (!journalPath) {
        usage(
          "`execute` requires --journal <path.jsonl>. There is no default: a run whose journal " +
            "location was chosen for it cannot be resumed by whoever comes back to it.",
        );
      }
      if (!wantsAll && selected.length === 0) {
        usage("`execute` needs --all or at least one --project <slug>.");
      }
      if (wantsAll && selected.length > 0) usage("--all and --project are mutually exclusive.");
    }
    if (command === "verify" && !manifestPath) usage("`verify` requires --manifest <path.json>.");
    if (command === "plan" && !arg("manifest")) usage("`plan` requires --manifest <path.json>.");
    if (stage !== "before_backfill" && stage !== "after_backfill") {
      usage("--stage must be exactly before_backfill or after_backfill.");
    }

    // GUARD 3 — required outputs, before any work.
    if (command === "plan" && !arg("exceptions-out")) {
      usage(
        "`plan` requires --exceptions-out <path.json>. The exceptions file is not optional " +
          "output: it is the artifact the census gate consumes, and a plan without one cannot " +
          "be turned into release evidence.",
      );
    }
    // ...and they go outside the working tree. The manifest and the report
    // carry every production URL and every classifier reason; neither belongs
    // in a branch, and a path inside the repo is one `git add .` from being
    // published.
    if (command === "plan") {
      guards.assertWritablePath(arg("manifest"), REPO, "The manifest");
      guards.assertWritablePath(arg("exceptions-out"), REPO, "The exceptions file");
      if (arg("report")) guards.assertWritablePath(arg("report"), REPO, "The report");
    }

    // GUARD 4 — ambient credentials, named but never read.
    guards.assertNoAmbientCredentials(process.env, Boolean(snapshotPath || databaseUrl));

    // GUARD 5 — exactly one input source.
    if (snapshotPath && databaseUrl) {
      usage(
        "--snapshot and --database-url are mutually exclusive. Two sources of truth for what " +
          "production contains means the plan could be built against one and applied against " +
          "the other.",
      );
    }
    if (command === "plan" && !snapshotPath && !databaseUrl) {
      usage("`plan` needs --snapshot <path.json> or --database-url.");
    }
    if ((command === "execute" || command === "verify") && !databaseUrl) {
      usage(`\`${command}\` needs --database-url (or FOREVER_SEMANTIC_BACKFILL_DATABASE_URL).`);
    }

    // GUARD 6 — the snapshot parses and says which database it describes.
    const snapshotModule = loadTs(`${FEATURE}/production-snapshot.ts`);
    let snapshot = null;
    if (snapshotPath) {
      if (!existsSync(snapshotPath)) usage(`Snapshot not found: ${basename(snapshotPath)}`);
      try {
        snapshot = snapshotModule.parseProductionSnapshot(
          JSON.parse(readFileSync(snapshotPath, "utf8")),
        );
      } catch (error) {
        console.error(`[semantic-backfill] snapshot invalid: ${redactSecrets(error?.message)}`);
        process.exit(EXIT.snapshot);
      }
    }

    // GUARD 7 — the journal lives outside the repository.
    if (journalPath) guards.assertJournalOutsideRepo(journalPath, REPO);

    // GUARD 8/9/10 — the target. Staging is refused here, before anything
    // opens a connection: "we connected read-only and then refused" is still a
    // run that contacted a database it was told never to contact.
    // The ref is read out of the connection string, never out of the
    // environment. `SUPABASE_URL` is deliberately not consulted: the Owner's
    // credentials file exports it as production, and an earlier version let that
    // decide the ref — so a --database-url naming staging passed the staging
    // refusal, and --production authorised a write to whatever the string really
    // pointed at. A snapshot ref is used only when there is no connection at all.
    guards.assertTargetRefsAgree(snapshot?.projectRef, databaseUrl);
    const ref = guards.refFromTarget({
      snapshotRef: snapshot?.projectRef,
      databaseUrl,
    });
    guards.assertTargetPermitted(ref, {
      production,
      confirmRef,
      disposableTarget,
      // `--dry-run` still opens the transaction, so it is still a write-shaped
      // contact with the target and is authorised as one.
      opensTransaction: command === "execute",
    });

    if (command === "plan") {
      await runPlan({
        snapshot,
        databaseUrl,
        ref,
        canonical,
        snapshotModule,
        redactSecrets,
        assertNoPrivatePaths,
        canonicalJson,
      });
      return;
    }

    await runAgainstDatabase({
      command,
      databaseUrl,
      ref,
      manifestPath,
      journalPath,
      selected,
      wantsAll,
      dryRun,
      stage,
      canonical,
      snapshotModule,
      redactSecrets,
    });
  } catch (error) {
    if (error && error.name === "GuardError") {
      console.error(`[semantic-backfill] ${error.code}: ${error.message}`);
      process.exit(error.exitCode);
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// plan
// ---------------------------------------------------------------------------

function readPolicyInputs(fingerprints) {
  return fingerprints.POLICY_INPUT_FILES.map((path) => ({
    path,
    contents: readFileSync(join(REPO, path), "utf8"),
  }));
}

function packageDirectories() {
  const explicit = args("package").map((path) => resolve(path));
  const root = arg("packages");
  if (!root) return explicit;
  const { readdirSync, statSync } = require("node:fs");
  if (!existsSync(root)) usage(`--packages directory not found: ${basename(root)}`);
  const discovered = readdirSync(root)
    .map((entry) => join(resolve(root), entry))
    .filter((path) => {
      try {
        return statSync(path).isDirectory();
      } catch {
        return false;
      }
    });
  return [...new Set([...explicit, ...discovered])].sort();
}

/**
 * Which slug a package directory belongs to.
 *
 * Read from the package's own payload, never from the directory name. A
 * directory can be renamed; the payload's slug is what the publish lane used to
 * build the object path, and the object path is the join key.
 */
function slugOfPackage(directory) {
  for (const candidate of ["progressive/payload.json", "payload.json"]) {
    const path = join(directory, candidate);
    if (!existsSync(path)) continue;
    try {
      const payload = JSON.parse(readFileSync(path, "utf8"));
      const slug = payload?.project?.slug ?? payload?.slug;
      if (typeof slug === "string" && slug) return slug;
    } catch {
      /* fall through to the manifest */
    }
  }
  const manifestPath = join(directory, "source-manifest.json");
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      const slug = manifest?.slug ?? manifest?.project_slug;
      if (typeof slug === "string" && slug) return slug;
    } catch {
      /* nothing else to read */
    }
  }
  return null;
}

async function runPlan(context) {
  const { snapshot, databaseUrl, ref, redactSecrets, assertNoPrivatePaths, canonicalJson } =
    context;
  const fingerprints = loadTs(`${FEATURE}/fingerprints.ts`);
  const evidenceModule = loadTs(`${FEATURE}/package-evidence.ts`);
  const planModule = loadTs(`${FEATURE}/plan.ts`);
  const validateModule = loadTs(`${FEATURE}/manifest-validate.ts`);
  const exceptionsModule = loadTs(`${FEATURE}/exceptions.ts`);

  let effective = snapshot;
  if (!effective) {
    // A live plan still reads only. Same statement shape the census uses.
    const psql = makePsql(databaseUrl, redactSecrets);
    effective = readSnapshotFromDatabase(psql, ref, context.snapshotModule);
  }

  const superseded = new Set(args("superseded"));
  const sourceTreeRoot = arg("source-tree") ? resolve(arg("source-tree")) : null;
  const directories = packageDirectories();
  const bySlug = new Map();
  for (const directory of directories) {
    const slug = slugOfPackage(directory);
    if (!slug) continue;
    const list = bySlug.get(slug) ?? [];
    list.push(directory);
    bySlug.set(slug, list);
  }

  const evidenceBySlug = new Map();
  for (const project of effective.projects) {
    const dirs = bySlug.get(project.slug) ?? [];
    if (dirs.length === 0) {
      evidenceBySlug.set(project.slug, []);
      continue;
    }
    evidenceBySlug.set(
      project.slug,
      await evidenceModule.resolvePackageEvidence({
        slug: project.slug,
        packageDirectories: dirs,
        supersededPackageRefs: superseded,
        localSourceTreeDir: sourceTreeRoot ? join(sourceTreeRoot, project.slug) : null,
      }),
    );
  }

  const policy = fingerprints.policyDigest(readPolicyInputs(fingerprints));
  const acknowledgements = arg("acknowledge")
    ? JSON.parse(readFileSync(arg("acknowledge"), "utf8"))
    : [];

  const manifest = planModule.buildBackfillManifest({
    snapshot: effective,
    evidenceBySlug,
    policy,
    generatorCommit: gitHead(),
    // The only clock reading in the run, passed in rather than taken inside the
    // planner: a `new Date()` in a pure function makes every plan differ from
    // every other plan and the digest guard stops meaning anything.
    generatedAt: new Date().toISOString(),
    acknowledgements,
  });

  const issues = validateModule.validateBackfillManifest(manifest);
  const report = formatReport(manifest, issues, validateModule);

  const manifestText = canonicalJson(manifest);
  assertNoPrivatePaths(manifestText, "The manifest");
  assertNoPrivatePaths(report, "The report");

  writeFileSync(arg("manifest"), manifestText, "utf8");
  exceptionsModule.writeExceptionsFile(arg("exceptions-out"), manifest.exceptions);
  if (arg("report")) writeFileSync(arg("report"), `${report}\n`, "utf8");

  console.log(report);
  console.log("");
  console.log("[semantic-backfill] plan complete. NOTHING WAS WRITTEN to any database.");
  console.log(`[semantic-backfill] manifest    : ${basename(arg("manifest"))}`);
  console.log(`[semantic-backfill] exceptions  : ${basename(arg("exceptions-out"))}`);
  console.log(
    `[semantic-backfill] hand the exceptions file to the gate unchanged:\n` +
      `    npm run media:role-census -- --database-url "…" --stage after_backfill ` +
      `--exceptions ${basename(arg("exceptions-out"))}`,
  );

  if (issues.length > 0) process.exit(EXIT.manifest);
  process.exit(EXIT.ok);
}

function gitHead() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: REPO,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

// ---------------------------------------------------------------------------
// Reading the target
// ---------------------------------------------------------------------------

const SNAPSHOT_SQL = `
  SELECT p.id::text, p.slug, coalesce(p.name,''), p.is_active::text, coalesce(p.public_status,''),
         coalesce(p.main_image_url,''), m.media_type, m.url, m.sort_order::text,
         coalesce(m.semantic_role,'')
    FROM public.project_media m
    JOIN public.projects p ON p.id = m.project_id
   WHERE p.is_active AND p.public_status = 'published'
   ORDER BY p.slug COLLATE "C", m.media_type COLLATE "C", m.url COLLATE "C", m.sort_order
`;

/** The same statement without `semantic_role`, for a target where it is absent. */
const SNAPSHOT_SQL_NO_ROLE = SNAPSHOT_SQL.replace("coalesce(m.semantic_role,'')", "''::text");

function readSnapshotFromDatabase(psql, ref, snapshotModule) {
  const hasRole =
    psql
      .scalar(
        `SELECT count(*) FROM information_schema.columns
          WHERE table_schema='public' AND table_name='project_media' AND column_name='semantic_role'`,
      )
      .trim() !== "0";
  const rows = psql.rows(hasRole ? SNAPSHOT_SQL : SNAPSHOT_SQL_NO_ROLE);
  const snapshot = snapshotModule.snapshotFromPsqlRows(
    rows.map((row) => ({
      project_id: row[0],
      slug: row[1],
      name: row[2],
      is_active: row[3],
      public_status: row[4],
      main_image_url: row[5] || null,
      media_type: row[6],
      url: row[7],
      sort_order: Number(row[8]),
      semantic_role: hasRole ? row[9] || null : null,
    })),
    ref ?? "",
  );
  snapshot.semanticRoleColumnPresent = hasRole;
  return snapshot;
}

// ---------------------------------------------------------------------------
// execute / verify
// ---------------------------------------------------------------------------

async function runAgainstDatabase(context) {
  const {
    command,
    databaseUrl,
    ref,
    manifestPath,
    journalPath,
    selected,
    wantsAll,
    dryRun,
    stage,
    redactSecrets,
    snapshotModule,
  } = context;

  const fingerprints = loadTs(`${FEATURE}/fingerprints.ts`);
  const validateModule = loadTs(`${FEATURE}/manifest-validate.ts`);
  const applyModule = loadTs(`${FEATURE}/apply-plan.ts`);
  const journalModule = loadTs(`${FEATURE}/journal.ts`);
  const acceptanceModule = loadTs(`${FEATURE}/acceptance.ts`);
  const evidenceModule = loadTs(`${FEATURE}/package-evidence.ts`);

  if (!existsSync(manifestPath)) usage(`Manifest not found: ${basename(manifestPath)}`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

  // GUARD 11 — the policy has not moved since the review. A policy edit changes
  // what a role means; the Villa Kirara sheets legitimately went from
  // villa_exterior to plan when the slug-word defect was fixed.
  const policy = fingerprints.policyDigest(readPolicyInputs(fingerprints));
  if (policy.digest !== manifest.digests.policy_digest) {
    console.error(
      `[semantic-backfill] policy_digest mismatch. The classification or presentation policy ` +
        `changed after this plan was approved, so the same URL may now warrant a different ` +
        `role. Re-plan and re-review; there is no --force.`,
    );
    process.exit(EXIT.policyDigest);
  }

  // GUARD 12 — the local evidence has not moved. Skipped only when no package
  // root was supplied, and said out loud rather than passed silently.
  const directories = packageDirectories();
  if (directories.length > 0) {
    const superseded = new Set(args("superseded"));
    const sourceTreeRoot = arg("source-tree") ? resolve(arg("source-tree")) : null;
    const sets = [];
    for (const project of manifest.projects) {
      const dirs = directories.filter((directory) => slugOfPackage(directory) === project.slug);
      if (dirs.length === 0) continue;
      sets.push(
        ...(await evidenceModule.resolvePackageEvidence({
          slug: project.slug,
          packageDirectories: dirs,
          supersededPackageRefs: superseded,
          localSourceTreeDir: sourceTreeRoot ? join(sourceTreeRoot, project.slug) : null,
        })),
      );
    }
    const digest = fingerprints.packageStateDigest(sets);
    if (digest !== manifest.digests.package_state_digest) {
      console.error(
        `[semantic-backfill] package_state_digest mismatch. A package was regenerated or edited ` +
          `after this plan was approved. Re-plan and re-review.`,
      );
      process.exit(EXIT.packageDigest);
    }
  } else {
    console.log(
      "[semantic-backfill] note: no --packages/--package given, so package_state_digest was not " +
        "re-verified. The manifest body digest still covers every proposed role and reason.",
    );
  }

  // GUARD 13 — the file is the file that was reviewed, and it is internally safe.
  const bodyDigest = fingerprints.manifestBodyDigest(manifest);
  if (bodyDigest !== manifest.digests.manifest_body_digest) {
    console.error(
      `[semantic-backfill] manifest_body_digest mismatch — the manifest was edited after it was ` +
        `generated. Even a reworded classifier reason invalidates the approval: the reasons are ` +
        `the reviewable part.`,
    );
    process.exit(EXIT.manifest);
  }
  const issues = validateModule.validateBackfillManifest(manifest);
  if (issues.length > 0) {
    console.error(
      `[semantic-backfill] manifest invalid:\n${validateModule.formatValidationIssues(issues)}`,
    );
    process.exit(EXIT.manifest);
  }

  // ===================== GUARD 14 — CONNECTION OPENED =====================
  const psql = makePsql(databaseUrl, redactSecrets);

  // GUARD 15 — schema preconditions. Without the column there is nothing to
  // write; without the CHECK constraint a wrong value reaches two public
  // readers; without the function this lane has no permitted write at all.
  const schema = psql
    .rows(
      `SELECT (SELECT count(*) FROM information_schema.columns
                WHERE table_schema='public' AND table_name='project_media'
                  AND column_name='semantic_role')::text,
              (SELECT count(*) FROM pg_constraint
                WHERE conname = 'project_media_semantic_role_vocabulary')::text,
              (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname='public'
                  AND p.proname IN ('forever_project_media_semantic_projection',
                                    'forever_project_cover_reconcile',
                                    'forever_project_cover_withdraw'))::text`,
    )
    .at(0) ?? ["0", "0", "0"];
  if (schema[0] === "0" || schema[1] === "0" || Number(schema[2]) < 3) {
    console.error(
      `[semantic-backfill] schema precondition unmet: semantic_role column=${schema[0]}, ` +
        `vocabulary CHECK=${schema[1]}, functions=${schema[2]}/3. Apply ` +
        `20260728120000_project_media_semantic_role.sql — and if ` +
        `20260723130000_public_projection_privacy.sql is still pending, apply it BEFORE it: its ` +
        `table-level REVOKE removes the column grant too, and both public projections then 42703.`,
    );
    process.exit(EXIT.schema);
  }

  const live = readSnapshotFromDatabase(psql, ref, snapshotModule);

  // GUARD 16 — the structure is exactly what was planned against. Compared
  // exactly and never three ways: a new row, a moved URL or a retired cover
  // means the plan describes a database that no longer exists.
  const structure = fingerprints.productionStructureDigest(live);
  if (structure !== manifest.digests.production_structure_digest) {
    console.error(
      `[semantic-backfill] production_structure_digest mismatch. Rows were added, removed or ` +
        `moved in the target since this plan was built. Re-capture, re-plan, re-review.`,
    );
    process.exit(EXIT.productionChanged);
  }

  const chosen = manifest.projects.filter(
    (project) => wantsAll || selected.includes(project.slug) || command === "verify",
  );
  if (chosen.length === 0) {
    usage(`No project in the manifest matches ${selected.join(", ")}.`);
  }

  // GUARD 17 — per project, three ways. "Already applied" is a legitimate
  // outcome and not a failure: a resumed or repeated run must be able to say so
  // rather than refusing or, worse, writing again.
  const state = new Map();
  for (const project of chosen) {
    const observed = fingerprints.productionRoleDigest(
      snapshotModule.rowsForProject(live, project.project_id),
    );
    if (observed === project.role_digest_before) state.set(project.project_id, "pending");
    else if (observed === project.role_digest_expected_after)
      state.set(project.project_id, "applied");
    else state.set(project.project_id, "drifted");
  }
  const drifted = chosen.filter((project) => state.get(project.project_id) === "drifted");
  if (drifted.length > 0) {
    console.error(
      `[semantic-backfill] role digest drifted for: ${drifted.map((p) => p.slug).join(", ")}. ` +
        `These projects hold roles that are neither the planned pre-state nor the planned ` +
        `post-state, so something else wrote to them. Re-plan.`,
    );
    process.exit(EXIT.productionChanged);
  }

  if (command === "verify") {
    return runVerify({ manifest, live, chosen, psql, stage, acceptanceModule, snapshotModule });
  }

  // GUARD 18 — the journal belongs to this run.
  const runId = manifest.digests.idempotency_key;
  const existing = existsSync(journalPath)
    ? journalModule.parseJournal(readFileSync(journalPath, "utf8").split("\n"))
    : [];
  const resume = journalModule.classifyResume(existing, runId, manifest);
  if (resume.foreignRunId) {
    console.error(
      `[semantic-backfill] the journal at ${basename(journalPath)} belongs to a different run. ` +
        `Its run_id folds in the target ref, so merging it into this run could apply one plan's ` +
        `record to another plan's database. Use a new journal path.`,
    );
    process.exit(EXIT.journal);
  }
  if (existing.length > 0 && !flag("resume")) {
    console.error(
      `[semantic-backfill] ${basename(journalPath)} already holds ${existing.length} record(s). ` +
        `Pass --resume to continue it, or choose a new path. Appending to a journal without ` +
        `saying so is how two runs become one unreadable record.`,
    );
    process.exit(EXIT.journal);
  }

  const now = () => new Date().toISOString();
  appendJournal(
    journalPath,
    journalModule.serialiseJournalRecord({
      record: "run_opened",
      at: now(),
      run_id: runId,
      schema_version: journalModule.JOURNAL_SCHEMA_VERSION,
      project_ref: manifest.target.project_ref,
      mode: dryRun ? "dry_run" : "execute",
      controller_commit: gitHead(),
      manifest_basename: basename(manifestPath),
      digests: manifest.digests,
      projects_selected: chosen.map((project) => project.slug),
    }),
  );

  const relations = readRelationPresence(psql, applyModule);
  // A dry run's projects are counted separately from a real run's. One counter
  // serving both branches made a dry run close its journal with
  // `projects_committed: 11` for eleven projects it had rolled back — the
  // per-project records were right, but the summary line of the release record
  // read as though the write had happened. Same family of mistake as recording a
  // dry run as `project_committed`, and worth the extra variable for the same
  // reason: the journal is read by whoever comes back to it later.
  let committed = 0;
  let dryRunOnly = 0;
  let skipped = 0;
  let failed = 0;
  const verdicts = [];

  for (const project of chosen) {
    const priorState = resume.perProject.get(project.project_id);

    if (priorState === "crashed_mid_project") {
      // Never assume a rollback. The process can also die AFTER the COMMIT and
      // BEFORE the append.
      const liveDigest = psql.scalar(
        applyModule.PROJECT_ROLE_DIGEST_SQL.replace(/\$1::uuid/g, `'${project.project_id}'::uuid`),
      );
      const outcome = journalModule.classifyCrashedProject(
        liveDigest,
        project.role_digest_before,
        project.role_digest_expected_after,
      );
      if (outcome === "partial_irrecoverable") {
        console.error(
          `[semantic-backfill] ${project.slug} holds roles that neither the planned pre-state nor ` +
            `the planned post-state predicts. A single transaction cannot produce that, so ` +
            `something outside this run wrote to it. Stopping: no repair is attempted, because a ` +
            `repair would be a second unreviewed write on top of an unexplained one.`,
        );
        process.exit(EXIT.irrecoverable);
      }
      if (outcome === "committed") {
        appendJournal(
          journalPath,
          journalModule.serialiseJournalRecord({
            record: "project_committed",
            at: now(),
            run_id: runId,
            project_id: project.project_id,
            slug: project.slug,
            project_plan_digest: planDigest(
              project,
              applyModule,
              loadTs(`${FEATURE}/canonical.ts`),
            ),
            rows_updated: project.project_totals.rows_to_update,
            rpc_applied: project.project_totals.rows_to_update,
            role_digest_observed_after: liveDigest,
            business_invariant_digest: "not_recomputed_after_crash_recovery",
            verified: true,
            recovered_from_crash: true,
          }),
        );
        committed += 1;
        verdicts.push(`${project.slug}: recovered — the commit had landed before the crash`);
        continue;
      }
      // rolled_back — fall through and retry normally.
    }

    if (state.get(project.project_id) === "applied" || priorState === "committed") {
      appendJournal(
        journalPath,
        journalModule.serialiseJournalRecord({
          record: "project_skipped",
          at: now(),
          run_id: runId,
          project_id: project.project_id,
          slug: project.slug,
          reason: "already_applied_idempotent",
        }),
      );
      skipped += 1;
      verdicts.push(`${project.slug}: already applied — 0 rows updated`);
      continue;
    }

    const digest = planDigest(project, applyModule, loadTs(`${FEATURE}/canonical.ts`));
    appendJournal(
      journalPath,
      journalModule.serialiseJournalRecord({
        record: "project_started",
        at: now(),
        run_id: runId,
        project_id: project.project_id,
        slug: project.slug,
        project_plan_digest: digest,
        planned_updates: project.project_totals.rows_to_update,
        planned_exceptions: manifest.exceptions.filter((e) => e.projectSlug === project.slug)
          .length,
        role_digest_before: project.role_digest_before,
        role_digest_expected_after: project.role_digest_expected_after,
      }),
    );

    try {
      const output = psql.script(applyModule.projectApplyScript(project, { dryRun, relations }));
      // The marker comes from a SELECT, so it is on stdout. It used to come only
      // from the block's RAISE NOTICE, which psql writes to stderr — so this
      // test never matched and every project that actually wrote was recorded as
      // failed and rolled back, after its COMMIT had landed.
      if (!output.includes(applyModule.APPLY_MARKER)) {
        throw new Error(`the transaction did not report ${applyModule.APPLY_MARKER}`);
      }
      // A dry run gets its OWN record type. Recording it as `project_committed`
      // with rows_updated: 0 was enough to make the very next real run skip the
      // project as "already applied" — the resume classifier reads the record
      // name, not the count. See ProjectDryRun in journal.ts.
      appendJournal(
        journalPath,
        journalModule.serialiseJournalRecord(
          dryRun
            ? {
                record: "project_dry_run",
                at: now(),
                run_id: runId,
                project_id: project.project_id,
                slug: project.slug,
                project_plan_digest: digest,
                rows_updated: 0,
                rpc_applied: project.project_totals.rows_to_update,
                role_digest_observed_after: project.role_digest_before,
                business_invariant_digest: "unchanged_asserted_in_transaction",
                verified: true,
              }
            : {
                record: "project_committed",
                at: now(),
                run_id: runId,
                project_id: project.project_id,
                slug: project.slug,
                project_plan_digest: digest,
                rows_updated: project.project_totals.rows_to_update,
                rpc_applied: project.project_totals.rows_to_update,
                role_digest_observed_after: project.role_digest_expected_after,
                business_invariant_digest: "unchanged_asserted_in_transaction",
                verified: true,
                recovered_from_crash: false,
              },
        ),
      );
      if (dryRun) dryRunOnly += 1;
      else committed += 1;
      verdicts.push(
        `${project.slug}: ${dryRun ? "dry run — rolled back" : "committed"}, ` +
          `${project.project_totals.rows_to_update} row(s)`,
      );
    } catch (error) {
      // One failure must not skip the others, and must not skip THEIR
      // verification. A run that stops at the first error leaves the operator
      // with no statement about the projects that did succeed.
      appendJournal(
        journalPath,
        journalModule.serialiseJournalRecord({
          record: "project_failed",
          at: now(),
          run_id: runId,
          project_id: project.project_id,
          slug: project.slug,
          project_plan_digest: digest,
          error_code: error?.psql ? "transaction_aborted" : "controller_error",
          error_message_redacted: redactSecrets(error?.message, databaseUrl).slice(0, 800),
          rolled_back: true,
        }),
      );
      failed += 1;
      verdicts.push(
        `${project.slug}: FAILED and rolled back — ${redactSecrets(error?.message).slice(0, 200)}`,
      );
    }
  }

  const after = readSnapshotFromDatabase(psql, ref, snapshotModule);
  const gate = runCensusGate(databaseUrl, stage);
  for (const line of verdicts) console.log(`[semantic-backfill] ${line}`);
  reportAcceptance(manifest, after, chosen, acceptanceModule, snapshotModule);

  appendJournal(
    journalPath,
    journalModule.serialiseJournalRecord({
      record: "run_closed",
      at: now(),
      run_id: runId,
      projects_committed: committed,
      projects_dry_run_only: dryRunOnly,
      projects_skipped: skipped,
      projects_failed: failed,
      projects_never_attempted: manifest.projects.length - chosen.length,
      verification_ran: true,
      gate_exit_code: gate.code,
    }),
  );

  console.log(gate.out);
  if (failed > 0) process.exit(EXIT.projectFailed);
  process.exit(gate.code === 0 ? EXIT.ok : EXIT.blocked);
}

function planDigest(project, applyModule, canonical) {
  return canonical.sha256Hex(applyModule.projectPlanDigestInput(project));
}

function readRelationPresence(psql, applyModule) {
  const row = psql.rows(applyModule.RELATION_PRESENCE_SQL).at(0) ?? [];
  const yes = (value) => value === "t" || value === "true";
  return {
    units: yes(row[0]),
    unitPriceHistory: yes(row[1]),
    buildings: yes(row[2]),
    projects: yes(row[3]),
    projectMedia: yes(row[4]),
  };
}

function runVerify(context) {
  const { manifest, live, chosen, psql, stage, acceptanceModule, snapshotModule } = context;
  void psql;
  reportAcceptance(manifest, live, chosen, acceptanceModule, snapshotModule);

  // Expiry is enforced here because the gate has no concept of time: an expired
  // exception excuses its row forever, and this is the only place that can say
  // so before the release record is written.
  const expired = manifest.exceptions.filter(
    (entry) =>
      entry.expiresAfterRelease &&
      entry.expiresAfterRelease !== "FOREVER-SEMANTIC-MEDIA-BACKFILL-001",
  );
  for (const entry of expired) {
    console.log(
      `[semantic-backfill] EXPIRED exception ${entry.projectSlug} ${entry.url} — written for ` +
        `${entry.expiresAfterRelease}, which has shipped. The gate does not honour expiry; this does.`,
    );
  }
  for (const entry of manifest.exceptions) {
    console.log(
      `[semantic-backfill] re-evaluate when: ${entry.projectSlug} — ${entry.reEvaluateWhen}`,
    );
  }

  const gate = runCensusGate(
    arg("database-url") ?? process.env.FOREVER_SEMANTIC_BACKFILL_DATABASE_URL,
    stage,
  );
  console.log(gate.out);
  if (expired.length > 0) process.exit(EXIT.blocked);
  process.exit(gate.code === 0 ? EXIT.ok : EXIT.blocked);
}

function reportAcceptance(manifest, snapshot, chosen, acceptanceModule, snapshotModule) {
  for (const project of chosen) {
    const rows = snapshotModule
      .rowsForProject(snapshot, project.project_id)
      .map((row) => ({ mediaType: row.mediaType, url: row.url, semanticRole: row.semanticRole }));
    const live = snapshot.projects.find((entry) => entry.projectId === project.project_id);
    const results = acceptanceModule.evaluateProjectAcceptance(
      project,
      rows,
      live?.mainImageUrl ?? null,
      new Set(
        manifest.exceptions
          .filter((entry) => entry.projectSlug === project.slug)
          .map((entry) => entry.url),
      ),
    );
    for (const result of results) {
      console.log(
        `[acceptance] ${result.verdict.toUpperCase().padEnd(13)} ${result.id} — ${result.observed}`,
      );
    }
  }
}

/**
 * The census gate, run as its own process against the same target.
 *
 * Spawned rather than imported: it is the artifact the release record cites,
 * and citing a function call made inside another tool is not the same evidence
 * as running the tool the Owner would run.
 */
function runCensusGate(databaseUrl, stage) {
  const exceptions = arg("exceptions-out") ?? arg("exceptions");
  try {
    const out = execFileSync(
      process.execPath,
      [
        join(REPO, "scripts/media/role-completeness-report.mjs"),
        "--database-url",
        databaseUrl,
        "--stage",
        stage,
        ...(exceptions ? ["--exceptions", exceptions] : []),
      ],
      { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { code: 0, out };
  } catch (error) {
    return { code: error?.status ?? 1, out: `${error?.stdout ?? ""}${error?.stderr ?? ""}` };
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function formatReport(manifest, issues, validateModule) {
  const lines = [];
  lines.push("[semantic-backfill] FOREVER-SEMANTIC-MEDIA-BACKFILL-001");
  lines.push(`target          : ${manifest.target.project_ref}`);
  lines.push(`refuses         : ${manifest.target.refuses_project_refs.join(", ")}`);
  lines.push(`schema          : ${manifest.schema_version}`);
  lines.push(`idempotency key : ${manifest.digests.idempotency_key}`);
  lines.push(`policy digest   : ${manifest.digests.policy_digest}`);
  lines.push(`package digest  : ${manifest.digests.package_state_digest}`);
  lines.push(`structure digest: ${manifest.digests.production_structure_digest}`);
  lines.push(`planned digest  : ${manifest.digests.planned_change_digest}`);
  lines.push(`body digest     : ${manifest.digests.manifest_body_digest}`);
  lines.push("");
  lines.push(
    `projects ${manifest.totals.projects}   rows ${manifest.totals.rows}   ` +
      `rows to update ${manifest.totals.rows_to_update}   exceptions ${manifest.totals.exceptions}`,
  );
  lines.push("");
  for (const project of manifest.projects) {
    const totals = project.project_totals;
    lines.push(`${project.slug}`);
    lines.push(
      `  rows ${totals.rows}  urls ${totals.urls}  to update ${totals.rows_to_update}  ` +
        `role-less ${totals.rows_left_role_less}  leaving a surface ${totals.rows_leaving_a_public_surface}`,
    );
    const roles = Object.keys(totals.proposed_roles).sort();
    if (roles.length > 0) {
      lines.push(
        `  roles: ${roles.map((role) => `${role}=${totals.proposed_roles[role]}`).join(" ")}`,
      );
    }
    if (project.retirement_candidates.length > 0) {
      for (const candidate of project.retirement_candidates) {
        lines.push(
          `  retirement candidate (NOT retired): ${candidate.url} — ${candidate.handled_by}`,
        );
      }
    }
    lines.push(
      `  role digest before / after: ${project.role_digest_before} / ${project.role_digest_expected_after}`,
    );
  }
  if (manifest.review_required.length > 0) {
    lines.push("");
    lines.push("REVIEW REQUIRED — a conflict resolved to a role that removes an image:");
    for (const entry of manifest.review_required) {
      lines.push(`  ${entry.project_slug} ${entry.url} — ${entry.why}`);
    }
  }
  if (manifest.exceptions.length > 0) {
    lines.push("");
    lines.push("WRITTEN EXCEPTIONS — rows left role-less, each with a reason:");
    for (const entry of manifest.exceptions) {
      lines.push(`  ${entry.projectSlug} ${entry.url}`);
      lines.push(`    ${entry.reasonCode}`);
    }
  }
  lines.push("");
  lines.push(
    issues.length === 0
      ? "MANIFEST VALID — nothing was written to any database by this command."
      : `MANIFEST INVALID:\n${validateModule.formatValidationIssues(issues)}`,
  );
  return lines.join("\n");
}

main().catch((error) => {
  // Redacted, always. execFileSync puts the full argv into the message it
  // throws, and that argv used to carry the password verbatim.
  const supplied = arg("database-url") ?? process.env.FOREVER_SEMANTIC_BACKFILL_DATABASE_URL ?? "";
  let detail;
  try {
    const { redactSecrets } = loadTs(`${FEATURE}/canonical.ts`);
    detail = redactSecrets(error?.stack ?? error?.message ?? error, supplied);
  } catch {
    detail = String(error?.message ?? error)
      .split(supplied || "\u0000")
      .join("<redacted>");
  }
  console.error(`[semantic-backfill] FAILED: ${detail}`);
  process.exit(EXIT.usage);
});
