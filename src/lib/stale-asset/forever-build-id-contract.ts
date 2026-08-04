/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — the ONE public build-identity shape.
 *
 * Closes independent-review P3-4. The bounded identifier pattern used to exist
 * twice: once in `scripts/build/forever-build-id.ts` and once in
 * `stale-asset-recovery-contract.ts`. Two copies of a contract whose entire
 * purpose is that the build and the browser agree is a drift waiting to happen,
 * in the one PR whose thesis is that they must not drift.
 *
 * This module is therefore the single declaration, and it is deliberately
 * dependency-free — no DOM, no node, no React, no imports at all — so the build
 * script, the Vite config, the server bundle and the browser bundle can all
 * import the same bytes.
 *
 * WHAT A BUILD IDENTIFIER IS. A short, lowercase, bounded, public digest of the
 * emitted runtime graph. It is not a secret, not a credential, not a token, not
 * a path and not a GitHub reference — exactly as public as the content-hashed
 * asset filenames it accompanies.
 */

/** Lowercase alphanumerics, at most 32 characters. Bounded on purpose. */
export const FOREVER_BUILD_ID_PATTERN = /^[a-z0-9]{1,32}$/;

/** The value used when no build-time identity is available (dev server, tests). */
export const FOREVER_BUILD_ID_FALLBACK = "development";

/**
 * The placeholder identity the first pass of the two-pass build emits.
 *
 * Fixed, bounded and recognisable. The output digest is computed with this
 * value in place of the real identity, so the identity can be derived FROM the
 * emitted output without the output depending on the identity it will carry.
 */
export const FOREVER_BUILD_ID_PLACEHOLDER = "foreverbuildidplaceholder0000000";

/** Hex characters in a derived identity — 32 hex chars is 128 bits of SHA-256. */
export const FOREVER_BUILD_ID_HEX_LENGTH = 32;

export function isBoundedForeverBuildId(value: unknown): value is string {
  return typeof value === "string" && FOREVER_BUILD_ID_PATTERN.test(value);
}
