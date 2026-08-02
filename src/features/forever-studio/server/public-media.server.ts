/**
 * Forever Studio — resolving the public media source (SERVER ONLY).
 *
 * Two ways to read the public bucket, in this order:
 *
 *   1. the Worker's `R2_PUBLIC_MEDIA` BINDING, when the runtime exposes one.
 *      This is the production path: no credentials in the hot path, no extra
 *      network hop, native range and conditional support. The Nitro
 *      cloudflare-module preset publishes the Worker env on `globalThis.__env__`
 *      for every fetch and scheduled invocation, which is where the binding is
 *      looked up.
 *
 *   2. the same bucket through the S3 API with the server-only R2 credentials.
 *      This is what local development, tests, and any non-Worker host use.
 *
 * BOTH are constructed around ONE bucket — the public one. Neither can be
 * pointed at the private-source or archive bucket by anything in a request:
 * the bucket is chosen here, from configuration, before a request is seen.
 */

import type { PublicMediaBody, PublicMediaHead, PublicMediaSource } from "./public-media";
import { normalizeEtag, type R2Client } from "./storage/r2-client.server";
import { isWorkerRuntime } from "./storage/r2-bindings.server";
import { createR2ClientFromEnv, readR2BucketNames } from "./storage/registry.server";

/** The narrow slice of the Cloudflare R2 binding this route needs. */
interface R2BucketBinding {
  head(key: string): Promise<{
    size: number;
    httpEtag?: string;
    etag?: string;
    httpMetadata?: { contentType?: string };
  } | null>;
  get(
    key: string,
    options?: { range?: { offset: number; length: number } },
  ): Promise<{
    body: ReadableStream<Uint8Array> | null;
    size: number;
    httpEtag?: string;
    etag?: string;
    httpMetadata?: { contentType?: string };
  } | null>;
}

/** The binding name the deployment must bind to `forever-public-media`. */
export const PUBLIC_MEDIA_BINDING = "R2_PUBLIC_MEDIA";

function bindingFromRuntime(): R2BucketBinding | null {
  const env = (globalThis as { __env__?: Record<string, unknown> }).__env__;
  const candidate = env?.[PUBLIC_MEDIA_BINDING];
  if (
    candidate &&
    typeof candidate === "object" &&
    typeof (candidate as R2BucketBinding).get === "function" &&
    typeof (candidate as R2BucketBinding).head === "function"
  ) {
    return candidate as R2BucketBinding;
  }
  return null;
}

export function createBindingPublicMediaSource(bucket: R2BucketBinding): PublicMediaSource {
  const describe = (object: {
    size: number;
    httpEtag?: string;
    etag?: string;
    httpMetadata?: { contentType?: string };
  }): PublicMediaHead => ({
    size: object.size,
    contentType: object.httpMetadata?.contentType ?? null,
    etag: normalizeEtag(object.httpEtag ?? object.etag ?? ""),
  });

  return {
    async head(key) {
      const object = await bucket.head(key);
      return object ? describe(object) : null;
    },
    async get(key, range) {
      const object = await bucket.get(
        key,
        range
          ? { range: { offset: range.start, length: range.endExclusive - range.start } }
          : undefined,
      );
      if (!object) return null;
      const body: PublicMediaBody = {
        ...describe(object),
        body: object.body,
        ...(range ? { range } : {}),
      };
      // A binding range read reports the RANGE length in `size`; the full
      // object size for the Content-Range header comes from the head call the
      // handler already made, so `size` here is only used for a full response.
      return body;
    },
  };
}

/**
 * The S3 path, over an explicit client and ONE bucket.
 *
 * Separate from the environment read so the delivery contract is testable
 * against the local harness without any ambient configuration — and so the
 * bucket is visibly a construction-time choice, not a request-time one.
 */
export function createClientPublicMediaSource(client: R2Client, bucket: string): PublicMediaSource {
  return {
    async head(key) {
      const object = await client.head(bucket, key);
      return object
        ? { size: object.size, contentType: object.contentType, etag: object.etag }
        : null;
    },
    async get(key, range) {
      const response = await client.get(bucket, key, range);
      if (!response) return null;
      return {
        body: response.body,
        size: Number(response.headers.get("content-length") ?? "0"),
        contentType: response.headers.get("content-type"),
        etag: normalizeEtag(response.headers.get("etag")),
        ...(range ? { range } : {}),
      };
    },
  };
}

export function createS3PublicMediaSource(env: NodeJS.ProcessEnv = process.env): PublicMediaSource {
  return createClientPublicMediaSource(
    createR2ClientFromEnv(env),
    readR2BucketNames(env).publicMedia,
  );
}

/**
 * The source this deployment reads public media through.
 *
 * On a Worker the binding is REQUIRED. Falling back to the S3 API there is not
 * a fallback at all: a Worker cannot reach the S3 endpoint, so the "fallback"
 * only converts a diagnosable configuration error into a slow, silent one. The
 * route turns this refusal into the same generic 404 every other failure
 * produces, so nothing about which keys exist is disclosed either way.
 */
export function resolvePublicMediaSource(env: NodeJS.ProcessEnv = process.env): PublicMediaSource {
  const binding = bindingFromRuntime();
  if (binding) return createBindingPublicMediaSource(binding);
  if (isWorkerRuntime()) throw new Error("studio_public_media_binding_unavailable");
  return createS3PublicMediaSource(env);
}
