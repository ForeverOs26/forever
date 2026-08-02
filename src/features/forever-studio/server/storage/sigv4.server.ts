/**
 * Forever Studio — minimal AWS Signature Version 4 for the Cloudflare R2 S3 API
 * (SERVER ONLY, FOREVER-R2-MEDIA-STORAGE-CUTOVER-001).
 *
 * WHY THIS EXISTS RATHER THAN AN SDK
 * ----------------------------------
 * Forever needs exactly two things from SigV4: sign a request this server is
 * about to make, and presign a single-object URL a browser will use once. The
 * AWS JS SDK (or `aws4fetch`) would add a dependency to a repository that
 * currently has none for storage, ships its own credential-provider chain,
 * and — most importantly — would be a package the client bundler could follow
 * if anyone ever imported it from a client-reachable module. This file is
 * ~200 lines, has no dependencies at all, uses only Web Crypto (present on both
 * the Cloudflare Worker and Node), and lives behind a `.server.ts` name so the
 * bundle-boundary tests can pin it out of the browser build.
 *
 * It is NOT hand-rolled cryptography: every primitive is `crypto.subtle`
 * (HMAC-SHA256, SHA-256). Only the canonicalization AROUND those primitives is
 * implemented here, which is a specified string format, not a cipher.
 *
 * SECURITY NOTES
 * --------------
 *   - a presigned URL is a BEARER CREDENTIAL. Nothing here logs, stores, or
 *     returns it anywhere but to the caller that asked for it;
 *   - `X-Amz-Expires` is always short and always set by the caller;
 *   - a presigned request authorizes exactly one method on exactly one object
 *     key, because the key is part of the canonical request;
 *   - signing `content-type` binds the upload's declared type: a browser that
 *     sends a different one is refused by R2, not by us.
 */

const ALGORITHM = "AWS4-HMAC-SHA256";
const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";
export const EMPTY_BODY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
}

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  // A fresh copy keeps `crypto.subtle` off a possibly-detached view.
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer);
  return toHex(digest);
}

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const raw = key instanceof Uint8Array ? (key.slice().buffer as ArrayBuffer) : key;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    raw,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
}

/**
 * RFC 3986 encoding as SigV4 requires it: unreserved characters pass through,
 * everything else becomes percent-encoded uppercase hex. `encodeURIComponent`
 * alone leaves `!'()*` unescaped, which produces a different canonical string
 * from the one the service computes.
 */
export function uriEncode(value: string): string {
  let out = "";
  for (const char of value) {
    if (/[A-Za-z0-9\-._~]/.test(char)) {
      out += char;
      continue;
    }
    for (const byte of encoder.encode(char)) {
      out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return out;
}

/** Canonical path: each segment encoded, separators preserved. */
export function canonicalUri(path: string): string {
  const withLeading = path.startsWith("/") ? path : `/${path}`;
  return withLeading
    .split("/")
    .map((segment) => uriEncode(segment))
    .join("/");
}

export function canonicalQuery(query: Record<string, string>): string {
  return Object.keys(query)
    .sort()
    .map((key) => `${uriEncode(key)}=${uriEncode(query[key])}`)
    .join("&");
}

/** `YYYYMMDDTHHMMSSZ` and `YYYYMMDD`, the only two forms SigV4 accepts. */
export function amzDates(at: Date): { amzDate: string; dateStamp: string } {
  const amzDate = at.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

async function signingKey(credentials: SigV4Credentials, dateStamp: string): Promise<ArrayBuffer> {
  const kDate = await hmac(encoder.encode(`AWS4${credentials.secretAccessKey}`), dateStamp);
  const kRegion = await hmac(kDate, credentials.region);
  const kService = await hmac(kRegion, credentials.service);
  return hmac(kService, "aws4_request");
}

function credentialScope(credentials: SigV4Credentials, dateStamp: string): string {
  return `${dateStamp}/${credentials.region}/${credentials.service}/aws4_request`;
}

async function signCanonicalRequest(
  credentials: SigV4Credentials,
  canonicalRequest: string,
  amzDate: string,
  dateStamp: string,
): Promise<string> {
  const stringToSign = [
    ALGORITHM,
    amzDate,
    credentialScope(credentials, dateStamp),
    await sha256Hex(canonicalRequest),
  ].join("\n");
  return toHex(await hmac(await signingKey(credentials, dateStamp), stringToSign));
}

export interface PresignInput {
  credentials: SigV4Credentials;
  method: "PUT" | "GET" | "HEAD";
  /** Origin only, e.g. `https://<account>.r2.cloudflarestorage.com`. */
  endpoint: string;
  /** Path portion, e.g. `/bucket/key`. */
  path: string;
  /** Extra query parameters folded into the signature (uploadId, partNumber…). */
  query?: Record<string, string>;
  expiresInSeconds: number;
  /** Signed exactly: a request presenting a different value is refused. */
  contentType?: string;
  at: Date;
}

/**
 * A complete single-use URL. The signature covers the method, the object key,
 * every query parameter, the host, the expiry, and (when supplied) the
 * content-type — so it cannot be replayed against another object, another
 * verb, or with different declared bytes.
 */
export async function presignUrl(input: PresignInput): Promise<string> {
  const { amzDate, dateStamp } = amzDates(input.at);
  const url = new URL(input.endpoint);
  const host = url.host;
  const signedHeaderNames = input.contentType ? ["content-type", "host"] : ["host"];
  const canonicalHeaders = signedHeaderNames
    .map((name) => (name === "host" ? `host:${host}\n` : `content-type:${input.contentType}\n`))
    .join("");
  const query: Record<string, string> = {
    ...(input.query ?? {}),
    "X-Amz-Algorithm": ALGORITHM,
    "X-Amz-Credential": `${input.credentials.accessKeyId}/${credentialScope(input.credentials, dateStamp)}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(input.expiresInSeconds),
    "X-Amz-SignedHeaders": signedHeaderNames.join(";"),
  };
  const canonicalRequest = [
    input.method,
    canonicalUri(input.path),
    canonicalQuery(query),
    canonicalHeaders,
    signedHeaderNames.join(";"),
    UNSIGNED_PAYLOAD,
  ].join("\n");
  const signature = await signCanonicalRequest(
    input.credentials,
    canonicalRequest,
    amzDate,
    dateStamp,
  );
  const signedQuery = canonicalQuery({ ...query, "X-Amz-Signature": signature });
  return `${url.origin}${canonicalUri(input.path)}?${signedQuery}`;
}

export interface SignedRequestInput {
  credentials: SigV4Credentials;
  method: string;
  endpoint: string;
  path: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  /** Hex SHA-256 of the body; `EMPTY_BODY_SHA256` for a bodyless request. */
  payloadSha256: string;
  at: Date;
}

/** Headers for a request THIS server makes. Never handed to a browser. */
export async function signRequestHeaders(
  input: SignedRequestInput,
): Promise<{ url: string; headers: Record<string, string> }> {
  const { amzDate, dateStamp } = amzDates(input.at);
  const url = new URL(input.endpoint);
  const headers: Record<string, string> = {
    ...(input.headers ?? {}),
    host: url.host,
    "x-amz-content-sha256": input.payloadSha256,
    "x-amz-date": amzDate,
  };
  const names = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const lowered = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const canonicalHeaders = names
    .map((name) => `${name}:${String(lowered.get(name) ?? "").trim()}\n`)
    .join("");
  const canonicalRequest = [
    input.method,
    canonicalUri(input.path),
    canonicalQuery(input.query ?? {}),
    canonicalHeaders,
    names.join(";"),
    input.payloadSha256,
  ].join("\n");
  const signature = await signCanonicalRequest(
    input.credentials,
    canonicalRequest,
    amzDate,
    dateStamp,
  );
  const authorization =
    `${ALGORITHM} Credential=${input.credentials.accessKeyId}/${credentialScope(input.credentials, dateStamp)}, ` +
    `SignedHeaders=${names.join(";")}, Signature=${signature}`;
  const search = canonicalQuery(input.query ?? {});
  // `host` is set by fetch itself; passing it explicitly is rejected by some
  // runtimes, so it is signed but not resent.
  const { host: _host, ...sendable } = headers;
  void _host;
  return {
    url: `${url.origin}${canonicalUri(input.path)}${search ? `?${search}` : ""}`,
    headers: { ...sendable, authorization },
  };
}

export { sha256Hex as sigv4Sha256Hex };
