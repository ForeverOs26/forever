import { Link } from "@tanstack/react-router";
import { Container } from "./Container";

export function Footer() {
  return (
    <footer className="mt-24 border-t border-border/60 bg-primary text-primary-foreground">
      <Container className="grid gap-10 py-16 md:grid-cols-4">
        <div className="md:col-span-2">
          <div className="font-serif text-2xl">Forever</div>
          <p className="mt-3 max-w-sm text-sm text-primary-foreground/70">
            An independent property advisory for Phuket. We help buyers reduce uncertainty
            with verified project data, structured analysis, and private advisory support.
          </p>
        </div>
        <div>
          <div className="mb-3 text-xs font-medium uppercase tracking-[0.2em] text-primary-foreground/50">
            Explore
          </div>
          <ul className="space-y-2 text-sm">
            <li><Link to="/projects" className="hover:text-accent">Projects</Link></li>
            <li><Link to="/offers" className="hover:text-accent">Verified Offers</Link></li>
            <li><Link to="/areas" className="hover:text-accent">Areas</Link></li>
            <li><Link to="/reviews" className="hover:text-accent">Reviews</Link></li>
          </ul>
        </div>
        <div>
          <div className="mb-3 text-xs font-medium uppercase tracking-[0.2em] text-primary-foreground/50">
            Company
          </div>
          <ul className="space-y-2 text-sm">
            <li><Link to="/about" className="hover:text-accent">About</Link></li>
            <li><Link to="/contact" className="hover:text-accent">Contact</Link></li>
          </ul>
        </div>
      </Container>
      <div className="border-t border-primary-foreground/10">
        <Container className="flex flex-col justify-between gap-2 py-6 text-xs text-primary-foreground/60 sm:flex-row">
          <div>© {new Date().getFullYear()} Forever. Forever Advisory, Phuket, Thailand.</div>
          <div>Independent. Buyer-side. Phuket.</div>
        </Container>
      </div>
    </footer>
  );
}
