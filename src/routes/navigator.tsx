import { createFileRoute } from "@tanstack/react-router";
import { NavigatorFlow } from "@/features/navigator";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";

export const Route = createFileRoute("/navigator")({
  head: () => ({
    meta: [
      { title: "Forever Navigator" },
      {
        name: "description",
        content:
          "A calm first conversation for understanding a Phuket home decision before showing any property.",
      },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&family=Newsreader:opsz,wght@6..72,300;6..72,400&display=swap",
      },
    ],
  }),
  component: NavigatorFoundationRoute,
});

/**
 * The Navigator inside the normal public site (F-007).
 *
 * It was previously mounted bare: no header, no footer, and zero anchors at
 * any viewport, while being the homepage's primary call to action. A visitor
 * who arrived and did not want the questionnaire had no way back.
 *
 * `SiteShell` is deliberately not used here. It wraps its children in a
 * `<main>`, and `NavigatorFlow` renders its own `<main>` per screen — nesting
 * them would put two `main` landmarks on the page. Composing `Header` and
 * `Footer` around the flow gives the same navigation while leaving the
 * Navigator's own document structure, questions and answers untouched.
 */
function NavigatorFoundationRoute() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <div className="flex-1">
        <NavigatorFlow embedded />
      </div>
      <Footer />
    </div>
  );
}
