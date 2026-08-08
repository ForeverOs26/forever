/**
 * A LOCAL, DISPOSABLE, IN-PROCESS S3-compatible store for the R2 lane.
 *
 * PROVE-IT-IS-LOCAL CONTRACT
 * --------------------------
 * There is no network here. `createLocalR2()` returns a `fetch` implementation
 * that is a plain function over in-memory Maps; the endpoint host is the
 * reserved, non-routable `LOCAL_R2_ENDPOINT`, and `assertLocalR2Endpoint`
 * refuses anything that is not it. No test can reach production or staging R2,
 * production or staging Supabase, or any other host, because no socket is ever
 * opened. Every object dies with the process.
 *
 * WHAT IT ACTUALLY VERIFIES
 * -------------------------
 * It is not a stub that says yes. Every request is authenticated by RECOMPUTING
 * the AWS SigV4 signature with the same signer the production code uses, so the
 * tests genuinely prove:
 *
 *   - a presigned URL authorizes ONE method on ONE object key;
 *   - a presigned URL that has expired is refused;
 *   - a request whose Content-Type differs from the signed one is refused;
 *   - a tampered key, query parameter, or signature is refused;
 *   - unsigned requests are refused.
 *
 * It implements exactly the S3 subset Forever uses: object PUT/GET(range)/
 * HEAD/DELETE, ListObjectsV2, and the multipart lifecycle (create, upload part,
 * list parts, complete, abort).
 */

import { createHash } from "node:crypto";

import {
  presignUrl,
  signRequestHeaders,
  type SigV4Credentials,
} from "../server/storage/sigv4.server";

/** Reserved, non-routable test host. Nothing resolves it; nothing dials it. */
export const LOCAL_R2_ENDPOINT = "https://local-r2.invalid";

export const LOCAL_R2_CREDENTIALS: SigV4Credentials = {
  accessKeyId: "LOCALTESTACCESSKEY",
  secretAccessKey: "local-test-secret-key-not-a-real-credential",
  region: "auto",
  service: "s3",
};

/**
 * Refuses any endpoint that is not the in-process one.
 *
 * Called before the FIRST write in every R2 integration test, so "the target is
 * local and disposable" is proven by the suite rather than asserted in prose.
 */
export function assertLocalR2Endpoint(endpoint: string): void {
  if (endpoint !== LOCAL_R2_ENDPOINT) {
    throw new Error(
      `local R2 harness refused a non-local endpoint. Expected ${LOCAL_R2_ENDPOINT}.`,
    );
  }
}

interface StoredObject {
  body: Buffer;
  contentType: string;
  cacheControl?: string;
  etag: string;
}

interface MultipartUpload {
  bucket: string;
  key: string;
  contentType: string;
  parts: Map<number, { body: Buffer; etag: string }>;
  aborted: boolean;
}

function etagOf(body: Buffer): string {
  return createHash("md5").update(body).digest("hex");
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function errorResponse(status: number, code: string): Response {
  return new Response(`<?xml version="1.0"?><Error><Code>${code}</Code></Error>`, {
    status,
    headers: { "content-type": "application/xml" },
  });
}

export interface LocalR2 {
  endpoint: string;
  credentials: SigV4Credentials;
  fetchImpl: typeof fetch;
  /** `bucket/key` → stored object. Inspect freely; it is just a Map. */
  objects: Map<string, StoredObject>;
  /** Live multipart uploads by upload id. */
  uploads: Map<string, MultipartUpload>;
  /** Every request the harness served, for call-site assertions. */
  requests: Array<{ method: string; bucket: string; key: string; query: string }>;
  /** Test clock; presigned expiry is measured against it. */
  now: Date;
  advanceSeconds(seconds: number): void;
  /** Simulate R2 expiring or garbage-collecting an abandoned multipart upload. */
  expireUpload(uploadId: string): void;
  keys(bucket: string): string[];
}

/** One in-process S3-compatible store. Nothing here touches the network. */
export function createLocalR2(): LocalR2 {
  const objects = new Map<string, StoredObject>();
  const uploads = new Map<string, MultipartUpload>();
  const requests: LocalR2["requests"] = [];
  let uploadSequence = 0;
  const state = { now: new Date("2026-08-02T00:00:00.000Z") };

  const verify = async (request: Request, url: URL): Promise<Response | null> => {
    const query = Object.fromEntries(url.searchParams.entries());
    const path = decodeURIComponent(url.pathname);

    if (query["X-Amz-Signature"]) {
      // --- Presigned (query-signed) request --------------------------------
      const expires = Number(query["X-Amz-Expires"] ?? "0");
      const amzDate = query["X-Amz-Date"] ?? "";
      const signedAtMs = Date.parse(
        `${amzDate.slice(0, 4)}-${amzDate.slice(4, 6)}-${amzDate.slice(6, 8)}T` +
          `${amzDate.slice(9, 11)}:${amzDate.slice(11, 13)}:${amzDate.slice(13, 15)}Z`,
      );
      if (!Number.isFinite(signedAtMs))
        return errorResponse(403, "AuthorizationQueryParametersError");
      if (state.now.getTime() > signedAtMs + expires * 1000) {
        return errorResponse(403, "AccessDenied"); // expired signature
      }
      const signedHeaders = (query["X-Amz-SignedHeaders"] ?? "").split(";");
      const contentType = signedHeaders.includes("content-type")
        ? (request.headers.get("content-type") ?? "")
        : undefined;
      const rest: Record<string, string> = {};
      for (const [key, value] of Object.entries(query)) {
        if (key.startsWith("X-Amz-")) continue;
        rest[key] = value;
      }
      const expected = await presignUrl({
        credentials: LOCAL_R2_CREDENTIALS,
        method: request.method as "PUT" | "GET" | "HEAD",
        endpoint: LOCAL_R2_ENDPOINT,
        path,
        query: rest,
        expiresInSeconds: expires,
        ...(contentType === undefined ? {} : { contentType }),
        at: new Date(signedAtMs),
      });
      const expectedSignature = new URL(expected).searchParams.get("X-Amz-Signature");
      if (!expectedSignature || expectedSignature !== query["X-Amz-Signature"]) {
        return errorResponse(403, "SignatureDoesNotMatch");
      }
      return null;
    }

    // --- Header-signed (server) request ------------------------------------
    const authorization = request.headers.get("authorization");
    if (!authorization) return errorResponse(403, "AccessDenied");
    const signedHeaderList = /SignedHeaders=([^,]+)/.exec(authorization)?.[1]?.split(";") ?? [];
    const headers: Record<string, string> = {};
    for (const name of signedHeaderList) {
      if (name === "host" || name === "x-amz-date" || name === "x-amz-content-sha256") continue;
      const value = request.headers.get(name);
      if (value !== null) headers[name] = value;
    }
    const amzDate = request.headers.get("x-amz-date") ?? "";
    const signedAt = new Date(
      `${amzDate.slice(0, 4)}-${amzDate.slice(4, 6)}-${amzDate.slice(6, 8)}T` +
        `${amzDate.slice(9, 11)}:${amzDate.slice(11, 13)}:${amzDate.slice(13, 15)}Z`,
    );
    const expected = await signRequestHeaders({
      credentials: LOCAL_R2_CREDENTIALS,
      method: request.method,
      endpoint: LOCAL_R2_ENDPOINT,
      path,
      query: Object.fromEntries(url.searchParams.entries()),
      headers,
      payloadSha256: request.headers.get("x-amz-content-sha256") ?? "",
      at: signedAt,
    });
    if (expected.headers.authorization !== authorization) {
      return errorResponse(403, "SignatureDoesNotMatch");
    }
    return null;
  };

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input as string, init);
    const url = new URL(request.url);
    if (`${url.protocol}//${url.host}` !== LOCAL_R2_ENDPOINT) {
      throw new Error("local R2 harness received a non-local request");
    }

    const denial = await verify(request, url);
    if (denial) return denial;

    const segments = decodeURIComponent(url.pathname).replace(/^\//, "").split("/");
    const bucket = segments.shift() ?? "";
    const key = segments.join("/");
    const query = url.searchParams;
    requests.push({ method: request.method, bucket, key, query: query.toString() });
    const objectKey = `${bucket}/${key}`;
    const body = Buffer.from(await request.arrayBuffer());

    // --- Multipart lifecycle ---------------------------------------------
    if (request.method === "POST" && query.has("uploads")) {
      uploadSequence += 1;
      const uploadId = `local-upload-${uploadSequence}`;
      uploads.set(uploadId, {
        bucket,
        key,
        contentType: request.headers.get("content-type") ?? "application/octet-stream",
        parts: new Map(),
        aborted: false,
      });
      return new Response(
        `<?xml version="1.0"?><InitiateMultipartUploadResult><Bucket>${xmlEscape(bucket)}</Bucket>` +
          `<Key>${xmlEscape(key)}</Key><UploadId>${uploadId}</UploadId></InitiateMultipartUploadResult>`,
        { status: 200, headers: { "content-type": "application/xml" } },
      );
    }

    const uploadId = query.get("uploadId");
    if (uploadId) {
      const upload = uploads.get(uploadId);
      if (!upload || upload.aborted || upload.bucket !== bucket || upload.key !== key) {
        return errorResponse(404, "NoSuchUpload");
      }
      if (request.method === "PUT") {
        const partNumber = Number(query.get("partNumber"));
        if (!Number.isInteger(partNumber) || partNumber < 1) {
          return errorResponse(400, "InvalidPart");
        }
        const etag = etagOf(body);
        // Last write wins per part number, exactly as S3 defines it.
        upload.parts.set(partNumber, { body, etag });
        return new Response(null, { status: 200, headers: { etag: `"${etag}"` } });
      }
      if (request.method === "GET") {
        const listed = [...upload.parts.entries()]
          .sort((left, right) => left[0] - right[0])
          .map(
            ([number, part]) =>
              `<Part><PartNumber>${number}</PartNumber><Size>${part.body.length}</Size>` +
              `<ETag>&quot;${part.etag}&quot;</ETag></Part>`,
          )
          .join("");
        return new Response(
          `<?xml version="1.0"?><ListPartsResult>${listed}<IsTruncated>false</IsTruncated></ListPartsResult>`,
          { status: 200, headers: { "content-type": "application/xml" } },
        );
      }
      if (request.method === "POST") {
        const requested = [...body.toString("utf8").matchAll(/<Part>([\s\S]*?)<\/Part>/g)].map(
          (match) => ({
            number: Number(/<PartNumber>(\d+)<\/PartNumber>/.exec(match[1])?.[1] ?? "0"),
            etag: (/<ETag>"?([^<"]+)"?<\/ETag>/.exec(match[1])?.[1] ?? "").replace(/&quot;/g, ""),
          }),
        );
        const assembled: Buffer[] = [];
        for (const part of requested) {
          const stored = upload.parts.get(part.number);
          if (!stored) return errorResponse(400, "InvalidPart");
          if (stored.etag !== part.etag) return errorResponse(400, "InvalidPart");
          assembled.push(stored.body);
        }
        const merged = Buffer.concat(assembled);
        objects.set(objectKey, {
          body: merged,
          contentType: upload.contentType,
          etag: etagOf(merged),
        });
        uploads.delete(uploadId);
        return new Response(
          `<?xml version="1.0"?><CompleteMultipartUploadResult><ETag>&quot;${etagOf(merged)}&quot;</ETag></CompleteMultipartUploadResult>`,
          { status: 200, headers: { "content-type": "application/xml" } },
        );
      }
      if (request.method === "DELETE") {
        uploads.delete(uploadId);
        return new Response(null, { status: 204 });
      }
      return errorResponse(405, "MethodNotAllowed");
    }

    // --- ListObjectsV2 ----------------------------------------------------
    if (request.method === "GET" && query.get("list-type") === "2") {
      const prefix = query.get("prefix") ?? "";
      const delimiter = query.get("delimiter") ?? "";
      const contents: string[] = [];
      const commonPrefixes = new Set<string>();
      for (const [storedKey, object] of objects) {
        if (!storedKey.startsWith(`${bucket}/`)) continue;
        const relative = storedKey.slice(bucket.length + 1);
        if (!relative.startsWith(prefix)) continue;
        const rest = relative.slice(prefix.length);
        if (delimiter && rest.includes(delimiter)) {
          commonPrefixes.add(`${prefix}${rest.slice(0, rest.indexOf(delimiter) + 1)}`);
          continue;
        }
        // Real ListObjectsV2 reports an ETag per key, and the archive lane
        // cross-checks the browser's claimed receipt against it, so the harness
        // must report one too or it would not exercise that check at all.
        contents.push(
          `<Contents><Key>${xmlEscape(relative)}</Key><Size>${object.body.length}</Size>` +
            `<ETag>&quot;${xmlEscape(object.etag)}&quot;</ETag></Contents>`,
        );
      }
      const prefixXml = [...commonPrefixes]
        .map((value) => `<CommonPrefixes><Prefix>${xmlEscape(value)}</Prefix></CommonPrefixes>`)
        .join("");
      return new Response(
        `<?xml version="1.0"?><ListBucketResult>${contents.join("")}${prefixXml}<IsTruncated>false</IsTruncated></ListBucketResult>`,
        { status: 200, headers: { "content-type": "application/xml" } },
      );
    }

    // --- Plain object operations ------------------------------------------
    if (request.method === "PUT") {
      objects.set(objectKey, {
        body,
        contentType: request.headers.get("content-type") ?? "application/octet-stream",
        ...(request.headers.get("cache-control")
          ? { cacheControl: request.headers.get("cache-control")! }
          : {}),
        etag: etagOf(body),
      });
      return new Response(null, { status: 200, headers: { etag: `"${etagOf(body)}"` } });
    }

    if (request.method === "DELETE") {
      const existed = objects.delete(objectKey);
      return new Response(null, { status: existed ? 204 : 404 });
    }

    const stored = objects.get(objectKey);
    if (!stored) return errorResponse(404, "NoSuchKey");

    const headers: Record<string, string> = {
      "content-type": stored.contentType,
      etag: `"${stored.etag}"`,
      "accept-ranges": "bytes",
      ...(stored.cacheControl ? { "cache-control": stored.cacheControl } : {}),
    };

    if (request.method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: { ...headers, "content-length": String(stored.body.length) },
      });
    }

    if (request.method === "GET") {
      const rangeHeader = request.headers.get("range");
      const match = rangeHeader ? /^bytes=(\d+)-(\d+)$/.exec(rangeHeader) : null;
      if (match) {
        const start = Number(match[1]);
        const endInclusive = Number(match[2]);
        if (start >= stored.body.length) return errorResponse(416, "InvalidRange");
        const slice = stored.body.subarray(start, Math.min(stored.body.length, endInclusive + 1));
        return new Response(new Uint8Array(slice), {
          status: 206,
          headers: {
            ...headers,
            "content-length": String(slice.length),
            "content-range": `bytes ${start}-${start + slice.length - 1}/${stored.body.length}`,
          },
        });
      }
      return new Response(new Uint8Array(stored.body), {
        status: 200,
        headers: { ...headers, "content-length": String(stored.body.length) },
      });
    }

    return errorResponse(405, "MethodNotAllowed");
  }) as unknown as typeof fetch;

  return {
    endpoint: LOCAL_R2_ENDPOINT,
    credentials: LOCAL_R2_CREDENTIALS,
    fetchImpl,
    objects,
    uploads,
    requests,
    get now() {
      return state.now;
    },
    advanceSeconds(seconds) {
      state.now = new Date(state.now.getTime() + seconds * 1000);
    },
    expireUpload(uploadId) {
      uploads.delete(uploadId);
    },
    keys(bucket) {
      return [...objects.keys()]
        .filter((key) => key.startsWith(`${bucket}/`))
        .map((key) => key.slice(bucket.length + 1));
    },
  };
}
