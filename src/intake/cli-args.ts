/**
 * Fast Intake v1 — pure CLI argument resolution (no side effects, safe in tests).
 *
 * The operator needs only a project slug, a project name, and one or more
 * source paths:
 *
 *   npm run intake -- --project <slug> --name "<name>" \
 *     --source "<folder-or-zip>" [--source "<another>"]
 *
 * Advanced flags (`--out-root`, `--workspace`, `--target-seconds`, `--verbose`)
 * have safe defaults and are optional.
 */

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export interface IntakeOptions {
  projectSlug: string;
  projectName: string;
  sources: string[];
  outRoot?: string;
  workspaceRoot?: string;
  targetSeconds?: number;
  verbose: boolean;
}

export type ParseIntakeResult = { ok: true; options: IntakeOptions } | { ok: false; error: string };

/** Flags that consume the following argument as their value; repeatable noted. */
const VALUE_FLAGS = new Set([
  "--project",
  "--name",
  "--source",
  "--out-root",
  "--workspace",
  "--target-seconds",
]);
const BOOLEAN_FLAGS = new Set(["--verbose"]);

export function parseIntakeInvocation(args: string[]): ParseIntakeResult {
  const values: Record<string, string[]> = {};
  const flags = new Set<string>();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      return { ok: false, error: `Unexpected argument "${arg}". Every input must be a --flag.` };
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    if (BOOLEAN_FLAGS.has(name)) {
      flags.add(name);
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
    (values[name] ??= []).push(value);
  }

  const projectSlug = values["--project"]?.[0];
  const projectName = values["--name"]?.[0];
  const sources = values["--source"] ?? [];

  if (!projectSlug) return { ok: false, error: "--project <slug> is required." };
  if (!SLUG_PATTERN.test(projectSlug)) {
    return { ok: false, error: `--project must be a lowercase slug matching ${SLUG_PATTERN}.` };
  }
  if (!projectName || projectName.trim().length === 0) {
    return { ok: false, error: '--name "<project name>" is required.' };
  }
  if (sources.length === 0) {
    return { ok: false, error: "At least one --source <folder-or-zip> is required." };
  }

  let targetSeconds: number | undefined;
  if (values["--target-seconds"]) {
    const parsed = Number(values["--target-seconds"][0]);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return { ok: false, error: "--target-seconds must be a positive number." };
    }
    targetSeconds = parsed;
  }

  return {
    ok: true,
    options: {
      projectSlug,
      projectName,
      sources,
      outRoot: values["--out-root"]?.[0],
      workspaceRoot: values["--workspace"]?.[0],
      targetSeconds,
      verbose: flags.has("--verbose"),
    },
  };
}
