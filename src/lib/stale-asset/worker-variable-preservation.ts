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

/** The production candidate upload command, in full. */
export const PRODUCTION_VERSION_UPLOAD_COMMAND =
  "wrangler versions upload --keep-vars --config .output/server/wrangler.json";

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

  return {
    ok: violations.length === 0,
    violations,
    liveFingerprint: bindingFingerprint(live),
    candidateFingerprint: bindingFingerprint(candidate),
    liveBindingCount: live.length,
    candidateBindingCount: candidate.length,
  };
}

/**
 * Proves a prepared deploy configuration instructs Wrangler to preserve
 * deployment-managed variables.
 *
 * Accepts EITHER the generated configuration carrying `keep_vars: true` OR an
 * upload command that passes `--keep-vars`. Forever requires both, and this
 * function reports each independently so a release cannot satisfy the pair by
 * accident.
 */
export function verifyKeepVarsContract(input: {
  readonly generatedConfig: Record<string, unknown>;
  readonly uploadCommand: string;
}): { readonly ok: boolean; readonly reasons: readonly string[] } {
  const reasons: string[] = [];

  if (input.generatedConfig[KEEP_VARS_CONFIG_KEY] !== true) {
    reasons.push(
      `generated Worker configuration does not set ${KEEP_VARS_CONFIG_KEY}: true — ` +
        `Wrangler would delete deployment-managed vars before applying the configuration.`,
    );
  }

  if (!input.uploadCommand.includes(KEEP_VARS_FLAG)) {
    reasons.push(
      `upload command does not pass ${KEEP_VARS_FLAG} — the configuration key alone is not the ` +
        `defence in depth this release contract requires.`,
    );
  }

  // A `vars` block would REPLACE the deployment-managed values, which is the
  // other way to lose them.
  if (input.generatedConfig.vars !== undefined) {
    reasons.push(
      `generated Worker configuration declares a vars block — declaring vars replaces the ` +
        `deployment-managed values this contract exists to preserve.`,
    );
  }

  return { ok: reasons.length === 0, reasons };
}
