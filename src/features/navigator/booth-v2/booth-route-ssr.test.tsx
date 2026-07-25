// @vitest-environment node
/**
 * Booth Mode 2.0 — SSR route-boundary tests (PR #102 corrective pass 3, item 2).
 *
 * WHAT WAS WRONG. Corrective pass 2 always matched `/booth-v2`, published Booth
 * head metadata and Booth font links, rendered the client Gate, and only then
 * checked enablement inside a React `useEffect`. A server-rendered request for a
 * disabled deployment therefore returned a document that already announced the
 * pilot — its title, its description, its fonts — before any check had run. That
 * is not equivalent to a missing route.
 *
 * WHAT THIS SUITE RUNS. A REAL server environment (`@vitest-environment node`,
 * so `document` genuinely does not exist and the router reports `isServer`), a
 * REAL TanStack router built from the REAL exported route options of
 * src/routes/booth-v2.tsx, the REAL root not-found boundary from
 * src/routes/__root.tsx, and REAL `renderToString` SSR output. The assertions
 * read the produced HTML and the router's own match state — not a component's
 * internal state.
 *
 * The only mock is the availability server function itself, which stands in for
 * the deployment's BOOTH_V2_ENABLED flag; it also lets the suite count exactly
 * how many Booth calls a disabled request makes (the answer must be one).
 */

import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  HeadContent,
  Outlet,
  RouterProvider,
  type AnyRouter,
} from "@tanstack/react-router";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The repository registers its generated route tree, so a hand-built test tree
 * cannot satisfy the registered generics. This only loosens TYPES — the router
 * itself, the route options and the render below are the real ones.
 */
const buildRouter = (options: Record<string, unknown>): AnyRouter =>
  (createRouter as unknown as (opts: Record<string, unknown>) => AnyRouter)(options);

const mocks = vi.hoisted(() => ({
  getRouteAvailability: vi.fn(async () => ({ available: false })),
  getAccess: vi.fn(async () => ({ granted: true as const, hostName: "Host Tester" })),
  getConfig: vi.fn(async () => ({})),
  listGuides: vi.fn(async () => []),
  ensureSession: vi.fn(async () => ({ ok: true as const })),
  recordEvent: vi.fn(async () => ({ ok: true as const })),
}));

vi.mock("./booth-v2.functions", () => ({
  boothV2GetRouteAvailability: mocks.getRouteAvailability,
  boothV2GetAccess: mocks.getAccess,
  boothV2GetConfig: mocks.getConfig,
  boothV2ListGuides: mocks.listGuides,
  boothV2EnsureSession: mocks.ensureSession,
  boothV2RecordEvent: mocks.recordEvent,
  boothV2MarkProfileConfirmed: vi.fn(),
  boothV2ValidateShortlist: vi.fn(),
  boothV2CommitConsent: vi.fn(),
  boothV2StartWhatsappVerification: vi.fn(),
  boothV2ConfirmWhatsappVerification: vi.fn(),
  boothV2AssignGuide: vi.fn(),
  boothV2AcknowledgeGuide: vi.fn(),
  boothV2RecordHandoff: vi.fn(),
  boothV2CompleteSession: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null } })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
      signInWithPassword: vi.fn(async () => ({ error: null })),
    },
  },
}));

/** The pilot's own head values and the pilot's own not-found boundary. */
const BOOTH_MARKERS = [
  "Booth Mode 2.0 (Pilot)",
  "Assisted Decision Concierge",
  "Hanken+Grotesk",
  "Newsreader",
  "Forever Booth", // the staff sign-in heading
  "Loading…",
];

interface RenderedRequest {
  html: string;
  matchedBoothRoute: boolean;
  boothMatchStatus: string | undefined;
  boothMeta: unknown;
  boothLinks: unknown;
  boothLoaderRan: boolean;
}

/**
 * Server-render one request through a router assembled from the REAL route
 * options, and report both the HTML and what the router decided.
 */
async function renderRequest(path: string): Promise<RenderedRequest> {
  const { NotFoundComponent } = await import("@/routes/__root");
  const { Route: BoothRoute } = await import("@/routes/booth-v2");
  const boothOptions = (BoothRoute as unknown as { options: Record<string, unknown> }).options;

  let loaderRan = false;
  const rootRoute = createRootRoute({
    component: () => (
      <>
        <HeadContent />
        <Outlet />
      </>
    ),
    notFoundComponent: NotFoundComponent,
    head: () => ({ meta: [{ title: "Forever — Phuket Property Advisory" }] }),
  });
  const boothRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/booth-v2",
    // The REAL gate, the REAL loader, the REAL head and the REAL component.
    beforeLoad: boothOptions.beforeLoad as never,
    loader: (async (...args: unknown[]) => {
      loaderRan = true;
      return (boothOptions.loader as (...a: unknown[]) => unknown)(...args);
    }) as never,
    head: boothOptions.head as never,
    component: boothOptions.component as never,
  });
  const otherRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/some-page-that-exists",
    component: () => <p>a real page</p>,
  });

  const router = buildRouter({
    routeTree: rootRoute.addChildren([boothRoute, otherRoute] as never),
    history: createMemoryHistory({ initialEntries: [path] }),
    defaultNotFoundComponent: NotFoundComponent,
  });
  expect(router.isServer).toBe(true);

  await router.load();
  const html = renderToString(<RouterProvider router={router} />);
  const boothMatch = router.state.matches.find((match) => match.routeId === "/booth-v2");

  return {
    html,
    matchedBoothRoute: Boolean(boothMatch),
    boothMatchStatus: boothMatch?.status,
    boothMeta: boothMatch?.meta,
    boothLinks: boothMatch?.links,
    boothLoaderRan: loaderRan,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRouteAvailability.mockResolvedValue({ available: false });
  mocks.getAccess.mockResolvedValue({ granted: true as const, hostName: "Host Tester" });
});

describe("an SSR request for /booth-v2 while the pilot is NOT enabled", () => {
  it("renders the ordinary not-found boundary when the flag is absent", async () => {
    // Flag absent is exactly what the availability boundary reports as false.
    mocks.getRouteAvailability.mockResolvedValue({ available: false });

    const rendered = await renderRequest("/booth-v2");

    expect(rendered.html).toContain("Page not found");
    expect(rendered.html).toContain("404");
    expect(rendered.boothMatchStatus).toBe("notFound");
  });

  it("renders MARKUP byte-identical to a genuinely missing URL", async () => {
    const disabled = await renderRequest("/booth-v2");
    const missing = await renderRequest("/no-such-page-at-all");

    // The rendered document — boundary, title, description, links, body — is
    // byte-identical, so a visitor sees exactly a missing page.
    expect(disabled.html).toBe(missing.html);
  });

  /**
   * KNOWN, ACCEPTED RESIDUAL — recorded so the claim above is never read as
   * more than it is.
   *
   * `notFound()` from `beforeLoad` is what the architect specified, and it is
   * the framework's own mechanism: the route DOES match, then refuses. TanStack
   * Router therefore keeps a match entry for it, and TanStack Start's SSR
   * dehydration serializes that entry into the hydration payload. Verified
   * against a real dev server: a disabled `/booth-v2` and a missing URL both
   * return HTTP 404 with identical visible documents, but the payload of the
   * former contains a match keyed on the route id with status "notFound" while
   * the latter carries only the root match.
   *
   * So an attacker who reads the hydration script can learn that a route path
   * `/booth-v2` is DECLARED. They learn nothing else: not the pilot's name,
   * title, description, fonts or purpose, not whether it is enabled, not
   * whether they could ever reach it, and no capability — every operational
   * endpoint is independently gated and re-verifies the caller. Removing even
   * this would mean not declaring the route at all, which is a build-time
   * decision rather than a runtime gate.
   */
  it("leaves only the route-id match entry as a residual, and nothing more", async () => {
    const disabled = await renderRequest("/booth-v2");
    const missing = await renderRequest("/no-such-page-at-all");

    // This is the residual: the match exists and is refused.
    expect(disabled.matchedBoothRoute).toBe(true);
    expect(disabled.boothMatchStatus).toBe("notFound");
    expect(missing.matchedBoothRoute).toBe(false);
    // And it carries NO Booth content — no head, no links, no loader data.
    expect(disabled.boothMeta).toBeUndefined();
    expect(disabled.boothLinks).toBeUndefined();
    expect(disabled.boothLoaderRan).toBe(false);
  });

  it("publishes NO Booth title, description, font link or client shell", async () => {
    const rendered = await renderRequest("/booth-v2");

    for (const marker of BOOTH_MARKERS) {
      expect(`${marker}:${rendered.html.includes(marker)}`).toBe(`${marker}:false`);
    }
    expect(rendered.html).not.toContain("fonts.googleapis.com");
    // The route's own head never executed at all.
    expect(rendered.boothMeta).toBeUndefined();
    expect(rendered.boothLinks).toBeUndefined();
  });

  it("makes exactly ONE Booth call — the availability boundary — and no operational call", async () => {
    await renderRequest("/booth-v2");

    expect(mocks.getRouteAvailability).toHaveBeenCalledTimes(1);
    expect(mocks.getAccess).not.toHaveBeenCalled();
    expect(mocks.getConfig).not.toHaveBeenCalled();
    expect(mocks.listGuides).not.toHaveBeenCalled();
    expect(mocks.ensureSession).not.toHaveBeenCalled();
    expect(mocks.recordEvent).not.toHaveBeenCalled();
  });

  it("never runs the route loader once the gate has refused", async () => {
    const rendered = await renderRequest("/booth-v2");

    expect(rendered.boothLoaderRan).toBe(false);
  });

  it("fails closed when the availability boundary itself throws", async () => {
    mocks.getRouteAvailability.mockRejectedValue(new Error("network"));

    const rendered = await renderRequest("/booth-v2");

    expect(rendered.html).toContain("Page not found");
    expect(rendered.html).not.toContain("Booth Mode 2.0 (Pilot)");
  });

  it("fails closed on an unexpected availability payload", async () => {
    mocks.getRouteAvailability.mockResolvedValue({} as { available: boolean });

    const rendered = await renderRequest("/booth-v2");

    expect(rendered.html).toContain("Page not found");
    expect(rendered.boothMatchStatus).toBe("notFound");
  });

  it("treats a truthy-but-not-true payload as unavailable", async () => {
    mocks.getRouteAvailability.mockResolvedValue({
      available: "true" as unknown as boolean,
    });

    const rendered = await renderRequest("/booth-v2");

    expect(rendered.boothMatchStatus).toBe("notFound");
  });
});

describe("an SSR request for /booth-v2 once the pilot IS enabled", () => {
  beforeEach(() => {
    mocks.getRouteAvailability.mockResolvedValue({ available: true });
  });

  it("matches the route, runs its loader, and publishes the Booth head", async () => {
    const rendered = await renderRequest("/booth-v2");

    expect(rendered.boothMatchStatus).toBe("success");
    expect(rendered.boothLoaderRan).toBe(true);
    expect(rendered.html).toContain("Booth Mode 2.0 (Pilot)");
    expect(rendered.html).toContain("Assisted Decision Concierge");
    expect(rendered.html).toContain("Hanken+Grotesk");
    // Still kept out of search results.
    expect(rendered.html).toContain("noindex, nofollow");
    expect(rendered.html).not.toContain("Page not found");
  });

  it("reaches the authentication Gate rather than the Booth shell", async () => {
    const rendered = await renderRequest("/booth-v2");

    // SSR renders the Gate's pre-decision state; the shell is never
    // server-rendered, and no operational endpoint is called during SSR.
    expect(rendered.html).toContain("Loading…");
    expect(mocks.getConfig).not.toHaveBeenCalled();
    expect(mocks.listGuides).not.toHaveBeenCalled();
  });
});

describe("client navigation and a direct URL behave identically", () => {
  it("refuses a client-side navigation to /booth-v2 while disabled", async () => {
    mocks.getRouteAvailability.mockResolvedValue({ available: false });
    const { NotFoundComponent } = await import("@/routes/__root");
    const { Route: BoothRoute } = await import("@/routes/booth-v2");
    const boothOptions = (BoothRoute as unknown as { options: Record<string, unknown> }).options;

    const rootRoute = createRootRoute({
      component: () => <Outlet />,
      notFoundComponent: NotFoundComponent,
    });
    const indexRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/",
      component: () => <p>home</p>,
    });
    const boothRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/booth-v2",
      beforeLoad: boothOptions.beforeLoad as never,
      loader: boothOptions.loader as never,
      head: boothOptions.head as never,
      component: boothOptions.component as never,
    });
    const router = buildRouter({
      routeTree: rootRoute.addChildren([indexRoute, boothRoute] as never),
      history: createMemoryHistory({ initialEntries: ["/"] }),
      defaultNotFoundComponent: NotFoundComponent,
    });

    await router.load();
    expect(renderToString(<RouterProvider router={router} />)).toContain("home");

    // The same gate runs on an in-app navigation, so the answer cannot differ.
    await router.navigate({ to: "/booth-v2" });
    await router.invalidate();
    const boothMatch = router.state.matches.find((match) => match.routeId === "/booth-v2");
    expect(boothMatch?.status).toBe("notFound");
    expect(boothMatch?.meta).toBeUndefined();
  });

  it("uses one shared gate for both entry paths", async () => {
    const { boothV2RouteBeforeLoad } = await import("./booth-route-boundary");
    const { Route: BoothRoute } = await import("@/routes/booth-v2");
    const boothOptions = (BoothRoute as unknown as { options: Record<string, unknown> }).options;

    // Not two code paths that could drift — literally the same function.
    expect(boothOptions.beforeLoad).toBe(boothV2RouteBeforeLoad);
  });
});
