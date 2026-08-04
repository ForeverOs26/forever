// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { NitroConfig } from "nitro/types";
import type { Plugin } from "vite";

import { resolveForeverBuildId } from "./scripts/build/forever-build-id";
import { foreverTanstackReloadOwnership } from "./scripts/build/tanstack-reload-ownership.mjs";

const PARTNER_DEMO_HEALTH_PATH = "/__forever_partner_demo_health";

/**
 * Public build identity (FOREVER-STUDIO-STALE-ASSET-RECOVERY-001).
 *
 * Inlined into BOTH the client and the server output of this build, so the
 * constant compiled into a running page and the constant served by
 * `/forever-build.json` are the same value for one immutable build and differ
 * across a release. That single comparison is what makes the stale-asset
 * recovery a decision rather than a guess.
 *
 * Deterministic by construction — never a timestamp, never random — because a
 * build this repository cannot reproduce is already treated as a defect (see
 * the `compatibility_date` reasoning in wrangler.jsonc). A release may pin the
 * value explicitly with `FOREVER_BUILD_ID`.
 */
const FOREVER_BUILD_ID = resolveForeverBuildId();

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
    plugins: [
      // Exactly ONE recovery authority (independent-review P1-5). Substitutes
      // a repository-controlled lazy route-component loader for TanStack
      // Router's, whose built-in reload is identity-blind, write-unsafe and
      // stores the complete failing asset URL in sessionStorage. The plugin
      // refuses to build if the upstream module is not the pinned shape it was
      // written against.
      foreverTanstackReloadOwnership(),
      partnerDemoHealthPlugin(),
    ],
    define: {
      __FOREVER_BUILD_ID__: JSON.stringify(FOREVER_BUILD_ID),
    },
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  nitro: nitroRuntimeOptions as { preset?: string },
});
