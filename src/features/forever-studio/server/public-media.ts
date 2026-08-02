/**
 * Forever Studio — the public media delivery route
 * (FOREVER-R2-MEDIA-STORAGE-CUTOVER-001).
 *
 * Every public derivative Forever stores in R2 is delivered from Forever's own
 * origin, through `/media/…`. The R2 buckets stay private at the bucket level:
 * no `r2.dev` access, no public custom domain, no anonymous listing. THIS
 * handler is the only public read path that exists.
 *
 * WHAT IT WILL AND WILL NOT DO
 *   - reads exactly one bucket kind: `public_media`. There is no parameter, no
 *     header and no path that can make it read private sources or archives —
 *     it prepends the immutable `media/` key prefix to whatever it is asked
 *     for, so a request for a private key becomes a public key that does not
 *     exist;
 *   - GET and HEAD only;
 *   - byte ranges (video seeking), conditional requests, correct
 *     Content-Type/Length/ETag, immutable caching for immutable objects;
 *   - never lists a prefix, never reveals a bucket name, never reveals an
 *     original filename, never proxies a caller-supplied URL;
 *   - one generic 404 for absent, malformed, traversal-shaped, and
 *     inaccessible keys alike, so existence is never disclosed.
 *
 * Pure and dependency-injected: the source is an interface, so the whole
 * contract is testable without R2, a Worker, or a network.
 */

import { PUBLIC_MEDIA_KEY_PREFIX } from "./storage/r2-layout";

/** One stored public object, as the delivery source reports it. */
export interface PublicMediaHead {
  size: number;
  contentType: string | null;
  etag: string;
}

export interface PublicMediaBody extends PublicMediaHead {
  body: ReadableStream<Uint8Array> | null;
  /** Present when the source honoured a range request. */
  range?: { start: number; endExclusive: number };
}

/**
 * The ONLY capability the route has. It is scoped to the public bucket by
 * construction — an implementation is created with one bucket and cannot be
 * pointed at another one by anything in a request.
 */
export interface PublicMediaSource {
  head(key: string): Promise<PublicMediaHead | null>;
  get(
    key: string,
    range?: { start: number; endExclusive: number },
  ): Promise<PublicMediaBody | null>;
}

/** One path segment of a public key. No traversal, no separators, no spaces. */
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_KEY_LENGTH = 900;

const NOT_FOUND_BODY = "Not found";

function notFound(): Response {
  return new Response(NOT_FOUND_BODY, {
    status: 404,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

/**
 * Turn the request path into a public object key, or null.
 *
 * Deliberately works from the RAW pathname rather than a router-decoded
 * parameter: single decoding is performed here, once, per segment, so a
 * double-encoded separator (`%252e%252e%252f`) decodes to a literal segment
 * that fails `SAFE_SEGMENT` instead of quietly becoming `../`. Anything
 * ambiguous is null, and null is a generic 404.
 */
export function publicMediaKeyFromPath(pathname: string): string | null {
  if (!pathname.startsWith("/media/")) return null;
  const raw = pathname.slice("/media/".length);
  if (!raw || raw.length > MAX_KEY_LENGTH) return null;
  const segments = raw.split("/");
  const decoded: string[] = [];
  for (const segment of segments) {
    if (!segment) return null; // empty segment: `//`, or a trailing slash
    let value: string;
    try {
      value = decodeURIComponent(segment);
    } catch {
      return null; // malformed percent-encoding
    }
    if (value !== segment && /[/\\]/.test(value)) return null; // encoded separator
    if (value === "." || value === "..") return null;
    if (!SAFE_SEGMENT.test(value)) return null;
    decoded.push(value);
  }
  const key = `${PUBLIC_MEDIA_KEY_PREFIX}${decoded.join("/")}`;
  return key.length <= MAX_KEY_LENGTH ? key : null;
}

interface ParsedRange {
  kind: "ok";
  start: number;
  endExclusive: number;
}

type RangeOutcome = ParsedRange | { kind: "none" } | { kind: "unsatisfiable" };

/**
 * Single-range `bytes=` parsing. A header this handler cannot interpret is
 * IGNORED (RFC 9110 permits serving the whole representation); a range that is
 * well-formed but outside the object is 416, which is what a seeking video
 * player needs to see.
 */
export function parseRangeHeader(header: string | null, size: number): RangeOutcome {
  if (!header) return { kind: "none" };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return { kind: "none" };
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return { kind: "none" };
  if (size === 0) return { kind: "unsatisfiable" };
  if (!rawStart) {
    // Suffix range: the last N bytes.
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return { kind: "unsatisfiable" };
    return { kind: "ok", start: Math.max(0, size - suffix), endExclusive: size };
  }
  const start = Number(rawStart);
  if (!Number.isFinite(start) || start >= size) return { kind: "unsatisfiable" };
  const endInclusive = rawEnd ? Number(rawEnd) : size - 1;
  if (!Number.isFinite(endInclusive) || endInclusive < start) return { kind: "unsatisfiable" };
  return { kind: "ok", start, endExclusive: Math.min(size, endInclusive + 1) };
}

/** `If-None-Match` per RFC 9110: `*` or any listed entity tag matching. */
export function etagMatches(header: string | null, etag: string): boolean {
  if (!header || !etag) return false;
  const candidates = header.split(",").map((value) => value.trim());
  if (candidates.includes("*")) return true;
  return candidates.some(
    (candidate) => candidate.replace(/^W\//, "").replace(/^"|"$/g, "") === etag,
  );
}

function baseHeaders(head: PublicMediaHead): Record<string, string> {
  return {
    "content-type": head.contentType || "application/octet-stream",
    etag: `"${head.etag}"`,
    "accept-ranges": "bytes",
    // Public derivatives are content-addressed: the object at a given key never
    // changes, so it is safe to cache immutably for a year.
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
    // The object is a public asset; nothing about the request identifies a user.
    "cross-origin-resource-policy": "cross-origin",
  };
}

/**
 * Serve one public media request. `method` must already be GET or HEAD; the
 * route refuses everything else before calling in.
 */
export async function servePublicMedia(
  source: PublicMediaSource,
  request: Request,
): Promise<Response> {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { allow: "GET, HEAD", "cache-control": "no-store" },
    });
  }

  const key = publicMediaKeyFromPath(new URL(request.url).pathname);
  if (!key) return notFound();

  let head: PublicMediaHead | null;
  try {
    head = await source.head(key);
  } catch {
    // A storage failure must not become a different answer than "absent":
    // distinguishing the two would leak which private keys exist.
    return notFound();
  }
  if (!head) return notFound();

  const headers = baseHeaders(head);

  if (etagMatches(request.headers.get("if-none-match"), head.etag)) {
    return new Response(null, { status: 304, headers });
  }

  const range = parseRangeHeader(request.headers.get("range"), head.size);
  if (range.kind === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: { ...headers, "content-range": `bytes */${head.size}` },
    });
  }

  if (method === "HEAD") {
    return new Response(null, {
      status: 200,
      headers: { ...headers, "content-length": String(head.size) },
    });
  }

  let object: PublicMediaBody | null;
  try {
    object = await source.get(
      key,
      range.kind === "ok" ? { start: range.start, endExclusive: range.endExclusive } : undefined,
    );
  } catch {
    return notFound();
  }
  if (!object) return notFound();

  if (range.kind === "ok") {
    const served = object.range ?? { start: range.start, endExclusive: range.endExclusive };
    const length = served.endExclusive - served.start;
    return new Response(object.body, {
      status: 206,
      headers: {
        ...headers,
        "content-length": String(length),
        "content-range": `bytes ${served.start}-${served.endExclusive - 1}/${head.size}`,
      },
    });
  }

  return new Response(object.body, {
    status: 200,
    headers: { ...headers, "content-length": String(object.size) },
  });
}
