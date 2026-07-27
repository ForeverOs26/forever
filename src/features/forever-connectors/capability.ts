/**
 * Forever Connectors — capability models.
 *
 * A {@link ConnectorCapability} declares one transport-level thing a connector
 * *can* do (connect, read, write, stream, paginate, honour a rate limit, and so
 * on). Capabilities are descriptors: RC3.4 never exercises one — it records the
 * intent so a future runtime and the validation pipeline can reason about a
 * connector before any transport exists.
 *
 * These are transport concerns, deliberately distinct from the Forever Source
 * Registry (RC3.3) *source* capabilities (which describe what a data origin
 * offers). The two vocabularies answer different questions and are never
 * conflated. The kinds are a closed vocabulary so downstream automation stays
 * deterministic and comparable; there are no free-text capability strings.
 */

/** The closed vocabulary of transport-level things a connector may do. */
export type ConnectorCapabilityKind =
  | "connect"
  | "read"
  | "write"
  | "list"
  | "search"
  | "stream"
  | "batch"
  | "incremental"
  | "webhook"
  | "authenticate"
  | "paginate"
  | "rate_limit";

/** Every {@link ConnectorCapabilityKind}, in a stable declared order. */
export const CONNECTOR_CAPABILITY_KINDS = [
  "connect",
  "read",
  "write",
  "list",
  "search",
  "stream",
  "batch",
  "incremental",
  "webhook",
  "authenticate",
  "paginate",
  "rate_limit",
] as const satisfies readonly ConnectorCapabilityKind[];

/**
 * One capability of a connector.
 *
 * `supported` lets a definition record a capability it explicitly does *not*
 * have (`supported: false`) rather than omitting it, so "unsupported" and
 * "unknown" stay distinguishable (anti-fabrication). `note` is optional free
 * text for humans.
 */
export interface ConnectorCapability {
  kind: ConnectorCapabilityKind;
  supported: boolean;
  note?: string;
}

/** Build a {@link ConnectorCapability}; defaults to `supported: true`. */
export function connectorCapability(
  kind: ConnectorCapabilityKind,
  supported = true,
  note?: string,
): ConnectorCapability {
  return note === undefined ? { kind, supported } : { kind, supported, note };
}

/** Whether a capability list declares `kind` as supported. */
export function hasConnectorCapability(
  capabilities: readonly ConnectorCapability[],
  kind: ConnectorCapabilityKind,
): boolean {
  return capabilities.some((capability) => capability.kind === kind && capability.supported);
}

/** The kinds a capability list declares as supported, in list order. */
export function supportedConnectorCapabilityKinds(
  capabilities: readonly ConnectorCapability[],
): ConnectorCapabilityKind[] {
  return capabilities
    .filter((capability) => capability.supported)
    .map((capability) => capability.kind);
}

/** Runtime guard: whether a value is a known {@link ConnectorCapabilityKind}. */
export function isKnownConnectorCapabilityKind(
  value: unknown,
): value is ConnectorCapabilityKind {
  return (
    typeof value === "string" &&
    (CONNECTOR_CAPABILITY_KINDS as readonly string[]).includes(value)
  );
}
