/**
 * Forever Project Readiness — the in-memory report registry.
 *
 * A small, deterministic lookup that lets future wiring register a
 * {@link ReadinessReport} under its report id and resolve it later. Keying
 * by report id is what enforces the module's naming contract at the seam: a
 * report id is derived from the project (and the caller-stated batch), so
 * registering two reports under one id clashes at wiring time instead of
 * silently shadowing — a caller distinguishing runs states a batch. This is
 * the open/closed seam of RC4.9 — a new examination plugs in without any
 * existing code changing — and it mirrors the Forever Import (RC3.1), Sync
 * (RC3.2), Source Registry (RC3.3), Connectors (RC3.4), Pipeline (RC3.5),
 * Project Integration (RC4.0), Project Template (RC4.2), Project Factory
 * (RC4.3), Project Sources (RC4.4), Extraction Pipeline (RC4.5), Canonical
 * Project Database (RC4.6), Cross-Source Validation (RC4.7), and Knowledge
 * Graph (RC4.8) registries so all the foundations behave identically.
 *
 * It is *not* a runtime store: it self-populates nothing, reads no clock or
 * disk, persists nothing, and holds no global singleton. It is a plain,
 * caller-constructed container over pure descriptors. It is deliberately not
 * a source, extraction, record, examination, or graph registry either —
 * catalogued documents stay in the RC4.4 registry, pipelines in the RC4.5
 * one, canonical records in the RC4.6 one, examinations in the RC4.7 one,
 * and graphs in the RC4.8 one; this one holds only the described readiness
 * reports that gate them.
 */

import type { ReadinessReport } from "./report";
import { readinessReportIsBlocked, readinessReportIsReady } from "./report";
import type { ReadinessStanding } from "./verdict";

/** In-memory registry of described reports keyed by their report id. */
export class ReadinessRegistry {
  private readonly reports = new Map<string, ReadinessReport>();

  /**
   * Register a report under its id. Re-registering the same id throws so a
   * second report for one project-and-batch is caught at wiring time rather
   * than silently shadowing — distinguishable runs state a batch.
   */
  register(report: ReadinessReport): this {
    if (this.reports.has(report.id)) {
      throw new Error(`A readiness report is already registered for ${report.id}`);
    }
    this.reports.set(report.id, report);
    return this;
  }

  /** Resolve the report for a report id, or `undefined`. */
  resolve(reportId: string): ReadinessReport | undefined {
    return this.reports.get(reportId);
  }

  /** Whether a report is registered for a report id. */
  has(reportId: string): boolean {
    return this.reports.has(reportId);
  }

  /** Every registered report, in insertion order. */
  list(): ReadinessReport[] {
    return [...this.reports.values()];
  }

  /** Every registered report concerning one project, in insertion order. */
  listByProject(projectId: string): ReadinessReport[] {
    return this.list().filter((report) => report.projectId === projectId);
  }

  /** Every registered report of one standing, in insertion order. */
  listByStanding(standing: ReadinessStanding): ReadinessReport[] {
    return this.list().filter((report) => report.standing === standing);
  }

  /** Every registered report describing a fully met bar, in insertion order. */
  listReady(): ReadinessReport[] {
    return this.list().filter((report) => readinessReportIsReady(report));
  }

  /** Every registered report describing standing blockers, in insertion order. */
  listBlocked(): ReadinessReport[] {
    return this.list().filter((report) => readinessReportIsBlocked(report));
  }
}
