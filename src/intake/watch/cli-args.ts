/**
 * TG-WATCH-001A — pure CLI argument resolution (no side effects, safe in tests).
 *
 *   npm run tg-watch -- --channel @coralinakamala --export "<export-folder>"
 *     [--registry <path>] [--out-root <dir>] [--run-at <ISO-8601>]
 */

import { TELEGRAM_PUBLIC_CHANNEL_PATTERN } from "./types";

export interface WatchCliOptions {
  channel: string;
  exportDir: string;
  registryPath?: string;
  outRoot?: string;
  runAt?: Date;
  verbose: boolean;
}

export type ParseWatchResult =
  | { ok: true; options: WatchCliOptions }
  | { ok: false; error: string };

const VALUE_FLAGS = new Set(["--channel", "--export", "--registry", "--out-root", "--run-at"]);
const BOOLEAN_FLAGS = new Set(["--verbose"]);

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
      runAt,
      verbose,
    },
  };
}
