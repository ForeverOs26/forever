/**
 * FOREVER-STUDIO-EXPLICIT-BINDINGS-FIX-002 — explicit `plain_text` bindings for
 * the two deployment-managed Worker variables.
 *
 * ---------------------------------------------------------------------------
 * WHY THE PREVIOUS MECHANISM WAS REMOVED, NOT REPAIRED
 * ---------------------------------------------------------------------------
 *
 * PR #139 shipped pinned inheritance: two `inherit` binding records, each
 * carrying an explicit `version_id` naming the verified 12-binding live Worker.
 * The reasoning was sound and the local proof was real — an offline capture
 * against the repository-locked Wrangler showed that Wrangler forwards an
 * explicit `version_id` verbatim in the outgoing multipart metadata.
 *
 * That proof measured WRANGLER. It never measured CLOUDFLARE, and the runbook
 * said so. The single authorized upload settled the question:
 *
 *   POST /accounts/{account_id}/workers/scripts/forever/versions  ->  HTTP 400
 *
 *     inherit binding 'STUDIO_STORAGE_WRITE_PROVIDER' is invalid: 'version_id'
 *     value '<uuid>' is invalid, only the literal 'latest' is supported by this
 *     API [code: 10057]
 *
 *     inherit binding 'SUPABASE_URL' is invalid: 'version_id' value '<uuid>' is
 *     invalid, only the literal 'latest' is supported by this API [code: 10057]
 *
 * The production API accepts exactly one inheritance source — the literal
 * `"latest"` — and `"latest"` is the defect. The newest uploaded version is the
 * rejected 10-binding candidate `3540bc64`, behind it the rejected 10-binding
 * `ae4cae19`; the 12-binding version holding 100% of traffic is older than
 * both. Inheriting from `"latest"` reproduces the exact incident.
 *
 * DOCUMENTATION / RUNTIME CONTRADICTION. Cloudflare's published schema for the
 * Upload Version API may still describe a version UUID as an accepted value for
 * an `inherit` binding. The production API rejects it. Where a schema and a
 * measured production response disagree, this repository follows the measured
 * response. UUID inheritance is NOT restored on the strength of the schema, and
 * the invalid mechanism is NOT retained as a fallback — a fallback to a form the
 * API refuses is an outage waiting for the first failure.
 *
 * ---------------------------------------------------------------------------
 * WHAT REPLACES IT
 * ---------------------------------------------------------------------------
 *
 * Both variables are declared EXPLICITLY, as `plain_text` bindings, in the
 * ephemeral upload specification. Nothing is inherited, so nothing depends on
 * which version Cloudflare considers latest, and the release stops being
 * sensitive to the upload history entirely.
 *
 * THE VALUES ARE NOT IN THIS REPOSITORY AND ARE NOT PUT INTO IT. `SUPABASE_URL`
 * and `STUDIO_STORAGE_WRITE_PROVIDER` are deployment-plane values. Nothing here
 * hardcodes, defaults, guesses or reconstructs either one: they are supplied at
 * release time through the release-environment inputs named in
 * `RELEASE_VALUE_ENV_VARS`, validated, and written ONLY into the ephemeral
 * upload specification that Wrangler reads and that is deleted afterwards.
 *
 * A GUESSED VALUE IS WORSE THAN A MISSING ONE. `STUDIO_STORAGE_WRITE_PROVIDER`
 * has a documented default (`supabase`) for the RUNTIME, and applying that
 * default HERE would silently reconfigure production storage during a release
 * that was supposed to change nothing. There is therefore no default in this
 * module: an absent input is a STOP.
 *
 * VALUES NEVER LEAVE THE UPLOAD PATH. No function here returns a value into a
 * log line, an error message, a report, a receipt or a test snapshot. Violations
 * name the BINDING and the RULE, never the value that broke it. The value-free
 * projection in `projectFinalBindingSet` is what every other process is given.
 *
 * This module is deliberately free of `node:` imports so the release tooling,
 * the build scripts and the test suite import the same bytes and no Node
 * primitive can be pulled into a client bundle. File I/O, digests and process
 * environment access are the caller's job.
 */

import {
  STUDIO_STORAGE_PROVIDERS,
  isStudioStorageProvider,
} from "../../features/forever-studio/studio-types";
import {
  DEPLOYMENT_MANAGED_PLAIN_TEXT_BINDINGS,
  DEPLOYMENT_MANAGED_SECRET_BINDINGS,
  EXPECTED_PRODUCTION_BINDING_COUNT,
  GENERATED_WORKER_CONFIG_PATH,
  REPOSITORY_DECLARED_BINDINGS,
  UPLOAD_SPECIFICATION_PATH,
} from "./worker-variable-preservation";

/**
 * The two bindings declared explicitly by the upload specification.
 *
 * Derived from the preservation contract rather than re-listed, so the lists
 * cannot drift: a change there is a change here.
 */
export const EXPLICIT_PLAIN_TEXT_BINDINGS = DEPLOYMENT_MANAGED_PLAIN_TEXT_BINDINGS;

/** Cloudflare's binding discriminator for a non-secret string variable. */
export const PLAIN_TEXT_BINDING_TYPE = "plain_text";

/**
 * The binding type this release path now refuses OUTRIGHT.
 *
 * Retained as a named constant for exactly one reason: so the contract can
 * refuse it by name and the test suite can prove it is refused. It is never
 * produced.
 */
export const REFUSED_INHERIT_BINDING_TYPE = "inherit";

/**
 * The only inheritance source the production API accepts — and the one this
 * release path forbids, because it resolves to the most recently uploaded
 * version and the two most recent uploads are the rejected 10-binding
 * candidates.
 */
export const REFUSED_INHERIT_LATEST = "latest";

/** The key under which Wrangler forwards explicitly declared raw bindings. */
export const UPLOAD_SPECIFICATION_BINDINGS_KEY = "unsafe";

/** Exactly the keys an explicit `plain_text` record may carry. */
export const EXPLICIT_BINDING_RECORD_KEYS = ["name", "text", "type"] as const;

/** The PREUPLOAD marker this contract emits. */
export const PREUPLOAD_EXPLICIT_BINDINGS_MARKER = "PREUPLOAD_EXPLICIT_BINDINGS_OK";

/**
 * Markers earlier contracts emitted, retained ONLY so the suite can prove they
 * are never emitted again.
 *
 * `PREUPLOAD_CONTRACT_OK` passed an upload guaranteed to inherit from a
 * 10-binding base. `PREUPLOAD_PINNED_INHERITANCE_OK` passed an upload the
 * production API rejects with HTTP 400. Both described a contract that did not
 * hold; reusing either name with changed semantics would make every historical
 * evidence file ambiguous.
 */
export const SUPERSEDED_PREUPLOAD_MARKERS = [
  "PREUPLOAD_CONTRACT_OK",
  "PREUPLOAD_PINNED_INHERITANCE_OK",
] as const;

/**
 * The release-environment inputs carrying the two deployment-managed values.
 *
 * Deliberately NOT named `SUPABASE_URL` / `STUDIO_STORAGE_WRITE_PROVIDER`. Those
 * names are the RUNTIME variables an operator may well have exported for local
 * development, and a release must never pick up a development value because it
 * happened to be in the shell. A release-scoped name has to be set on purpose.
 */
export const RELEASE_VALUE_ENV_VARS = {
  STUDIO_STORAGE_WRITE_PROVIDER: "FOREVER_RELEASE_STUDIO_STORAGE_WRITE_PROVIDER",
  SUPABASE_URL: "FOREVER_RELEASE_SUPABASE_URL",
} as const;

/**
 * Bindings that survive an upload WITHOUT the two explicit records: the four
 * this repository declares plus the six deployment-managed secrets Cloudflare
 * never deletes.
 *
 * This is the 10-binding shape both rejected candidates came back with. It is
 * enumerated so the preflight can prove those ten are still present rather than
 * inferring it from a total.
 */
export const BINDINGS_PRESERVED_WITHOUT_EXPLICIT_RECORDS = [
  ...REPOSITORY_DECLARED_BINDINGS,
  ...DEPLOYMENT_MANAGED_SECRET_BINDINGS,
] as const;

/** 10 preserved + 2 explicit = the 12-binding production contract. */
export const EXPECTED_FINAL_BINDING_COUNT = EXPECTED_PRODUCTION_BINDING_COUNT;

/**
 * Fields that carry a VALUE on a record that has no business carrying one.
 *
 * `text` is legitimate on the two explicit `plain_text` records and ONLY there;
 * it is checked positionally rather than by presence.
 */
export const VALUE_CARRYING_FIELDS = ["value", "json", "secret_text", "content"] as const;

/** One explicit plain-text binding record, as Cloudflare's API accepts it. */
export interface ExplicitPlainTextBinding {
  readonly name: string;
  readonly type: typeof PLAIN_TEXT_BINDING_TYPE;
  readonly text: string;
}

/** The two release-supplied values, keyed by binding name. */
export interface ExplicitBindingValues {
  readonly STUDIO_STORAGE_WRITE_PROVIDER: string;
  readonly SUPABASE_URL: string;
}

export interface ExplicitBindingViolation {
  readonly code:
    | "release_input_missing"
    | "release_input_empty"
    | "supabase_url_invalid"
    | "write_provider_invalid"
    | "specification_malformed"
    | "binding_record_count_wrong"
    | "binding_record_name_wrong"
    | "binding_record_type_wrong"
    | "binding_record_unknown_key"
    | "binding_record_value_missing"
    | "inherit_record_present"
    | "duplicate_binding_name"
    | "immutable_config_modified"
    | "vars_block_declared"
    | "final_binding_count_wrong"
    | "preserved_binding_missing"
    | "secret_binding_materialized"
    | "live_snapshot_binding_count_wrong"
    | "live_snapshot_plain_text_missing";
  readonly detail: string;
}

/* -------------------------------------------------------------------------- */
/* Release inputs                                                             */
/* -------------------------------------------------------------------------- */

/**
 * An acceptable `SUPABASE_URL`.
 *
 * Fail-closed and deliberately narrow: the Worker builds every Supabase request
 * from this origin, so a value that is "almost" a URL becomes a runtime failure
 * on the first authenticated Studio request rather than a release-time STOP.
 *
 *   - parses as an absolute URL;
 *   - `https:` only — the Worker must never talk to Supabase in cleartext;
 *   - has a hostname, and it is not an IP-style bare label;
 *   - carries NO embedded credentials, query or fragment;
 *   - is an ORIGIN: the path is empty or `/`. A trailing path silently breaks
 *     every URL this value is joined with.
 *
 * The raw value is never echoed by any caller of this function.
 */
export function isAcceptableSupabaseUrl(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  const trimmed = raw.trim();
  if (!trimmed || trimmed !== raw) return false;
  if (/\s/.test(trimmed)) return false;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (!parsed.hostname || !parsed.hostname.includes(".")) return false;
  if (parsed.username || parsed.password) return false;
  if (parsed.search || parsed.hash) return false;
  if (parsed.pathname !== "" && parsed.pathname !== "/") return false;
  return true;
}

/**
 * An acceptable `STUDIO_STORAGE_WRITE_PROVIDER`.
 *
 * The provider contract is `src/features/forever-studio/studio-types.ts` —
 * imported, never re-listed, so a new provider cannot be accepted by Studio and
 * refused by the release path (or the reverse).
 *
 * Stricter than the RUNTIME resolver on purpose. `resolveWriteProviderValue`
 * trims and lower-cases, because it is interpreting whatever a deployment
 * already has. A release is authoring the value, so it must be exactly one of
 * the documented identifiers — ` R2 ` is an operator typing into a release
 * prompt, and a release is not the place to guess what they meant.
 */
export function isAcceptableWriteProvider(raw: unknown): raw is string {
  return typeof raw === "string" && isStudioStorageProvider(raw);
}

/**
 * Reads and validates the two release-environment inputs, FAIL-CLOSED.
 *
 * Returns the values for the caller to place into the ephemeral specification.
 * Violations describe the RULE that failed and name the environment variable to
 * set; no violation contains, quotes, truncates, lengths or hashes a value.
 */
export function readReleaseBindingInputs(env: Record<string, string | undefined>): {
  readonly ok: boolean;
  readonly values: ExplicitBindingValues | null;
  readonly violations: readonly ExplicitBindingViolation[];
} {
  const violations: ExplicitBindingViolation[] = [];
  const refuse = (code: ExplicitBindingViolation["code"], detail: string) =>
    violations.push({ code, detail });

  const rawProvider = env[RELEASE_VALUE_ENV_VARS.STUDIO_STORAGE_WRITE_PROVIDER];
  const rawUrl = env[RELEASE_VALUE_ENV_VARS.SUPABASE_URL];

  for (const [binding, variable, raw] of [
    [
      "STUDIO_STORAGE_WRITE_PROVIDER",
      RELEASE_VALUE_ENV_VARS.STUDIO_STORAGE_WRITE_PROVIDER,
      rawProvider,
    ],
    ["SUPABASE_URL", RELEASE_VALUE_ENV_VARS.SUPABASE_URL, rawUrl],
  ] as const) {
    if (raw === undefined || raw === null) {
      refuse(
        "release_input_missing",
        `${binding} has no release input. Set ${variable} in the release environment. There is no ` +
          "default: a guessed value would silently reconfigure production during a release that " +
          "was supposed to change nothing.",
      );
      // The `typeof` test below is NOT redundant with the branch above.
      //
      // It is the second half of a fail-closed pair (PR140 corrections). If the
      // absence check is ever weakened — mutation control 35 does exactly that —
      // a missing input reaches this line, and `raw.trim()` on `undefined` would
      // throw a TypeError. A crash is a bad refusal: it produces no violation
      // code, so the caller reports "the release tooling failed" rather than
      // "this variable is not set", and a mutation control can only observe a
      // stack trace instead of a named rule. With the type test, a weakened
      // absence check still STOPS the release with a named violation.
    } else if (typeof raw !== "string" || raw.trim() === "") {
      refuse(
        "release_input_empty",
        `${variable} is set but empty. An empty ${binding} is refused — Cloudflare would accept it ` +
          "and the Worker would fail at runtime instead of here.",
      );
    }
  }

  // `typeof` rather than `!== undefined`, for the same reason as above: a
  // non-string must reach a NAMED refusal, never a TypeError.
  if (
    typeof rawProvider === "string" &&
    rawProvider.trim() !== "" &&
    !isAcceptableWriteProvider(rawProvider)
  ) {
    refuse(
      "write_provider_invalid",
      `STUDIO_STORAGE_WRITE_PROVIDER must be exactly one of ${STUDIO_STORAGE_PROVIDERS.join(" | ")} ` +
        `(the contract in studio-types.ts). The supplied value is not echoed. Set ` +
        `${RELEASE_VALUE_ENV_VARS.STUDIO_STORAGE_WRITE_PROVIDER} to a documented identifier.`,
    );
  }

  if (typeof rawUrl === "string" && rawUrl.trim() !== "" && !isAcceptableSupabaseUrl(rawUrl)) {
    refuse(
      "supabase_url_invalid",
      "SUPABASE_URL must be an absolute https ORIGIN with no credentials, query, fragment or path " +
        "(a trailing path breaks every URL it is joined with). The supplied value is not echoed. " +
        `Correct ${RELEASE_VALUE_ENV_VARS.SUPABASE_URL}.`,
    );
  }

  if (violations.length > 0) return { ok: false, values: null, violations };

  return {
    ok: true,
    values: {
      STUDIO_STORAGE_WRITE_PROVIDER: rawProvider as string,
      SUPABASE_URL: rawUrl as string,
    },
    violations: [],
  };
}

/* -------------------------------------------------------------------------- */
/* The ephemeral upload specification                                         */
/* -------------------------------------------------------------------------- */

/** The two explicit records, always in the contract's declared order. */
export function buildExplicitPlainTextBindings(
  values: ExplicitBindingValues,
): readonly ExplicitPlainTextBinding[] {
  return EXPLICIT_PLAIN_TEXT_BINDINGS.map((name) => ({
    name,
    type: PLAIN_TEXT_BINDING_TYPE,
    text: values[name],
  }));
}

/**
 * The binding categories the generated configuration may declare, and the class
 * each one projects as.
 *
 * ONE TABLE, TWO READERS (PR140 review, F6). `declaredBindingNames` and
 * `projectFinalBindingSet` both walk this list. They used to enumerate their own
 * categories, and the projection knew about only two of the six — so a KV
 * namespace, a D1 database, a queue or a service binding added to the build was
 * invisible to the projection while `declaredBindingNames` saw it. The projected
 * total would have stayed at twelve and passed the count gate, describing a
 * binding set the upload does not produce. Deriving both from one table means a
 * new category cannot be understood by one reader and not the other.
 */
export const CONFIG_BINDING_CATEGORIES = [
  { key: "r2_buckets", type: "r2_bucket" },
  { key: "kv_namespaces", type: "kv_namespace" },
  { key: "d1_databases", type: "d1_database" },
  { key: "queues", type: "queue" },
  { key: "services", type: "service" },
] as const;

/** The class the single `assets` binding projects as. */
export const ASSETS_BINDING_TYPE = "assets";

/**
 * Every `{ name, type }` the immutable generated configuration already declares.
 *
 * Cloudflare keys bindings by name, so a collision would silently replace a real
 * binding with a variable — and a category this function cannot see is a
 * collision nobody would notice.
 */
export function declaredConfigBindings(
  config: Record<string, unknown>,
): readonly BindingProjectionEntry[] {
  const declared: BindingProjectionEntry[] = [];

  const assets = config.assets;
  if (typeof assets === "object" && assets !== null && !Array.isArray(assets)) {
    const binding = (assets as Record<string, unknown>).binding;
    if (typeof binding === "string") declared.push({ name: binding, type: ASSETS_BINDING_TYPE });
  }

  for (const category of CONFIG_BINDING_CATEGORIES) {
    const entries = config[category.key];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
      const binding = (entry as Record<string, unknown>).binding;
      if (typeof binding === "string") declared.push({ name: binding, type: category.type });
    }
  }

  return declared;
}

/**
 * Every binding NAME the immutable generated configuration already declares.
 *
 * Derived from `declaredConfigBindings` rather than re-walking the document, so
 * the name check and the projection can never disagree about which categories
 * exist.
 */
export function declaredBindingNames(config: Record<string, unknown>): readonly string[] {
  return declaredConfigBindings(config).map((binding) => binding.name);
}

/**
 * The EPHEMERAL, UPLOAD-ONLY specification.
 *
 * The immutable generated configuration plus EXACTLY ONE addition: the
 * `unsafe.bindings` array carrying the two explicit `plain_text` records.
 * `.output/server/wrangler.json` itself is never written to.
 *
 * It is emitted BESIDE the generated configuration deliberately: `main` and
 * `assets.directory` are relative paths Wrangler resolves against the directory
 * holding the configuration file, so a specification written anywhere else
 * would reference a different bundle and a different asset set while looking
 * correct.
 *
 * UNLIKE THE SUPERSEDED SPECIFICATION, THIS DOCUMENT CARRIES VALUES. It is
 * created immediately before the spawn, with the most restrictive mode the
 * platform honours, and deleted whether the upload succeeds or fails — see
 * `ephemeral-upload-specification.ts`.
 */
export function buildUploadSpecification(input: {
  readonly generatedConfig: Record<string, unknown>;
  readonly values: ExplicitBindingValues;
}): Record<string, unknown> {
  return {
    ...input.generatedConfig,
    [UPLOAD_SPECIFICATION_BINDINGS_KEY]: {
      bindings: buildExplicitPlainTextBindings(input.values),
    },
  };
}

/**
 * A deterministic, canonical representation for hashing.
 *
 * Keys are sorted recursively so a reformatted but semantically identical
 * document hashes the same and any content change does not. Arrays keep their
 * order — binding order is content.
 *
 * NOTE FOR CALLERS: this string CONTAINS the two values. A digest taken over it
 * must be salted with a per-release secret before it is printed or recorded —
 * `STUDIO_STORAGE_WRITE_PROVIDER` has two possible values, so a bare digest of
 * a document whose every other byte is knowable is a two-guess oracle. See
 * `saltedSpecificationDigest` in the upload wrapper.
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

/* -------------------------------------------------------------------------- */
/* The value-free projection every other process is given                     */
/* -------------------------------------------------------------------------- */

export interface BindingProjectionEntry {
  readonly name: string;
  readonly type: string;
}

export interface FinalBindingProjection {
  readonly schemaVersion: 1;
  readonly kind: "forever-upload-binding-projection";
  readonly varsBlockDeclared: boolean;
  readonly inheritRecordCount: number;
  readonly bindings: readonly BindingProjectionEntry[];
}

/**
 * Projects the binding set the upload will produce, WITHOUT any value.
 *
 * This is what crosses a process boundary, what the preflight reasons about and
 * what may appear in a log. It is built from three name-only sources:
 *
 *   - EVERY binding category the immutable generated configuration declares —
 *     assets, R2 buckets, KV namespaces, D1 databases, queues and services —
 *     read through the single `declaredConfigBindings` table;
 *   - the two explicit records in the specification, by NAME and TYPE only;
 *   - the deployment-managed secret NAMES observed on the live Worker, which
 *     Cloudflare never deletes and which this release never materializes.
 *
 * THE APPROVED BUILD DECLARES ONLY ASSETS AND THREE R2 BUCKETS, and the total is
 * therefore still exactly twelve. The other four categories are projected
 * because a build that grows one must fail the twelve-binding gate LOUDLY rather
 * than project a set it does not produce (PR140 review, F6).
 *
 * `inheritRecordCount` is projected rather than assumed so a preflight in
 * another process can refuse a non-zero count without ever seeing the document.
 */
export function projectFinalBindingSet(input: {
  readonly generatedConfig: Record<string, unknown>;
  readonly specification: Record<string, unknown>;
  readonly liveBindingNames: readonly string[];
}): FinalBindingProjection {
  const bindings: BindingProjectionEntry[] = [...declaredConfigBindings(input.generatedConfig)];

  let inheritRecordCount = 0;
  const unsafeBlock = input.specification[UPLOAD_SPECIFICATION_BINDINGS_KEY];
  const records =
    typeof unsafeBlock === "object" && unsafeBlock !== null && !Array.isArray(unsafeBlock)
      ? (unsafeBlock as Record<string, unknown>).bindings
      : undefined;
  if (Array.isArray(records)) {
    for (const entry of records) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
      const record = entry as Record<string, unknown>;
      if (record.type === REFUSED_INHERIT_BINDING_TYPE) inheritRecordCount += 1;
      if (typeof record.name === "string" && typeof record.type === "string") {
        bindings.push({ name: record.name, type: record.type });
      }
    }
  }

  // Secrets are asserted by NAME from the live Worker. They are never declared
  // by the upload and never read: Cloudflare does not delete them.
  for (const name of DEPLOYMENT_MANAGED_SECRET_BINDINGS) {
    if (input.liveBindingNames.includes(name)) bindings.push({ name, type: "secret_text" });
  }

  return {
    schemaVersion: 1,
    kind: "forever-upload-binding-projection",
    varsBlockDeclared: input.specification.vars !== undefined,
    inheritRecordCount,
    bindings,
  };
}

/* -------------------------------------------------------------------------- */
/* The contracts                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Verifies the VALUE-CARRYING upload specification, FAIL-CLOSED.
 *
 * Runs in the upload wrapper's own process, because it is the only process
 * permitted to see the values. Every rule is a refusal; there is no warning
 * verdict and no branch that turns a missing or malformed value into an
 * acceptable upload.
 */
export function verifyUploadSpecification(input: {
  readonly specification: unknown;
  readonly generatedConfig: Record<string, unknown>;
  readonly values: ExplicitBindingValues;
}): {
  readonly ok: boolean;
  readonly violations: readonly ExplicitBindingViolation[];
  readonly normalized: string | null;
} {
  const violations: ExplicitBindingViolation[] = [];
  const refuse = (code: ExplicitBindingViolation["code"], detail: string) =>
    violations.push({ code, detail });

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
      "binding_record_count_wrong",
      `the upload specification declares no ${UPLOAD_SPECIFICATION_BINDINGS_KEY}.bindings array. ` +
        "Both deployment-managed variables are declared explicitly now; there is no inheritance " +
        "and no implicit source to fall back to.",
    );
    return { ok: false, violations, normalized: null };
  }

  if (rawBindings.length !== EXPLICIT_PLAIN_TEXT_BINDINGS.length) {
    refuse(
      "binding_record_count_wrong",
      `the upload specification declares ${rawBindings.length} raw binding record(s); exactly ` +
        `${EXPLICIT_PLAIN_TEXT_BINDINGS.length} explicit plain_text records are permitted ` +
        `(${EXPLICIT_PLAIN_TEXT_BINDINGS.join(" and ")}).`,
    );
  }

  const seenNames = new Set<string>();

  for (let index = 0; index < rawBindings.length; index += 1) {
    const entry = rawBindings[index];
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      refuse("specification_malformed", `bindings[${index}] is not a binding record object.`);
      continue;
    }
    const record = entry as Record<string, unknown>;
    const name = record.name;
    const position = typeof name === "string" ? `"${name}"` : `bindings[${index}]`;

    // The removed mechanism, refused BY NAME rather than merely absent.
    if (record.type === REFUSED_INHERIT_BINDING_TYPE) {
      refuse(
        "inherit_record_present",
        `${position} is an ${REFUSED_INHERIT_BINDING_TYPE} record. The production API rejects a ` +
          `pinned version_id with HTTP 400 [code: 10057] and accepts only the literal ` +
          `"${REFUSED_INHERIT_LATEST}", which resolves to the most recently uploaded version — ` +
          "currently a rejected 10-binding candidate. Inheritance is removed, not reconfigured.",
      );
      continue;
    }

    if (
      typeof name !== "string" ||
      !(EXPLICIT_PLAIN_TEXT_BINDINGS as readonly string[]).includes(name)
    ) {
      refuse(
        "binding_record_name_wrong",
        `${position} is not one of the two bindings this specification may declare ` +
          `(${EXPLICIT_PLAIN_TEXT_BINDINGS.join(", ")}).`,
      );
    } else if (seenNames.has(name)) {
      refuse(
        "duplicate_binding_name",
        `${position} appears more than once. Cloudflare keys bindings by name; a duplicate ` +
          "silently replaces a real binding.",
      );
    } else {
      seenNames.add(name);
    }

    if (record.type !== PLAIN_TEXT_BINDING_TYPE) {
      refuse(
        "binding_record_type_wrong",
        `${position} is not a ${PLAIN_TEXT_BINDING_TYPE} record. Both deployment-managed variables ` +
          "are plain-text on the live Worker and a class change is not preservation.",
      );
    }

    for (const key of Object.keys(record)) {
      if (!(EXPLICIT_BINDING_RECORD_KEYS as readonly string[]).includes(key)) {
        refuse(
          (VALUE_CARRYING_FIELDS as readonly string[]).includes(key)
            ? "secret_binding_materialized"
            : "binding_record_unknown_key",
          `${position} carries unexpected key "${key}". An explicit plain-text record is exactly ` +
            `${EXPLICIT_BINDING_RECORD_KEYS.join(", ")}.`,
        );
      }
    }

    const text = record.text;
    if (typeof text !== "string" || text.trim() === "") {
      refuse(
        "binding_record_value_missing",
        `${position} carries no non-empty value. The value is not echoed. An empty variable is ` +
          "accepted by Cloudflare and fails at runtime, which is strictly worse than stopping here.",
      );
    } else if (name === "SUPABASE_URL" && !isAcceptableSupabaseUrl(text)) {
      refuse("supabase_url_invalid", `${position} is not an absolute https origin.`);
    } else if (name === "STUDIO_STORAGE_WRITE_PROVIDER" && !isAcceptableWriteProvider(text)) {
      refuse(
        "write_provider_invalid",
        `${position} is not one of ${STUDIO_STORAGE_PROVIDERS.join(" | ")}.`,
      );
    }
  }

  for (const name of EXPLICIT_PLAIN_TEXT_BINDINGS) {
    if (!seenNames.has(name)) {
      refuse(
        "binding_record_name_wrong",
        `${name} is absent from the upload specification. Both rejected candidates were missing ` +
          "exactly this binding; an upload that does not declare it is the incident.",
      );
    }
  }

  // No explicit record may collide with a binding the build already declares.
  for (const declared of declaredBindingNames(input.generatedConfig)) {
    if (seenNames.has(declared)) {
      refuse(
        "duplicate_binding_name",
        `"${declared}" is already declared by the immutable configuration and would be duplicated ` +
          "by an explicit record.",
      );
    }
  }

  // The other way to lose the values: a `vars` block REPLACES the whole
  // deployment-managed set rather than adding to it.
  if (specification.vars !== undefined) {
    refuse(
      "vars_block_declared",
      "the upload specification declares a vars block. `vars` and explicit bindings are two ways " +
        "to say the same thing and Wrangler does not merge them; exactly one mechanism is used.",
    );
  }

  // The immutable application build must be reproduced EXACTLY. Asserted by
  // reconstruction rather than by diffing, so a swapped bundle, a different
  // asset directory or an altered compatibility date cannot pass by being
  // classified as a minor difference.
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
      values: input.values,
    });
    if (normalizeUploadSpecification(rebuilt) !== normalizeUploadSpecification(specification)) {
      refuse(
        "immutable_config_modified",
        "the upload specification is not the immutable generated configuration plus exactly the " +
          "two explicit plain-text records. The application build must be byte-identical.",
      );
    }
  }

  return {
    ok: violations.length === 0,
    violations,
    normalized: violations.length === 0 ? normalizeUploadSpecification(specification) : null,
  };
}

/**
 * Verifies the VALUE-FREE projection, FAIL-CLOSED.
 *
 * This is the half that runs in the preflight process — the one that must reach
 * a verdict without ever being handed a value. It proves the shape of the
 * binding set the upload will produce:
 *
 *   - the ten bindings that survive without explicit records are all present;
 *   - both explicit plain-text bindings are present, with the right class;
 *   - there are ZERO inherit records;
 *   - no name is duplicated and no `vars` block exists;
 *   - the total is exactly twelve.
 */
export function verifyFinalBindingProjection(input: {
  readonly projection: unknown;
  readonly liveBindingNames: readonly string[];
}): {
  readonly ok: boolean;
  readonly violations: readonly ExplicitBindingViolation[];
  readonly bindingCount: number;
} {
  const violations: ExplicitBindingViolation[] = [];
  const refuse = (code: ExplicitBindingViolation["code"], detail: string) =>
    violations.push({ code, detail });

  if (
    typeof input.projection !== "object" ||
    input.projection === null ||
    Array.isArray(input.projection)
  ) {
    refuse("specification_malformed", "the binding projection is not a JSON object.");
    return { ok: false, violations, bindingCount: 0 };
  }
  const projection = input.projection as Record<string, unknown>;

  if (
    projection.schemaVersion !== 1 ||
    projection.kind !== "forever-upload-binding-projection" ||
    !Array.isArray(projection.bindings)
  ) {
    refuse(
      "specification_malformed",
      "the binding projection does not satisfy the closed projection schema.",
    );
    return { ok: false, violations, bindingCount: 0 };
  }

  const entries: BindingProjectionEntry[] = [];
  for (let index = 0; index < projection.bindings.length; index += 1) {
    const entry = projection.bindings[index];
    if (
      typeof entry !== "object" ||
      entry === null ||
      Array.isArray(entry) ||
      typeof (entry as Record<string, unknown>).name !== "string" ||
      typeof (entry as Record<string, unknown>).type !== "string" ||
      Object.keys(entry as Record<string, unknown>).length !== 2
    ) {
      refuse(
        "specification_malformed",
        `projection entry ${index} is not exactly { name, type }. A projection that carries more ` +
          "than a name and a class is refused unread.",
      );
      continue;
    }
    entries.push(entry as BindingProjectionEntry);
  }
  if (violations.length > 0) return { ok: false, violations, bindingCount: entries.length };

  if (projection.inheritRecordCount !== 0) {
    refuse(
      "inherit_record_present",
      `the upload declares ${String(projection.inheritRecordCount)} inherit record(s). The ` +
        "production API rejects a pinned version_id [code: 10057] and the only value it accepts, " +
        `"${REFUSED_INHERIT_LATEST}", resolves to a rejected 10-binding candidate. Zero is the ` +
        "only acceptable count.",
    );
  }
  for (const entry of entries) {
    if (entry.type === REFUSED_INHERIT_BINDING_TYPE) {
      refuse("inherit_record_present", `"${entry.name}" is projected as an inherit binding.`);
    }
  }

  if (projection.varsBlockDeclared === true) {
    refuse(
      "vars_block_declared",
      "the upload specification declares a vars block, which REPLACES the deployment-managed set.",
    );
  }

  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.name)) {
      refuse(
        "duplicate_binding_name",
        `"${entry.name}" appears more than once in the projected binding set.`,
      );
    }
    seen.add(entry.name);
  }

  for (const name of BINDINGS_PRESERVED_WITHOUT_EXPLICIT_RECORDS) {
    if (!seen.has(name)) {
      refuse(
        "preserved_binding_missing",
        `${name} is absent from the projected binding set. These ten are the bindings an upload ` +
          "keeps WITHOUT explicit records; losing one is a different fault from the one being fixed.",
      );
    }
  }

  for (const name of EXPLICIT_PLAIN_TEXT_BINDINGS) {
    const entry = entries.find((candidate) => candidate.name === name);
    if (!entry) {
      refuse(
        "binding_record_name_wrong",
        `${name} is absent from the projected binding set. This is the 10-binding shape both ` +
          "rejected candidates came back with.",
      );
    } else if (entry.type !== PLAIN_TEXT_BINDING_TYPE) {
      refuse(
        "binding_record_type_wrong",
        `${name} is projected as "${entry.type}" rather than ${PLAIN_TEXT_BINDING_TYPE}.`,
      );
    }
  }

  // The live Worker's own count is the independent cross-check: the release is
  // reproducing a 12-binding Worker, not authoring a new binding set.
  if (input.liveBindingNames.length !== EXPECTED_FINAL_BINDING_COUNT) {
    refuse(
      "live_snapshot_binding_count_wrong",
      `the live Worker carries ${input.liveBindingNames.length} bindings; the production contract ` +
        `requires exactly ${EXPECTED_FINAL_BINDING_COUNT}.`,
    );
  }
  for (const name of EXPLICIT_PLAIN_TEXT_BINDINGS) {
    if (!input.liveBindingNames.includes(name)) {
      refuse(
        "live_snapshot_plain_text_missing",
        `${name} is absent from the live Worker snapshot, so the release has no verified 12-binding ` +
          "baseline to reproduce.",
      );
    }
  }

  if (entries.length !== EXPECTED_FINAL_BINDING_COUNT) {
    refuse(
      "final_binding_count_wrong",
      `the upload would produce ${entries.length} bindings; the production contract requires ` +
        `exactly ${EXPECTED_FINAL_BINDING_COUNT}.`,
    );
  }

  return { ok: violations.length === 0, violations, bindingCount: entries.length };
}

/**
 * The paths this contract reads and writes, restated so a caller cannot invent
 * its own and so the mutation controls have a single place to attack.
 */
export const EXPLICIT_BINDING_PATHS = {
  immutableGeneratedConfig: GENERATED_WORKER_CONFIG_PATH,
  ephemeralUploadSpecification: UPLOAD_SPECIFICATION_PATH,
} as const;
