/**
 * Forever Cross-Source Validation — the in-memory report registry.
 *
 * A small, deterministic lookup that lets future wiring register a
 * {@link CrossValidationReport} under its report id and resolve it later.
 * Keying by report id is what enforces the module's naming contract at the
 * seam: a report id is derived from the project (and the caller-stated batch),
 * so registering two reports under one id clashes at wiring time instead of
 * silently shadowing — a caller distinguishing runs states a batch. This is
 * the open/closed seam of RC4.7 — a new examination plugs in without any
 * existing code changing — and it mirrors the Forever Import (RC3.1), Sync
 * (RC3.2), Source Registry (RC3.3), Connectors (RC3.4), Pipeline (RC3.5),
 * Project Integration (RC4.0), Project Template (RC4.2), Project Factory
 * (RC4.3), Project Sources (RC4.4), Extraction Pipeline (RC4.5), and
 * Canonical Project Database (RC4.6) registries so all the foundations behave
 * identically.
 *
 * It is *not* a runtime store: it self-populates nothing, reads no clock or
 * disk, persists nothing, and holds no global singleton. It is a plain,
 * caller-constructed container over pure descriptors. It is deliberately not
 * a source, extraction, or record registry either — catalogued documents stay
 * in the RC4.4 registry, pipelines in the RC4.5 one, and canonical records in
 * the RC4.6 one; this one holds only the described examinations that bridge
 * them.
 */

import { crossValidationFindingRequiresReview } from "./finding";
import type { CrossValidationFindingKind } from "./finding";
import type { CrossValidationReport } from "./report";

/** In-memory registry of described reports keyed by their report id. */
export class CrossValidationRegistry {
  private readonly reports = new Map<string, CrossValidationReport>();

  /**
   * Register a report under its id. Re-registering the same id throws so a
   * second report for one project-and-batch is caught at wiring time rather
   * than silently shadowing — distinguishable runs state a batch.
   */
  register(report: CrossValidationReport): this {
    if (this.reports.has(report.id)) {
      throw new Error(`A cross-validation report is already registered for ${report.id}`);
    }
    this.reports.set(report.id, report);
    return this;
  }

  /** Resolve the report for a report id, or `undefined`. */
  resolve(reportId: string): CrossValidationReport | undefined {
    return this.reports.get(reportId);
  }

  /** Whether a report is registered for a report id. */
  has(reportId: string): boolean {
    return this.reports.has(reportId);
  }

  /** Every registered report, in insertion order. */
  list(): CrossValidationReport[] {
    return [...this.reports.values()];
  }

  /** Every registered report examining one project, in insertion order. */
  listByProject(projectId: string): CrossValidationReport[] {
    return this.list().filter((report) => report.projectId === projectId);
  }

  /** Every registered report describing a finding of one kind, in insertion order. */
  listByFindingKind(kind: CrossValidationFindingKind): CrossValidationReport[] {
    return this.list().filter((report) => report.findings.some((finding) => finding.kind === kind));
  }

  /** Every registered report with findings requiring review, in insertion order. */
  listRequiringReview(): CrossValidationReport[] {
    return this.list().filter((report) =>
      report.findings.some((finding) => crossValidationFindingRequiresReview(finding)),
    );
  }
}
