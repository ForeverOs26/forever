/**
 * Public object identity — the content-addressed path and the formats that
 * reach it (FOREVER-SEMANTIC-MEDIA-BACKFILL-001, extracted from ./publish).
 *
 * These two functions decide what a published storage object is CALLED. Nothing
 * else in the estate can recompute a live object path without them, which makes
 * them the join key between a package on disk and a row already in production:
 * hash the package bytes, derive the same path, and the row is identified by
 * content rather than by a filename somebody guessed at.
 *
 * They used to live in `./publish`, and they could not stay there. `publish.ts`
 * imports `../forever-ingestion/build-batch`, which transitively imports
 * `@/import/currency-policy` — a tsconfig path alias. `jiti` does not read
 * tsconfig `paths`, so any `.mjs` runner that loaded `publish.ts` died with
 * "Cannot find module '@/import/currency-policy'" before executing a line. The
 * backfill controller is such a runner and needs exactly these two functions.
 *
 * The alternative was a second copy of the path rule inside the runner. That is
 * the failure this whole task exists to avoid: a second copy is a second thing
 * to keep correct, and the first divergence would silently address the wrong
 * storage object — writing a semantic role onto a row that depicts something
 * else entirely.
 *
 * `publish.ts` re-exports both, so every existing importer is untouched and
 * there is exactly one implementation. Pure: no I/O, no network, no credentials.
 */

/** Content types `createPublicDerivative` can sanitize and verify. */
export const SANITIZABLE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type SanitizableContentType = (typeof SANITIZABLE_CONTENT_TYPES)[number];

export const DERIVATIVE_EXTENSION: Record<string, string> = {
  jpeg: "jpg",
  png: "png",
  webp: "webp",
};

/**
 * Content type from the actual leading bytes, restricted to what the sanitizer
 * can verify. Anything else is not published in this lane.
 */
export function detectSanitizableImageType(bytes: Buffer): SanitizableContentType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * Deterministic, content-addressed public object path.
 *
 * Identical bytes always land on the identical path, which is what makes a
 * repeated publish create no second storage object and no second media row.
 */
export function publicMediaPath(slug: string, derivativeSha256: string, format: string): string {
  if (!/^[a-f0-9]{64}$/.test(derivativeSha256)) throw new Error("invalid_derivative_sha256");
  const extension = DERIVATIVE_EXTENSION[format] ?? "jpg";
  return `direct/${slug}/${derivativeSha256.slice(0, 24)}.${extension}`;
}
