import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/navigator")({
  component: NavigatorFoundationRoute,
});

function NavigatorFoundationRoute() {
  return null;
}
