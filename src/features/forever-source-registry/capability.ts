/**
 * Forever Source Registry — capability models.
 *
 * A {@link SourceCapability} declares one thing a source *can* do (read, write,
 * stream incrementally, carry media, and so on). Capabilities are descriptors:
 * RC3.3 never exercises one — it records the intent so a future runtime and the
 * validation pipeline can reason about a source before any transport exists.
 *
 * The kinds are a closed vocabulary so downstream automation stays deterministic
 * and comparable; there are no free-text capability strings.
 */

/** The closed vocabulary of things a source may be able to do. */
export type SourceCapabilityKind =
  | "read"
  | "write"
  | "list"
  | "search"
  | "incremental"
  | "realtime"
  | "bulk"
  | "media"
  | "documents"
  | "authentication"
  | "webhooks";

/** Every {@link SourceCapabilityKind}, in a stable declared order. */
export const SOURCE_CAPABILITY_KINDS = [
  "read",
  "write",
  "list",
  "search",
  "incremental",
  "realtime",
  "bulk",
  "media",
  "documents",
  "authentication",
  "webhooks",
] as const satisfies readonly SourceCapabilityKind[];

/**
 * One capability of a source.
 *
 * `supported` lets a definition record a capability it explicitly does *not*
 * have (`supported: false`) rather than omitting it, so "unsupported" and
 * "unknown" stay distinguishable. `note` is optional free text for humans.
 */
export interface SourceCapability {
  kind: SourceCapabilityKind;
  supported: boolean;
  note?: string;
}

/** Build a {@link SourceCapability}; defaults to `supported: true`. */
export function sourceCapability(
  kind: SourceCapabilityKind,
  supported = true,
  note?: string,
): SourceCapability {
  return note === undefined ? { kind, supported } : { kind, supported, note };
}

/** Whether a capability list declares `kind` as supported. */
export function hasSourceCapability(
  capabilities: readonly SourceCapability[],
  kind: SourceCapabilityKind,
): boolean {
  return capabilities.some((capability) => capability.kind === kind && capability.supported);
}

/** The kinds a capability list declares as supported, in list order. */
export function supportedCapabilityKinds(
  capabilities: readonly SourceCapability[],
): SourceCapabilityKind[] {
  return capabilities
    .filter((capability) => capability.supported)
    .map((capability) => capability.kind);
}

/** Runtime guard: whether a value is a known {@link SourceCapabilityKind}. */
export function isKnownCapabilityKind(value: unknown): value is SourceCapabilityKind {
  return (
    typeof value === "string" && (SOURCE_CAPABILITY_KINDS as readonly string[]).includes(value)
  );
}
