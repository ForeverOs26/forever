/**
 * FOREVER-WRANGLER-KEEP-VARS-CORRECTION-001 — deployment-managed variable
 * preservation, as a closed contract.
 *
 * THE MEASURED INCIDENT. Candidate `ae4cae19` was uploaded from exact merged
 * main `bbf698d2`. It built, self-verified and passed every local gate — and
 * came back from Cloudflare carrying TEN bindings where the live Worker
 * `fb4bf6d7` carried TWELVE. The two that vanished were the deployment-managed
 * plain-text variables:
 *
 *   - SUPABASE_URL
 *   - STUDIO_STORAGE_WRITE_PROVIDER
 *
 * Its preview returned HTTP 500 on `/` and `/projects`:
 * "Missing Supabase environment variable(s): SUPABASE_URL". The candidate was
 * held at 0% and production traffic never moved.
 *
 * THE ROOT CAUSE, from Cloudflare's own documentation for BOTH `versions
 * upload` and `deploy`: "When not used (or set to false), Wrangler will delete
 * all vars before setting those found in the Wrangler configuration. When used
 * (and set to true), the environment variables are not deleted before the
 * deployment. If you set variables via the dashboard you probably want to use
 * this flag. Note that secrets are never deleted by deployments."
 *
 * The default is FALSE. `wrangler.jsonc` declares no `vars` block, so the
 * effective instruction was "delete all vars, then apply the none I declared".
 *
 * TWO HALVES, BOTH REQUIRED. The repository already refused to declare a `vars`
 * block, because declaring one would REPLACE the deployment-managed values.
 * That is necessary and was never sufficient: omitting `vars` prevents
 * overwriting, and only `keep_vars` prevents DELETION. The earlier contract had
 * one half and read as though it had both.
 *
 * THE TRAP THIS MODULE EXISTS TO CLOSE. Secrets are never deleted, with or
 * without the flag. A candidate can therefore show all six secret bindings
 * intact while every plain-text variable has been removed. Secret survival is
 * NOT evidence that plain-text variables survived, and any check that reasons
 * "the secrets are still there, so the upload preserved the environment" is
 * measuring the one thing that could not have failed.
 *
 * VALUES LIVE ON THE DEPLOYMENT PLANE. This module names bindings and their
 * CLASSES. It never contains, imports, reads, logs or persists a variable
 * value or a secret value, and the fingerprint it computes is deliberately
 * built from names and types alone.
 */

/** Bindings this repository declares in `wrangler.jsonc`. */
export const REPOSITORY_DECLARED_BINDINGS = [
  "ASSETS",
  "R2_PRIVATE_SOURCES",
  "R2_PROJECT_ARCHIVES",
  "R2_PUBLIC_MEDIA",
] as const;

/**
 * Plain-text variables owned by the deployment plane.
 *
 * These are the two the failed candidate lost. They are server-only: neither
 * may be exposed to a browser bundle, and neither may be given a value in
 * repository source.
 */
export const DEPLOYMENT_MANAGED_PLAIN_TEXT_BINDINGS = [
  "STUDIO_STORAGE_WRITE_PROVIDER",
  "SUPABASE_URL",
] as const;

/**
 * Secret bindings owned by the deployment plane, BY NAME ONLY.
 *
 * Cloudflare never deletes these on upload. They are enumerated so a preflight
 * can prove none disappeared — never so a value can be read. No value for any
 * of these names appears in this repository.
 */
export const DEPLOYMENT_MANAGED_SECRET_BINDINGS = [
  "R2_ACCESS_KEY_ID",
  "R2_ACCOUNT_ID",
  "R2_SECRET_ACCESS_KEY",
  "STUDIO_OWNER_USER_ID",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

/** The complete expected production binding set: 4 + 2 + 6 = 12. */
export const EXPECTED_PRODUCTION_BINDING_COUNT =
  REPOSITORY_DECLARED_BINDINGS.length +
  DEPLOYMENT_MANAGED_PLAIN_TEXT_BINDINGS.length +
  DEPLOYMENT_MANAGED_SECRET_BINDINGS.length;

/**
 * A binding that must NEVER appear. `STUDIO_OWNER_EMAIL` was deliberately
 * removed from the deployment; its reappearance is a regression.
 */
export const FORBIDDEN_BINDINGS = ["STUDIO_OWNER_EMAIL"] as const;

/** The exact flag that makes an upload preserve deployment-managed variables. */
export const KEEP_VARS_FLAG = "--keep-vars";

/** The canonical configuration key, and the value it must carry. */
export const KEEP_VARS_CONFIG_KEY = "keep_vars";

/** The generated deploy configuration Wrangler is handed, and nothing else. */
export const GENERATED_WORKER_CONFIG_PATH = ".output/server/wrangler.json";

/** The only executable a production candidate upload may run. */
export const WRANGLER_EXECUTABLE = "wrangler";

/**
 * The single Wrangler version this release contract is written against.
 *
 * `--keep-vars` semantics, the `keep_vars` schema key and the version-detail
 * API shape were all verified against THIS version. A release performed with a
 * different one has not been verified by anything here, so the gate refuses it
 * rather than assuming forward compatibility. See `verifyWranglerVersion`.
 */
export const SUPPORTED_WRANGLER_VERSION = "4.118.0";

/**
 * THE CANONICAL PRODUCTION CANDIDATE UPLOAD, AS DATA.
 *
 * PR138 independent review, P1-1: the previous contract accepted an arbitrary
 * operator-supplied shell string and validated it with
 * `uploadCommand.includes("--keep-vars")`. That substring test accepted
 * `--keep-vars=false` — which is, in Cloudflare's own wording, precisely the
 * *deleting* invocation that produced candidate `ae4cae19` — along with
 * `--keep-vars false`, `--keep-vars-disabled`, `--no-keep-vars`, a `#` comment,
 * a decoy argument carrying the substring, text after a `--` terminator,
 * `echo '--keep-vars'`, `wrangler deploy`, a wrong `--config` path and no
 * `--config` at all. Ten commands that do not preserve variables passed the
 * check whose entire purpose was to prove they do.
 *
 * A shell string cannot be validated safely, so this contract does not contain
 * one. The upload is an executable plus an exact argv vector, compared
 * token-by-token and spawned with `shell: false`. Nothing is concatenated,
 * interpolated or word-split, so there is no text for a shell to reinterpret.
 */
export const PRODUCTION_VERSION_UPLOAD_ARGV = [
  "versions",
  "upload",
  KEEP_VARS_FLAG,
  "--config",
  GENERATED_WORKER_CONFIG_PATH,
] as const;

/** An executable plus an exact argument vector. Never a shell string. */
export interface UploadSpec {
  readonly executable: string;
  readonly args: readonly string[];
}

/** The one production candidate-upload specification. */
export const PRODUCTION_VERSION_UPLOAD_SPEC: UploadSpec = {
  executable: WRANGLER_EXECUTABLE,
  args: PRODUCTION_VERSION_UPLOAD_ARGV,
};

/**
 * The human-readable form of the SAME specification.
 *
 * Derived, never authored: the runbook prints this string and the release
 * wrapper spawns the argv it was derived from, so the two cannot drift. P3-2 of
 * the independent review asked for exactly this single source of truth.
 */
export const PRODUCTION_VERSION_UPLOAD_COMMAND = [
  PRODUCTION_VERSION_UPLOAD_SPEC.executable,
  ...PRODUCTION_VERSION_UPLOAD_SPEC.args,
].join(" ");

/** A single reason a proposed upload specification is refused. */
export interface UploadSpecViolation {
  readonly code:
    | "spec_malformed"
    | "empty_argv"
    | "wrong_executable"
    | "wrong_subcommand"
    | "keep_vars_missing"
    | "keep_vars_malformed"
    | "keep_vars_duplicated"
    | "config_missing"
    | "config_duplicated"
    | "wrong_config_path"
    | "argument_terminator_present"
    | "shell_metacharacter"
    | "extra_argument"
    | "argv_not_canonical";
  readonly detail: string;
}

/**
 * Characters that only mean anything to a shell.
 *
 * The upload is spawned with `shell: false`, so none of these can be
 * interpreted — but their presence proves the caller believes it is writing a
 * shell command, and a specification written in that belief is refused rather
 * than quietly executed as a literal argument.
 */
const SHELL_METACHARACTERS = /[\s&|;<>$`"'\\!#*?()[\]{}~^%]/;

/** The same set, minus the separators a real filesystem path legitimately uses. */
const EXECUTABLE_METACHARACTERS = /[&|;<>$`"'!#*?()[\]{}~^%]/;

/**
 * A C0 control character, including NUL.
 *
 * Tested by code point rather than by a regex character class: a literal
 * control character inside a pattern is unreadable, and `no-control-regex`
 * exists to say so.
 */
function hasControlCharacter(token: string): boolean {
  for (let index = 0; index < token.length; index += 1) {
    const code = token.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

const isUnsafeArgumentToken = (token: string) =>
  SHELL_METACHARACTERS.test(token) || hasControlCharacter(token);

const isUnsafeExecutablePath = (path: string) =>
  EXECUTABLE_METACHARACTERS.test(path) || hasControlCharacter(path);

/** Entry points that ARE Wrangler. A `.cmd`/`.bat` shim is deliberately absent. */
const WRANGLER_ENTRY_POINTS = new Set(["wrangler", "wrangler.js", "wrangler.mjs", "wrangler.cjs"]);

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? "";
}

/**
 * Validates a proposed candidate upload TOKEN BY TOKEN, fail-closed.
 *
 * Every rule is a refusal, and the last one requires the argv to be exactly the
 * canonical vector — so a specification that satisfies each individual rule by
 * some other arrangement is still refused. There is no accepted input that is
 * not the one canonical upload.
 *
 * Refusals name a violation CATEGORY and, where a token is safe to echo, the
 * token position. A rejected token's contents are never echoed: a caller that
 * smuggled a credential into an argument must not have it reprinted here.
 */
export function verifyUploadSpec(spec: unknown): {
  readonly ok: boolean;
  readonly violations: readonly UploadSpecViolation[];
} {
  const violations: UploadSpecViolation[] = [];
  const refuse = (code: UploadSpecViolation["code"], detail: string) =>
    violations.push({ code, detail });

  // A string is the exact input shape this correction exists to remove.
  if (typeof spec === "string") {
    refuse(
      "spec_malformed",
      "a shell command STRING was supplied. The production upload is an executable plus an " +
        "exact argv vector; a string cannot be validated token-by-token and is refused.",
    );
    return { ok: false, violations };
  }
  if (typeof spec !== "object" || spec === null || Array.isArray(spec)) {
    refuse(
      "spec_malformed",
      "upload specification must be an object with `executable` and `args`.",
    );
    return { ok: false, violations };
  }

  const candidate = spec as Record<string, unknown>;
  const unknownKeys = Object.keys(candidate).filter(
    (key) => key !== "executable" && key !== "args",
  );
  if (unknownKeys.length > 0) {
    refuse(
      "spec_malformed",
      `upload specification carries unknown key(s): ${unknownKeys.sort().join(", ")}.`,
    );
  }

  const { executable, args } = candidate;

  if (typeof executable !== "string" || executable.length === 0) {
    refuse("wrong_executable", "upload specification has no executable.");
  } else if (isUnsafeExecutablePath(executable)) {
    refuse("shell_metacharacter", "the executable path carries shell metacharacters.");
  } else if (!WRANGLER_ENTRY_POINTS.has(basename(executable))) {
    refuse(
      "wrong_executable",
      `the executable must be ${WRANGLER_EXECUTABLE} (or a wrangler .js/.mjs/.cjs entry point). ` +
        "No other program may perform a production candidate upload.",
    );
  }

  if (!Array.isArray(args) || args.some((token) => typeof token !== "string")) {
    refuse("spec_malformed", "`args` must be an array of strings.");
    return { ok: false, violations };
  }
  const argv = args as string[];
  if (argv.length === 0) {
    refuse("empty_argv", "the argument vector is empty — an upload with no arguments is refused.");
    return { ok: false, violations };
  }

  argv.forEach((token, index) => {
    if (isUnsafeArgumentToken(token)) {
      refuse(
        "shell_metacharacter",
        `argument ${index} carries whitespace or a shell metacharacter. Each argv element is one ` +
          "token; a token that needs a shell to split it is not a token.",
      );
    }
  });

  if (argv.includes("--")) {
    refuse(
      "argument_terminator_present",
      "the argv carries a `--` terminator. Anything after it is a positional operand rather than " +
        "a flag, so a keep-vars token there preserves nothing.",
    );
  }

  if (argv[0] !== "versions" || argv[1] !== "upload") {
    refuse(
      "wrong_subcommand",
      "the subcommand must be exactly `versions upload`. `deploy` moves traffic and is never the " +
        "candidate upload.",
    );
  }

  const keepVarsExact = argv.filter((token) => token === KEEP_VARS_FLAG);
  const keepVarsLookalikes = argv.filter(
    (token) => token !== KEEP_VARS_FLAG && token.includes("keep-vars"),
  );
  if (keepVarsLookalikes.length > 0) {
    refuse(
      "keep_vars_malformed",
      `${keepVarsLookalikes.length} argument(s) mention keep-vars without being exactly ` +
        `${KEEP_VARS_FLAG}. \`--keep-vars=false\`, \`--no-keep-vars\`, \`--keep-vars-disabled\` ` +
        "and a decoy carrying the substring all DELETE deployment-managed variables.",
    );
  }
  if (keepVarsExact.length === 0) {
    refuse(
      "keep_vars_missing",
      `the argv does not pass ${KEEP_VARS_FLAG} — Wrangler would delete every deployment-managed ` +
        "variable before applying the configuration.",
    );
  } else if (keepVarsExact.length > 1) {
    refuse(
      "keep_vars_duplicated",
      `${KEEP_VARS_FLAG} appears ${keepVarsExact.length} times. It is passed exactly once.`,
    );
  }

  const configIndices = argv.reduce<number[]>((found, token, index) => {
    if (token === "--config" || token.startsWith("--config=")) found.push(index);
    return found;
  }, []);
  if (configIndices.length === 0) {
    refuse(
      "config_missing",
      "the argv does not pass `--config`. Without it Wrangler reads `wrangler.jsonc` rather than " +
        "the generated artefact that actually deploys.",
    );
  } else if (configIndices.length > 1) {
    refuse("config_duplicated", "`--config` appears more than once.");
  } else {
    const [index] = configIndices;
    if (argv[index] !== "--config") {
      refuse(
        "wrong_config_path",
        "`--config` must be its own token followed by the path, not a `--config=<path>` pair.",
      );
    } else if (argv[index + 1] !== GENERATED_WORKER_CONFIG_PATH) {
      refuse(
        "wrong_config_path",
        `\`--config\` must name exactly ${GENERATED_WORKER_CONFIG_PATH} — the generated Worker ` +
          "configuration carrying keep_vars, not the reviewed JSONC source.",
      );
    }
  }

  const canonical = PRODUCTION_VERSION_UPLOAD_ARGV as readonly string[];
  const extra = argv.length - canonical.length;
  if (extra > 0 && violations.length === 0) {
    refuse("extra_argument", `${extra} argument(s) beyond the canonical upload were supplied.`);
  }
  if (argv.length !== canonical.length || argv.some((token, index) => token !== canonical[index])) {
    refuse(
      "argv_not_canonical",
      "the argument vector is not the canonical production upload. There is exactly one accepted " +
        "candidate upload, and this is not it.",
    );
  }

  return { ok: violations.length === 0, violations };
}

/** The version string Wrangler prints for `--version`, or null. */
export function parseWranglerVersionOutput(output: string): string | null {
  const match = /(?:^|\s)(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\s|$)/.exec(output.trim());
  return match ? match[1] : null;
}

/**
 * A HARD version gate. There is no "close enough" branch.
 *
 * Independent-review limitation 1: nothing in this repository pinned a Wrangler
 * version, so a release would have used whichever Wrangler happened to be on
 * the operator's PATH — including one whose `--keep-vars` handling nobody here
 * has verified. Resolution is repository-local or an explicit operator-supplied
 * path; the version it reports must equal `SUPPORTED_WRANGLER_VERSION` exactly.
 */
export function verifyWranglerVersion(found: string | null): {
  readonly ok: boolean;
  readonly reasons: readonly string[];
} {
  if (found === null) {
    return {
      ok: false,
      reasons: [
        "Wrangler did not report a parseable version. An unidentified Wrangler is never used for " +
          "a production candidate upload.",
      ],
    };
  }
  if (found !== SUPPORTED_WRANGLER_VERSION) {
    return {
      ok: false,
      reasons: [
        `Wrangler ${found} is not the supported version ${SUPPORTED_WRANGLER_VERSION}. ` +
          "`--keep-vars`, the `keep_vars` schema key and the version-detail API shape were " +
          "verified against the supported version only.",
      ],
    };
  }
  return { ok: true, reasons: [] };
}

/** Binding classes a fingerprint distinguishes. Values are never included. */
export type BindingClass = "assets" | "r2_bucket" | "plain_text" | "secret_text";

export interface BindingDescriptor {
  readonly name: string;
  readonly type: BindingClass;
}

/**
 * A sanitized binding fingerprint: sorted `name:type` pairs, joined.
 *
 * Deliberately value-free. Two Workers with the same fingerprint have the same
 * binding NAMES and CLASSES; nothing here reveals what any of them hold.
 */
export function bindingFingerprint(bindings: readonly BindingDescriptor[]): string {
  return [...bindings]
    .map((binding) => `${binding.name}:${binding.type}`)
    .sort()
    .join("|");
}

/** The class every expected binding must carry. */
export function expectedBindingClass(name: string): BindingClass | null {
  if (name === "ASSETS") return "assets";
  if ((REPOSITORY_DECLARED_BINDINGS as readonly string[]).includes(name)) return "r2_bucket";
  if ((DEPLOYMENT_MANAGED_PLAIN_TEXT_BINDINGS as readonly string[]).includes(name)) {
    return "plain_text";
  }
  if ((DEPLOYMENT_MANAGED_SECRET_BINDINGS as readonly string[]).includes(name)) {
    return "secret_text";
  }
  return null;
}

/** The complete expected binding set, as descriptors. */
export function expectedProductionBindings(): BindingDescriptor[] {
  const names = [
    ...REPOSITORY_DECLARED_BINDINGS,
    ...DEPLOYMENT_MANAGED_PLAIN_TEXT_BINDINGS,
    ...DEPLOYMENT_MANAGED_SECRET_BINDINGS,
  ];
  return names.map((name) => ({ name, type: expectedBindingClass(name) as BindingClass }));
}

/** A single reason a candidate is refused. Names only — never values. */
export interface PreservationViolation {
  readonly code:
    | "plain_text_binding_missing"
    | "secret_binding_missing"
    | "r2_binding_missing"
    | "assets_binding_missing"
    | "provider_binding_missing"
    | "binding_removed"
    | "binding_added"
    | "duplicate_binding"
    | "fingerprint_mismatch"
    | "forbidden_binding_present"
    | "binding_count_regressed"
    | "wrong_binding_class";
  readonly binding: string;
  readonly detail: string;
}

export interface PreservationVerdict {
  readonly ok: boolean;
  readonly violations: readonly PreservationViolation[];
  readonly liveFingerprint: string;
  readonly candidateFingerprint: string;
  readonly liveBindingCount: number;
  readonly candidateBindingCount: number;
}

/**
 * Compares a candidate's binding set against the live Worker's, FAIL-CLOSED.
 *
 * Every rule below is a STOP. There is no "warn" verdict and no path that
 * turns a missing binding into an acceptable candidate: a candidate that
 * cannot be proved equivalent is refused, including when it sits at 0%.
 *
 * `live` is sanitized name/type metadata captured by an authorized release
 * task. This function performs no I/O and contacts nothing.
 */
export function verifyBindingPreservation(
  live: readonly BindingDescriptor[],
  candidate: readonly BindingDescriptor[],
): PreservationVerdict {
  const violations: PreservationViolation[] = [];
  const candidateByName = new Map(candidate.map((binding) => [binding.name, binding]));
  const liveByName = new Map(live.map((binding) => [binding.name, binding]));

  // 0. DUPLICATES FIRST. A `Map` keyed by name silently keeps the last entry
  //    for a repeated name, so every check below would reason about a set the
  //    input does not actually describe — a 12-descriptor candidate carrying a
  //    duplicate really carries eleven distinct bindings, and the count check
  //    would not notice (independent-review P2-2). Duplicates are refused
  //    BEFORE any comparison rather than de-duplicated into agreement.
  for (const [label, set] of [
    ["live", live],
    ["candidate", candidate],
  ] as const) {
    const seen = new Set<string>();
    const reported = new Set<string>();
    for (const binding of set) {
      if (seen.has(binding.name) && !reported.has(binding.name)) {
        reported.add(binding.name);
        violations.push({
          code: "duplicate_binding",
          binding: binding.name,
          detail:
            `${binding.name} appears more than once in the ${label} snapshot. A binding name is ` +
            `unique on a Worker, so a repeated name is a corrupt capture, never a set to reconcile.`,
        });
      }
      seen.add(binding.name);
    }
  }

  // 1. Every deployment-managed PLAIN-TEXT variable must survive. This is the
  //    rule the failed candidate broke, and it is checked first.
  for (const name of DEPLOYMENT_MANAGED_PLAIN_TEXT_BINDINGS) {
    if (!candidateByName.has(name)) {
      violations.push({
        code:
          name === "STUDIO_STORAGE_WRITE_PROVIDER"
            ? "provider_binding_missing"
            : "plain_text_binding_missing",
        binding: name,
        detail:
          `${name} is absent from the candidate. Wrangler deletes deployment-managed vars ` +
          `unless the upload passes ${KEEP_VARS_FLAG} (or the config sets ` +
          `${KEEP_VARS_CONFIG_KEY}: true). Surviving secrets do not prove vars survived.`,
      });
    }
  }

  // 2. Every secret binding present on the live Worker must still be present,
  //    by NAME. No value is read, compared or recorded.
  for (const name of DEPLOYMENT_MANAGED_SECRET_BINDINGS) {
    if (liveByName.has(name) && !candidateByName.has(name)) {
      violations.push({
        code: "secret_binding_missing",
        binding: name,
        detail: `${name} exists on the live Worker but not on the candidate (name checked; value never read).`,
      });
    }
  }

  // 3. R2 and ASSETS bindings are declared by this repository and must be present.
  for (const name of REPOSITORY_DECLARED_BINDINGS) {
    if (!candidateByName.has(name)) {
      violations.push({
        code: name === "ASSETS" ? "assets_binding_missing" : "r2_binding_missing",
        binding: name,
        detail: `${name} is declared by this repository and is absent from the candidate.`,
      });
    }
  }

  // 4. NOTHING the live Worker has may silently disappear, including a binding
  //    this contract has not enumerated.
  for (const binding of live) {
    if (!candidateByName.has(binding.name)) {
      const alreadyReported = violations.some(
        (violation) => violation.binding === binding.name && violation.code !== "binding_removed",
      );
      if (!alreadyReported) {
        violations.push({
          code: "binding_removed",
          binding: binding.name,
          detail: `${binding.name} exists on the live Worker and was removed by this candidate.`,
        });
      }
    }
  }

  // 5. A binding must not change class — a plain-text variable quietly becoming
  //    something else is not a preserved variable.
  for (const binding of candidate) {
    const liveBinding = liveByName.get(binding.name);
    if (liveBinding && liveBinding.type !== binding.type) {
      violations.push({
        code: "wrong_binding_class",
        binding: binding.name,
        detail: `${binding.name} is ${liveBinding.type} on the live Worker and ${binding.type} on the candidate.`,
      });
    }
  }

  // 6. Bindings that must never exist.
  for (const name of FORBIDDEN_BINDINGS) {
    if (candidateByName.has(name)) {
      violations.push({
        code: "forbidden_binding_present",
        binding: name,
        detail: `${name} must not exist on the Worker.`,
      });
    }
  }

  // 7. A candidate may never carry FEWER bindings than the live Worker.
  if (candidate.length < live.length) {
    violations.push({
      code: "binding_count_regressed",
      binding: "(count)",
      detail:
        `candidate carries ${candidate.length} bindings; the live Worker carries ${live.length}. ` +
        `A candidate with fewer bindings is REJECTED even while it holds 0% of traffic.`,
    });
  }

  // 8. Nor may it carry a binding the live Worker does not have. Equal counts
  //    are NOT equal sets: one removed plus one added keeps the total at twelve
  //    while the environment has silently changed.
  for (const binding of candidate) {
    if (!liveByName.has(binding.name)) {
      violations.push({
        code: "binding_added",
        binding: binding.name,
        detail:
          `${binding.name} exists on the candidate and not on the live Worker. A candidate is ` +
          `promoted because it is EQUIVALENT, not because it is the same size.`,
      });
    }
  }

  const liveFingerprint = bindingFingerprint(live);
  const candidateFingerprint = bindingFingerprint(candidate);

  // 9. The gate the runbook actually states. It was previously computed,
  //    printed, and then left out of the pass condition (independent-review
  //    P2-2), so a candidate could be reported PASS in the same breath as
  //    `fingerprintsEqual: false`. It is now a violation in its own right and
  //    the last word on equality.
  if (liveFingerprint !== candidateFingerprint) {
    violations.push({
      code: "fingerprint_mismatch",
      binding: "(fingerprint)",
      detail:
        "the candidate's binding fingerprint is not EQUAL to the live Worker's. Name and class " +
        "are compared for every binding; no value is read, and no near-match is accepted.",
    });
  }

  return {
    ok: violations.length === 0,
    violations,
    liveFingerprint,
    candidateFingerprint,
    liveBindingCount: live.length,
    candidateBindingCount: candidate.length,
  };
}

/**
 * Proves a prepared deploy configuration and a proposed upload BOTH instruct
 * Wrangler to preserve deployment-managed variables.
 *
 * The configuration key and the flag are reported independently, because
 * Forever requires both and a release must not be able to satisfy the pair by
 * accident. The upload half is a STRUCTURED specification validated
 * token-by-token — never a shell string, and never a substring test.
 */
export function verifyKeepVarsContract(input: {
  readonly generatedConfig: Record<string, unknown>;
  readonly uploadSpec: unknown;
}): {
  readonly ok: boolean;
  readonly reasons: readonly string[];
  readonly specViolations: readonly UploadSpecViolation[];
} {
  const reasons: string[] = [];

  if (input.generatedConfig[KEEP_VARS_CONFIG_KEY] !== true) {
    reasons.push(
      `generated Worker configuration does not set ${KEEP_VARS_CONFIG_KEY}: true — ` +
        `Wrangler would delete deployment-managed vars before applying the configuration.`,
    );
  }

  const spec = verifyUploadSpec(input.uploadSpec);
  for (const violation of spec.violations) {
    reasons.push(`upload specification refused (${violation.code}): ${violation.detail}`);
  }

  // A `vars` block would REPLACE the deployment-managed values, which is the
  // other way to lose them.
  if (input.generatedConfig.vars !== undefined) {
    reasons.push(
      `generated Worker configuration declares a vars block — declaring vars replaces the ` +
        `deployment-managed values this contract exists to preserve.`,
    );
  }

  return { ok: reasons.length === 0, reasons, specViolations: spec.violations };
}
