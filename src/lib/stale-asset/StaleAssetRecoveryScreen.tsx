/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — the honest recovery screen.
 *
 * Shown when the application has CONFIRMED that this page is running an older
 * build than the one the origin is serving, and an automatic reload is not
 * available: the single attempt is spent, a consequential action's outcome is
 * unproven, the route forbids it, or the active build could not be read.
 *
 * WHAT IT SAYS, AND WHY IT SAYS EXACTLY THIS. The application was updated while
 * this page was open and could not finish loading the latest version. That is
 * the whole truth of the situation. It is deliberately NOT presented as a failed
 * upload, an authentication problem, a database problem or a project problem —
 * naming the wrong cause is how someone is led to press Retry, sign out, or
 * re-upload a file when none of those is the issue.
 *
 * NO RAW EXCEPTION. No message, no stack, no asset URL, no identifier of any
 * kind is rendered. Nothing here is derived from the error object at all.
 *
 * NO LAZY DEPENDENCY. Plain elements and utility classes only. This screen has
 * to render on a page whose chunks are missing, so it must live in the entry
 * graph and must not import a component that might itself be a missing chunk.
 */

import { safeRecoveryTarget } from "./stale-asset-recovery-contract";

export const STALE_ASSET_RECOVERY_HEADING = "Forever was updated";
export const STALE_ASSET_RECOVERY_BODY =
  "This page was open while a new version was released, so it could not finish loading the latest version. Reloading picks up the current version. You stay signed in, and nothing you have already submitted is repeated.";

export function StaleAssetRecoveryScreen() {
  const reloadCurrentVersion = () => {
    if (typeof window === "undefined") return;
    window.location.replace(safeRecoveryTarget(window.location.pathname, window.location.search));
  };

  return (
    <div
      data-testid="stale-asset-recovery-screen"
      className="flex min-h-screen w-full items-center justify-center bg-background px-4 py-12"
    >
      <div className="w-full max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {STALE_ASSET_RECOVERY_HEADING}
        </h1>
        <p className="mt-2 break-words text-sm text-muted-foreground">
          {STALE_ASSET_RECOVERY_BODY}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            data-testid="stale-asset-recovery-reload"
            onClick={reloadCurrentVersion}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Reload current version
          </button>
          <a
            href="/"
            data-testid="stale-asset-recovery-home"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go to site
          </a>
        </div>
      </div>
    </div>
  );
}
