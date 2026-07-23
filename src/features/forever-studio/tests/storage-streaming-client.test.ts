/**
 * Regression for Storage JS 2.110: `download()` returns a Blob (and therefore
 * buffers the complete response), while `download().asStream()` exposes the
 * response body without calling Blob/blob(). Studio hashing must use the
 * latter for large Worker uploads.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("installed Supabase Storage streaming download", () => {
  it("reads response chunks through asStream without materializing a Blob", async () => {
    let blobCalls = 0;
    const chunks = [new Uint8Array([1, 2]), new Uint8Array([3, 4])];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
    const fetch = async () =>
      ({
        ok: true,
        body,
        headers: new Headers(),
        blob: async () => {
          blobCalls += 1;
          throw new Error("Blob materialization is forbidden for stream hashing");
        },
      }) as unknown as Response;
    const client = createClient("https://storage-test.invalid", "anon-key", { global: { fetch } });

    const { data, error } = await client.storage
      .from("studio-uploads")
      .download("large.mov")
      .asStream();
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    const reader = data!.getReader();
    const received: number[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received.push(...value);
    }
    expect(received).toEqual([1, 2, 3, 4]);
    expect(blobCalls).toBe(0);
  });

  it("has no blind public-copy capability and read-verifies bounded derivatives", () => {
    const storageSource = readFileSync(
      resolve(process.cwd(), "src/features/forever-studio/server/deps.server.ts"),
      "utf8",
    );
    const extractionSource = readFileSync(
      resolve(process.cwd(), "src/features/forever-studio/server/extraction.ts"),
      "utf8",
    );
    expect(storageSource).not.toContain("copyObject");
    expect(extractionSource).toContain("createPublicDerivative");
    expect(extractionSource).toContain("MAX_MEDIA_SANITIZE_BYTES");
    expect(extractionSource).toContain(
      "deps.storage.upload(toBucket, toPath, derivative.bytes, derivative.contentType)",
    );
    expect(extractionSource).toContain("deps.storage.hashObject(toBucket, toPath");
    expect(extractionSource).not.toContain("deps.storage.copyObject");
  });
});
