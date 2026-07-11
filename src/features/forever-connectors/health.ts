/**
 * Forever Connectors — health models.
 *
 * A {@link ConnectorHealth} grades how reliable a connector currently is. RC3.4
 * runs no health check — it opens no connection, sends no probe, and reads no
 * clock — so a health level is only ever *supplied by a caller* who performed a
 * check outside the foundation, or *derived* from a connector's declared
 * {@link ConnectorStatus} without inventing information.
 *
 * The default level is `unknown`, never `healthy`: absent evidence, health is
 * unknown and must stay unknown (anti-fabrication). Derivation may only
 * *downgrade* from a declared fault — it never upgrades an unchecked connector
 * to healthy, because RC3.4 has no evidence a connection would succeed.
 *
 * Health is distinct from {@link ConnectorStatus}: status is the operational
 * intent (ready/disabled/error), health is the graded reliability of the last
 * observation. The two are kept separate so neither is read as the other.
 */

import type { ISODateTime } from "@/features/forever-database";

import type { ConnectorStatus } from "./status";

/** How reliable a connector currently is, from least to most confident. */
export type ConnectorHealthLevel = "unknown" | "healthy" | "degraded" | "unhealthy";

/** Every {@link ConnectorHealthLevel}, in a stable declared order. */
export const CONNECTOR_HEALTH_LEVELS = [
  "unknown",
  "healthy",
  "degraded",
  "unhealthy",
] as const satisfies readonly ConnectorHealthLevel[];

/**
 * The health of a connector.
 *
 * `checkedAt` is supplied by the caller so a health record stays deterministic —
 * RC3.4 reads no wall clock. `detail` is optional free text for humans. A record
 * with no check is `{ level: "unknown" }` and nothing more.
 */
export interface ConnectorHealth {
  level: ConnectorHealthLevel;
  /** When the health was last observed, supplied by the caller. */
  checkedAt?: ISODateTime;
  /** Free-text explanation of the health level. */
  detail?: string;
}

/** The default health of a never-checked connector: `unknown`. */
export function unknownConnectorHealth(): ConnectorHealth {
  return { level: "unknown" };
}

/**
 * Derive a health level from a connector's declared {@link ConnectorStatus}
 * *without fabricating* a positive observation.
 *
 * A connector declared `error` is `unhealthy`; a `degraded` connector is
 * `degraded`. Every other status yields `unknown` — RC3.4 has performed no
 * check, so it cannot claim a connector is `healthy`. The mapping is total and
 * deterministic.
 */
export function deriveConnectorHealthLevel(status: ConnectorStatus): ConnectorHealthLevel {
  switch (status) {
    case "error":
      return "unhealthy";
    case "degraded":
      return "degraded";
    default:
      return "unknown";
  }
}

/** Whether a health level represents a positively-observed healthy connector. */
export function isHealthyLevel(level: ConnectorHealthLevel): boolean {
  return level === "healthy";
}

/** Whether a health level represents a connector that should not be relied on. */
export function isUnhealthyLevel(level: ConnectorHealthLevel): boolean {
  return level === "unhealthy";
}

/** Runtime guard: whether a value is a known {@link ConnectorHealthLevel}. */
export function isKnownConnectorHealthLevel(value: unknown): value is ConnectorHealthLevel {
  return (
    typeof value === "string" && (CONNECTOR_HEALTH_LEVELS as readonly string[]).includes(value)
  );
}
