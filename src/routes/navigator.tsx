import { createFileRoute } from "@tanstack/react-router";
import { NavigatorFlow } from "@/features/navigator";

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

function NavigatorFoundationRoute() {
  return <NavigatorFlow />;
}
