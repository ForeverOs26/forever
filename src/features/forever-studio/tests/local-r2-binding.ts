/**
 * A LOCAL, DISPOSABLE, IN-PROCESS Cloudflare R2 BUCKET BINDING.
 *
 * WHY THIS IS NOT JUST ANOTHER FAKE
 * ---------------------------------
 * The production defect was invisible to every existing test because every
 * existing test runs the S3 object plane — the same implementation, over a
 * `fetch` that happens to work in Node. Proving the correction therefore needs
 * a harness that reproduces the ONE thing a Worker does differently:
 *
 *   the bucket binding and the S3 API are two doors onto the SAME bucket, and
 *   only one of those doors opens from inside a Worker.
 *
 * So a binding here is a VIEW over the S3 harness's object store, scoped to one
 * real bucket name — not an independent map. The browser's presigned PUT lands
 * in that store through the S3 door, and the Worker reads the very same bytes
 * back through the binding door, exactly as production does. A test that
 * uploads through the browser and reads through the binding is testing the
 * actual production topology, not two disconnected fakes agreeing with each
 * other.
 *
 * The three bindings are scoped to three DIFFERENT bucket names, so pointing
 * the private-source plane at the public binding (or the reverse) is not a
 * subtle behavioural difference — it is a missing object.
 *
 * There is no network here and no socket is ever opened.
 */

import { createHash } from "node:crypto";

import type { StudioBucketKind } from "../studio-types";
import type {
  R2BindingListing,
  R2BindingObjectBody,
  R2BindingObjectMetadata,
  R2BucketBinding,
  StudioR2Bindings,
} from "../server/storage/r2-bindings.server";
import { STUDIO_R2_BINDING_NAMES } from "../server/storage/r2-bindings.server";
import type { LocalR2 } from "./local-r2";

export type BindingOperation = "head" | "get" | "put" | "delete" | "list";

export interface BindingCall {
  /** Which bucket kind's binding served it. */
  kind: StudioBucketKind;
  /** The real bucket name that binding is bound to. */
  bucket: string;
  op: BindingOperation;
  key: string;
  ranged: boolean;
}

export interface LocalR2BindingHarness {
  bindings: StudioR2Bindings;
  /** The Worker env record, shaped exactly as Nitro publishes it. */
  env: Record<string, unknown>;
  /** Every binding operation, in order. */
  calls: BindingCall[];
  /** Every server-side S3 `fetch` the Worker attempted. Must stay empty. */
  serverFetchAttempts: Array<{ method: string; url: string }>;
  /**
   * A `fetch` for the R2 S3 client that behaves like a Cloudflare Worker:
   * it rejects before a socket exists, with the same `TypeError` production
   * threw seven times. Presigning never calls it, so browser direct upload
   * keeps working while every server-side S3 request is impossible.
   */
  refusingServerFetch: typeof fetch;
  callsFor(kind: StudioBucketKind): BindingCall[];
  /**
   * Break ONE operation on ONE binding, and return the restore function.
   *
   * Patches the binding OBJECT the provider already holds, because that is how
   * a real broken binding presents itself: the deployment handed the isolate a
   * bucket and an operation on it fails. Swapping the env record would prove
   * nothing — the provider resolved its bindings at construction, exactly as it
   * does in production.
   */
  failBinding(kind: StudioBucketKind, op: BindingOperation, makeError?: () => unknown): () => void;
  reset(): void;
}

function etagOf(body: Buffer): string {
  return createHash("md5").update(body).digest("hex");
}

/** One binding, backed by the shared object store, scoped to ONE bucket. */
function createBinding(
  store: LocalR2,
  kind: StudioBucketKind,
  bucket: string,
  calls: BindingCall[],
): R2BucketBinding {
  const record = (op: BindingOperation, key: string, ranged = false): void => {
    calls.push({ kind, bucket, op, key, ranged });
  };
  const physical = (key: string): string => `${bucket}/${key}`;

  const describe = (body: Buffer, contentType?: string): R2BindingObjectMetadata => ({
    size: body.length,
    etag: etagOf(body),
    httpEtag: `"${etagOf(body)}"`,
    httpMetadata: contentType ? { contentType } : {},
  });

  return {
    async head(key) {
      record("head", key);
      const stored = store.objects.get(physical(key));
      return stored ? describe(stored.body, stored.contentType) : null;
    },

    async get(key, options) {
      record("get", key, Boolean(options?.range));
      const stored = store.objects.get(physical(key));
      if (!stored) return null;
      const range = options?.range;
      const slice = range
        ? stored.body.subarray(range.offset, range.offset + range.length)
        : stored.body;
      // A binding range read reports the RANGE length in `size`, exactly as the
      // real binding does — the full object size comes from `head`.
      const body: R2BindingObjectBody = {
        ...describe(stored.body, stored.contentType),
        size: slice.length,
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(slice));
            controller.close();
          },
        }),
      };
      return body;
    },

    async put(key, value, options) {
      record("put", key);
      const bytes =
        value instanceof ArrayBuffer
          ? Buffer.from(new Uint8Array(value))
          : Buffer.from(
              (value as ArrayBufferView).buffer,
              (value as ArrayBufferView).byteOffset,
              (value as ArrayBufferView).byteLength,
            );
      const body = Buffer.from(bytes);
      store.objects.set(physical(key), {
        body,
        contentType: options?.httpMetadata?.contentType ?? "application/octet-stream",
        ...(options?.httpMetadata?.cacheControl
          ? { cacheControl: options.httpMetadata.cacheControl }
          : {}),
        etag: etagOf(body),
      });
      return { key, etag: etagOf(body) };
    },

    async delete(key) {
      record("delete", key);
      store.objects.delete(physical(key));
    },

    async list(options) {
      record("list", options?.prefix ?? "");
      const prefix = options?.prefix ?? "";
      const delimiter = options?.delimiter ?? "";
      const objects: R2BindingListing["objects"] = [];
      const delimitedPrefixes = new Set<string>();
      for (const [storedKey, object] of store.objects) {
        if (!storedKey.startsWith(`${bucket}/`)) continue;
        const relative = storedKey.slice(bucket.length + 1);
        if (!relative.startsWith(prefix)) continue;
        const rest = relative.slice(prefix.length);
        if (delimiter && rest.includes(delimiter)) {
          delimitedPrefixes.add(`${prefix}${rest.slice(0, rest.indexOf(delimiter) + 1)}`);
          continue;
        }
        objects.push({ key: relative, size: object.body.length });
      }
      return { objects, delimitedPrefixes: [...delimitedPrefixes], truncated: false };
    },
  };
}

export function createLocalR2Bindings(
  store: LocalR2,
  buckets: Record<StudioBucketKind, string>,
): LocalR2BindingHarness {
  const calls: BindingCall[] = [];
  const serverFetchAttempts: Array<{ method: string; url: string }> = [];

  const bindings: StudioR2Bindings = {
    private_source: createBinding(store, "private_source", buckets.private_source, calls),
    public_media: createBinding(store, "public_media", buckets.public_media, calls),
    project_archives: createBinding(store, "project_archives", buckets.project_archives, calls),
  };

  const env: Record<string, unknown> = {
    [STUDIO_R2_BINDING_NAMES.private_source]: bindings.private_source,
    [STUDIO_R2_BINDING_NAMES.public_media]: bindings.public_media,
    [STUDIO_R2_BINDING_NAMES.project_archives]: bindings.project_archives,
  };

  const refusingServerFetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    const method = (input instanceof Request ? input.method : init?.method) ?? "GET";
    serverFetchAttempts.push({ method, url });
    // Exactly what production threw: a fetch-level rejection with no HTTP
    // status and no S3 error code, because the request never reached R2.
    throw new TypeError("Network connection lost.");
  }) as unknown as typeof fetch;

  return {
    bindings,
    env,
    calls,
    serverFetchAttempts,
    refusingServerFetch,
    callsFor(kind) {
      return calls.filter((call) => call.kind === kind);
    },
    failBinding(kind, op, makeError) {
      const binding = bindings[kind] as unknown as Record<string, unknown>;
      const original = binding[op];
      binding[op] = async (...args: unknown[]) => {
        calls.push({
          kind,
          bucket: buckets[kind],
          op,
          key: typeof args[0] === "string" ? args[0] : "",
          ranged: false,
        });
        // The default is exactly what production threw: a fetch-level
        // rejection, with no HTTP status and no S3 error code.
        throw makeError ? makeError() : new TypeError("Network connection lost.");
      };
      return () => {
        binding[op] = original;
      };
    },
    reset() {
      calls.length = 0;
      serverFetchAttempts.length = 0;
    },
  };
}

/**
 * Install a Cloudflare Worker runtime around a block of work.
 *
 * Both signals the resolver reads are set: `globalThis.__env__` (what Nitro's
 * cloudflare-module preset publishes for BOTH the `fetch` and the `scheduled`
 * entry paths) and `navigator.userAgent`. Everything is restored afterwards,
 * including the absence of a property that did not exist.
 */
export async function withWorkerRuntime<T>(
  env: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  const globals = globalThis as unknown as Record<string, unknown>;
  const hadEnv = "__env__" in globals;
  const previousEnv = globals.__env__;
  const hadNavigator = "navigator" in globals;
  const previousNavigator = globals.navigator;

  globals.__env__ = env;
  Object.defineProperty(globals, "navigator", {
    value: { userAgent: "Cloudflare-Workers" },
    configurable: true,
    writable: true,
  });
  try {
    return await fn();
  } finally {
    if (hadEnv) globals.__env__ = previousEnv;
    else delete globals.__env__;
    if (hadNavigator) {
      Object.defineProperty(globals, "navigator", {
        value: previousNavigator,
        configurable: true,
        writable: true,
      });
    } else {
      delete globals.navigator;
    }
  }
}
