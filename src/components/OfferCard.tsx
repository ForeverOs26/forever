import { Sparkles } from "lucide-react";
import type { Offer } from "@/lib/data";
import { Badge } from "@/components/ui/badge";

export function OfferCard({ offer }: { offer: Offer }) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-accent/40 bg-card p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-accent/20 text-accent-foreground">
          <Sparkles className="h-5 w-5" />
        </div>
        <Badge className="bg-accent text-accent-foreground">{offer.savings}</Badge>
      </div>
      <div>
        <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{offer.project}</div>
        <h3 className="mt-1 font-serif text-xl text-foreground">{offer.title}</h3>
      </div>
      <p className="text-sm text-muted-foreground">{offer.detail}</p>
      <div className="mt-auto border-t border-border/60 pt-4 text-xs text-muted-foreground">
        Expires {offer.expires}
      </div>
    </div>
  );
}