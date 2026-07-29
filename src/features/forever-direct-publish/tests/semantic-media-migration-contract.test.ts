/**
 * The semantic media migration contract
 * (FOREVER-PR117-DATABASE-PROOF-AND-REREVIEW-001, §5).
 *
 * These are the properties that, if quietly lost, would leave the contract
 * looking correct while doing nothing — which is exactly what happened once
 * already: the role was added to a TypeScript object literal, the database
 * never read it, and every assertion still passed because none of them looked
 * at the write path.
 *
 * The load-bearing cases here are paired with a **negative control**: the same
 * assertion re-run against a deliberately mutated copy of the migration, proving
 * the test fails when the property is removed. A contract test that cannot fail
 * is not a contract test.
 *
 * NOT every case — an earlier version of this header claimed that, and it was
 * not true of the file it described. The controls cover the properties whose
 * silent loss would leave the contract looking correct while doing nothing: that
 * the projection is called, that the reconciler is called, that the vocabulary is
 * pinned, that the grant excludes provenance, and that the retirement deletes
 * nothing but a stale designation. The remainder are shape assertions whose
 * failure is obvious, and the behaviour they describe is proved by execution in
 * `run-semantic-media-pg-tests.mjs` rather than by a mutated string here.
 *
 * The behavioural proof — that this SQL actually runs on PostgreSQL and does
 * what it says — is `scripts/media/run-semantic-media-pg-tests.mjs`. This file
 * protects the shape; that harness proves the behaviour.
 */

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { SEMANTIC_ROLES } from "../hero-policy";

const MIGRATIONS_DIR = resolve(process.cwd(), "supabase/migrations");
const SUBJECT = "20260728120000_project_media_semantic_role.sql";
const SUBJECT_PATH = resolve(MIGRATIONS_DIR, SUBJECT);

const sql = readFileSync(SUBJECT_PATH, "utf8");

/** Executable text only — a comment must never satisfy or break an assertion. */
const executable = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

/**
 * The body of the re-declared publish function, where call order matters.
 *
 * Bounded at both ends and stripped of comments. Running to end-of-file would
 * swallow the rollback block, whose `DROP FUNCTION IF EXISTS
 * public.forever_project_media_semantic_projection(...)` line contains the very
 * string these assertions look for — so a removed call would still "pass". The
 * negative control below is what surfaced that.
 */
function publishBody(source: string): string {
  const withoutComments = source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  const start = withoutComments.indexOf("CREATE OR REPLACE FUNCTION public.forever_direct_publish");
  expect(start, "forever_direct_publish is re-declared").toBeGreaterThan(-1);
  const rest = withoutComments.slice(start);
  const end = rest.indexOf("\n$$;");
  expect(end, "the publish function body is terminated").toBeGreaterThan(-1);
  return rest.slice(0, end);
}

/**
 * Every contract property as a predicate, so each one can be run against both
 * the real migration and a mutated copy.
 */
const PROPERTIES: Record<string, (source: string) => boolean> = {
  "semantic projection is called from the publish path": (s) =>
    publishBody(s).includes("public.forever_project_media_semantic_projection("),
  "cover reconciliation is called from the publish path": (s) =>
    publishBody(s).includes("public.forever_project_cover_reconcile(v_project_id, v_cover_url)"),
  "superseded covers are retired, not demoted to gallery": (s) =>
    s.includes("SET media_type = 'superseded_cover'") && !/SET media_type = 'gallery'/.test(s),
  "the semantic_role column is added": (s) =>
    s.includes("ADD COLUMN IF NOT EXISTS semantic_role TEXT"),
  "metadata is never granted to a browser role": (s) => {
    const grant = s.match(
      /GRANT SELECT \(\s*([\s\S]*?)\s*\) ON public\.project_media TO anon, authenticated;/,
    );
    if (!grant) return false;
    return !grant[1]
      .split(",")
      .map((c) => c.trim())
      .includes("metadata");
  },
};

describe("semantic media migration — contract", () => {
  it("appends to the ledger, and nothing after it edits the media contract", () => {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const index = files.indexOf(SUBJECT);
    expect(index, `${SUBJECT} present in the ledger`).toBeGreaterThan(-1);

    // This used to assert the subject was the LAST file. That was true when it
    // shipped, but it makes an unrelated later migration fail this contract —
    // the ledger only ever grows. What the contract is actually protecting is
    // that the subject APPENDS (nothing already applied was renumbered around
    // it) and that nothing ordered after it reaches back into project_media.
    //
    // Appends: every other migration sorts before it, except ones added later.
    // Comments are stripped before scanning, because a later migration may name
    // project_media while explaining which earlier migration granted what —
    // 20260728160000 does exactly that.
    const later = files.slice(index + 1);
    const uncommented = (text: string) =>
      text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
    const mediaWriters = later.filter((file) =>
      /project_media|semantic_role/i.test(
        uncommented(readFileSync(resolve(MIGRATIONS_DIR, file), "utf8")),
      ),
    );
    expect(mediaWriters, "migrations after the subject must not touch project_media").toEqual([]);
  });

  it("edits no applied migration", () => {
    // The role is projected AFTER the applied ingest function rather than by
    // editing it. Redefining it here would silently fork a shipped file.
    expect(sql).not.toContain("CREATE OR REPLACE FUNCTION public.forever_progressive_ingest");
    expect(sql).not.toMatch(/DROP FUNCTION[^;]*forever_progressive_ingest/);
  });

  it("declares schema and functions only — no fixture DML", () => {
    // A migration that inserted or updated rows would make its own behaviour
    // untestable against real data. The only UPDATE in the file is inside a
    // function body, executed by the publish path, never by the migration.
    const statements = executable.replace(/\$\$[\s\S]*?\$\$/g, "$$FUNCTION_BODY$$").toUpperCase();
    expect(statements).not.toMatch(/\bINSERT\s+INTO\b/);
    expect(statements).not.toMatch(/\bDELETE\s+FROM\b/);
    expect(statements).not.toMatch(/^\s*UPDATE\s+PUBLIC\./m);
  });

  it("pins the exact vocabulary TypeScript uses", () => {
    const check = sql.match(
      /CHECK \(\s*semantic_role IS NULL\s*OR semantic_role IN \(([\s\S]*?)\)\s*\)/,
    );
    expect(check, "vocabulary CHECK constraint").not.toBeNull();
    const inSql = [...(check?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(inSql).toEqual([...SEMANTIC_ROLES].sort());
  });

  it("grants EXECUTE on the new functions to service_role only", () => {
    for (const fn of [
      "forever_project_media_semantic_projection(UUID, JSONB)",
      "forever_project_cover_reconcile(UUID, TEXT)",
    ]) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${fn}`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${fn}`);
      expect(sql).toMatch(
        new RegExp(
          `GRANT EXECUTE ON FUNCTION public\\.${fn.replace(/[()]/g, "\\$&")}\\s*\\n?\\s*TO service_role;`,
        ),
      );
    }
  });

  it("exposes only presentation columns to browser roles", () => {
    const grant = sql.match(
      /GRANT SELECT \(\s*([\s\S]*?)\s*\) ON public\.project_media TO anon, authenticated;/,
    );
    const columns = (grant?.[1] ?? "")
      .split(",")
      .map((c) => c.trim())
      .sort();
    expect(columns).toEqual([
      "id",
      "media_type",
      "project_id",
      "semantic_role",
      "sort_order",
      "title",
      "url",
    ]);
  });

  // Named for what it asserts. It used to be "issues no REVOKE" while the
  // migration contains nine of them — all `REVOKE ALL ON FUNCTION`, which is the
  // point: revoking EXECUTE on the new functions is required, and revoking
  // SELECT on a column is the thing that must never happen here. Test names get
  // pasted into release records.
  it("issues no REVOKE SELECT, so it cannot change another column's reachability", () => {
    expect(executable).not.toMatch(/REVOKE SELECT/);
  });

  it("runs both new steps after the graph write, in the publish transaction", () => {
    const body = publishBody(sql);
    const ingest = body.indexOf("public.forever_progressive_ingest(batch)");
    const project = body.indexOf("public.forever_project_media_semantic_projection(");
    const cover = body.indexOf("public.forever_project_cover_reconcile(v_project_id, v_cover_url)");
    expect(ingest).toBeGreaterThan(-1);
    expect(ingest).toBeLessThan(project);
    expect(project).toBeLessThan(cover);
    // The steps the earlier migration already performed must survive.
    expect(body).toContain("public.forever_project_price_projection(v_project_id)");
    expect(body).toContain("SET public_status = 'published'");
  });

  /**
   * Scoped to the reconciler's own body. Asserted against the whole file, both
   * of these strings appear elsewhere — `IF NOT EXISTS (` in the DO-block guard
   * around the CHECK constraint, `AND url = btrim(p_cover_url)` in the DELETE —
   * so the test passed with the guard removed. It was checking that the file
   * contains some text, not that the function has the property.
   */
  it("retires a cover only once its replacement exists", () => {
    const start = sql.indexOf("CREATE OR REPLACE FUNCTION public.forever_project_cover_reconcile");
    expect(start).toBeGreaterThan(-1);
    const body = sql.slice(start, sql.indexOf("$$;", start) + 3);

    // The guard, and the UPDATE it protects, both inside this one function.
    const guard = body.indexOf("IF NOT EXISTS (");
    const update = body.indexOf("SET media_type = 'superseded_cover'");
    expect(guard).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(guard);

    // The guard asks whether the REPLACEMENT row exists — a cover with the
    // incoming URL — and returns without retiring anything when it does not.
    const guardBlock = body.slice(guard, update);
    expect(guardBlock).toContain("media_type = 'cover'");
    expect(guardBlock).toContain("AND url = btrim(p_cover_url)");
    expect(guardBlock).toContain("RETURN 0;");
  });

  /**
   * The reconciler does delete one thing, and the scope of that deletion is the
   * whole safety argument.
   *
   * Independent review proved the retire was not collision-proof: a cover that
   * returns (A -> B -> A) left a retired row for A beside a live cover A, and
   * the next retirement of A duplicated the natural key. The invariant that
   * fixes it is "a URL is never both the active cover and a retired one", which
   * requires clearing the obsolete retirement of the incoming cover.
   *
   * That row names the same project and the same URL as the live cover that
   * supersedes it, so the storage object and the retained private original are
   * untouched — a stale designation goes, never source media. The assertion
   * pins exactly that scope: the DELETE must target `superseded_cover` rows
   * whose url IS the incoming cover, and nothing else.
   */
  it("deletes only obsolete retirements, and only ever those", () => {
    const deletes = [...executable.matchAll(/DELETE FROM public\.project_media[\s\S]*?;/g)].map(
      (match) => match[0],
    );
    // Two, and the count is the assertion: `_reconcile` clears the retirement of
    // the cover that is coming back, `_withdraw` clears the retirement of a cover
    // being retired again. A third would be a new way to lose a row.
    expect(deletes, "exactly two DELETEs against project_media").toHaveLength(2);

    for (const statement of deletes) {
      // Every one of them is scoped to retirements of one project.
      expect(statement).toContain("media_type = 'superseded_cover'");
      expect(statement).toContain("project_id = p_project_id");

      // None may TARGET a live cover, a gallery row, a plan or a document.
      //
      // The `_withdraw` statement names `live.media_type = 'cover'` inside an
      // EXISTS that only identifies WHICH retirement is obsolete, so the target
      // clause is everything before the subquery. Written as
      // `slice(0, indexOf("EXISTS") + 1)` this guard was INERT for the reconcile
      // statement, which contains no EXISTS: `indexOf` returned -1, the slice
      // was `""`, and the assertion ran against the empty string. Widening that
      // DELETE to reach a live cover would have passed.
      const subquery = statement.indexOf("EXISTS");
      const target = subquery === -1 ? statement : statement.slice(0, subquery);
      expect(target.length).toBeGreaterThan(40);
      expect(target).not.toMatch(
        /media_type\s*=\s*'(cover|gallery|floor_plan|master_plan|unit_plan|document|brochure)'/,
      );
    }

    // The reconcile statement is keyed on the incoming cover's URL...
    expect(deletes.some((statement) => statement.includes("url = btrim(p_cover_url)"))).toBe(true);
    // ...and the withdraw statement on a URL that is currently an active cover of
    // the same project, which is the same invariant expressed without a
    // replacement to name.
    expect(deletes.some((statement) => statement.includes("live.url = old.url"))).toBe(true);
  });

  /**
   * `publish.ts` clears `main_image_url` when the policy examined the supplied
   * photographs and found that none depicts the property. That expression did
   * nothing: `forever_progressive_ingest` writes `main_image_url` only
   * `WHEN v_set ? 'main_image_url' AND v_set->>'main_image_url' IS NOT NULL`, a
   * guard that discards an explicit null along with an accidental one. So the
   * branch whose own comment says leaving the cover in place "would make
   * `hero_candidate_missing` a report with no effect" was itself a report with
   * no effect.
   */
  it("actually withdraws a cover the policy rejected", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.forever_project_cover_withdraw");
    const body = publishBody(sql);
    // `jsonb_typeof` is the whole fix: `->>` collapses "absent" and
    // "present and null" into the same SQL NULL, which is why the ingest could
    // not act on it.
    expect(body).toContain("jsonb_typeof(batch->'project'->'set'->'main_image_url') = 'null'");
    expect(body).toContain("public.forever_project_cover_withdraw(v_project_id)");
    // Narrow on purpose: never when this batch names a replacement cover.
    expect(body).toContain("IF v_cover_url IS NULL");
    expect(body).toContain("'covers_withdrawn', v_withdrawn");
  });

  it("withdraws by retiring and clearing, never by deleting media", () => {
    const withdraw = sql.slice(
      sql.indexOf("CREATE OR REPLACE FUNCTION public.forever_project_cover_withdraw"),
    );
    const fn = withdraw.slice(0, withdraw.indexOf("$$;") + 3);
    expect(fn).toContain("SET media_type = 'superseded_cover'");
    expect(fn).toContain("SET main_image_url = NULL");
    // The only DELETE it may contain is the invariant-holding one.
    const deletes = [...fn.matchAll(/DELETE FROM public\.project_media[\s\S]*?;/g)];
    expect(deletes).toHaveLength(1);
    expect(deletes[0][0]).toContain("old.media_type = 'superseded_cover'");
  });

  it("keeps the withdraw function off the public role", () => {
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.forever_project_cover_withdraw\(UUID\) FROM anon, authenticated;/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.forever_project_cover_withdraw\(UUID\)\s*\n?\s*TO service_role;/,
    );
  });

  it("never erases a recorded role with a batch that omits one", () => {
    expect(sql).toContain("CONTINUE WHEN NOT (v_item ? 'semantic_role')");
  });

  /**
   * The rollback has to describe the schema that actually exists, or the person
   * running it at 3am restores something else.
   */
  it("documents a rollback that matches the final schema", () => {
    const rollback = sql.slice(sql.indexOf("-- Rollback:"));
    expect(rollback).toContain(
      "DROP FUNCTION IF EXISTS public.forever_project_media_semantic_projection(UUID, JSONB);",
    );
    expect(rollback).toContain(
      "DROP FUNCTION IF EXISTS public.forever_project_cover_reconcile(UUID, TEXT);",
    );
    expect(rollback).toContain("DROP CONSTRAINT IF EXISTS project_media_semantic_role_vocabulary;");
    expect(rollback).toContain("DROP COLUMN IF EXISTS semantic_role;");
    // The superseded state only means anything while this migration is in
    // place, so rolling back must return those rows — but not blindly. An
    // unguarded restore violates project_media_natural_key the moment a project
    // holds a live cover and a retired row for the same URL, which independent
    // review reproduced. The guard is mandatory, not defensive.
    expect(rollback).toContain("SET media_type = 'cover'");
    expect(rollback).toContain("pm.media_type = 'superseded_cover'");
    expect(rollback).toContain("NOT EXISTS (");
    expect(rollback).toContain("live.media_type = 'cover'");
    expect(rollback).toContain("live.url = pm.url");
    // And it must restore the pre-existing grant rather than leave the new one.
    expect(rollback).toMatch(
      /GRANT SELECT \(\s*\n?--\s*id, project_id, media_type, title, url, sort_order/,
    );
  });

  it("documents no stale demotion-to-gallery behaviour", () => {
    // The rationale may explain why NOT gallery; nothing may claim it IS.
    const comment = sql.match(
      /COMMENT ON FUNCTION public\.forever_project_cover_reconcile\(UUID, TEXT\) IS([\s\S]*?);/,
    );
    expect(comment, "function comment").not.toBeNull();
    expect(comment?.[1]).toContain("superseded_cover");
    expect(comment?.[1]).not.toMatch(/to gallery/i);
  });
});

/**
 * Negative controls.
 *
 * Each mutation removes exactly one property. If the matching predicate still
 * returns true, that assertion is decorative and would not have caught the
 * regression it exists for.
 */
describe("semantic media migration — negative controls", () => {
  const MUTATIONS: Array<{ name: string; property: string; mutate: (s: string) => string }> = [
    {
      name: "the semantic projection call is removed",
      property: "semantic projection is called from the publish path",
      mutate: (s) =>
        s.replace(
          /v_roles := public\.forever_project_media_semantic_projection\([\s\S]*?\);/,
          "v_roles := 0;",
        ),
    },
    {
      name: "the cover reconciliation call is removed",
      property: "cover reconciliation is called from the publish path",
      mutate: (s) =>
        s.replace(
          "v_retired := public.forever_project_cover_reconcile(v_project_id, v_cover_url);",
          "v_retired := 0;",
        ),
    },
    {
      name: "superseded_cover is reverted to gallery",
      property: "superseded covers are retired, not demoted to gallery",
      mutate: (s) => s.replace("SET media_type = 'superseded_cover'", "SET media_type = 'gallery'"),
    },
    {
      name: "the semantic_role column is not added",
      property: "the semantic_role column is added",
      mutate: (s) => s.replace("ADD COLUMN IF NOT EXISTS semantic_role TEXT", "-- column removed"),
    },
    {
      name: "the public grant is widened to metadata",
      property: "metadata is never granted to a browser role",
      mutate: (s) =>
        s.replace(
          "  id, project_id, media_type, title, url, sort_order, semantic_role\n) ON public.project_media TO anon, authenticated;",
          "  id, project_id, media_type, title, url, sort_order, semantic_role, metadata\n) ON public.project_media TO anon, authenticated;",
        ),
    },
  ];

  it.each(MUTATIONS)("fails when $name", ({ property, mutate }) => {
    const predicate = PROPERTIES[property];
    expect(predicate, `property "${property}" is defined`).toBeTypeOf("function");

    // Sanity: the property holds on the real migration.
    expect(predicate(sql), `"${property}" holds on the real migration`).toBe(true);

    const mutated = mutate(sql);
    expect(mutated, "the mutation actually changed the file").not.toBe(sql);
    expect(predicate(mutated), `"${property}" must FAIL on the mutated migration`).toBe(false);
  });
});
