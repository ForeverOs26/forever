/**
 * The refusals, in the order they must happen
 * (FOREVER-SEMANTIC-MEDIA-BACKFILL-001).
 *
 * Order is the substance here, not presentation. Guard 8 refuses staging BEFORE
 * anything opens a connection, because "we connected to staging read-only and
 * then refused" is still a run that contacted a database it was told never to
 * contact. Everything cheap and local — flags, digests, the manifest's own
 * consistency — happens first, so the common failure is a refusal that never
 * touched the network.
 *
 * Pure string and environment reasoning. No I/O beyond `resolve`, no
 * credentials read, nothing echoed.
 */

import { isAbsolute, relative, resolve } from "node:path";

import { PRODUCTION_PROJECT_REF, STAGING_PROJECT_REF } from "../forever-direct-publish/target";

export { PRODUCTION_PROJECT_REF, STAGING_PROJECT_REF };

export class GuardError extends Error {
  readonly code: string;
  readonly exitCode: number;

  constructor(code: string, exitCode: number, message: string) {
    super(message);
    this.name = "GuardError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

/**
 * The journal must live outside the repository.
 *
 * Twice over. A journal inside the working tree gets committed, and it records
 * which production rows were written and when — operational detail that has no
 * business in a public branch. And `git checkout` or a `clean` between a crash
 * and a resume would delete the only record of what had already been applied,
 * turning a recoverable interruption into the `partial_irrecoverable` case.
 */
export function assertJournalOutsideRepo(journalPath: string, repoRoot: string): void {
  const journal = resolve(journalPath);
  const root = resolve(repoRoot);
  const rel = relative(root, journal);
  const inside = rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  if (inside) {
    throw new GuardError(
      "journal_inside_repo",
      2,
      `The journal must not be written inside the repository (${rel}). It records which ` +
        `production rows were written, and a checkout between a crash and a resume would ` +
        `delete the only record of what had already been applied. Choose a path outside the ` +
        `working tree.`,
    );
  }
}

/**
 * Ambient credentials are refused, and the variable is named.
 *
 * There is no `DATABASE_URL` fallback, no `SUPABASE_DB_URL` fallback and no
 * `.env` fallback, for the same reason the census gate has none: the failure
 * mode of a convenient default is "the Owner ran the backfill against
 * production while meaning to check a copy". Refusing silently would be worse
 * than refusing loudly — the operator would retry with the same environment and
 * get the same unexplained refusal — so the offending variable is named. The
 * NAME is printed; the value never is.
 */
const AMBIENT_VARIABLES = [
  "DATABASE_URL",
  "SUPABASE_DB_URL",
  "POSTGRES_URL",
  "PGDATABASE",
  "PGHOST",
  "PGUSER",
  "PGPASSWORD",
];

export function assertNoAmbientCredentials(
  env: NodeJS.ProcessEnv,
  explicitSourceGiven: boolean,
): void {
  if (explicitSourceGiven) return;
  const present = AMBIENT_VARIABLES.filter((name) => {
    const value = env[name];
    return typeof value === "string" && value.trim() !== "";
  });
  if (present.length === 0) return;
  throw new GuardError(
    "ambient_credentials_present",
    2,
    `No --snapshot and no --database-url were given, and the environment already carries ` +
      `${present.join(", ")}. This tool has no ambient fallback by design: pass the target ` +
      `explicitly or unset ${present[0]}. (The variable name is shown; its value is not read.)`,
  );
}

export interface RefSource {
  snapshotRef?: string;
  databaseUrl?: string;
}

/**
 * The ref carried by a connection string, or null when it names no Supabase
 * project.
 *
 * A Supabase database URL is `postgres://…@db.<ref>.supabase.co:5432/postgres`
 * or a pooler host carrying `postgres.<ref>` as the user. Both are recognised;
 * anything unrecognised returns null, and the caller refuses rather than
 * guessing, because a guess decides which database gets written to.
 */
export function refFromDatabaseUrl(databaseUrl: string | null | undefined): string | null {
  const text = (databaseUrl ?? "").trim();
  if (!text) return null;
  const host = /(?:^|[@/])db\.([a-z0-9]{20})\.supabase\.(?:co|com)/i.exec(text);
  if (host) return host[1].toLowerCase();
  const pooler = /(?:^|[:/])postgres\.([a-z0-9]{20})(?=[:@])/i.exec(text);
  if (pooler) return pooler[1].toLowerCase();
  const bare = /\b([a-z0-9]{20})\.supabase\.(?:co|com)/i.exec(text);
  if (bare) return bare[1].toLowerCase();
  return null;
}

/**
 * Derive the project ref from what this run actually contacts — and from
 * nothing else.
 *
 * An earlier version consulted `process.env.SUPABASE_URL` first, and that was a
 * genuine hole rather than an untidiness. The Owner's credentials file exports
 * `SUPABASE_URL=https://abtvsrcnfwlbawvrjeed.supabase.co`, so in the Owner's
 * normal shell the ref was decided by the environment and the `--database-url`
 * was never consulted at all: a connection string naming staging passed the
 * staging refusal, and `--production --confirm-project-ref <production>`
 * authorised a write to whatever that string really pointed at. The flag agreed
 * with the environment, not with the target. An independent review reproduced
 * both at the CLI.
 *
 * So: the connection string wins, because the connection string is what opens
 * the socket. The snapshot ref is used only when there is no connection at all,
 * which is exactly the offline `plan --snapshot` case. And when both are present
 * they must agree — see `assertTargetRefsAgree` — because a plan whose digests
 * describe one database while the connection names another is a manifest that
 * cannot be verified against the thing it will be applied to.
 */
export function refFromTarget(input: RefSource): string | null {
  const fromConnection = refFromDatabaseUrl(input.databaseUrl);
  if (fromConnection) return fromConnection;
  if ((input.databaseUrl ?? "").trim()) return null;
  const snapshot = (input.snapshotRef ?? "").trim();
  return snapshot ? snapshot : null;
}

/**
 * A snapshot and a connection may not describe different databases.
 *
 * Without this, `--snapshot` (production) plus `--database-url` (anything else)
 * silently produces a run that verified its digests against one database and
 * wrote to another. Refused rather than reconciled: there is no correct way to
 * choose between them.
 */
export function assertTargetRefsAgree(
  snapshotRef: string | null | undefined,
  databaseUrl: string | null | undefined,
): void {
  const snapshot = (snapshotRef ?? "").trim();
  const connection = refFromDatabaseUrl(databaseUrl);
  if (!snapshot || !connection) return;
  if (snapshot === connection) return;
  throw new GuardError(
    "snapshot_target_mismatch",
    4,
    `The snapshot was captured from project ${snapshot} but --database-url names ` +
      `${connection}. A plan verified against one database must not be applied to another.`,
  );
}

export interface TargetPermissionOptions {
  /** The explicit production marker flag. Never inferred. */
  production: boolean;
  /** The ref the operator typed out in full, or null. */
  confirmRef: string | null;
  /**
   * The explicit acknowledgement that this target is a throwaway cluster.
   *
   * Required for every write to a target that names no Supabase project.
   */
  disposableTarget: boolean;
  /**
   * True whenever this run opens a write transaction — `execute`, INCLUDING
   * `--dry-run`.
   *
   * Not "true when rows are kept". A dry run issues the real `BEGIN`, the real
   * `forever_project_media_semantic_projection` over every planned row, and only
   * then `ROLLBACK`: it takes real row locks on real rows for the length of the
   * statement. An earlier version set this false for a dry run, so
   * `execute --dry-run` against production skipped the production marker and the
   * ref confirmation entirely — the operating sequence prescribed both, and the
   * tool required neither. An independent review reproduced it.
   */
  opensTransaction: boolean;
}

/**
 * Whether this run may proceed against this target.
 *
 * Staging is refused unconditionally, first, in every mode — including `plan`
 * and `--dry-run`. A read-only plan against staging would produce a manifest
 * whose digests describe staging and whose `target.project_ref` says so, and
 * the only thing standing between that file and a production run would be
 * somebody noticing. Refusing at the source removes the artifact entirely.
 *
 * Writes need one of exactly two authorisations, and they are mutually
 * exclusive by construction:
 *
 *   production target  →  `--production` AND `--confirm-project-ref <ref>`
 *   ref-less target    →  `--disposable-target`
 *
 * The second exists because a ref is read out of the connection string's host,
 * and not every route to production carries one — an IP address, an SSH tunnel
 * or a local proxy all name no project. Allowing an unmarked write whenever the
 * ref is merely *unrecognised* would mean the strength of the guard depended on
 * the spelling of a hostname. Requiring a positive claim instead means an
 * operator who reaches production through a tunnel has to have typed
 * "disposable", which is a statement they cannot make by accident.
 */
export function assertTargetPermitted(ref: string | null, options: TargetPermissionOptions): void {
  if (ref === STAGING_PROJECT_REF) {
    throw new GuardError(
      "target_is_staging",
      4,
      `Refusing to run: the target is staging ${STAGING_PROJECT_REF}. This lane never contacts ` +
        `staging, in any mode, including plan and --dry-run.`,
    );
  }

  if (options.production && ref !== PRODUCTION_PROJECT_REF) {
    throw new GuardError(
      "target_not_production",
      4,
      `--production was passed but the target ref is ${ref ?? "unverifiable"}, not ` +
        `${PRODUCTION_PROJECT_REF}. The flag and the target must agree; a run must never be ` +
        `production because of what happened to be in the environment.`,
    );
  }

  if (options.disposableTarget && ref === PRODUCTION_PROJECT_REF) {
    throw new GuardError(
      "disposable_claim_on_production",
      4,
      `--disposable-target was passed but the target ref is ${PRODUCTION_PROJECT_REF}. ` +
        `Production is not a disposable cluster; the two markers are mutually exclusive.`,
    );
  }

  if (!options.opensTransaction) return;

  if (ref === PRODUCTION_PROJECT_REF) {
    if (!options.production) {
      throw new GuardError(
        "production_marker_missing",
        5,
        `--execute opens a write transaction against production and requires --production as a ` +
          `separate, explicit statement of intent. This applies to --dry-run too: a dry run ` +
          `issues the real BEGIN and the real UPDATE before it rolls back.`,
      );
    }
    if (confirmMismatch(options.confirmRef)) {
      throw new GuardError(
        "ref_confirmation_missing",
        5,
        `--confirm-project-ref must be typed literally as ${PRODUCTION_PROJECT_REF}. Typing the ` +
          `ref out is the last point at which "wrong database" is still cheap; it is deliberately ` +
          `not something a shell history can supply by accident.`,
      );
    }
    return;
  }

  if (!options.disposableTarget) {
    throw new GuardError(
      "disposable_marker_missing",
      5,
      `--execute opens a write transaction against a target that names no Supabase project ` +
        `(ref ${ref ?? "unverifiable"}). Pass --disposable-target to state that this is a ` +
        `throwaway cluster. --execute alone never writes anywhere.`,
    );
  }
}

function confirmMismatch(confirmRef: string | null): boolean {
  return (confirmRef ?? "").trim() !== PRODUCTION_PROJECT_REF;
}

/**
 * Refuse an output path that would write into the repository or a private tree.
 *
 * The manifest and the report carry every production URL and every classifier
 * reason. Neither belongs in the working tree, and neither belongs in an
 * Owner-private folder that other tooling scans.
 */
export function assertWritablePath(path: string, repoRoot: string, label: string): void {
  const target = resolve(path);
  const rel = relative(resolve(repoRoot), target);
  if (rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)) {
    throw new GuardError(
      "output_inside_repo",
      2,
      `${label} would be written inside the repository (${rel}). Release artifacts carrying ` +
        `production URLs are kept outside the working tree so they cannot be committed by accident.`,
    );
  }
}
