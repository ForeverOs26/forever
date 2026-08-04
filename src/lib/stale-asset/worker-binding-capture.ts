/**
 * FOREVER-PR138-MERGE-BLOCKER-CORRECTION-002 — Cloudflare Worker version
 * metadata → sanitized binding snapshot, mechanically.
 *
 * WHY THIS EXISTS. The binding-preservation preflight was fail-closed and
 * correct, and nothing in the repository could produce its input
 * (independent-review P1-2). Every release would therefore have needed an
 * operator to read Cloudflare's version metadata by eye and hand-write the JSON
 * the gate then checked — which is not a mechanical gate at all. A file
 * transcribed from what the operator EXPECTS confirms the expectation, not the
 * Worker, and that is the same false assurance this correction exists to remove.
 *
 * THE RAW METADATA CARRIES VALUES. Cloudflare's version-detail response returns
 * a `plain_text` binding as `{ name, text, type }` — `text` IS the production
 * value of `SUPABASE_URL`. A `secret_text` binding has the same shape. So the
 * raw response is transformed to `{ name, type }` IN MEMORY, one binding at a
 * time, and nothing else is ever carried forward: not written, not logged, not
 * quoted in an error, not stringified whole. The sanitized snapshot is the only
 * thing that reaches a disk.
 *
 * THE OFFICIAL CONTRACT, verified against Cloudflare's published API reference
 * for this Worker's API family (account-level Workers Scripts, not
 * Workers-for-Platforms dispatch namespaces):
 *
 *   GET /accounts/{account_id}/workers/scripts/{script_name}/versions/{version_id}
 *
 *   { "success": true, "errors": [], "messages": [],
 *     "result": { "id": "<uuid>", "number": 1,
 *                 "metadata": { ... },
 *                 "resources": { "bindings": [ { "name": ..., "type": ... } ] } } }
 *
 * `result.id` is the immutable Worker version UUID, and `result.resources
 * .bindings` is the documented binding array. If a response does not have that
 * shape, this module STOPS rather than guessing which field to read.
 */

/** The sanitized snapshot format. Bumped only with a migration. */
export const BINDING_SNAPSHOT_SCHEMA_VERSION = 1;

/** The documented account-level version-detail path template. */
export const WORKER_VERSION_DETAIL_PATH =
  "/accounts/{account_id}/workers/scripts/{script_name}/versions/{version_id}";

/** The Cloudflare API origin. Named here so no caller composes its own. */
export const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";

/**
 * The CLOSED normalization vocabulary, stated as an explicit mapping.
 *
 * Cloudflare's own binding-type discriminators happen to be identical to the
 * four classes this contract accepts, so the mapping is the identity — but it
 * is written out rather than implied, because "whatever Cloudflare said" is not
 * a closed vocabulary. Cloudflare documents more than thirty binding types; the
 * thirty-odd that are not listed here have never been part of this Worker, and
 * meeting one means the deployment changed in a way nobody has reviewed.
 */
export const CLOUDFLARE_BINDING_TYPE_MAP: Readonly<Record<string, string>> = Object.freeze({
  assets: "assets",
  r2_bucket: "r2_bucket",
  plain_text: "plain_text",
  secret_text: "secret_text",
});

/** A binding name is an identifier, and it is bounded before it is ever echoed. */
const BOUNDED_BINDING_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** An immutable Cloudflare Worker version identifier. */
const WORKER_VERSION_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface SanitizedBinding {
  readonly name: string;
  readonly type: string;
}

export interface BindingSnapshot {
  readonly schemaVersion: number;
  readonly workerVersionId: string;
  readonly bindings: readonly SanitizedBinding[];
}

export interface CaptureProblem {
  readonly code:
    | "snapshot_not_object"
    | "unknown_top_level_key"
    | "missing_top_level_key"
    | "invalid_schema_version"
    | "invalid_worker_version_id"
    | "bindings_not_array"
    | "bindings_empty"
    | "descriptor_not_object"
    | "unknown_descriptor_key"
    | "missing_descriptor_key"
    | "invalid_binding_name"
    | "unsupported_binding_class"
    | "duplicate_binding_name"
    | "response_not_object"
    | "response_not_successful"
    | "missing_result"
    | "version_id_mismatch"
    | "missing_resources"
    | "missing_bindings"
    | "unknown_cloudflare_binding_type"
    | "descriptor_count_mismatch";
  /** A category and a POSITION. Never a rejected value. */
  readonly detail: string;
}

/** Exactly these top-level keys, and exactly these descriptor keys. */
export const SNAPSHOT_TOP_LEVEL_KEYS = ["schemaVersion", "workerVersionId", "bindings"] as const;
export const SNAPSHOT_DESCRIPTOR_KEYS = ["name", "type"] as const;

/**
 * A binding name is safe to name in an error ONLY after it has been proved to
 * be a bounded identifier. An unbounded or non-identifier name is referred to
 * by index alone, so a capture that smuggled a value into the name field cannot
 * republish it through an error message.
 */
function positionOf(index: number, name: unknown): string {
  return typeof name === "string" && BOUNDED_BINDING_NAME.test(name)
    ? `bindings[${index}] "${name}"`
    : `bindings[${index}]`;
}

/**
 * Validates a sanitized snapshot against the CLOSED schema, fail-closed.
 *
 * Independent-review P2-1: the previous loader read `parsed?.bindings` and
 * ignored every other top-level key, so a capture that stored `values`,
 * `secrets` or an `environment` block beside the array passed and could be
 * retained as evidence. An unknown key is now a STOP, not something to skip
 * over — including the `_note` all four committed fixtures used to carry, which
 * is itself the proof that unknown keys were being accepted.
 */
export function validateBindingSnapshot(parsed: unknown): {
  readonly ok: boolean;
  readonly problems: readonly CaptureProblem[];
  readonly snapshot: BindingSnapshot | null;
} {
  const problems: CaptureProblem[] = [];
  const refuse = (code: CaptureProblem["code"], detail: string) => problems.push({ code, detail });

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    refuse("snapshot_not_object", "a binding snapshot must be a JSON object.");
    return { ok: false, problems, snapshot: null };
  }

  const record = parsed as Record<string, unknown>;
  const allowed = new Set<string>(SNAPSHOT_TOP_LEVEL_KEYS);
  const unknown = Object.keys(record).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    // The KEY NAMES are echoed; their values never are. A key called `token`
    // is exactly the case where naming the key helps and printing it does not.
    refuse(
      "unknown_top_level_key",
      `snapshot carries unknown top-level key(s): ${unknown.sort().join(", ")}. The schema is ` +
        `closed to ${SNAPSHOT_TOP_LEVEL_KEYS.join(", ")}; an unknown key is refused unread rather ` +
        "than ignored, because a capture must never be able to store a value beside the array.",
    );
  }
  for (const key of SNAPSHOT_TOP_LEVEL_KEYS) {
    if (!(key in record)) refuse("missing_top_level_key", `snapshot is missing "${key}".`);
  }

  if (record.schemaVersion !== BINDING_SNAPSHOT_SCHEMA_VERSION) {
    refuse(
      "invalid_schema_version",
      `snapshot schemaVersion must be exactly ${BINDING_SNAPSHOT_SCHEMA_VERSION}.`,
    );
  }
  if (
    typeof record.workerVersionId !== "string" ||
    !WORKER_VERSION_UUID.test(record.workerVersionId)
  ) {
    refuse(
      "invalid_worker_version_id",
      "snapshot workerVersionId must be an immutable Cloudflare Worker version UUID.",
    );
  }

  const bindings = record.bindings;
  if (!Array.isArray(bindings)) {
    refuse("bindings_not_array", "snapshot bindings must be an array.");
    return { ok: false, problems, snapshot: null };
  }
  if (bindings.length === 0) {
    refuse(
      "bindings_empty",
      "snapshot bindings array is empty — an empty capture is never a pass.",
    );
  }

  const descriptorKeys = new Set<string>(SNAPSHOT_DESCRIPTOR_KEYS);
  const sanitized: SanitizedBinding[] = [];
  const seen = new Set<string>();

  bindings.forEach((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      refuse("descriptor_not_object", `${positionOf(index, undefined)} is not an object.`);
      return;
    }
    const descriptor = entry as Record<string, unknown>;
    const extra = Object.keys(descriptor).filter((key) => !descriptorKeys.has(key));
    if (extra.length > 0) {
      refuse(
        "unknown_descriptor_key",
        `${positionOf(index, descriptor.name)} carries disallowed key(s): ${extra.sort().join(", ")}. ` +
          "A descriptor is NAME and CLASS only — `text`, `value` and `json` are where Cloudflare " +
          "returns the production value, and they are refused unread.",
      );
    }
    for (const key of SNAPSHOT_DESCRIPTOR_KEYS) {
      if (!(key in descriptor)) {
        refuse(
          "missing_descriptor_key",
          `${positionOf(index, descriptor.name)} is missing "${key}".`,
        );
      }
    }
    if (typeof descriptor.name !== "string" || !BOUNDED_BINDING_NAME.test(descriptor.name)) {
      refuse(
        "invalid_binding_name",
        `bindings[${index}] has no bounded identifier name (letters, digits and underscore, ` +
          "64 characters at most).",
      );
      return;
    }
    if (
      typeof descriptor.type !== "string" ||
      !Object.values(CLOUDFLARE_BINDING_TYPE_MAP).includes(descriptor.type)
    ) {
      refuse(
        "unsupported_binding_class",
        `${positionOf(index, descriptor.name)} has a class outside the closed vocabulary ` +
          `(${Object.values(CLOUDFLARE_BINDING_TYPE_MAP).join(", ")}).`,
      );
      return;
    }
    if (seen.has(descriptor.name)) {
      refuse(
        "duplicate_binding_name",
        `${positionOf(index, descriptor.name)} repeats a name already present. A binding name is ` +
          "unique on a Worker; a repeat is a corrupt capture.",
      );
      return;
    }
    seen.add(descriptor.name);
    if (extra.length === 0) sanitized.push({ name: descriptor.name, type: descriptor.type });
  });

  if (problems.length > 0) return { ok: false, problems, snapshot: null };

  return {
    ok: true,
    problems,
    snapshot: {
      schemaVersion: BINDING_SNAPSHOT_SCHEMA_VERSION,
      workerVersionId: record.workerVersionId as string,
      bindings: sanitized,
    },
  };
}

/**
 * Transforms ONE Cloudflare version-detail response into ONE sanitized snapshot.
 *
 * Every raw binding produces exactly one descriptor or the whole capture STOPS.
 * There is no filter, no `continue`, no default class and no drop: a binding
 * type this Worker has never carried means the deployment changed, and silently
 * omitting it would make the resulting snapshot agree with a Worker that no
 * longer exists.
 *
 * Nothing from the raw response reaches the return value except a binding NAME
 * and a mapped CLASS, plus the version id after it has been proved to be the
 * requested UUID.
 */
export function normalizeWorkerVersionDetail(
  raw: unknown,
  options: { readonly expectedVersionId: string },
): {
  readonly ok: boolean;
  readonly problems: readonly CaptureProblem[];
  readonly snapshot: BindingSnapshot | null;
  readonly rawBindingCount: number;
} {
  const problems: CaptureProblem[] = [];
  const refuse = (code: CaptureProblem["code"], detail: string) => problems.push({ code, detail });
  const stop = () => ({ ok: false, problems, snapshot: null, rawBindingCount: 0 });

  if (!WORKER_VERSION_UUID.test(options.expectedVersionId)) {
    refuse(
      "invalid_worker_version_id",
      "the requested Worker version id is not a Cloudflare version UUID.",
    );
    return stop();
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    refuse("response_not_object", "the version-detail response is not a JSON object.");
    return stop();
  }
  const envelope = raw as Record<string, unknown>;
  if (envelope.success !== true) {
    // Cloudflare's `errors` array can quote the request, so it is COUNTED and
    // never echoed.
    const count = Array.isArray(envelope.errors) ? envelope.errors.length : 0;
    refuse(
      "response_not_successful",
      `the version-detail response reports success=false with ${count} error(s). The error bodies ` +
        "are not echoed: a Cloudflare error may quote the request, including its credential.",
    );
    return stop();
  }
  const result = envelope.result;
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    refuse("missing_result", "the version-detail response carries no `result` object.");
    return stop();
  }

  const version = result as Record<string, unknown>;
  if (version.id !== options.expectedVersionId) {
    refuse(
      "version_id_mismatch",
      "the returned Worker version id is not the requested one. A snapshot is only ever attributed " +
        "to the exact immutable version it was read from.",
    );
    return stop();
  }

  const resources = version.resources;
  if (typeof resources !== "object" || resources === null || Array.isArray(resources)) {
    refuse(
      "missing_resources",
      "the version detail carries no `resources` object. The documented shape is " +
        "`result.resources.bindings`; a response without it is not the endpoint this tool reads.",
    );
    return stop();
  }
  const rawBindings = (resources as Record<string, unknown>).bindings;
  if (!Array.isArray(rawBindings)) {
    refuse("missing_bindings", "`result.resources.bindings` is absent or is not an array.");
    return stop();
  }
  if (rawBindings.length === 0) {
    refuse(
      "bindings_empty",
      "the version carries zero bindings — an empty capture is never a pass.",
    );
    return stop();
  }

  const sanitized: SanitizedBinding[] = [];
  const seen = new Set<string>();

  rawBindings.forEach((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      refuse("descriptor_not_object", `bindings[${index}] is not an object.`);
      return;
    }
    // Read exactly two fields. The binding object is never destructured whole,
    // never spread, never stringified: `text`, `json` and every other field
    // Cloudflare returns are left where they are and go out of scope with it.
    const name = (entry as Record<string, unknown>).name;
    const type = (entry as Record<string, unknown>).type;

    if (typeof name !== "string" || !BOUNDED_BINDING_NAME.test(name)) {
      refuse(
        "invalid_binding_name",
        `bindings[${index}] has no bounded identifier name; its name is not echoed.`,
      );
      return;
    }
    if (typeof type !== "string" || !(type in CLOUDFLARE_BINDING_TYPE_MAP)) {
      // The unknown type is a Cloudflare discriminator, not a value — but it is
      // still not echoed, because "unknown" means this tool has not proved what
      // that field can contain.
      refuse(
        "unknown_cloudflare_binding_type",
        `${positionOf(index, name)} has a Cloudflare binding type outside the closed vocabulary ` +
          `(${Object.keys(CLOUDFLARE_BINDING_TYPE_MAP).join(", ")}). STOP: an unrecognised binding ` +
          "is never omitted and never guessed — the deployment changed.",
      );
      return;
    }
    if (seen.has(name)) {
      refuse("duplicate_binding_name", `${positionOf(index, name)} repeats an earlier name.`);
      return;
    }
    seen.add(name);
    sanitized.push({ name, type: CLOUDFLARE_BINDING_TYPE_MAP[type] });
  });

  // Every raw binding must have produced exactly one descriptor. This is the
  // arithmetic that makes "nothing was silently dropped" a measurement.
  if (problems.length === 0 && sanitized.length !== rawBindings.length) {
    refuse(
      "descriptor_count_mismatch",
      `${rawBindings.length} raw binding(s) produced ${sanitized.length} descriptor(s).`,
    );
  }

  if (problems.length > 0) {
    return { ok: false, problems, snapshot: null, rawBindingCount: rawBindings.length };
  }

  return {
    ok: true,
    problems,
    snapshot: {
      schemaVersion: BINDING_SNAPSHOT_SCHEMA_VERSION,
      workerVersionId: options.expectedVersionId,
      bindings: sanitized,
    },
    rawBindingCount: rawBindings.length,
  };
}

/** Serialises a snapshot. The ONLY shape this repository ever writes. */
export function serializeBindingSnapshot(snapshot: BindingSnapshot): string {
  return `${JSON.stringify(
    {
      schemaVersion: snapshot.schemaVersion,
      workerVersionId: snapshot.workerVersionId,
      bindings: snapshot.bindings.map((binding) => ({ name: binding.name, type: binding.type })),
    },
    null,
    2,
  )}\n`;
}
