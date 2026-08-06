/**
 * FOREVER-STUDIO-EXPLICIT-BINDINGS-FIX-002 — the lifecycle of the one release
 * artefact that carries values.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A MODULE AND NOT FOUR LINES IN THE WRAPPER
 * ---------------------------------------------------------------------------
 *
 * Under pinned inheritance the ephemeral upload specification carried a name and
 * a version UUID, so leaving it on disk after a release was untidy rather than
 * dangerous. It now carries `SUPABASE_URL` and `STUDIO_STORAGE_WRITE_PROVIDER`.
 * A file like that must not outlive the spawn that needs it, and "the wrapper
 * deletes it afterwards" is exactly the kind of claim that stays true in the
 * happy path and quietly stops being true the first time something throws.
 *
 * So the lifetime is a function with the cleanup in a `finally`, and the tests
 * assert the file is gone after a SUCCESSFUL run and after a FAILED one — the
 * second being the case a wrapper-local `rmSync` at the end of the happy path
 * would miss.
 *
 * ---------------------------------------------------------------------------
 * WHAT "RESTRICTED" HONESTLY MEANS ON WINDOWS
 * ---------------------------------------------------------------------------
 *
 * The file is created with `flag: "wx"` — exclusive create, so a pre-existing
 * specification is a STOP rather than something to overwrite — and `mode: 0o600`.
 *
 * On POSIX that mode is owner-read/write and nothing else. On Windows, Node maps
 * only the read-only attribute and the file otherwise inherits the parent
 * directory's ACL; there is no portable Node API for a DACL, and shelling out to
 * `icacls` during an authorized release is a worse trade than being precise
 * about the limit. So the guarantee this module actually provides on Windows is:
 * created exclusively, mode requested, and DELETED promptly on every path. That
 * is the true statement, and it is the one the runbook makes.
 *
 * ---------------------------------------------------------------------------
 * THE EEXIST RACE, NORMALIZED (PR140 review, F9)
 * ---------------------------------------------------------------------------
 *
 * The upload wrapper checks `existsSync(specification)` early and STOPs when one
 * is already there. That check and the exclusive create are separated by the
 * whole preflight, so a concurrent release can win the gap: the check passes,
 * the create then fails with `EEXIST`.
 *
 * A raw `EEXIST` is the RIGHT outcome — nothing is overwritten — but it was not
 * the DOCUMENTED one. It surfaced as an unhandled `writeFileSync` exception, so
 * the wrapper aborted with a stack trace instead of the fail-closed STOP, and
 * its own temporary directories were never cleaned. The failure is therefore
 * normalized here into a NAMED refusal the wrapper can map onto the same STOP as
 * the early check, without this module knowing anything about the wrapper.
 *
 * WHAT MUST REMAIN TRUE ON THAT PATH: the pre-existing file is neither
 * overwritten nor deleted — it belongs to the other run and is evidence — and
 * `run` is never invoked, so no launcher can be reached.
 */

import { rmSync, writeFileSync } from "node:fs";

/** The mode requested for the value-carrying specification. */
export const EPHEMERAL_SPECIFICATION_MODE = 0o600;

/** The named STOP a lost exclusive-create race produces. */
export const EPHEMERAL_SPECIFICATION_EXISTS_STOP = "upload_specification_already_exists";

/**
 * A lost exclusive-create race, as a typed refusal rather than a raw `EEXIST`.
 *
 * Carries no path and no body: the caller already knows the repository-relative
 * path it asked for, and the file's contents belong to the other run.
 */
export class EphemeralSpecificationExistsError extends Error {
  readonly stop = EPHEMERAL_SPECIFICATION_EXISTS_STOP;

  constructor() {
    super(
      "an upload specification already existed at the ephemeral path when this release tried to " +
        "create it exclusively. It was NOT overwritten and NOT deleted.",
    );
    this.name = "EphemeralSpecificationExistsError";
  }
}

/** TRUE only for the normalized lost-race refusal. */
export function isEphemeralSpecificationExistsError(
  error: unknown,
): error is EphemeralSpecificationExistsError {
  return (
    error instanceof EphemeralSpecificationExistsError ||
    (typeof error === "object" &&
      error !== null &&
      (error as { stop?: unknown }).stop === EPHEMERAL_SPECIFICATION_EXISTS_STOP)
  );
}

/**
 * Writes the ephemeral specification, refusing to overwrite an existing one.
 *
 * A specification already at this path was written by something that is not
 * this release — a crashed run, a concurrent one, or an operator. Overwriting it
 * would destroy the evidence of whichever it was, so `wx` refuses and the
 * refusal is re-thrown as the named STOP above. Any OTHER filesystem error is
 * left exactly as Node raised it: it is not a race, and disguising it as one
 * would be a worse report than no report.
 */
export function writeEphemeralSpecification(absolutePath: string, body: string): void {
  try {
    writeFileSync(absolutePath, body, {
      encoding: "utf8",
      flag: "wx",
      mode: EPHEMERAL_SPECIFICATION_MODE,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === "EEXIST") {
      throw new EphemeralSpecificationExistsError();
    }
    throw error;
  }
}

/**
 * Removes the ephemeral specification. Never throws.
 *
 * Cleanup runs on the failure path too, where an exception would replace the
 * real refusal with a filesystem error and lose the reason the release stopped.
 * Returns whether the path is absent afterwards.
 */
export function removeEphemeralSpecification(absolutePath: string): boolean {
  try {
    rmSync(absolutePath, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs `run` with the specification on disk and removes it afterwards, ALWAYS.
 *
 * The `finally` is the point of the function: `run` throwing, returning a
 * refusal, or completing normally all reach the same cleanup. The return value
 * and any thrown error are passed through untouched, so a caller sees exactly
 * what happened.
 *
 * `onCleanupFailure` exists so a wrapper can report a file it could not remove
 * — the one case where a value could outlive the release — without this module
 * needing a logger.
 *
 * THE CREATE IS DELIBERATELY OUTSIDE THE `try`. If the exclusive create loses
 * the race, the `finally` must NOT run: the file on disk belongs to the other
 * release and this function has no business deleting it. `run` has not been
 * called at that point either, so nothing downstream — no launcher, no spawn —
 * is reachable from the refusal.
 */
export function withEphemeralSpecification<T>(input: {
  readonly absolutePath: string;
  readonly body: string;
  readonly run: () => T;
  readonly onCleanupFailure?: () => void;
}): T {
  writeEphemeralSpecification(input.absolutePath, input.body);
  try {
    return input.run();
  } finally {
    if (!removeEphemeralSpecification(input.absolutePath)) input.onCleanupFailure?.();
  }
}

/**
 * Classifies a specification-lifecycle failure for a caller that must STOP.
 *
 * The wrapper maps a lost race onto the SAME fail-closed STOP as its early
 * existence check, so an operator sees one documented refusal rather than two
 * different failures for one condition. Returning a description — rather than
 * logging or exiting — keeps this module free of a logger and lets the decision
 * be asserted directly.
 */
export function describeEphemeralSpecificationFailure(error: unknown): {
  readonly preExisting: boolean;
  readonly stop: string | null;
  readonly message: string;
} {
  if (isEphemeralSpecificationExistsError(error)) {
    return {
      preExisting: true,
      stop: EPHEMERAL_SPECIFICATION_EXISTS_STOP,
      message:
        "an upload specification appeared at the ephemeral path between the existence check and " +
        "the exclusive create, so a concurrent or crashed release owns it. It was NOT overwritten " +
        "and NOT deleted — investigate and remove it deliberately.",
    };
  }
  return {
    preExisting: false,
    stop: null,
    message:
      "the ephemeral upload specification could not be created. The underlying error is not " +
      "echoed, because it may quote the document.",
  };
}
