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
    // Since FOREVER-R2-MEDIA-STORAGE-CUTOVER-001 the derivative write goes
    // through the JOB's own storage provider (`options.provider.objects`,
    // bound to `storage` at the top of gatherMaterials) rather than the
    // ambient Supabase client. The read-verify-after-write contract is
    // unchanged — that is what these pins protect.
    expect(extractionSource).toContain(
      "storage.upload(toBucket, toPath, derivative.bytes, derivative.contentType)",
    );
    expect(extractionSource).toContain("storage.hashObject(toBucket, toPath");
    expect(extractionSource).toContain("const storage = options.provider.objects;");
    expect(extractionSource).not.toContain("deps.storage.copyObject");
    // No path in the derivative pipeline may reach the ambient Supabase
    // storage handle: an R2 job would silently write to the wrong system.
    expect(extractionSource).not.toContain("deps.storage.");
  });
});
