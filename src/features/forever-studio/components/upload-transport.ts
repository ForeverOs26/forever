/**
 * Forever Studio — the browser side of one allocated upload target.
 *
 * Bytes go from the device STRAIGHT to storage. They are never relayed through
 * a Forever server function, an Edge Function, a Worker request handler, or the
 * database — on either provider. This module is the single place that knows how
 * to speak each transport.
 *
 * TREAT A TARGET AS A CREDENTIAL. A presigned URL authorizes a write to one
 * object for a few minutes. Nothing here logs it, stores it, puts it in an
 * error message, or renders it, and every failure is reported with a generic,
 * URL-free message for exactly that reason.
 *
 * Client-safe: types, `fetch`, and the Supabase browser client only.
 */

import { supabase } from "@/integrations/supabase/client";

import type { StudioUploadTransport } from "../studio-types";

/** The shape both ordinary and archive-part targets share. */
export interface UploadTargetLike {
  bucket: string;
  path: string;
  token?: string;
  transport?: StudioUploadTransport;
}

/**
 * The transport a target actually specifies.
 *
 * A target with no `transport` is a response from a build that predates the
 * provider contract: it is the Supabase signed lane, and it MUST carry a token
 * to be usable. Anything else is refused rather than guessed — improvising a
 * request from a bucket and a path is exactly how bytes end up somewhere
 * nobody chose.
 */
export function transportForTarget(target: UploadTargetLike): StudioUploadTransport {
  if (target.transport) return target.transport;
  if (target.token) {
    return {
      kind: "supabase_signed",
      bucket: target.bucket,
      path: target.path,
      token: target.token,
    };
  }
  throw new Error("This upload target could not be used. Retry the upload.");
}

/** What the storage system returned once it accepted the bytes. */
export interface UploadReceipt {
  /** R2 multipart completion needs this; the Supabase lane has no equivalent. */
  etag: string | null;
}

function normalizeEtag(value: string | null): string | null {
  if (!value) return null;
  const clean = value.trim().replace(/^W\//, "").replace(/^"|"$/g, "");
  return clean || null;
}

/**
 * Send one blob to one allocated target.
 *
 * Resolves with the storage system's receipt, or throws a message that is safe
 * to show: it names no URL, no signature, no bucket and no key.
 */
export async function sendUploadBytes(
  target: UploadTargetLike,
  body: Blob,
  options: { contentType?: string } = {},
): Promise<UploadReceipt> {
  const transport = transportForTarget(target);

  if (transport.kind === "supabase_signed") {
    const { error } = await supabase.storage
      .from(transport.bucket)
      .uploadToSignedUrl(transport.path, transport.token, body, {
        ...(options.contentType ? { contentType: options.contentType } : {}),
      });
    if (error) throw error;
    return { etag: null };
  }

  // R2: a complete, already-signed single-object PUT. The headers are the ones
  // the signature covers — sending different ones is refused by R2 itself,
  // which is the point of signing the content type.
  let response: Response;
  try {
    response = await fetch(transport.url, {
      method: "PUT",
      headers: transport.headers,
      body,
    });
  } catch {
    // A network-level failure must not surface the URL it was attempting.
    throw new Error("The upload connection failed. It will resume automatically.");
  }
  if (!response.ok) {
    throw new Error(`The upload was rejected by storage (HTTP ${response.status}).`);
  }
  return { etag: normalizeEtag(response.headers.get("etag")) };
}
