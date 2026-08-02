/**
 * FOREVER-R2-MEDIA-STORAGE-CUTOVER-001 — public media delivery.
 *
 * The three R2 buckets stay private at the BUCKET level, so this same-origin
 * route is the entire public surface. What it must do (ranges for video,
 * conditional requests, immutable caching, correct types) and what it must
 * never do (address a private key, list a prefix, name a bucket, distinguish
 * "absent" from "not yours", proxy an arbitrary URL) are both proven here.
 */

import { describe, expect, it } from "vitest";

import {
  createBindingPublicMediaSource,
  createClientPublicMediaSource,
} from "../server/public-media.server";
import {
  etagMatches,
  parseRangeHeader,
  publicMediaKeyFromPath,
  servePublicMedia,
  type PublicMediaSource,
} from "../server/public-media";
import { R2Client } from "../server/storage/r2-client.server";
import { createLocalR2, LOCAL_R2_CREDENTIALS, LOCAL_R2_ENDPOINT } from "./local-r2";
import { TEST_R2_BUCKETS } from "./fakes";

const PUBLIC_KEY = "media/i/studio/job-1/attempt-1/00-abcdef0123456789.jpg";
const PUBLIC_PATH = "/media/i/studio/job-1/attempt-1/00-abcdef0123456789.jpg";
const BODY = Buffer.from("0123456789abcdefghijABCDEFGHIJ");

/**
 * A source over ONE bucket's objects, recording every key it was asked for so a
 * test can prove the route never even ATTEMPTED a private key.
 */
function memorySource(objects: Record<string, { body: Buffer; contentType: string }>) {
  const asked: string[] = [];
  const source: PublicMediaSource = {
    async head(key) {
      asked.push(key);
      const object = objects[key];
      return object
        ? { size: object.body.length, contentType: object.contentType, etag: `etag-${key.length}` }
        : null;
    },
    async get(key, range) {
      asked.push(key);
      const object = objects[key];
      if (!object) return null;
      const slice = range ? object.body.subarray(range.start, range.endExclusive) : object.body;
      return {
        size: object.body.length,
        contentType: object.contentType,
        etag: `etag-${key.length}`,
        body: streamOf(slice),
        ...(range ? { range } : {}),
      };
    },
  };
  return { source, asked };
}

/** jsdom Blob has no .stream(); build the stream explicitly. */
function streamOf(bytes: Buffer): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
}

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`https://forever.test${path}`, init);
}

async function bodyOf(response: Response): Promise<Buffer> {
  return Buffer.from(await response.arrayBuffer());
}

const world = () => memorySource({ [PUBLIC_KEY]: { body: BODY, contentType: "image/jpeg" } });

describe("public media key derivation", () => {
  it("prepends the immutable public prefix to every request", () => {
    expect(publicMediaKeyFromPath(PUBLIC_PATH)).toBe(PUBLIC_KEY);
    expect(publicMediaKeyFromPath("/media/a")).toBe("media/a");
  });

  it("refuses traversal, encoded traversal, ambiguous and malformed keys", () => {
    for (const bad of [
      "/media/",
      "/media",
      "/other/x",
      "/media/../secrets",
      "/media/..%2Fsecrets",
      "/media/%2e%2e/secrets",
      "/media/%252e%252e/secrets",
      "/media/a//b",
      "/media/a/",
      "/media/a%2Fb",
      "/media/a%ZZ",
      "/media/.",
      "/media/..",
      "/media/a b",
      "/media/a?b",
      `/media/${"a".repeat(1000)}`,
    ]) {
      expect(publicMediaKeyFromPath(bad), bad).toBeNull();
    }
  });

  it("can never address a private-source or archive key", () => {
    // Private keys live under `studio/…`. Asking for one produces
    // `media/studio/…`, which is a public key that does not exist.
    expect(publicMediaKeyFromPath("/media/studio/jobs/j/staging/000/object")).toBe(
      "media/studio/jobs/j/staging/000/object",
    );
    expect(publicMediaKeyFromPath("/media/studio/archives/j/a/archive.zip")).toBe(
      "media/studio/archives/j/a/archive.zip",
    );
  });
});

describe("range parsing", () => {
  it("handles absent, whole, suffix, open-ended and unsatisfiable ranges", () => {
    expect(parseRangeHeader(null, 10)).toEqual({ kind: "none" });
    expect(parseRangeHeader("bytes=0-4", 10)).toEqual({ kind: "ok", start: 0, endExclusive: 5 });
    expect(parseRangeHeader("bytes=5-", 10)).toEqual({ kind: "ok", start: 5, endExclusive: 10 });
    expect(parseRangeHeader("bytes=-3", 10)).toEqual({ kind: "ok", start: 7, endExclusive: 10 });
    expect(parseRangeHeader("bytes=0-99", 10)).toEqual({ kind: "ok", start: 0, endExclusive: 10 });
    expect(parseRangeHeader("bytes=10-12", 10)).toEqual({ kind: "unsatisfiable" });
    expect(parseRangeHeader("bytes=8-4", 10)).toEqual({ kind: "unsatisfiable" });
    // A header this handler cannot interpret is ignored, not an error.
    expect(parseRangeHeader("items=0-1", 10)).toEqual({ kind: "none" });
    expect(parseRangeHeader("bytes=0-1, 5-6", 10)).toEqual({ kind: "none" });
  });

  it("matches entity tags the way RFC 9110 requires", () => {
    expect(etagMatches('"abc"', "abc")).toBe(true);
    expect(etagMatches('W/"abc"', "abc")).toBe(true);
    expect(etagMatches("*", "abc")).toBe(true);
    expect(etagMatches('"x", "abc"', "abc")).toBe(true);
    expect(etagMatches('"x"', "abc")).toBe(false);
    expect(etagMatches(null, "abc")).toBe(false);
  });
});

describe("serving", () => {
  it("GET returns the exact bytes with correct headers", async () => {
    const { source } = world();
    const response = await servePublicMedia(source, request(PUBLIC_PATH));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("content-length")).toBe(String(BODY.length));
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("etag")).toMatch(/^"/);
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await bodyOf(response)).equals(BODY)).toBe(true);
  });

  it("HEAD returns metadata and no body", async () => {
    const { source } = world();
    const response = await servePublicMedia(source, request(PUBLIC_PATH, { method: "HEAD" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe(String(BODY.length));
    expect((await bodyOf(response)).length).toBe(0);
  });

  it("serves a byte range with the right partial bytes and Content-Range", async () => {
    const { source } = world();
    const response = await servePublicMedia(
      source,
      request(PUBLIC_PATH, { headers: { range: "bytes=5-9" } }),
    );
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(`bytes 5-9/${BODY.length}`);
    expect(response.headers.get("content-length")).toBe("5");
    expect((await bodyOf(response)).toString()).toBe("56789");
  });

  it("answers an unsatisfiable range with 416 and the object size", async () => {
    const { source } = world();
    const response = await servePublicMedia(
      source,
      request(PUBLIC_PATH, { headers: { range: `bytes=${BODY.length + 5}-` } }),
    );
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe(`bytes */${BODY.length}`);
  });

  it("answers a conditional request with 304 and no body", async () => {
    const { source } = world();
    const first = await servePublicMedia(source, request(PUBLIC_PATH));
    const etag = first.headers.get("etag")!;
    const second = await servePublicMedia(
      source,
      request(PUBLIC_PATH, { headers: { "if-none-match": etag } }),
    );
    expect(second.status).toBe(304);
    expect((await bodyOf(second)).length).toBe(0);
    expect(second.headers.get("etag")).toBe(etag);
  });

  it("returns ONE generic 404 for absent, private, traversal and failing keys", async () => {
    const { source, asked } = world();
    const failing: PublicMediaSource = {
      head: async () => {
        throw new Error("storage exploded");
      },
      get: async () => null,
    };
    const responses = await Promise.all([
      servePublicMedia(source, request("/media/i/studio/job-1/attempt-1/missing.jpg")),
      servePublicMedia(source, request("/media/studio/jobs/j/staging/000/object")),
      servePublicMedia(source, request("/media/..%2Fsecret")),
      servePublicMedia(failing, request(PUBLIC_PATH)),
    ]);
    const bodies = await Promise.all(responses.map((response) => response.text()));
    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    // Byte-identical answers: nothing distinguishes "absent" from "private".
    expect(new Set(bodies).size).toBe(1);
    // The traversal attempt never even reached the storage source.
    expect(asked).not.toContain("media/../secret");
  });

  it("refuses every method other than GET and HEAD", async () => {
    const { source } = world();
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      const response = await servePublicMedia(source, request(PUBLIC_PATH, { method }));
      expect(response.status, method).toBe(405);
      expect(response.headers.get("allow")).toBe("GET, HEAD");
    }
  });

  it("exposes no listing capability at all", () => {
    // The route's whole capability surface is head+get of ONE key.
    const { source } = world();
    expect(Object.keys(source).sort()).toEqual(["get", "head"]);
  });
});

describe("the delivery source is bound to the public bucket", () => {
  it("reads the public bucket through the S3 path and cannot see private keys", async () => {
    const r2 = createLocalR2();
    const client = new R2Client({
      accountId: "local-test-account",
      accessKeyId: LOCAL_R2_CREDENTIALS.accessKeyId,
      secretAccessKey: LOCAL_R2_CREDENTIALS.secretAccessKey,
      endpoint: r2.endpoint,
      fetchImpl: r2.fetchImpl,
      now: () => r2.now,
    });
    await client.put(TEST_R2_BUCKETS.publicMedia, PUBLIC_KEY, new Uint8Array(BODY), "image/jpeg");
    await client.put(
      TEST_R2_BUCKETS.privateSources,
      "studio/jobs/j/staging/000/object",
      new Uint8Array(Buffer.from("private")),
      "application/octet-stream",
    );

    // Bound to the PUBLIC bucket at construction time — a request cannot move it.
    const source = createClientPublicMediaSource(client, TEST_R2_BUCKETS.publicMedia);

    const found = await source.head(PUBLIC_KEY);
    expect(found?.size).toBe(BODY.length);
    // The private object exists — but not in the bucket this source reads.
    expect(await source.head("media/studio/jobs/j/staging/000/object")).toBeNull();
    expect(await source.head("studio/jobs/j/staging/000/object")).toBeNull();
  });

  it("prefers the Worker binding when the runtime exposes one", async () => {
    const reads: string[] = [];
    const binding = {
      async head(key: string) {
        reads.push(key);
        return {
          size: BODY.length,
          httpEtag: '"binding-etag"',
          httpMetadata: { contentType: "image/jpeg" },
        };
      },
      async get(key: string) {
        reads.push(key);
        return {
          body: streamOf(BODY),
          size: BODY.length,
          httpEtag: '"binding-etag"',
          httpMetadata: { contentType: "image/jpeg" },
        };
      },
    };
    const source = createBindingPublicMediaSource(binding);
    const response = await servePublicMedia(source, request(PUBLIC_PATH));
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"binding-etag"');
    expect(reads.every((key) => key.startsWith("media/"))).toBe(true);
  });
});
