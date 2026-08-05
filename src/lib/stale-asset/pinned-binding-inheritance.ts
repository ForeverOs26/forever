/**
 * FOREVER-PINNED-BINDING-INHERITANCE-IMPLEMENTATION-001 — explicit,
 * live-version-pinned inheritance for the two deployment-managed plain-text
 * Worker bindings.
 *
 * ---------------------------------------------------------------------------
 * THE INCIDENT THIS CLOSES
 * ---------------------------------------------------------------------------
 *
 * Two consecutive candidates came back from Cloudflare carrying TEN bindings
 * where the live Worker `fb4bf6d7` (version 19, 100% of traffic) carried
 * TWELVE. Both lost exactly the two deployment-managed plain-text variables:
 *
 *   - SUPABASE_URL
 *   - STUDIO_STORAGE_WRITE_PROVIDER
 *
 * All six secret bindings survived both times, which is precisely why secret
 * survival proves nothing: Cloudflare never deletes secrets.
 *
 *   | upload            | --keep-vars | predecessor         | pred. bindings | result |
 *   | ----------------- | ----------- | ------------------- | -------------- | ------ |
 *   | ae4cae19 (v21)    | absent      | 9af03721 (v20)      | 12             | 10     |
 *   | 3540bc64 (v22)    | present     | ae4cae19 (v21)      | 10             | 10     |
 *
 * The first upload deleted the vars outright. The second passed `--keep-vars`
 * correctly — and kept nothing, because generic `keep_bindings` inheritance
 * resolves against the LATEST UPLOADED version, and the latest uploaded version
 * was by then the failed 10-binding candidate. Traffic allocation does not
 * influence the inheritance base: a version sitting at 0% is a perfectly
 * eligible source. The 100% live version was two versions older.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS PROVEN AND WHAT IS INFERRED
 * ---------------------------------------------------------------------------
 *
 * PROVEN. Cloudflare documents, for the `inherit` binding type, "Defaults to
 * inheriting the binding from the latest version." An offline loopback capture
 * against the exact pinned Wrangler proved that Wrangler forwards an explicit
 * `version_id` verbatim in the outgoing multipart metadata.
 *
 * INFERRED, at high confidence and NOT proven. That generic `keep_bindings`
 * resolves against that same "latest version" base. `keep_bindings` is not
 * documented on the Upload Version API page, and no server-side trace exists.
 * The chronology, the documented `inherit` default and the observed 10-binding
 * outcome all agree — but agreement is not proof.
 *
 * THIS MODULE THEREFORE DOES NOT DEPEND ON THAT INFERENCE. Naming the source
 * version explicitly removes the implicit default from the release path
 * entirely, which is why the remaining documentation gap does not block the
 * correction. `keep_vars` is retained ONLY as defence in depth for the six
 * secrets and the other supported categories — never as the mechanism these two
 * plain-text variables depend on.
 *
 * ---------------------------------------------------------------------------
 * NO VALUE IS EVER READ
 * ---------------------------------------------------------------------------
 *
 * An `inherit` binding carries a NAME and a SOURCE VERSION UUID. It does not
 * carry, and this module never obtains, the variable's value. Nothing here
 * reads, copies, logs, persists or retransmits either production value; the
 * values never leave Cloudflare. A `text`, `value` or equivalent field
 * appearing in a specification is itself a STOP — that is where Cloudflare
 * returns the production value, and it is refused unread.
 *
 * This module is deliberately dependency-free — no `node:` import — so the
 * build scripts, the release tooling and the test suite can all import the same
 * bytes, and so nothing here can pull a Node primitive into a client bundle.
 * Digests are computed by the caller over `normalizeUploadSpecification`.
 */

import {
  DEPLOYMENT_MANAGED_PLAIN_TEXT_BINDINGS,
  EXPECTED_PRODUCTION_BINDING_COUNT,
  GENERATED_WORKER_CONFIG_PATH,
  UPLOAD_SPECIFICATION_PATH,
} from "./worker-variable-preservation";

/**
 * The ONLY two bindings that may use pinned plain-text inheritance.
 *
 * Derived from the preservation contract rather than re-listed, so the two
 * lists cannot drift apart: a change there is a change here, and mutation
 * control 4 already proves that list is load-bearing.
 */
export const PINNED_INHERITANCE_BINDINGS = DEPLOYMENT_MANAGED_PLAIN_TEXT_BINDINGS;

/** Cloudflare's binding discriminator for version-to-version inheritance. */
export const INHERIT_BINDING_TYPE = "inherit";

/**
 * The literal Cloudflare accepts as an inheritance source and this release
 * path forbids. `"latest"` IS the defect: it resolves to the most recently
 * uploaded version, which is exactly how a failed 0% candidate became the base.
 */
export const FORBIDDEN_INHERIT_VERSION = "latest";

/** The key under which Wrangler accepts explicitly declared raw bindings. */
export const UPLOAD_SPECIFICATION_BINDINGS_KEY = "unsafe";

/**
 * Fields that carry a VALUE. Their presence on an inherit record is a STOP.
 *
 * `text` is where Cloudflare returns the production value of a `plain_text`
 * binding; `value` and `json` are the equivalents for other classes. An
 * inherit record needs none of them, so any of them means something is
 * transporting a value it was never allowed to read.
 */
export const VALUE_CARRYING_FIELDS = ["text", "value", "json", "secret_text", "content"] as const;

/** Exactly the keys a pinned inherit record may carry. */
export const INHERIT_RECORD_KEYS = ["name", "type", "version_id"] as const;

/** The PREUPLOAD marker this contract emits. Never the old one. */
export const PREUPLOAD_PINNED_INHERITANCE_MARKER = "PREUPLOAD_PINNED_INHERITANCE_OK";

/**
 * The marker the SUPERSEDED contract emitted.
 *
 * Retained as a named constant for one reason: so the test suite and the
 * mutation controls can assert it is NEVER emitted again. The old marker
 * verified intent and passed an upload that could not have succeeded; reusing
 * it with changed semantics would make every historical evidence file
 * ambiguous.
 */
export const SUPERSEDED_PREUPLOAD_MARKER = "PREUPLOAD_CONTRACT_OK";

/** An immutable Cloudflare Worker version UUID, in RFC 4122 form. */
const WORKER_VERSION_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isPinnableWorkerVersionId(value: unknown): value is string {
  return typeof value === "string" && WORKER_VERSION_UUID.test(value);
}

/** One explicit, pinned inheritance record. Name and source version only. */
export interface PinnedInheritBinding {
  readonly name: string;
  readonly type: typeof INHERIT_BINDING_TYPE;
  readonly version_id: string;
}

export interface PinnedInheritanceViolation {
  readonly code:
    | "expected_live_version_missing"
    | "expected_live_version_invalid"
    | "expected_live_version_is_latest"
    | "live_snapshot_version_mismatch"
    | "live_snapshot_binding_count_wrong"
    | "live_snapshot_plain_text_missing"
    | "specification_malformed"
    | "inherit_record_count_wrong"
    | "inherit_record_name_wrong"
    | "inherit_record_version_missing"
    | "inherit_record_version_is_latest"
    | "inherit_record_version_mismatch"
    | "inherit_records_disagree"
    | "inherit_record_unknown_key"
    | "inherit_record_carries_value"
    | "duplicate_binding_name"
    | "immutable_config_modified"
    | "vars_block_declared"
    | "keep_vars_is_sole_protection";
  readonly detail: string;
}

/**
 * Builds the two explicit pinned inheritance records.
 *
 * Both records ALWAYS carry the same source UUID — they are generated from one
 * argument, so "the two records point at different versions" is unrepresentable
 * here rather than merely rejected later.
 */
export function buildPinnedInheritanceBindings(
  expectedLiveVersion: string,
): readonly PinnedInheritBinding[] {
  return PINNED_INHERITANCE_BINDINGS.map((name) => ({
    name,
    type: INHERIT_BINDING_TYPE,
    version_id: expectedLiveVersion,
  }));
}

/**
 * Every binding NAME the immutable generated configuration already declares.
 *
 * Used to prove the pinned records introduce no duplicate. Cloudflare keys
 * bindings by name, so a collision would silently replace a real binding.
 */
export function declaredBindingNames(config: Record<string, unknown>): readonly string[] {
  const names: string[] = [];
  const assets = config.assets;
  if (typeof assets === "object" && assets !== null && !Array.isArray(assets)) {
    const binding = (assets as Record<string, unknown>).binding;
    if (typeof binding === "string") names.push(binding);
  }
  for (const key of ["r2_buckets", "kv_namespaces", "d1_databases", "queues", "services"]) {
    const entries = config[key];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
      const binding = (entry as Record<string, unknown>).binding;
      if (typeof binding === "string") names.push(binding);
    }
  }
  return names;
}

/**
 * The EPHEMERAL, UPLOAD-ONLY specification.
 *
 * It is the immutable generated configuration plus EXACTLY ONE addition: the
 * `unsafe.bindings` array carrying the two pinned inherit records. Nothing else
 * is changed, reordered or removed, and `.output/server/wrangler.json` itself
 * is never written to.
 *
 * It is emitted BESIDE the generated configuration on purpose. `main` and
 * `assets.directory` are relative paths that Wrangler resolves against the
 * directory holding the configuration file, so a specification written anywhere
 * else would silently reference a different Worker bundle and a different asset
 * set. Same directory, same resolution.
 */
export function buildUploadSpecification(input: {
  readonly generatedConfig: Record<string, unknown>;
  readonly expectedLiveVersion: string;
}): Record<string, unknown> {
  return {
    ...input.generatedConfig,
    [UPLOAD_SPECIFICATION_BINDINGS_KEY]: {
      bindings: buildPinnedInheritanceBindings(input.expectedLiveVersion),
    },
  };
}

/**
 * A deterministic, canonical representation for hashing.
 *
 * Object keys are sorted recursively so that two specifications differing only
 * in key insertion order produce the SAME digest, and any difference in content
 * produces a different one. Arrays keep their order — binding order is content.
 */
export function normalizeUploadSpecification(specification: unknown): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (typeof value === "object" && value !== null) {
      const record = value as Record<string, unknown>;
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(record).sort()) sorted[key] = canonical(record[key]);
      return sorted;
    }
    return value;
  };
  return `${JSON.stringify(canonical(specification), null, 2)}\n`;
}

/**
 * Verifies an upload specification against the pinned-inheritance contract,
 * FAIL-CLOSED.
 *
 * Every rule is a refusal. There is no warning verdict and no branch that
 * turns a missing or ambiguous inheritance source into an acceptable upload.
 *
 * `liveBindingNames` is the sanitized name list from the live snapshot; no
 * value is passed in and none is read.
 */
export function verifyUploadSpecification(input: {
  readonly specification: unknown;
  readonly generatedConfig: Record<string, unknown>;
  readonly expectedLiveVersion: unknown;
  readonly liveSnapshotVersionId: unknown;
  readonly liveBindingNames: readonly string[];
}): {
  readonly ok: boolean;
  readonly violations: readonly PinnedInheritanceViolation[];
  readonly normalized: string | null;
} {
  const violations: PinnedInheritanceViolation[] = [];
  const refuse = (code: PinnedInheritanceViolation["code"], detail: string) =>
    violations.push({ code, detail });

  // ---- 1. the inheritance SOURCE ------------------------------------------

  const expected = input.expectedLiveVersion;
  if (expected === undefined || expected === null || expected === "") {
    refuse(
      "expected_live_version_missing",
      "--expected-live-version is required. It is the ONLY authoritative inheritance source; " +
        "without it the upload would fall back to Cloudflare's implicit `latest`, which is the defect.",
    );
  } else if (expected === FORBIDDEN_INHERIT_VERSION) {
    refuse(
      "expected_live_version_is_latest",
      `the inheritance source is the literal "${FORBIDDEN_INHERIT_VERSION}". That resolves to the ` +
        "most recently uploaded version — a failed 0% candidate is eligible — and is forbidden.",
    );
  } else if (!isPinnableWorkerVersionId(expected)) {
    refuse(
      "expected_live_version_invalid",
      "the inheritance source is not an immutable Cloudflare Worker version UUID.",
    );
  }

  // A STALE expected-live UUID fails closed here: the sanitized snapshot is the
  // only description of the source version, so if it does not describe exactly
  // the supplied UUID, nothing has been verified about the source at all.
  if (input.liveSnapshotVersionId !== expected) {
    refuse(
      "live_snapshot_version_mismatch",
      "the sanitized live snapshot does not identify the supplied expected-live version. A stale " +
        "UUID is refused rather than trusted; the snapshot and the pin must describe one version.",
    );
  }

  // ---- 2. the SOURCE VERSION must carry the full 12-binding contract -------

  if (input.liveBindingNames.length !== EXPECTED_PRODUCTION_BINDING_COUNT) {
    refuse(
      "live_snapshot_binding_count_wrong",
      `the inheritance source carries ${input.liveBindingNames.length} bindings; the production ` +
        `contract requires exactly ${EXPECTED_PRODUCTION_BINDING_COUNT}. A 10-binding version is ` +
        "exactly the failed candidate shape and is never an inheritance source.",
    );
  }
  for (const name of PINNED_INHERITANCE_BINDINGS) {
    if (!input.liveBindingNames.includes(name)) {
      refuse(
        "live_snapshot_plain_text_missing",
        `${name} is absent from the inheritance source. A version that does not carry the binding ` +
          "cannot be inherited from.",
      );
    }
  }

  // ---- 3. the SPECIFICATION shape -----------------------------------------

  if (
    typeof input.specification !== "object" ||
    input.specification === null ||
    Array.isArray(input.specification)
  ) {
    refuse("specification_malformed", "the upload specification is not a JSON object.");
    return { ok: false, violations, normalized: null };
  }
  const specification = input.specification as Record<string, unknown>;

  const unsafeBlock = specification[UPLOAD_SPECIFICATION_BINDINGS_KEY];
  const rawBindings =
    typeof unsafeBlock === "object" && unsafeBlock !== null && !Array.isArray(unsafeBlock)
      ? (unsafeBlock as Record<string, unknown>).bindings
      : undefined;

  if (!Array.isArray(rawBindings)) {
    refuse(
      "inherit_record_count_wrong",
      `the upload specification declares no ${UPLOAD_SPECIFICATION_BINDINGS_KEY}.bindings array. ` +
        "Generic keep_vars is NOT accepted as protection for the two plain-text bindings: it was " +
        "passed correctly on candidate 3540bc64 and preserved nothing.",
    );
    return { ok: false, violations, normalized: null };
  }

  const inheritRecords = rawBindings.filter(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      !Array.isArray(entry) &&
      (entry as Record<string, unknown>).type === INHERIT_BINDING_TYPE,
  ) as Record<string, unknown>[];

  if (rawBindings.length !== PINNED_INHERITANCE_BINDINGS.length) {
    refuse(
      "inherit_record_count_wrong",
      `the upload specification declares ${rawBindings.length} raw binding(s); exactly ` +
        `${PINNED_INHERITANCE_BINDINGS.length} pinned inherit records are permitted. Only ` +
        `${PINNED_INHERITANCE_BINDINGS.join(" and ")} may use this mechanism.`,
    );
  }
  if (inheritRecords.length !== PINNED_INHERITANCE_BINDINGS.length) {
    refuse(
      "inherit_record_count_wrong",
      `the upload specification carries ${inheritRecords.length} inherit record(s); exactly ` +
        `${PINNED_INHERITANCE_BINDINGS.length} are required.`,
    );
  }

  const seenNames = new Set<string>();
  const observedVersions = new Set<string>();

  for (let index = 0; index < inheritRecords.length; index += 1) {
    const record = inheritRecords[index];
    const name = record.name;
    const position = typeof name === "string" ? `"${name}"` : `bindings[${index}]`;

    if (
      typeof name !== "string" ||
      !(PINNED_INHERITANCE_BINDINGS as readonly string[]).includes(name)
    ) {
      refuse(
        "inherit_record_name_wrong",
        `${position} is not one of the two bindings permitted to use pinned inheritance ` +
          `(${PINNED_INHERITANCE_BINDINGS.join(", ")}).`,
      );
    } else if (seenNames.has(name)) {
      refuse(
        "duplicate_binding_name",
        `${position} appears more than once. Cloudflare keys bindings by name; a duplicate silently ` +
          "replaces a real binding.",
      );
    } else {
      seenNames.add(name);
    }

    for (const key of Object.keys(record)) {
      if (!(INHERIT_RECORD_KEYS as readonly string[]).includes(key)) {
        const carriesValue = (VALUE_CARRYING_FIELDS as readonly string[]).includes(key);
        refuse(
          carriesValue ? "inherit_record_carries_value" : "inherit_record_unknown_key",
          carriesValue
            ? `${position} carries a "${key}" field. That is where Cloudflare returns the ` +
                "production VALUE. It is refused unread: an inherit record transports a name and a " +
                "source version, never a value."
            : `${position} carries unexpected key "${key}". A pinned inherit record is exactly ` +
                `${INHERIT_RECORD_KEYS.join(", ")}.`,
        );
      }
    }

    const versionId = record.version_id;
    if (versionId === undefined) {
      refuse(
        "inherit_record_version_missing",
        `${position} omits version_id. Cloudflare then defaults to inheriting from the LATEST ` +
          "version, which is the implicit source this correction exists to eliminate.",
      );
    } else if (versionId === FORBIDDEN_INHERIT_VERSION) {
      refuse(
        "inherit_record_version_is_latest",
        `${position} pins to the literal "${FORBIDDEN_INHERIT_VERSION}". A 0% failed candidate is ` +
          "an eligible latest version; this is the defect written explicitly.",
      );
    } else if (!isPinnableWorkerVersionId(versionId)) {
      refuse(
        "inherit_record_version_mismatch",
        `${position} does not carry an immutable Worker version UUID.`,
      );
    } else {
      observedVersions.add(versionId);
      if (versionId !== expected) {
        refuse(
          "inherit_record_version_mismatch",
          `${position} is pinned to a version that is not the verified expected-live version. A ` +
            "newer failed 0% candidate must never become the inheritance source.",
        );
      }
    }
  }

  if (observedVersions.size > 1) {
    refuse(
      "inherit_records_disagree",
      "the pinned records do not share ONE source version. Both bindings are inherited from the " +
        "same verified 12-binding live version or neither is.",
    );
  }

  // ---- 4. no duplicate against the immutable configuration ----------------

  for (const declared of declaredBindingNames(input.generatedConfig)) {
    if (seenNames.has(declared)) {
      refuse(
        "duplicate_binding_name",
        `"${declared}" is already declared by the immutable configuration and would be duplicated ` +
          "by a pinned inherit record.",
      );
    }
  }

  // ---- 5. the immutable application configuration is UNCHANGED ------------

  // The only permitted delta is the approved `unsafe.bindings` addition. This
  // is asserted by RECONSTRUCTION rather than by diffing: the specification
  // must equal the generated configuration plus that one key, so a change
  // anywhere else — a swapped bundle, a different asset directory, an altered
  // compatibility date — cannot pass by being classified as "minor".
  if (input.generatedConfig[UPLOAD_SPECIFICATION_BINDINGS_KEY] !== undefined) {
    refuse(
      "immutable_config_modified",
      `the immutable generated configuration already declares ${UPLOAD_SPECIFICATION_BINDINGS_KEY}. ` +
        "The upload-only specification may only ADD it.",
    );
  }
  if (violations.length === 0) {
    const rebuilt = buildUploadSpecification({
      generatedConfig: input.generatedConfig,
      expectedLiveVersion: expected as string,
    });
    if (normalizeUploadSpecification(rebuilt) !== normalizeUploadSpecification(specification)) {
      refuse(
        "immutable_config_modified",
        "the upload specification is not the immutable generated configuration plus exactly the " +
          "two approved pinned inheritance bindings. The application build must be byte-identical.",
      );
    }
  }

  // ---- 6. the OTHER way to lose the values, still refused ------------------

  if (specification.vars !== undefined) {
    refuse(
      "vars_block_declared",
      "the upload specification declares a vars block. Declaring vars REPLACES the " +
        "deployment-managed values; inheritance preserves them without ever reading them.",
    );
  }

  return {
    ok: violations.length === 0,
    violations,
    normalized: violations.length === 0 ? normalizeUploadSpecification(specification) : null,
  };
}

/**
 * The paths this contract reads and writes, restated so a caller cannot invent
 * its own and so the mutation controls have a single place to attack.
 */
export const PINNED_INHERITANCE_PATHS = {
  immutableGeneratedConfig: GENERATED_WORKER_CONFIG_PATH,
  ephemeralUploadSpecification: UPLOAD_SPECIFICATION_PATH,
} as const;
