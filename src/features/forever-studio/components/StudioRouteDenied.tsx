/**
 * Settled, non-enumerating failure state for guarded Studio routes.
 *
 * Detail endpoints intentionally use one indistinguishable denial for a
 * missing, cross-publisher, or legacy Owner-managed object. Do not accept or
 * render the thrown error here: server-function errors can be transport
 * errors, and rendering their text would risk disclosing infrastructure
 * detail. The back link is a normal history entry, so direct links and Back
 * remain usable without a redirect or retry loop.
 */
import { Link } from "@tanstack/react-router";

export function StudioRouteDenied() {
  return (
    <div className="mx-auto max-w-md space-y-4 py-16 text-center">
      <h1 className="text-xl font-semibold">Studio access denied</h1>
      <p className="text-sm text-muted-foreground">
        This page is unavailable for this Studio account.
      </p>
      <Link to="/studio" className="text-sm font-medium underline underline-offset-4">
        Back to Studio
      </Link>
    </div>
  );
}
