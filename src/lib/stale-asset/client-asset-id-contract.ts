/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — the ONE public CLIENT ASSET
 * identity shape.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NO LONGER CALLED A BUILD ID (narrow-re-review RR2-P1-1)
 * ---------------------------------------------------------------------------
 *
 * It used to be `FOREVER_BUILD_ID`, and that name claimed something the value
 * does not carry. The value is a digest of the emitted CLIENT asset graph plus
 * the generated Worker configuration. It is complete over everything a browser
 * can fail to fetch, and it is deliberately blind to the server JavaScript
 * bundle, which was MEASURED non-reproducible in this toolchain. A release that
 * changes only server code therefore ships the SAME value — correctly, because
 * no chunk an open page holds can 404 — and a name containing "BUILD" invited
 * the release runbook to spend it as proof of "the new build", in both the
 * cutover and the rollback direction. It cannot prove that. The re-review
 * measured exactly that gap: two genuinely different deployable Worker
 * artefacts under one identifier.
 *
 * There are therefore now two explicitly different identities, and neither can
 * stand in for the other:
 *
 *   CLIENT_ASSET_ID    this file. Proves CLIENT ASSET COMPATIBILITY — whether
 *                      an already-running page's content-hashed chunks still
 *                      exist at the origin. Public, bounded, browser-readable.
 *                      May legitimately be unchanged by a server-only release.
 *
 *   WORKER_RELEASE_ID  `worker-release-identity.ts`. The immutable Cloudflare
 *                      Worker version UUID returned by the candidate upload.
 *                      Proves WHICH WORKER IS DEPLOYED, and is the only thing
 *                      allowed to gate a release, a traffic allocation or a
 *                      rollback target. Never derived from the client bundle,
 *                      never manufactured locally, never exposed to a browser.
 *
 * This module is deliberately dependency-free — no DOM, no node, no React, no
 * imports at all — so the build script, the Vite config, the server bundle and
 * the browser bundle can all import the same bytes. The bounded pattern used to
 * exist twice, which is a drift waiting to happen in the one PR whose thesis is
 * that the build and the browser must not drift (independent-review P3-4).
 *
 * WHAT A CLIENT ASSET IDENTIFIER IS. A short, lowercase, bounded, public digest
 * of the emitted client asset graph. It is not a secret, not a credential, not
 * a token, not a path, not a GitHub reference and not a Worker version — exactly
 * as public as the content-hashed asset filenames it accompanies.
 */

/** Lowercase alphanumerics, at most 32 characters. Bounded on purpose. */
export const FOREVER_CLIENT_ASSET_ID_PATTERN = /^[a-z0-9]{1,32}$/;

/** The value used when no build-time identity is available (dev server, tests). */
export const FOREVER_CLIENT_ASSET_ID_FALLBACK = "development";

/**
 * The placeholder identity the first pass of the two-pass build emits.
 *
 * Fixed, bounded and recognisable. The output digest is computed with this
 * value in place of the real identity, so the identity can be derived FROM the
 * emitted client output without that output depending on the identity it will
 * carry. Exactly as long as a derived identity, because the seal is an in-place
 * byte-for-byte substitution.
 */
export const FOREVER_CLIENT_ASSET_ID_PLACEHOLDER = "foreverclientassetplaceholder000";

/** Hex characters in a derived identity — 32 hex chars is 128 bits of SHA-256. */
export const FOREVER_CLIENT_ASSET_ID_HEX_LENGTH = 32;

export function isBoundedForeverClientAssetId(value: unknown): value is string {
  return typeof value === "string" && FOREVER_CLIENT_ASSET_ID_PATTERN.test(value);
}
