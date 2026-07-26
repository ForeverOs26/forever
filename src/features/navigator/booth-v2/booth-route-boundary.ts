/**
 * Booth Mode 2.0 — the route load boundary (PR #102 corrective pass 3, item 2).
 *
 * Corrective pass 2 always matched `/booth-v2`, published Booth head metadata
 * and Booth font links, rendered the client Gate, and only then checked
 * enablement inside a React `useEffect`. A server-rendered request for a
 * disabled deployment therefore returned a document that already announced the
 * pilot before any check had run — which is not equivalent to a missing route.
 *
 * The gate now runs at the route's load boundary, before rendering. It lives
 * here rather than inline in the route file so the route stays a route file and
 * so the SSR suite can drive exactly the function the route uses.
 *
 * When the pilot is disabled `beforeLoad` throws TanStack `notFound()`. The
 * router then caps head execution at the rendered not-found boundary (the root
 * route) and stops loading matches past it, so the response carries none of the
 * Booth head, the loader never runs, and the component is never rendered — the
 * repository's ordinary not-found behaviour, byte for byte.
 *
 * This is a ROUTING decision, never the security boundary: every operational
 * endpoint stays independently gated on the server, and `resolveBoothActor`
 * re-checks enablement on every one of them.
 */

import { notFound } from "@tanstack/react-router";

import { boothV2GetRouteAvailability } from "./booth-v2.functions";

/** The pilot's head metadata — published ONLY once the route has been allowed. */
export const BOOTH_V2_HEAD = {
  meta: [
    { title: "Forever — Booth Mode 2.0 (Pilot)" },
    { name: "robots", content: "noindex, nofollow" },
    {
      name: "description",
      content:
        "Staff-guided Forever Assisted Decision Concierge pilot. Quick or Full Decision Profile, truthful initial directions, verified WhatsApp handoff to a named Guide.",
    },
  ],
  links: [
    { rel: "preconnect", href: "https://fonts.googleapis.com" },
    { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "" },
    {
      rel: "stylesheet",
      href: "https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&family=Newsreader:opsz,wght@6..72,300;6..72,400&display=swap",
    },
  ],
};

/**
 * Fail-closed enablement probe. A rejected call, a network failure and an
 * unexpected payload all mean "not available", so the route can only ever
 * over-refuse — never over-expose.
 */
export async function boothV2RouteIsAvailable(): Promise<boolean> {
  try {
    const availability = await boothV2GetRouteAvailability();
    return availability?.available === true;
  } catch {
    return false;
  }
}

/** One gate for both entry paths: a direct SSR request and client navigation. */
export async function boothV2RouteBeforeLoad(): Promise<void> {
  if (!(await boothV2RouteIsAvailable())) throw notFound();
}

/** Runs only after `beforeLoad` allowed the match — see the head gate below. */
export function boothV2RouteLoader(): { boothV2Available: true } {
  return { boothV2Available: true };
}

/**
 * The head is gated on this route's own loader data, so the Booth metadata has
 * two independent reasons it cannot be published while the pilot is off.
 */
export function boothV2RouteHead(context: { loaderData?: { boothV2Available?: boolean } }) {
  return context.loaderData?.boothV2Available === true ? BOOTH_V2_HEAD : {};
}
