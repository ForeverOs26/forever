import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { SITEMAP_STATIC_ENTRIES } from "@/lib/sitemap";
import { NavigatorFlow } from "./components/NavigatorFlow";

/**
 * F-007. `/navigator` was publicly functional but orphaned: zero anchor
 * elements at every viewport, no site header, no footer, and absent from
 * sitemap.xml — while being the homepage's primary call to action. A visitor
 * who landed there and did not want the questionnaire had no way back to the
 * site.
 *
 * This mirrors the route composition in `src/routes/navigator.tsx`. It is
 * deliberately not `SiteShell`: that wraps children in a `<main>`, and the
 * Navigator renders its own `<main>` per screen, so the shell would put two
 * `main` landmarks on the page.
 */
function NavigatorRouteComposition() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <div className="flex-1">
        <NavigatorFlow embedded />
      </div>
      <Footer />
    </div>
  );
}

async function renderRoute(ui: ReactNode) {
  const rootRoute = createRootRoute({
    component: () => (
      <>
        {ui}
        <Outlet />
      </>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/navigator"] }),
  });
  render(<RouterProvider router={router} />);
  await waitFor(() =>
    expect(
      screen.getByRole("heading", { name: /a home in phuket begins with a conversation/i }),
    ).toBeInTheDocument(),
  );
}

const hrefs = () => [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href"));

describe("Navigator inside the public site (F-007)", () => {
  it("is no longer an orphan — it carries the standard header and footer", async () => {
    await renderRoute(<NavigatorRouteComposition />);
    expect(document.querySelector("header")).not.toBeNull();
    expect(document.querySelector("footer")).not.toBeNull();
    // The audit measured zero anchors on this page at every viewport.
    expect(hrefs().length).toBeGreaterThan(0);
  });

  it("offers a way back to Projects", async () => {
    await renderRoute(<NavigatorRouteComposition />);
    expect(hrefs()).toContain("/projects");
  });

  it("offers a way back to the homepage", async () => {
    await renderRoute(<NavigatorRouteComposition />);
    expect(hrefs()).toContain("/");
  });

  it("keeps a single main landmark", async () => {
    await renderRoute(<NavigatorRouteComposition />);
    expect(document.querySelectorAll("main")).toHaveLength(1);
  });

  it("has no dead navigation links", async () => {
    await renderRoute(<NavigatorRouteComposition />);
    for (const href of hrefs()) {
      expect(href).toBeTruthy();
      expect(href).not.toBe("#");
      // Every in-app destination must be a real route path.
      if (href?.startsWith("/")) {
        expect(href).toMatch(/^\/(|projects|discovery|about|contact|navigator)$/);
      }
    }
  });

  it("preserves the Navigator workflow — the welcome screen still begins the flow", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    await renderRoute(<NavigatorRouteComposition />);
    await user.click(screen.getByRole("button", { name: "Begin" }));
    expect(
      screen.getByRole("heading", { name: /why are you considering phuket\?/i }),
    ).toBeInTheDocument();
  });

  it("reserves the header height so the footer is not pushed a viewport down", async () => {
    await renderRoute(<NavigatorRouteComposition />);
    // The embedded modifier is what stops the flow's own 100dvh canvas from
    // stacking below the 4rem site header.
    expect(document.querySelector(".navigator-flow--embedded")).not.toBeNull();
  });

  it("keeps the standalone flow full-height when it is not embedded", () => {
    render(<NavigatorFlow />);
    const root = document.querySelector(".navigator-flow");
    expect(root).not.toBeNull();
    expect(root?.classList.contains("navigator-flow--embedded")).toBe(false);
  });
});

describe("Navigator discoverability (F-007)", () => {
  it("is reachable from the site footer on every page", async () => {
    await renderRoute(<NavigatorRouteComposition />);
    const footer = document.querySelector("footer") as HTMLElement;
    expect(within(footer).getByRole("link", { name: "Navigator" })).toHaveAttribute(
      "href",
      "/navigator",
    );
  });

  it("is advertised in the sitemap", () => {
    expect(SITEMAP_STATIC_ENTRIES.map((entry) => entry.path)).toContain("/navigator");
  });

  it("is still the homepage's primary call to action", () => {
    const home = readFileSync(join(process.cwd(), "src", "routes", "index.tsx"), "utf-8");
    expect(home).toContain('to="/navigator"');
    expect(home).toContain("Start the Forever Navigator");
  });

  it("is mounted with the site header and footer rather than bare", () => {
    const route = readFileSync(join(process.cwd(), "src", "routes", "navigator.tsx"), "utf-8");
    expect(route).toContain("<Header />");
    expect(route).toContain("<Footer />");
    expect(route).toContain("<NavigatorFlow embedded />");
  });
});
