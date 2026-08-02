import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

/**
 * Public media delivery (FOREVER-R2-MEDIA-STORAGE-CUTOVER-001).
 *
 * `/media/<opaque-server-generated-key>` is the ONLY way a public derivative
 * stored in Cloudflare R2 reaches a visitor. The three R2 buckets stay private
 * at the bucket level — no `r2.dev` access, no public custom domain, no
 * anonymous listing — so this same-origin route is the whole public surface.
 *
 * The handler itself lives in `server/public-media.ts` (pure, injectable,
 * fully tested) and the source resolution in `server/public-media.server.ts`.
 * Both are reached through `await import(...)` inside the handlers, so nothing
 * server-only can follow this route file into the browser bundle.
 *
 * HEAD is declared explicitly rather than left to the runtime: video players
 * probe with HEAD before ranging, and a route that answers HEAD only by
 * accident is a route whose behaviour is not actually pinned.
 */
async function serve(request: Request): Promise<Response> {
  const { servePublicMedia } = await import("@/features/forever-studio/server/public-media");
  const { resolvePublicMediaSource } =
    await import("@/features/forever-studio/server/public-media.server");
  try {
    return await servePublicMedia(resolvePublicMediaSource(), request);
  } catch {
    // Configuration or transport failure must look exactly like an absent
    // object: a distinguishable error would disclose which keys exist.
    return new Response("Not found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
}

export const Route = createFileRoute("/media/$")({
  server: {
    handlers: {
      GET: ({ request }) => serve(request),
      HEAD: ({ request }) => serve(request),
    },
  },
});
