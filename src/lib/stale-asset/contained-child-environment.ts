/**
 * FOREVER-PR139-REVIEW-CORRECTIONS-001 — the MINIMAL, SYNTHETIC environment an
 * offline release child process is given.
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT THIS EXISTS TO REMOVE (PR139 independent review, P2-3)
 * ---------------------------------------------------------------------------
 *
 * The offline serialization proof spawned the real Wrangler with:
 *
 *   env: { ...process.env, CLOUDFLARE_API_TOKEN: DUMMY, ... }
 *
 * Three dummy values were layered on top of the operator's COMPLETE
 * environment. Everything else was inherited: `CLOUDFLARE_API_KEY`,
 * `CLOUDFLARE_EMAIL`, `CF_API_TOKEN`, every other `CLOUDFLARE_*` and
 * `WRANGLER_*`, `HTTP_PROXY`/`HTTPS_PROXY`, the parent `NODE_OPTIONS`, npm
 * authentication, Supabase and R2 credentials — and `HOME`, `USERPROFILE`,
 * `APPDATA`, `LOCALAPPDATA` and `XDG_CONFIG_HOME`, which is where Wrangler
 * keeps the operator's real OAuth credentials.
 *
 * A test described as credential-free was structurally able to authenticate. It
 * did not, because the API base URL pointed at loopback — but "the destination
 * happened to be wrong" is containment by coincidence, and the review was right
 * to refuse it.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS BUILT NOW
 * ---------------------------------------------------------------------------
 *
 * The child environment is CONSTRUCTED, never inherited. It contains:
 *
 *   - the handful of operating-system variables a process genuinely needs to
 *     start on this platform (and a PATH reduced to the system directory);
 *   - every configuration and cache root redirected into one throwaway
 *     directory, so the operator's real Wrangler/OAuth configuration is not
 *     merely unused but UNREACHABLE;
 *   - synthetic Cloudflare credentials that are not credentials;
 *   - metrics, telemetry and update checks disabled;
 *   - whatever the caller explicitly adds.
 *
 * Nothing else. `auditContainedChildEnv` is the same contract expressed as a
 * check, so a behavioural test can assert it against the environment a real
 * child process actually observed rather than against the intent of this file.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Prefixes that must NEVER reach a contained child.
 *
 * `CF_` and `CLOUDFLARE_` cover every credential and account identifier
 * Wrangler recognises; `WRANGLER_` covers operator overrides that could
 * redirect the run; the rest are this repository's own production secrets,
 * which have no business in a release child at all.
 */
export const FORBIDDEN_CHILD_ENV_PREFIXES = [
  "CLOUDFLARE_",
  "CF_",
  "WRANGLER_",
  "SUPABASE_",
  "R2_",
  "AWS_",
  "NPM_",
  "npm_",
  "VITE_",
  "CORALINA_",
  "STUDIO_",
] as const;

/** Individual keys that must never reach a contained child. */
export const FORBIDDEN_CHILD_ENV_KEYS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
  "NODE_OPTIONS",
  "NODE_EXTRA_CA_CERTS",
  "NODE_AUTH_TOKEN",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "DATABASE_URL",
] as const;

/**
 * The ONLY keys carrying a forbidden prefix that a contained child may have.
 *
 * Every one is synthetic or a containment control. `CLOUDFLARE_API_KEY`,
 * `CLOUDFLARE_EMAIL` and `CF_API_TOKEN` are deliberately absent — those are the
 * global-key credential pair and the legacy token, and no offline proof needs
 * any of them.
 */
export const ALLOWED_SYNTHETIC_CHILD_ENV_KEYS = [
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_BASE_URL",
  "WRANGLER_SEND_METRICS",
] as const;

/** Not a credential. A fixed, obviously synthetic string, committed on purpose. */
export const SYNTHETIC_CLOUDFLARE_API_TOKEN = "dummy-token-not-a-credential";

/** Not an account. Thirty-two zeroes, which no Cloudflare account can be. */
export const SYNTHETIC_CLOUDFLARE_ACCOUNT_ID = "00000000000000000000000000000000";

/**
 * Operating-system variables copied verbatim, per platform.
 *
 * These are the values a process needs to START — the Windows system root and
 * executable-extension list, the POSIX locale — and none of them can carry a
 * credential or redirect a network destination.
 */
export const OS_LAUNCH_ENV_KEYS: readonly string[] =
  process.platform === "win32"
    ? [
        "SystemRoot",
        "windir",
        "COMSPEC",
        "PATHEXT",
        "NUMBER_OF_PROCESSORS",
        "PROCESSOR_ARCHITECTURE",
      ]
    : ["LANG", "LC_ALL", "TZ"];

/** The configuration and cache roots redirected into the throwaway directory. */
export const ISOLATED_CONFIG_ENV_KEYS = [
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  "TMPDIR",
  "TEMP",
  "TMP",
] as const;

/**
 * The three temporary-directory spellings, which must name ONE directory.
 *
 * `os.tmpdir()` reads `TEMP` first on Windows and `TMPDIR` first elsewhere, so
 * pointing them at different places would give the child a different temporary
 * directory per platform — and a caller that seeds or inspects one of them
 * would be looking at the wrong one half the time.
 */
const SHARED_TEMP_ENV_KEYS = new Set<string>(["TMPDIR", "TEMP", "TMP"]);
const TEMP_SUBDIRECTORY = "tmp";

export interface IsolatedConfigRoot {
  /** The single throwaway directory every redirected root lives under. */
  readonly root: string;
  /** The one directory `os.tmpdir()` resolves to inside the child, on any platform. */
  readonly tempDirectory: string;
  /** Removes the whole tree. Safe to call twice. */
  readonly dispose: () => void;
}

/** Where a redirected root lives, given the isolation root. */
function isolatedPathFor(root: string, key: string): string {
  return join(root, SHARED_TEMP_ENV_KEYS.has(key) ? TEMP_SUBDIRECTORY : key.toLowerCase());
}

/**
 * Creates one throwaway directory tree for a contained child's configuration.
 *
 * Every redirected root is a SUBDIRECTORY of `root`, so `auditContainedChildEnv`
 * can prove containment with a prefix comparison and `dispose` can remove all of
 * it in one call.
 */
export function createIsolatedConfigRoot(prefix: string): IsolatedConfigRoot {
  const root = mkdtempSync(join(tmpdir(), prefix));
  for (const key of ISOLATED_CONFIG_ENV_KEYS) {
    mkdirSync(isolatedPathFor(root, key), { recursive: true });
  }
  return {
    root,
    tempDirectory: join(root, TEMP_SUBDIRECTORY),
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * Builds the complete environment for a contained child.
 *
 * The parent environment is READ for operating-system keys only. It is never
 * spread, so a key that is not named here cannot reach the child by default —
 * which is the difference between an allowlist and a redaction list.
 */
export function buildContainedChildEnv(input: {
  readonly isolated: IsolatedConfigRoot;
  readonly extra?: Readonly<Record<string, string>>;
  readonly parentEnv?: Readonly<Record<string, string | undefined>>;
}): Record<string, string> {
  const parentEnv = input.parentEnv ?? process.env;
  const env: Record<string, string> = {};

  for (const key of OS_LAUNCH_ENV_KEYS) {
    const value = parentEnv[key];
    if (typeof value === "string" && value.length > 0) env[key] = value;
  }

  // A PATH reduced to the system directory. The child is launched by ABSOLUTE
  // path, so PATH exists only for platform primitives — never to find Wrangler.
  const systemRoot =
    typeof parentEnv.SystemRoot === "string" ? parentEnv.SystemRoot : "C:\\Windows";
  env.PATH = process.platform === "win32" ? join(systemRoot, "System32") : "/usr/bin:/bin";

  for (const key of ISOLATED_CONFIG_ENV_KEYS) {
    env[key] = isolatedPathFor(input.isolated.root, key);
  }

  // Synthetic credentials. Present so Wrangler takes its token code path rather
  // than looking for an operator login — which, under the isolated HOME above,
  // it could not find in any case.
  env.CLOUDFLARE_API_TOKEN = SYNTHETIC_CLOUDFLARE_API_TOKEN;
  env.CLOUDFLARE_ACCOUNT_ID = SYNTHETIC_CLOUDFLARE_ACCOUNT_ID;

  // Metrics, telemetry and update checks OFF. Each of these is an outbound
  // request the offline proof must not make.
  env.WRANGLER_SEND_METRICS = "false";
  env.NO_UPDATE_NOTIFIER = "1";
  env.CI = "1";
  env.NO_COLOR = "1";
  env.FORCE_COLOR = "0";

  return { ...env, ...(input.extra ?? {}) };
}

export interface ContainedChildEnvFinding {
  readonly code:
    | "forbidden_key_present"
    | "forbidden_prefix_present"
    | "config_root_not_isolated"
    | "config_root_missing"
    | "synthetic_credential_wrong"
    | "metrics_not_disabled";
  readonly key: string;
  readonly detail: string;
}

/**
 * Audits an environment a child process ACTUALLY observed.
 *
 * Deliberately takes a plain record rather than reading `process.env`, so the
 * behavioural test can pass back exactly what the spawned child reported about
 * itself. A value is NEVER included in a finding — the point of the audit is
 * that forbidden values do not travel, and a finding that quoted one would
 * transport it into the test output.
 */
export function auditContainedChildEnv(
  observed: Readonly<Record<string, string | undefined>>,
  isolatedRoot: string,
): { readonly ok: boolean; readonly findings: readonly ContainedChildEnvFinding[] } {
  const findings: ContainedChildEnvFinding[] = [];
  const allowed = new Set<string>(ALLOWED_SYNTHETIC_CHILD_ENV_KEYS);
  const forbiddenKeys = new Set<string>(FORBIDDEN_CHILD_ENV_KEYS);

  for (const key of Object.keys(observed)) {
    if (forbiddenKeys.has(key)) {
      findings.push({
        code: "forbidden_key_present",
        key,
        detail: `${key} reached the child. Its value is not reported.`,
      });
      continue;
    }
    if (allowed.has(key)) continue;
    const prefix = FORBIDDEN_CHILD_ENV_PREFIXES.find((candidate) => key.startsWith(candidate));
    if (prefix !== undefined) {
      findings.push({
        code: "forbidden_prefix_present",
        key,
        detail: `${key} carries the forbidden prefix ${prefix}. Its value is not reported.`,
      });
    }
  }

  const normalize = (value: string) => value.replace(/\\/g, "/").toLowerCase();
  const rootPrefix = normalize(isolatedRoot);
  for (const key of ISOLATED_CONFIG_ENV_KEYS) {
    const value = observed[key];
    if (typeof value !== "string" || value.length === 0) {
      findings.push({
        code: "config_root_missing",
        key,
        detail: `${key} is unset, so the child would fall back to the operator's real location.`,
      });
      continue;
    }
    if (!normalize(value).startsWith(rootPrefix)) {
      findings.push({
        code: "config_root_not_isolated",
        key,
        detail: `${key} does not point inside the throwaway isolation root.`,
      });
    }
  }

  if (observed.CLOUDFLARE_API_TOKEN !== SYNTHETIC_CLOUDFLARE_API_TOKEN) {
    findings.push({
      code: "synthetic_credential_wrong",
      key: "CLOUDFLARE_API_TOKEN",
      detail: "the child's Cloudflare token is not the fixed synthetic string.",
    });
  }
  if (observed.CLOUDFLARE_ACCOUNT_ID !== SYNTHETIC_CLOUDFLARE_ACCOUNT_ID) {
    findings.push({
      code: "synthetic_credential_wrong",
      key: "CLOUDFLARE_ACCOUNT_ID",
      detail: "the child's Cloudflare account id is not the fixed synthetic string.",
    });
  }
  if (observed.WRANGLER_SEND_METRICS !== "false") {
    findings.push({
      code: "metrics_not_disabled",
      key: "WRANGLER_SEND_METRICS",
      detail: "metrics were not disabled for the child.",
    });
  }

  return { ok: findings.length === 0, findings };
}
