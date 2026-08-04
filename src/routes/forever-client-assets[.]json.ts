import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

import { FOREVER_CLIENT_ASSET_ID } from "@/lib/stale-asset/client-asset-identity";

/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — the active CLIENT ASSET identity.
 *
 * WHY IT EXISTS. A page that has just failed to load one of its own chunks has
 * to establish one fact before it is allowed to reload itself: is the origin
 * serving a DIFFERENT CLIENT ASSET GRAPH now? This endpoint answers exactly
 * that and nothing else. Without it the recovery path would be reloading on a
 * guess.
 *
 * WHAT IT DELIBERATELY DOES NOT ANSWER (narrow-re-review RR2-P1-1). Which
 * Worker version is deployed. That is a deployment-plane fact, it is proved by
 * the immutable Cloudflare Worker version UUID, and it is neither served here
 * nor inlined into any bundle. A server-only release legitimately leaves this
 * value unchanged, so a release, a traffic allocation or a rollback target must
 * never be verified against it — see
 * `src/lib/stale-asset/worker-release-identity.ts` and
 * `docs/FOREVER_PRODUCTION_RELEASE_RUNBOOK.md`.
 *
 * WHY IT IS SAFE TO SERVE PUBLICLY. The response is a single bounded
 * identifier — lowercase alphanumerics, at most 32 characters — inlined at
 * build time from a digest of this repository's own emitted client bytes. It is
 * exactly as public as the content-hashed asset filenames that sit beside it in
 * `/assets/`. It reveals no secret, no credential, no binding, no environment
 * variable, no commit reference, no Worker version, no path, no database and no
 * identity. It reads nothing at request time, so it cannot leak request state
 * either.
 *
 * `no-store` is required, not decorative: an identifier answered from a cache
 * would report the client assets the asking page already knows about, which is
 * the one answer that must never be given.
 */
export const Route = createFileRoute("/forever-client-assets.json")({
  server: {
    handlers: {
      GET: () =>
        new Response(JSON.stringify({ clientAssetId: FOREVER_CLIENT_ASSET_ID }), {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            // Not a page. Keeps it out of search results without needing a
            // robots.txt entry that would only advertise it.
            "X-Robots-Tag": "noindex, nofollow",
          },
        }),
    },
  },
});
