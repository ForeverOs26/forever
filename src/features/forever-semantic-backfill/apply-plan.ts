/**
 * The SQL, derived rather than written by hand
 * (FOREVER-SEMANTIC-MEDIA-BACKFILL-001).
 *
 * Every statement a run issues is produced here, by a pure function, from the
 * reviewed manifest. Nothing is assembled inside the runner, so the exact text
 * that will be executed can be printed during `plan`, diffed between runs, and
 * unit-tested without a database.
 *
 * THE WRITE IS ONE RPC AND NOTHING ELSE.
 *
 *   SELECT public.forever_project_media_semantic_projection($project, $media);
 *
 * Not a hand-written UPDATE. That function is the shipped, SECURITY DEFINER,
 * presence-aware projection: it skips an item that omits `semantic_role` and an
 * item whose role is blank, so a batch can never erase a role it did not
 * mention. It is also the only thing `service_role` is granted — `REVOKE ALL …
 * FROM PUBLIC, anon, authenticated` then `GRANT EXECUTE … TO service_role` —
 * so reaching around it would mean writing to the table directly with wider
 * privilege than the design gives anything.
 *
 * IT MATCHES ON THE FULL NATURAL KEY `(project_id, media_type, url)`. That is
 * why the payload has one element per ROW while the plan has one entry per URL:
 * a URL held by a `cover` row and a `gallery` row needs both named, or the
 * unnamed one stays role-less and `prohibitedPhotographUrls` — which is per
 * URL — never learns about it.
 *
 * COVER RETIREMENT IS DELIBERATELY NOT PERFORMED. `forever_project_cover_
 * reconcile` and `_withdraw` exist and `service_role` may call them. This lane
 * calls neither. Three reasons: roles alone satisfy every acceptance criterion,
 * because the presentation rules are per URL; `superseded_cover` sits outside
 * `GOVERNED_MEDIA_TYPES`, so retiring a role-less row would make the gate
 * cleaner by REMOVING it from the denominator — the same false-pass shape as
 * writing "unknown"; and choosing which image represents a project is a
 * publication decision, not a data-repair one.
 */

import { canonicalJson } from "./canonical";
import type { ManifestProject } from "./types";

/**
 * One element per production ROW, not per URL.
 *
 * `forever_project_media_semantic_projection` iterates the array and matches
 * each element on `(project_id, media_type, url)`. An element per URL would
 * classify whichever row happened to share the URL's media type and leave the
 * sibling untouched.
 */
export function rpcPayloadForProject(
  project: ManifestProject,
): Array<{ media_type: string; url: string; semantic_role: string }> {
  const payload: Array<{ media_type: string; url: string; semantic_role: string }> = [];
  for (const entry of project.urls) {
    if (!entry.proposed_semantic_role) continue;
    for (const row of entry.rows) {
      payload.push({
        media_type: row.media_type,
        url: entry.url,
        semantic_role: entry.proposed_semantic_role,
      });
    }
  }
  return payload;
}

/**
 * The per-project role digest, computed the way the client computes it.
 *
 * `COLLATE "C"` is not decoration. Without it the ordering inside `string_agg`
 * depends on the database's collation, and the client — which sorts by UTF-8
 * bytes — would disagree with the server on any URL outside ASCII. A digest
 * that differs by locale is a guard that blocks correct runs on some machines,
 * which is the kind of guard people learn to skip.
 */
export const PROJECT_ROLE_DIGEST_SQL = `
  SELECT md5(coalesce(string_agg(t, chr(10) ORDER BY t COLLATE "C"), ''))
    FROM (SELECT media_type || '|' || url || '|' || coalesce(semantic_role, '') AS t
            FROM public.project_media
           WHERE project_id = $1::uuid) s
`.trim();

/**
 * Which of the business relations exist on this target.
 *
 * Probed separately, and this is not caution for its own sake: in PostgreSQL a
 * statement referencing a missing table fails during parse analysis, so
 * `CASE WHEN to_regclass('public.units') IS NULL THEN … ELSE (SELECT … FROM
 * public.units) END` does NOT protect anything — the whole statement errors
 * before the CASE is evaluated. Composing the invariant query from what is
 * actually present is the only guard that works without dynamic SQL.
 */
export const RELATION_PRESENCE_SQL = `
  SELECT to_regclass('public.units') IS NOT NULL AS has_units,
         to_regclass('public.unit_price_history') IS NOT NULL AS has_unit_price_history,
         to_regclass('public.buildings') IS NOT NULL AS has_buildings,
         to_regclass('public.projects') IS NOT NULL AS has_projects,
         to_regclass('public.project_media') IS NOT NULL AS has_project_media
`.trim();

export interface RelationPresence {
  units: boolean;
  unitPriceHistory: boolean;
  buildings: boolean;
  projects: boolean;
  projectMedia: boolean;
}

export const ALL_RELATIONS_PRESENT: RelationPresence = {
  units: true,
  unitPriceHistory: true,
  buildings: true,
  projects: true,
  projectMedia: true,
};

function digestOf(expression: string, from: string, where: string): string {
  return (
    `(SELECT coalesce(md5(string_agg(t, chr(10) ORDER BY t COLLATE "C")), 'empty') ` +
    `FROM (SELECT ${expression} AS t FROM ${from} WHERE ${where}) s)`
  );
}

/**
 * Five digests over everything this backfill must not change.
 *
 * The last one is the load-bearing one: `project_media` hashed over every
 * column EXCEPT `semantic_role`. One comparison proves in a single value that
 * no `media_type` was rewritten, no `url` moved, no `sort_order` shuffled, no
 * `title` or `metadata` touched — and therefore that no cover was retired,
 * which is the specific thing this lane promises not to do. `units` carries
 * `availability_status`, which is where SOLD lives; `unit_price_history` is
 * counted as well as hashed, so a deletion is visible even if the survivors
 * hash the same.
 *
 * These are ENFORCING, not observational. The transaction computes them before
 * and after and rolls the project back on any difference.
 */
export function businessInvariantSql(present: RelationPresence = ALL_RELATIONS_PRESENT): string {
  const absent = `'absent'::text`;
  const parts = [
    present.units
      ? digestOf(
          `id::text || '|' || coalesce(project_id::text,'') || '|' || coalesce(unit_code,'') || '|' || ` +
            `coalesce(unit_type,'') || '|' || coalesce(availability_status,'') || '|' || ` +
            `coalesce(base_price_thb::text,'') || '|' || coalesce(updated_at::text,'')`,
          "public.units",
          "project_id = $1::uuid",
        )
      : absent,
    present.unitPriceHistory && present.units
      ? digestOf(
          // `price` and `currency`, not `price_thb`. This said `h.price_thb`
          // and no unit test could see it: the column does not exist on
          // `unit_price_history` (only `units` has `base_price_thb`), so
          // PostgreSQL failed the whole statement during parse analysis, inside
          // the DO block, on every project — the backfill could not have
          // committed a single row on any database that has the table. The
          // disposable-cluster proof is what found it.
          //
          // `currency` is hashed alongside the amount because 20260718113000
          // dropped its NOT NULL and its default: an amount whose currency
          // changed from THB to something else is a different price, and an
          // invariant that hashed only the number would call that unchanged.
          `h.id::text || '|' || h.unit_id::text || '|' || coalesce(h.price::text,'') || '|' || ` +
            `coalesce(h.currency,'') || '|' || coalesce(h.recorded_at::text,'')`,
          "public.unit_price_history h JOIN public.units u ON u.id = h.unit_id",
          "u.project_id = $1::uuid",
        )
      : absent,
    present.buildings
      ? digestOf(
          `id::text || '|' || coalesce(project_id::text,'') || '|' || coalesce(name,'') || '|' || ` +
            `coalesce(building_code,'')`,
          "public.buildings",
          "project_id = $1::uuid",
        )
      : absent,
    present.projects
      ? digestOf(
          `id::text || '|' || coalesce(slug,'') || '|' || coalesce(name,'') || '|' || ` +
            `is_active::text || '|' || coalesce(public_status,'') || '|' || ` +
            `coalesce(main_image_url,'') || '|' || coalesce(updated_at::text,'')`,
          "public.projects",
          "id = $1::uuid",
        )
      : absent,
    present.projectMedia
      ? digestOf(
          `id::text || '|' || project_id::text || '|' || media_type || '|' || url || '|' || ` +
            `sort_order::text || '|' || coalesce(title,'') || '|' || coalesce(metadata::text,'')`,
          "public.project_media",
          "project_id = $1::uuid",
        )
      : absent,
  ];
  return (
    `SELECT ${parts[0]} AS units_digest, ${parts[1]} AS price_history_digest, ` +
    `${parts[2]} AS buildings_digest, ${parts[3]} AS projects_digest, ` +
    `${parts[4]} AS media_non_role_digest`
  );
}

/** The all-present form, which is what production and the pg harness both are. */
export const BUSINESS_INVARIANT_SQL = businessInvariantSql();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A UUID as a SQL literal, validated rather than escaped.
 *
 * Escaping would be enough to be safe and not enough to be right: a value that
 * is not a UUID here means the manifest is describing something other than a
 * project, and quoting it would let the run continue against whatever it is.
 */
function sqlUuid(value: string): string {
  if (!UUID.test(value)) throw new Error(`Refusing to build SQL for a non-UUID project id.`);
  return `'${value}'::uuid`;
}

/**
 * JSON as a dollar-quoted literal, with a tag proven absent from the payload.
 *
 * Doubling single quotes would work too, and it is the thing that silently
 * stops working the day a URL contains one. A dollar-quote cannot be escaped
 * out of; the only failure mode is the tag appearing inside the payload, and
 * that is checked rather than assumed.
 */
function sqlJson(value: unknown): string {
  const text = JSON.stringify(value);
  let tag = "fb";
  while (text.includes(`$${tag}$`)) tag += "x";
  return `$${tag}$${text}$${tag}$::jsonb`;
}

/**
 * The token the runner looks for to decide the transaction reached its end.
 *
 * It is a SELECT, and it has to be. The block also raises a NOTICE carrying the
 * counts, and a NOTICE is a server message: `psql` writes it to STDERR, while
 * `execFileSync` hands the caller STDOUT. So the runner's
 * `output.includes("forever_backfill_ok")` never matched, and EVERY project whose
 * transaction actually ran was recorded `project_failed` with
 * `rolled_back: true` — after its COMMIT had already landed. The disposable
 * cluster is what surfaced it: the roles were provably written while the run
 * reported that nothing had been.
 *
 * With `ON_ERROR_STOP` set, a RAISE inside the block aborts the script before
 * this line, so the marker's absence still means "the transaction did not
 * complete" — which is what the runner concludes from it.
 */
export const APPLY_MARKER = "forever_backfill_ok";
const MARKER_SELECT = `SELECT '${APPLY_MARKER}' AS forever_backfill;`;

export interface ProjectApplyOptions {
  /** ROLLBACK instead of COMMIT. Every check still runs and still reports. */
  dryRun: boolean;
  relations?: RelationPresence;
}

/**
 * The statements one project's transaction issues, in order, for review.
 *
 * Printed by `plan` so the Owner can read the SQL before approving the run,
 * rather than approving a description of it.
 */
export function projectStatements(project: ManifestProject): readonly string[] {
  const payload = rpcPayloadForProject(project);
  return [
    "BEGIN;",
    "SET LOCAL statement_timeout = '60s';",
    "SET LOCAL idle_in_transaction_session_timeout = '60s';",
    `-- (a) business invariants BEFORE (5 digests, computed server-side)`,
    BUSINESS_INVARIANT_SQL,
    `-- (b) role digest; must equal role_digest_before (${project.role_digest_before}) or ROLLBACK`,
    PROJECT_ROLE_DIGEST_SQL,
    `-- (c) the one write: ${payload.length} row(s) named explicitly, one element per row`,
    `SELECT public.forever_project_media_semantic_projection($1::uuid, $2::jsonb) AS applied;`,
    `-- (d) business invariants AFTER; ANY difference -> ROLLBACK`,
    BUSINESS_INVARIANT_SQL,
    `-- (e) role digest; must equal role_digest_expected_after (${project.role_digest_expected_after})`,
    PROJECT_ROLE_DIGEST_SQL,
    `-- (f) zero governed rows of this project hold a value outside the vocabulary`,
    OUT_OF_VOCABULARY_SQL,
    `-- (g) the completion marker the runner reads, on stdout where it can see it`,
    MARKER_SELECT,
    "COMMIT;",
  ];
}

/**
 * Belt and braces against the CHECK constraint not being in force.
 *
 * The migration adds `project_media_semantic_role_vocabulary`, so this should
 * be unreachable. "Should be" is why it is checked: if the constraint was not
 * applied, the run would have written free text into a column two public
 * readers select, and the census would then block the release with
 * `outOfVocabulary` — after the bytes were already public.
 */
export const OUT_OF_VOCABULARY_SQL = `
  SELECT count(*) FROM public.project_media
   WHERE project_id = $1::uuid
     AND semantic_role IS NOT NULL
     AND semantic_role NOT IN (
       'property_exterior','property_aerial','property_pool_exterior','villa_exterior',
       'architecture_render','property_interior','amenity','landscape','lifestyle','event',
       'group_photo','portrait','decorative_detail','text_promo','plan','map','unknown')
`.trim();

/**
 * The whole transaction as one script, with every check inside it.
 *
 * Written as a single PL/pgSQL block on purpose. Reading intermediate results
 * out to the client and deciding COMMIT from there needs an interactive
 * session, and any gap between "the client decided to roll back" and "the
 * rollback happened" is a window in which the process can die with the
 * transaction open. Raising inside the block aborts it, so a failed assertion
 * and a crashed connection have the same outcome, which is the outcome we want.
 */
export function projectApplyScript(project: ManifestProject, options: ProjectApplyOptions): string {
  const payload = rpcPayloadForProject(project);
  const id = sqlUuid(project.project_id);
  // The inner literal is dollar-quoted with its own tag, which is safe inside
  // the outer block only while the two tags differ. Checked, not assumed: a URL
  // carrying the outer tag would end the block early and turn the remainder of
  // the script into free-standing SQL.
  const OUTER_TAG = "$forever_backfill$";
  const payloadLiteral = sqlJson(payload);
  if (payloadLiteral.includes(OUTER_TAG)) {
    throw new Error(
      `Refusing to build SQL: a media URL contains the block delimiter ${OUTER_TAG}.`,
    );
  }
  const invariants = businessInvariantSql(options.relations ?? ALL_RELATIONS_PRESENT).replace(
    /\$1::uuid/g,
    id,
  );
  const roleDigest = PROJECT_ROLE_DIGEST_SQL.replace(/\$1::uuid/g, id);
  const outOfVocabulary = OUT_OF_VOCABULARY_SQL.replace(/\$1::uuid/g, id);

  return `\\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
DO $forever_backfill$
DECLARE
  v_before_role text; v_after_role text;
  v_b1 text; v_b2 text; v_b3 text; v_b4 text; v_b5 text;
  v_a1 text; v_a2 text; v_a3 text; v_a4 text; v_a5 text;
  v_applied integer; v_bad integer;
BEGIN
  ${invariants}
    INTO v_b1, v_b2, v_b3, v_b4, v_b5;
  ${roleDigest} INTO v_before_role;

  IF v_before_role IS DISTINCT FROM ${quote(project.role_digest_before)} THEN
    RAISE EXCEPTION 'role_digest_before mismatch for ${project.slug}: observed %, planned %',
      v_before_role, ${quote(project.role_digest_before)}
      USING ERRCODE = 'data_exception';
  END IF;

  SELECT public.forever_project_media_semantic_projection(${id}, ${payloadLiteral})
    INTO v_applied;
  IF v_applied IS DISTINCT FROM ${payload.length} THEN
    RAISE EXCEPTION 'rpc applied % row(s), plan named ${payload.length} for ${project.slug}', v_applied
      USING ERRCODE = 'data_exception';
  END IF;

  ${invariants.replace(/^SELECT /, "SELECT ")}
    INTO v_a1, v_a2, v_a3, v_a4, v_a5;
  IF (v_a1, v_a2, v_a3, v_a4, v_a5) IS DISTINCT FROM (v_b1, v_b2, v_b3, v_b4, v_b5) THEN
    RAISE EXCEPTION 'business invariant changed for ${project.slug}: units %/%, prices %/%, buildings %/%, project %/%, media-non-role %/%',
      v_b1, v_a1, v_b2, v_a2, v_b3, v_a3, v_b4, v_a4, v_b5, v_a5
      USING ERRCODE = 'data_exception';
  END IF;

  ${roleDigest} INTO v_after_role;
  IF v_after_role IS DISTINCT FROM ${quote(project.role_digest_expected_after)} THEN
    RAISE EXCEPTION 'role_digest_expected_after mismatch for ${project.slug}: observed %, planned %',
      v_after_role, ${quote(project.role_digest_expected_after)}
      USING ERRCODE = 'data_exception';
  END IF;

  ${outOfVocabulary} INTO v_bad;
  IF v_bad <> 0 THEN
    RAISE EXCEPTION '% row(s) of ${project.slug} hold a role outside the vocabulary — the CHECK constraint is not in force', v_bad
      USING ERRCODE = 'data_exception';
  END IF;

  RAISE NOTICE 'forever_backfill_ok slug=${project.slug} applied=% after=% invariant=%',
    v_applied, v_after_role, md5(v_b1||v_b2||v_b3||v_b4||v_b5);
END
$forever_backfill$;
${MARKER_SELECT}
${options.dryRun ? "ROLLBACK;" : "COMMIT;"}
`;
}

/** A SQL string literal. Only ever used for digests, which are hex. */
function quote(value: string): string {
  return `'${value.split("'").join("''")}'`;
}

/** The manifest fragment one project's plan digest covers, for the journal. */
export function projectPlanDigestInput(project: ManifestProject): string {
  return canonicalJson({
    project_id: project.project_id,
    slug: project.slug,
    role_digest_before: project.role_digest_before,
    role_digest_expected_after: project.role_digest_expected_after,
    payload: rpcPayloadForProject(project),
  });
}
