import { describe, expect, it } from "vitest";

import {
  ALL_RELATIONS_PRESENT,
  APPLY_MARKER,
  BUSINESS_INVARIANT_SQL,
  businessInvariantSql,
  OUT_OF_VOCABULARY_SQL,
  PROJECT_ROLE_DIGEST_SQL,
  projectApplyScript,
  projectStatements,
  rpcPayloadForProject,
} from "../apply-plan";
import { buildBackfillManifest } from "../plan";
import type { ManifestProject } from "../types";
import {
  GENERATED_AT,
  GENERATOR_COMMIT,
  POLICY,
  URLS,
  snapshot,
  standardEvidence,
} from "./fixtures";

const manifest = buildBackfillManifest({
  snapshot: snapshot(),
  evidenceBySlug: standardEvidence(),
  policy: POLICY,
  generatorCommit: GENERATOR_COMMIT,
  generatedAt: GENERATED_AT,
  acknowledgements: [],
});
const project = (slug: string): ManifestProject =>
  manifest.projects.find((entry) => entry.slug === slug)!;

describe("rpcPayloadForProject", () => {
  it("emits one element per ROW, because the RPC keys on (project_id, media_type, url)", () => {
    const sierra = rpcPayloadForProject(project("the-title-sierra"));
    const hero = sierra.filter((item) => item.url === URLS.sierraHero);
    expect(hero.map((item) => item.media_type).sort()).toEqual(["cover", "gallery"]);
  });

  it("gives every row of one URL the same role", () => {
    const hero = rpcPayloadForProject(project("the-title-sierra")).filter(
      (item) => item.url === URLS.sierraHero,
    );
    expect(new Set(hero.map((item) => item.semantic_role)).size).toBe(1);
  });

  it("emits nothing for a URL with no proposed role", () => {
    expect(rpcPayloadForProject(project("seeded-placeholder-villas"))).toEqual([]);
  });

  it("never emits a semantic_role key with an empty value", () => {
    // The projection is presence-aware and skips a blank role, so an empty
    // string would silently write nothing while the count assertion expected a
    // write.
    for (const item of manifest.projects.flatMap(rpcPayloadForProject)) {
      expect(item.semantic_role.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("the statements a project's transaction issues", () => {
  const statements = projectStatements(project("coralina"));

  it("opens and closes exactly one transaction", () => {
    expect(statements[0]).toBe("BEGIN;");
    expect(statements[statements.length - 1]).toBe("COMMIT;");
  });

  it("bounds the transaction so a stalled run cannot hold locks indefinitely", () => {
    expect(statements.join("\n")).toContain("SET LOCAL statement_timeout = '60s'");
    expect(statements.join("\n")).toContain("SET LOCAL idle_in_transaction_session_timeout");
  });

  it("writes through the shipped RPC and nothing else", () => {
    const writes = statements.filter((sql) =>
      /\b(insert|update|delete|alter|drop|truncate|grant|revoke)\b/i.test(sql),
    );
    expect(writes).toEqual([]);
    expect(statements.join("\n")).toContain("public.forever_project_media_semantic_projection");
  });

  it("never calls the cover retirement functions", () => {
    // Retiring a role-less cover moves it out of GOVERNED_MEDIA_TYPES, which
    // makes the gate cleaner by shrinking its denominator.
    const text = statements.join("\n");
    expect(text).not.toContain("forever_project_cover_reconcile");
    expect(text).not.toContain("forever_project_cover_withdraw");
  });
});

describe("the digests the transaction asserts", () => {
  it('sorts with COLLATE "C", so the client and the server agree', () => {
    expect(PROJECT_ROLE_DIGEST_SQL).toContain('COLLATE "C"');
    expect(BUSINESS_INVARIANT_SQL).toContain('COLLATE "C"');
  });

  it("hashes project_media over every column except semantic_role", () => {
    // One comparison proves no media_type was rewritten, no url moved, no
    // sort_order shuffled and no title or metadata touched — and therefore that
    // no cover was retired.
    const media = BUSINESS_INVARIANT_SQL.split("media_non_role_digest")[0];
    expect(media).toContain("media_type");
    expect(media).toContain("sort_order");
    expect(media).toContain("coalesce(title,'')");
    expect(media).toContain("coalesce(metadata::text,'')");
    expect(BUSINESS_INVARIANT_SQL).not.toContain("semantic_role");
  });

  it("covers the relation where SOLD lives", () => {
    expect(BUSINESS_INVARIANT_SQL).toContain("availability_status");
    expect(BUSINESS_INVARIANT_SQL).toContain("public.unit_price_history");
  });

  it("substitutes a sentinel for a relation the target does not have", () => {
    // `to_regclass` inside a CASE does not protect anything: in PostgreSQL a
    // statement referencing a missing table fails during parse analysis, so the
    // query has to be composed from what is actually present.
    const partial = businessInvariantSql({ ...ALL_RELATIONS_PRESENT, buildings: false });
    expect(partial).not.toContain("public.buildings");
    expect(partial).toContain("'absent'::text AS buildings_digest");
  });

  it("checks the vocabulary in case the CHECK constraint was never applied", () => {
    expect(OUT_OF_VOCABULARY_SQL).toContain("NOT IN (");
    expect(OUT_OF_VOCABULARY_SQL).toContain("'property_exterior'");
  });
});

describe("projectApplyScript", () => {
  const script = projectApplyScript(project("coralina"), { dryRun: false });

  it("aborts the transaction from inside, rather than deciding out in the client", () => {
    // Any gap between "the client decided to roll back" and "the rollback
    // happened" is a window in which the process can die with the transaction
    // open.
    expect(script).toContain("RAISE EXCEPTION 'role_digest_before mismatch");
    expect(script).toContain("RAISE EXCEPTION 'business invariant changed");
    expect(script).toContain("BEGIN;");
    expect(script.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  it("asserts the RPC's own return value against the planned row count", () => {
    const payload = rpcPayloadForProject(project("coralina"));
    expect(script).toContain(`plan named ${payload.length}`);
  });

  it("rolls back instead of committing on a dry run", () => {
    const dry = projectApplyScript(project("coralina"), { dryRun: true });
    expect(dry.trimEnd().endsWith("ROLLBACK;")).toBe(true);
    expect(dry).not.toContain("\nCOMMIT;");
    // Every check still runs, so a dry run reports the same counts.
    expect(dry).toContain("RAISE EXCEPTION 'role_digest_expected_after mismatch");
  });

  it("carries no bound parameter placeholders into the block", () => {
    // `$1` inside a dollar-quoted body is not a placeholder psql would fill.
    expect(script).not.toContain("$1::uuid");
  });

  it("refuses a project id that is not a UUID", () => {
    const broken = { ...project("coralina"), project_id: "coralina" };
    expect(() => projectApplyScript(broken, { dryRun: true })).toThrowError(/non-UUID/);
  });

  it("dollar-quotes the payload with a tag proven absent from it", () => {
    // Doubling quotes works until the day a URL contains one.
    expect(script).toMatch(/\$fb\$\[.*\]\$fb\$::jsonb/s);
  });

  it("produces byte-identical SQL for the same project twice", () => {
    expect(projectApplyScript(project("coralina"), { dryRun: false })).toBe(script);
  });

  /**
   * Both of these were found by executing the SQL against a disposable
   * PostgreSQL 17 cluster (`npm run media:pg-test`, path C). Neither is visible
   * by reading the string, and both are pinned here as well as there because the
   * pg proof needs a cluster while these have to fail in `npm test`.
   */
  describe("regressions the disposable-cluster proof found", () => {
    it("emits the completion marker as a SELECT, not only as a NOTICE", () => {
      // psql writes server NOTICEs to stderr and the runner reads stdout, so a
      // marker that existed only inside `RAISE NOTICE` never reached it: every
      // project that actually wrote was journalled `project_failed` with
      // `rolled_back: true`, after its COMMIT had already landed.
      const markerStatement = `SELECT '${APPLY_MARKER}' AS forever_backfill;`;
      expect(script).toContain(markerStatement);
      // ...and it sits after the assertions and before the COMMIT, so it is
      // reachable only when nothing raised.
      expect(script.indexOf("$forever_backfill$;")).toBeLessThan(script.indexOf(markerStatement));
      expect(script.indexOf(markerStatement)).toBeLessThan(script.lastIndexOf("COMMIT;"));
      expect(projectStatements(project("coralina"))).toContain(markerStatement);
    });

    it("hashes unit_price_history by the columns that exist on it", () => {
      // `unit_price_history` has `price` and `currency`; only `units` has
      // `base_price_thb`. Referring to `h.price_thb` failed the whole statement
      // during parse analysis inside the DO block, so no project could ever
      // commit against a database that has the table.
      expect(BUSINESS_INVARIANT_SQL).toContain("coalesce(h.price::text,'')");
      expect(BUSINESS_INVARIANT_SQL).toContain("coalesce(h.currency,'')");
      expect(BUSINESS_INVARIANT_SQL).not.toContain("h.price_thb");
      // `units` still hashes its own THB column, which does exist.
      expect(BUSINESS_INVARIANT_SQL).toContain("coalesce(base_price_thb::text,'')");
    });
  });
});
