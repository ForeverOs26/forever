/**
 * FOREVER-PR139-REVIEW-CORRECTIONS-001 — the FINAL pre-spawn guard, as an
 * importable decision rather than a line of script text.
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT THIS EXISTS TO REMOVE (PR139 independent review, P2-4)
 * ---------------------------------------------------------------------------
 *
 * The upload wrapper re-hashes the upload specification immediately before
 * spawning Wrangler, so a rebuild or an edit between PREUPLOAD and the spawn
 * cannot be uploaded unverified. That guard was protected by asserting the
 * wrapper's SOURCE TEXT:
 *
 *   expect(wrapper).toMatch(/\n\s*if \(consumedDigest !== verifiedDigest\) \{/)
 *
 * A source-text assertion proves the characters exist. It does not prove the
 * program refuses, does not prove the refusal happens BEFORE the spawn, and
 * cannot distinguish a live guard from one whose effect was moved, reordered or
 * made unreachable while the matched line stayed exactly where it was. The
 * mutation control built on it inherited the same limitation: it detected a
 * TEXT change, so it would have been "detected" by a rename that changed
 * nothing about behaviour, and missed a behavioural regression that left the
 * text intact.
 *
 * ---------------------------------------------------------------------------
 * THE SEAM
 * ---------------------------------------------------------------------------
 *
 * The decision — re-hash, compare, then either refuse or launch — is this
 * function. The LAUNCHER IS AN ARGUMENT. A test passes a spy and observes,
 * behaviourally, that a tampered specification produces the named STOP and that
 * the spy was NEVER CALLED. The production wrapper passes the real `spawnSync`
 * bound to the repository-locked Wrangler resolver.
 *
 * The seam is an IMPORT, not a flag: there is no CLI option and no environment
 * variable that swaps the launcher, so nothing an operator can set changes what
 * a production run spawns. That is deliberate — an injectable launcher reachable
 * from the command line would be a far larger hole than the one being closed.
 *
 * `launch` is invoked at exactly one place, after every guard has passed. There
 * is no early return that reaches it and no branch that skips a check.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

/** The named STOPs. Asserted by name, never by message text. */
export const UPLOAD_SPECIFICATION_MISSING_STOP = "upload_specification_missing";
export const UPLOAD_SPECIFICATION_DIGEST_MISMATCH_STOP = "upload_specification_digest_mismatch";
export const UPLOAD_SPECIFICATION_STRUCTURE_INVALID_STOP = "upload_specification_structure_invalid";
export const IMMUTABLE_BUILD_OUTPUT_CHANGED_STOP = "immutable_build_output_changed";

export type UploadLaunchStop =
  | typeof UPLOAD_SPECIFICATION_MISSING_STOP
  | typeof UPLOAD_SPECIFICATION_DIGEST_MISMATCH_STOP
  | typeof UPLOAD_SPECIFICATION_STRUCTURE_INVALID_STOP
  | typeof IMMUTABLE_BUILD_OUTPUT_CHANGED_STOP;

export interface UploadLaunchDecision<T> {
  /** TRUE only when `launch` was actually invoked. */
  readonly launched: boolean;
  /** The named refusal, or null when the upload was launched. */
  readonly stop: UploadLaunchStop | null;
  /** Operator-facing explanation. Carries no path, digest secret or raw output. */
  readonly message: string | null;
  /** The digest actually re-computed from disk, for the wrapper's own log line. */
  readonly consumedDigest: string | null;
  /** Whatever `launch` returned. Null whenever `launched` is false. */
  readonly result: T | null;
}

function refuse<T>(stop: UploadLaunchStop, message: string): UploadLaunchDecision<T> {
  return { launched: false, stop, message, consumedDigest: null, result: null };
}

/**
 * Re-proves the VERIFIED bytes are still the bytes about to be uploaded, then
 * launches — or refuses without launching.
 *
 * The two facts re-established here, both of which PREUPLOAD can only have
 * proven about a moment that has already passed:
 *
 *   - the ephemeral upload specification still hashes to the digest the
 *     preflight verified;
 *   - the immutable generated build output has not changed underneath it.
 *
 * "Verified one artefact, uploaded another" is the entire class of failure this
 * closes, and it is closed by refusing rather than by re-verifying the new bytes
 * — a specification that changed after PREUPLOAD has not been through PREUPLOAD.
 */
export function verifyThenLaunchUpload<T>(input: {
  /** Absolute path to the ephemeral upload specification. */
  readonly specificationPath: string;
  /** The digest PREUPLOAD agreed with. */
  readonly verifiedDigest: string;
  /** Absolute path to the immutable generated configuration. */
  readonly generatedConfigPath: string;
  /** The generated configuration's bytes, read before the preflight ran. */
  readonly generatedBytesBefore: Buffer;
  /**
   * How the digest is computed over the specification's bytes.
   *
   * FOREVER-STUDIO-EXPLICIT-BINDINGS-FIX-002. The specification now carries
   * `SUPABASE_URL` and `STUDIO_STORAGE_WRITE_PROVIDER`, and the latter has two
   * possible values — so a BARE SHA-256 of a document whose every other byte is
   * knowable is a two-guess oracle for a production setting. The wrapper
   * therefore supplies a per-release SALTED digest, and the salt never leaves
   * its memory. Defaults to a bare SHA-256 for callers hashing value-free bytes.
   */
  readonly digest?: (raw: string) => string;
  /**
   * Re-proves the STRUCTURE of the bytes about to be uploaded, not just their
   * digest.
   *
   * The digest proves the file did not change since PREUPLOAD. It cannot prove
   * PREUPLOAD verified the right thing if the two ever disagreed about which
   * document they were describing. Re-parsing here means the contract is
   * asserted against the exact bytes Wrangler will read, at the last possible
   * moment.
   */
  readonly revalidate?: (raw: string) => { readonly ok: boolean; readonly detail: string };
  /** Invoked once, only after every guard above has passed. */
  readonly launch: () => T;
}): UploadLaunchDecision<T> {
  const { specificationPath, verifiedDigest, generatedConfigPath, generatedBytesBefore } = input;
  const digest = input.digest ?? ((raw: string) => createHash("sha256").update(raw).digest("hex"));

  if (!existsSync(specificationPath)) {
    return refuse(
      UPLOAD_SPECIFICATION_MISSING_STOP,
      "the verified upload specification no longer exists.",
    );
  }

  const raw = readFileSync(specificationPath, "utf8");
  const consumedDigest = digest(raw);

  // MUTATION CONTROL 37 attacks exactly this comparison, and is now detected by
  // the injected launcher being called rather than by the source text differing.
  if (consumedDigest !== verifiedDigest) {
    return refuse(
      UPLOAD_SPECIFICATION_DIGEST_MISMATCH_STOP,
      "the upload specification changed after it was verified. PREUPLOAD is invalidated by any " +
        "later build or regeneration; re-run the whole gate rather than uploading these bytes.",
    );
  }

  if (input.revalidate) {
    const revalidation = input.revalidate(raw);
    if (!revalidation.ok) {
      return refuse(UPLOAD_SPECIFICATION_STRUCTURE_INVALID_STOP, revalidation.detail);
    }
  }

  if (!readFileSync(generatedConfigPath).equals(generatedBytesBefore)) {
    return refuse(
      IMMUTABLE_BUILD_OUTPUT_CHANGED_STOP,
      "the immutable generated configuration changed during the gate. The application build must " +
        "be byte-identical from verification to upload.",
    );
  }

  return {
    launched: true,
    stop: null,
    message: null,
    consumedDigest,
    result: input.launch(),
  };
}
