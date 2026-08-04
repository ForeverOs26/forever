import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { StaleAssetRecoveryScreen } from "../lib/stale-asset/StaleAssetRecoveryScreen";
import { classifyStaleAssetError, verdictIsStale } from "../lib/stale-asset/stale-asset-contract";
import { routeLoadEvidence, type RouterStateLike } from "../lib/stale-asset/route-load-evidence";
import {
  attestStaleAssetRecovery,
  getStaleAssetRecoveryState,
  requireManualStaleAssetRecovery,
  subscribeStaleAssetRecoveryState,
} from "../lib/stale-asset/stale-asset-recovery";
import {
  routeKindOf,
  routeKindRequiresAuthenticatedStudio,
  stateRendersRecoveryScreen,
} from "../lib/stale-asset/stale-asset-recovery-contract";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * The root boundary has three honest outcomes
 * (FOREVER-STUDIO-STALE-ASSET-RECOVERY-001):
 *
 *   A. a CONFIRMED stale versioned asset whose single automatic attempt is
 *      still available — the capture layer owns it and a bounded reload is
 *      already in flight, so this boundary shows the update screen rather than
 *      a generic failure;
 *   B. a CONFIRMED stale versioned asset whose attempt is spent — the same
 *      specific screen, with a manual reload, and never a second automatic one;
 *   C. anything else — the existing generic screen, unchanged, with no
 *      automatic reload and no raw exception.
 *
 * The classification is the same narrow one used everywhere else, so an
 * ordinary React throw, a Supabase failure, a Studio RPC error or a permission
 * error can never reach A or B. The boundary stays safe on public routes: it
 * reveals nothing about Studio and nothing about the error itself.
 */
function isConfirmedStaleAssetError(error: unknown): boolean {
  if (typeof window === "undefined") return false;
  const message = error instanceof Error ? error.message : "";
  return verdictIsStale(
    classifyStaleAssetError({ kind: "render_error", message }, { origin: window.location.origin }),
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  /**
   * OUTCOME B MUST NEVER FALL THROUGH TO THE GENERIC SCREEN
   * (independent-review P2-1).
   *
   * The raw message is not a sufficient signal here. Once the capture layer
   * calls `preventDefault()` on `vite:preloadError`, Vite resolves the preload
   * promise with `undefined`, and the error that finally reaches this boundary
   * is a bare `TypeError` about reading `'default'` of undefined — it carries
   * no asset evidence at all. Classifying only the message therefore renders
   * the generic "This page didn't load" screen for a failure the application
   * has already CONFIRMED is a version change, in every refusal path.
   *
   * So the recovery MACHINE is authoritative, and the message is only a second
   * way in. `deciding` is a first-class state precisely so the window between
   * synchronous ownership and the asynchronous decision is covered.
   */
  const recoveryState = useSyncExternalStore(
    subscribeStaleAssetRecoveryState,
    getStaleAssetRecoveryState,
    () => "idle" as const,
  );
  const staleAsset = stateRendersRecoveryScreen(recoveryState) || isConfirmedStaleAssetError(error);

  useEffect(() => {
    if (staleAsset) {
      // Outcomes A and B. The capture layer decides whether an automatic reload
      // is permitted; this only guarantees the visitor sees the specific screen
      // instead of the generic one.
      requireManualStaleAssetRecovery();
      return;
    }
    // Outcome C — unchanged behaviour for every ordinary application error.
    console.error(error);
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error, staleAsset]);

  if (staleAsset) return <StaleAssetRecoveryScreen />;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Forever — Phuket Property Advisory" },
      {
        name: "description",
        content:
          "Forever is an independent Phuket property advisory platform that helps buyers reduce uncertainty with structured project records, honest missing-data handling, and private advisory support.",
      },
      { name: "author", content: "Forever" },
      { property: "og:title", content: "Forever — Phuket Property Advisory" },
      {
        property: "og:description",
        content:
          "Independent Phuket property advisory built on structured project records and honest missing-data handling.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Playfair+Display:wght@400;500;600;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  const recoveryState = useSyncExternalStore(
    subscribeStaleAssetRecoveryState,
    getStaleAssetRecoveryState,
    // Server render: the recovery machine is a browser concern and must never
    // change what SSR emits.
    () => "idle" as const,
  );

  /**
   * EXACT-ROUTE SUCCESS ATTESTATION (independent-review P1-2).
   *
   * The generic clearing this replaced fired on `router_resolved` for ANY
   * non-Studio pathname and cleared the guard unconditionally, so the recovery
   * screen's own "Go to site" control (`<a href="/">`) re-armed the identical
   * broken transition. Measured before the correction: outcome `reload_issued`,
   * clear, outcome `reload_issued` again.
   *
   * What runs now attests nothing on its own. It supplies the router's real
   * load evidence for the route that actually resolved, and
   * `attestStaleAssetRecovery` refuses unless that evidence matches the pending
   * recovery's build AND its route kind. An authenticated Studio route is not
   * attested from here at all — its leaf does that itself, because a shell
   * mount is not proof that the dashboard, uploader or members chunks loaded.
   *
   * Whatever happens, the attempted-transition HISTORY is never touched.
   */
  /**
   * REAL APPLICATION BOOTSTRAP AND ROUTE-READY MARKERS
   * (narrow-re-review RR2-P2-2).
   *
   * The committed browser proof used to start every scenario from a document
   * the harness origin answered with HTTP 500, on which no route ever mounted.
   * Several scenarios then "passed" by nothing happening. A proof needs a
   * positive statement that the REAL application booted, and it has to come
   * from the real root component of the real router rather than from a
   * test-only page.
   *
   * These two attributes are that statement, and nothing else depends on them:
   *
   *   `data-forever-app="mounted"`  this component — the root of the real route
   *                                 tree — executed in the browser.
   *   `data-forever-route`          `ready` when the router resolved a route
   *                                 whose leaf and nested modules all loaded
   *                                 and no error boundary is active; `error`
   *                                 otherwise. Derived from the SAME router
   *                                 evidence the attestation uses, so it cannot
   *                                 drift from it.
   *   `data-forever-route-id`       the matched leaf route id — a static string
   *                                 from the generated route tree, carrying no
   *                                 parameter, query or identifier.
   *
   * Client-only: effects do not run during server rendering, so SSR output is
   * byte-for-byte unchanged.
   */
  useEffect(() => {
    document.documentElement.dataset.foreverApp = "mounted";
  }, []);

  useEffect(() => {
    const publish = () => {
      const evidence = routeLoadEvidence(router as unknown as RouterStateLike);
      const matches = (router as unknown as RouterStateLike).state?.matches ?? [];
      const leaf = matches[matches.length - 1] as { routeId?: unknown } | undefined;
      const ready =
        evidence.leafRouteLoaded && evidence.nestedModulesLoaded && !evidence.errorBoundaryActive;
      document.documentElement.dataset.foreverRoute = ready ? "ready" : "error";
      document.documentElement.dataset.foreverRouteId =
        typeof leaf?.routeId === "string" ? leaf.routeId : "";
    };
    publish();
    const unsubscribe = router.subscribe("onResolved", publish);
    return () => {
      unsubscribe();
    };
  }, [router]);

  useEffect(() => {
    const unsubscribe = router.subscribe("onResolved", () => {
      const pathname = window.location.pathname;
      if (routeKindRequiresAuthenticatedStudio(routeKindOf(pathname))) return;
      const evidence = routeLoadEvidence(router as unknown as RouterStateLike);
      attestStaleAssetRecovery({
        pathname,
        leafRouteLoaded: evidence.leafRouteLoaded,
        nestedModulesLoaded: evidence.nestedModulesLoaded,
        errorBoundaryActive: evidence.errorBoundaryActive,
        // No public route can attest an authenticated Studio recovery.
        studioAuthenticatedReady: false,
      });
    });
    return () => {
      unsubscribe();
    };
  }, [router]);

  if (stateRendersRecoveryScreen(recoveryState)) return <StaleAssetRecoveryScreen />;

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
    </QueryClientProvider>
  );
}
