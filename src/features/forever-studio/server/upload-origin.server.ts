/**
 * Forever Studio — the fail-closed upload-origin boundary (Issue #103).
 *
 * WHAT THIS REFUSES, AND WHY IT IS ON THE SERVER
 * ---------------------------------------------
 * A Studio upload is not a normal write. The server hands the browser
 * short-lived, single-object upload credentials and the BROWSER then sends the
 * bytes straight to private storage. Private storage accepts a browser write
 * from the declared production origin and from nowhere else, so a Studio page
 * opened on a Cloudflare version-preview origin can be authenticated, be an
 * active Owner, be handed valid upload targets — and still never deliver one
 * byte, because the browser's cross-origin preflight is refused before the PUT.
 * That is exactly what happened: two jobs, four files, zero objects.
 *
 * The browser-side warning in `StudioUploader` spares the Owner that journey.
 * It is not the boundary, because a stale bundle, a forged request or a raw
 * HTTP call never runs it. THIS is the boundary: every upload-allocation
 * endpoint re-derives the answer from the actual inbound request, before a job
 * row, an audit entry, a presigned target, an archive row or a multipart upload
 * can exist.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It changes no storage rule, disables no version preview, and refuses no
 * read. A preview version remains fully usable for release verification —
 * sign in, inspect, read — and is refused only where an upload would be
 * allocated. It also weakens nothing that already guards these endpoints: it
 * runs in addition to JWT verification, active membership, ownership and the
 * archive-capability gate, never instead of any of them.
 */

import { normalizeOrigin, PUBLIC_SITE_ORIGIN } from "@/lib/site-origin";

import {
  STUDIO_UPLOAD_ORIGIN_REFUSAL_CODE,
  STUDIO_UPLOAD_ORIGIN_REFUSAL_MESSAGE,
} from "../studio-upload-origin";
import { StudioAccessError } from "./contracts";
import { redact } from "./errors";

/**
 * The one origin Studio uploads may come from.
 *
 * Precedence, and why the last tier is what it is:
 *
 *   1. `FOREVER_SITE_ORIGIN` — a runtime deployment variable, when one is set;
 *   2. `VITE_PUBLIC_SITE_ORIGIN` read from the RUNTIME environment, which is
 *      how local development and Node tooling state the origin (a `.env`
 *      reaches `process.env` there);
 *   3. `PUBLIC_SITE_ORIGIN` — the origin THIS BUILD was built with.
 *
 * Tier 3 is deliberately the build's own value rather than the bare default.
 * `VITE_PUBLIC_SITE_ORIGIN` is a Vite variable: it is inlined into the bundle
 * at build time and does NOT appear in a deployed Worker's `process.env`
 * (`wrangler.jsonc` declares no `vars` block at all). Falling back to the
 * hard-coded default instead would let a build configured for one origin be
 * policed by a server expecting another — the browser would render the
 * uploader and the server would refuse every request it sent. Tier 3 makes the
 * two halves agree by construction whenever `FOREVER_SITE_ORIGIN` is unset.
 *
 * The remaining way to make them disagree is to set `FOREVER_SITE_ORIGIN`
 * WITHOUT rebuilding with the same `VITE_PUBLIC_SITE_ORIGIN`. That direction
 * fails safe — the browser hides the uploader rather than starting an upload
 * that cannot land — and `.env.example` states the pairing requirement.
 *
 * A configured value that is not an origin (a path, a wildcard, a hostname
 * with no scheme, a list) resolves to `null`, and `null` allows nothing. There
 * is deliberately no "allow additional origins" input: local development and
 * automated tests configure the ONE expected origin explicitly, so an unknown
 * origin is never silently allowed anywhere, least of all in production.
 */
export function resolveExpectedUploadOrigin(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured =
    env.FOREVER_SITE_ORIGIN?.trim() || env.VITE_PUBLIC_SITE_ORIGIN?.trim() || PUBLIC_SITE_ORIGIN;
  return normalizeOrigin(configured);
}

/** One header value, tolerating a request object without usable headers. */
function header(request: Request | null | undefined, name: string): string | null {
  try {
    return request?.headers?.get(name) ?? null;
  } catch {
    return null;
  }
}

/**
 * The origin a `Referer` names, or `null`.
 *
 * A Referer carries a full URL, so its origin is extracted before the strict
 * origin check runs. It is corroboration only: an absent or unparseable Referer
 * proves nothing and is ignored, while one that names a DIFFERENT origin than
 * the `Origin` header is a contradiction, and a contradiction is refused.
 */
function refererOrigin(request: Request | null | undefined): string | null {
  const value = header(request, "referer");
  if (!value) return null;
  try {
    return normalizeOrigin(new URL(value.trim()).origin);
  } catch {
    return null;
  }
}

/** The refusal itself: one stable safe code, one fixed message, never retryable. */
function refuse(reason: string, observed: string | null): never {
  // Server-side only, and redacted like every other Studio failure line. The
  // browser is told the code and the fixed message and nothing else.
  console.warn(`[studio] upload origin refused (${reason}): ${redact(observed ?? "<none>")}`);
  throw new StudioAccessError(
    STUDIO_UPLOAD_ORIGIN_REFUSAL_CODE,
    STUDIO_UPLOAD_ORIGIN_REFUSAL_MESSAGE,
  );
}

/**
 * Refuse unless THIS request came from the declared production origin.
 *
 * The request's own `Origin` header is the authority. It is set by the browser
 * and cannot be written by page script, and every guarded endpoint is a POST,
 * which browsers always stamp with it. Nothing inside the request body is
 * consulted: a client-supplied origin field would be the uploader vouching for
 * itself.
 *
 * Fails closed on all four ways the answer can be anything but a clear yes:
 *
 *   - no request context at all (nothing to check);
 *   - a missing `Origin` header (nothing to check);
 *   - an `Origin` that is not an origin, including the comma-joined value a
 *     duplicated header produces and the opaque `null` a sandboxed context
 *     sends (nothing that can match);
 *   - an `Origin` that is an origin but not THE origin — every version-preview
 *     host, every lookalike host, an http/https mismatch and an explicit port
 *     mismatch all land here;
 *
 * and on one way it can be contradictory: an `Origin` that matches while the
 * `Referer` names a different origin.
 *
 * Returns normally, having done nothing, when the request is allowed.
 */
export function assertStudioUploadOrigin(
  request: Request | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const expected = resolveExpectedUploadOrigin(env);
  if (!expected) refuse("no expected origin configured", null);
  if (!request) refuse("no request context", null);

  const raw = header(request, "origin");
  const observed = normalizeOrigin(raw);
  if (!observed) refuse(raw ? "unusable origin header" : "missing origin header", raw);
  if (observed !== expected) refuse("origin not allowed", observed);

  const referer = refererOrigin(request);
  if (referer !== null && referer !== observed) refuse("origin/referer conflict", referer);
}

/**
 * The endpoint-facing guard: assert against the LIVE request.
 *
 * The request is read from the server runtime's own request context rather
 * than from anything the caller passes in, so an endpoint cannot accidentally
 * check the wrong thing. A runtime with no request context (which a real
 * endpoint never has, and which is what an internal or scripted caller looks
 * like) reads as `null` and is refused, because "no origin" is not "the right
 * origin".
 */
export async function requireStudioUploadOrigin(): Promise<void> {
  let request: Request | null = null;
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    request = getRequest() ?? null;
  } catch {
    request = null;
  }
  assertStudioUploadOrigin(request);
}
