/**
 * Forever Connectors — operational status enumeration.
 *
 * {@link ConnectorStatus} is the current *operational* state of a connector
 * within the registry: whether it still needs configuration, is ready to be
 * used, is degraded, switched off, or has settled into an error. It answers a
 * different question than the connector's {@link import("./health").ConnectorHealth},
 * which grades reliability, and is deliberately distinct from the Forever Source
 * Registry (RC3.3) source status vocabulary.
 *
 * These are types and small pure predicates only. RC3.4 never transitions a
 * status at runtime, runs a scheduler, opens a connection, or enables a
 * connector; it defines the vocabulary a future runtime will move a connector
 * through.
 */

/**
 * The operational state of a connector.
 *
 * `unconfigured` still needs its configuration filled in, `configured` has it
 * but is not yet in use, `ready` is usable, `degraded` is usable with caution,
 * `disabled` is switched off, and `error` has settled into a blocking fault.
 */
export type ConnectorStatus =
  | "unconfigured"
  | "configured"
  | "ready"
  | "degraded"
  | "disabled"
  | "error";

/** Every {@link ConnectorStatus}, in a stable declared order. */
export const CONNECTOR_STATUSES = [
  "unconfigured",
  "configured",
  "ready",
  "degraded",
  "disabled",
  "error",
] as const satisfies readonly ConnectorStatus[];

/** Whether a status means the connector may be used (ready or degraded). */
export function isUsableConnectorStatus(status: ConnectorStatus): boolean {
  return status === "ready" || status === "degraded";
}

/** Whether a status means the connector has settled into a blocking fault. */
export function isFaultedConnectorStatus(status: ConnectorStatus): boolean {
  return status === "error";
}

/** Runtime guard: whether a value is a known {@link ConnectorStatus}. */
export function isKnownConnectorStatus(value: unknown): value is ConnectorStatus {
  return typeof value === "string" && (CONNECTOR_STATUSES as readonly string[]).includes(value);
}
