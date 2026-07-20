/**
 * TG-WATCH-001A — pure CLI argument resolution (no side effects, safe in tests).
 *
 *   npm run tg-watch -- --channel @coralinakamala --export "<export-folder>"
 *
 * In PowerShell, quote the channel (`'@coralinakamala'`) so PowerShell does
 * not treat its leading `@` as a splatting token.
 *     [--registry <path>] [--out-root <dir>] [--max-attachment-mb <n>]
 *     [--run-at <ISO-8601>]
 */

import { TELEGRAM_PUBLIC_CHANNEL_PATTERN } from "./types";

export interface WatchCliOptions {
  channel: string;
  exportDir: string;
  registryPath?: string;
  outRoot?: string;
  maxAttachmentBytes?: number;
  runAt?: Date;
  verbose: boolean;
}

export type ParseWatchResult =
  | { ok: true; options: WatchCliOptions }
  | { ok: false; error: string };

const VALUE_FLAGS = new Set([
  "--channel",
  "--export",
  "--registry",
  "--out-root",
  "--max-attachment-mb",
  "--run-at",
]);
const BOOLEAN_FLAGS = new Set(["--verbose"]);

/** Sanity ceiling for --max-attachment-mb: 100 GiB expressed in MiB. */
const MAX_ATTACHMENT_MB_CEILING = 102400;

export function parseWatchInvocation(args: string[]): ParseWatchResult {
  const values: Record<string, string> = {};
  let verbose = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      return { ok: false, error: `Unexpected argument "${arg}". Every input must be a --flag.` };
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    if (BOOLEAN_FLAGS.has(name)) {
      if (eq !== -1) return { ok: false, error: `Flag "${name}" takes no value.` };
      verbose = true;
      continue;
    }
    if (!VALUE_FLAGS.has(name)) {
      return { ok: false, error: `Unknown flag "${name}".` };
    }
    let value: string | undefined;
    if (eq !== -1) {
      value = arg.slice(eq + 1);
    } else {
      value = args[index + 1];
      index += 1;
    }
    if (value === undefined) {
      return { ok: false, error: `Flag "${name}" requires a value.` };
    }
    values[name] = value;
  }

  const channel = values["--channel"];
  if (!channel) return { ok: false, error: "--channel @name is required." };
  if (!TELEGRAM_PUBLIC_CHANNEL_PATTERN.test(channel)) {
    return {
      ok: false,
      error: "--channel must be a public Telegram channel reference like @coralinakamala.",
    };
  }
  const exportDir = values["--export"];
  if (!exportDir) return { ok: false, error: '--export "<export-folder>" is required.' };

  let maxAttachmentBytes: number | undefined;
  const rawMaxMb = values["--max-attachment-mb"];
  if (rawMaxMb !== undefined) {
    if (!/^\d+$/.test(rawMaxMb)) {
      return { ok: false, error: "--max-attachment-mb must be a positive integer (MiB)." };
    }
    const megabytes = Number(rawMaxMb);
    if (megabytes < 1 || megabytes > MAX_ATTACHMENT_MB_CEILING) {
      return {
        ok: false,
        error: `--max-attachment-mb must be between 1 and ${MAX_ATTACHMENT_MB_CEILING}.`,
      };
    }
    maxAttachmentBytes = megabytes * 1024 * 1024;
  }

  let runAt: Date | undefined;
  const rawRunAt = values["--run-at"];
  if (rawRunAt !== undefined) {
    const parsed = new Date(rawRunAt);
    if (Number.isNaN(parsed.valueOf())) {
      return { ok: false, error: "--run-at must be a valid ISO-8601 timestamp." };
    }
    runAt = parsed;
  }

  return {
    ok: true,
    options: {
      channel,
      exportDir,
      registryPath: values["--registry"],
      outRoot: values["--out-root"],
      maxAttachmentBytes,
      runAt,
      verbose,
    },
  };
}
