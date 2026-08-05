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
 */

import { rmSync, writeFileSync } from "node:fs";

/** The mode requested for the value-carrying specification. */
export const EPHEMERAL_SPECIFICATION_MODE = 0o600;

/**
 * Writes the ephemeral specification, refusing to overwrite an existing one.
 *
 * A specification already at this path was written by something that is not
 * this release — a crashed run, a concurrent one, or an operator. Overwriting it
 * would destroy the evidence of whichever it was.
 */
export function writeEphemeralSpecification(absolutePath: string, body: string): void {
  writeFileSync(absolutePath, body, {
    encoding: "utf8",
    flag: "wx",
    mode: EPHEMERAL_SPECIFICATION_MODE,
  });
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
