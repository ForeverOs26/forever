/**
 * Forever Studio — Cloudflare R2 S3-API client (SERVER ONLY).
 *
 * A deliberately small surface: exactly the operations Studio performs, over
 * `fetch` and the SigV4 helper. No SDK, no credential-provider chain, no
 * retry/telemetry machinery that would have to be audited.
 *
 * EVERY method here is server-side. The ONLY things this module ever hands
 * outward for a browser to use are `presignPut` results, which are short-lived
 * single-object bearer credentials and are treated as such by their callers.
 *
 * Errors carry the HTTP status and the S3 error code, never the request URL:
 * a signed URL must not reach a log line or an error message.
 */

import {
  EMPTY_BODY_SHA256,
  presignUrl,
  signRequestHeaders,
  sigv4Sha256Hex,
  type SigV4Credentials,
} from "./sigv4.server";

export const R2_REGION = "auto";
const R2_SERVICE = "s3";

export interface R2ClientConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  /**
   * Full S3 endpoint origin. Defaults to the account's R2 endpoint; overridden
   * ONLY by the local test harness, which points it at an in-process
   * S3-compatible fake so no test can reach a real bucket.
   */
  endpoint?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export class R2RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly operation: string,
  ) {
    super(`r2_${operation}_failed:${status}:${code}`);
    this.name = "R2RequestError";
  }
}

/** True when R2 says the multipart upload no longer exists (expired/aborted). */
export function isNoSuchUpload(error: unknown): boolean {
  return (
    error instanceof R2RequestError &&
    (error.code === "NoSuchUpload" || (error.status === 404 && error.operation.includes("part")))
  );
}

export function r2EndpointFor(accountId: string): string {
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

/** Extract the first `<tag>…</tag>` body. S3 responses are small and flat. */
function xmlValue(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml);
  return match ? match[1] : null;
}

function xmlBlocks(xml: string, tag: string): string[] {
  const blocks: string[] = [];
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g");
  for (;;) {
    const match = pattern.exec(xml);
    if (!match) break;
    blocks.push(match[1]);
  }
  return blocks;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function xmlUnescape(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * ETags come back quoted; the quotes and the weak-validator marker are
 * transport, not identity.
 *
 * ORDER MATTERS. A weak validator is `W/"abc"` — the marker sits OUTSIDE the
 * quotes, so it must come off first. Stripping quotes first leaves `"abc` on
 * exactly those values, which would never equal the browser's own normalization
 * and would mark a correctly-stored part as bad. On the archive parts lane that
 * is not cosmetic: a bad part is really deleted and re-uploaded, so the upload
 * would fail after the confirm rounds run out.
 */
export function normalizeEtag(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/^W\//, "").replace(/^"|"$/g, "");
}

export interface R2ObjectHead {
  size: number;
  contentType: string | null;
  etag: string;
}

export interface R2MultipartPart {
  index: number;
  size: number;
  etag: string;
}

export class R2Client {
  private readonly credentials: SigV4Credentials;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(config: R2ClientConfig) {
    this.credentials = {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      region: R2_REGION,
      service: R2_SERVICE,
    };
    this.endpoint = config.endpoint ?? r2EndpointFor(config.accountId);
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.now = config.now ?? (() => new Date());
  }

  private path(bucket: string, key: string): string {
    return `/${bucket}/${key}`;
  }

  private async send(
    operation: string,
    init: {
      method: string;
      bucket: string;
      key: string;
      query?: Record<string, string>;
      headers?: Record<string, string>;
      body?: Uint8Array | string;
      /** Statuses treated as a normal outcome instead of a throw. */
      allow?: number[];
    },
  ): Promise<Response> {
    const bodyBytes =
      typeof init.body === "string" ? new TextEncoder().encode(init.body) : init.body;
    const payloadSha256 = bodyBytes ? await sigv4Sha256Hex(bodyBytes) : EMPTY_BODY_SHA256;
    const signed = await signRequestHeaders({
      credentials: this.credentials,
      method: init.method,
      endpoint: this.endpoint,
      path: this.path(init.bucket, init.key),
      query: init.query,
      headers: init.headers,
      payloadSha256,
      at: this.now(),
    });
    const response = await this.fetchImpl(signed.url, {
      method: init.method,
      headers: signed.headers,
      ...(bodyBytes ? { body: bodyBytes as unknown as BodyInit } : {}),
    });
    if (response.ok || (init.allow ?? []).includes(response.status)) return response;
    let code = "";
    try {
      code = xmlValue(await response.text(), "Code") ?? "";
    } catch {
      code = "";
    }
    throw new R2RequestError(response.status, code, operation);
  }

  // --- Object plane --------------------------------------------------------

  async head(bucket: string, key: string): Promise<R2ObjectHead | null> {
    const response = await this.send("head", {
      method: "HEAD",
      bucket,
      key,
      allow: [404],
    });
    if (response.status === 404) return null;
    return {
      size: Number(response.headers.get("content-length") ?? "0"),
      contentType: response.headers.get("content-type"),
      etag: normalizeEtag(response.headers.get("etag")),
    };
  }

  /** `range` is inclusive-start / exclusive-end, matching the callers. */
  async get(
    bucket: string,
    key: string,
    range?: { start: number; endExclusive: number },
  ): Promise<Response | null> {
    const headers = range ? { range: `bytes=${range.start}-${range.endExclusive - 1}` } : undefined;
    const response = await this.send("get", {
      method: "GET",
      bucket,
      key,
      headers,
      allow: [404, 416],
    });
    if (response.status === 404 || response.status === 416) return null;
    return response;
  }

  async put(
    bucket: string,
    key: string,
    body: Uint8Array,
    contentType?: string,
    cacheControl?: string,
  ): Promise<void> {
    await this.send("put", {
      method: "PUT",
      bucket,
      key,
      headers: {
        ...(contentType ? { "content-type": contentType } : {}),
        ...(cacheControl ? { "cache-control": cacheControl } : {}),
      },
      body,
    });
  }

  async delete(bucket: string, key: string): Promise<void> {
    await this.send("delete", { method: "DELETE", bucket, key, allow: [404] });
  }

  /**
   * Direct children of `prefix`. `delimiter` makes R2 fold deeper keys into
   * `CommonPrefixes`, which is how the orphan sweep enumerates one level
   * without ever walking a whole bucket.
   */
  async list(
    bucket: string,
    prefix: string,
    delimiter = "/",
  ): Promise<{
    objects: Array<{ key: string; size: number; etag?: string }>;
    prefixes: string[];
  }> {
    const objects: Array<{ key: string; size: number; etag?: string }> = [];
    const prefixes: string[] = [];
    let token: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const response = await this.send("list", {
        method: "GET",
        bucket,
        key: "",
        query: {
          "list-type": "2",
          prefix,
          delimiter,
          "max-keys": "1000",
          ...(token ? { "continuation-token": token } : {}),
        },
      });
      const xml = await response.text();
      for (const block of xmlBlocks(xml, "Contents")) {
        const key = xmlUnescape(xmlValue(block, "Key") ?? "");
        if (!key) continue;
        const etag = normalizeEtag(xmlUnescape(xmlValue(block, "ETag") ?? ""));
        objects.push({
          key,
          size: Number(xmlValue(block, "Size") ?? "0"),
          ...(etag ? { etag } : {}),
        });
      }
      for (const block of xmlBlocks(xml, "CommonPrefixes")) {
        const value = xmlUnescape(xmlValue(block, "Prefix") ?? "");
        if (value) prefixes.push(value);
      }
      if (xmlValue(xml, "IsTruncated") !== "true") break;
      token = xmlValue(xml, "NextContinuationToken") ?? undefined;
      if (!token) break;
    }
    return { objects, prefixes };
  }

  // --- Multipart -----------------------------------------------------------

  async createMultipartUpload(
    bucket: string,
    key: string,
    contentType = "application/zip",
  ): Promise<string> {
    const response = await this.send("create_multipart", {
      method: "POST",
      bucket,
      key,
      query: { uploads: "" },
      headers: { "content-type": contentType },
    });
    const uploadId = xmlValue(await response.text(), "UploadId");
    if (!uploadId) throw new R2RequestError(response.status, "NoUploadId", "create_multipart");
    return uploadId;
  }

  async listParts(bucket: string, key: string, uploadId: string): Promise<R2MultipartPart[]> {
    const parts: R2MultipartPart[] = [];
    let marker: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const response = await this.send("list_parts", {
        method: "GET",
        bucket,
        key,
        query: {
          uploadId,
          "max-parts": "1000",
          ...(marker ? { "part-number-marker": marker } : {}),
        },
      });
      const xml = await response.text();
      for (const block of xmlBlocks(xml, "Part")) {
        const number = Number(xmlValue(block, "PartNumber") ?? "0");
        if (!Number.isInteger(number) || number < 1) continue;
        parts.push({
          index: number - 1,
          size: Number(xmlValue(block, "Size") ?? "0"),
          etag: normalizeEtag(xmlUnescape(xmlValue(block, "ETag") ?? "")),
        });
      }
      if (xmlValue(xml, "IsTruncated") !== "true") break;
      marker = xmlValue(xml, "NextPartNumberMarker") ?? undefined;
      if (!marker) break;
    }
    return parts;
  }

  async completeMultipartUpload(
    bucket: string,
    key: string,
    uploadId: string,
    parts: R2MultipartPart[],
  ): Promise<void> {
    const body =
      `<CompleteMultipartUpload>` +
      parts
        .slice()
        .sort((left, right) => left.index - right.index)
        .map(
          (part) =>
            `<Part><PartNumber>${part.index + 1}</PartNumber><ETag>"${xmlEscape(part.etag)}"</ETag></Part>`,
        )
        .join("") +
      `</CompleteMultipartUpload>`;
    const response = await this.send("complete_multipart", {
      method: "POST",
      bucket,
      key,
      query: { uploadId },
      headers: { "content-type": "application/xml" },
      body,
    });
    // S3 can return 200 with an error document; treat that as a failure.
    const xml = await response.text();
    if (xmlValue(xml, "Code")) {
      throw new R2RequestError(200, xmlValue(xml, "Code") ?? "", "complete_multipart");
    }
  }

  async abortMultipartUpload(bucket: string, key: string, uploadId: string): Promise<void> {
    await this.send("abort_multipart", {
      method: "DELETE",
      bucket,
      key,
      query: { uploadId },
      allow: [404],
    });
  }

  // --- Presigning (the ONLY outward-facing capability) ---------------------

  /** Short-lived single-object PUT. A bearer credential; never log or store it. */
  async presignPut(input: {
    bucket: string;
    key: string;
    expiresInSeconds: number;
    contentType?: string;
    query?: Record<string, string>;
  }): Promise<string> {
    return presignUrl({
      credentials: this.credentials,
      method: "PUT",
      endpoint: this.endpoint,
      path: this.path(input.bucket, input.key),
      query: input.query,
      expiresInSeconds: input.expiresInSeconds,
      contentType: input.contentType,
      at: this.now(),
    });
  }

  /** Short-lived single-part PUT inside an existing multipart upload. */
  async presignUploadPart(input: {
    bucket: string;
    key: string;
    uploadId: string;
    partNumber: number;
    expiresInSeconds: number;
    contentType?: string;
  }): Promise<string> {
    return this.presignPut({
      bucket: input.bucket,
      key: input.key,
      expiresInSeconds: input.expiresInSeconds,
      contentType: input.contentType,
      query: { partNumber: String(input.partNumber), uploadId: input.uploadId },
    });
  }
}
