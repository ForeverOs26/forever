import type { ReactNode } from "react";
import { Header } from "./layout/Header";
import { Footer } from "./layout/Footer";

export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}