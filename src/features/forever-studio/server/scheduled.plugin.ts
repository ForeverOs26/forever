/**
 * Nitro runtime plugin: Studio scheduled runner registration.
 *
 * The Nitro cloudflare-module preset exports a `scheduled()` handler on the
 * deployed Worker module; each Cron Trigger firing calls the
 * `cloudflare:scheduled` runtime hook under `context.waitUntil`. This plugin
 * (registered via `nitro.plugins` in vite.config.ts and bundled into the
 * SERVER build only) hooks that event and runs one bounded Studio tick with
 * server-only credentials — the seam that makes "close the browser and
 * processing continues" true without any HTTP endpoint or user token.
 *
 * In local dev and tests the hook simply never fires; the tick logic itself
 * is dependency-injected and covered by scheduled-runner.test.ts.
 */

import type { NitroAppPlugin } from "nitro/types";

export const STUDIO_SCHEDULED_HOOK = "cloudflare:scheduled";

const studioScheduledRunner: NitroAppPlugin = (nitroApp) => {
  nitroApp.hooks.hook(STUDIO_SCHEDULED_HOOK, async () => {
    const { runStudioScheduledTickSafely } = await import("./scheduled-runner.server");
    await runStudioScheduledTickSafely();
  });
};

export default studioScheduledRunner;
