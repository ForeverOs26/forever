// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { NitroConfig } from "nitro/types";
import type { Plugin } from "vite";

const PARTNER_DEMO_HEALTH_PATH = "/__forever_partner_demo_health";

function partnerDemoHealthPlugin(): Plugin {
  return {
    name: "forever-partner-demo-health",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(PARTNER_DEMO_HEALTH_PATH, (_request, response, next) => {
        if (process.env.VITE_PARTNER_DEMO !== "true") {
          next();
          return;
        }

        const leadWritesBlocked = process.env.VITE_DEMO_LEAD_MODE === "true";
        const localDataOnly = process.env.VITE_PARTNER_DEMO_DATA === "committed-local";
        const safe = leadWritesBlocked && localDataOnly;
        response.statusCode = safe ? 200 : 503;
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        response.end(
          JSON.stringify({
            app: "forever",
            mode: "partner-demo",
            safe,
            leadWrites: leadWritesBlocked ? "blocked" : "unproven",
            projectData: localDataOnly ? "committed-local" : "unproven",
          }),
        );
      });
    },
  };
}

// Nitro runtime plugin: registers the Studio scheduled runner on the Worker's
// `scheduled()` export (cloudflare:scheduled hook). The cron cadence itself
// lives in wrangler.jsonc (`triggers.crons`), merged by Nitro at build time.
// The lovable wrapper forwards this object verbatim to `nitro()` from
// `nitro/vite`; its declared option surface is deliberately narrower than the
// runtime one, hence `satisfies NitroConfig` + the assertion.
const nitroRuntimeOptions = {
  plugins: ["./src/features/forever-studio/server/scheduled.plugin.ts"],
} satisfies NitroConfig;

export default defineConfig({
  vite: {
    plugins: [partnerDemoHealthPlugin()],
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  nitro: nitroRuntimeOptions as { preset?: string },
});
