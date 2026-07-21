/**
 * Minimal authenticated chrome for Forever Studio. Deliberately separate
 * from the public SiteShell: Studio is a working tool, not a public page,
 * and it never appears in public navigation or the sitemap.
 */

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

import { studioSignOut } from "./useStudioSession";

export function StudioShell(props: { email?: string | null; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between gap-2 px-4">
          <Link to="/studio" className="text-sm font-semibold tracking-wide">
            Forever Studio
          </Link>
          <div className="flex items-center gap-2">
            {props.email ? (
              <span className="hidden text-xs text-muted-foreground sm:inline">{props.email}</span>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => void studioSignOut()}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-6">{props.children}</main>
    </div>
  );
}
