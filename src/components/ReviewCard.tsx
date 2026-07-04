import { Star } from "lucide-react";
import type { Review } from "@/lib/data";

export function ReviewCard({ review }: { review: Review }) {
  return (
    <figure className="flex h-full flex-col justify-between gap-6 rounded-2xl border border-border/60 bg-card p-6">
      <div>
        <div className="mb-3 flex gap-0.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Star
              key={i}
              className={
                i < review.rating
                  ? "h-4 w-4 fill-accent text-accent"
                  : "h-4 w-4 text-muted-foreground/40"
              }
            />
          ))}
        </div>
        <blockquote className="font-serif text-lg leading-relaxed text-foreground">
          &ldquo;{review.quote}&rdquo;
        </blockquote>
      </div>
      <figcaption className="border-t border-border/60 pt-4">
        <div className="text-sm font-medium text-foreground">{review.name}</div>
        <div className="text-xs text-muted-foreground">
          {review.role} · {review.project}
        </div>
      </figcaption>
    </figure>
  );
}