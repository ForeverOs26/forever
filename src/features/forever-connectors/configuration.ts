/**
 * Forever Connectors — configuration schema models.
 *
 * A {@link ConnectorConfiguration} is the declarative *schema* of the settings a
 * connector needs — the shape of its fields, which are required, and which hold
 * secrets — and nothing else. It is emphatically **not** a store of values:
 * RC3.4 holds no URL, no token, no API key, no credential. A `secret` field
 * records only that a value *would* be sensitive, so a future runtime knows to
 * source it securely; the value itself lives entirely outside RC3.4
 * (anti-fabrication — the foundation never invents or embeds one).
 *
 * The field kinds are a closed vocabulary so tooling can render and validate a
 * configuration deterministically without free-text types.
 */

/** The closed vocabulary of value shapes a configuration field can hold. */
export type ConnectorConfigFieldKind =
  | "string"
  | "number"
  | "boolean"
  | "url"
  | "secret"
  | "enum"
  | "json";

/** Every {@link ConnectorConfigFieldKind}, in a stable declared order. */
export const CONNECTOR_CONFIG_FIELD_KINDS = [
  "string",
  "number",
  "boolean",
  "url",
  "secret",
  "enum",
  "json",
] as const satisfies readonly ConnectorConfigFieldKind[];

/**
 * One field in a connector's configuration schema.
 *
 * `secret` flags sensitivity independently of `kind` — an API key is a `string`
 * that is also `secret`. `enumValues` is required only for `enum` fields and
 * lists the allowed choices. No field ever carries an actual value.
 */
export interface ConnectorConfigField {
  /** Stable machine key, e.g. `base_url`. */
  key: string;
  kind: ConnectorConfigFieldKind;
  /** Whether a runtime must supply this field before the connector is usable. */
  required: boolean;
  /** Whether the field's value is sensitive and must be sourced securely. */
  secret: boolean;
  /** Human-readable label for the field. */
  label?: string;
  /** Free-text description of the field. */
  description?: string;
  /** Allowed choices for an `enum` field; unused otherwise. */
  enumValues?: string[];
}

/** The declarative schema of a connector's configuration. */
export interface ConnectorConfiguration {
  fields: ConnectorConfigField[];
}

/**
 * Build a {@link ConnectorConfigField}; defaults to a non-secret, optional
 * `string`. Every field describes a shape, never a value.
 */
export function connectorConfigField(
  key: string,
  kind: ConnectorConfigFieldKind = "string",
  options: {
    required?: boolean;
    secret?: boolean;
    label?: string;
    description?: string;
    enumValues?: string[];
  } = {},
): ConnectorConfigField {
  const field: ConnectorConfigField = {
    key,
    kind,
    required: options.required ?? false,
    secret: options.secret ?? kind === "secret",
  };
  if (options.label !== undefined) field.label = options.label;
  if (options.description !== undefined) field.description = options.description;
  if (options.enumValues !== undefined) field.enumValues = options.enumValues;
  return field;
}

/** An empty configuration: a connector that needs no settings. */
export function emptyConnectorConfiguration(): ConnectorConfiguration {
  return { fields: [] };
}

/** The keys of every field in a configuration, in declared order. */
export function configFieldKeys(configuration: ConnectorConfiguration): string[] {
  return configuration.fields.map((field) => field.key);
}

/** The fields a runtime must supply before the connector is usable. */
export function requiredConfigFields(
  configuration: ConnectorConfiguration,
): ConnectorConfigField[] {
  return configuration.fields.filter((field) => field.required);
}

/** The fields whose values are sensitive and must be sourced securely. */
export function secretConfigFields(
  configuration: ConnectorConfiguration,
): ConnectorConfigField[] {
  return configuration.fields.filter((field) => field.secret);
}

/** Whether the configuration declares a field with the given key. */
export function hasConfigField(configuration: ConnectorConfiguration, key: string): boolean {
  return configuration.fields.some((field) => field.key === key);
}

/** Runtime guard: whether a value is a known {@link ConnectorConfigFieldKind}. */
export function isKnownConfigFieldKind(value: unknown): value is ConnectorConfigFieldKind {
  return (
    typeof value === "string" &&
    (CONNECTOR_CONFIG_FIELD_KINDS as readonly string[]).includes(value)
  );
}
