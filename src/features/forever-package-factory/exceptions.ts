/**
 * Package Factory — the exception report.
 *
 * The Owner reviews EXCEPTIONS, never the package. Successful extraction is not
 * an exception; "289 units parsed, 24 images selected" is the machine doing its
 * job and appears nowhere in this report.
 *
 * Two severities and nothing else:
 *   blocker    the package cannot be published until a human decides something;
 *   attention  the package publishes, and the Owner may want to know anyway.
 */

import type { FactoryException } from "./types";

export interface ExceptionReport {
  slug: string | null;
  projectLabel: string;
  exceptions: FactoryException[];
  blocked: boolean;
}

export function blocker(code: string, message: string, detail?: string): FactoryException {
  return { code, severity: "blocker", message, ...(detail ? { detail } : {}) };
}

export function attention(code: string, message: string, detail?: string): FactoryException {
  return { code, severity: "attention", message, ...(detail ? { detail } : {}) };
}

export function summarizeExceptions(
  projectLabel: string,
  slug: string | null,
  exceptions: readonly FactoryException[],
): ExceptionReport {
  return {
    slug,
    projectLabel,
    exceptions: [...exceptions],
    blocked: exceptions.some((exception) => exception.severity === "blocker"),
  };
}

/** Short human-readable form for the console and the operator's report file. */
export function renderExceptionReport(reports: readonly ExceptionReport[]): string {
  const lines: string[] = [];
  const withExceptions = reports.filter((report) => report.exceptions.length > 0);
  if (withExceptions.length === 0) {
    lines.push("No exceptions. Every project generated cleanly; nothing needs an Owner decision.");
    return lines.join("\n");
  }
  for (const report of withExceptions) {
    lines.push(`${report.projectLabel}${report.slug ? ` (${report.slug})` : ""}`);
    for (const exception of report.exceptions) {
      const mark = exception.severity === "blocker" ? "BLOCKER  " : "attention";
      lines.push(`  ${mark} [${exception.code}] ${exception.message}`);
      if (exception.detail) lines.push(`            ${exception.detail}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}
