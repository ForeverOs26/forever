import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { Container } from "./Container";
import { Button } from "@/components/ui/button";
import { isPartnerDemoModeEnabled } from "@/lib/partner-demo-mode";

/**
 * FOREVER-TRUTH-001A: `/offers`, `/reviews`, `/areas`, and `/advisory` left
 * the primary navigation — they carry no published, evidence-bound content
 * yet and must not be promoted. The routes still exist as honest, noindex
 * empty states for anyone holding an old link. The Advisor Workspace returns
 * in a later phase behind a real evidence contract.
 */
const publicNav = [
  { to: "/", label: "Home" },
  { to: "/discovery", label: "Discovery" },
  { to: "/projects", label: "Projects" },
  { to: "/about", label: "About" },
] as const;

const partnerDemoNav = [
  { to: "/", label: "Home" },
  { to: "/navigator", label: "Navigator" },
  { to: "/projects", label: "Projects" },
  { to: "/contact", label: "Advisory" },
] as const;

export function Header() {
  const [open, setOpen] = useState(false);
  const partnerDemo = import.meta.env.DEV && isPartnerDemoModeEnabled();
  const nav = partnerDemo ? partnerDemoNav : publicNav;
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur">
      {partnerDemo ? (
        <div
          data-partner-demo-safe="true"
          className="bg-primary px-4 py-2 text-center text-xs font-medium text-primary-foreground"
        >
          Partner presentation · committed local project records · requests are not saved
        </div>
      ) : null}
      <Container className="flex h-16 items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <span className="font-serif text-2xl tracking-tight text-foreground">Forever</span>
          <span className="hidden text-[10px] font-medium uppercase tracking-[0.25em] text-muted-foreground sm:inline">
            Advisory
          </span>
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {nav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="text-sm text-foreground/80 transition-colors hover:text-foreground"
              activeProps={{ className: "text-foreground font-medium" }}
              activeOptions={{ exact: item.to === "/" }}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden md:block">
          <Button asChild size="sm">
            <Link to="/contact">Request Private Advisory</Link>
          </Button>
        </div>

        <button
          type="button"
          aria-label="Toggle menu"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md md:hidden"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </Container>

      {open && (
        <div className="border-t border-border/60 bg-background md:hidden">
          <Container className="flex flex-col gap-1 py-4">
            {nav.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-2 text-sm text-foreground/80 hover:bg-secondary"
              >
                {item.label}
              </Link>
            ))}
            <Link
              to="/contact"
              onClick={() => setOpen(false)}
              className="mt-2 rounded-md bg-primary px-3 py-2 text-center text-sm font-medium text-primary-foreground"
            >
              Request Private Advisory
            </Link>
          </Container>
        </div>
      )}
    </header>
  );
}
