import { describe, expect, it } from "vitest";

import {
  assertJournalOutsideRepo,
  assertNoAmbientCredentials,
  assertTargetPermitted,
  assertTargetRefsAgree,
  assertWritablePath,
  GuardError,
  PRODUCTION_PROJECT_REF,
  refFromDatabaseUrl,
  refFromTarget,
  STAGING_PROJECT_REF,
} from "../guards";

const REPO = "C:/work/forever";

function code(run: () => void): { code: string; exitCode: number } {
  try {
    run();
  } catch (error) {
    const guard = error as GuardError;
    return { code: guard.code, exitCode: guard.exitCode };
  }
  throw new Error("expected the guard to refuse");
}

describe("staging is refused unconditionally", () => {
  it("refuses in plan mode, before any connection could be opened", () => {
    expect(
      code(() =>
        assertTargetPermitted(STAGING_PROJECT_REF, {
          production: false,
          confirmRef: null,
          disposableTarget: false,
          opensTransaction: false,
        }),
      ),
    ).toEqual({ code: "target_is_staging", exitCode: 4 });
  });

  it("refuses on a dry run too", () => {
    // "We connected to staging read-only and then refused" is still a run that
    // contacted a database it was told never to contact.
    expect(
      code(() =>
        assertTargetPermitted(STAGING_PROJECT_REF, {
          production: true,
          confirmRef: PRODUCTION_PROJECT_REF,
          disposableTarget: false,
          opensTransaction: false,
        }),
      ).code,
    ).toBe("target_is_staging");
  });
});

describe("writing requires the marker AND the typed ref AND a production target", () => {
  it("refuses --execute alone", () => {
    expect(
      code(() =>
        assertTargetPermitted(PRODUCTION_PROJECT_REF, {
          production: false,
          confirmRef: PRODUCTION_PROJECT_REF,
          disposableTarget: false,
          opensTransaction: true,
        }),
      ),
    ).toEqual({ code: "production_marker_missing", exitCode: 5 });
  });

  it("refuses --execute --production with no --confirm-project-ref", () => {
    expect(
      code(() =>
        assertTargetPermitted(PRODUCTION_PROJECT_REF, {
          production: true,
          confirmRef: null,
          disposableTarget: false,
          opensTransaction: true,
        }),
      ),
    ).toEqual({ code: "ref_confirmation_missing", exitCode: 5 });
  });

  it("refuses a confirmation that names a different ref", () => {
    expect(
      code(() =>
        assertTargetPermitted(PRODUCTION_PROJECT_REF, {
          production: true,
          confirmRef: "abtvsrcnfwlbawvrjeee",
          disposableTarget: false,
          opensTransaction: true,
        }),
      ).code,
    ).toBe("ref_confirmation_missing");
  });

  it("refuses --production against a target that is not production", () => {
    expect(
      code(() =>
        assertTargetPermitted("someotherprojectref0", {
          production: true,
          confirmRef: PRODUCTION_PROJECT_REF,
          disposableTarget: false,
          opensTransaction: false,
        }),
      ),
    ).toEqual({ code: "target_not_production", exitCode: 4 });
  });

  it("refuses a write to an unverifiable target", () => {
    expect(
      code(() =>
        assertTargetPermitted(null, {
          production: true,
          confirmRef: PRODUCTION_PROJECT_REF,
          disposableTarget: false,
          opensTransaction: true,
        }),
      ).code,
    ).toBe("target_not_production");
  });

  it("permits the fully confirmed production write", () => {
    expect(() =>
      assertTargetPermitted(PRODUCTION_PROJECT_REF, {
        production: true,
        confirmRef: PRODUCTION_PROJECT_REF,
        disposableTarget: false,
        opensTransaction: true,
      }),
    ).not.toThrow();
  });

  it("permits a plan against a non-production copy without the marker", () => {
    // A disposable cluster is a legitimate plan target; it is only WRITING that
    // is production-only.
    expect(() =>
      assertTargetPermitted(null, {
        production: false,
        confirmRef: null,
        disposableTarget: false,
        opensTransaction: false,
      }),
    ).not.toThrow();
  });
});

describe("refFromTarget", () => {
  it("prefers the ref the snapshot recorded", () => {
    expect(refFromTarget({ snapshotRef: PRODUCTION_PROJECT_REF })).toBe(PRODUCTION_PROJECT_REF);
  });

  it("reads a Supabase direct-connection host", () => {
    expect(
      refFromTarget({
        databaseUrl: `postgres://postgres:pw@db.${PRODUCTION_PROJECT_REF}.supabase.co:5432/postgres`,
      }),
    ).toBe(PRODUCTION_PROJECT_REF);
  });

  it("reads a pooler user", () => {
    expect(
      refFromTarget({
        databaseUrl: `postgres://postgres.${PRODUCTION_PROJECT_REF}:pw@aws-0-eu.pooler.supabase.com:6543/postgres`,
      }),
    ).toBe(PRODUCTION_PROJECT_REF);
  });

  it("recognises staging so it can be refused", () => {
    expect(
      refFromTarget({ databaseUrl: `postgres://u@db.${STAGING_PROJECT_REF}.supabase.co/postgres` }),
    ).toBe(STAGING_PROJECT_REF);
  });

  it("returns null rather than guessing at a local cluster", () => {
    // A guess here decides which database gets written to.
    expect(
      refFromTarget({ databaseUrl: "postgres://postgres@127.0.0.1:55442/postgres" }),
    ).toBeNull();
  });
});

describe("the ref comes from the connection, never from the environment", () => {
  // REGRESSION. An earlier version consulted process.env.SUPABASE_URL first and
  // never cross-checked it against --database-url. The Owner's credentials file
  // exports SUPABASE_URL as production, so in the Owner's normal shell a
  // --database-url naming STAGING was not refused, and --production authorised a
  // write to whatever that string really pointed at. Both were reproduced at the
  // CLI by an independent review.
  it("does not let a production API origin launder a staging connection string", () => {
    // The type no longer has a `supabaseUrl` field at all, which is the real
    // fix; this asserts the outcome that missing field produces.
    const ref = refFromTarget({
      databaseUrl: `postgres://u:p@db.${STAGING_PROJECT_REF}.supabase.co:5432/postgres`,
    });
    expect(ref).toBe(STAGING_PROJECT_REF);
    expect(
      code(() =>
        assertTargetPermitted(ref, {
          production: true,
          confirmRef: PRODUCTION_PROJECT_REF,
          disposableTarget: false,
          opensTransaction: true,
        }),
      ),
    ).toEqual({ code: "target_is_staging", exitCode: 4 });
  });

  it("ignores a snapshot ref once a connection string is present", () => {
    // The connection string opens the socket, so it decides. A snapshot from
    // production plus a connection to a local copy is a local target.
    expect(
      refFromTarget({
        snapshotRef: PRODUCTION_PROJECT_REF,
        databaseUrl: "postgres://postgres@127.0.0.1:55442/postgres",
      }),
    ).toBeNull();
  });

  it("refuses a snapshot and a connection that name different databases", () => {
    expect(
      code(() =>
        assertTargetRefsAgree(
          PRODUCTION_PROJECT_REF,
          `postgres://u@db.${STAGING_PROJECT_REF}.supabase.co/postgres`,
        ),
      ),
    ).toEqual({ code: "snapshot_target_mismatch", exitCode: 4 });
  });

  it("allows a snapshot and a connection that agree", () => {
    expect(() =>
      assertTargetRefsAgree(
        PRODUCTION_PROJECT_REF,
        `postgres://u@db.${PRODUCTION_PROJECT_REF}.supabase.co/postgres`,
      ),
    ).not.toThrow();
  });

  it("reads nothing out of a bare host", () => {
    expect(refFromDatabaseUrl("postgres://postgres@127.0.0.1:55442/postgres")).toBeNull();
    expect(refFromDatabaseUrl("")).toBeNull();
    expect(refFromDatabaseUrl(undefined)).toBeNull();
  });
});

describe("a dry run is still a write-shaped contact with the target", () => {
  // REGRESSION. `willWrite` used to be `execute && !dryRun`, and the permission
  // check returned early when it was false — so `execute --dry-run` against
  // production required neither --production nor --confirm-project-ref, while
  // still issuing the real BEGIN, the real UPDATE and only then ROLLBACK.
  it("requires the production marker for execute --dry-run against production", () => {
    expect(
      code(() =>
        assertTargetPermitted(PRODUCTION_PROJECT_REF, {
          production: false,
          confirmRef: null,
          disposableTarget: false,
          opensTransaction: true,
        }),
      ),
    ).toEqual({ code: "production_marker_missing", exitCode: 5 });
  });

  it("requires the typed ref for execute --dry-run against production", () => {
    expect(
      code(() =>
        assertTargetPermitted(PRODUCTION_PROJECT_REF, {
          production: true,
          confirmRef: null,
          disposableTarget: false,
          opensTransaction: true,
        }),
      ).code,
    ).toBe("ref_confirmation_missing");
  });
});

describe("a write to a ref-less target needs a positive claim", () => {
  // A ref is read out of the connection string's host, and not every route to
  // production carries one — an IP address, a tunnel or a local proxy all name
  // no project. Allowing an unmarked write whenever the ref is merely
  // unrecognised would make the guard depend on the spelling of a hostname.
  it("refuses --execute against a local cluster with no --disposable-target", () => {
    expect(
      code(() =>
        assertTargetPermitted(null, {
          production: false,
          confirmRef: null,
          disposableTarget: false,
          opensTransaction: true,
        }),
      ),
    ).toEqual({ code: "disposable_marker_missing", exitCode: 5 });
  });

  it("permits it once the operator says so", () => {
    expect(() =>
      assertTargetPermitted(null, {
        production: false,
        confirmRef: null,
        disposableTarget: true,
        opensTransaction: true,
      }),
    ).not.toThrow();
  });

  it("refuses the disposable claim about production", () => {
    expect(
      code(() =>
        assertTargetPermitted(PRODUCTION_PROJECT_REF, {
          production: false,
          confirmRef: null,
          disposableTarget: true,
          opensTransaction: true,
        }),
      ),
    ).toEqual({ code: "disposable_claim_on_production", exitCode: 4 });
  });

  it("still refuses staging even when called disposable", () => {
    expect(
      code(() =>
        assertTargetPermitted(STAGING_PROJECT_REF, {
          production: false,
          confirmRef: null,
          disposableTarget: true,
          opensTransaction: true,
        }),
      ).code,
    ).toBe("target_is_staging");
  });
});

describe("ambient credentials", () => {
  it("refuses when the environment already carries one and nothing explicit was given", () => {
    const refusal = code(() =>
      assertNoAmbientCredentials({ DATABASE_URL: "postgres://x" } as NodeJS.ProcessEnv, false),
    );
    expect(refusal).toEqual({ code: "ambient_credentials_present", exitCode: 2 });
  });

  it("names the variable without reading its value", () => {
    let message = "";
    try {
      assertNoAmbientCredentials(
        { SUPABASE_DB_URL: "postgres://secret@host" } as NodeJS.ProcessEnv,
        false,
      );
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("SUPABASE_DB_URL");
    expect(message).not.toContain("secret");
  });

  it("allows it once the target was named explicitly", () => {
    expect(() =>
      assertNoAmbientCredentials({ DATABASE_URL: "postgres://x" } as NodeJS.ProcessEnv, true),
    ).not.toThrow();
  });

  it("ignores an empty variable", () => {
    expect(() =>
      assertNoAmbientCredentials({ PGHOST: "  " } as NodeJS.ProcessEnv, false),
    ).not.toThrow();
  });
});

describe("output locations", () => {
  it("refuses a journal inside the repository", () => {
    // A checkout between a crash and a resume would delete the only record of
    // what had already been applied.
    expect(code(() => assertJournalOutsideRepo(`${REPO}/tmp/run.jsonl`, REPO))).toEqual({
      code: "journal_inside_repo",
      exitCode: 2,
    });
  });

  it("accepts a journal outside it", () => {
    expect(() => assertJournalOutsideRepo("C:/runs/run.jsonl", REPO)).not.toThrow();
  });

  it("refuses a manifest written into the working tree", () => {
    expect(code(() => assertWritablePath(`${REPO}/manifest.json`, REPO, "The manifest")).code).toBe(
      "output_inside_repo",
    );
  });
});
