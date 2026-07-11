import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Standalone Vitest configuration.
 *
 * Deliberately independent of the TanStack Start build config: unit tests only
 * need the `@/*` path alias (resolved from tsconfig) and a jsdom DOM. Keeping
 * the runner minimal avoids pulling the full SSR/router plugin stack into tests.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    css: false,
  },
});
