/**
 * SIP-001A — pure CLI argument resolution (no side effects, safe in tests).
 *
 *   npm run sip:price-list -- --project <slug> --pdf "<path>" [--out-root <dir>] [--workspace <dir>]
 */

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export interface SipCliOptions {
  projectSlug: string;
  pdfPath: string;
  outRoot?: string;
  workspaceRoot?: string;
  artifactDir?: string;
}

export type ParseSipResult = { ok: true; options: SipCliOptions } | { ok: false; error: string };

const VALUE_FLAGS = new Set(["--project", "--pdf", "--out-root", "--workspace", "--artifact-dir"]);

export function parseSipInvocation(args: string[]): ParseSipResult {
  const values: Record<string, string> = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      return { ok: false, error: `Unexpected argument "${arg}". Every input must be a --flag.` };
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
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

  const projectSlug = values["--project"];
  const pdfPath = values["--pdf"];

  if (!projectSlug) return { ok: false, error: "--project <slug> is required." };
  if (!SLUG_PATTERN.test(projectSlug)) {
    return { ok: false, error: `--project must be a lowercase slug matching ${SLUG_PATTERN}.` };
  }
  if (!pdfPath) return { ok: false, error: '--pdf "<path>" is required.' };

  return {
    ok: true,
    options: {
      projectSlug,
      pdfPath,
      outRoot: values["--out-root"],
      workspaceRoot: values["--workspace"],
      artifactDir: values["--artifact-dir"],
    },
  };
}
