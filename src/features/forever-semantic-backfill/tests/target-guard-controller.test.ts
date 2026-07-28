/**
 * The target guards, exercised through the controller rather than around it
 * (FOREVER-SEMANTIC-MEDIA-RELEASE-PREP-001).
 *
 * `guards.test.ts` proves the rules. These prove the RUNNER applies them, which
 * is a different claim and is the one the original defect falsified: the rules
 * were fine and the runner asked them about the wrong thing. It consulted
 * `process.env.SUPABASE_URL` to decide which database it was talking to, so in
 * the Owner's normal shell — where that variable is exported as production — a
 * `--database-url` naming staging sailed past the staging refusal and
 * `--production` authorised a write to whatever the connection string really
 * pointed at.
 *
 * The fix was to derive the ref from the connection string, and a module-level
 * test cannot observe it, because the fix is that a field no longer exists. So
 * every case below sets a deliberately CONTRADICTORY ambient environment and
 * asserts the refusal names the target the connection string points at.
 *
 * NOTHING HERE CONTACTS ANYTHING. Every case is a refusal, and every refusal
 * happens before a client is created. The one permitted-write case — production
 * plus both markers — is deliberately NOT exercised here: proving it at the CLI
 * would mean opening a socket to production. It is proved at module level in
 * `guards.test.ts` ("permits the fully confirmed production write").
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { PRODUCTION_PROJECT_REF, STAGING_PROJECT_REF } from "../guards";

const REPO = process.cwd();
const CONTROLLER = join(REPO, "scripts/media/semantic-backfill.mjs");

const roots: string[] = [];
function tempDir(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `forever-target-${tag}-`));
  roots.push(dir);
  return dir;
}
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const stagingUrl = `postgres://u:p@db.${STAGING_PROJECT_REF}.supabase.co:5432/postgres`;
const productionUrl = `postgres://u:p@db.${PRODUCTION_PROJECT_REF}.supabase.co:5432/postgres`;
const refLessUrl = "postgres://postgres:p@10.42.0.7:5432/postgres";

/**
 * Run the controller with an ambient environment that DISAGREES with the target.
 *
 * `ambientRef` is written into every variable an operator's credentials file
 * realistically exports. If any of them could still decide the target, one of
 * these cases would name the wrong database in its refusal.
 */
function runController(args: string[], ambientRef: string | null) {
  const ambient = ambientRef
    ? {
        SUPABASE_URL: `https://${ambientRef}.supabase.co`,
        NEXT_PUBLIC_SUPABASE_URL: `https://${ambientRef}.supabase.co`,
        VITE_SUPABASE_URL: `https://${ambientRef}.supabase.co`,
        SUPABASE_PROJECT_REF: ambientRef,
      }
    : {};
  const result = spawnSync(process.execPath, [CONTROLLER, ...args], {
    cwd: REPO,
    encoding: "utf8",
    env: { ...process.env, ...ambient, FOREVER_SEMANTIC_BACKFILL_DATABASE_URL: "" },
  });
  return { ...result, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

function executeArgs(databaseUrl: string, journal: string, extra: string[] = []) {
  return [
    "execute",
    "--execute",
    "--all",
    "--manifest",
    join(tmpdir(), "forever-target-manifest-that-does-not-exist.json"),
    "--journal",
    journal,
    "--database-url",
    databaseUrl,
    ...extra,
  ];
}

// ---------------------------------------------------------------------------
// 1 & 2. Ambient text never decides the target
// ---------------------------------------------------------------------------

describe("1. ambient production, connection to staging", () => {
  it("refuses as staging, opens no transaction and writes no journal", () => {
    const journal = join(tempDir("j1"), "journal.jsonl");
    const result = runController(executeArgs(stagingUrl, journal), PRODUCTION_PROJECT_REF);

    expect(result.status).toBe(4);
    expect(result.output).toContain("target_is_staging");
    expect(result.output).toContain(STAGING_PROJECT_REF);
    expect(existsSync(journal)).toBe(false);
    expect(result.output).not.toContain("run_opened");
  });

  it("refuses staging in plan mode too, where nothing would have been written anyway", () => {
    const out = tempDir("j1b");
    const result = runController(
      [
        "plan",
        "--database-url",
        stagingUrl,
        "--manifest",
        join(out, "m.json"),
        "--exceptions-out",
        join(out, "e.json"),
      ],
      PRODUCTION_PROJECT_REF,
    );
    // A read-only plan against staging still produces an artifact whose digests
    // describe staging. Refusing at the source removes the file entirely.
    expect(result.status).toBe(4);
    expect(result.output).toContain("target_is_staging");
    expect(existsSync(join(out, "m.json"))).toBe(false);
  });
});

describe("2. ambient staging, connection to production", () => {
  it("derives the target from the connection string, not from the disagreeing environment", () => {
    const journal = join(tempDir("j2"), "journal.jsonl");
    // No --production marker. If the runner had believed the ambient text it
    // would have refused with `target_is_staging`; instead it must recognise
    // production and demand the marker.
    const result = runController(executeArgs(productionUrl, journal), STAGING_PROJECT_REF);

    expect(result.output).toContain("production_marker_missing");
    expect(result.output).not.toContain("target_is_staging");
    expect(result.status).toBe(5);
    expect(existsSync(journal)).toBe(false);
  });

  it("refuses --production when the connection names something else, however the environment reads", () => {
    const journal = join(tempDir("j2b"), "journal.jsonl");
    const result = runController(
      executeArgs(refLessUrl, journal, [
        "--production",
        "--confirm-project-ref",
        PRODUCTION_PROJECT_REF,
      ]),
      PRODUCTION_PROJECT_REF,
    );
    // The flag and the environment agree with each other and disagree with the
    // socket. The socket wins.
    expect(result.output).toContain("target_not_production");
    expect(result.status).toBe(4);
    expect(existsSync(journal)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. The production marker, and the typed ref
// ---------------------------------------------------------------------------

describe("4. a production write needs the marker AND the typed ref", () => {
  it("refuses --production without the typed ref", () => {
    const journal = join(tempDir("j4"), "journal.jsonl");
    const result = runController(
      executeArgs(productionUrl, journal, ["--production"]),
      STAGING_PROJECT_REF,
    );
    expect(result.output).toContain("ref_confirmation_missing");
    expect(result.status).toBe(5);
    expect(existsSync(journal)).toBe(false);
  });

  it("refuses a confirmation that names a different ref", () => {
    const journal = join(tempDir("j4b"), "journal.jsonl");
    const result = runController(
      executeArgs(productionUrl, journal, [
        "--production",
        "--confirm-project-ref",
        STAGING_PROJECT_REF,
      ]),
      null,
    );
    expect(result.output).toContain("ref_confirmation_missing");
    expect(result.status).toBe(5);
    expect(existsSync(journal)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. A target with no discoverable ref
// ---------------------------------------------------------------------------

describe("5. a target that names no Supabase project", () => {
  it("refuses a write to it without an explicit disposable claim", () => {
    const journal = join(tempDir("j5"), "journal.jsonl");
    const result = runController(executeArgs(refLessUrl, journal), PRODUCTION_PROJECT_REF);
    // The guard must not be weaker merely because a hostname was unrecognised.
    expect(result.output).toContain("disposable_marker_missing");
    expect(result.status).toBe(5);
    expect(existsSync(journal)).toBe(false);
  });

  it("never lets the disposable claim authorise production", () => {
    const journal = join(tempDir("j5b"), "journal.jsonl");
    const result = runController(
      executeArgs(productionUrl, journal, ["--disposable-target"]),
      null,
    );
    expect(result.output).toContain("disposable_claim_on_production");
    expect(result.status).toBe(4);
    expect(existsSync(journal)).toBe(false);
  });

  it("never lets the disposable claim authorise staging either", () => {
    const journal = join(tempDir("j5c"), "journal.jsonl");
    const result = runController(executeArgs(stagingUrl, journal, ["--disposable-target"]), null);
    expect(result.output).toContain("target_is_staging");
    expect(result.status).toBe(4);
    expect(existsSync(journal)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. A dry run is database contact
// ---------------------------------------------------------------------------

describe("6. execute --dry-run is authorised as the contact it is", () => {
  it("still demands the production marker, because it opens the real transaction", () => {
    const journal = join(tempDir("j6"), "journal.jsonl");
    const result = runController(
      executeArgs(productionUrl, journal, ["--dry-run"]),
      STAGING_PROJECT_REF,
    );
    expect(result.output).toContain("production_marker_missing");
    // Named in the message, so the operator is told WHY a rollback still counts.
    expect(result.output).toContain("dry-run");
    expect(result.status).toBe(5);
    expect(existsSync(journal)).toBe(false);
  });

  it("still demands the disposable claim against a ref-less target", () => {
    const journal = join(tempDir("j6b"), "journal.jsonl");
    const result = runController(executeArgs(refLessUrl, journal, ["--dry-run"]), null);
    expect(result.output).toContain("disposable_marker_missing");
    expect(result.status).toBe(5);
    expect(existsSync(journal)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// No ambient fallback at all
// ---------------------------------------------------------------------------

describe("the controller has no ambient route to a target", () => {
  it("refuses to plan with no explicit source, naming the offending variable only", () => {
    const out = tempDir("amb");
    const result = spawnSync(
      process.execPath,
      [
        CONTROLLER,
        "plan",
        "--manifest",
        join(out, "m.json"),
        "--exceptions-out",
        join(out, "e.json"),
      ],
      {
        cwd: REPO,
        encoding: "utf8",
        env: {
          ...process.env,
          FOREVER_SEMANTIC_BACKFILL_DATABASE_URL: "",
          DATABASE_URL: `postgres://u:hunter2@db.${PRODUCTION_PROJECT_REF}.supabase.co/postgres`,
        },
      },
    );
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    expect(output).toContain("ambient_credentials_present");
    expect(output).toContain("DATABASE_URL");
    // The NAME is printed; the value never is.
    expect(output).not.toContain("hunter2");
    expect(result.status).toBe(2);
  });
});
