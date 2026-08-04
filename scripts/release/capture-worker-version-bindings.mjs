#!/usr/bin/env node
/**
 * FOREVER-PR138-MERGE-BLOCKER-CORRECTION-002 — mechanical binding capture.
 *
 * Turns ONE Cloudflare Worker version into ONE sanitized binding snapshot, so
 * the preservation preflight compares what Cloudflare actually returned rather
 * than what an operator expected it to return (independent-review P1-2).
 *
 * TWO MODES, AND ONLY ONE OF THEM TOUCHES THE NETWORK.
 *
 *   OFFLINE REVIEW (default — no credential, no network, no authorization):
 *     node scripts/release/capture-worker-version-bindings.mjs \
 *       --from-version-detail <raw-version-detail.json> \
 *       --version-id <worker-version-uuid> \
 *       --out <sanitized-snapshot.json>
 *
 *   AUTHORIZED RELEASE (requires an explicit --authorize-release):
 *     CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… \
 *     node scripts/release/capture-worker-version-bindings.mjs \
 *       --authorize-release --worker <name> \
 *       --live-version-id <discovered-worker-version-uuid> --out <live-snapshot.json>
 *
 *   CANDIDATE capture consumes the upload wrapper's immutable receipt, never
 *   an operator-retyped candidate UUID:
 *     node scripts/release/capture-worker-version-bindings.mjs \
 *       --authorize-release --worker <name> \
 *       --candidate-release-provenance <receipt.json> --out <candidate-snapshot.json>
 *
 * Release mode calls exactly one documented endpoint:
 *
 *   GET /accounts/{account_id}/workers/scripts/{script_name}/versions/{version_id}
 *
 * and requires `result.id` to equal the requested version id before it reads
 * `result.resources.bindings`.
 *
 * THE RAW RESPONSE NEVER LEAVES MEMORY. Cloudflare returns a `plain_text`
 * binding as `{ name, text, type }`, where `text` is the production value of
 * `SUPABASE_URL`; `secret_text` has the same shape. Therefore, and without
 * exception, this script:
 *
 *   - never writes the raw response, or any part of it, to disk;
 *   - never logs it;
 *   - never quotes a raw field in an error;
 *   - never stringifies a binding object;
 *   - reads exactly `name` and `type` from each binding and discards the rest.
 *
 * The only thing it writes is `{ schemaVersion, workerVersionId, bindings:
 * [{ name, type }] }`, and it re-validates that output against the closed
 * schema before writing it — so a future edit that started recording more than
 * name and class would fail here rather than at the next release.
 *
 * EXIT CODES
 *   0  one sanitized snapshot written
 *   1  STOP — the response was not the documented shape, a binding type is
 *      unrecognised, or the output would not satisfy the closed schema
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createJiti } from "jiti";

const REPO = process.cwd();
const jiti = createJiti(import.meta.url);

const capture = await jiti.import(resolve(REPO, "src/lib/stale-asset/worker-binding-capture.ts"));
const releaseIdentity = await jiti.import(
  resolve(REPO, "src/lib/stale-asset/worker-release-identity.ts"),
);

const {
  CLOUDFLARE_API_BASE,
  normalizeWorkerVersionDetail,
  serializeBindingSnapshot,
  validateBindingSnapshot,
} = capture;
const { verifyWorkerVersionProvenance } = releaseIdentity;

const log = (message) => process.stdout.write(`[capture-bindings] ${message}\n`);

function stop(message) {
  process.stderr.write(`[capture-bindings] STOP: ${message}\n`);
  process.exit(1);
}

function arg(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}
const has = (flag) => process.argv.includes(flag);

const out = arg("--out");
const fromFile = arg("--from-version-detail");
const authorized = has("--authorize-release");
const offlineVersionId = arg("--version-id");
const liveVersionId = arg("--live-version-id");
const candidateProvenancePath = arg("--candidate-release-provenance");

if (authorized && offlineVersionId) {
  stop(
    "--version-id is offline-fixture-only. Authorized capture requires --live-version-id from " +
      "deployment discovery or --candidate-release-provenance from the upload wrapper.",
  );
}
if (authorized && Boolean(liveVersionId) === Boolean(candidateProvenancePath)) {
  stop(
    "authorized capture requires exactly one of --live-version-id or " +
      "--candidate-release-provenance.",
  );
}

let versionId = authorized ? liveVersionId : offlineVersionId;
if (candidateProvenancePath) {
  const absolute = resolve(REPO, candidateProvenancePath);
  if (!existsSync(absolute)) stop("the candidate upload receipt was not found.");
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(absolute, "utf8"));
  } catch {
    stop("the candidate upload receipt is not valid JSON; its contents are not echoed.");
  }
  const verdict = verifyWorkerVersionProvenance(parsed);
  if (!verdict.accepted) {
    stop(
      `${verdict.refusal}: the candidate upload receipt failed the canonical identity contract.`,
    );
  }
  versionId = verdict.provenance.candidateWorkerVersionId;
}

if (!versionId) stop("an exact Worker version UUID source is required.");
if (!out) stop("--out <path> is required.");

/**
 * Reads one version-detail response.
 *
 * Offline mode reads a committed raw fixture. Release mode performs the single
 * documented GET. Neither path returns anything to a caller that might print
 * it: the value is handed straight to the normalizer.
 */
async function readVersionDetail() {
  if (!authorized) {
    if (!fromFile) {
      stop(
        "offline review mode needs --from-version-detail <raw-version-detail.json>. Add " +
          "--authorize-release to call Cloudflare, which requires its own Owner authorization.",
      );
    }
    const absolute = resolve(REPO, fromFile);
    if (!existsSync(absolute)) stop(`raw version-detail fixture not found at ${fromFile}.`);
    try {
      return JSON.parse(readFileSync(absolute, "utf8"));
    } catch {
      // The parser error can quote the document, so it is not echoed.
      stop(`the raw version-detail fixture at ${fromFile} is not valid JSON.`);
    }
  }

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const worker = arg("--worker");
  if (!accountId) stop("CLOUDFLARE_ACCOUNT_ID is not set.");
  if (!token) stop("CLOUDFLARE_API_TOKEN is not set.");
  if (!worker) stop("--worker <script-name> is required in authorized release mode.");

  const url =
    `${CLOUDFLARE_API_BASE}/accounts/${encodeURIComponent(accountId)}` +
    `/workers/scripts/${encodeURIComponent(worker)}/versions/${encodeURIComponent(versionId)}`;

  // The URL is never logged: it carries the account identifier.
  log("requesting the documented version-detail endpoint (URL withheld — it names the account).");
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!response.ok) {
    // Status only. A Cloudflare error body can echo the request.
    stop(`the version-detail request returned HTTP ${response.status}. The body is not echoed.`);
  }
  try {
    return await response.json();
  } catch {
    stop("the version-detail response was not valid JSON. The body is not echoed.");
  }
  return null;
}

const rawDetail = await readVersionDetail();

const normalized = normalizeWorkerVersionDetail(rawDetail, { expectedVersionId: versionId });

log(`mode              : ${authorized ? "AUTHORIZED RELEASE" : "OFFLINE REVIEW"}`);
log(`raw bindings read : ${normalized.rawBindingCount}`);
log(`descriptors kept  : ${normalized.snapshot ? normalized.snapshot.bindings.length : 0}`);

if (!normalized.ok) {
  for (const problem of normalized.problems) {
    process.stderr.write(`[capture-bindings] ${problem.code}: ${problem.detail}\n`);
  }
  stop("the version metadata was not captured. Nothing was written.");
}

// Re-validate the OUTPUT against the closed schema. Normalization and schema
// are separate guards on purpose: a future edit that let one of them drift has
// to defeat both to write a snapshot carrying a value.
const revalidated = validateBindingSnapshot(
  JSON.parse(serializeBindingSnapshot(normalized.snapshot)),
);
if (!revalidated.ok) {
  for (const problem of revalidated.problems) {
    process.stderr.write(`[capture-bindings] ${problem.code}: ${problem.detail}\n`);
  }
  stop("the sanitized snapshot would not satisfy the closed schema. Nothing was written.");
}

writeFileSync(resolve(REPO, out), serializeBindingSnapshot(normalized.snapshot), "utf8");
log(
  `PASS — ${normalized.snapshot.bindings.length} binding name(s) and class(es) written to ${out}. ` +
    "No raw response, no value and no credential was written or logged.",
);
