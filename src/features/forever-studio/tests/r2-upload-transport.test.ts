/**
 * FOREVER-R2-MEDIA-STORAGE-CUTOVER-001 — the browser transport.
 *
 * Bytes must go from the device straight to storage, and a failure must never
 * surface the presigned URL that was being used.
 */

import { describe, expect, it, vi } from "vitest";

const supabaseUpload = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { storage: { from: () => ({ uploadToSignedUrl: supabaseUpload }) } },
}));

import { sendUploadBytes, transportForTarget } from "../components/upload-transport";

const SIGNED_URL =
  "https://acct.r2.cloudflarestorage.com/bucket/studio/jobs/j/staging/000/object" +
  "?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=deadbeefdeadbeefdeadbeefdeadbeef";

function r2Target() {
  return {
    bucket: "studio-uploads",
    path: "jobs/j/staging/000/object",
    transport: {
      kind: "r2_presigned_put" as const,
      url: SIGNED_URL,
      headers: { "content-type": "image/jpeg" },
    },
  };
}

describe("transport selection", () => {
  it("uses the transport the server allocated", () => {
    expect(transportForTarget(r2Target()).kind).toBe("r2_presigned_put");
  });

  it("reads a legacy tokened target as the Supabase signed lane", () => {
    const transport = transportForTarget({
      bucket: "studio-uploads",
      path: "jobs/j/staging/00-a.jpg",
      token: "signed-token",
    });
    expect(transport).toEqual({
      kind: "supabase_signed",
      bucket: "studio-uploads",
      path: "jobs/j/staging/00-a.jpg",
      token: "signed-token",
    });
  });

  it("refuses a target it cannot interpret rather than improvising a request", () => {
    expect(() =>
      transportForTarget({ bucket: "studio-uploads", path: "jobs/j/staging/00-a.jpg" }),
    ).toThrow(/could not be used/);
  });
});

describe("sending bytes", () => {
  it("PUTs directly to the presigned URL with the signed headers", async () => {
    const fetchMock = vi.fn(
      async () => new Response(null, { status: 200, headers: { etag: '"abc123"' } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const receipt = await sendUploadBytes(r2Target(), new Blob([new Uint8Array([1, 2, 3])]));
    expect(receipt.etag).toBe("abc123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(SIGNED_URL);
    expect(init.method).toBe("PUT");
    expect(init.headers).toEqual({ "content-type": "image/jpeg" });
    vi.unstubAllGlobals();
  });

  it("never puts the signed URL into a rejection message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("denied", { status: 403 })),
    );
    await expect(sendUploadBytes(r2Target(), new Blob([new Uint8Array([1])]))).rejects.toThrow(
      /HTTP 403/,
    );
    try {
      await sendUploadBytes(r2Target(), new Blob([new Uint8Array([1])]));
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain("X-Amz-Signature");
      expect(message).not.toContain("cloudflarestorage");
      expect(message).not.toContain(SIGNED_URL);
    }
    vi.unstubAllGlobals();
  });

  it("never puts the signed URL into a network-failure message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError(`Failed to fetch ${SIGNED_URL}`);
      }),
    );
    try {
      await sendUploadBytes(r2Target(), new Blob([new Uint8Array([1])]));
      expect.unreachable();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("resume automatically");
      expect(message).not.toContain("X-Amz-Signature");
      expect(message).not.toContain(SIGNED_URL);
    }
    vi.unstubAllGlobals();
  });

  it("still uses the Supabase signed lane for a legacy target", async () => {
    supabaseUpload.mockReset();
    supabaseUpload.mockResolvedValue({ error: null });
    const receipt = await sendUploadBytes(
      {
        bucket: "studio-uploads",
        path: "jobs/j/staging/00-a.jpg",
        token: "signed-token",
      },
      new Blob([new Uint8Array([1])]),
      { contentType: "image/jpeg" },
    );
    expect(receipt.etag).toBeNull();
    expect(supabaseUpload).toHaveBeenCalledWith(
      "jobs/j/staging/00-a.jpg",
      "signed-token",
      expect.anything(),
      { contentType: "image/jpeg" },
    );
  });
});
