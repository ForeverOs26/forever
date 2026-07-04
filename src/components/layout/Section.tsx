import { cn } from "@/lib/utils";
import type { HTMLAttributes, ReactNode } from "react";
import { Container } from "./Container";

type SectionProps = HTMLAttributes<HTMLElement> & {
  eyebrow?: string;
  title?: ReactNode;
  description?: ReactNode;
  align?: "left" | "center";
  bleed?: boolean;
};

export function Section({
  className,
  eyebrow,
  title,
  description,
  align = "left",
  bleed = false,
  children,
  ...props
}: SectionProps) {
  return (
    <section className={cn("py-20 sm:py-28", className)} {...props}>
      {bleed ? (
        children
      ) : (
        <Container>
          {(eyebrow || title || description) && (
            <div
              className={cn(
                "mb-12 max-w-2xl",
                align === "center" && "mx-auto text-center",
              )}
            >
              {eyebrow && (
                <div className="mb-4 text-xs font-medium uppercase tracking-[0.2em] text-accent">
                  {eyebrow}
                </div>
              )}
              {title && (
                <h2 className="font-serif text-3xl leading-tight tracking-tight text-foreground sm:text-4xl md:text-5xl">
                  {title}
                </h2>
              )}
              {description && (
                <p className="mt-4 text-base text-muted-foreground sm:text-lg">{description}</p>
              )}
            </div>
          )}
          {children}
        </Container>
      )}
    </section>
  );
}