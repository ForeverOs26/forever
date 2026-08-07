/**
 * Forever Studio — which origin may start an upload, and what an Owner is told
 * when this one may not.
 *
 * WHAT THIS IS FOR (Issue #103)
 * ----------------------------
 * A Cloudflare version preview serves the SAME build from a different origin
 * (`<version-prefix>-<worker>.<subdomain>.workers.dev`). That is exactly what
 * makes it useful before a cutover — and exactly what makes it unsafe for an
 * upload: a Studio upload sends bytes from the browser straight to private
 * storage, and private storage accepts browser writes from the declared
 * production origin and nothing else. Opened on a preview origin, Studio
 * therefore created a job, handed out upload targets, and then never sent a
 * single byte, because the browser's preflight was refused before the PUT.
 *
 * The fix is not to widen storage's allowlist, and not to switch previews off.
 * It is to refuse to BEGIN an upload anywhere but the declared production
 * origin, so a preview never reaches the state where bytes are expected.
 *
 * WHAT THIS MODULE IS, AND IS NOT
 * -------------------------------
 * It is the client-safe half: one refusal code, the exact copy the Owner
 * reads, the allow-decision, and the production URL the warning links to. It
 * imports nothing from the server, and it names no bucket, endpoint, key,
 * credential, provider or storage rule.
 *
 * It is a UI signal and an error code — NOT the boundary. The boundary is the
 * server-side refusal in `server/upload-origin.server.ts`, which re-derives the
 * answer from the actual request and never asks the browser.
 */

import { normalizeOrigin, originsMatch } from "@/lib/site-origin";

/**
 * The safe, stable code every upload-allocation endpoint refuses with.
 *
 * It names the CONDITION, never the request: not the rejected origin, not the
 * host, not the Worker version, not the file, and not the storage rule that
 * would have refused later.
 */
export const STUDIO_UPLOAD_ORIGIN_REFUSAL_CODE = "studio_upload_origin_not_allowed";

/**
 * What the Owner is told when the server refuses.
 *
 * One sentence of what, one of what to do. It is a fixed string — never
 * assembled from anything in the request — so no rejected origin, host or
 * identifier can ride out on it.
 */
export const STUDIO_UPLOAD_ORIGIN_REFUSAL_MESSAGE =
  "Uploads are only accepted from the main Forever Studio address. Open Studio at its usual " +
  "address and upload from there.";

/** Heading of the browser-side warning, on a version Studio may not upload from. */
export const STUDIO_UPLOAD_PREVIEW_TITLE = "Uploading is disabled on this preview version";

/**
 * Body of the browser-side warning.
 *
 * It says what is disabled, that nothing is broken, and what to do. It states
 * no version identifier, no hostname and no storage detail — the link carries
 * the destination, so the copy does not have to.
 */
export const STUDIO_UPLOAD_PREVIEW_NOTE =
  "This is a preview version of Forever, used to check a release before it goes live. Nothing " +
  "here is broken and nothing is lost — uploading is simply switched off, because files uploaded " +
  "from a preview address never arrive. Open Studio at its usual address to upload.";

/** Label of the safe link out of the warning. */
export const STUDIO_UPLOAD_PREVIEW_LINK_LABEL = "Open Forever Studio";

/** Where an Owner is sent when the current pathname is not safe to preserve. */
export const STUDIO_UPLOAD_PATHNAME = "/studio/upload";

/**
 * One path segment of a Studio route: it must START with a letter, digit,
 * underscore or dash, so `.` and `..` are not segments and a traversal never
 * reads as an ordinary name.
 */
const STUDIO_PATH_SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;

/**
 * Whether a pathname may be carried across to the production origin.
 *
 * An allowlist by SHAPE, not a sanitizer: every Studio URL is `/studio`
 * followed by ordinary path segments, and anything else — a protocol-relative
 * `//host`, a traversal, an empty segment, an encoded byte, a query, a
 * fragment, another area of the site — simply does not match and the caller
 * falls back to the upload route. Nothing is stripped or repaired, because a
 * repaired path is a path someone chose and we silently changed.
 */
function isSafeStudioPathname(pathname: string): boolean {
  if (!pathname.startsWith("/")) return false;
  const trimmed = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  const segments = trimmed.slice(1).split("/");
  if (segments[0] !== "studio") return false;
  return segments.every((segment) => STUDIO_PATH_SEGMENT.test(segment));
}

/**
 * The RENDER question: may this browser be shown an upload interface?
 *
 * There is deliberately no separate submit-time check, because there is no
 * submit control to guard: an origin that fails here renders no form at all.
 * The question that actually authorizes an upload is asked on the server.
 *
 * Fails closed on everything that is not an exact origin match — an unknown
 * observed origin, an unknown expected origin, and the two being different are
 * all one answer: no.
 */
export function isStudioUploadOriginAllowed(
  observedOrigin: string | null | undefined,
  expectedOrigin: string | null | undefined,
): boolean {
  return originsMatch(observedOrigin, expectedOrigin);
}

/**
 * The equivalent Studio URL on the production origin.
 *
 * The DESTINATION always comes from the configured production origin — never
 * from the current location — so a preview page can never link back to itself.
 * The current pathname is preserved only when it is recognisably a Studio route
 * (so "upload" stays "upload" and a project editor stays that project's
 * editor); anything else falls back to the upload route. Query and fragment are
 * always dropped: they can carry state that belongs to the page the Owner is
 * leaving.
 *
 * Returns `null` when no usable production origin is configured, so a caller
 * renders no link at all rather than a broken one.
 */
export function studioProductionUrl(
  expectedOrigin: string | null | undefined,
  pathname?: string | null,
): string | null {
  const origin = normalizeOrigin(expectedOrigin);
  if (!origin) return null;
  const candidate = typeof pathname === "string" ? pathname : "";
  const safe = isSafeStudioPathname(candidate) ? candidate : STUDIO_UPLOAD_PATHNAME;
  return `${origin}${safe}`;
}
