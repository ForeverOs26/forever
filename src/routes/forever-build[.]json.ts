import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

import { FOREVER_BUILD_ID } from "@/lib/stale-asset/build-identity";

/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — the active build identity.
 *
 * WHY IT EXISTS. A page that has just failed to load one of its own chunks has
 * to establish one fact before it is allowed to reload itself: is the origin
 * serving a DIFFERENT build now? This endpoint answers exactly that and nothing
 * else. Without it the recovery path would be reloading on a guess.
 *
 * WHY IT IS SAFE TO SERVE PUBLICLY. The response is a single bounded
 * identifier — lowercase alphanumerics, at most 32 characters — inlined at
 * build time from the repository's own build inputs. It is exactly as public as
 * the content-hashed asset filenames that sit beside it in `/assets/`. It
 * reveals no secret, no credential, no binding, no environment variable, no
 * commit reference, no path, no database and no identity. It reads nothing at
 * request time, so it cannot leak request state either.
 *
 * `no-store` is required, not decorative: an identifier answered from a cache
 * would report the build the asking page already knows about, which is the one
 * answer that must never be given.
 */
export const Route = createFileRoute("/forever-build.json")({
  server: {
    handlers: {
      GET: () =>
        new Response(JSON.stringify({ build: FOREVER_BUILD_ID }), {
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
