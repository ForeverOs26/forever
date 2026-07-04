import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import type { Area } from "@/lib/data";

export function AreaCard({ area }: { area: Area }) {
  return (
    <Link
      to="/areas"
      className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-border/60 bg-card p-6 transition-all hover:-translate-y-1 hover:shadow-lg"
    >
      <div
        className="absolute inset-0 -z-10 opacity-0 transition-opacity group-hover:opacity-100"
        style={{ background: "radial-gradient(circle at 80% 0%, var(--color-accent) 0%, transparent 60%)" }}
      />
      <div>
        <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{area.region}</div>
        <h3 className="mt-2 font-serif text-2xl text-foreground">{area.name}</h3>
        <p className="mt-3 text-sm text-muted-foreground">{area.description}</p>
      </div>
      <div className="mt-8 flex items-center justify-between border-t border-border/60 pt-4 text-sm">
        <span className="text-muted-foreground">{area.listings} residences</span>
        <ArrowUpRight className="h-4 w-4 text-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      </div>
    </Link>
  );
}